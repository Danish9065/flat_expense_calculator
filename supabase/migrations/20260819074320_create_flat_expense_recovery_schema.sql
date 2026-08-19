begin;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name varchar(100) not null,
  email varchar(255) not null unique,
  avatar_url text,
  role varchar(20) default 'member' check (role in ('admin', 'member')),
  currency varchar(5) default '₹',
  created_at timestamptz default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name varchar(100) not null,
  invite_code varchar(12) not null unique,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now()
);

create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups(id) on delete cascade,
  user_id uuid references public.users(id) on delete cascade,
  joined_at timestamptz default now(),
  unique (group_id, user_id)
);

create table public.invite_keys (
  id uuid primary key default gen_random_uuid(),
  key_code varchar(12) not null unique,
  created_by uuid references public.users(id) on delete set null,
  assigned_to varchar(255),
  is_used boolean default false,
  used_by uuid references public.users(id) on delete set null,
  used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups(id) on delete cascade,
  category varchar(50) default 'General',
  item_name varchar(200) not null,
  amount numeric(10,2) not null check (amount > 0),
  added_by uuid references public.users(id) on delete cascade,
  note text,
  receipt_url text,
  is_recurring boolean default false,
  recur_type varchar(10) check (recur_type in ('weekly', 'monthly')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid references public.expenses(id) on delete cascade,
  user_id uuid references public.users(id) on delete cascade,
  amount_owed numeric(10,2) not null,
  is_settled boolean default false,
  settled_at timestamp,
  amount_paid numeric(10,2) default 0
);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups(id),
  paid_by uuid references public.users(id) on delete cascade,
  paid_to uuid references public.users(id) on delete cascade,
  amount numeric(10,2) not null,
  settled_at timestamp default now(),
  is_partial boolean default false
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  type varchar(50) not null,
  message text not null,
  is_read boolean default false,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.user_payment_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  whatsapp_number text check (whatsapp_number is null or whatsapp_number ~ '^[1-9][0-9]{7,14}$'),
  upi_id text check (upi_id is null or upi_id ~* '^[A-Z0-9._-]{2,256}@[A-Z0-9.-]{2,64}$'),
  updated_at timestamptz not null default timezone('utc', now())
);

create index idx_groups_created_by on public.groups(created_by);
create index idx_group_members_user_id on public.group_members(user_id);
create index idx_invite_keys_created_by on public.invite_keys(created_by);
create index idx_invite_keys_used_by on public.invite_keys(used_by);
create index idx_expenses_group_id on public.expenses(group_id);
create index idx_expenses_added_by on public.expenses(added_by);
create index idx_expense_splits_expense_id on public.expense_splits(expense_id);
create index idx_expense_splits_user_id on public.expense_splits(user_id);
create index idx_settlements_group_id on public.settlements(group_id);
create index idx_settlements_paid_by on public.settlements(paid_by);
create index idx_settlements_paid_to on public.settlements(paid_to);
create index idx_notifications_actor_id on public.notifications(actor_id);
create index idx_notifications_group_id on public.notifications(group_id);
create index idx_notifications_user_id on public.notifications(user_id);

create function private.current_user_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.users where id = (select auth.uid()) and role = 'admin'
  );
$$;

create function private.current_user_is_group_member(target_group_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.group_members
    where group_id = target_group_id and user_id = (select auth.uid())
  );
$$;

create function private.current_user_owns_group(target_group_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.groups
    where id = target_group_id and created_by = (select auth.uid())
  );
$$;

