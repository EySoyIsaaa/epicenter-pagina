"""Run against an isolated local PostgreSQL database with the Supabase migrations applied."""

from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
import os
import time
import unittest
from urllib.parse import urlsplit
from uuid import uuid4

import psycopg
from psycopg import errors, sql
from psycopg.types.json import Jsonb


class PueblaDatabaseTests(unittest.TestCase):
    @classmethod
    def connect(cls):
        return psycopg.connect(
            cls.database_url,
            hostaddr=cls.host_address,
            autocommit=True,
            connect_timeout=5,
            options="-c statement_timeout=15000 -c idle_in_transaction_session_timeout=15000",
        )

    @classmethod
    def setUpClass(cls):
        cls.database_url = os.getenv(
            "PUEBLA_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
        )
        target = urlsplit(cls.database_url)
        if (target.scheme not in ("postgres", "postgresql")
                or target.hostname not in ("localhost", "127.0.0.1", "::1")
                or target.query or target.fragment):
            raise ValueError("PUEBLA_TEST_DATABASE_URL must point to an isolated loopback database")
        cls.host_address = "::1" if target.hostname == "::1" else "127.0.0.1"

        cls.db = cls.connect()
        cls.addClassCleanup(cls.db.close)
        cls.actor = uuid4()
        cls.visitor = uuid4()
        with cls.db.transaction():
            for user_id in (cls.actor, cls.visitor):
                cls.db.execute(
                    "insert into auth.users (id, email, aud, role) values (%s, %s, 'authenticated', 'authenticated')",
                    (user_id, f"{user_id}@puebla-test.invalid"),
                )
            cls.db.execute("insert into puebla_private.admin_users (user_id) values (%s)", (cls.actor,))
        cls.addClassCleanup(cls.db.execute, "delete from auth.users where id in (%s, %s)", (cls.actor, cls.visitor))

    def setUp(self):
        self.campaign = self.make_campaign()

    def make_campaign(self):
        campaign_id = f"puebla-test-{uuid4().hex}"
        self.db.execute(
            """insert into puebla_private.campaigns (id, name, starts_at, ends_at, enabled)
               values (%s, 'Test Puebla', now() - interval '1 hour', now() + interval '1 hour', true)""",
            (campaign_id,),
        )
        self.addCleanup(self.remove_campaign, campaign_id)
        return campaign_id

    def remove_campaign(self, campaign_id):
        with self.db.transaction():
            for table in ("audit_logs", "invitations", "promotional_codes"):
                self.db.execute(
                    sql.SQL("delete from puebla_private.{} where campaign_id = %s").format(sql.Identifier(table)),
                    (campaign_id,),
                )
            self.db.execute("delete from puebla_private.campaigns where id = %s", (campaign_id,))

    @staticmethod
    def rpc(conn, name, *arguments, role="service_role"):
        params = sql.SQL(", ").join(sql.Placeholder() for _ in arguments)
        with conn.transaction():
            conn.execute(sql.SQL("set local role {}").format(sql.Identifier(role)))
            result = conn.execute(
                sql.SQL("select public.{}({})").format(sql.Identifier(name), params), arguments
            )
            return result.fetchone()[0]

    def admin(self, action, payload=None, *, campaign=None, actor=None):
        return self.rpc(
            self.db, "puebla_admin", campaign or self.campaign, actor or self.actor, action, Jsonb(payload or {})
        )

    def make_inventory(self, *platforms):
        inventory = {platform: f"TEST-{self.campaign.upper()}-{platform.upper()}" for platform in platforms}
        for platform, code in inventory.items():
            self.assertEqual(self.admin("import", {"platform": platform, "codes": [code]}), {
                "inserted": 1, "duplicates": 0,
            })
        return inventory

    def make_invitations(self, count):
        hashes = [sha256(f"{self.campaign}-{index}".encode()).hexdigest() for index in range(count)]
        result = self.admin("create_invitations", {"token_hashes": hashes})
        self.assertEqual(result["duplicates"], 0)
        self.assertCountEqual([row["token_hash"] for row in result["created"]], hashes)
        return hashes

    def claim(self, platform, invitation, conn=None):
        return self.rpc(conn or self.db, "puebla_claim", self.campaign, platform, invitation)

    def availability(self, platform):
        return self.rpc(self.db, "puebla_availability", self.campaign, platform)

    def wait_for_lock(self, pid):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            row = self.db.execute("select wait_event_type from pg_stat_activity where pid = %s", (pid,)).fetchone()
            if row and row[0] == "Lock":
                return
            time.sleep(0.025)
        self.fail("The challenger did not wait on a PostgreSQL lock")

    def concurrent_claims(self, leader_claim, challenger_claim, *, rollback=False):
        with self.connect() as leader, self.connect() as challenger, ThreadPoolExecutor() as executor:
            with leader.transaction(force_rollback=rollback):
                first = self.claim(*leader_claim, conn=leader)
                pending = executor.submit(self.claim, *challenger_claim, conn=challenger)
                self.wait_for_lock(challenger.info.backend_pid)
            return first, pending.result(timeout=5)

    def test_same_invitation_recovers_one_license_across_platforms(self):
        inventory = self.make_inventory("android", "ios")
        invitation, = self.make_invitations(1)
        first, second = self.concurrent_claims(("android", invitation), ("ios", invitation))
        self.assertEqual(first, {"status": "assigned", "platform": "android", "code": inventory["android"]})
        self.assertEqual(second, {**first, "status": "recovered"})
        self.assertEqual(self.claim("android", invitation), second)
        self.assertEqual(self.availability("ios"), {"status": "available", "available": 1})

    def test_different_invitations_cannot_receive_the_last_code_twice(self):
        self.make_inventory("android")
        leader, challenger = self.make_invitations(2)
        first, second = self.concurrent_claims(("android", leader), ("android", challenger))
        self.assertEqual(first["status"], "assigned")
        self.assertEqual(second, {"status": "sold_out"})
        stats = self.admin("stats")
        self.assertEqual(stats["codes"]["delivered"], 1)
        self.assertEqual(stats["invitations"]["unused"], 1)

    def test_failed_transaction_releases_last_code_for_next_visitor(self):
        self.make_inventory("android")
        leader, challenger = self.make_invitations(2)
        first, second = self.concurrent_claims(("android", leader), ("android", challenger), rollback=True)
        self.assertEqual(second, first)
        self.assertEqual(self.claim("android", challenger), {**first, "status": "recovered"})
        self.assertEqual(self.claim("android", leader), {"status": "sold_out"})
        self.assertEqual(self.admin("stats")["codes"]["delivered"], 1)

    def test_concurrent_claims_respect_global_and_platform_limits(self):
        self.make_inventory("android", "ios")
        self.admin("update_campaign", {"delivery_limit": 1})
        leader, challenger = self.make_invitations(2)
        first, second = self.concurrent_claims(("android", leader), ("ios", challenger))
        self.assertEqual(first["status"], "assigned")
        self.assertEqual(second, {"status": "sold_out"})
        stats = self.admin("stats")["codes"]
        self.assertEqual(stats["ios_available"], 1)
        self.assertEqual(stats["exhausted_platforms"], 2)
        self.admin("update_campaign", {"delivery_limit": None, "ios_limit": 0})
        self.assertEqual(self.availability("ios"), {"status": "sold_out", "available": 0})
        self.admin("update_campaign", {"ios_limit": 1, "ios_enabled": False})
        self.assertEqual(self.claim("ios", challenger), {"status": "paused"})
        self.admin("update_campaign", {"ios_enabled": True})
        self.assertEqual(self.claim("ios", challenger)["status"], "assigned")

    def test_future_disabled_and_closed_campaigns_do_not_issue_new_codes(self):
        self.make_inventory("android", "ios")
        used, unused = self.make_invitations(2)
        first = self.claim("android", used)
        self.admin("update_campaign", {"enabled": False})
        self.assertEqual(self.claim("ios", unused), {"status": "paused"})
        self.db.execute(
            """update puebla_private.campaigns set starts_at = now() + interval '1 day',
               ends_at = now() + interval '2 days' where id = %s""", (self.campaign,)
        )
        self.assertEqual(self.claim("ios", unused), {"status": "upcoming"})
        self.db.execute(
            """update puebla_private.campaigns set starts_at = now() - interval '2 days',
               ends_at = now() - interval '1 day', enabled = true where id = %s""", (self.campaign,)
        )
        self.assertEqual(self.availability("ios"), {"status": "ended", "available": 0})
        self.assertEqual(self.claim("ios", unused), {"status": "ended"})
        self.assertEqual(self.claim("ios", used), {**first, "status": "recovered"})
        self.assertEqual(self.admin("stats")["invitations"]["unused"], 1)

    def test_clients_cannot_read_sensitive_tables_or_run_edge_rpcs(self):
        self.make_inventory("android")
        tables = self.db.execute(
            """select relname, relrowsecurity from pg_class
               where relnamespace = 'puebla_private'::regnamespace and relkind = 'r'"""
        ).fetchall()
        self.assertEqual(len(tables), 6)
        self.assertTrue(all(rls_enabled for _, rls_enabled in tables))
        for role in ("anon", "authenticated", "service_role"):
            with self.subTest(role=role), self.assertRaises(errors.InsufficientPrivilege), self.db.transaction():
                self.db.execute(sql.SQL("set local role {}").format(sql.Identifier(role)))
                self.db.execute("select code from puebla_private.promotional_codes")
        for role in ("anon", "authenticated"):
            with self.subTest(role=role), self.assertRaises(errors.InsufficientPrivilege):
                self.rpc(self.db, "puebla_availability", self.campaign, "android", role=role)
            with self.subTest(role=role), self.assertRaises(errors.InsufficientPrivilege):
                self.rpc(self.db, "puebla_claim", self.campaign, "android", "a" * 64, role=role)

    def test_non_admin_cannot_import_even_if_authenticated(self):
        payload = {"platform": "android", "codes": ["TEST-NON-ADMIN"]}
        self.assertTrue(self.rpc(self.db, "puebla_is_admin", self.actor))
        self.assertFalse(self.rpc(self.db, "puebla_is_admin", self.visitor))
        with self.assertRaises(errors.InsufficientPrivilege):
            self.admin("import", payload, actor=self.visitor)
        with self.assertRaises(errors.InsufficientPrivilege):
            self.rpc(self.db, "puebla_admin", self.campaign, self.actor, "import", Jsonb(payload), role="authenticated")
        self.assertEqual(self.admin("stats")["codes"]["total"], 0)

    def test_import_is_normalized_validated_and_unique_across_campaigns(self):
        code = f"TEST-{uuid4().hex.upper()}"
        result = self.admin("import", {"platform": "ios", "codes": [code, f" {code.lower()} "]})
        self.assertEqual(result, {"inserted": 1, "duplicates": 1})
        result = self.admin("import", {"platform": "android", "codes": [code]}, campaign=self.make_campaign())
        self.assertEqual(result, {"inserted": 0, "duplicates": 1})
        with self.assertRaises(errors.InvalidParameterValue):
            self.admin("import", {"platform": "ios", "codes": ["TEST-GOOD", 12345]})
        self.assertEqual(self.admin("stats")["codes"]["total"], 1)

    def test_admin_revoke_logs_and_redemption_are_separate_from_assignment(self):
        inventory = self.make_inventory("android")
        used, unused = self.make_invitations(2)
        self.claim("android", used)
        first_page = self.admin("invitations", {"limit": 1})
        second_page = self.admin("invitations", {"limit": 1, "offset": 1})
        self.assertTrue(first_page["has_more"])
        self.assertFalse(second_page["has_more"])
        self.assertNotEqual(first_page["invitations"][0]["id"], second_page["invitations"][0]["id"])
        unused_row, = self.admin("invitations", {"status": "unused"})["invitations"]
        used_row, = self.admin("invitations", {"status": "used"})["invitations"]
        self.assertEqual(self.admin("revoke_invitation", {"id": used_row["id"]}), {"revoked": False})
        self.assertEqual(self.admin("revoke_invitation", {"id": unused_row["id"]}), {"revoked": True})
        self.assertEqual(self.claim("android", unused), {"status": "invalid_invitation"})

        logs = self.admin("logs")["logs"]
        serialized = json.dumps(logs)
        self.assertNotIn(inventory["android"], serialized)
        self.assertNotIn(used, serialized)
        self.assertNotIn(unused, serialized)
        assignment, = [row for row in logs if row["action"] == "assigned"]
        self.assertEqual(self.admin("stats")["codes"]["redeemed_verified"], 0)
        self.assertEqual(self.admin("verify_redemption", {"id": assignment["code_id"]}), {"verified": True})
        stats = self.admin("stats")
        self.assertEqual(stats["codes"]["redeemed_verified"], 1)
        self.assertEqual(stats["codes"]["delivered"], 1)
        self.assertEqual(stats["codes"]["assigned"], 0)
        self.assertEqual(stats["daily"][0]["android"], 1)
        self.assertEqual(self.claim("android", used)["code"], inventory["android"])

    def test_links_cannot_become_inconsistent_at_commit(self):
        self.make_inventory("android")
        invitation, = self.make_invitations(1)
        self.claim("android", invitation)
        with self.assertRaises(errors.ForeignKeyViolation), self.db.transaction():
            self.db.execute(
                "update puebla_private.promotional_codes set assigned_to = %s where campaign_id = %s",
                (uuid4(), self.campaign),
            )
        self.assertEqual(self.claim("android", invitation)["status"], "recovered")

    def test_error_audits_are_sanitized_scoped_and_service_only(self):
        second_campaign = self.make_campaign()
        scopes = [f"{campaign}:audit-error:{route}"
                  for campaign in (self.campaign, second_campaign) for route in ("public", "admin")]
        self.addCleanup(self.db.execute, "delete from puebla_private.rate_limits where scope = any(%s)", (scopes,))

        for role in ("anon", "authenticated"):
            with self.subTest(role=role), self.assertRaises(errors.InsufficientPrivilege):
                self.rpc(self.db, "puebla_audit_error", self.campaign, "public", role=role)
        with self.assertRaises(errors.InvalidParameterValue):
            self.rpc(self.db, "puebla_audit_error", self.campaign, "other")
        with self.assertRaises(errors.InvalidParameterValue):
            self.rpc(self.db, "puebla_audit_error", "missing-campaign", "public")

        self.assertTrue(self.rpc(self.db, "puebla_audit_error", self.campaign, "public"))
        self.assertFalse(self.rpc(self.db, "puebla_audit_error", self.campaign, "public"))
        self.assertTrue(self.rpc(self.db, "puebla_audit_error", self.campaign, "admin"))
        self.assertTrue(self.rpc(self.db, "puebla_audit_error", second_campaign, "public"))
        logs = self.admin("logs")["logs"]
        self.assertCountEqual([row["details"] for row in logs], [{"route": "public"}, {"route": "admin"}])
        for row in logs:
            self.assertEqual(row["action"], "error")
            for field in ("actor_id", "platform", "invitation_id", "code_id"):
                self.assertIsNone(row[field])

    def test_distributed_rate_limit_is_atomic_and_resets_after_expiration(self):
        scope = self.campaign
        key = sha256(scope.encode()).hexdigest()
        self.addCleanup(self.db.execute, "delete from puebla_private.rate_limits where scope = %s", (scope,))

        def hit():
            with self.connect() as conn:
                return self.rpc(conn, "puebla_rate_limit", scope, key, 3, 60)

        with ThreadPoolExecutor(max_workers=8) as executor:
            self.assertEqual(sum(executor.map(lambda _: hit(), range(8))), 3)
        self.assertFalse(hit())
        self.db.execute("update puebla_private.rate_limits set expires_at = now() where scope = %s", (scope,))
        self.db.execute(
            "insert into puebla_private.rate_limits (scope, key_hash, hits, expires_at) values (%s, %s, 1, now())",
            (scope, "a" * 64),
        )
        self.assertTrue(hit())
        remaining = self.db.execute("select key_hash from puebla_private.rate_limits where scope = %s", (scope,))
        self.assertEqual(remaining.fetchall(), [(key,)])


if __name__ == "__main__":
    unittest.main()
