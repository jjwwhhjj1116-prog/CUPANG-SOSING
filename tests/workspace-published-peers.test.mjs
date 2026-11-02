import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceDetailSaveFixture,json,sha} from './helpers/workspace-detail-save-api.mjs';
import {companies} from './helpers/image-download-ui.mjs';
import {loadComposite} from './helpers/detail-image-composite.mjs';
const plain=value=>JSON.parse(JSON.stringify(value));
const policy='shared-body-pixels-v1';
async function fixture(){
 const f=await workspaceDetailSaveFixture(companies[0],{edited:false}),model=f.api.load('app/detail-workspace.ts'),initial=await json(await f.read()),rows=initial.view.resolved.rows.filter(row=>row.optionId),
  included=rows.filter(row=>row.included).map(row=>row.optionId),peer=included.find(id=>id!==f.optionId),excluded=rows.find(row=>!row.included).optionId;
 const savePeer=async(optionId=peer,margin=0)=>{const before=await json(await f.read(optionId)),document=plain(initial.workspace.document);document.imageMargin=margin;document.generatedHtml=model.generateDetailWorkspaceHtml(document.photos,margin);
  return json(await f.put({optionId,expectedRevision:before.workspace?.revision??0,expectedView:model.detailWorkspaceExpectedView(before.view),requestId:await model.detailWorkspaceRequestId(f.product.id,optionId,before.workspace?.revision??0,model.detailWorkspaceExpectedView(before.view),document),document}));};
 await savePeer();await savePeer(excluded,7);
 for(const [index,photo]of initial.workspace.document.photos.filter(photo=>photo.role==='body').entries()){
  const source=(await json(await f.openImage(photo.id))).source,document=f.editDocument();document.regions=[{...document.regions[0],translated:'합성 한국어 본문 '+index,translationProvenance:'generated'}];
  await json(await f.applyImage(source,document,await f.png(index?'#45ab67':'#ab4567')));
 }
 const scope=await model.detailWorkspaceScope(initial.view.categoryContext),row=optionId=>f.api.sqlite.prepare('SELECT * FROM product_detail_workspaces WHERE owner_id=? AND product_id=? AND category_scope=? AND option_id=?').get('owner',f.product.id,scope,optionId);
 const prepare=async()=>{const prepared=await f.prepareWorkspace(),peers=rows.map(({optionId})=>{const raw=row(optionId),record=raw?JSON.parse(raw.payload):null;return{optionId,workspace:record?{revision:record.revision,digest:record.digest}:null};}),peerDigest=sha(JSON.stringify(peers)),files=new Map(prepared.workspace.files.map(file=>[file.key,file])),seen=new Set(),publishedBodyImages=[];
  for(const photo of prepared.workspace.document.photos.filter(photo=>photo.role==='body'))if(!seen.has(photo.key)){seen.add(photo.key);const file=files.get(photo.key);publishedBodyImages.push({sourceKey:photo.key,key:photo.key.includes('/free-image-')?'owner/published-detail-'+file.sha256+'.png':photo.key,sha256:file.sha256,width:file.width,height:file.height});}
  prepared.uploadId=sha(JSON.stringify({kind:'workspace-detail-composite-v1',productId:f.product.id,optionId:f.optionId,category:prepared.view.categoryContext,fingerprint:prepared.view.inputFingerprint,workspace:{revision:prepared.workspace.revision,digest:prepared.workspace.digest},sources:prepared.sources,width:800,height:prepared.height,sha256:prepared.sha256,peerDigest,publicationPolicy:policy,publishedBodyImages}));
  return{prepared,peers,publishedBodyImages,body:{...await f.uploadWorkspace(prepared),peerDigest,publicationPolicy:policy}};
 };
 return{...f,model,initial,included,peer,excluded,scope,row,savePeer,prepare};
}
test('atomic publication opens translated BODY and exact banners in every included peer while preserving source layers and excluded raw work',async()=>{
 const f=await fixture();try{
  const sourceBefore=await json(await f.read()),peerBefore=JSON.parse(f.row(f.peer).payload),excludedBefore=f.row(f.excluded),{prepared,body,publishedBodyImages}=await f.prepare(),saved=await json(await f.post(body));
  assert.equal(saved.receipt.publicationPolicy,policy);assert.deepEqual(saved.receipt.publishedBodyImages,publishedBodyImages);assert.match(saved.receipt.peerAfterDigest,/^[a-f0-9]{64}$/);
  assert.deepEqual((await json(await f.read())).workspace,sourceBefore.workspace);assert.deepEqual(f.row(f.excluded),excludedBefore);
  const aliases=publishedBodyImages.map(image=>image.key);for(const image of publishedBodyImages)assert.deepEqual(f.api.objects.get(image.key),f.api.objects.get(image.sourceKey));
  for(const optionId of f.included.filter(id=>id!==f.optionId)){
   const reply=await json(await f.read(optionId)),document=f.api.load('app/detail-workspace-seed.ts').initialDetailWorkspaceDocument(reply,optionId);
   assert.ok(reply.workspace);assert.deepEqual(document.photos.filter(photo=>photo.role==='body').map(photo=>photo.key),aliases);
   assert.equal(document.photos[0].key,prepared.workspace.document.photos[0].key);assert.equal(document.photos.at(-1).key,prepared.workspace.document.photos.at(-1).key);
   assert.equal(reply.workspace.optionId,optionId);if(optionId===f.peer){assert.equal(reply.workspace.revision,peerBefore.revision+1);assert.deepEqual(document.photos.map(photo=>[photo.id,photo.originKey]),peerBefore.document.photos.map(photo=>[photo.id,photo.originKey]));}
   const photo=document.photos.find(photo=>photo.role==='body'),opened=await json(await f.openImage(photo.id,reply.view.categoryContext.profileId,optionId));assert.equal(opened.source.sourceKey,photo.key);assert.equal(opened.editDocument,undefined);
  }
  const retained=f.tables(),replay=await json(await f.post(body)),recovered=await json(await f.recover(body.uploadId));assert.deepEqual(replay,saved);assert.equal(recovered.applied,true);assert.equal(recovered.receipt.peerAfterDigest,saved.receipt.peerAfterDigest);assert.deepEqual(f.tables(),retained);
 }finally{f.api.close();}
});
test('a manually different included peer is preserved and publication rejects before modifying any database row',async()=>{
 const f=await fixture();try{
  await f.savePeer(f.peer,11);const {body}=await f.prepare(),before=f.tables();assert.equal((await f.post(body)).status,409);assert.deepEqual(f.tables(),before);
 }finally{f.api.close();}
});
test('a peer race at the quotation commit rolls back quote, product and every companion peer synchronization',async()=>{
 const f=await fixture();try{
  const {body}=await f.prepare(),prepare=f.api.db.prepare;let injected=false,competing;
  f.api.db.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('INSERT INTO product_quotation_fields')){const execute=statement.execute;statement.execute=()=>{if(!injected){injected=true;f.api.sqlite.prepare('UPDATE product_detail_workspaces SET revision=revision+1 WHERE option_id=?').run(f.peer);competing=f.tables();}return execute();};}return statement;};
  assert.equal((await f.post(body)).status,409);assert.equal(injected,true);assert.deepEqual(f.tables(),competing);
 }finally{f.api.close();}
});

