create function puebla_private.admin_stats(p_campaign_id text)
returns jsonb
language sql stable
set search_path = ''
as $$
  with inventory as (
    select count(*) as total,
      count(*) filter (where platform = 'android' and status = 'available') as android_available,
      count(*) filter (where platform = 'ios' and status = 'available') as ios_available,
      count(*) filter (where status = 'assigned') as assigned,
      count(*) filter (where status = 'redeemed_verified') as redeemed_verified,
      count(*) filter (where status = 'expired') as expired,
      count(*) filter (where status = 'disabled') as disabled,
      count(*) filter (where assigned_at is not null) as delivered,
      count(*) filter (where assigned_at is not null and platform = 'android') as android_delivered,
      count(*) filter (where assigned_at is not null and platform = 'ios') as ios_delivered
    from puebla_private.promotional_codes where campaign_id = p_campaign_id
  ), invitations as (
    select count(*) as total,
      count(*) filter (where status = 'unused') as unused,
      count(*) filter (where status = 'used') as used,
      count(*) filter (where status = 'revoked') as revoked
    from puebla_private.invitations where campaign_id = p_campaign_id
  ), daily as (
    select (p.assigned_at at time zone c.timezone)::date as date,
      count(*) filter (where p.platform = 'android') as android,
      count(*) filter (where p.platform = 'ios') as ios,
      count(*) as total
    from puebla_private.promotional_codes p
    join puebla_private.campaigns c on c.id = p.campaign_id
    where p.campaign_id = p_campaign_id and p.assigned_at is not null
    group by 1
  )
  select jsonb_build_object(
    'campaign', to_jsonb(c) - 'created_at',
    'codes', (to_jsonb(i) - 'android_delivered' - 'ios_delivered') || jsonb_build_object(
      'exhausted_platforms',
      (least(i.android_available, c.delivery_limit - i.delivered, c.android_limit - i.android_delivered) <= 0)::integer
      + (least(i.ios_available, c.delivery_limit - i.delivered, c.ios_limit - i.ios_delivered) <= 0)::integer
    ),
    'invitations', to_jsonb(v),
    'daily', (select coalesce(jsonb_agg(to_jsonb(daily) order by date), '[]') from daily)
  )
  from puebla_private.campaigns c cross join inventory i cross join invitations v
  where c.id = p_campaign_id;
$$;

