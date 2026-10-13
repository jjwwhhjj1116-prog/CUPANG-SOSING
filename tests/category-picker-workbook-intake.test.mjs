import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {categoryPickerUI} from './helpers/category-picker.mjs';

const profileFile=new URL('../outputs/step604-unand-profile-read.json',import.meta.url);
const originalFile=new URL('../outputs/step603-official-unand-2624.xlsx',import.meta.url);
const available=fs.existsSync(profileFile)&&fs.existsSync(originalFile);
const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const buttonLabel='공식 파일 기준으로 선택 · URL 입력';
const plain=value=>JSON.parse(JSON.stringify(value));
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const waitFor=async predicate=>{const deadline=Date.now()+7000;while(!predicate()){if(Date.now()>deadline)throw Error('Local category operation timeout');await new Promise(resolve=>setTimeout(resolve,1));}};

/** Actual picker/catalog/profile/template/queue APIs and SQLite. Unand is the
 * recorded Single69900v188/original2624 pair; Waihop reuses that public contract
 * in an isolated account. Ancestor IDs, transport, new offer and seller facts
 * are synthetic. The harness never calls a live catalog, model or supplier. */
export async function workbookIntakeFixture(company=companies[0]){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name}),calls=[],modules=new Map();
 const saved=JSON.parse(JSON.parse(fs.readFileSync(profileFile,'utf8'))[0].results[0].payload),bytes=new Uint8Array(fs.readFileSync(originalFile));
 let snapshot=structuredClone(saved.hubSchema),mode='excel-transport',pause=null,ack=null;
 snapshot.company=plain(company);await h.load('db/queries.ts').saveSettings('owner',JSON.stringify(h.settings));
 const trail=saved.categoryPath.slice(0,-1).map((name,index)=>({categoryId:String(641100+index),name,isLeaf:false}));
 const leaf={categoryId:saved.categoryId,name:saved.categoryPath.at(-1),isLeaf:true};
 const choice={key:'local-recorded-'+company.code,categoryId:saved.categoryId,path:saved.categoryPath,isLeaf:true,supplierHub:{trail,ownerId:'owner',company}};
 const branch=()=>({source:'supplier-hub-category-api',ownerId:'owner',company,observedAt:Date.now(),fullCatalogVerified:false,trail,children:[leaf]});
 const exchange=async(type,payload,signal)=>{
  calls.push({type,excel:Boolean(payload?.excelIdentity),signal});if(pause)await pause(type,payload,signal);
  if(type==='PING')return{categoryCatalog:true,categorySchema:true,categoryTemplate:true,categoryExcelSchema:true};
  if(type==='CATEGORIES'){const asked=payload.trail??[];assert.deepEqual(plain(asked),trail.slice(0,asked.length));return{branch:{...branch(),trail:plain(asked),children:asked.length<trail.length?[trail[asked.length]]:[leaf]}};}
  if(type==='SCHEMA'){
   if(payload.excelIdentity){
    if(mode==='excel-transport'){const error=Error('recorded separate Excel detail HTTP 500');error.code='LOCAL_EXCEL_500';throw error;}
    if(mode==='excel-owner')return{branch:{...branch(),ownerId:'wrong-owner',schema:snapshot,excelSchema:snapshot}};
    return{branch:{...branch(),schema:snapshot,excelSchema:{...snapshot,metadata:{...snapshot.metadata,scopeType:'Retail_Categorized_Excel',version:191}}}};
   }
   return{branch:{...branch(),schema:snapshot}};
  }
  assert.equal(type,'TEMPLATE');
  const template={format:'supplier-hub-template-v1',categoryId:saved.categoryId,categoryPath:saved.categoryPath,company,kanCategoryId:'2624',
   sourceUrl:'https://supplier.coupang.com/qvt/v3/kan-categories/download-quotation?leafKanCategoryIds=2624&locale=ko',observedAt:Date.now(),
   name:`SupplierHub-${company.code}-Kan2624.xlsx`,size:bytes.length,base64:Buffer.from(bytes).toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex'),registered:false};
  if(mode==='hash')template.sha256='0'.repeat(64);
  if(mode==='path')template.categoryPath=[...saved.categoryPath.slice(0,-1),'다른 경로'];
  if(mode==='company')template.company=companies.find(value=>value.code!==company.code);
  return{branch:{...branch(),schema:snapshot,template}};
 };
 const request=async(url,init={})=>{
  calls.push({path:url,method:init.method??'GET',action:init.body instanceof FormData?init.body.get('action'):null});
  if(url==='/api/settings')return h.load('app/api/settings/route.ts').GET();
  const api=url==='/api/category-profiles/official-template'?h.load('app/api/category-profiles/official-template/route.ts'):h.load('app/api/category-profiles/route.ts');
  const response=await api[init.method??'GET'](new Request('https://app.test'+url,init));
  if(mode==='identity'&&url.endsWith('/official-template')&&init.body?.get('action')==='inspect'&&response.ok){const body=await response.json();body.identity.kanCategoryId='9999';return Response.json(body,{status:response.status});}
  if(ack&&url==='/api/category-profiles'&&init.method==='POST'&&response.ok){const body=await response.json();ack(body.profile);return Response.json(body,{status:response.status});}
  return response;
 };
 function load(file){
  if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
   {exports,Error,Date,File,FormData,TextEncoder,TextDecoder,Uint8Array,crypto,atob,btoa,fetch:request,require(name){if(name==='@/app/supplier-hub-handoff')return{exchange};if(name==='@/app/load-category-profiles')return load('app/load-category-profiles.ts');return h.load(name.slice(2)+'.ts');}});return exports;
 }
 const catalog=load('app/supplier-hub-catalog.ts'),picker=categoryPickerUI(request,{catalog,workspaceOwnerId:'owner'});
 const button=()=>nodes(picker.render()).find(node=>node.type==='button'&&node.props.children===buttonLabel);
 const invoke=async()=>{const target=button();assert.ok(target,'explicit original-file choice must be visible after the verified transport failure');target.props.onClick();await waitFor(()=>!nodes(picker.render()).some(node=>node.props?.className==='category-picker'&&node.props['aria-busy']));};
 const retained=()=>JSON.stringify(Object.fromEntries(['products','product_options','product_content','product_quotation_fields','collection_jobs','collection_context','collection_results','workspace_settings','category_profiles'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));
 return{h,company,bytes,catalog,picker,choice,calls,button,invoke,request,exchange,retained,
  setMode(value){mode=value;},setPause(fn){pause=fn;},setAck(fn){ack=fn;},changeSchema(fn){fn(snapshot);},close(){picker.close();h.close();}};
}

