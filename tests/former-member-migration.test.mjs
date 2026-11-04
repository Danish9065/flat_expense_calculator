import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration='20261104075039_preserve_former_member_ledgers.sql';
const eid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const gid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const payer='11111111-1111-4111-8111-111111111111';
// Synthetic fixtures keep private production ledger values out of the repo.
const original=Array.from({length:5},(_,i)=>[
  `${i+1}0000000-0000-4000-8000-000000000000`,
  i===2 ? payer : `${i+2}${i+2}${i+2}${i+2}${i+2}${i+2}${i+2}${i+2}-0000-4000-8000-000000000000`,
]);
const former=original[0][1];
const restoredExpense='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const payload={
  former_user:{id:former,full_name:'Saved former name'},
  expenses:[{id:eid,group_id:gid,added_by:payer,amount:184,item_name:'Snapshot expense',category:'General',created_at:'2026-10-09T00:00:00Z'},
    {id:restoredExpense,group_id:gid,added_by:former,amount:100,item_name:'Former payer expense',category:'General',created_at:'2026-10-10T00:00:00Z'}],
  splits:[...original.map(([id,user_id])=>({id,user_id,expense_id:eid,amount_owed:36.8})),
    {id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',user_id:former,expense_id:restoredExpense,amount_owed:50},
    {id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',user_id:payer,expense_id:restoredExpense,amount_owed:50}],
  payments:[{id:'ffffffff-ffff-4fff-8fff-ffffffffffff',group_id:gid,paid_by:former,paid_to:payer,amount:20,is_partial:false,settled_at:'2026-10-13T00:00:00'}],
};
async function configureRecovery(db){
  await db.query("select set_config('app.verified_recovery_snapshot',$1,false)",[JSON.stringify(payload)]);
}
async function legacyDatabase(){
  const db=new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create schema storage;
    grant usage on schema auth,storage to anon,authenticated;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;`);
  for(const name of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f!==migration).sort()){
    await db.exec((await readFile(`supabase/migrations/${name}`,'utf8')).replace(/alter publication supabase_realtime add table[\s\S]*?;/gi,''));
  }
  for(const [,uid] of original){
    await db.query('insert into auth.users(id,email) values($1,$2)',[uid,`${uid}@example.invalid`]);
    await db.query("insert into users(id,email,full_name) values($1,$2,'Saved name')",[uid,`${uid}@example.invalid`]);
  }
  await db.query("insert into groups(id,name,invite_code,created_by) values($1,'Recovery test','TESTRECOVERY',$2)",[gid,payer]);
  await db.query('insert into group_members(group_id,user_id) values($1,$2)',[gid,payer]);
  await db.query("insert into expenses(id,group_id,added_by,item_name,amount) values($1,$2,$3,'Mustard oil',184)",[eid,gid,payer]);
  return db;
}
const newMigration=()=>readFile(`supabase/migrations/${migration}`,'utf8');

test('upgrade restores missing verified shares and backfills former names without rewriting survivors',async()=>{
  const db=await legacyDatabase();
  try{
    for(const [id,uid] of original.slice(0,4)) await db.query('insert into expense_splits(id,expense_id,user_id,amount_owed) values($1,$2,$3,36.8)',[id,eid,uid]);
    const survivors=(await db.query('select * from expense_splits order by id')).rows;
    await configureRecovery(db);
    await db.exec(await newMigration());
    const total=(await db.query('select sum(amount_owed)::text total,count(*)::int n from expense_splits')).rows[0];
    assert.deepEqual(total,{total:'184.00',n:5});
    assert.deepEqual((await db.query('select * from expense_splits where id<>$1 order by id',[original[4][0]])).rows,survivors);
    const former=(await db.query('select user_id,full_name from former_group_members order by user_id')).rows;
    assert.equal(former.length,4);
    assert.ok(former.every(row=>row.full_name==='Saved name'&&row.user_id!==payer));
    const repair=(await newMigration()).split('-- BEGIN VERIFIED RECOVERY')[1].split('-- END VERIFIED RECOVERY')[0];
    await db.exec(repair.slice(repair.indexOf('\ndo $repair$')));
    assert.equal((await db.query('select count(*)::int n from expense_splits')).rows[0].n,5);
  }finally{await db.close();}
});

test('upgrade refuses a conflicting incomplete expense and rolls back schema and data changes',async()=>{
  const db=await legacyDatabase();
  try{
    await db.query('insert into expense_splits(id,expense_id,user_id,amount_owed) values($1,$2,$3,40)',[original[0][0],eid,original[0][1]]);
    await configureRecovery(db);
    await assert.rejects(db.exec(await newMigration()),/differs from the verified recovery snapshot/);
    await db.exec('rollback');
    assert.equal((await db.query('select count(*)::int n from expense_splits')).rows[0].n,1);
    assert.equal((await db.query("select to_regclass('public.former_group_members') name")).rows[0].name,null);
  }finally{await db.close();}
});

test('upgrade preserves an already balanced edited expense without restoring obsolete allocations',async()=>{
  const db=await legacyDatabase();
  try{
    await db.query('insert into expense_splits(expense_id,user_id,amount_owed) values($1,$2,184)',[eid,payer]);
    const before=(await db.query('select * from expense_splits')).rows;
    await configureRecovery(db);
    await db.exec(await newMigration());
    assert.deepEqual((await db.query('select * from expense_splits')).rows,before);
  }finally{await db.close();}
});

test('verified deletion recovery restores the profile, expense, shares and past payment without restoring access or sending notifications',async()=>{
  const db=await legacyDatabase();
  try{
    for(const [id,uid] of original.filter(([,uid])=>uid!==former)) await db.query('insert into expense_splits(id,expense_id,user_id,amount_owed) values($1,$2,$3,36.8)',[id,eid,uid]);
    // The existing Auth identity survives deletion of the application profile.
    await db.query('delete from users where id=$1',[former]);
    const notifications=(await db.query('select count(*)::int n from notifications')).rows[0].n;
    await configureRecovery(db);
    await db.exec(await newMigration());
    assert.equal((await db.query('select full_name from users where id=$1',[former])).rows[0].full_name,'Saved former name');
    assert.equal((await db.query('select count(*)::int n from group_members where user_id=$1',[former])).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from expenses')).rows[0].n,2);
    assert.equal((await db.query('select count(*)::int n from expense_splits')).rows[0].n,7);
    assert.equal((await db.query('select count(*)::int n from settlements')).rows[0].n,1);
    assert.equal((await db.query('select count(*)::int n from notifications')).rows[0].n,notifications);
    assert.equal((await db.query('select count(*)::int n from expenses e where amount<>(select sum(amount_owed) from expense_splits where expense_id=e.id)')).rows[0].n,0);
    assert.equal((await db.query('select full_name from former_group_members where user_id=$1',[former])).rows[0].full_name,'Saved former name');
  }finally{await db.close();}
});