create function puebla_private.admin_update_campaign(p_campaign_id text, p_payload jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_campaign puebla_private.campaigns;
begin
  if p_payload = '{}' or exists (
    select from jsonb_each(p_payload) as field(key, value)
    where not case
      when key in ('name', 'starts_at', 'ends_at') then jsonb_typeof(value) = 'string'
      when key in ('enabled', 'android_enabled', 'ios_enabled') then jsonb_typeof(value) = 'boolean'
      when key in ('delivery_limit', 'android_limit', 'ios_limit') then
        value = 'null' or (jsonb_typeof(value) = 'number' and value::text ~ '^[0-9]{1,7}$')
      else false
    end
  ) then
    raise exception using errcode = '22023', message = 'invalid_campaign_settings';
  end if;

  update puebla_private.campaigns c set
    name = coalesce(btrim(p_payload->>'name'), c.name),
    starts_at = coalesce((p_payload->>'starts_at')::timestamptz, c.starts_at),
    ends_at = coalesce((p_payload->>'ends_at')::timestamptz, c.ends_at),
    enabled = coalesce((p_payload->>'enabled')::boolean, c.enabled),
    android_enabled = coalesce((p_payload->>'android_enabled')::boolean, c.android_enabled),
    ios_enabled = coalesce((p_payload->>'ios_enabled')::boolean, c.ios_enabled),
    delivery_limit = case when p_payload ? 'delivery_limit' then (p_payload->>'delivery_limit')::integer else c.delivery_limit end,
    android_limit = case when p_payload ? 'android_limit' then (p_payload->>'android_limit')::integer else c.android_limit end,
    ios_limit = case when p_payload ? 'ios_limit' then (p_payload->>'ios_limit')::integer else c.ios_limit end
  where c.id = p_campaign_id
  returning c.* into strict v_campaign;

  return jsonb_build_object('campaign', to_jsonb(v_campaign) - 'created_at');
end;
$$;

create function puebla_private.admin_page(p_campaign_id text, p_action text, p_payload jsonb)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_limit integer;
  v_offset integer;
  v_status text := p_payload->>'status';
  v_rows jsonb;
  v_has_more boolean;
begin
  if (p_payload ? 'limit' and (
      jsonb_typeof(p_payload->'limit') <> 'number' or p_payload->>'limit' !~ '^[0-9]{1,3}$'
    )) or (p_payload ? 'offset' and (
      jsonb_typeof(p_payload->'offset') <> 'number' or p_payload->>'offset' !~ '^[0-9]{1,7}$'
    )) or (p_payload ? 'status' and (
      p_action <> 'invitations' or v_status is null or v_status not in ('unused', 'used', 'revoked')
    )) then
    raise exception using errcode = '22023', message = 'invalid_page';
  end if;

  v_limit := coalesce((p_payload->>'limit')::integer, 50);
  v_offset := coalesce((p_payload->>'offset')::integer, 0);
  if v_limit not between 1 and 100 or v_offset not between 0 and 1000000 then
    raise exception using errcode = '22023', message = 'invalid_page';
  end if;

  if p_action = 'logs' then
    select coalesce(jsonb_agg(to_jsonb(page) order by created_at desc, id desc), '[]'), count(*) > v_limit
    into v_rows, v_has_more
    from (
      select id, action, actor_id, platform, invitation_id, code_id, details, created_at
      from puebla_private.audit_logs where campaign_id = p_campaign_id
      order by created_at desc, id desc limit v_limit + 1 offset v_offset
    ) page;
  else
    select coalesce(jsonb_agg(to_jsonb(page) order by created_at desc, id desc), '[]'), count(*) > v_limit
    into v_rows, v_has_more
    from (
      select id, status, created_at, used_at
      from puebla_private.invitations where campaign_id = p_campaign_id and (v_status is null or status = v_status)
      order by created_at desc, id desc limit v_limit + 1 offset v_offset
    ) page;
  end if;

  if v_has_more then
    v_rows := v_rows - v_limit;
  end if;
  return jsonb_build_object(p_action, v_rows, 'has_more', v_has_more);
end;
$$;

create function public.puebla_admin(p_campaign_id text, p_actor uuid, p_action text, p_payload jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_platform text;
  v_count integer;
  v_id uuid;
  v_changed boolean;
  v_created jsonb;
  v_result jsonb;
  v_details jsonb := '{}';
begin
  if not public.puebla_is_admin(p_actor) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if not exists (select from puebla_private.campaigns where id = p_campaign_id) then
    raise exception using errcode = '22023', message = 'invalid_campaign';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'invalid_payload';
  end if;

  case p_action
    when 'stats' then return puebla_private.admin_stats(p_campaign_id);
    when 'logs', 'invitations' then return puebla_private.admin_page(p_campaign_id, p_action, p_payload);

    when 'import' then
      v_platform := p_payload->>'platform';
      if v_platform is null or v_platform not in ('android', 'ios')
        or jsonb_typeof(p_payload->'codes') is distinct from 'array' then
        raise exception using errcode = '22023', message = 'invalid_import';
      end if;
      if jsonb_array_length(p_payload->'codes') not between 1 and 500 or exists (
        select from jsonb_array_elements(p_payload->'codes') as element(item)
        where jsonb_typeof(item) <> 'string' or upper(btrim(item #>> '{}')) !~ '^[A-Z0-9][A-Z0-9-]{3,63}$'
      ) then
        raise exception using errcode = '22023', message = 'invalid_import';
      end if;

      insert into puebla_private.promotional_codes (campaign_id, platform, code)
      select p_campaign_id, v_platform, normalized.code
      from (select distinct upper(btrim(item)) as code from jsonb_array_elements_text(p_payload->'codes') as element(item)) normalized
      order by normalized.code
      on conflict (code) do nothing;
      get diagnostics v_count = row_count;
      v_result := jsonb_build_object('inserted', v_count, 'duplicates', jsonb_array_length(p_payload->'codes') - v_count);
      v_details := v_result;

    when 'create_invitations' then
      if jsonb_typeof(p_payload->'token_hashes') is distinct from 'array' then
        raise exception using errcode = '22023', message = 'invalid_invitations';
      end if;
      if jsonb_array_length(p_payload->'token_hashes') not between 1 and 200 or exists (
        select from jsonb_array_elements(p_payload->'token_hashes') as element(item)
        where jsonb_typeof(item) <> 'string' or (item #>> '{}') !~ '^[0-9a-f]{64}$'
      ) then
        raise exception using errcode = '22023', message = 'invalid_invitations';
      end if;

      with created as (
        insert into puebla_private.invitations (campaign_id, token_hash)
        select p_campaign_id, normalized.token_hash
        from (select distinct item as token_hash from jsonb_array_elements_text(p_payload->'token_hashes') as element(item)) normalized
        order by normalized.token_hash
        on conflict (campaign_id, token_hash) do nothing
        returning id, token_hash
      )
      select coalesce(jsonb_agg(to_jsonb(created)), '[]'), count(*) into v_created, v_count from created;
      v_details := jsonb_build_object('created', v_count, 'duplicates', jsonb_array_length(p_payload->'token_hashes') - v_count);
      v_result := v_details || jsonb_build_object('created', v_created);

    when 'update_campaign' then
      v_result := puebla_private.admin_update_campaign(p_campaign_id, p_payload);

    when 'revoke_invitation' then
      if p_payload->>'id' is null then
        raise exception using errcode = '22023', message = 'invalid_invitation_id';
      end if;
      v_id := (p_payload->>'id')::uuid;
      update puebla_private.invitations set status = 'revoked'
      where campaign_id = p_campaign_id and id = v_id and status = 'unused';
      v_changed := found;
      v_result := jsonb_build_object('revoked', v_changed);
      v_details := v_result;

    when 'verify_redemption' then
      if p_payload->>'id' is null then
        raise exception using errcode = '22023', message = 'invalid_code_id';
      end if;
      v_id := (p_payload->>'id')::uuid;
      update puebla_private.promotional_codes set status = 'redeemed_verified', updated_at = clock_timestamp()
      where campaign_id = p_campaign_id and id = v_id and status = 'assigned';
      v_changed := found;
      v_result := jsonb_build_object('verified', v_changed);
      v_details := v_result;

    else raise exception using errcode = '22023', message = 'invalid_action';
  end case;

  insert into puebla_private.audit_logs (campaign_id, action, actor_id, platform, invitation_id, code_id, details)
  values (p_campaign_id, p_action, p_actor, v_platform,
    case when p_action = 'revoke_invitation' and v_changed then v_id end,
    case when p_action = 'verify_redemption' and v_changed then v_id end,
    v_details);
  return v_result;
end;
$$;

revoke all on function puebla_private.admin_stats(text), puebla_private.admin_update_campaign(text, jsonb),
  puebla_private.admin_page(text, text, jsonb), public.puebla_admin(text, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.puebla_admin(text, uuid, text, jsonb) to service_role;
