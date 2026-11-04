begin;
set local lock_timeout = '15s';
set local statement_timeout = '60s';

-- Membership is access control; the ledger and its names outlive membership.
create table public.former_group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete restrict,
  full_name text not null,
  removed_at timestamptz,
  primary key (group_id, user_id)
);
create index former_group_members_user_id_idx on public.former_group_members(user_id);
alter table public.former_group_members enable row level security;
revoke all on public.former_group_members from public, anon, authenticated;
grant select on public.former_group_members to authenticated;
create policy former_members_read on public.former_group_members for select to authenticated
using (private.current_user_is_admin() or private.current_user_owns_group(group_id)
  or private.current_user_is_group_member(group_id));

-- BEGIN VERIFIED RECOVERY
-- Deployment may supply a separately reviewed audit snapshot in this session
-- setting. Private ledger values are never embedded in the public source repo.
-- No setting means schema-only installation (including clean test databases).
do $repair$
declare snapshot jsonb := nullif(current_setting('app.verified_recovery_snapshot',true),'')::jsonb;
  former_id uuid; restored_profile boolean := false; source record; target public.expenses;
  expected jsonb; had_payment_validator boolean;
begin
  if snapshot is null then return; end if;
  former_id := (snapshot->'former_user'->>'id')::uuid;
  if former_id is null or nullif(snapshot->'former_user'->>'full_name','') is null then
    raise exception 'A verified former member identity is required';
  end if;
  lock table public.users,public.group_members,public.expenses,public.expense_splits,public.settlements in share row exclusive mode;
  if not exists(select 1 from public.users where id=former_id) then
    -- Reuse the existing Auth identity and authoritative email. Never restore
    -- membership, credentials, privileges, or payment destination information.
    insert into public.users(id,full_name,email,role)
      select id,snapshot->'former_user'->>'full_name',email,'member' from auth.users where id=former_id;
    if not found then raise exception 'The original Auth identity is unavailable; manual recovery required'; end if;
    restored_profile := true;
  end if;
  alter table public.expenses disable trigger trg_notify_expense;
  alter table public.settlements disable trigger trg_notify_settlement;
  select exists(select 1 from pg_trigger where tgrelid='public.settlements'::regclass
    and tgname='validate_settlement_balance') into had_payment_validator;
  if had_payment_validator then alter table public.settlements disable trigger validate_settlement_balance; end if;
  for source in select * from jsonb_to_recordset(snapshot->'expenses') as x(
    id uuid,group_id uuid,added_by uuid,amount numeric,item_name text,category text,created_at timestamptz)
  loop
    select * into target from public.expenses where id=source.id;
    if target.id is null then
      if not restored_profile or source.added_by<>former_id then continue; end if;
      if exists(select 1 from public.expenses where group_id=source.group_id and added_by=source.added_by
        and amount=source.amount and item_name=source.item_name and created_at=source.created_at) then
        raise exception 'A possible replacement expense exists; manual recovery required';
      end if;
      insert into public.expenses(id,group_id,added_by,amount,item_name,category,created_at,updated_at)
        values(source.id,source.group_id,source.added_by,source.amount,source.item_name,source.category,source.created_at,source.created_at)
        returning * into target;
    end if;
    if (select coalesce(sum(amount_owed),0) from public.expense_splits where expense_id=target.id)=target.amount then continue; end if;
    select coalesce(jsonb_agg(value),'[]') into expected from jsonb_array_elements(snapshot->'splits') where (value->>'expense_id')::uuid=target.id;
    if target.group_id<>source.group_id or target.added_by<>source.added_by or target.amount<>source.amount
      or (select coalesce(sum(amount_owed),0) from jsonb_to_recordset(expected) x(amount_owed numeric))<>target.amount
      or exists(select 1 from public.expense_splits s where s.expense_id=target.id and not exists(
        select 1 from jsonb_to_recordset(expected) x(id uuid,user_id uuid,amount_owed numeric)
        where x.id=s.id and x.user_id=s.user_id and x.amount_owed=s.amount_owed))
      or exists(select 1 from jsonb_to_recordset(expected) x(user_id uuid)
        where not exists(select 1 from public.users u where u.id=x.user_id)) then
      raise exception 'Expense differs from the verified recovery snapshot. Manual review required; no data changed.';
    end if;
    insert into public.expense_splits(id,expense_id,user_id,amount_owed)
      select x.id,target.id,x.user_id,x.amount_owed from jsonb_to_recordset(expected) x(id uuid,user_id uuid,amount_owed numeric)
      where not exists(select 1 from public.expense_splits s where s.id=x.id);
    if (select sum(amount_owed) from public.expense_splits where expense_id=target.id)<>target.amount then
      raise exception 'Recovery did not reconcile the expense; transaction rolled back';
    end if;
  end loop;
  if restored_profile then
    for source in select * from jsonb_to_recordset(snapshot->'payments') as x(
      id uuid,group_id uuid,paid_by uuid,paid_to uuid,amount numeric,settled_at timestamp,is_partial boolean)
    loop
      if source.paid_by<>former_id and source.paid_to<>former_id then
        raise exception 'Recovery payment must involve the verified former member';
      end if;
      if not exists(select 1 from public.settlements where id=source.id) then
        if exists(select 1 from public.settlements where group_id=source.group_id and paid_by=source.paid_by
          and paid_to=source.paid_to and amount=source.amount and settled_at=source.settled_at) then
          raise exception 'A possible replacement payment exists; manual recovery required';
        end if;
        insert into public.settlements(id,group_id,paid_by,paid_to,amount,settled_at,is_partial)
          values(source.id,source.group_id,source.paid_by,source.paid_to,source.amount,source.settled_at,source.is_partial);
      end if;
    end loop;
  end if;
  if had_payment_validator then alter table public.settlements enable trigger validate_settlement_balance; end if;
  alter table public.expenses enable trigger trg_notify_expense;
  alter table public.settlements enable trigger trg_notify_settlement;
