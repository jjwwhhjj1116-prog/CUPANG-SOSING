import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {sizeChartApiFixture,companies,json,plain,allTables} from './helpers/supplier-hub-single-size-chart.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex'),proofs=[];
const proofFiles=['db/product-labels.ts','app/api/products/[id]/product-labels/route.ts','app/product-label.ts','app/product-label-proof.ts','app/product-label-upload.ts','tests/product-label-rewrite-api.test.mjs'];
const hashes=()=>Object.fromEntries(proofFiles.map(file=>[file,sha(fs.readFileSync(new URL('../'+file,import.meta.url)))]));
let frozen;
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'));
const structure=[{id:'productName',label:'확인 제품명',required:true},{id:'custom_storage',label:'보관 방법',required:false},{id:'material',label:'확인 재질',required:false}];

function protectedState(f){
 return JSON.stringify(JSON.parse(allTables(f)).map(([table,rows])=>[table,table==='product_labels'?rows.filter(row=>row.product_id!==f.id):table==='products'?rows.map(row=>{if(row.id!==f.id)return row;const value={...row};delete value.updated_at;delete value.quote_status;return value;}):rows]));
}
function requestContext(f,path=f.base+'/product-labels'+f.query){return{url:'https://app.test'+path,context:{params:Promise.resolve({id:path.split('?')[0].split('/')[3]})}};}
function guardedRoute(f,auth){
 const exports={},source=fs.readFileSync(new URL('../app/api/products/[id]/product-labels/route.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,Request,Response,TextEncoder,process:{env:{NODE_ENV:'production'}},require(name){if(name==='next/server')return{NextResponse:Response};if(name==='cloudflare:workers')return{env:f.h.bindings};if(name==='@/app/chatgpt-auth')return auth;assert.ok(name.startsWith('@/'));return f.h.load(name.slice(2)+'.ts');}});
 return exports;
}
async function sourceGuard(f,view){
 const product=await f.h.load('db/queries.ts').findProduct('owner',f.id),settings=await f.h.load('db/queries.ts').getSettings('owner'),profile=await f.h.load('db/category-profiles.ts').getCategoryProfile('owner',f.profile.id);
 return{productVersion:view.productVersion,imageKeys:product.image_keys,pricingPolicy:product.pricing_policy??null,contentRevision:view.contentRevision,optionRevision:view.optionRevision,quotationRevision:view.quotationRevision,settingsPayload:settings?.payload??null,profile:{id:profile.id,revision:profile.revision},collection:null};
}

for(const company of companies)test(`explicit label rewrite advances only the epoch and source clocks with strict ownership/CAS (${company.code})`,async()=>{
 frozen??=hashes();const f=await sizeChartApiFixture(company),{h}=f,endpoint=f.base+'/product-labels'+f.query,calls=[];
 const route=h.load('app/api/products/[id]/product-labels/route.ts');
 const call=async(method='GET',body,options={})=>{const {url,context}=requestContext(f,options.path??endpoint),response=await (options.route??route)[method](new Request(url,{method,headers:{'content-type':'application/json',...options.headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})}),context);calls.push({method,status:response.status});return response;};
 const read=()=>call().then(json),body=view=>({expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint});
 const save=(view,changes,nextStructure)=>call('PUT',{...body(view),changes,...(nextStructure===undefined?{}:{structure:nextStructure})});
 try{
  // Explicit legacy fixture: new intakes now seed a structure, while this case
  // verifies old products without a stored label row and their original PNG.
  h.sqlite.prepare('DELETE FROM product_labels WHERE product_id=? AND owner_id=?').run(f.id,'owner');
  let view=await read();assert.equal(view.revision,0);assert.equal(Object.hasOwn(view,'renderEpoch'),false);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM product_labels WHERE product_id=?').get(f.id).n,0);
  const foreign={...h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.id),id:'foreign-rewrite-product',owner_id:'foreign-owner'},columns=Object.keys(foreign);
  h.sqlite.prepare(`INSERT INTO products(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(key=>foreign[key]));
  const foreignState={schemaVersion:1,productId:foreign.id,revision:1,overrides:{common:{material:'외부 계정 수동 값'},options:{}},updatedAt:foreign.updated_at,renderEpoch:7};
  h.sqlite.prepare('INSERT INTO product_labels(product_id,owner_id,revision,payload,updated_at) VALUES(?,?,?,?,?)').run(foreign.id,foreign.owner_id,1,JSON.stringify(foreignState),foreign.updated_at);

  // A valid old generated PNG and a manual file are retained. The exact old
  // recipe is later inspected through real metadata helpers, without pixels
  // or an external upload/provider being involved.
  const model=h.load('app/product-label.ts'),proof=h.load('app/product-label-proof.ts'),upload=h.load('app/product-label-upload.ts'),uploadContext={productId:f.id,endpoint,optionId:'synthetic-one',view};
  const oldUpload=await upload.productLabelUploadId(uploadContext),oldKey=h.load('app/label-upload-key.ts').labelUploadKey('owner',oldUpload);
  const product=h.sqlite.prepare('SELECT image_keys FROM products WHERE id=?').get(f.id),pool=JSON.parse(product.image_keys);h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify([...pool,oldKey]),f.id);
  const quoteTarget=h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(f.view.resolved.schema.fields,'labelImages');
  await f.edit([['synthetic-one',oldKey],['synthetic-two',''],['synthetic-excluded','owner/label.png']].flatMap(([optionId,value])=>quoteTarget.linked.map(fieldKey=>({optionId,fieldKey,value}))));
  view=await read();assert.equal(await upload.productLabelUploadId({...uploadContext,view}),oldUpload);
  const metadata=await proof.verifiedProductLabelMetadata(proof.productLabelProofRequest({...uploadContext,view}),view,oldUpload);
  assert.equal(Object.hasOwn(metadata,'productLabelRenderEpoch'),false);
  await h.bindings.FILES.put(oldKey,png,{httpMetadata:{contentType:'image/png'},customMetadata:{...metadata,labelUploadId:oldUpload,labelBlobSha256:sha(png)}});
  const quote=()=>f.route(f.base+'/quotation-fields'+f.query).then(json);
  const inspect=async()=>proof.inspectGeneratedProductLabels({ownerId:'owner',productId:f.id,profileId:f.profile.id,resolved:(await quote()).resolved,head:key=>h.bindings.FILES.head(key),readView:()=>read()});
  assert.deepEqual(plain(await inspect()),[]);
  const before=plain(view),protectedBefore=protectedState(f),fileBefore=f.objectState(),oldQuotes=plain((await quote()).overrides),oldPlan=plain(model.productLabelPlan(view,'synthetic-one'));
  view=await json(await call('POST',body(before)));assert.equal(view.renderEpoch,1);assert.equal(view.revision,1);assert.ok(Date.parse(view.productVersion)>Date.parse(before.productVersion));assert.notEqual(view.inputFingerprint,before.inputFingerprint);
  assert.deepEqual(plain(view.rows),before.rows);assert.deepEqual(plain(view.overrides),before.overrides);assert.equal(Object.hasOwn(view,'structure'),false);assert.deepEqual(plain(view.imageKeys),before.imageKeys);
  for(const key of ['contentRevision','optionRevision','quotationRevision','categoryContext'])assert.deepEqual(plain(view[key]),plain(before[key]));
  assert.notEqual(view.quotationInputFingerprint,before.quotationInputFingerprint,'the quotation source fingerprint follows the advanced product clock without changing quotation values');
  assert.deepEqual(protectedState(f),protectedBefore);assert.equal(f.objectState(),fileBefore);assert.deepEqual(plain((await quote()).overrides),oldQuotes);
  const afterFirst=allTables(f);await json(await call('POST',body(before)),409);assert.equal(allTables(f),afterFirst);assert.equal((await read()).renderEpoch,1);
  const stale=plain(await inspect());assert.deepEqual(stale.map(issue=>({code:issue.code,optionId:issue.optionId})),[{code:'GENERATED_PRODUCT_LABEL_STALE',optionId:'synthetic-one'}]);assert.deepEqual(plain(model.productLabelPlan(view,'synthetic-one')),oldPlan);assert.notEqual(await upload.productLabelUploadId({...uploadContext,view}),oldUpload);

  view=await json(await save(view,[{optionId:null,fieldKey:'material',value:'공통 확인 재질'},{optionId:'synthetic-one',fieldKey:'material',value:''},{optionId:'synthetic-excluded',fieldKey:'material',value:'제외 옵션 직접 값'},{optionId:null,fieldKey:'custom_storage',value:'건조한 곳 보관'}],structure));
  assert.equal(view.renderEpoch,1);assert.deepEqual(plain(view.structure),structure);assert.equal(view.rows.find(row=>row.optionId==='synthetic-one').values.material,'');
  const beforeSecond=plain(view);view=await json(await call('POST',body(view)));assert.equal(view.renderEpoch,2);assert.equal(view.revision,beforeSecond.revision+1);assert.deepEqual(plain(view.overrides),beforeSecond.overrides);assert.deepEqual(plain(view.structure),structure);assert.deepEqual(plain(view.rows),beforeSecond.rows);
  // A legacy internal value-only caller omits both optional arguments. Its
  // ordinary save must never erase the already persisted epoch or structure.
  const db=h.load('db/product-labels.ts'),internal=await db.saveProductLabels('owner',f.id,view.overrides,view.revision,await sourceGuard(f,view));assert.ok(internal);assert.equal(internal.renderEpoch,2);assert.deepEqual(plain(internal.structure),structure);view=await read();
  assert.deepEqual(plain(view.overrides),beforeSecond.overrides);assert.deepEqual(plain(view.structure),structure);assert.equal(view.renderEpoch,2);assert.deepEqual(protectedState(f),protectedBefore);assert.equal(f.objectState(),fileBefore);

  const unchanged=()=>allTables(f);let fixed=unchanged();
  for(const [method,invalid]of [['POST',{...body(view),renderEpoch:3}],['POST',{...body(view),changes:[]}],['POST',{...body(view),structure}],['POST',{...body(view),expectedRevision:-1}],['POST',{...body(view),expectedInputFingerprint:'0'.repeat(63)}],['POST',[]],['POST',null],['PUT',{...body(view),changes:[{optionId:null,fieldKey:'material',value:'오염'}],renderEpoch:3}]]){
   await json(await call(method,invalid),400);assert.equal(unchanged(),fixed);
  }
  await json(await call('POST',body(view),{headers:{origin:'https://foreign.example.test'}}),400);assert.equal(unchanged(),fixed);
  await json(await call('POST',' '.repeat(model.PRODUCT_LABEL_BODY_LIMIT+1)),413);assert.equal(unchanged(),fixed);
  await json(await call('POST',body(view),{path:endpoint+'&profileId='+f.profile.id}),400);assert.equal(unchanged(),fixed);
  await json(await call('POST',body(view),{path:f.base+'/product-labels?profileId=foreign-profile'}),404);assert.equal(unchanged(),fixed);
  await json(await call('POST',body(view),{path:endpoint.replace(f.id,foreign.id)}),404);assert.equal(unchanged(),fixed);
  const unauth=guardedRoute(f,{getChatGPTUser:async()=>null,getWorkspaceOwnerId:async()=>assert.fail('unverified production access cannot fall through')});await json(await call('POST',body(view),{route:unauth}),503);assert.equal(unchanged(),fixed);
  h.setCompany(companies.find(other=>other.code!==company.code));const rejected=await call('POST',body(view));assert.ok([403,409].includes(rejected.status));h.setCompany(company);assert.equal(unchanged(),fixed);
  const previousEpoch=view.renderEpoch;
  for(const invalid of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'3',null,previousEpoch+2]){
   await assert.rejects(db.saveProductLabels('owner',f.id,view.overrides,view.revision,await sourceGuard(f,view),view.structure,invalid));assert.equal(unchanged(),fixed);
  }

  // Change the product source immediately before the atomic label write. The
  // real SQL proof must reject it without a label/epoch partial commit.
  const prepare=h.db.prepare,batch=h.db.batch,sql=new WeakMap();let concurrent;
  h.db.prepare=text=>{const statement=prepare(text);sql.set(statement,text);return statement;};
  h.db.batch=async statements=>{if(!concurrent&&statements.some(statement=>sql.get(statement)?.startsWith('INSERT INTO product_labels('))){h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run(new Date(Date.parse(view.productVersion)+1).toISOString(),f.id);concurrent=allTables(f);}return batch(statements);};
  await json(await call('POST',body(view)),409);assert.equal(allTables(f),concurrent);assert.equal((await read()).renderEpoch,previousEpoch);h.db.prepare=prepare;h.db.batch=batch;view=await read();

  // Storage accounting includes the optional epoch itself. An otherwise valid
  // legacy payload just below 512 KiB cannot grow beyond the cap on rewrite.
  const row=h.sqlite.prepare('SELECT * FROM product_labels WHERE product_id=?').get(f.id),stored=JSON.parse(row.payload),large=plain(stored);delete large.renderEpoch;
  const target=model.PRODUCT_LABEL_STORAGE_LIMIT-5;let index=0;
  while(Buffer.byteLength(JSON.stringify(large))+2040<target)large.overrides.common['custom_padding_'+index++]='x'.repeat(2000);
  large.overrides.common['custom_padding_'+index]='';const remainder=target-Buffer.byteLength(JSON.stringify(large));assert.ok(remainder>=0&&remainder<=2000);large.overrides.common['custom_padding_'+index]='x'.repeat(remainder);assert.equal(Buffer.byteLength(JSON.stringify(large)),target);
  h.sqlite.prepare('UPDATE product_labels SET payload=? WHERE product_id=?').run(JSON.stringify(large),f.id);const nearLimit=await read();fixed=unchanged();await json(await call('POST',body(nearLimit)),413);assert.equal(unchanged(),fixed);
  h.sqlite.prepare('UPDATE product_labels SET payload=? WHERE product_id=?').run(row.payload,f.id);
  const overflow={...stored,renderEpoch:Number.MAX_SAFE_INTEGER};h.sqlite.prepare('UPDATE product_labels SET payload=? WHERE product_id=?').run(JSON.stringify(overflow),f.id);const maxView=await read();fixed=unchanged();await json(await call('POST',body(maxView)),409);assert.equal(unchanged(),fixed);
  for(const invalid of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'2',null]){h.sqlite.prepare('UPDATE product_labels SET payload=? WHERE product_id=?').run(JSON.stringify({...stored,renderEpoch:invalid}),f.id);fixed=unchanged();await json(await call(),503);assert.equal(unchanged(),fixed);}
  h.sqlite.prepare('UPDATE product_labels SET payload=? WHERE product_id=?').run(row.payload,f.id);
  assert.equal((await read()).renderEpoch,2);assert.equal(f.objectState(),fileBefore);assert.deepEqual(h.network,[]);assert.equal(h.aiSources.length,0);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_single_receipts').get().n,0);
  proofs.push({company,calls,legacyEpochAbsent:true,firstExplicitEpoch:1,secondExplicitEpoch:2,duplicatePost409:true,ordinaryPutAndLegacyInternalPreserveEpoch:true,valuesStructureManualBlanksPreserved:true,quoteReferencesFilesPoolAndOtherOwnerUnchanged:true,oldPngStaleDespiteSamePlan:true,unknownEpochInjectionRejected:true,sourceCASRejected:true,storageIncludesEpoch:true,epochOverflowRejected:true,externalRequests:0,providerCalls:0,supplierHubWrites:0});
 }finally{f.close();}
});

test.after(()=>{assert.deepEqual(hashes(),frozen,'backend/model source stayed frozen during focused checks');fs.writeFileSync(new URL('../outputs/step711-rewrite-api-proof.json',import.meta.url),JSON.stringify({format:'step711-label-rewrite-api-v1',sourceHashes:frozen,cases:proofs,browserActions:0,externalRequests:0,providerCalls:0,productionWrites:0,supplierHubWrites:0,boundary:'Actual label/quotation handlers, SQLite transaction guards and generated PNG metadata inspector with synthetic category, product and PNG fixtures. No browser, seller URL fetch, live product or external acceptance claim.'},null,2)+'\n');});