test('a later manual peer edit makes publication recovery and replay reject without rewriting that peer',async()=>{
 const f=await fixture();try{
  const {body}=await f.prepare();await json(await f.post(body));await f.savePeer(f.peer,11);const before=f.tables();
  assert.equal((await f.recover(body.uploadId)).status,409);assert.equal((await f.post(body)).status,409);assert.deepEqual(f.tables(),before);
 }finally{f.api.close();}
});

for(const target of ['source','published-copy'])test(`publication rejects changed ${target} bytes and leaves database rows untouched`,async()=>{
 const f=await fixture();try{
  const {body,publishedBodyImages}=await f.prepare(),image=publishedBodyImages[0];f.api.objects.set(target==='source'?image.sourceKey:image.key,await f.png('#123abc'));
  const before=f.tables();assert.equal((await f.post(body)).status,409);assert.deepEqual(f.tables(),before);
 }finally{f.api.close();}
});

for(const kind of ['key','crop'])test(`a same-origin peer with a manual ${kind} is preserved and blocks publication`,async()=>{
 const f=await fixture();try{
  const peer=await json(await f.read(f.peer)),photo=peer.workspace.document.photos.find(photo=>photo.role==='body'),source=(await json(await f.openImage(photo.id,peer.view.categoryContext.profileId,f.peer))).source,document=f.editDocument();
  if(kind==='crop')document.crop={sourceWidth:800,sourceHeight:1,x:10,y:0,width:400,height:1};
  await json(await f.applyImage(source,document,await f.png('#ffccaa',kind==='crop'?400:800)));
  const changed=await json(await f.read(f.peer));assert.equal(changed.workspace.document.photos[1].originKey,peer.workspace.document.photos[1].originKey);
  assert.notEqual(changed.workspace.document.photos[1].key,peer.workspace.document.photos[1].key);
  const {body}=await f.prepare(),before=f.tables();assert.equal((await f.post(body)).status,409);assert.deepEqual(f.tables(),before);
 }finally{f.api.close();}
});

