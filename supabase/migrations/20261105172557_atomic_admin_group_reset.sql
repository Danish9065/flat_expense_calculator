begin;
set local lock_timeout = '15s';
set local statement_timeout = '60s';

-- Preserve former-member edits/charges protection while allowing explicit admin deletion.
create or replace function private.protect_expense_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare gid uuid; eid uuid;
begin
  if tg_table_name='expenses' then
    gid := coalesce(new.group_id,old.group_id); eid := coalesce(new.id,old.id);
  else
    eid := coalesce(new.expense_id,old.expense_id);
    select group_id into gid from public.expenses where id=eid;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(gid::text,0));
  if tg_table_name='expenses' then
    -- Only administrators may explicitly delete frozen expenses. Updates remain protected.
    if tg_op='DELETE' and private.current_user_is_admin() then return old; end if;
    if tg_op='INSERT' and not exists (select 1 from public.group_members where group_id=gid and user_id=new.added_by) then
      raise exception 'New expenses require an active group member';
    end if;
    if tg_op <> 'INSERT' and private.expense_has_former_member(eid) and (
      tg_op='DELETE' or new.amount is distinct from old.amount
      or new.added_by is distinct from old.added_by or new.group_id is distinct from old.group_id
    ) then raise exception 'Former member expense amounts and shares are read-only'; end if;
  else
    if tg_op='UPDATE' and (new.expense_id is distinct from old.expense_id or new.user_id is distinct from old.user_id) then
      raise exception 'An assigned share cannot be moved';
    end if;
    if private.expense_has_former_member(eid) then
      raise exception 'Former member expense amounts and shares are read-only';
    end if;
    if tg_op <> 'DELETE' and not exists (select 1 from public.group_members where group_id=gid and user_id=new.user_id) then
      raise exception 'New shares require an active group member';
    end if;
  end if;
  return coalesce(new,old);
end;
$$;

create or replace function private.protect_payment_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(old.group_id::text,0));
  if private.current_user_is_admin() then return old; end if;
  if not exists(select 1 from public.group_members where group_id=old.group_id and user_id=old.paid_by)
    or not exists(select 1 from public.group_members where group_id=old.group_id and user_id=old.paid_to) then
    raise exception 'Former member payment history is read-only';
  end if;
  return old;
end;
$$;

-- Caller RLS remains active. No security-definer or client-controlled bypass flag.
create function public.reset_group_expenses(p_group_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if not private.current_user_is_admin() then raise exception 'Administrator access required'; end if;
  if p_group_id is null then raise exception 'Choose a group to reset'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_group_id::text,0));
  perform 1 from public.groups where id=p_group_id for update;
  if not found then raise exception 'Group not found'; end if;
  delete from public.settlements where group_id=p_group_id;
  -- Shares cascade only through the deleted expense IDs, never through user IDs.
  delete from public.expenses where group_id=p_group_id;
end;
$$;
revoke all on function public.reset_group_expenses(uuid) from public,anon,authenticated;
grant execute on function public.reset_group_expenses(uuid) to authenticated;

create function public.delete_group_expense(p_group_id uuid,p_expense_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if p_group_id is null or p_expense_id is null then raise exception 'Choose an expense and group'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_group_id::text,0));
  delete from public.expenses where id=p_expense_id and group_id=p_group_id;
  if not found then raise exception 'Expense not found or deletion denied'; end if;
end;
$$;
revoke all on function public.delete_group_expense(uuid,uuid) from public,anon,authenticated;
grant execute on function public.delete_group_expense(uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