async function originalOutput(f,profile){
 const url='https://detail.1688.com/offer/641000000001.html',queue=f.h.load('app/api/collection-jobs/route.ts');
 const {jobs}=await json(await queue.POST(new Request('https://app.test/api/collection-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({urls:[url],goal:'work',profileId:profile.id,expectedProfileRevision:profile.revision,expectedSettings:f.h.settings,features:'직접 입력한 설명',keywords:'검토 키워드'})})));
 assert.equal(jobs.length,1);const job=jobs[0];assert.deepEqual(job.context.category.template,profile.template);assert.deepEqual(job.context.category.mappings,profile.mappings);assert.deepEqual(job.context.company,f.company);
 await json(await f.h.route(`/api/collection-jobs/${job.id}/result`,{method:'POST',body:{schemaVersion:1,sourceUrl:url,provider:'synthetic-local-641',collectedAt:new Date().toISOString(),title:'원문 합성 선글라스',description:'원문 합성 상품 설명',attributes:[],
  options:Array.from({length:6},(_,i)=>({sku:'LOCAL641-'+i,name:'합성 옵션 '+i,color:'검정',size:'선글라스',unitPriceCny:5+i,minimumOrder:1,stock:7})),images:[]}}));
 const {productId}=await json(await f.h.route(`/api/collection-jobs/${job.id}/product`,{method:'POST'})),base='/api/products/'+productId;
 let view=await json(await f.h.route(base+'/quotation-fields'));assert.equal(view.categoryContext.profileId,profile.id);assert.equal(view.resolved.schema.categoryId,'69900');assert.equal(view.resolved.schema.submissionReady,false);
 const before=JSON.stringify({raw:f.h.sqlite.prepare('SELECT * FROM collection_results').all(),context:f.h.sqlite.prepare('SELECT * FROM collection_context').all(),settings:f.h.sqlite.prepare('SELECT * FROM workspace_settings').all(),options:f.h.sqlite.prepare('SELECT * FROM product_options').all()});
 const first=view.resolved.rows.find(row=>row.included).optionId;
 await json(await f.h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:'manufacturer',optionId:first,value:''}]}}));
 view=await json(await f.h.route(base+'/quotation-fields'));assert.equal(view.resolved.rows.find(row=>row.optionId===first).fields.manufacturer.source,'manual-option');
 const preview=await json(await f.h.route(base+'/quotation',{method:'POST',body:{action:'preview'}})),response=await f.h.route(base+'/quotation',{method:'POST',body:{action:'download',fingerprint:preview.fingerprint}});assert.equal(response.status,200,await response.clone().text());
 const reader=f.h.load('app/xlsx-template.ts'),book=reader.inspectXlsxArchive(await reader.readXlsxArchive(await response.arrayBuffer()));assert.equal(preview.report.company.code,f.company.code);assert.equal(preview.rows.length,6);
 for(let i=0;i<6;i++){const cells=reader.xlsxHeaders(book,profile.template.sheetName,9+i);for(const id of ['category','title','brand','manufacturer']){const column=profile.mappings.find(mapping=>mapping.field===id).column;assert.equal(cells[column],preview.rows[i][column]);}assert.equal(cells[33],i===0?'':f.h.settings.manufacturer);}
 assert.ok(preview.submissionReview.errorCount>0,'unverified packaging and missing label attachments still block transmission');
 assert.equal(JSON.stringify({raw:f.h.sqlite.prepare('SELECT * FROM collection_results').all(),context:f.h.sqlite.prepare('SELECT * FROM collection_context').all(),settings:f.h.sqlite.prepare('SELECT * FROM workspace_settings').all(),options:f.h.sqlite.prepare('SELECT * FROM product_options').all()}),before);
 assert.deepEqual(Buffer.from(f.h.objects.get(profile.template.storageKey)),Buffer.from(f.bytes));assert.equal(f.h.aiSources.length,0);assert.equal(f.h.network.length,0);assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM supplier_hub_receipts').get().n,0);
 return{view,preview};
}

