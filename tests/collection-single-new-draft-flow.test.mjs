import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {collectionSingleNewDraftFixture,forkCompanies,json,plain,singleNewDraftQueue,text} from './helpers/collection-single-new-draft.mjs';

const traces=[];
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const sourceFiles=['db/collection-forks.ts','app/components/intake-queue-panel.tsx'];
const sourceHashes=()=>Object.fromEntries(sourceFiles.map(file=>[file,hash(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'))]));
const frozen=sourceHashes();
test.after(()=>{assert.deepEqual(sourceHashes(),frozen);fs.writeFileSync(new URL('../outputs/step706-single-fork-api-proof.json',import.meta.url),JSON.stringify({format:'step706-single-fork-api-proof-v1',sourceHashes:frozen,traces,
 boundary:'Actual React callbacks and local route handlers/SQLite/R2 with synthetic source/schema/workbook/image/AI fixtures. No browser, seller or Hub requests; no existing operating products changed.'},null,2)+'\n');});

for(const company of forkCompanies)test(`Single queue conflict exposes review and continues only the new product through editable quotation (${company.code})`,async()=>{
 const f=await collectionSingleNewDraftFixture(company),ui=singleNewDraftQueue(f);try{
  const before=f.originalSnapshot(),files=new Map([...f.api.objects].map(([key,bytes])=>[key,bytes.slice()]));await ui.click('시작 (');
  assert.equal(ui.rows[0].status,'error');assert.equal(ui.rows[0].forkJobId,f.oldJobId);assert.ok(ui.button('저장 원문으로 새 초안'));assert.equal(ui.button('기존 대기 요청 확인'),undefined);assert.equal(ui.collections.length,0);
  await ui.click('저장 원문으로 새 초안');assert.ok(ui.button('새 초안 생성'),text(ui.render()));assert.equal(ui.calls.filter(call=>call.method==='POST'&&call.url.includes('/new-draft')).length,0);
  const create=ui.button('새 초안 생성').props.onClick;create();create();await ui.settle(()=>ui.rows[0].status==='saved'||ui.rows[0].status==='error'&&Boolean(ui.rows[0].productId));
  assert.equal(ui.rows[0].status,'saved',text(ui.render()));const productId=ui.rows[0].productId;assert.ok(productId);assert.notEqual(productId,f.sourceProductId);
  assert.equal(ui.calls.filter(call=>call.method==='POST'&&call.url.includes('/new-draft')).length,1);assert.equal(ui.collections.length,1);assert.equal(ui.collections[0].id===f.oldJobId,false);
  assert.deepEqual(ui.opened,[productId]);assert.equal(f.originalSnapshot(),before);assert.equal(f.api.objects.size,files.size);for(const[key,bytes]of files)assert.deepEqual(f.api.objects.get(key),bytes);
  const base='/api/products/'+productId,content=await json(await f.api.route(base+'/content')),options=await json(await f.api.route(base+'/options')),quote=await json(await f.api.route(base+'/quotation-fields'));
  assert.equal(quote.categoryContext.profileId,f.target.id);assert.equal(quote.categoryContext.categoryId,f.target.categoryId);assert.deepEqual(plain(quote.categoryContext.categoryPath),plain(f.target.categoryPath));
  assert.equal(options.options.rows[0].unitCostCny,5);assert.equal(options.options.rows[0].minimumOrderQuantity,2);assert.equal(options.options.rows[0].stock,3);
  assert.equal(content.content.seo.title.value.includes('이전 수동'),false);assert.equal(quote.resolved.rows.filter(row=>row.included).length,1);assert.equal(f.api.network.length,0);
  const receipts=['supplier_hub_receipts','supplier_hub_single_receipts'].map(table=>f.api.sqlite.prepare('SELECT count(*) n FROM '+table).get().n);assert.deepEqual(receipts,[0,0]);
  traces.push({company,kind:'actual-queue-single-fork',uiRequests:ui.calls.length,localHandlerRequests:f.api.calls.length,forkRequests:f.events.filter(item=>item&&typeof item==='object').length,
   productId,oldProductId:f.sourceProductId,template:f.target.template,oneCreationPost:true,currentCategoryAndSettings:true,existingProductAndSourceSha256:hash(before),existingPreserved:f.originalSnapshot()===before,
   externalRequests:f.api.network.length,remoteReceipts:receipts});
 }finally{ui.close();f.close();}
});

for(const company of forkCompanies)test(`Single pending source is reviewed and promoted separately before its current-input fork (${company.code})`,async()=>{
 const f=await collectionSingleNewDraftFixture(company);let ui;try{
  const original=f.originalSnapshot(),sourceUrl='https://detail.1688.com/offer/900000007061.html',context={...f.api.context,company,category:f.original,settings:{...f.settings,brand:'준비 당시 브랜드'},features:'준비 당시 특징',keywords:''};
  const [job]=await f.api.load('db/collection-jobs.ts').enqueueCollection('owner',[{offerId:'900000007061',sourceUrl,goal:'collect'}],context);
  await json(await f.api.route(`/api/collection-jobs/${job.id}/result`,{method:'POST',body:{schemaVersion:1,sourceUrl,provider:'synthetic-local-706',collectedAt:new Date().toISOString(),title:'합성 대기 원문',description:'보존할 원문',attributes:[],options:[{sku:'SYNTHETIC-706-PENDING',name:'합성 단일 옵션',unitPriceCny:7,minimumOrder:2,stock:0}],images:[]}}));
  const oldRequest=JSON.stringify(f.api.sqlite.prepare('SELECT * FROM collection_jobs WHERE id=?').get(job.id)),oldContext=f.api.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get(job.id).payload;
  ui=singleNewDraftQueue({...f,oldJobId:job.id,sourceUrl},{pending:true,collect:false});assert.ok(ui.button('기존 대기 요청 확인'));assert.equal(ui.button('저장 원문으로 새 초안'),undefined);
  await ui.click('기존 대기 요청 확인');assert.ok(ui.button('원문 준비 후 새 초안 검토'),text(ui.render()));assert.ok(ui.calls.every(call=>call.method==='GET'));
  await ui.click('원문 준비 후 새 초안 검토');await ui.settle(()=>Boolean(ui.button('새 초안 생성')));
  assert.equal(ui.calls.filter(call=>call.url.endsWith('/collect')).length,0);assert.equal(ui.calls.filter(call=>call.url.endsWith('/product')&&call.method==='POST').length,1);assert.equal(ui.collections.length,0);assert.deepEqual(ui.opened,[]);
  const sourceId=f.api.sqlite.prepare('SELECT product_id FROM collection_products WHERE job_id=?').get(job.id).product_id;
  const sourceState=()=>JSON.stringify(['products','product_content','product_options','product_price_policy','product_quotation_fields'].map(table=>[table,f.api.sqlite.prepare(`SELECT * FROM ${table} WHERE ${table==='products'?'id':'product_id'}=?`).get(sourceId)??null]));
  const sourceBefore=sourceState();await ui.click('새 초안 생성');await ui.settle(()=>ui.rows[0].status==='saved');
  assert.notEqual(ui.rows[0].productId,sourceId);assert.notEqual(ui.rows[0].productId,f.sourceProductId);assert.equal(ui.calls.filter(call=>call.url.includes('/new-draft')&&call.method==='POST').length,1);
  assert.equal(ui.collections.length,1);assert.equal(ui.collections[0].context.category.id,f.target.id);assert.equal(ui.collections[0].context.category.template,null);assert.equal(ui.collections[0].context.settings.brand,f.settings.brand);
  assert.equal(sourceState(),sourceBefore);assert.equal(f.originalSnapshot(),original);assert.equal(JSON.stringify(f.api.sqlite.prepare('SELECT * FROM collection_jobs WHERE id=?').get(job.id)),oldRequest);assert.equal(f.api.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get(job.id).payload,oldContext);
  assert.equal(f.api.sqlite.prepare('SELECT count(*) n FROM products').get().n,3);assert.deepEqual(f.api.network,[]);for(const table of ['supplier_hub_receipts','supplier_hub_single_receipts'])assert.equal(f.api.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,0);
  traces.push({company,kind:'actual-pending-source-single-fork',uiRequests:ui.calls.length,localHandlerRequests:f.api.calls.length,sourcePromotionPosts:1,collectionRequests:0,newDraftPosts:1,
   protectedProductId:f.sourceProductId,pendingSourceProductId:sourceId,newDraftProductId:ui.rows[0].productId,protectedOriginalPreserved:true,pendingSourcePreserved:true,externalRequests:0,remoteReceipts:0,
   downstreamDraftStage:'Local onJob adapter after actual fork persistence; this case asserts source preparation and fork only. The other two traces run actual draft staging.'});
 }finally{ui?.close();f.close();}
});
