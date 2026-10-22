import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
import {intakeOwnerScopeHarness,intakeScopeCompanies} from './helpers/intake-owner-scope.mjs';
const companies=[{companyCode:'A01526306',companyName:'유앤채'},{companyCode:'A01464742',companyName:'와이홉'}];
const id='79000000-0000-4000-8000-000000000001';
const plain=value=>JSON.parse(JSON.stringify(value));
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
function source(h){return {schemaVersion:1,sourceUrl:h.sourceUrl,offerId:'813724060928',provider:'public-product-jsonld-v1',collectedAt:'2026-10-01T00:00:00.000Z',title:'합성 서버 수집 상품',description:'합성 수집 검수용 원문',
 options:[{sku:'synthetic-query-sku',name:'검정',unitPriceCny:5.3,minimumOrder:null,stock:0,color:'黑色',size:'合成尺寸'}],images:[]};}
const protectedState=h=>JSON.stringify(['products','product_options','product_content','product_price_policy','collection_products','collection_images'].map(table=>[table,h.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
async function fixture(company){const h=mobileIntakeHarness(company),api=h.load('app/api/query-captures/route.ts');let queries=0;
 h.load('app/product-query.ts').queryProductSource=async()=>{queries++;return {source:source(h),sourceStored:false,draftCreated:false,provider:'public-page',offerId:'813724060928'};};
 const body={id,sourceUrl:h.sourceUrl,expectedOwnerId:'owner',expectedCompany:{code:company.companyCode,name:company.companyName}};
 const send=(value=body,extra={})=>api.POST(new Request('https://app.test/api/query-captures',{method:'POST',headers:{origin:'https://app.test','content-type':'application/json',...extra.headers},body:JSON.stringify(value),signal:extra.signal}));
 return {h,api,body,send,get queries(){return queries;}};}

for(const company of companies)test(`${company.companyCode}: server URL collection persists exact source before category, then category-bound import performs no supplier request`,async()=>{
 const f=await fixture(company),{h}=f;try{
  const protectedBefore=protectedState(h),stored=await json(await f.send());assert.equal(stored.sourceStored,true);assert.equal(stored.draftCreated,false);assert.equal(stored.duplicate,false);
  assert.equal(f.queries,1);assert.deepEqual(stored.item.snapshot,source(h));assert.equal(protectedState(h),protectedBefore);
  const summaries=await json(await f.api.GET());assert.equal(summaries.captures.length,1);assert.equal(summaries.captures[0].snapshot,undefined);
  const capture=h.load('app/source-capture-selection.ts').querySourceCaptureSelection(summaries.captures[0]);
  const collected=await json(await h.route('/api/collection-jobs/job/collect',{method:'POST',body:{browserCapture:capture}}));
  assert.deepEqual(collected.receipt.result,source(h));assert.equal(f.queries,1);assert.deepEqual(h.network,[]);
  const imported=await json(await h.route('/api/collection-jobs/job/product',{method:'POST',body:{expectedSource:{capture,receivedAt:collected.receipt.receivedAt}}}));
  assert.equal(imported.reused,false);assert.equal(h.sqlite.prepare('SELECT source_price_cny FROM products WHERE id=?').get(imported.productId).source_price_cny,5.3);
  h.sqlite.prepare('UPDATE products SET title=? WHERE id=?').run('사용자가 수정 중인 보호 상품',imported.productId);
  const before=protectedState(h),retry=await json(await h.route('/api/collection-jobs/job/product',{method:'POST',body:{expectedSource:{capture,receivedAt:collected.receipt.receivedAt}}}),409);
  assert.equal(retry.code,'SOURCE_SELECTION_EXISTING_PRODUCT');assert.equal(protectedState(h),before);assert.deepEqual(h.network,[]);assert.equal(h.aiSources.length,0);
 }finally{h.close();}
});

test('uncertain store ACK is recovered by same ID without provider repeat; clients cannot submit replacement raw source',async()=>{
 const f=await fixture(companies[0]);try{
  const first=await json(await f.send()),before=protectedState(f.h),again=await json(await f.send());assert.equal(again.duplicate,true);assert.deepEqual(again.item,first.item);assert.equal(f.queries,1);
  await json(await f.send({...f.body,source:source(f.h)}),400);await json(await f.send({...f.body,sourceUrl:'https://detail.1688.com/offer/790000000002.html'}),409);
  await json(await f.send(f.body,{headers:{origin:'https://foreign.test'}}),403);
  await json(await f.send({...f.body,expectedOwnerId:'foreign-owner'}),409);assert.equal(f.queries,1);assert.equal(protectedState(f.h),before);assert.deepEqual(f.h.network,[]);
 }finally{f.h.close();}
});

test('capture archive and restore APIs preserve source, reject stale revisions and never touch product rows',async()=>{
 const f=await fixture(companies[0]),{h}=f;try{
  const first=await json(await f.send()),before=protectedState(h),patch=(action,revision,extra={})=>f.api.PATCH(new Request('https://app.test/api/query-captures',{method:'PATCH',headers:{origin:'https://app.test','content-type':'application/json'},body:JSON.stringify({id,action,expectedRevision:revision,expectedOwnerId:'owner',expectedCompany:f.body.expectedCompany,...extra})}));
  const archived=await json(await patch('archive',1));assert.equal(archived.item.revision,2);assert.equal(archived.item.snapshot,undefined);assert.ok(archived.item.archivedAt);
  assert.equal((await json(await f.api.GET())).captures.length,0);assert.equal((await json(await f.api.GET(new Request('https://app.test/api/query-captures?view=archived')))).captures.length,1);
  await json(await patch('restore',1),409);await json(await patch('restore',2,{expectedOwnerId:'foreign'}),409);await json(await patch('restore',2,{expectedCompany:{code:'A01464742',name:'와이홉'}}),409);
  const restored=await json(await patch('restore',2));assert.equal(restored.item.revision,3);assert.equal(restored.item.archivedAt,null);
  const item=await h.load('db/query-source-captures.ts').readQuerySourceCapture('owner',id);assert.equal(item.fingerprint,first.item.fingerprint);assert.deepEqual(plain(item.snapshot),first.item.snapshot);assert.equal(protectedState(h),before);
  await json(await f.api.GET(new Request('https://app.test/api/query-captures?view=all')),400);
 }finally{h.close();}
});

test('query capture rejects changed scope, cancellation, invalid selector and a conflicting stored receipt',async()=>{
 const f=await fixture(companies[0]),{h}=f;try{
  const stored=await json(await f.send()),capture={format:'yoofam-saved-query-capture-v1',sourceUrl:h.sourceUrl,captureId:stored.item.id,fingerprint:stored.item.fingerprint,revision:stored.item.revision};
  const resolver=h.load('app/owned-source-capture.ts');
  for(const change of [{...capture,fingerprint:'0'.repeat(64)},{...capture,revision:2},{...capture,sourceUrl:'https://detail.1688.com/offer/790000000002.html'}])await assert.rejects(resolver.parseOwnedSourceCapture('owner',change,h.sourceUrl));
  await assert.rejects(resolver.parseOwnedSourceCapture('foreign-owner',capture,h.sourceUrl));
  h.setCompany({code:'A01464742',name:'와이홉'});await assert.rejects(resolver.parseOwnedSourceCapture('owner',capture,h.sourceUrl));
  h.setCompany({code:'A01526306',name:'유앤채'});
  const controller=new AbortController();controller.abort();await json(await f.send({...f.body,id:'79000000-0000-4000-8000-000000000002'},{signal:controller.signal}),409);assert.equal(f.queries,1);
  await h.load('db/collection-results.ts').storeCollectionResult('owner','job',{...source(h),title:'먼저 보관한 별도 원문'});
  const before=protectedState(h),conflict=await json(await h.route('/api/collection-jobs/job/collect',{method:'POST',body:{browserCapture:capture}}),409);
  assert.equal(conflict.code,'SOURCE_SELECTION_CONFLICT');assert.equal(protectedState(h),before);assert.deepEqual(h.network,[]);
 }finally{h.close();}
});

test('a saved query cannot write into another company or unscoped pending job, or survive a mid-query company change',async()=>{
 const f=await fixture(companies[0]),{h}=f;try{
  const stored=await json(await f.send()),capture={format:'yoofam-saved-query-capture-v1',sourceUrl:h.sourceUrl,captureId:stored.item.id,fingerprint:stored.item.fingerprint,revision:stored.item.revision};
  for(const context of [{...h.context,company:{code:'A01464742',name:'와이홉'}},{...h.context,company:undefined}]){
   h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(context),'job');
   await json(await h.route('/api/collection-jobs/job/collect',{method:'POST',body:{browserCapture:capture}}),409);
   assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_results').get().n,0);
  }
  h.load('app/product-query.ts').queryProductSource=async()=>{h.setCompany({code:'A01464742',name:'와이홉'});return{source:source(h)};};
  const changed=await json(await f.send({...f.body,id:'79000000-0000-4000-8000-000000000002'}),409);assert.equal(changed.code,'QUERY_SCOPE_CHANGED');
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM query_source_captures').get().n,1);assert.deepEqual(h.network,[]);
 }finally{h.close();}
});

for(const mutation of ['revision','archived_at','company_code'])test(`query source ${mutation} changes inside promotion transaction cannot create product rows`,async()=>{
 const f=await fixture(companies[0]),{h}=f;try{
  const stored=await json(await f.send()),capture={format:'yoofam-saved-query-capture-v1',sourceUrl:h.sourceUrl,captureId:stored.item.id,fingerprint:stored.item.fingerprint,revision:stored.item.revision};
  const receipt=await json(await h.route('/api/collection-jobs/job/collect',{method:'POST',body:{browserCapture:capture}}));
  const before=protectedState(h),batch=h.db.batch.bind(h.db),prepare=h.db.prepare.bind(h.db),sql=new WeakMap();let changed=false;
  h.db.prepare=text=>{const statement=prepare(text);sql.set(statement,text);return statement;};
  h.db.batch=async statements=>{if(!changed&&statements.some(value=>/^INSERT INTO products\(/u.test(sql.get(value)??''))){changed=true;
    h.sqlite.prepare(`UPDATE query_source_captures SET ${mutation}=? WHERE id=?`).run(mutation==='revision'?2:mutation==='archived_at'?'2026-10-01T00:00:00.000Z':'A01464742',id);}
    return batch(statements);};
  const result=await json(await h.route('/api/collection-jobs/job/product',{method:'POST',body:{expectedSource:{capture,receivedAt:receipt.receipt.receivedAt}}}),409);
  assert.equal(result.code,'SOURCE_SELECTION_CONFLICT');assert.ok(changed);assert.equal(protectedState(h),before);assert.deepEqual(h.network,[]);assert.equal(h.aiSources.length,0);
 }finally{h.close();}
});

test('saved query selector cannot recover ambiguous collect ACK using an unrelated result GET',async()=>{
 const recovery=providedOptionModule('app/intake-collection-recovery.ts'),requests=[];
 const capture={format:'yoofam-saved-query-capture-v1',sourceUrl:'https://detail.1688.com/offer/790000000001.html',captureId:id,fingerprint:'a'.repeat(64),revision:1};
 await assert.rejects(recovery.requestIntakeCollectionReceipt({id:'job',offer_id:'790000000001',source_url:capture.sourceUrl},'collect',{signal:new AbortController().signal,capture,fetcher:async(path)=>{requests.push(path);throw Error('synthetic lost ACK');}}),/선택한 수집본/);
 assert.deepEqual(requests,['/api/collection-jobs/job/collect']);
});

test('query selection refuses an already-linked product before any import, image, translation or source request',async()=>{
 const exports={},imports=[];vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/intake-collection.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,AbortSignal,require(name){if(name==='@/app/collection-batch')return {importReceivedJobs:()=>imports.push(true)};return providedOptionModule(name.slice(2)+'.ts');}});
 const capture={format:'yoofam-saved-query-capture-v1',sourceUrl:'https://detail.1688.com/offer/790000000001.html',captureId:id,fingerprint:'a'.repeat(64),revision:1};
 await assert.rejects(exports.collectIntakeProduct({id:'job',offer_id:'790000000001',source_url:capture.sourceUrl,product_id:'protected-product',received_at:'2026-10-01T00:00:00.000Z'},{selectedCapture:capture,signal:new AbortController().signal,fetcher:()=>assert.fail('no requests'),onJob:()=>assert.fail('no published product'),onProgress(){}}),/기존 상품/);
 assert.equal(imports.length,0);
});

for(const company of intakeScopeCompanies)test(`${company.code}: actual category picker and explicit start forward saved query proof without a browser inbox row`,async()=>{
 const capture={format:'yoofam-saved-query-capture-v1',sourceUrl:'https://detail.1688.com/offer/790000000001.html',captureId:id,fingerprint:'a'.repeat(64),revision:1};
 const h=intakeOwnerScopeHarness(company,{sourceSeed:{id:'query-seed',sourceUrl:capture.sourceUrl,title:'합성 서버 수집본',sourceCapture:capture}});try{
  const before=plain(h.rows[0]);nodes(h.render()).find(node=>node.type?.name==='CategoryPicker').props.onSelected(h.profile);h.render();
  h.button('이 상품 초안 작성').props.onClick();await h.settle();assert.equal(h.posts.length,1);assert.equal(h.collections.length,1);assert.deepEqual(plain(h.collections[0].callbacks.selectedCapture),capture);
  assert.equal(h.posts[0].body.urls[0],capture.sourceUrl);assert.deepEqual(plain(h.rows[0]),before);h.collections[0].resolve('합성 초안 작성 완료');await h.settle();
  assert.equal(h.rows[1].status,'saved');assert.deepEqual(plain(h.rows[0]),before);
 }finally{h.close();}
});
