import test from 'node:test';
import assert from 'node:assert/strict';
import {assetApiFixture,companies,module,plain} from './helpers/supplier-hub-single-assets.mjs';
import {quotationAiUI,nodes} from './helpers/quotation-ai-ui.mjs';
import {dispatchSingleDocument,SINGLE_DOCUMENT_LIVE_VERIFIED} from '../extensions/supplier-hub/single-dispatch.mjs';
import {singleDocumentIdentity} from '../extensions/supplier-hub/single-document.mjs';
import {SINGLE_SENDER} from './helpers/supplier-hub-single-document.mjs';

// Isolated manual/unlinked products follow live workspace defaults. This does
// not claim captured URL drafts use those defaults or exercise a remote Hub.
const client=module('app/supplier-hub-single-client.ts');
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const fields=f=>f.h.route(f.base+'/quotation-fields'+f.query).then(response=>json(response));
const candidate=f=>f.h.route(f.endpoint).then(response=>json(response));
const clocks=view=>[view.productVersion,view.contentRevision,view.optionRevision,view.revision];
const publicKeys=f=>[...f.h.objects.keys()].filter(key=>key.startsWith('quotation-public-detail/'));
async function changeSettings(f){
 return json(await f.h.load('app/api/settings/route.ts').PUT(new Request('https://app.test/api/settings',{method:'PUT',headers:{'content-type':'application/json'},
  body:JSON.stringify({...f.h.settings,expectedOwnerId:'owner',brand:'다른 기기에서 변경한 브랜드'})})));
}
async function changeProfile(f){
 const profile=await f.h.load('db/category-profiles.ts').getCategoryProfile('owner',f.profile.id),hubSchema=plain(profile.hubSchema),raw=JSON.parse(hubSchema.schemaString);
 raw.properties.productPage.properties.brand.maxLength=7;hubSchema.schemaString=JSON.stringify(raw);
 const changed=await f.h.load('db/category-profiles.ts').updateCategoryProfile('owner',profile.id,profile.revision,{...profile,hubSchema});
 assert.equal(changed.revision,profile.revision+1);return changed;
}
async function changeOptions(f){
 const db=f.h.load('db/product-options.ts'),model=f.h.load('app/product-options.ts'),previous=await db.readProductOptions('owner',f.id);
 const rows=model.optionInputs(previous);rows.find(row=>row.id==='synthetic-two').included=false;
 const product=await f.h.load('db/queries.ts').findProduct('owner',f.id);
 assert.ok(await db.saveProductOptions('owner',model.applyOptionRows(previous,rows,new Date().toISOString()),previous.revision,product.updated_at));
}
function uiFor(f,view){
 return quotationAiUI({productId:f.id,profileId:f.profile.id,view,disabled:false},async(url,init)=>url==='/api/supplier-hub/catalog-context'
  ?f.h.load('app/api/supplier-hub/catalog-context/route.ts').GET()
  :f.h.route(url,{method:init?.method??'GET',body:init?.body?JSON.parse(init.body):undefined}),
 'app/components/supplier-hub-single-review.tsx','SupplierHubSingleReview');
}
function uiText(ui){
 return nodes(ui.render()).flatMap(node=>{const children=node.props?.children;return Array.isArray(children)?children.filter(value=>typeof value==='string'):typeof children==='string'?[children]:[];}).join('\n');
}

