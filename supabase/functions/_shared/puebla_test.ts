import { deepEqual, equal, match, ok } from "node:assert/strict";
import { createHandler } from "./puebla.ts";

const origin = "https://epicenterdsp.com";
const project = "https://puebla-test.example";
const actor = "12345678-1234-4234-8234-123456789012";
const code = "TEST-PROMO-0001";
const env = {
  SUPABASE_URL: project,
  SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_test"}',
  SUPABASE_SECRET_KEYS: '{"default":"sb_secret_test"}',
  PUEBLA_PIN_PEPPER: "a0".repeat(32),
  PUEBLA_RATE_PEPPER: "b1".repeat(32),
  PUEBLA_TURNSTILE_SECRET: "test-turnstile-secret",
};
const captcha = {
  success: true,
  hostname: "epicenterdsp.com",
  action: "puebla_claim",
};
const claim = {
  action: "claim",
  platform: "android",
  pin: "0123-4567-89ab-cdef",
  captcha_token: "test-proof",
};

Deno.test("temporary failures return a fixed error and audit only the route", async () => {
  const { fetcher, calls } = upstream({
    "/rest/v1/rpc/puebla_rate_limit": true,
    "/turnstile/v0/siteverify": captcha,
    "/rest/v1/rpc/puebla_claim": Response.json({
      message: code,
      details: claim.pin,
    }, { status: 500 }),
    "/rest/v1/rpc/puebla_audit_error": true,
  });
  const response = await createHandler("public", env, fetcher)(request(claim));
  equal(response.status, 503);
  deepEqual(await response.json(), { error: "temporarily_unavailable" });
  deepEqual(calls.at(-1)?.body, {
    p_campaign_id: "puebla2026",
    p_route: "public",
  });
});

type Call = {
  path: string;
  headers: Headers;
  body: Record<string, unknown>;
};

function upstream(
  replies: Record<string, unknown | ((call: Call) => unknown)> = {},
) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const path = new URL(String(input)).pathname;
    const call = {
      path,
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body || "{}")),
    };
    calls.push(call);
    const reply = replies[path];
    const data = typeof reply === "function" ? reply(call) : reply;
    if (data instanceof Response) return Promise.resolve(data);
    if (data === undefined) throw new Error("unexpected upstream call");
    return Promise.resolve(Response.json(data));
  };
  return { calls, fetcher };
}

