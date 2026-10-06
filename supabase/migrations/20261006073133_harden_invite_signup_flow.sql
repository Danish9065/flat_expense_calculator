create or replace function private.invite_key_status(key_code_param text) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when not exists (
      select 1 from public.invite_keys
      where key_code = upper(regexp_replace(trim(key_code_param), '\s+', '', 'g'))
    ) then 'invalid'
    when exists (
      select 1 from public.invite_keys
      where key_code = upper(regexp_replace(trim(key_code_param), '\s+', '', 'g'))
        and coalesce(is_used, false)
    ) then 'used'
    when exists (
      select 1 from public.invite_keys
      where key_code = upper(regexp_replace(trim(key_code_param), '\s+', '', 'g'))
        and expires_at is not null and expires_at <= now()
    ) then 'expired'
    else 'available'
  end;
$$;

revoke all on function private.invite_key_status(text) from public, anon, authenticated;
grant execute on function private.invite_key_status(text) to anon, authenticated;

create or replace function private.validate_invite_key(key_code_param text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.invite_key_status(key_code_param) = 'available';
$$;

create or replace function private.consume_invite_key(key_code_param text, target_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  normalized_key text := upper(regexp_replace(trim(key_code_param), '\s+', '', 'g'));
  current_used_by uuid;
  current_is_used boolean;
  current_expires_at timestamptz;
begin
  if (select auth.uid()) is null or target_user_id <> (select auth.uid()) then
    raise exception 'Invite keys can only be consumed for the authenticated user';
  end if;

  select used_by, coalesce(is_used, false), expires_at
  into current_used_by, current_is_used, current_expires_at
  from public.invite_keys
  where key_code = normalized_key
  for update;

  if not found then raise exception 'Invalid invite key'; end if;
  if current_is_used and current_used_by = target_user_id then return; end if;
  if current_is_used then raise exception 'Invite key has already been used'; end if;
  if current_expires_at is not null and current_expires_at <= now() then
    raise exception 'Invite key has expired';
  end if;

  update public.invite_keys
  set is_used = true, used_by = target_user_id, used_at = now()
  where key_code = normalized_key;
end;
$$;

create or replace function public.invite_key_status(key_code_param text) returns text
language sql stable security invoker set search_path = '' as $$
  select private.invite_key_status(key_code_param);
$$;

revoke all on function public.invite_key_status(text) from public, anon, authenticated;
grant execute on function public.invite_key_status(text) to anon, authenticated;