for(const company of companies)test(company.name+': settings-only changes cannot prepare a new Single payload against an old reviewed editor',async()=>{
 const f=await assetApiFixture(company);let ui;
 try{
  const initial=await fields(f),stale=await json(await f.h.route(f.base+'/quotation-fields'+f.query,{method:'PUT',body:{expectedRevision:initial.revision,expectedInputFingerprint:initial.inputFingerprint,
   changes:[{fieldKey:'title',optionId:null,value:'사용자가 검토·저장한 견적 제목'}]}}));
  const old=await candidate(f),brand=f.byWire(['productPage','brand']),bytes=f.objectState();
  assert.equal(old.inputFingerprint,stale.inputFingerprint);assert.equal(client.singlePackageCurrent(old,stale,f.id),true);
  assert.equal(stale.resolved.rows.find(row=>row.optionId==='synthetic-one').fields[brand].value,'검토 브랜드');
  await changeSettings(f);
  const fresh=await fields(f),next=await candidate(f);
  assert.deepEqual(clocks(fresh),clocks(stale));assert.notEqual(fresh.inputFingerprint,stale.inputFingerprint);
  assert.equal(next.inputFingerprint,fresh.inputFingerprint);assert.notEqual(next.fingerprint,old.fingerprint);
  assert.equal(next.payload.jsonDocument[0].productPage.brand,'다른 기기에서 변경한 브랜드');
  assert.equal(client.singlePackageCurrent(next,stale,f.id),false);assert.equal(client.singlePackageCurrent(next,fresh,f.id),true);
  await json(await f.prepare(old.fingerprint),409);assert.equal(publicKeys(f).length,0);
  ui=uiFor(f,stale);await ui.idle();await ui.click('개별 견적 자료 검토');
  assert.equal(ui.button('이미지 전송 자료 준비').props.disabled,true);
  assert.ok(ui.alerts().some(message=>message.includes('최신 견적 입력')));
  assert.equal(ui.calls.filter(call=>call.method==='POST').length,0);assert.equal(publicKeys(f).length,0);
  ui.render({productId:f.id,profileId:f.profile.id,view:fresh,disabled:false});await ui.idle();await ui.click('개별 견적 자료 검토');
  assert.equal(ui.button('이미지 전송 자료 준비').props.disabled,false);assert.deepEqual(ui.alerts(),[]);
  await ui.click('이미지 전송 자료 준비');assert.match(uiText(ui),/전송 자료가 준비됐습니다/);
  const prepared=await candidate(f);assert.equal(prepared.prepared,true);assert.equal(prepared.inputFingerprint,fresh.inputFingerprint);
  const packet=plain(await client.singlePackagePacket(prepared,'owner','synthetic-one'));
  assert.equal(packet.body.productName,'사용자가 검토·저장한 견적 제목');assert.equal(packet.body.jsonDocument[0].productPage.brand,'다른 기기에서 변경한 브랜드');
  assert.deepEqual(packet.company,company);assert.deepEqual(prepared.options.map(row=>row.optionId),['synthetic-one','synthetic-two']);
  assert.equal(f.objectState(),bytes);assert.deepEqual(f.h.network,[]);assert.equal(SINGLE_DOCUMENT_LIVE_VERIFIED,false);
  await assert.rejects(dispatchSingleDocument({type:'YOOFAM_SINGLE_DOCUMENT_REQUEST',action:'start',packet},SINGLE_SENDER),error=>error.code==='SINGLE_LIVE_CONTRACT_UNVERIFIED');
 }finally{ui?.unmount();f.close();}
});

for(const company of companies)test(company.name+': linked captured drafts retain exact queryless and explicit editor metadata while preparing local Single assets',async()=>{
 const f=await assetApiFixture(company);try{
  // Inert source identifiers only: no collect/intake/source request is made.
  const offerId='630000719001',sourceUrl='https://detail.1688.com/offer/'+offerId+'.html';
  f.h.sqlite.prepare('UPDATE products SET source_url=? WHERE id=?').run(sourceUrl,f.id);
  f.h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=? WHERE id=?').run(offerId,sourceUrl,'job');
  f.h.context.category=f.profile;
  f.h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(f.h.context),'job');
  f.h.sqlite.prepare('INSERT INTO collection_products(job_id,owner_id,product_id,created_at) VALUES(?,?,?,?)').run('job','owner',f.id,new Date().toISOString());
  const contextBefore=f.h.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get('job').payload,bytes=f.objectState();
  await changeSettings(f);
  const byScope=[];
  for(const query of ['',f.query]){
   const view=await json(await f.h.route(f.base+'/quotation-fields'+query)),initial=await json(await f.h.route(f.base+'/supplier-hub-single-package'+query));
   assert.equal(view.categoryContext.source,query?'profile':'collection');assert.equal(initial.inputFingerprint,view.inputFingerprint);
   assert.equal(initial.payload.jsonDocument[0].productPage.brand,'검토 브랜드','captured settings remain authoritative despite newer workspace settings');
   assert.equal(client.singlePackageCurrent(initial,view,f.id),true);
   const prepared=await json(await f.h.route(f.base+'/supplier-hub-single-package'+query,{method:'POST',body:{action:'prepare',expectedFingerprint:initial.fingerprint}}));
   assert.equal(prepared.prepared,true);assert.equal(prepared.inputFingerprint,view.inputFingerprint);assert.equal(prepared.fingerprint,initial.fingerprint);
   assert.deepEqual(plain(prepared.company),company);assert.deepEqual(prepared.options.map(row=>row.optionId),['synthetic-one','synthetic-two']);
   byScope.push({view,prepared});
  }
  assert.notEqual(byScope[0].view.inputFingerprint,byScope[1].view.inputFingerprint);
  assert.equal(client.singlePackageCurrent(byScope[0].prepared,byScope[1].view,f.id),false);
  assert.equal(client.singlePackageCurrent(byScope[1].prepared,byScope[0].view,f.id),false);
  assert.equal(f.h.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get('job').payload,contextBefore);
  assert.equal(f.objectState(),bytes);assert.deepEqual(f.h.network,[]);assert.equal(SINGLE_DOCUMENT_LIVE_VERIFIED,false);
 }finally{f.close();}
});