for(const company of companies)test(`first Excel transport failure enables explicit original selection, URL draft and six original rows (${company.code}; ${company.code==='A01526306'?'recorded contract':'isolated reuse'})`,{skip:!available},async()=>{
 const f=await workbookIntakeFixture(company);try{
  const before=f.retained();assert.equal(f.button(),undefined);await f.picker.chooseLive(f.choice);assert.equal(f.picker.selected.length,0);assert.equal(f.retained(),before);assert.ok(f.picker.alerts().some(value=>String(value).includes('HTTP 500')));
  assert.ok(f.button());assert.match(JSON.stringify(f.picker.render()),/카테고리별 기본값 대조/);assert.equal(f.calls.filter(c=>c.path==='/api/category-profiles'&&c.method==='POST').length,0);
  const captured=f.button().props.onClick;captured();captured();await waitFor(()=>f.picker.selected.length===1);const profile=f.picker.selected[0];
  assert.equal(profile.template.workbookEvidence.excelSchemaVerified,false);assert.equal(profile.template.workbookEvidence.companyCode,company.code);assert.equal(profile.template.dataStartRow,9);assert.equal(f.button(),undefined);
  assert.equal(f.calls.filter(c=>c.path==='/api/category-profiles'&&c.method==='POST').length,1);assert.equal(f.calls.filter(c=>c.type==='SCHEMA'&&c.excel).length,1,'the explicit path does not claim a second successful Excel lookup');
  assert.equal(f.calls.filter(c=>c.path==='/api/category-profiles/official-template'&&c.action==='workbook').length,1);await originalOutput(f,profile);
 }finally{f.close();}
});

test('the typed transport error preserves its original reason/code and cannot classify invalid returned Excel data',{skip:!available},async()=>{
 const f=await workbookIntakeFixture();try{
  const captured=await f.catalog.loadLiveHubCategorySchema(f.choice,new AbortController().signal);
  await assert.rejects(f.catalog.loadLiveHubCategoryTemplate(f.choice,captured,new AbortController().signal),error=>error instanceof f.catalog.OfficialExcelSchemaUnavailableError&&error.code==='LOCAL_EXCEL_500'&&error.cause.code==='LOCAL_EXCEL_500'&&error.message===error.cause.message);
  f.setMode('excel-owner');await assert.rejects(f.catalog.loadLiveHubCategoryTemplate(f.choice,captured,new AbortController().signal),error=>!(error instanceof f.catalog.OfficialExcelSchemaUnavailableError));assert.equal(f.h.network.length,0);
 }finally{f.close();}
});

for(const mode of ['hash','path','company','identity','excel-owner'])test(`a wrong original or returned Excel identity never offers workbook fallback (${mode})`,{skip:!available},async()=>{
 const f=await workbookIntakeFixture();try{f.setMode(mode);const before=f.retained();await f.picker.chooseLive(f.choice);assert.equal(f.picker.selected.length,0);assert.equal(f.button(),undefined);assert.equal(f.retained(),before);assert.equal(f.h.objects.size,0);assert.ok(f.picker.alerts().length);assert.equal(f.h.network.length,0);}finally{f.close();}
});