function request(body: unknown, extra: HeadersInit = {}) {
  const headers = new Headers({
    Origin: origin,
    "Content-Type": "application/json",
  });
  new Headers(extra).forEach((value, key) => headers.set(key, value));
  return new Request(`${project}/functions/v1/test`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

Deno.test("only the configured origin receives the API and preflight headers", async () => {
  const { fetcher, calls } = upstream();
  const handle = createHandler("public", env, fetcher);
  const denied = await handle(
    request(claim, { Origin: "https://epicenterdsp.com.evil.example" }),
  );
  equal(denied.status, 403);
  equal(denied.headers.get("Access-Control-Allow-Origin"), null);
  const preflight = await handle(
    new Request(project, { method: "OPTIONS", headers: { Origin: origin } }),
  );
  equal(preflight.status, 204);
  equal(preflight.headers.get("Access-Control-Allow-Origin"), origin);
  equal(calls.length, 0);
});

Deno.test("availability suppresses counts by default and never returns inventory fields", async () => {
  const { fetcher } = upstream({
    "/rest/v1/rpc/puebla_rate_limit": true,
    "/rest/v1/rpc/puebla_availability": {
      status: "available",
      available: 12,
      code,
      inventory: [code],
    },
  });
  const payload = { action: "availability", platform: "android" };
  const hidden = await createHandler("public", env, fetcher)(request(payload));
  deepEqual(await hidden.json(), { status: "available" });
  const visible = await createHandler("public", {
    ...env,
    PUEBLA_SHOW_INVENTORY_COUNTS: "true",
  }, fetcher)(request(payload));
  deepEqual(await visible.json(), { status: "available", available: 12 });
});

Deno.test("rate limit cuts off claim before Siteverify and uses pseudonymous keys", async () => {
  const { fetcher, calls } = upstream({
    "/rest/v1/rpc/puebla_rate_limit": (call: Call) =>
      call.body.p_scope === "puebla2026:claim:global",
  });
  const response = await createHandler("public", env, fetcher)(
    request(claim, { "CF-Connecting-IP": "192.0.2.4" }),
  );
  equal(response.status, 429);
  equal(response.headers.get("Retry-After"), "60");
  equal(calls.length, 2);
  for (const call of calls) {
    match(String(call.body.p_key), /^[0-9a-f]{64}$/);
    ok(!JSON.stringify(call.body).includes("192.0.2.4"));
  }
  ok(calls[0].body.p_key !== calls[1].body.p_key);
});

Deno.test("wrong CAPTCHA action, hostname and replay block the database claim", async () => {
  for (
    const proof of [{ ...captcha, action: "other" }, {
      ...captcha,
      hostname: "wrong.example",
    }, {
      success: false,
      "error-codes": ["timeout-or-duplicate"],
    }]
  ) {
    const { fetcher, calls } = upstream({
      "/rest/v1/rpc/puebla_rate_limit": true,
      "/turnstile/v0/siteverify": proof,
    });
    const response = await createHandler("public", env, fetcher)(
      request(claim),
    );
    equal(response.status, 400);
    deepEqual(await response.json(), { error: "captcha_failed" });
    equal(calls.length, 2);
  }
});

Deno.test("a valid challenge reaches PostgreSQL with the normalized HMAC and returns only the assigned code", async () => {
  const { fetcher, calls } = upstream({
    "/rest/v1/rpc/puebla_rate_limit": true,
    "/turnstile/v0/siteverify": captcha,
    "/rest/v1/rpc/puebla_claim": {
      status: "recovered",
      platform: "ios",
      code,
      other: "private",
    },
  });
  const response = await createHandler("public", env, fetcher)(request(claim));
  equal(response.status, 200);
  equal(response.headers.get("Cache-Control"), "no-store");
  deepEqual(await response.json(), {
    status: "recovered",
    platform: "ios",
    code,
  });
  const assignment = calls.at(-1)!;
  equal(assignment.headers.get("apikey"), "sb_secret_test");
  equal(assignment.headers.get("Authorization"), null);
  equal(assignment.body.p_platform, "android");
  equal(assignment.body.p_campaign_id, "puebla2026");
  const reference = await import("node:crypto");
  equal(
    assignment.body.p_token_hash,
    reference.createHmac("sha256", env.PUEBLA_PIN_PEPPER)
      .update("0123456789ABCDEF").digest("hex"),
  );
});

Deno.test("each privileged action fails before any mutation for unauthenticated and unlisted callers", async () => {
  const { fetcher, calls } = upstream({
    "/auth/v1/user": (call: Call) =>
      call.headers.get("Authorization") === "Bearer valid-test-jwt"
        ? { id: actor }
        : Response.json({}, { status: 401 }),
    "/rest/v1/rpc/puebla_is_admin": false,
  });
  const handle = createHandler("admin", env, fetcher);
  const actions = [
    "stats",
    "import",
    "create_invitations",
    "update_campaign",
    "revoke_invitation",
    "verify_redemption",
    "logs",
    "invitations",
  ];
  for (const action of actions) {
    equal((await handle(request({ action }))).status, 401);
    equal(
      (await handle(
        request({ action }, { Authorization: "Bearer forged-test-jwt" }),
      )).status,
      401,
    );
    equal(
      (await handle(
        request({ action }, { Authorization: "Bearer valid-test-jwt" }),
      )).status,
      403,
    );
  }
  equal(
    calls.filter((call) => call.path === "/auth/v1/user").length,
    actions.length * 2,
  );
  equal(
    calls.filter((call) => call.path === "/rest/v1/rpc/puebla_is_admin").length,
    actions.length,
  );
});

Deno.test("admin input is bounded and only the authenticated user ID becomes the actor", async () => {
  const { fetcher, calls } = upstream({
    "/auth/v1/user": { id: actor },
    "/rest/v1/rpc/puebla_is_admin": true,
    "/rest/v1/rpc/puebla_admin": { inserted: 1, duplicates: 1 },
  });
  const handle = createHandler("admin", env, fetcher);
  const headers = { Authorization: "Bearer valid-test-jwt" };
  const body = {
    action: "import",
    platform: "ios",
    actor: "spoofed",
    codes: [code.toLowerCase(), code],
  };
  equal(
    (await handle(request({ ...body, codes: Array(501).fill(code) }, headers)))
      .status,
    400,
  );
  equal(
    (await handle(
      request({ ...body, codes: ["https://invalid.test"] }, headers),
    )).status,
    400,
  );
  equal(
    (await handle(request({ ...body, codes: ["x".repeat(65_536)] }, headers)))
      .status,
    413,
  );
  const response = await handle(request(body, headers));
  deepEqual(await response.json(), { inserted: 1, duplicates: 1 });
  const imports = calls.filter((call) =>
    call.path === "/rest/v1/rpc/puebla_admin"
  );
  equal(imports.length, 1);
  deepEqual(imports[0].body, {
    p_actor: actor,
    p_campaign_id: "puebla2026",
    p_action: "import",
    p_payload: { platform: "ios", codes: [code, code] },
  });
});

Deno.test("generated invitations export only inserted PINs and send only hashes to storage", async () => {
  const { fetcher } = upstream({
    "/auth/v1/user": { id: actor },
    "/rest/v1/rpc/puebla_is_admin": true,
    "/rest/v1/rpc/puebla_admin": ({ body }: Call) => {
      const { token_hashes: hashes } = body.p_payload as {
        token_hashes: string[];
      };
      equal(hashes.length, 2);
      equal(new Set(hashes).size, 2);
      hashes.forEach((hash) => match(hash, /^[0-9a-f]{64}$/));
      return { created: [{ id: actor, token_hash: hashes[0] }], duplicates: 1 };
    },
  });
  const response = await createHandler("admin", env, fetcher)(
    request({ action: "create_invitations", count: 2 }, {
      Authorization: "Bearer valid-test-jwt",
    }),
  );
  const { pins, duplicates } = await response.json();
  equal(pins.length, 1);
  equal(duplicates, 1);
  equal(pins[0].id, actor);
  match(pins[0].pin, /^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  deepEqual(Object.keys(pins[0]), ["id", "pin"]);
});