end;
$repair$;
-- END VERIFIED RECOVERY

-- Recover names of already removed members from surviving ledger references.
-- Missing financial amounts cannot be reconstructed safely by this migration.
insert into public.former_group_members(group_id,user_id,full_name)
select distinct refs.group_id, refs.user_id, u.full_name from (
  select group_id, added_by user_id from public.expenses
  union select e.group_id, s.user_id from public.expense_splits s join public.expenses e on e.id=s.expense_id
  union select group_id, paid_by from public.settlements
  union select group_id, paid_to from public.settlements
) refs join public.users u on u.id=refs.user_id
where not exists (select 1 from public.group_members m where m.group_id=refs.group_id and m.user_id=refs.user_id);

create function private.archive_group_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(old.group_id::text, 0));
  insert into public.former_group_members(group_id,user_id,full_name,removed_at)
    select old.group_id,old.user_id,full_name,now() from public.users where id=old.user_id
  on conflict (group_id,user_id) do update set full_name=excluded.full_name,removed_at=excluded.removed_at;
  return old;
end;
$$;
revoke all on function private.archive_group_membership() from public, anon, authenticated;
create trigger archive_group_membership before delete on public.group_members
for each row execute function private.archive_group_membership();
-- UPDATE could otherwise bypass the archive trigger by moving a membership.
revoke update on public.group_members from authenticated;

-- Prevent account deletion from silently cascading through financial history.
alter table public.expenses drop constraint expenses_added_by_fkey,
  add constraint expenses_added_by_fkey foreign key(added_by) references public.users(id) on delete restrict;
alter table public.expense_splits drop constraint expense_splits_user_id_fkey,
  add constraint expense_splits_user_id_fkey foreign key(user_id) references public.users(id) on delete restrict;
alter table public.settlements drop constraint settlements_paid_by_fkey,
  drop constraint settlements_paid_to_fkey,
  add constraint settlements_paid_by_fkey foreign key(paid_by) references public.users(id) on delete restrict,
  add constraint settlements_paid_to_fkey foreign key(paid_to) references public.users(id) on delete restrict;
