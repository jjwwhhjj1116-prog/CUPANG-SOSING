import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceDetailSaveFixture,json,sha} from './helpers/workspace-detail-save-api.mjs';
import {companies} from './helpers/image-download-ui.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
async function fixture(){
 const f=await workspaceDetailSaveFixture(companies[0],{edited:false}),profileId=f.initialView.categoryContext.profileId,
  model=f.api.load('app/detail-workspace.ts'),scope=await model.detailWorkspaceScope((await f.view()).categoryContext),view=await f.view(),ids=view.resolved.rows.flatMap(row=>row.optionId?[row.optionId]:[]),peer=ids.find(id=>id!==f.optionId);
 const row=id=>f.api.sqlite.prepare('SELECT * FROM product_detail_workspaces WHERE owner_id=? AND product_id=? AND category_scope=? AND option_id=?').get('owner',f.product.id,scope,id);
 const savePeer=async(id=peer,margin=0)=>{
  const current=await json(await f.api.route(f.base+'/detail-workspace?profileId='+profileId+'&optionId='+id)),document={...plain(f.openedWorkspace.workspace.document),imageMargin:margin};
  document.generatedHtml=model.generateDetailWorkspaceHtml(document.photos,margin);
  const requestId=await model.detailWorkspaceRequestId(f.product.id,id,current.workspace?.revision??0,model.detailWorkspaceExpectedView(current.view),document);
  return json(await f.api.route(f.base+'/detail-workspace?profileId='+profileId,{method:'PUT',body:{optionId:id,expectedRevision:current.workspace?.revision??0,expectedView:model.detailWorkspaceExpectedView(current.view),requestId,document}}));
 };
 const peers=()=>ids.map(optionId=>{const saved=row(optionId),workspace=saved?JSON.parse(saved.payload):null;return{optionId,workspace:workspace?{revision:workspace.revision,digest:workspace.digest}:null};});
 const prepare=async(proof=peers())=>{
  const prepared=await f.prepareWorkspace(),peerDigest=sha(JSON.stringify(proof));
  prepared.uploadId=sha(JSON.stringify({kind:'workspace-detail-composite-v1',productId:f.product.id,optionId:f.optionId,category:prepared.view.categoryContext,fingerprint:prepared.view.inputFingerprint,
   workspace:{revision:prepared.workspace.revision,digest:prepared.workspace.digest},sources:prepared.sources,width:800,height:prepared.height,sha256:prepared.sha256,peerDigest}));
  return{prepared,body:{...await f.uploadWorkspace(prepared),peerDigest}};
 };
 return{...f,ids,peer,scope,row,savePeer,peers,prepare};
}

test('all-option workspace proof commits and retains its exact digest through replay and read-only recovery',async()=>{
 const f=await fixture();try{
  await f.savePeer();const {body}=await f.prepare(),saved=await json(await f.post(body));assert.equal(saved.receipt.peerDigest,body.peerDigest);
  const before=f.tables();assert.deepEqual(await json(await f.post(body)),saved);assert.equal((await json(await f.recover(body.uploadId))).receipt.peerDigest,body.peerDigest);assert.deepEqual(f.tables(),before);
  const {peerDigest,...unbound}=body;assert.ok(peerDigest);assert.equal((await f.post(unbound)).status,409);
 }finally{f.api.close();}
});

for(const change of ['existing','new','missing','same-revision'])test(`peer ${change} race at actual D1 commit blocks every final quotation/product write`,async()=>{
 const f=await fixture();try{
  if(change!=='new')await f.savePeer();const {body}=await f.prepare(),originalPrepare=f.api.db.prepare;let injected=false,competing;
  const sourceRow=f.row(f.optionId),peerRow=f.row(f.peer);
  f.api.db.prepare=sql=>{const statement=originalPrepare(sql);if(sql.startsWith('INSERT INTO product_quotation_fields')){const execute=statement.execute;statement.execute=()=>{
   if(!injected){injected=true;
    if(change==='missing')f.api.sqlite.prepare('DELETE FROM product_detail_workspaces WHERE option_id=?').run(f.peer);
    else if(change==='new')f.api.sqlite.prepare('INSERT INTO product_detail_workspaces VALUES(?,?,?,?,?,?,?,?)').run('owner',f.product.id,f.scope,f.peer,sourceRow.revision,sourceRow.request_id,sourceRow.payload,sourceRow.updated_at);
    else f.api.sqlite.prepare('UPDATE product_detail_workspaces SET '+(change==='existing'?'revision=revision+1':'payload=?')+' WHERE option_id=?').run(...(change==='existing'?[]:[peerRow.payload.replace('detail-workspace-record-v1','changed-workspace-record-v1')]),f.peer);
    competing=f.tables();
   }return execute();};}return statement;};
  const response=await f.post(body);assert.equal(response.status,409,await response.clone().text());assert.equal(injected,true);assert.deepEqual(f.tables(),competing);
 }finally{f.api.close();}
});

test('peer proof binds every option including absent/excluded rows and rejects wrong company/category before commit',async()=>{
 const f=await fixture();try{
  await f.savePeer();const proof=f.peers(),before=f.tables();
  for(const value of [proof.slice(1),[...proof].reverse(),proof.map((row,index)=>index===0?{...row,optionId:'foreign'}:row),proof.map(row=>({...row,workspace:null}))]){
   const {body}=await f.prepare(value);assert.equal((await f.post(body)).status,409);assert.deepEqual(f.tables(),before);
  }
  const current=f.row(f.peer),record=JSON.parse(current.payload);record.company={code:'A01526306',name:'유앤채'};
  record.digest=await f.api.load('app/detail-workspace.ts').detailWorkspaceDigest(Object.fromEntries(Object.entries(record).filter(([key])=>key!=='digest')));
  f.api.sqlite.prepare('UPDATE product_detail_workspaces SET payload=? WHERE option_id=?').run(JSON.stringify(record),f.peer);
  const {body}=await f.prepare();const changed=f.tables();assert.equal((await f.post(body)).status,409);assert.deepEqual(f.tables(),changed);
  record.company=JSON.parse(current.payload).company;record.context={...record.context,categoryId:'foreign-category'};
  record.digest=await f.api.load('app/detail-workspace.ts').detailWorkspaceDigest(Object.fromEntries(Object.entries(record).filter(([key])=>key!=='digest')));
  f.api.sqlite.prepare('UPDATE product_detail_workspaces SET payload=? WHERE option_id=?').run(JSON.stringify(record),f.peer);
  const category=await f.prepare(),categoryBefore=f.tables();assert.equal((await f.post(category.body)).status,409);assert.deepEqual(f.tables(),categoryBefore);
 }finally{f.api.close();}
});

test('the exact escaped peer rowset is bounded before its aggregate is returned or bound to the quotation commit',async()=>{
 const f=await fixture();try{
  for(const id of f.ids.filter(id=>id!==f.optionId)){
   await f.savePeer(id);const current=f.row(id);
   f.api.sqlite.prepare('UPDATE product_detail_workspaces SET payload=? WHERE option_id=?').run(current.payload+' '.repeat(460*1024),id);
  }
  const {body}=await f.prepare(),before=f.tables();let aggregated=false;const prepare=f.api.db.prepare;
  f.api.db.prepare=sql=>{if(sql.includes('json_group_array(json(value))'))aggregated=true;return prepare(sql);};
  const response=await f.post(body);assert.equal(response.status,413);assert.equal(aggregated,false);assert.deepEqual(f.tables(),before);
 }finally{f.api.close();}
});