test('a same-ID category schema revision with equal product clocks requires a fresh editor snapshot',async()=>{
 const f=await assetApiFixture();try{
  const stale=await fields(f),old=await candidate(f),brand=f.byWire(['productPage','brand']);await changeProfile(f);
  const fresh=await fields(f),next=await candidate(f);
  assert.deepEqual(clocks(fresh),clocks(stale));assert.deepEqual(plain(fresh.categoryContext),plain(stale.categoryContext));
  assert.equal(fresh.resolved.schema.fields.find(field=>field.id===brand).maxLength,7);
  assert.notEqual(next.source.profileRevision,old.source.profileRevision);assert.notEqual(fresh.inputFingerprint,stale.inputFingerprint);
  assert.equal(next.inputFingerprint,fresh.inputFingerprint);assert.equal(client.singlePackageCurrent(next,stale,f.id),false);
  assert.equal(client.singlePackageCurrent(next,fresh,f.id),true);await json(await f.prepare(old.fingerprint),409);
  assert.equal((await json(await f.prepare(next.fingerprint))).prepared,true);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('missing, malformed and mismatched metadata fail closed without changing existing clock and option guards',async()=>{
 const f=await assetApiFixture();try{
  const view=await fields(f),value=await candidate(f);assert.equal(client.singlePackageCurrent(value,view,f.id),true);
  const missing={...value};delete missing.inputFingerprint;assert.equal(client.singlePackageCurrent(missing,view,f.id),false);
  for(const inputFingerprint of [null,42,'','bad','A'.repeat(64),'0'.repeat(64)])assert.equal(client.singlePackageCurrent({...value,inputFingerprint},view,f.id),false);
  for(const key of ['contentRevision','optionRevision','revision'])assert.equal(client.singlePackageCurrent(value,{...view,[key]:view[key]+1},f.id),false,key);
  assert.equal(client.singlePackageCurrent(value,{...view,productVersion:'2026-01-01T00:00:00.000Z'},f.id),false);
  const wrongOptions=plain(view);wrongOptions.resolved.rows.find(row=>row.optionId==='synthetic-two').included=false;
  assert.equal(client.singlePackageCurrent(value,wrongOptions,f.id),false);
  assert.equal(client.singlePackageCurrent({...value,productId:'other-product'},view,f.id),false);assert.equal(publicKeys(f).length,0);
 }finally{f.close();}
});

for(const [kind,change]of [['settings',changeSettings],['profile',changeProfile],['options',changeOptions]])test(kind+' changing between export and exact editor reads rejects the mismatched source pair',async()=>{
 const f=await assetApiFixture();try{
  const snapshot=f.h.load('app/quotation-fields-snapshot.ts'),original=snapshot.stableQuotationFieldsView;let changed=false;
  snapshot.stableQuotationFieldsView=async(...args)=>{if(!changed){changed=true;await change(f);}return original(...args);};
  const bytes=f.objectState(),result=await json(await f.h.route(f.endpoint),409);
  assert.equal(result.code,'SINGLE_SOURCE_CHANGED');assert.equal(changed,true);assert.equal(publicKeys(f).length,0);
  assert.equal(f.objectState(),bytes);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('an option change after the paired editor read is still rejected by the final full source guard',async()=>{
 const f=await assetApiFixture();try{
  const head=f.h.bindings.FILES.head;let changed=false;
  f.h.bindings.FILES.head=async key=>{const metadata=await head(key);if(!changed&&key===f.keys[0]){changed=true;await changeOptions(f);}return metadata;};
  const bytes=f.objectState(),result=await json(await f.h.route(f.endpoint),409);
  assert.equal(result.code,'SINGLE_SOURCE_CHANGED');assert.equal(changed,true);assert.equal(publicKeys(f).length,0);
  assert.equal(f.objectState(),bytes);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('response metadata leaves operation fingerprint, exact packet body, source and receipt identity unchanged',async()=>{
 const f=await assetApiFixture();try{
  const view=await fields(f),initial=await candidate(f),prepared=await json(await f.prepare(initial.fingerprint));
  assert.equal(prepared.fingerprint,initial.fingerprint);assert.equal(prepared.inputFingerprint,view.inputFingerprint);
  const first=plain(await client.singlePackagePacket(prepared,'owner','synthetic-one'));
  const second=plain(await client.singlePackagePacket({...prepared,inputFingerprint:'f'.repeat(64)},'owner','synthetic-one'));
  const {requestId:firstRequest,...firstIdentity}=first,{requestId:secondRequest,...secondIdentity}=second;
  assert.notEqual(firstRequest,secondRequest);assert.deepEqual(firstIdentity,secondIdentity);
  assert.equal(Object.hasOwn(first,'inputFingerprint'),false);assert.equal(Object.hasOwn(first.source,'inputFingerprint'),false);
  const proof=await singleDocumentIdentity(first,SINGLE_SENDER),other=await singleDocumentIdentity(second,SINGLE_SENDER);
  assert.equal(proof.bodySha256,other.bodySha256);assert.equal(proof.originalBodySha256,other.originalBodySha256);
  assert.deepEqual(plain(proof.identity),plain(other.identity));assert.equal(proof.identity.fingerprint,prepared.fingerprint);
  assert.equal(SINGLE_DOCUMENT_LIVE_VERIFIED,false);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});