-- The legacy RPC explicitly deletes financial records before deleting a user.
create or replace function private.delete_user_completely(target_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.current_user_is_admin() then raise exception 'Administrator access required'; end if;
  raise exception 'Account deletion is disabled to preserve financial history. Remove the member from the group instead.';
end;
$$;

create function private.expense_has_former_member(target_expense_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.expenses e where e.id=target_expense_id and (
    not exists (select 1 from public.group_members m where m.group_id=e.group_id and m.user_id=e.added_by)
    or exists (select 1 from public.expense_splits s where s.expense_id=e.id and not exists (
      select 1 from public.group_members m where m.group_id=e.group_id and m.user_id=s.user_id))
  ));
$$;
revoke all on function private.expense_has_former_member(uuid) from public, anon, authenticated;

create function private.protect_expense_history() returns trigger
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
revoke all on function private.protect_expense_history() from public, anon, authenticated;
create trigger protect_expense_history before insert or update or delete on public.expenses
for each row execute function private.protect_expense_history();
create trigger protect_split_history before insert or update or delete on public.expense_splits
for each row execute function private.protect_expense_history();

-- Match the browser's minimized immutable historical subledger. In particular,
-- a fully settled former member keeps a zero balance instead of acquiring
-- apparent unpaid direct debts after an earlier simplified payment.
create function private.historical_group_payments(gid uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare net jsonb; result jsonb := '[]'; debtor text; creditor text;
  debt bigint; credit bigint; matched bigint;
begin
  with historical_expenses as (
    select e.* from public.expenses e where e.group_id=gid and (
      not exists(select 1 from public.group_members where group_id=gid and user_id=e.added_by)
      or exists(select 1 from public.expense_splits s where s.expense_id=e.id and not exists(
        select 1 from public.group_members where group_id=gid and user_id=s.user_id)))
  ), historical_payments as (
    select s.* from public.settlements s where s.group_id=gid and (
      not exists(select 1 from public.group_members where group_id=gid and user_id=s.paid_by)
      or not exists(select 1 from public.group_members where group_id=gid and user_id=s.paid_to))
  ), entries as (
    select added_by user_id,amount delta from historical_expenses
    union all select s.user_id,-s.amount_owed from public.expense_splits s join historical_expenses e on e.id=s.expense_id
    union all select paid_by,amount from historical_payments
    union all select paid_to,-amount from historical_payments
  ), balances as (select user_id,(sum(delta)*100)::bigint cents from entries group by user_id)
  select coalesce(jsonb_object_agg(user_id,cents),'{}') into net from balances;
  if (select coalesce(sum(value::text::numeric),0) from jsonb_each(net))<>0 then
    raise exception 'Historical expense shares must balance';
  end if;
  loop
    select key,-value::text::bigint into debtor,debt from jsonb_each(net)
      where value::text::numeric<0 order by value::text::numeric,key collate "C" limit 1;
    select key,value::text::bigint into creditor,credit from jsonb_each(net)
      where value::text::numeric>0 order by value::text::numeric desc,key collate "C" limit 1;
    exit when debtor is null or creditor is null;
    matched:=least(debt,credit);
    if not exists(select 1 from public.group_members where group_id=gid and user_id=debtor::uuid)
      or not exists(select 1 from public.group_members where group_id=gid and user_id=creditor::uuid) then
      result:=result||jsonb_build_array(jsonb_build_object('from',debtor,'to',creditor,'amount',matched::numeric/100));
    end if;
    net:=jsonb_set(net,array[debtor],to_jsonb(-debt+matched));
    net:=jsonb_set(net,array[creditor],to_jsonb(credit-matched));
  end loop;
  return result;
end;
$$;
revoke all on function private.historical_group_payments(uuid) from public,anon,authenticated;

-- Both batch and direct confirmations must leave historical obligations intact.
create or replace function private.validate_settlement_balance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare payer_net numeric; receiver_net numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.group_id::text,0));
  if new.amount is null or new.amount <= 0 or new.amount = 'NaN'::numeric then
    raise exception 'Payment amount must be finite and positive';
  end if;
  if auth.uid() is null or new.paid_to is distinct from auth.uid()
    or new.paid_by is not distinct from new.paid_to
    or not private.current_user_is_group_member(new.group_id)
    or not exists (select 1 from public.group_members where group_id=new.group_id and user_id=new.paid_by) then
    raise exception 'Only an active group payment receiver can confirm a payment between active members';
  end if;
  if exists (select 1 from public.expenses e left join public.expense_splits s on s.expense_id=e.id
    where e.group_id=new.group_id group by e.id,e.amount having coalesce(sum(s.amount_owed),0)<>e.amount) then
    raise exception 'Expense shares must balance before recording payments';
  end if;
  with entries as (
    select added_by user_id,amount delta from public.expenses where group_id=new.group_id
    union all select s.user_id,-s.amount_owed from public.expense_splits s join public.expenses e on e.id=s.expense_id where e.group_id=new.group_id
    union all select paid_by,amount from public.settlements where group_id=new.group_id
    union all select paid_to,-amount from public.settlements where group_id=new.group_id
    union all select (value->>'from')::uuid,(value->>'amount')::numeric
      from jsonb_array_elements(private.historical_group_payments(new.group_id))
    union all select (value->>'to')::uuid,-(value->>'amount')::numeric
      from jsonb_array_elements(private.historical_group_payments(new.group_id))
  ) select coalesce(sum(delta) filter(where user_id=new.paid_by),0),
      coalesce(sum(delta) filter(where user_id=new.paid_to),0) into payer_net,receiver_net from entries;
  if new.amount > least(-payer_net,receiver_net) then raise exception 'Payment exceeds the current outstanding balance'; end if;
  return new;
