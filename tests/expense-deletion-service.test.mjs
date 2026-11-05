import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import { build } from 'esbuild';
let service;
before(async()=>{
  const compiled=await build({entryPoints:['src/services/expenseService.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{
    name:'db-fixture',setup(api){
      api.onResolve({filter:/lib\/db$/},()=>({path:'db',namespace:'fixture'}));
      api.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`
        export const dbQuery=()=>{throw new Error('Unexpected table read');};
        export const supabaseClient={rpc:async(name,args)=>{
          globalThis.__deletionFixture.calls.push({name,args});
          return {data:null,error:globalThis.__deletionFixture.error};
        }};`}));
    }
  }]});
  service=(await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)).ExpenseService;
});
beforeEach(()=>{globalThis.__deletionFixture={calls:[],error:null};});
test('reset uses one atomic RPC scoped to the selected group',async()=>{
  await service.resetGroupExpenses('kitchen');
  assert.deepEqual(globalThis.__deletionFixture.calls,[{name:'reset_group_expenses',args:{p_group_id:'kitchen'}}]);
});
test('single deletion carries both group and expense identity',async()=>{
  await service.deleteExpense('kitchen','oil');
  assert.deepEqual(globalThis.__deletionFixture.calls,[{name:'delete_group_expense',args:{p_group_id:'kitchen',p_expense_id:'oil'}}]);
});
test('server errors propagate without retrying destructive requests',async()=>{
  globalThis.__deletionFixture.error={message:'Deletion denied'};
  await assert.rejects(service.resetGroupExpenses('kitchen'),/Deletion denied/);
  await assert.rejects(service.deleteExpense('kitchen','oil'),/Deletion denied/);
  assert.equal(globalThis.__deletionFixture.calls.length,2);
});