test('the real composite/save client accepts published image keys and recovers the exact committed peer transitions with reads only',async()=>{
 const f=await fixture();try{
  const calls=[],request=async(url,init={})=>{
   calls.push({url,method:init.method??'GET'});
   if(url.includes('/detail-workspace?'))return f.api.route(url,{...init,...(typeof init.body==='string'?{body:JSON.parse(init.body)}:{})});
   const response=await f.request(url,init);
   if(loseAck&&url.includes('/detail-save?')&&init.method==='POST'){loseAck=false;assert.equal(response.status,200,await response.clone().text());throw Error('fixture lost ACK');}
   return response;
  };
  let loseAck=true;const client=loadComposite({...f,request}).load('app/detail-workspace-composite-client.ts'),saved=await json(await f.read()),peers=saved.view.resolved.rows.flatMap(row=>row.optionId?[{optionId:row.optionId,workspace:(()=>{const raw=f.row(row.optionId),record=raw?JSON.parse(raw.payload):null;return record?{revision:record.revision,digest:record.digest}:null;})()}]:[]),
   input=await client.prepareDetailWorkspaceComposite({productId:f.product.id,optionId:f.optionId,profileId:saved.view.categoryContext.profileId,view:saved.view},saved,new AbortController().signal,request,peers,policy),attempt={};
  await assert.rejects(()=>client.applyDetailWorkspaceComposite(input,attempt,new AbortController().signal,request),/lost ACK/);assert.equal(attempt.pending,'save');
  const before=f.tables(),reads=calls.length;assert.equal(await client.recoverDetailWorkspaceComposite(input,attempt,new AbortController().signal,request),'completed');
  assert.ok(calls.slice(reads).every(call=>call.method==='GET'));assert.deepEqual(f.tables(),before);
  const aliases=f.api.load('app/detail-save-plan.ts').detailSavePublishedBodyImages(input.workspace,'owner').map(image=>image.key);
  assert.deepEqual(plain(attempt.completed.imageKeys),[...new Set([...input.view.imageKeys,...input.keys,...aliases,attempt.key])]);
  await f.savePeer(f.peer,11);const changed=f.tables();await assert.rejects(()=>client.applyDetailWorkspaceComposite(input,attempt,new AbortController().signal,request));assert.deepEqual(f.tables(),changed);
 }finally{f.api.close();}
});
