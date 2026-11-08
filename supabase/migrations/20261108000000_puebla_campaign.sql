create schema puebla_private;
revoke all on schema puebla_private from public, anon, authenticated, service_role;

create table puebla_private.campaigns (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  name text not null check (length(name) between 1 and 120),
  starts_at timestamptz not null check (isfinite(starts_at)),
  ends_at timestamptz not null check (isfinite(ends_at)),
  timezone text not null default 'America/Mexico_City' check (timezone = 'America/Mexico_City'),
  enabled boolean not null default false,
  android_enabled boolean not null default true,
  ios_enabled boolean not null default true,
  delivery_limit integer check (delivery_limit between 0 and 1000000),
  android_limit integer check (android_limit between 0 and 1000000),
  ios_limit integer check (ios_limit between 0 and 1000000),
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create table puebla_private.invitations (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null references puebla_private.campaigns (id),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'unused' check (status in ('unused', 'used', 'revoked')),
  assigned_code_id uuid unique,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  unique (campaign_id, token_hash),
  unique (campaign_id, id, assigned_code_id),
  check (
    (status = 'used' and assigned_code_id is not null and used_at is not null)
    or (status <> 'used' and assigned_code_id is null and used_at is null)
  )
);

create table puebla_private.promotional_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9-]{3,63}$'),
  platform text not null check (platform in ('android', 'ios')),
  campaign_id text not null references puebla_private.campaigns (id),
  status text not null default 'available'
    check (status in ('available', 'assigned', 'redeemed_verified', 'expired', 'disabled')),
  assigned_at timestamptz,
  assigned_to uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, id, assigned_to),
  check ((assigned_at is null) = (assigned_to is null)),
  check (status = 'expired' or (status in ('assigned', 'redeemed_verified')) = (assigned_at is not null)),
  -- Both references must agree on the invitation, code and campaign at commit.
  foreign key (campaign_id, assigned_to, id)
    references puebla_private.invitations (campaign_id, id, assigned_code_id)
    deferrable initially deferred
);

alter table puebla_private.invitations add constraint invitation_assigned_code_fkey
  foreign key (campaign_id, assigned_code_id, id)
  references puebla_private.promotional_codes (campaign_id, id, assigned_to)
  deferrable initially deferred;

create index puebla_available_codes on puebla_private.promotional_codes (campaign_id, platform, created_at, id)
  where status = 'available';
create index puebla_delivered_codes on puebla_private.promotional_codes (campaign_id, platform, assigned_at)
  where assigned_at is not null;
create index puebla_invitation_page on puebla_private.invitations (campaign_id, created_at desc, id desc);