for(const company of companies)test(`empty working profile is retained and a stale revision blocks the explicit connection (${company.code})`,{skip:!available},async()=>{
 const f=await workbookIntakeFixture(company);try{
  const schema=await f.catalog.loadLiveHubCategorySchema(f.choice,new AbortController().signal),store=f.h.load('db/category-profiles.ts'),old=await store.createCategoryProfile('owner',{name:'기존 작업 중 빈 양식',categoryId:'69900',categoryPath:f.choice.path,hubSchema:schema,template:null,mappings:[]});
  const before=JSON.stringify(f.h.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(old.id));f.picker.setProps({profiles:[old],selectedId:old.id});await f.picker.confirm();assert.ok(f.button());
  await store.updateCategoryProfile('owner',old.id,old.revision,{...old,name:'다른 화면에서 확인한 이름'});const actor=f.retained();await f.invoke();assert.equal(f.picker.selected.length,0);assert.equal(f.retained(),actor);assert.ok(f.picker.alerts().some(value=>String(value).includes('설정이 변경')));
  // A fresh explicit selection reviews the current revision; never overwrite
  // the old working profile when its verified original is connected.
  f.picker.reopen();await f.picker.chooseLive(f.choice);assert.ok(f.button());await f.invoke();assert.equal(f.picker.selected.length,1);const selected=f.picker.selected[0];assert.notEqual(selected.id,old.id);
  assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM category_profiles').get().n,2);assert.equal(f.h.sqlite.prepare('SELECT payload FROM category_profiles WHERE id=?').get(old.id).payload,JSON.parse(actor).category_profiles[0].payload);assert.ok(before);
 }finally{f.close();}
});

test('captured explicit callbacks are inert after changing the leaf, closing, or changing owner',{skip:!available},async()=>{
 for(const action of ['leaf','close','owner']){const f=await workbookIntakeFixture();try{await f.picker.chooseLive(f.choice);const callback=f.button().props.onClick;if(action==='leaf')await f.picker.chooseLive({...f.choice,key:'different-leaf',categoryId:'80719'});else if(action==='close')f.picker.close();else f.picker.setProps({workspaceOwnerId:'other-owner'});const before=f.retained(),count=f.calls.length;callback();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,count);assert.equal(f.retained(),before);assert.equal(f.picker.selected.length,0);}finally{f.close();}}
});

test('pending failure/explicit responses cannot reactivate a closed selection',{skip:!available},async()=>{
 for(const stage of ['failure','explicit']){const f=await workbookIntakeFixture();try{
  if(stage==='explicit')await f.picker.chooseLive(f.choice);let release,heldSignal;f.setPause(async(type,payload,signal)=>{if(stage==='failure'?type==='SCHEMA'&&payload.excelIdentity:type==='TEMPLATE'){heldSignal=signal;await new Promise(resolve=>{release=resolve;});}});
  const callback=stage==='failure'?nodes(f.picker.render()).find(node=>node.type?.name==='SupplierHubCategoryBrowser').props.onChoice:f.button().props.onClick;callback(f.choice);await waitFor(()=>Boolean(release));f.picker.close();assert.equal(heldSignal.aborted,true);release();await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(f.picker.selected.length,0);assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM category_profiles').get().n,0);assert.equal(f.calls.filter(c=>c.path==='/api/category-profiles'&&c.method==='POST').length,0);
 }finally{f.close();}}
});

test('a changed approved company or Single definition blocks the captured explicit original selection',{skip:!available},async()=>{
 for(const mutation of ['company','schema']){const f=await workbookIntakeFixture();try{
  await f.picker.chooseLive(f.choice);const before=f.retained();if(mutation==='company')f.h.setCompany(companies[1]);else f.changeSchema(snapshot=>{const raw=JSON.parse(snapshot.schemaString);raw.properties.productPage.properties.modelNumber.maxLength=49;snapshot.schemaString=JSON.stringify(raw);});
  await f.invoke();assert.equal(f.picker.selected.length,0);assert.equal(f.retained(),before);assert.equal(f.h.objects.size,0);assert.equal(f.button(),undefined);assert.ok(f.picker.alerts().length);
 }finally{f.close();}}
});

test('the explicit original path still rejects changed bytes and a forged saved acknowledgement',{skip:!available},async()=>{
 for(const mutation of ['hash','ack']){const f=await workbookIntakeFixture();try{
  await f.picker.chooseLive(f.choice);if(mutation==='hash')f.setMode('hash');else f.setAck(profile=>{profile.template.workbookEvidence.excelSchemaVerified=true;});
  await f.invoke();assert.equal(f.picker.selected.length,0);assert.ok(f.picker.alerts().length);assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM products').get().n,0);assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM collection_jobs').get().n,1,'only the inert initial fixture exists; no URL request is opened');assert.equal(f.h.network.length,0);
 }finally{f.close();}}
});
