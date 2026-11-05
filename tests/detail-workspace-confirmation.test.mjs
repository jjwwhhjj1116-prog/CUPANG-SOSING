import test from 'node:test';
import assert from 'node:assert/strict';
import {companies} from './helpers/image-download-ui.mjs';
import {detailWorkspaceFixture,json} from './helpers/detail-workspace-api.mjs';

function countQuotationReads(f,after=()=>{}){
 const module=f.api.load('app/quotation-fields-snapshot.ts'),original=module.stableQuotationFieldsView;
 const state={calls:0};module.stableQuotationFieldsView=async(...args)=>{const value=await original(...args);after(++state.calls,value);return value;};
 return state;
}

for(const company of companies)test(`${company.companyCode}: workspace GET keeps fresh final source checks without rebuilding the same final quotation twice`,async()=>{
 const f=await detailWorkspaceFixture(company);try{
  const saved=await json(await f.put(await f.body())),before=f.tables(),network=[...f.api.network],objects=[...f.api.objects].map(([key,value])=>[key,Buffer.from(value).toString('base64')]);
  const reads=countQuotationReads(f),reply=await json(await f.read());
  assert.deepEqual(reply,saved);assert.equal(reads.calls,3,'two initial stable assemblies and one fresh final assembly');
  assert.deepEqual(f.tables(),before);assert.deepEqual([...f.api.objects].map(([key,value])=>[key,Buffer.from(value).toString('base64')]),objects);assert.deepEqual(f.api.network,network);
 }finally{f.api.close();}
});

for(const change of ['member','content','settings','profile'])test(`final confirmation still rejects ${change} changes after the final quotation read`,async()=>{
 const f=await detailWorkspaceFixture(companies[0]);try{
  await json(await f.put(await f.body()));const network=[...f.api.network];let fired=false;
  countQuotationReads(f,call=>{
   if(call!==3)return;fired=true;
   if(change==='member')f.api.sqlite.prepare("UPDATE members SET status='suspended' WHERE id='owner'").run();
   const table=change==='content'?'product_content':change==='settings'?'workspace_settings':change==='profile'?'category_profiles':null;
   if(table){const column=change==='settings'?'owner_id':change==='profile'?'id':'product_id',id=change==='settings'?'owner':change==='profile'?f.initialView.categoryContext.profileId:f.product.id;
    const row=f.api.sqlite.prepare(`SELECT payload FROM ${table} WHERE ${column}=?`).get(id);
    if(!row&&change==='settings')f.api.sqlite.prepare('INSERT INTO workspace_settings(owner_id,payload,updated_at) VALUES(?,?,?)').run(id,JSON.stringify({...f.api.settings,brand:'경쟁 설정'}),new Date().toISOString());
    else{assert.ok(row);const payload=JSON.parse(row.payload);payload.confirmationProbe='changed-without-a-clock';f.api.sqlite.prepare(`UPDATE ${table} SET payload=? WHERE ${column}=?`).run(JSON.stringify(payload),id);}
   }
  });
  const response=await f.read();assert.equal(fired,true);assert.equal(response.status,change==='member'?403:409);assert.deepEqual(f.api.network,network);
 }finally{f.api.close();}
});

test('the final workspace row re-read rejects a changed row independently of quotation clocks',async()=>{
 const f=await detailWorkspaceFixture(companies[0]);try{
  await json(await f.put(await f.body()));const prepare=f.api.db.prepare;let rows=0;
  f.api.db.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('SELECT revision,request_id,payload,updated_at FROM product_detail_workspaces')){
   const first=statement.first;statement.first=async(...args)=>{if(++rows===2)f.api.sqlite.prepare("UPDATE product_detail_workspaces SET request_id='changed-before-final-row' WHERE product_id=?").run(f.product.id);return first.apply(statement,args);};
  }return statement;};
  assert.equal((await f.read()).status,409);assert.equal(rows,2);
 }finally{f.api.close();}
});

for(const company of companies)test(`${company.companyCode}: a delayed final workspace row cannot hide a membership change`,async()=>{
 const f=await detailWorkspaceFixture(company);try{
  await json(await f.put(await f.body()));const network=[...f.api.network],prepare=f.api.db.prepare;let rows=0,fired=false;
  f.api.db.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('SELECT revision,request_id,payload,updated_at FROM product_detail_workspaces')){
   const first=statement.first;statement.first=async(...args)=>{const result=await first.apply(statement,args);if(++rows===2){await new Promise(resolve=>setImmediate(resolve));fired=true;f.api.sqlite.prepare("UPDATE members SET status='suspended' WHERE id='owner'").run();}return result;};
  }return statement;};
  const response=await f.read();assert.equal(fired,true);assert.ok([403,409].includes(response.status),'the delayed member change must not receive200');assert.deepEqual(f.api.network,network);
 }finally{f.api.close();}
});