create function private.current_user_shares_group_with(target_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and (
    target_user_id = (select auth.uid()) or exists (
      select 1 from public.group_members mine
      join public.group_members theirs on theirs.group_id = mine.group_id
      where mine.user_id = (select auth.uid()) and theirs.user_id = target_user_id
    )
  );
$$;

create function private.current_user_can_manage_expense(target_expense_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.current_user_is_admin() or exists (
    select 1 from public.expenses
    where id = target_expense_id and (
      added_by = (select auth.uid()) or private.current_user_owns_group(group_id)
    )
  );
$$;

revoke all on function private.current_user_is_admin() from public, anon, authenticated;
revoke all on function private.current_user_is_group_member(uuid) from public, anon, authenticated;
revoke all on function private.current_user_owns_group(uuid) from public, anon, authenticated;
revoke all on function private.current_user_shares_group_with(uuid) from public, anon, authenticated;
revoke all on function private.current_user_can_manage_expense(uuid) from public, anon, authenticated;
grant execute on function private.current_user_is_admin() to authenticated;
grant execute on function private.current_user_is_group_member(uuid) to authenticated;
grant execute on function private.current_user_owns_group(uuid) to authenticated;
grant execute on function private.current_user_shares_group_with(uuid) to authenticated;
grant execute on function private.current_user_can_manage_expense(uuid) to authenticated;

create function private.validate_invite_key(key_code_param text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.invite_keys
    where key_code = upper(trim(key_code_param)) and is_used = false
      and (expires_at is null or expires_at > now())
  );
$$;

create function private.consume_invite_key(key_code_param text, target_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare changed_rows integer;
begin
  if (select auth.uid()) is null or target_user_id <> (select auth.uid()) then
    raise exception 'Invite keys can only be consumed for the authenticated user';
  end if;
  update public.invite_keys
  set is_used = true, used_by = target_user_id, used_at = now()
  where key_code = upper(trim(key_code_param)) and is_used = false
    and (expires_at is null or expires_at > now());
  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then raise exception 'Invalid or already used invite key'; end if;
end;
$$;

create function private.join_group_by_invite_code(invite_code_param text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare target_group_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select id into target_group_id from public.groups
  where invite_code = upper(trim(invite_code_param));
  if target_group_id is null then raise exception 'Invalid invite code'; end if;
  insert into public.group_members (group_id, user_id)
  values (target_group_id, (select auth.uid()))
  on conflict (group_id, user_id) do nothing;
  return target_group_id;
end;
$$;

create function private.delete_user_completely(target_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.current_user_is_admin() then raise exception 'Administrator access required'; end if;
  if target_user_id = (select auth.uid()) then raise exception 'Administrators cannot delete themselves'; end if;
  update public.groups set created_by = null where created_by = target_user_id;
  update public.invite_keys set used_by = null where used_by = target_user_id;
  update public.invite_keys set created_by = null where created_by = target_user_id;
  delete from public.settlements where paid_by = target_user_id or paid_to = target_user_id;
  delete from public.expenses where added_by = target_user_id;
  delete from public.expense_splits where user_id = target_user_id;
  delete from public.group_members where user_id = target_user_id;
  delete from public.users where id = target_user_id;
end;
$$;

revoke all on function private.validate_invite_key(text) from public, anon, authenticated;
revoke all on function private.consume_invite_key(text, uuid) from public, anon, authenticated;
revoke all on function private.join_group_by_invite_code(text) from public, anon, authenticated;
revoke all on function private.delete_user_completely(uuid) from public, anon, authenticated;
grant execute on function private.validate_invite_key(text) to anon, authenticated;
grant execute on function private.consume_invite_key(text, uuid) to authenticated;
grant execute on function private.join_group_by_invite_code(text) to authenticated;
grant execute on function private.delete_user_completely(uuid) to authenticated;

create function public.validate_invite_key(key_code_param text) returns boolean
language sql stable security invoker set search_path = '' as
$$ select private.validate_invite_key(key_code_param); $$;
create function public.consume_invite_key(key_code_param text, target_user_id uuid) returns void
language sql security invoker set search_path = '' as
$$ select private.consume_invite_key(key_code_param, target_user_id); $$;
create function public.join_group_by_invite_code(invite_code_param text) returns uuid
language sql security invoker set search_path = '' as
$$ select private.join_group_by_invite_code(invite_code_param); $$;
create function public.delete_user_completely(target_user_id uuid) returns void
language sql security invoker set search_path = '' as
$$ select private.delete_user_completely(target_user_id); $$;

create function public.record_group_settlements_batch(p_payments jsonb)
returns setof public.settlements
language plpgsql security invoker set search_path = '' as $$
declare
  payment jsonb;
  payment_group_id uuid;
  payment_debtor_id uuid;
  payment_amount numeric;
  inserted_settlement public.settlements%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then
    raise exception 'At least one payment allocation is required';
  end if;
  for payment in select value from jsonb_array_elements(p_payments) loop
    payment_group_id := (payment->>'group_id')::uuid;
    payment_debtor_id := (payment->>'debtor_id')::uuid;
    payment_amount := round((payment->>'amount')::numeric, 2);
    if payment_amount <= 0 then raise exception 'Payment amounts must be positive'; end if;
    if payment_debtor_id = (select auth.uid()) then raise exception 'Payer and receiver must be different'; end if;
    if not exists (
      select 1 from public.group_members where group_id = payment_group_id and user_id = (select auth.uid())
    ) or not exists (
      select 1 from public.group_members where group_id = payment_group_id and user_id = payment_debtor_id
    ) then raise exception 'Both payment parties must belong to the source group'; end if;
    insert into public.settlements (group_id, paid_by, paid_to, amount, settled_at, is_partial)
    values (payment_group_id, payment_debtor_id, (select auth.uid()), payment_amount, timezone('utc', now()), false)
    returning * into inserted_settlement;
    return next inserted_settlement;
  end loop;
end;
$$;

revoke execute on function public.validate_invite_key(text) from public, authenticated;
revoke execute on function public.consume_invite_key(text, uuid) from public, anon;
revoke execute on function public.join_group_by_invite_code(text) from public, anon;
revoke execute on function public.delete_user_completely(uuid) from public, anon;
revoke execute on function public.record_group_settlements_batch(jsonb) from public, anon;
grant execute on function public.validate_invite_key(text) to anon, authenticated;
grant execute on function public.consume_invite_key(text, uuid) to authenticated;
grant execute on function public.join_group_by_invite_code(text) to authenticated;
grant execute on function public.delete_user_completely(uuid) to authenticated;
grant execute on function public.record_group_settlements_batch(jsonb) to authenticated;

alter table public.users enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.invite_keys enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.settlements enable row level security;
alter table public.notifications enable row level security;
alter table public.user_payment_profiles enable row level security;

create policy users_select on public.users for select to authenticated
using (private.current_user_is_admin() or private.current_user_shares_group_with(id));
create policy users_insert on public.users for insert to authenticated
with check (id = (select auth.uid()) and coalesce(role, 'member') = 'member');
create policy users_update on public.users for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy users_delete on public.users for delete to authenticated
using (private.current_user_is_admin() and id <> (select auth.uid()));

create policy groups_select on public.groups for select to authenticated
using (private.current_user_is_admin() or created_by = (select auth.uid()) or private.current_user_is_group_member(id));
create policy groups_insert on public.groups for insert to authenticated
with check (created_by = (select auth.uid()));
create policy groups_update on public.groups for update to authenticated
using (private.current_user_is_admin() or created_by = (select auth.uid()))
with check (private.current_user_is_admin() or created_by = (select auth.uid()));
create policy groups_delete on public.groups for delete to authenticated
using (private.current_user_is_admin() or created_by = (select auth.uid()));

create policy group_members_select on public.group_members for select to authenticated
using (private.current_user_is_admin() or private.current_user_owns_group(group_id) or private.current_user_is_group_member(group_id));
create policy group_members_insert on public.group_members for insert to authenticated
with check (private.current_user_is_admin() or (user_id = (select auth.uid()) and private.current_user_owns_group(group_id)));
create policy group_members_delete on public.group_members for delete to authenticated
using (private.current_user_is_admin() or user_id = (select auth.uid()) or private.current_user_owns_group(group_id));

create policy invite_keys_admin on public.invite_keys for all to authenticated
using (private.current_user_is_admin()) with check (private.current_user_is_admin());

create policy expenses_select on public.expenses for select to authenticated
using (private.current_user_is_admin() or private.current_user_owns_group(group_id) or private.current_user_is_group_member(group_id));
create policy expenses_insert on public.expenses for insert to authenticated
with check (added_by = (select auth.uid()) and private.current_user_is_group_member(group_id));
create policy expenses_update on public.expenses for update to authenticated
using (private.current_user_is_admin() or added_by = (select auth.uid()) or private.current_user_owns_group(group_id))
with check (private.current_user_is_admin() or added_by = (select auth.uid()) or private.current_user_owns_group(group_id));
create policy expenses_delete on public.expenses for delete to authenticated
using (private.current_user_is_admin() or added_by = (select auth.uid()) or private.current_user_owns_group(group_id));

create policy expense_splits_select on public.expense_splits for select to authenticated
using (exists (
  select 1 from public.expenses e where e.id = expense_id and (
    private.current_user_is_admin() or private.current_user_owns_group(e.group_id)
    or private.current_user_is_group_member(e.group_id)
  )
));
create policy expense_splits_insert on public.expense_splits for insert to authenticated
with check (private.current_user_can_manage_expense(expense_id));
create policy expense_splits_update on public.expense_splits for update to authenticated
using (private.current_user_can_manage_expense(expense_id))
with check (private.current_user_can_manage_expense(expense_id));
create policy expense_splits_delete on public.expense_splits for delete to authenticated
using (private.current_user_can_manage_expense(expense_id));

create policy settlements_select on public.settlements for select to authenticated
using (private.current_user_is_admin() or private.current_user_owns_group(group_id) or private.current_user_is_group_member(group_id));
create policy settlements_insert on public.settlements for insert to authenticated
with check (
  paid_to = (select auth.uid()) and paid_by <> paid_to
  and private.current_user_is_group_member(group_id)
  and exists (
    select 1 from public.group_members
    where group_id = settlements.group_id and user_id = settlements.paid_by
  )
);
create policy settlements_delete on public.settlements for delete to authenticated
using (private.current_user_is_admin() or private.current_user_owns_group(group_id));

create policy notifications_select on public.notifications for select to authenticated
using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated
using (user_id = (select auth.uid()));

create policy payment_profiles_select on public.user_payment_profiles for select to authenticated
using (user_id = (select auth.uid()) or private.current_user_shares_group_with(user_id));
create policy payment_profiles_insert on public.user_payment_profiles for insert to authenticated
with check (user_id = (select auth.uid()));
create policy payment_profiles_update on public.user_payment_profiles for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy payment_profiles_delete on public.user_payment_profiles for delete to authenticated
using (user_id = (select auth.uid()));

grant usage on schema public to anon, authenticated;
revoke all on public.users, public.groups, public.group_members, public.invite_keys,
  public.expenses, public.expense_splits, public.settlements, public.notifications,
  public.user_payment_profiles from anon, authenticated;
grant select, insert, delete on public.users to authenticated;
grant update (full_name, email, avatar_url, currency) on public.users to authenticated;
grant select, insert, delete on public.groups, public.expenses, public.notifications to authenticated;
grant update (name, invite_code) on public.groups to authenticated;
grant update (category, item_name, amount, note, receipt_url, is_recurring, recur_type, updated_at)
  on public.expenses to authenticated;
grant update (is_read) on public.notifications to authenticated;
grant select, insert, update, delete on public.group_members, public.invite_keys,
  public.expense_splits, public.settlements, public.user_payment_profiles to authenticated;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false), ('receipts', 'receipts', false)
on conflict (id) do update set name = excluded.name, public = excluded.public;

create policy "Shared members read avatars" on storage.objects for select to authenticated
using (
  bucket_id = 'avatars' and array_length(storage.foldername(name), 1) >= 1
  and private.current_user_shares_group_with(((storage.foldername(name))[1])::uuid)
);
create policy "Users upload own avatars" on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars' and ((storage.foldername(name))[1])::uuid = (select auth.uid())
  and owner_id = (select auth.uid()::text)
);
create policy "Users update own avatars" on storage.objects for update to authenticated
using (bucket_id = 'avatars' and owner_id = (select auth.uid()::text))
with check (
  bucket_id = 'avatars' and ((storage.foldername(name))[1])::uuid = (select auth.uid())
  and owner_id = (select auth.uid()::text)
);
create policy "Users delete own avatars" on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and owner_id = (select auth.uid()::text));

create policy "Group members read receipts" on storage.objects for select to authenticated
using (
  bucket_id = 'receipts' and array_length(storage.foldername(name), 1) >= 2
  and private.current_user_is_group_member(((storage.foldername(name))[1])::uuid)
);
create policy "Group members upload receipts" on storage.objects for insert to authenticated
with check (
  bucket_id = 'receipts' and array_length(storage.foldername(name), 1) >= 2
  and private.current_user_is_group_member(((storage.foldername(name))[1])::uuid)
  and ((storage.foldername(name))[2])::uuid = (select auth.uid())
  and owner_id = (select auth.uid()::text)
);
create policy "Users update own receipts" on storage.objects for update to authenticated
using (bucket_id = 'receipts' and owner_id = (select auth.uid()::text))
with check (
  bucket_id = 'receipts' and array_length(storage.foldername(name), 1) >= 2
  and private.current_user_is_group_member(((storage.foldername(name))[1])::uuid)
  and ((storage.foldername(name))[2])::uuid = (select auth.uid())
  and owner_id = (select auth.uid()::text)
);
create policy "Users delete own receipts" on storage.objects for delete to authenticated
using (bucket_id = 'receipts' and owner_id = (select auth.uid()::text));

create function private.notify_expense_action() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  member_record record;
  actor_name text;
  action_verb text;
  final_message text;
  source_group_id uuid := coalesce(new.group_id, old.group_id);
  source_actor_id uuid := coalesce(new.added_by, old.added_by);
begin
  select full_name into actor_name from public.users where id = source_actor_id;
  actor_name := coalesce(actor_name, 'A former member');
  if tg_op = 'INSERT' then action_verb := 'added a new expense:';
  elsif tg_op = 'UPDATE' then action_verb := 'updated the expense:';
  else action_verb := 'deleted the expense:';
  end if;
  final_message := actor_name || ' ' || action_verb || ' "'
    || coalesce(new.item_name, old.item_name, 'Unknown') || '" for ₹'
    || coalesce(new.amount, old.amount, 0) || '.';
  for member_record in
    select user_id from public.group_members
    where group_id = source_group_id and user_id <> source_actor_id
  loop
    insert into public.notifications (user_id, group_id, actor_id, type, message)
    values (
      member_record.user_id, source_group_id,
      case when actor_name = 'A former member' then null else source_actor_id end,
      tg_op || '_expense', final_message
    );
  end loop;
  return coalesce(new, old);
end;
$$;

create function private.notify_settlement_action() returns trigger
language plpgsql security definer set search_path = '' as $$
declare debtor_name text;
begin
  select full_name into debtor_name from public.users where id = new.paid_by;
  debtor_name := coalesce(debtor_name, 'A member');
  insert into public.notifications (user_id, group_id, actor_id, type, message)
  values (
    new.paid_to, new.group_id, new.paid_by, 'SETTLEMENT',
    debtor_name || case when new.is_partial then ' made a partial payment of ₹'
      else ' confirmed a settlement payment of ₹' end
    || round(new.amount, 2) || ' to you.'
  );
  return new;
end;
$$;

revoke all on function private.notify_expense_action() from public, anon, authenticated;
revoke all on function private.notify_settlement_action() from public, anon, authenticated;
create trigger trg_notify_expense after insert or update or delete on public.expenses
for each row execute function private.notify_expense_action();
create trigger trg_notify_settlement after insert on public.settlements
for each row execute function private.notify_settlement_action();

alter publication supabase_realtime add table
  public.users, public.groups, public.group_members, public.invite_keys,
  public.expenses, public.expense_splits, public.settlements,
  public.notifications, public.user_payment_profiles;

commit;