end;
$$;
revoke all on function private.validate_settlement_balance() from public,anon,authenticated;
drop trigger if exists validate_settlement_balance on public.settlements;
create trigger validate_settlement_balance before insert on public.settlements
for each row execute function private.validate_settlement_balance();
-- Payment corrections may not change a former member's frozen history.
revoke update on public.settlements from authenticated;
create function private.protect_payment_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(old.group_id::text,0));
  if not exists(select 1 from public.group_members where group_id=old.group_id and user_id=old.paid_by)
    or not exists(select 1 from public.group_members where group_id=old.group_id and user_id=old.paid_to) then
    raise exception 'Former member payment history is read-only';
  end if;
  return old;
end;
$$;
revoke all on function private.protect_payment_history() from public,anon,authenticated;
create trigger protect_payment_history before delete on public.settlements
for each row execute function private.protect_payment_history();

-- One RPC commits the expense and all shares together. Runs under caller RLS.
create function public.save_expense(p_expense jsonb,p_expense_id uuid default null)
returns public.expenses language plpgsql security invoker set search_path = '' as $$
declare saved public.expenses; gid uuid; ids uuid[]; cents bigint; n integer; idx integer; member_id uuid; frozen boolean; recalculate boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_expense_id is null then gid := (p_expense->>'group_id')::uuid;
  else
    select group_id into gid from public.expenses where id=p_expense_id;
    if gid is null then raise exception 'Expense not found or access denied'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(gid::text,0));
  if p_expense_id is not null then
    select * into saved from public.expenses where id=p_expense_id for update;
    if saved.id is null then raise exception 'Expense not found or access denied'; end if;
    -- Detect frozen history using rows visible under the caller's RLS.
    select not exists(select 1 from public.group_members where group_id=gid and user_id=saved.added_by)
      or exists(select 1 from public.expense_splits s where s.expense_id=saved.id and not exists(
        select 1 from public.group_members m where m.group_id=gid and m.user_id=s.user_id)) into frozen;
  end if;
  if p_expense ? 'splitBetween' then
    if jsonb_typeof(p_expense->'splitBetween')<>'array' then raise exception 'Choose at least one split member'; end if;
    select array_agg(value::uuid order by ord) into ids from jsonb_array_elements_text(p_expense->'splitBetween') with ordinality a(value,ord);
  elsif p_expense_id is not null then
    select array_agg(user_id order by user_id) into ids from public.expense_splits where expense_id=p_expense_id;
  else select array_agg(user_id order by user_id) into ids from public.group_members where group_id=gid;
  end if;
  if coalesce(array_length(ids,1),0)=0 then raise exception 'Choose at least one split member'; end if;
  if (select count(distinct x) from unnest(ids) x)<>array_length(ids,1) then raise exception 'Duplicate split member'; end if;
  recalculate := p_expense_id is null
    or (p_expense ? 'amount' and (p_expense->>'amount')::numeric is distinct from saved.amount)
    or exists(select unnest(ids) except select user_id from public.expense_splits where expense_id=p_expense_id)
    or exists(select user_id from public.expense_splits where expense_id=p_expense_id except select unnest(ids));
  if frozen then
    if (p_expense ? 'amount' and (p_expense->>'amount')::numeric<>saved.amount)
      or exists(select unnest(ids) except select user_id from public.expense_splits where expense_id=saved.id)
      or exists(select user_id from public.expense_splits where expense_id=saved.id except select unnest(ids)) then
      raise exception 'Former member expense amounts and shares are read-only';
    end if;
  elsif exists(select 1 from unnest(ids) x where not exists(select 1 from public.group_members where group_id=gid and user_id=x)) then
    raise exception 'New shares require an active group member';
  end if;
  if p_expense_id is null then
    if (p_expense->>'added_by')::uuid is distinct from auth.uid() then raise exception 'Expense payer must be the authenticated member'; end if;
    insert into public.expenses(group_id,added_by,item_name,amount,category,note,receipt_url,is_recurring,recur_type)
      values(gid,auth.uid(),p_expense->>'item_name',(p_expense->>'amount')::numeric,
        coalesce(p_expense->>'category','General'),p_expense->>'note',p_expense->>'receipt_url',
        coalesce((p_expense->>'is_recurring')::boolean,false),p_expense->>'recur_type') returning * into saved;
  else
    update public.expenses set item_name=coalesce(p_expense->>'item_name',item_name),
      amount=coalesce((p_expense->>'amount')::numeric,amount), category=coalesce(p_expense->>'category',category),
      note=case when p_expense ? 'note' then p_expense->>'note' else note end,
      receipt_url=case when p_expense ? 'receipt_url' then p_expense->>'receipt_url' else receipt_url end,
      is_recurring=coalesce((p_expense->>'is_recurring')::boolean,is_recurring),
      recur_type=case when p_expense ? 'recur_type' then p_expense->>'recur_type' else recur_type end,updated_at=now()
    where id=p_expense_id returning * into saved;
    if saved.id is null then raise exception 'Expense not found or access denied'; end if;
  end if;
  if recalculate and not coalesce(frozen,false) then
    delete from public.expense_splits where expense_id=saved.id;
    cents := round(saved.amount*100); n := array_length(ids,1);
    -- Remainder order matches the browser: payer first, then supplied order.
    select array_agg(x order by (x=saved.added_by) desc,ord) into ids from unnest(ids) with ordinality a(x,ord);
    idx := 0;
    foreach member_id in array ids loop
      insert into public.expense_splits(expense_id,user_id,amount_owed)
        values(saved.id,member_id,((cents/n)+case when idx<cents%n then 1 else 0 end)::numeric/100);
      idx := idx+1;
    end loop;
  end if;
  return saved;
