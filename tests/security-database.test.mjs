import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Real PostgreSQL RLS/ACL execution, with minimal Supabase infrastructure mocks.
// Never connects to production. Each test rolls its changes back.
let db;
const owner = '11111111-1111-4111-8111-111111111111';
const member = '22222222-2222-4222-8222-222222222222';
const outsider = '33333333-3333-4333-8333-333333333333';
const newcomer = '44444444-4444-4444-8444-444444444444';
const admin = '55555555-5555-4555-8555-555555555555';
const group = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const expense = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    grant usage on schema auth, storage to anon, authenticated;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz,
      raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    create table storage.buckets (id text primary key, name text, public boolean,
      file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text,
      name text, owner_id text);
    alter table storage.objects enable row level security;
    grant select, insert, update, delete on storage.objects to authenticated;
    create function storage.foldername(text) returns text[] language sql immutable as
      $$select (string_to_array($1, '/'))[1:array_length(string_to_array($1, '/'), 1)-1]$$;
  `);
  for (const file of (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
    const sql = (await readFile(`supabase/migrations/${file}`, 'utf8'))
      .replace(/alter publication supabase_realtime add table[\s\S]*?;/gi, '');
    await db.exec(sql);
  }
  for (const id of [owner, member, outsider, newcomer, admin]) {
    await db.query(`insert into auth.users (id,email,email_confirmed_at,raw_user_meta_data)
      values ($1,$2,now(),$3)`, [id, `${id}@test.invalid`, { full_name: 'Test', invite_key: 'VALIDKEY2345', role: 'admin' }]);
    if (id !== newcomer) await db.query(`insert into public.users (id,email,full_name,role)
      values ($1,$2,'Test',$3)`, [id, `${id}@test.invalid`, id === admin ? 'admin' : 'member']);
  }
  await db.exec(`
    insert into public.groups (id,name,invite_code,created_by) values ('${group}','Test','GROUPKEY2345','${owner}');
    insert into public.group_members (group_id,user_id) values ('${group}','${owner}'),('${group}','${member}');
    insert into public.expenses (id,group_id,item_name,amount,added_by)
      values ('${expense}','${group}','Test expense',100,'${owner}');
    insert into public.expense_splits (expense_id,user_id,amount_owed)
      values ('${expense}','${owner}',50),('${expense}','${member}',50);
    insert into public.invite_keys (key_code,created_by) values ('VALIDKEY2345','${admin}');
    insert into public.user_payment_profiles (user_id,upi_id) values ('${owner}','test@bank');
    insert into storage.objects (bucket_id,name,owner_id)
      values ('receipts','${group}/${owner}/receipt.png','${owner}');
  `);
});
after(async () => { await db?.close(); });

async function asUser(id, fn, role = 'authenticated') {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id || '']);
    await db.exec(`set local role ${role}`);
    return await fn();
  } finally { await db.exec('rollback'); }
}
const denied = (sql, params = []) => assert.rejects(db.query(sql, params), /permission denied|row-level security|Authentication required|valid unused invitation|verified email|exceeds|finite and positive|check constraint|receiver can confirm|shares must balance|active group member/i);

test('anonymous visitors cannot read any application table or invoke privileged RPCs', async () => {
  for (const table of ['users','groups','group_members','invite_keys','expenses','expense_splits','settlements','notifications','user_payment_profiles']) {
    await asUser(null, () => denied(`select * from public.${table}`), 'anon');
  }
  for (const call of ['provision_invited_profile()', `delete_user_completely('${member}')`, `join_group_by_invite_code('GROUPKEY2345')`, `record_group_settlements_batch('[]')`]) {
    await asUser(null, () => denied(`select public.${call}`), 'anon');
  }
  await asUser(null, async () => {
    assert.equal((await db.query("select public.validate_invite_key('VALIDKEY2345') ok")).rows[0].ok, true);
  }, 'anon');
});

test('an unrelated authenticated user sees no group, expense, split, payment profile or receipt', async () => {
  await asUser(outsider, async () => {
    for (const table of ['groups','expenses','expense_splits','settlements','user_payment_profiles','storage.objects']) {
      assert.equal((await db.query(`select * from ${table}`)).rows.length, 0, table);
    }
    assert.equal((await db.query(`select * from users where id = '${owner}'`)).rows.length, 0);
  });
});

test('a member can read group expenses and private receipts', async () => {
  await asUser(member, async () => {
    assert.equal((await db.query('select * from expenses')).rows.length, 1);
    assert.equal((await db.query('select * from storage.objects')).rows.length, 1);
  });
});

test('forged profile insertion and role escalation are denied', async () => {
  await asUser(newcomer, () => denied(`insert into users(id,email,full_name,role) values ('${newcomer}','fake@test.invalid','Fake','admin')`));
  await asUser(newcomer, () => denied(`insert into users(id,email,full_name) values ('${newcomer}','fake@test.invalid','Fake')`));
  await asUser(member, () => denied("update users set role='admin'"));
  await asUser(member, () => denied(`update expenses set group_id=gen_random_uuid() where id='${expense}'`));
});

test('invited admission derives identity/email from Auth, never trusts metadata role, and is idempotent', async () => {
  await asUser(newcomer, async () => {
    const first = (await db.query('select * from provision_invited_profile()')).rows[0];
    assert.equal(first.id, newcomer);
    assert.equal(first.role, 'member');
    assert.equal(first.email, `${newcomer}@test.invalid`);
    assert.equal((await db.query('select * from provision_invited_profile()')).rows[0].id, newcomer);
    await db.exec('reset role');
    const key = (await db.query("select is_used,used_by from invite_keys where key_code='VALIDKEY2345'")).rows[0];
    assert.equal(key.is_used, true);
    assert.equal(key.used_by, newcomer);
  });
});

test('missing, expired and used invites and unverified accounts cannot provision profiles', async () => {
  for (const setup of [
    `update auth.users set raw_user_meta_data='{"full_name":"Test","role":"admin"}' where id='${newcomer}'`,
    "update invite_keys set expires_at=now()-interval '1 minute'",
    `update invite_keys set is_used=true,used_by='${owner}'`,
    `update auth.users set email_confirmed_at=null where id='${newcomer}'`,
  ]) {
    await db.exec('begin');
    try {
      await db.exec(setup);
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [newcomer]);
      await db.exec('set local role authenticated');
      await denied('select * from provision_invited_profile()');
    } finally { await db.exec('rollback'); }
  }
});

test('members cannot grant themselves membership or modify another member’s expenses', async () => {
  await asUser(outsider, () => denied(`insert into group_members(group_id,user_id) values ('${group}','${outsider}')`));
  await asUser(member, async () => {
    assert.equal((await db.query(`update expenses set amount=1 where id='${expense}' returning id`)).rows.length, 0);
    assert.equal((await db.query(`delete from expenses where id='${expense}' returning id`)).rows.length, 0);
  });
});

test('expense manager cannot assign shares outside the group or insert negative/NaN shares', async () => {
  await asUser(owner, () => denied(`insert into expense_splits(expense_id,user_id,amount_owed) values ('${expense}','${outsider}',10)`));
  for (const value of ['-1', "'NaN'"]) {
    await asUser(owner, () => denied(`insert into expense_splits(expense_id,user_id,amount_owed) values ('${expense}','${member}',${value})`));
  }
});

test('only receiver can confirm a payment; negative, NaN and excess amounts fail', async () => {
  for (const [actor,amount] of [[member,10],[outsider,10],[owner,-1],[owner,'NaN'],[owner,51]]) {
    await asUser(actor, () => denied('insert into settlements(group_id,paid_by,paid_to,amount) values ($1,$2,$3,$4)', [group,member,owner,amount]));
  }
});

test('valid payment succeeds and replay cannot exceed remaining debt', async () => {
  await asUser(owner, async () => {
    await db.query('insert into settlements(group_id,paid_by,paid_to,amount) values ($1,$2,$3,50)', [group,member,owner]);
    await denied('insert into settlements(group_id,paid_by,paid_to,amount) values ($1,$2,$3,50)', [group,member,owner]);
  });
});

test('batch payment RPC preserves receiver identity and rejects excess allocation', async () => {
  await asUser(owner, async () => {
    const rows = (await db.query('select * from record_group_settlements_batch($1)', [JSON.stringify([{group_id:group,debtor_id:member,amount:20}])])).rows;
    assert.equal(rows[0].paid_to, owner);
    assert.equal(Number(rows[0].amount), 20);
  });
  await asUser(owner, () => denied('select * from record_group_settlements_batch($1)', [JSON.stringify([{group_id:group,debtor_id:member,amount:100}])]));
});

test('storage ownership cannot be forged for uploads', async () => {
  await asUser(member, () => denied(`insert into storage.objects(bucket_id,name,owner_id) values ('avatars','${owner}/fake.png','${member}')`));
  await asUser(outsider, () => denied(`insert into storage.objects(bucket_id,name,owner_id) values ('receipts','${group}/${outsider}/fake.png','${outsider}')`));
  await asUser(member, async () => {
    await db.query(`insert into storage.objects(bucket_id,name,owner_id) values ('avatars','${member}/ok.png','${member}')`);
  });
});

test('admin privilege is database-backed, with non-admin destructive RPC denied', async () => {
  await asUser(member, () => assert.rejects(db.query(`select delete_user_completely('${outsider}')`), /Administrator access required/));
  await asUser(admin, async () => {
    assert.equal((await db.query('select private.current_user_is_admin() ok')).rows[0].ok, true);
  });
});

test('removal archives the name and preserves shares, expenses, payments and exact balance', async () => {
  await asUser(owner, async () => {
    await db.query('insert into settlements(group_id,paid_by,paid_to,amount) values ($1,$2,$3,20)', [group,member,owner]);
    const before = (await db.query('select * from expense_splits order by id')).rows;
    const paid = (await db.query('select * from settlements order by id')).rows;
    await db.query('delete from group_members where group_id=$1 and user_id=$2', [group,member]);
    assert.deepEqual((await db.query('select * from expense_splits order by id')).rows,before);
    assert.deepEqual((await db.query('select * from settlements order by id')).rows,paid);
    assert.equal((await db.query('select count(*)::int n from expenses')).rows[0].n,1);
    const archived=(await db.query('select * from former_group_members')).rows[0];
    assert.equal(archived.user_id,member);
    assert.equal(archived.full_name,'Test');
    assert.ok(archived.removed_at);
    await db.exec('set constraints all immediate');
    // Removed member has no group, ledger, private receipt or history access.
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[member]);
    for(const table of ['groups','expenses','expense_splits','settlements','former_group_members','storage.objects']) {
      assert.equal((await db.query(`select * from ${table}`)).rows.length,0,table);
    }
  });
});

test('former member financial edits, deletion, new charges and payments are blocked server-side', async () => {
  const cases=[
    `update expenses set amount=120 where id='${expense}'`,
    `delete from expenses where id='${expense}'`,
    `delete from expense_splits where expense_id='${expense}'`,
    `update expense_splits set amount_owed=1 where user_id='${member}'`,
    `insert into expense_splits(expense_id,user_id,amount_owed) values ('${expense}','${owner}',1)`,
    `insert into settlements(group_id,paid_by,paid_to,amount) values ('${group}','${member}','${owner}',10)`,
    `select * from record_group_settlements_batch('[{"group_id":"${group}","debtor_id":"${member}","amount":10}]')`,
    `select * from save_expense('{"amount":200,"splitBetween":["${owner}"]}','${expense}')`,
    `insert into former_group_members(group_id,user_id,full_name) values ('${group}','${outsider}','Forged')`,
  ];
  for(const sql of cases) await asUser(owner,async()=>{
    await db.query('delete from group_members where user_id=$1',[member]);
    await assert.rejects(db.query(sql),/read-only|active|belong|foreign key|permission denied/i,sql);
  });
});

test('membership update cannot bypass removal, archive is private, and legacy destructive RPC is disabled', async()=>{
  await asUser(owner,()=>assert.rejects(db.query(`update group_members set user_id='${outsider}' where user_id='${member}'`),/permission denied/i));
  await asUser(outsider,async()=>assert.equal((await db.query('select * from former_group_members')).rows.length,0));
  await asUser(null,()=>denied('select * from former_group_members'),'anon');
  await asUser(admin,()=>assert.rejects(db.query('select delete_user_completely($1)',[member]),/preserve financial history/i));
  await asUser(admin,()=>assert.rejects(db.query('delete from users where id=$1',[member]),/foreign key|read-only/i));
});

test('frozen expense metadata can be updated without redistributing its shares', async()=>{
  await asUser(owner,async()=>{
    await db.query('delete from group_members where user_id=$1',[member]);
    const before=(await db.query('select * from expense_splits order by id')).rows;
    const updated=(await db.query('select * from save_expense($1,$2)',[JSON.stringify({item_name:'Corrected description',note:'Receipt clarified'}),expense])).rows[0];
    assert.equal(updated.item_name,'Corrected description');
    assert.equal(Number(updated.amount),100);
    assert.deepEqual((await db.query('select * from expense_splits order by id')).rows,before);
    await db.exec('set constraints all immediate');
  });
});

test('atomic expense creation and edit distribute paise with original payer first', async()=>{
  await asUser(owner,async()=>{
    const payload={group_id:group,added_by:owner,item_name:'Atomic',amount:100,splitBetween:[member,owner]};
    const created=(await db.query('select * from save_expense($1)',[payload])).rows[0];
    await db.exec('set constraints all immediate');
    await db.exec('set constraints all deferred');
    const original=(await db.query('select * from save_expense($1,$2)',[{amount:100.01,splitBetween:[member,owner],added_by:member},created.id])).rows[0];
    await db.exec('set constraints all immediate');
    assert.equal(original.added_by,owner);
    const splits=(await db.query('select user_id,amount_owed from expense_splits where expense_id=$1 order by user_id',[created.id])).rows;
    assert.deepEqual(splits.map(s=>[s.user_id,Number(s.amount_owed)]),[[owner,50.01],[member,50]]);
  });
});

test('failed split insert rolls back the entire expense save and edit', async()=>{
  await db.exec(`create function private.fail_test_split() returns trigger language plpgsql as $$begin
    if new.user_id='${member}' then raise exception 'Injected split failure'; end if; return new; end$$;
    create trigger z_fail_test_split before insert on expense_splits for each row execute function private.fail_test_split();`);
  try {
    for(const id of [null,expense]) await asUser(owner,async()=>{
      const before=(await db.query('select id,amount from expenses order by id')).rows;
      const shares=(await db.query('select * from expense_splits order by id')).rows;
      await db.exec('savepoint attempt');
      await assert.rejects(db.query('select * from save_expense($1,$2)',[{
        group_id:group,added_by:owner,item_name:'Must roll back',amount:120,splitBetween:[owner,member],
      },id]),/Injected split failure/);
      await db.exec('rollback to savepoint attempt');
      assert.deepEqual((await db.query('select id,amount from expenses order by id')).rows,before);
      assert.deepEqual((await db.query('select * from expense_splits order by id')).rows,shares);
    });
  } finally {await db.exec('drop trigger z_fail_test_split on expense_splits; drop function private.fail_test_split()');}
});

test('empty, duplicate, stale and unrelated split participants fail without data loss',async()=>{
  for(const ids of [[],[owner,owner],[owner,outsider]]) await asUser(owner,async()=>{
    await assert.rejects(db.query('select * from save_expense($1,$2)',[{amount:100,splitBetween:ids},expense]),/Choose|Duplicate|active/i);
  });
  await asUser(member,()=>assert.rejects(db.query('select * from save_expense($1,$2)',[{amount:1},expense]),/denied/i));
});

test('partial legacy REST writes and duplicate shares cannot commit',async()=>{
  for(const sql of [
    `insert into expenses(group_id,added_by,item_name,amount) values ('${group}','${owner}','Incomplete',50)`,
    `update expenses set amount=99 where id='${expense}'`,
    `delete from expense_splits where expense_id='${expense}' and user_id='${member}'`,
    `insert into expense_splits(expense_id,user_id,amount_owed) values ('${expense}','${member}',0)`,
  ]) await asUser(owner,async()=>{
    await db.query(sql);
    await assert.rejects(db.exec('set constraints all immediate'),/must balance|Duplicate assigned/i);
  });
});

test('former payment history cannot be deleted, but active corrections still work',async()=>{
  await asUser(owner,async()=>{
    await db.query('insert into settlements(group_id,paid_by,paid_to,amount) values ($1,$2,$3,20)',[group,member,owner]);
    await db.query('delete from group_members where user_id=$1',[member]);
    await assert.rejects(db.query('delete from settlements'),/read-only/i);
  });
  await asUser(owner,async()=>{
    await db.query('insert into settlements(group_id,paid_by,paid_to,amount) values ($1,$2,$3,20)',[group,member,owner]);
    assert.equal((await db.query('delete from settlements returning id')).rows.length,1);
  });
});

test('active payments use active debts even when frozen debts offset the overall net balance',async()=>{
  await asUser(owner,async()=>{
    await db.query('delete from group_members where user_id=$1',[member]);
    await db.exec('reset role');
    await db.query('insert into group_members(group_id,user_id) values($1,$2)',[group,outsider]);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[outsider]);
    await db.exec('set local role authenticated');
    await db.query('select * from save_expense($1)',[{
      group_id:group,added_by:outsider,item_name:'Future expense',amount:100,splitBetween:[owner,outsider],
    }]);
    // Owner's overall net is zero, but owes 50 from active-only obligations.
    await db.query('insert into settlements(group_id,paid_by,paid_to,amount) values($1,$2,$3,50)',[group,owner,outsider]);
    await db.exec('set constraints all immediate');
    assert.equal((await db.query('select count(*)::int n from settlements')).rows[0].n,1);
  });
});

test('rejoining restores membership eligibility without losing the saved ledger',async()=>{
  await asUser(owner,async()=>{
    const before=(await db.query('select * from expense_splits order by id')).rows;
    await db.query('delete from group_members where user_id=$1',[member]);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[member]);
    await db.query("select join_group_by_invite_code('GROUPKEY2345')");
    assert.equal((await db.query('select * from group_members where user_id=$1',[member])).rows.length,1);
    assert.deepEqual((await db.query('select * from expense_splits order by id')).rows,before);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
    await db.query('insert into settlements(group_id,paid_by,paid_to,amount) values($1,$2,$3,50)',[group,member,owner]);
    await db.exec('set constraints all immediate');
  });
});

test('active expense metadata updates preserve custom shares and their IDs',async()=>{
  await asUser(owner,async()=>{
    await db.query('update expense_splits set amount_owed=case when user_id=$1 then 25 else 75 end where expense_id=$2',[owner,expense]);
    const before=(await db.query('select * from expense_splits order by id')).rows;
    await db.query('select * from save_expense($1,$2)',[{item_name:'Updated metadata'},expense]);
    assert.deepEqual((await db.query('select * from expense_splits order by id')).rows,before);
    await db.exec('set constraints all immediate');
  });
});

test('new RPC is unavailable to anonymous users and former members cannot receive or acquire new shares',async()=>{
  await asUser(null,()=>denied("select * from save_expense('{}')"),'anon');
  await asUser(owner,async()=>{
    await db.query('delete from group_members where user_id=$1',[member]);
    await assert.rejects(db.query('select * from save_expense($1)',[{
      group_id:group,added_by:owner,item_name:'Invalid former split',amount:20,splitBetween:[owner,member],
    }]),/active group member/i);
  });
  await asUser(owner,async()=>{
    await db.query('delete from group_members where user_id=$1',[member]);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[member]);
    await assert.rejects(db.query('insert into settlements(group_id,paid_by,paid_to,amount) values($1,$2,$3,10)',[group,owner,member]),/active group payment receiver/i);
  });
});
