-- Data-preserving hardening. Existing profiles and files are retained.
begin;

-- Profile admission and invite consumption must succeed atomically. In the old
-- client sequence, profile INSERT bypassed invites, and consuming first could
-- fail the used_by -> users foreign key for a new account.
create function private.provision_invited_profile() returns setof public.users
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  account auth.users%rowtype;
  invitation public.invite_keys%rowtype;
  code text;
  display_name text;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  -- Serialize simultaneous hydration requests for the same account.
  select * into account from auth.users where id = actor for update;
  if not found or account.email_confirmed_at is null then
    raise exception 'A verified email is required';
  end if;
  if exists (select 1 from public.users where id = actor) then
    return query select * from public.users where id = actor;
    return;
  end if;
  code := upper(regexp_replace(trim(account.raw_user_meta_data->>'invite_key'), '\s+', '', 'g'));
  display_name := trim(account.raw_user_meta_data->>'full_name');
  if display_name is null or length(display_name) not between 1 and 100 then
    raise exception 'A name between 1 and 100 characters is required';
  end if;
  select * into invitation from public.invite_keys where key_code = code for update;
  if not found or coalesce(invitation.is_used, false)
    or (invitation.expires_at is not null and invitation.expires_at <= now()) then
    raise exception 'A valid unused invitation is required';
  end if;
  insert into public.users (id, full_name, email, role)
  values (actor, display_name, account.email, 'member');
  update public.invite_keys set is_used = true, used_by = actor, used_at = now()
  where id = invitation.id;
  return query select * from public.users where id = actor;
end;
$$;
revoke all on function private.provision_invited_profile() from public, anon, authenticated;
grant execute on function private.provision_invited_profile() to authenticated;
create function public.provision_invited_profile() returns setof public.users
language sql security invoker set search_path = '' as $$
  select * from private.provision_invited_profile();
$$;
revoke all on function public.provision_invited_profile() from public, anon, authenticated;
grant execute on function public.provision_invited_profile() to authenticated;
revoke insert on public.users from authenticated;
drop policy if exists users_insert on public.users;
-- Consumption is now only possible inside the atomic admission operation.
revoke execute on function public.consume_invite_key(text, uuid) from authenticated;
revoke execute on function private.consume_invite_key(text, uuid) from authenticated;

-- Browser-side accept/size checks can be bypassed with direct HTTP requests.
update storage.buckets
set public = false, file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id in ('avatars', 'receipts');

-- Check existing values before deploying; NOT VALID avoids changing legacy rows
-- while still enforcing these constraints for all new writes.
alter table public.expenses add constraint expenses_finite_amount
  check (amount <> 'NaN'::numeric) not valid;
alter table public.settlements add constraint settlements_valid_payment
  check (group_id is not null and paid_by is not null and paid_to is not null
    and paid_by <> paid_to and amount > 0 and amount <> 'NaN'::numeric) not valid;
alter table public.expense_splits add constraint splits_valid_amounts
  check (expense_id is not null and user_id is not null
    and amount_owed >= 0 and amount_owed <> 'NaN'::numeric
    and (amount_paid is null or (amount_paid >= 0 and amount_paid <= amount_owed))) not valid;

-- An expense manager cannot assign a share to an unrelated account.
alter policy expense_splits_insert on public.expense_splits with check (
  private.current_user_can_manage_expense(expense_id)
  and exists (select 1 from public.expenses e join public.group_members m
    on m.group_id = e.group_id where e.id = expense_id and m.user_id = expense_splits.user_id)
);
alter policy expense_splits_update on public.expense_splits with check (
  private.current_user_can_manage_expense(expense_id)
  and exists (select 1 from public.expenses e join public.group_members m
    on m.group_id = e.group_id where e.id = expense_id and m.user_id = expense_splits.user_id)
);

-- These policies existed remotely but were absent from the recovery baseline.
drop policy if exists settlements_select on public.settlements;
create policy settlements_select on public.settlements for select to authenticated
using (private.current_user_is_admin() or private.current_user_owns_group(group_id)
  or private.current_user_is_group_member(group_id));
drop policy if exists settlements_insert on public.settlements;
create policy settlements_insert on public.settlements for insert to authenticated
with check (paid_to = (select auth.uid()) and paid_by <> paid_to
  and private.current_user_is_group_member(group_id)
  and exists (select 1 from public.group_members m
    where m.group_id = settlements.group_id and m.user_id = settlements.paid_by));
drop policy if exists settlements_delete on public.settlements;
create policy settlements_delete on public.settlements for delete to authenticated
using (private.current_user_is_admin() or private.current_user_owns_group(group_id));

-- Apply to direct INSERTs as well as the batch RPC. A receiver cannot invent a
-- payment larger than the payer's debt or the receiver's credit. Group locking
-- serializes competing payment confirmations, including repeated submissions.
create function private.validate_settlement_balance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare payer_net numeric; receiver_net numeric;
begin
  if new.amount is null or new.amount <= 0 or new.amount = 'NaN'::numeric then
    raise exception 'Payment amount must be finite and positive';
  end if;
  if auth.uid() is null or new.paid_to is distinct from auth.uid()
    or new.paid_by is not distinct from new.paid_to
    or not private.current_user_is_group_member(new.group_id)
    or not exists (select 1 from public.group_members where group_id = new.group_id and user_id = new.paid_by) then
    raise exception 'Only a group payment receiver can confirm a payment';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.group_id::text, 0));
  if exists (select 1 from public.expenses e left join public.expense_splits s on s.expense_id = e.id
    where e.group_id = new.group_id group by e.id, e.amount
    having coalesce(sum(s.amount_owed), 0) <> e.amount) then
    raise exception 'Expense shares must balance before recording payments';
  end if;
  with entries as (
    select added_by as user_id, amount as delta from public.expenses where group_id = new.group_id
    union all select s.user_id, -s.amount_owed from public.expense_splits s
      join public.expenses e on e.id = s.expense_id where e.group_id = new.group_id
    union all select paid_by, amount from public.settlements where group_id = new.group_id
    union all select paid_to, -amount from public.settlements where group_id = new.group_id
  ) select coalesce(sum(delta) filter (where user_id = new.paid_by), 0),
           coalesce(sum(delta) filter (where user_id = new.paid_to), 0)
    into payer_net, receiver_net from entries;
  if new.amount > least(-payer_net, receiver_net) then
    raise exception 'Payment exceeds the current outstanding balance';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_settlement_balance() from public, anon, authenticated;
create trigger validate_settlement_balance before insert on public.settlements
for each row execute function private.validate_settlement_balance();

notify pgrst, 'reload schema';
commit;