end;
$$;
revoke all on function public.save_expense(jsonb,uuid) from public,anon;
grant execute on function public.save_expense(jsonb,uuid) to authenticated;
create function private.verify_expense_shares() returns trigger
language plpgsql security definer set search_path = '' as $$
declare eid uuid;
begin
  if tg_table_name='expenses' then eid:=coalesce(new.id,old.id);
  else eid:=coalesce(new.expense_id,old.expense_id); end if;
  if exists(select 1 from public.expenses e where e.id=eid and e.amount<>(
    select coalesce(sum(s.amount_owed),0) from public.expense_splits s where s.expense_id=e.id)) then
    raise exception 'Expense shares must balance before saving';
  end if;
  if exists(select 1 from public.expense_splits where expense_id=eid group by user_id having count(*)>1) then
    raise exception 'Duplicate assigned shares are not allowed';
  end if;
  return null;
end;
$$;
revoke all on function private.verify_expense_shares() from public,anon,authenticated;
create constraint trigger verify_expense_shares after insert or update on public.expenses
  deferrable initially deferred for each row execute function private.verify_expense_shares();
create constraint trigger verify_split_total after insert or update or delete on public.expense_splits
  deferrable initially deferred for each row execute function private.verify_expense_shares();
notify pgrst, 'reload schema';
commit;