create table puebla_private.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table puebla_private.audit_logs (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null references puebla_private.campaigns (id),
  action text not null,
  actor_id uuid references auth.users (id) on delete set null,
  platform text check (platform in ('android', 'ios')),
  invitation_id uuid,
  code_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index puebla_audit_page on puebla_private.audit_logs (campaign_id, created_at desc, id desc);

create table puebla_private.rate_limits (
  scope text not null,
  key_hash text not null,
  hits integer not null check (hits > 0),
  expires_at timestamptz not null,
  primary key (scope, key_hash)
);

create index puebla_rate_limits_expiration on puebla_private.rate_limits (expires_at);

alter table puebla_private.campaigns enable row level security;
alter table puebla_private.invitations enable row level security;
alter table puebla_private.promotional_codes enable row level security;
alter table puebla_private.admin_users enable row level security;
alter table puebla_private.audit_logs enable row level security;
alter table puebla_private.rate_limits enable row level security;
revoke all on all tables in schema puebla_private from public, anon, authenticated, service_role;

insert into puebla_private.campaigns (id, name, starts_at, ends_at)
values (
  'puebla2026', 'InnovaTecNM Nacional Puebla 2026',
  timestamp '2026-11-22 00:00' at time zone 'America/Mexico_City',
  timestamp '2026-11-28 00:00' at time zone 'America/Mexico_City'
);

create function puebla_private.campaign_availability(
  p_campaign puebla_private.campaigns, p_platform text, p_now timestamptz
)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_available bigint;
  v_delivered bigint;
  v_platform_delivered bigint;
  v_platform_limit integer;
begin
  if p_now < p_campaign.starts_at then
    return jsonb_build_object('status', 'upcoming', 'available', 0);
  end if;
  if p_now >= p_campaign.ends_at then
    return jsonb_build_object('status', 'ended', 'available', 0);
  end if;
  if not p_campaign.enabled
    or (p_platform = 'android' and not p_campaign.android_enabled)
    or (p_platform = 'ios' and not p_campaign.ios_enabled) then
    return jsonb_build_object('status', 'paused', 'available', 0);
  end if;

  select count(*) into v_available
  from puebla_private.promotional_codes
  where campaign_id = p_campaign.id and platform = p_platform and status = 'available';

  v_platform_limit := case p_platform when 'android' then p_campaign.android_limit else p_campaign.ios_limit end;
  if p_campaign.delivery_limit is not null or v_platform_limit is not null then
    select count(*), count(*) filter (where platform = p_platform)
    into v_delivered, v_platform_delivered
    from puebla_private.promotional_codes
    where campaign_id = p_campaign.id and assigned_at is not null;

    v_available := greatest(0, least(
      v_available, p_campaign.delivery_limit - v_delivered, v_platform_limit - v_platform_delivered
    ));
  end if;

  return jsonb_build_object(
    'status', case when v_available > 0 then 'available' else 'sold_out' end,
    'available', v_available
  );
end;
$$;

create function public.puebla_availability(p_campaign_id text, p_platform text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_campaign puebla_private.campaigns;
begin
  if p_platform is null or p_platform not in ('android', 'ios') then
    raise exception using errcode = '22023', message = 'invalid_platform';
  end if;
  select * into v_campaign from puebla_private.campaigns where id = p_campaign_id;
  if not found then
    raise exception using errcode = '22023', message = 'invalid_campaign';
  end if;
  return puebla_private.campaign_availability(v_campaign, p_platform, statement_timestamp());
end;
$$;

create function public.puebla_claim(p_campaign_id text, p_platform text, p_token_hash text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_campaign puebla_private.campaigns;
  v_invitation puebla_private.invitations;
  v_code puebla_private.promotional_codes;
  v_status text;
  v_now timestamptz;
begin
  if p_platform is null or p_platform not in ('android', 'ios')
    or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_claim';
  end if;
  if not exists (select from puebla_private.campaigns where id = p_campaign_id) then
    raise exception using errcode = '22023', message = 'invalid_campaign';
  end if;

  -- A retry waits for the first transaction and can then return the same code.
  select * into v_invitation
  from puebla_private.invitations
  where campaign_id = p_campaign_id and token_hash = p_token_hash
  for update;

  if not found or v_invitation.status = 'revoked' then
    insert into puebla_private.audit_logs (campaign_id, action, platform, details)
    values (p_campaign_id, 'claim_rejected', p_platform, jsonb_build_object('reason', 'invalid_invitation'));
    return jsonb_build_object('status', 'invalid_invitation');
  end if;

  if v_invitation.status = 'used' then
    select * into strict v_code from puebla_private.promotional_codes where id = v_invitation.assigned_code_id;
    return jsonb_build_object('status', 'recovered', 'code', v_code.code, 'platform', v_code.platform);
  end if;

  -- Serialize new assignments and campaign changes for this campaign. The next
  -- transaction sees committed inventory and limits even if only one code remains.
  select * into strict v_campaign
  from puebla_private.campaigns where id = p_campaign_id for no key update;
  v_now := clock_timestamp();
  v_status := puebla_private.campaign_availability(v_campaign, p_platform, v_now)->>'status';
  if v_status <> 'available' then
    insert into puebla_private.audit_logs (campaign_id, action, platform, details)
    values (p_campaign_id, 'claim_rejected', p_platform, jsonb_build_object('reason', v_status));
    return jsonb_build_object('status', v_status);
  end if;

  select * into strict v_code
  from puebla_private.promotional_codes
  where campaign_id = p_campaign_id and platform = p_platform and status = 'available'
  order by created_at, id limit 1
  for update;

  update puebla_private.promotional_codes
  set status = 'assigned', assigned_at = v_now, assigned_to = v_invitation.id, updated_at = v_now
  where id = v_code.id;

  update puebla_private.invitations
  set status = 'used', assigned_code_id = v_code.id, used_at = v_now
  where id = v_invitation.id;

  insert into puebla_private.audit_logs (campaign_id, action, platform, invitation_id, code_id)
  values (p_campaign_id, 'assigned', p_platform, v_invitation.id, v_code.id);

  return jsonb_build_object('status', 'assigned', 'code', v_code.code, 'platform', v_code.platform);
end;
$$;

create function public.puebla_rate_limit(p_scope text, p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_allowed boolean;
begin
  if p_scope is null or p_scope !~ '^[a-z0-9][a-z0-9_:-]{0,99}$'
    or p_key is null or p_key !~ '^[0-9a-f]{64}$'
    or p_limit is null or p_limit not between 1 and 1000000
    or p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception using errcode = '22023', message = 'invalid_rate_limit';
  end if;

  insert into puebla_private.rate_limits as bucket (scope, key_hash, hits, expires_at)
  values (p_scope, p_key, 1, v_now + make_interval(secs => p_window_seconds))
  on conflict (scope, key_hash) do update
    set hits = case when bucket.expires_at <= v_now then 1 else bucket.hits + 1 end,
        expires_at = case when bucket.expires_at <= v_now then excluded.expires_at else bucket.expires_at end
    where bucket.expires_at <= v_now or bucket.hits < p_limit
  returning true into v_allowed;

  -- Bounded opportunistic cleanup. Skip buckets being updated by other requests.
  delete from puebla_private.rate_limits
  where (scope, key_hash) in (
    select scope, key_hash from puebla_private.rate_limits where expires_at <= v_now
    order by expires_at limit 50 for update skip locked
  );

  return coalesce(v_allowed, false);
end;
$$;

create function public.puebla_is_admin(p_actor uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select from puebla_private.admin_users where user_id = p_actor);
$$;

create function public.puebla_audit_error(p_campaign_id text, p_route text)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_route is null or p_route not in ('public', 'admin') then
    raise exception using errcode = '22023', message = 'invalid_audit_route';
  end if;
  if not exists (select from puebla_private.campaigns where id = p_campaign_id) then
    raise exception using errcode = '22023', message = 'invalid_campaign';
  end if;

  -- One entry per campaign and route per minute, regardless of the triggering error.
  if not public.puebla_rate_limit(p_campaign_id || ':audit-error:' || p_route, repeat('0', 64), 1, 60) then
    return false;
  end if;

  insert into puebla_private.audit_logs (campaign_id, action, details)
  values (p_campaign_id, 'error', jsonb_build_object('route', p_route));
  return true;
end;
$$;

revoke all on function puebla_private.campaign_availability(puebla_private.campaigns, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.puebla_availability(text, text), public.puebla_claim(text, text, text),
  public.puebla_rate_limit(text, text, integer, integer), public.puebla_is_admin(uuid), public.puebla_audit_error(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.puebla_availability(text, text), public.puebla_claim(text, text, text),
  public.puebla_rate_limit(text, text, integer, integer), public.puebla_is_admin(uuid), public.puebla_audit_error(text, text)
  to service_role;
