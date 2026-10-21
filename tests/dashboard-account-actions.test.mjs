import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
import {workbookArchive} from './helpers/quotation-workbook.mjs';
import {prepareAttachments} from '../extensions/supplier-hub/package.mjs';
import {reviewSourceFixture} from './helpers/source-review-intake.mjs';
const native=createRequire(import.meta.url);
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const scope=(ownerId='test-owner',code='A01526306')=>({ownerId,company:{code,name:code==='A01526306'?'유앤채':'와이홉'}});
const plain=value=>JSON.parse(JSON.stringify(value));
const settleUntil=async(h,ready)=>{const deadline=Date.now()+10000;while(!ready()){assert.ok(Date.now()<deadline,text(h.render()));await h.settle();await new Promise(resolve=>setTimeout(resolve,5));}};
const version='2026-10-06T00:00:00.000Z';
const product=id=>({id,owner_id:'test-owner',title:'상품 '+id,source_url:'https://source.example.test/product/'+id,created_at:version,updated_at:version,image_keys:JSON.stringify(['test-owner/'+id+'/source.png','test-owner/'+id+'/second.png']),options_count:1,source_price_cny:2,exchange_rate:350,supply_margin:50,coupang_margin:40,supply_price:1400,sale_price:2340,msrp:3050,seo_status:'대기',image_status:'대기',quote_status:'대기',registration_status:'검토 대기',supplier_hub_status:'미전송',removal_policy:{blocked:false,code:null,reason:'',receipt:null},goal_stage:'work'});
const singleSummary=()=>({format:'yoofam-single-receipt-summary-v1',evidence:'chrome-observation',registered:false,label:'개별 문서 등록 파일 완료 확인',company:{code:'A01526306',name:'유앤채'},fingerprint:'a'.repeat(64),categoryId:'81452',observedAt:Date.now(),createdAt:new Date().toISOString(),optionCount:1,optionId:'reviewed-option',docId:901,qvtRequestId:7901,state:'accepted',sourceStatus:'FINISHED'});
const assertProductNavigation=(requests,id)=>{assert.equal(requests.length,2);assert.deepEqual(requests.map(request=>request.url),['/api/products/'+id,'/api/products/'+id+'/registration-layout']);for(const request of requests){assert.equal(request.method,'GET');assert.equal(request.init.cache,'no-store');assert.ok(request.init.signal instanceof AbortSignal);}};

for(const company of schemaCompanies)test(`${company.code}: native source/close guards protect the registration modal, and old session releases never unlock its replacement`,async()=>{
 const h=harness({settingsBody:{settings:{brand:'합성 검수 브랜드',exchangeRate:350},scope:scope('test-owner',company.code)}});try{
  await h.settle();h.component('registration-board').onSelected(new Set([h.products[0].id]));await h.click('등록 전송');const first=h.component('submission-review-panel'),mount=h.componentMount('submission-review-panel');
  const backdrop=()=>nodes(h.render()).find(node=>node.props?.className==='modal-backdrop'),oldClose=backdrop().props.onMouseDown;
  first.onLockChange(true,true);oldClose();first.onEdit(h.products[0].id);await h.click('등록 전송');assert.equal(h.componentMount('submission-review-panel'),mount);
  assert.equal(nodes(backdrop()).find(node=>node.type==='button'&&node.props.className==='icon-close').props.disabled,true);
  first.onLockChange(true,false);first.onEdit(h.products[0].id);await h.settle();assert.equal(h.componentMount('submission-review-panel'),mount);assert.equal(nodes(backdrop()).find(node=>node.type==='button'&&node.props.className==='icon-close').props.disabled,false);
  oldClose();await h.settle();assert.equal(h.component('submission-review-panel'),undefined,'a positively saved terminal receipt may close while its source reservation stays intact');
  await h.click('등록 전송');const current=h.component('submission-review-panel'),replacement=h.componentMount('submission-review-panel');assert.notEqual(replacement,mount);current.onLockChange(true,true);
  first.onLockChange(false,false);oldClose();first.onEdit(h.products[0].id);await h.settle();assert.equal(h.componentMount('submission-review-panel'),replacement);assert.equal(nodes(backdrop()).find(node=>node.type==='button'&&node.props.className==='icon-close').props.disabled,true);
  current.onLockChange(false,false);current.onEdit(h.products[0].id);await h.settle();assert.equal(h.component('submission-review-panel'),undefined);assert.equal(h.component('product-content-editor').product.id,h.products[0].id);
  h.close();current.onLockChange(true,true);current.onLockChange(false,false);assert.equal(h.lateWrites,0);assert.ok(h.requests.every(request=>request.method==='GET'));
 }finally{h.close();}
});

/** Actual DashboardClient, its private DetailPanel and settings dialog. Child
 * renderers record their received props; every tested callback is the real
 * parent callback, and requests run through its real fetch/readJson code. */
function harness({workspaceOwnerId='test-owner',settingsBody={settings:{brand:'계정의 저장 브랜드',exchangeRate:350},scope:scope()},deleteReply=async id=>Response.json({productId:id,removed:true}),realRegistrationBoard=false,realOptionBoard=false,confirmClose=false,profiles=[],officialFlow,registrationLayoutRequest,initialIntakeRows=[],sourceRegistrationsState}={}){
 const instances=new Map(),cache=new Map(),components=new Map(),componentMounts=new Map(),componentCounts=new Map(),nativeDetails=new Map(),layoutEffects=[],effects=[],requests=[];let active,tree,closed=false,lateWrites=0;
 let currentSettings=settingsBody,replyDelete=deleteReply,nextDelete=null,nextSettings=null,replySettingsPut=null,nextProduct=null,replyProduct=null;
 let currentProfiles=profiles,nextProfiles;
 const workspaceEdits={dirty:false,busy:false,freeDirty:false,freeBusy:false};
 const products=officialFlow?.products??[product('product-a'),product('product-b')];
 const draft={rows:initialIntakeRows,setRows(update){draft.rows=typeof update==='function'?update(draft.rows):update;},goal:'work',setGoal(){},ready:true,loading:false,saving:false,dirty:false,message:'',save(){},load(){}};
 const hooks={
  useState(initial){const instance=active,slot=instance.index++;if(!(slot in instance.slots))instance.slots[slot]=typeof initial==='function'?initial():initial;return[instance.slots[slot],value=>{if(!instance.mounted){lateWrites++;return;}instance.slots[slot]=typeof value==='function'?value(instance.slots[slot]):value;}];},
  useRef(initial){const slot=active.index++;return active.slots[slot]??(active.slots[slot]={current:initial});},
  useCallback(fn,deps){const slot=active.index++,old=active.slots[slot];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))active.slots[slot]={fn,deps};return active.slots[slot].fn;},
  useEffect(fn,deps){const instance=active,slot=instance.index++,old=instance.slots[slot];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps[i]))){const next={deps,cleanup:old?.cleanup};instance.slots[slot]=next;effects.push(()=>{next.cleanup?.();next.cleanup=fn();});}},
  useLayoutEffect(fn,deps){const instance=active,slot=instance.index++,old=instance.slots[slot];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps[i]))){const next={deps,cleanup:old?.cleanup};instance.slots[slot]=next;layoutEffects.push(()=>{next.cleanup?.();next.cleanup=fn();});}},
  useMemo(fn,deps){const instance=active,slot=instance.index++,old=instance.slots[slot];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps[i])))instance.slots[slot]={value:fn(),deps};return instance.slots[slot].value;},
 };
 async function request(url,init={}){
  requests.push({url,init,method:init.method??'GET'});
  if(officialFlow&&url.includes('/quotation')||officialFlow&&url.includes('/submission-review')||officialFlow&&url.includes('/supplier-hub-receipt'))return officialFlow.request(url,init);
  if(url==='/api/products')return Response.json({products});
  if(url==='/api/collection-jobs')return Response.json({jobs:[]});
  if(url.includes('/registration-layout')){
   if(registrationLayoutRequest)return registrationLayoutRequest(url,init);
   if(officialFlow)return officialFlow.request(url,init);
   const parsed=new URL(url,'https://app.test'),id=parsed.pathname.split('/')[3],editorProduct=components.get('product-content-editor')?.product,saved=editorProduct?.id===id?editorProduct:products.find(row=>row.id===id),profileId=parsed.searchParams.get('profileId'),profile=currentProfiles.find(value=>value.id===profileId);
   return Response.json({format:'yoofam-registration-layout-v1',productId:id,productVersion:saved?.updated_at,categoryContext:profile?{source:'profile',profileId:profile.id,categoryId:profile.categoryId,categoryPath:profile.categoryPath}:{source:'unknown',profileId:null,categoryId:null,categoryPath:[]},sizeChartRequired:load('app/registration-layout.ts').sizeChartRequiredFromSchemaString(profile?.hubSchema?.schemaString)});
  }
  if(url==='/api/settings'){
   if(init.method==='PUT'){
    if(replySettingsPut)return replySettingsPut(url,init);
    currentSettings={settings:JSON.parse(init.body),scope:scope(workspaceOwnerId,currentSettings.scope?.company?.code)};return Response.json(currentSettings);
   }
   if(nextSettings){const pending=nextSettings;nextSettings=null;return pending.promise;}
   return Response.json(currentSettings);
  }
  if(url.startsWith('/api/products/')&&init.method==='DELETE'){
   if(nextDelete){const pending=nextDelete;nextDelete=null;return pending.promise;}
   return replyDelete(decodeURIComponent(url.split('/').at(-1)),init);
  }
  if(url.startsWith('/api/products/')){
   const id=decodeURIComponent(url.split('/').at(-1));
   if(nextProduct&&nextProduct.id===id){const pending=nextProduct;nextProduct=null;return pending.promise;}
   if(replyProduct)return replyProduct(id,init);
   return Response.json({product:products.find(row=>row.id===id)});
  }
  throw Error('Unexpected request '+url);
 }
 const stubs=new Map();
 function componentModule(name){
  // This presentation-only wrapper must not swallow the real parent's child
  // props. Its modal behavior is covered by the dedicated dialog tests.
  if(name==='detail-image-edit-dialog')return{DetailImageEditDialog:props=>{components.set(name,props);return props.children;}};
  let component=stubs.get(name);if(!component){component=props=>{components.set(name,props);componentMounts.set(name,active);componentCounts.set(name,(componentCounts.get(name)??0)+1);
   if(name==='option-seo-editor'||name==='product-content-editor'||name==='seo-workspace-editor'){
    const [draft,setDraft]=hooks.useState('');
    return{type:'textarea',props:{'data-test-editor':name,value:draft,onChange:event=>setDraft(event.target.value)}};
   }
   return null;};component.displayName=name;stubs.set(name,component);}
  return new Proxy({__esModule:true,default:component,registrationTitle:value=>value.title},{get(target,key){return key in target?target[key]:component;}});
 }
 function load(file){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,URL,URLSearchParams,Date,Intl,TextEncoder,TextDecoder,structuredClone,crypto,fetch:request,window:{addEventListener(){},removeEventListener(){},confirm:()=>typeof confirmClose==='function'?confirmClose():confirmClose,setTimeout:()=>0},require(name){
   if(name==='react')return hooks;
   if(name==='react/jsx-runtime')return{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};
   if(name.endsWith('.css'))return{};
   if(name==='@/app/components/use-intake-draft')return{useIntakeDraft:()=>draft};
   if(name==='@/app/components/use-source-registrations'&&sourceRegistrationsState)return{useSourceRegistrations:()=>sourceRegistrationsState};
   if(['@/app/components/use-registration-layout','@/app/components/use-source-registrations'].includes(name))return load(name.slice(2)+'.ts');
   if(name==='@/app/load-category-profiles')return{loadCategoryProfiles:async()=>{
    if(nextProfiles){const pending=nextProfiles;nextProfiles=null;return pending.promise;}
    return officialFlow?(await (await officialFlow.request('/api/category-profiles')).json()).profiles:currentProfiles;
   }};
   if(officialFlow&&name==='@/app/supplier-hub-catalog')return officialFlow.catalog;
   if(officialFlow&&name==='@/app/supplier-hub-handoff')return officialFlow.bridge;
   if(officialFlow&&name==='@/app/supplier-hub-tracking')return officialFlow.tracking(load('app/supplier-hub-tracking.ts'));
   if(officialFlow&&['quotation-panel','submission-review-panel','submission-package'].some(component=>name==='@/app/components/'+component))return load(name.slice(2)+'.tsx');
   if(name==='@/app/components/workspace-settings-dialog')return load('app/components/workspace-settings-dialog.tsx');
   if(realRegistrationBoard&&name==='@/app/components/registration-board')return load('app/components/registration-board.tsx');
   if(realOptionBoard&&name==='@/app/components/product-option-board')return load('app/components/product-option-board.tsx');
   if(name.startsWith('@/app/components/'))return componentModule(name.split('/').at(-1));
   return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);
  }});return exports;
 }
 const Dashboard=load('app/components/dashboard-client.tsx').default;
 function expand(value,path,seen,ancestors=[]){
  if(Array.isArray(value))return value.map((child,index)=>expand(child,path+'/'+(child?.key??index),seen,ancestors));
  if(!value||typeof value!=='object')return value;
  if(typeof value.type==='function'){
   const key=path+'/'+(value.type.displayName??value.type.name)+':'+(value.key??'');let instance=instances.get(key);
   if(!instance){instance={slots:[],mounted:true};instances.set(key,instance);}seen.add(key);instance.index=0;instance.ancestors=ancestors;active=instance;
   const realName={QuotationPanel:'quotation-panel',SubmissionReviewPanel:'submission-review-panel',SubmissionPackage:'submission-package',ProductOptionBoard:'product-option-board',RegistrationBoard:'registration-board'}[value.type.name];
   if(realName){components.set(realName,value.props);componentMounts.set(realName,instance);}
   return expand(value.type(value.props),key,seen,ancestors);
  }
  if(value.type==='details')value={...value,fixturePath:path,props:{...value.props,...(nativeDetails.has(path)?{open:nativeDetails.get(path)}:{})}};
  const next={...value,props:{...value.props,children:expand(value.props?.children,path+'/children',seen,[...ancestors,value])}};
  if(next.props.ref&&typeof next.props.ref==='object'){
   const marker={getAttribute:name=>name==='data-quotation-source-step'?'SEO':name==='data-workspace-dirty'?'true':null,querySelector:()=>null};
   next.props.ref.current={querySelector:selector=>(selector.includes('[data-workspace-dirty="true"]')&&(workspaceEdits.dirty||!selector.includes(':not(')&&workspaceEdits.freeDirty))||(selector.includes('[data-workspace-saving="true"]')&&(workspaceEdits.busy||!selector.includes(':not(')&&workspaceEdits.freeBusy))?marker:null,querySelectorAll:selector=>selector==='[data-quotation-source-step]'&&workspaceEdits.dirty?[marker]:[],scrollTo(){}};
  }
  return next;
 }
 function render(){
  if(closed)return tree;components.clear();componentMounts.clear();componentCounts.clear();const seen=new Set();tree=expand({type:Dashboard,props:{userName:'테스트 관리자',workspaceOwnerId}},'root',seen);
  for(const [key,instance]of instances)if(!seen.has(key)){instance.mounted=false;instance.slots.forEach(slot=>slot?.cleanup?.());instances.delete(key);}
  layoutEffects.splice(0).forEach(effect=>effect());effects.splice(0).forEach(effect=>effect());return tree;
 }
 const settle=async()=>{for(let i=0;i<10;i++){if(!closed)render();await new Promise(resolve=>setImmediate(resolve));}};
 const component=name=>{render();return components.get(name);};
 const button=label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label);
 const toggleDetails=async(label,open=true)=>{const found=nodes(render()).find(node=>node.type==='details'&&(node.props['aria-label']===label||text(node.props.children?.[0])===label));assert.ok(found,'Missing details '+label);if(found.props.onToggle)found.props.onToggle({currentTarget:{open}});else nativeDetails.set(found.fixturePath,open);await settle();};
 return{products,requests,render,settle,component,button,toggleDetails,componentVisible(name){render();const instance=componentMounts.get(name);return!!instance&&instance.ancestors.every(node=>!node.props.hidden&&(node.type!=='details'||(nativeDetails.get(node.fixturePath)??node.props.open)===true));},componentMount(name){render();return componentMounts.get(name);},instance(name){render();return [...instances].find(([key])=>key.includes('/'+name+':'))?.[1];},componentCount(name){render();return componentCounts.get(name)??0;},async click(label){const found=button(label);assert.ok(found,'Missing button '+label);found.props.onClick();await settle();},deferDelete(){return nextDelete=deferred();},deferSettings(){return nextSettings=deferred();},deferProfiles(){return nextProfiles=deferred();},setProfiles(value){currentProfiles=value;},deferProduct(id){return nextProduct={...deferred(),id};},setProductReply(fn){replyProduct=fn;},setWorkspaceEdits(value){Object.assign(workspaceEdits,value);},setSettingsBody(value){currentSettings=value;},switchOwner(value){workspaceOwnerId=value;return render();},setDeleteReply(fn){replyDelete=fn;},setSettingsPutReply(fn){replySettingsPut=fn;},close(){closed=true;for(const instance of instances.values()){instance.mounted=false;instance.slots.forEach(slot=>slot?.cleanup?.());}},get lateWrites(){return lateWrites;}};
}

async function officialSubmissionFlow(company){
 const api=mobileIntakeHarness({companyCode:company.code,companyName:company.name}),events=[],modules=new Map(),pause=deferred();
 let registrationReceiptGate=null;
 const snapshot={...hubSchemaSnapshot(company),metadata:{displayCategoryCode:'991234',categoryId:3000,scope:'Retail_Categorized_Single',productNoticeNumber:17,version:73}};
 const raw=JSON.parse(snapshot.schemaString),common=raw.properties.productPage.properties.commonAttributes;
 common.properties.purchasePrice={type:'integer',title:'공급가',minimum:1};common.properties.coupangSalePrice={type:'integer',title:'판매가',minimum:1};common.required=['purchasePrice','coupangSalePrice'];delete raw.properties.productPage.properties.price;snapshot.schemaString=JSON.stringify(raw);
 const fields=api.load('app/quotation-schema.ts').getQuotationSchema(snapshot.categoryId,schemaPath,snapshot).fields;
 const headers=fields.map(field=>field.label),category=schemaPath.join('>')+' (991234)',sheetName='QF_3000_시험분류';
 const categoryColumn=columnIndex=>{let result='';for(let value=columnIndex+1;value;value=Math.floor((value-1)/26))result=String.fromCharCode(65+(value-1)%26)+result;return result;};
 const column=index=>{let result='';for(let value=index+1;value;value=Math.floor((value-1)/26))result=String.fromCharCode(65+(value-1)%26)+result;return result;};
 const row=(number,values)=>`<row r="${number}">${values.map((value,index)=>`<c r="${column(index)}${number}" t="inlineStr"><is><t>${value.replaceAll('&','&amp;').replaceAll('<','&lt;')}</t></is></c>`).join('')}</row>`;
 // Synthetic official OOXML exercises the actual download, verification, R2,
 // profile CAS and receipt API; it contains no private supplier workbook.
 const bytes=workbookArchive([
  ['[Content_Types].xml','<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
  ['_rels/.rels','<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml',`<workbook xmlns:r="relationship"><sheets><sheet name="${sheetName}" r:id="one"/></sheets></workbook>`],
  ['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
  ['xl/worksheets/sheet1.xml',`<worksheet><sheetData>${row(1,['','Retail_Categorized_Excel:Kan:3000:Notice17:Version190'])}${row(5,headers)}${row(6,fields.map(field=>field.required?'필수':'선택'))}${row(7,headers.map(()=>'작성 안내'))}${row(8,headers.map((_value,index)=>index===1?category:'예시'))}${row(9,headers.map(()=>''))}</sheetData><dataValidations><dataValidation type="list" allowBlank="true" sqref="B9:B1008"><formula1>"${category}"</formula1></dataValidation><dataValidation type="list" allowBlank="true" sqref="${categoryColumn(headers.indexOf('렌즈 유형'))}9:${categoryColumn(headers.indexOf('렌즈 유형'))}1008"><formula1>"해당사항없음,UV"</formula1></dataValidation></dataValidations></worksheet>`],
 ]);
 const request=async(url,init={})=>{
  const body=typeof init.body==='string'?JSON.parse(init.body):undefined;
  events.push({url,method:init.method??'GET',body});
  if(url==='/api/category-profiles')return api.load('app/api/category-profiles/route.ts')[init.method??'GET'](new Request('https://app.test'+url,init));
  if(url==='/api/category-profiles/official-template')return api.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test'+url,init));
  const gate=init.method==='POST'&&url.includes('/supplier-hub-receipt')&&body?.result?.registration&&!registrationReceiptGate?.started?registrationReceiptGate:null;
  if(gate){gate.started=true;gate.arrive();await gate.wait;}
  try{const response=await api.route(url,{method:init.method??'GET',body:init.body});gate?.complete(response.clone());return response;}
  catch(error){gate?.fail(error);throw error;}
 };
 const parent={categoryId:'100',name:schemaPath[0],isLeaf:false},leaf={categoryId:snapshot.categoryId,name:schemaPath[1],isLeaf:true};
 const exchange=async(type,payload)=>{
  events.push({type});if(type==='PING')return{categoryCatalog:true,categorySchema:true,categoryTemplate:true};
  const branch={source:'supplier-hub-category-api',ownerId:'owner',company,observedAt:Date.now(),fullCatalogVerified:false,trail:payload.trail,children:payload.trail.length?[leaf]:[parent]};
  if(type==='CATEGORIES')return{branch};if(type==='SCHEMA')return{branch:{...branch,schema:snapshot}};
  assert.equal(type,'TEMPLATE');return{branch:{...branch,schema:snapshot,template:{format:'supplier-hub-template-v1',categoryId:snapshot.categoryId,categoryPath:schemaPath,company,kanCategoryId:'3000',sourceUrl:'https://supplier.coupang.com/qvt/v3/kan-categories/download-quotation?leafKanCategoryIds=3000&locale=ko',observedAt:Date.now(),name:`SupplierHub-${company.code}-Kan3000.xlsx`,size:bytes.length,base64:Buffer.from(bytes).toString('base64'),sha256:Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),registered:false}}};
 };
 function loadCatalog(file){
  if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,Date,AbortController,File,FormData,TextEncoder,TextDecoder,Uint8Array,crypto,atob,btoa,fetch:request,require(name){if(name==='@/app/supplier-hub-handoff')return{exchange};if(name==='@/app/load-category-profiles')return loadCatalog(name.slice(2)+'.ts');return name.startsWith('@/')?api.load(name.slice(2)+'.ts'):native(name);}});return exports;
 }
 const profile=await api.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'접수 추적 합성 시험',categoryId:snapshot.categoryId,categoryPath:schemaPath,hubSchema:snapshot,template:null,mappings:[]});
 api.context.category=profile;api.sqlite.prepare("UPDATE collection_context SET payload=? WHERE job_id='job'").run(JSON.stringify(api.context));await api.intake();
 const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();},product=api.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
 const content=(await json(await api.route(base+'/content'))).content,images=api.sqlite.prepare('SELECT object_key FROM collection_images ORDER BY image_index').all().map(item=>item.object_key);
 await json(await api.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'검토한 합성 상품명',description:''},assets:{main:[images[0]],additional:[images[1]],detail:[images[2]],label:[images[3]]}}}}));
 const view=await json(await api.route(base+'/quotation-fields'));
 const manual=field=>field.id==='title'?'검토한 합성 상품명':field.id==='salePrice'?'200':field.id==='packagedDimensionsMm'?'10*20*30':field.type==='number'?'100':field.type==='select'?field.choices.find(choice=>choice.value!=='')?.value:'합성 검토값';
 await json(await api.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[...view.resolved.schema.fields.filter(field=>field.required&&field.id!=='category').map(field=>({fieldKey:field.id,optionId:null,value:manual(field)})),{fieldKey:'detailHtml',optionId:null,value:'<p>검토한 합성 설명</p>'}]}}));
 const validators=api.load('app/supplier-hub-handoff.ts');let prepared,lookup=0,trackSignal;
 const observation=(registration=false)=>({state:lookup++===0?'validation-pending':'validation-complete',filename:prepared.filename,company,includedOptions:prepared.includedOptions,observedAt:Date.now(),registered:false,
  ...(lookup>1?{quotationId:'synthetic-quotation'}:{}),...(registration?{registration:{quotationId:'synthetic-quotation',scope:'visible-page',includedOptions:prepared.includedOptions,observedAt:Date.now(),registered:false,rows:Array.from({length:prepared.includedOptions},(_,index)=>({title:'합성 옵션 '+index,submittedAt:'2026-10-11',category:schemaPath.join('>'),barcode:'',sourceQuotation:prepared.filename,skuId:'synthetic-sku-'+index,status:'상품 검수중',stage:'가격/정책'}))}}:{})});
 const bridge={...validators,checkSupplierHubExtension:async()=>{},getSupplierHubProductHistory:async()=>({records:[],blocked:false}),getSupplierHubSubmission:async()=>({attempt:null,result:null}),
  transmitSupplierHubPackage:async(blob,identity)=>{const files=await prepareAttachments(new Uint8Array(await blob.arrayBuffer()));events.push({type:'TRANSMIT',identity,files});assert.deepEqual(files.company,company);return{state:'validation-requested',registered:false};},
  getSupplierHubResult:async(_identity,_signal,mode)=>observation(mode==='registration')};
 return{api,profile,bytes,events,request,catalog:loadCatalog('app/supplier-hub-catalog.ts'),bridge,products:[api.sqlite.prepare('SELECT * FROM products').get()],
  tracking:tracker=>({...tracker,followSupplierHubRegistration:(source,options)=>{prepared=source;trackSignal=options.signal;events.push({type:'TRACK',source});return tracker.followSupplierHubRegistration(source,{...options,maxDurationMs:10000,wait:async(_ms,signal)=>{if(!lookup)return;await Promise.race([pause.promise,new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}))]);}});}}),
  holdRegistrationReceipt(){assert.equal(registrationReceiptGate,null);const arrival=deferred(),wait=deferred();let complete,fail;const saved=new Promise((resolve,reject)=>{complete=resolve;fail=reject;});registrationReceiptGate={started:false,arrive:arrival.resolve,wait:wait.promise,release:wait.resolve,complete,fail};return{arrived:arrival.promise,saved,release:wait.resolve,get started(){return registrationReceiptGate.started;}};},
  get signal(){return trackSignal;},continue(){pause.resolve();},close(){pause.resolve();registrationReceiptGate?.release();api.close();}};
}

test('dashboard shows saved registration metadata in option and detail headers while navigation stays UUID scoped',async()=>{
 const h=harness();h.products[0].registration_number='261015014001';
 try{
  await h.settle();const first=h.products[0],second=h.products[1],before=JSON.stringify(h.products);
  h.component('registration-board').onOptions(first);await h.settle();
  const board=h.component('product-option-board');assert.equal(board.productId,first.id);assert.equal(board.productRegistrationNumber,'261015014001');assert.match(text(h.render()),/등록번호 261015014001/);
  board.onStage('saved-option-uuid','SEO');await h.settle();
  const metadata=nodes(h.render()).find(node=>node.props?.className==='detail-product-meta');assert.match(text(metadata),/^261015014001/);assert.equal(h.component('option-seo-editor').optionId,'saved-option-uuid');
  assertProductNavigation(h.requests.slice(-2),first.id);assert.ok(h.requests.every(request=>request.method==='GET'));
  h.component('registration-board').onOpen(second,'SEO');await h.settle();assert.match(text(nodes(h.render()).find(node=>node.props?.className==='detail-product-meta')),/^YP-PRODUCT-/);
  assert.equal(JSON.stringify(h.products),before);
 }finally{h.close();}
});

for(const company of schemaCompanies)for(const laterChange of [false,true])test(`official preparation and first receipt refresh retain one live tracker; ${laterChange?'a later profile save cancels it':'the same tracker reaches SKU receipt'} (${company.code})`,async()=>{
 const flow=await officialSubmissionFlow(company),h=harness({workspaceOwnerId:'owner',settingsBody:{settings:flow.api.settings,scope:scope('owner',company.code)},officialFlow:flow});
 try{
  await h.settle();h.component('registration-board').onOpen(h.products[0],'견적서');await h.settle();
  const originalProduct=flow.api.sqlite.prepare('SELECT * FROM products').get(),frozen=flow.api.sqlite.prepare('SELECT payload FROM collection_context').get().payload;
  const stale=h.deferProfiles();h.component('product-content-editor').onSaved();await h.settle();
  await h.click('공식 파일 기준으로 연결');for(let i=0;i<30&&h.button('공식 파일 기준으로 연결');i++)await h.settle();
  const saved=await flow.api.load('db/category-profiles.ts').getCategoryProfile('owner',flow.profile.id);assert.equal(saved.revision,2);assert.equal(saved.template.workbookEvidence.templateSha256,saved.template.sha256);assert.deepEqual(flow.api.objects.get(saved.template.storageKey),flow.bytes);
  stale.resolve([flow.profile]);await h.settle();await h.click('저장한 견적 전송 준비');await h.toggleDetails('Excel 파일 전송 · 별도 방식');await settleUntil(h,()=>Boolean(h.instance('SubmissionPackage')));
  const mount=h.instance('SubmissionPackage');assert.ok(mount,text(h.render()));await h.click('견적서 + 첨부 파일 준비');
  await settleUntil(h,()=>h.button('확장에 첨부 파일 준비')&&!nodes(h.render()).find(node=>node.props?.['aria-label']==='견적서와 첨부 파일 준비').props['aria-busy']);
  assert.ok(h.button('확장에 첨부 파일 준비'),text(h.render()));
  for(const input of nodes(h.render()).filter(node=>node.type==='input'&&node.props.type==='checkbox'))input.props.onChange({target:{checked:true}});
  const transmit=nodes(h.render()).filter(node=>node.type==='button'&&text(node)==='등록 전송').at(-1);assert.ok(transmit&&!transmit.props.disabled,text(h.render()));transmit.props.onClick();await h.settle();
  await settleUntil(h,()=>Boolean(flow.api.sqlite.prepare('SELECT * FROM supplier_hub_receipts').get()));await h.settle();
  assert.ok(flow.signal,text(h.render()));assert.equal(flow.signal.aborted,false);assert.equal(h.instance('SubmissionPackage'),mount);assert.ok(flow.api.sqlite.prepare('SELECT * FROM supplier_hub_receipts').get());
  assert.equal(flow.events.filter(event=>event.type==='TRACK').length,1);assert.equal(flow.events.filter(event=>event.type==='TRANSMIT').length,1);assert.equal(flow.events.filter(event=>event.body?.action==='export').length,1);
  assert.equal(flow.api.sqlite.prepare('SELECT updated_at FROM products').get().updated_at,originalProduct.updated_at);assert.equal(flow.api.sqlite.prepare('SELECT payload FROM collection_context').get().payload,frozen);
  const sourceReads=flow.events.filter(event=>event.body?.action==='source').length;
  if(laterChange){
   const changed=await flow.api.load('db/category-profiles.ts').updateCategoryProfile('owner',saved.id,saved.revision,{...saved,name:'나중에 변경한 설정'});assert.equal(changed.revision,3);
   // A subsequent reload carries a genuine later revision and retains the
   // existing unmount/cancel guard rather than hiding an actual source change.
   h.component('submission-review-panel').onReceiptSaved();await h.settle();assert.equal(flow.signal.aborted,true);assert.notEqual(h.instance('SubmissionPackage'),mount);
  }else{
   const commit=flow.holdRegistrationReceipt();flow.continue();await settleUntil(h,()=>commit.started);await commit.arrived;
   await settleUntil(h,()=>text(h.render()).includes('6개의 SKU ID'));
   // The observed result renders before retainResult finishes its real API
   // write. Keep that interval deterministic and await the storage response.
   assert.equal(JSON.parse(flow.api.sqlite.prepare('SELECT payload FROM supplier_hub_receipts').get().payload).result.registration,undefined);
   commit.release();const acknowledgement=await commit.saved;assert.equal(acknowledgement.status,200,await acknowledgement.clone().text());assert.equal((await acknowledgement.json()).saved,true);
   assert.equal(h.instance('SubmissionPackage'),mount);assert.equal(flow.signal.aborted,false);assert.match(text(h.render()),/6개의 SKU ID/);
   const receipt=JSON.parse(flow.api.sqlite.prepare('SELECT payload FROM supplier_hub_receipts').get().payload);assert.equal(receipt.result.registration.rows.length,6);assert.ok(receipt.result.registration.rows.every(row=>row.skuId));assert.equal(receipt.result.registered,false);
  }
  assert.equal(flow.events.filter(event=>event.type==='TRANSMIT').length,1);assert.equal(flow.events.filter(event=>event.body?.action==='export').length,1);assert.ok(flow.events.filter(event=>event.body?.action==='source').length>=sourceReads);
 }finally{h.close();flow.close();}
});

test('prepared-profile adoption rejects changed owner, navigation, identity, revision and original storage scope without changing products',async()=>{
 const source={id:'official',name:'검증 양식',categoryId:'991234',categoryPath:schemaPath,revision:1,verification:'draft',createdAt:version,updatedAt:version,template:null,mappings:[],hubSchema:hubSchemaSnapshot(schemaCompanies[1])};
 const saved={...source,revision:2,template:{name:'original.xlsx',format:'xlsx',sha256:'a'.repeat(64),storageKey:'test-owner/category-templates/'+ 'a'.repeat(64)+'.xlsx',sheetName:'QF_3000',headerRow:5,dataStartRow:9,headers:['상품명','카테고리']}};
 for(const patch of [{id:'different'},{revision:3},{categoryId:'different'},{categoryPath:['다른 분류']},{hubSchema:hubSchemaSnapshot(schemaCompanies[0])},{template:{...saved.template,storageKey:'other-owner/category-templates/'+ 'a'.repeat(64)+'.xlsx'}}]){
  const h=harness({profiles:[source]});try{
   await h.settle();h.component('registration-board').onOpen(h.products[0],'견적서');await h.settle();const callback=h.component('quotation-panel').onProfilePrepared,before=JSON.stringify(h.products),reads=h.requests.length;
   assert.equal(typeof callback,'function');assert.throws(()=>callback({...saved,...patch},source),/저장 결과/);assert.equal(h.requests.length,reads);assert.equal(JSON.stringify(h.products),before);
   h.component('quotation-panel').onPrepareSubmission(source.id);await h.settle();assert.equal(h.component('submission-review-panel').profiles[0].revision,1);
  }finally{h.close();}
 }
 for(const change of ['owner','navigation','unmount']){
  const h=harness({profiles:[source]});try{
   await h.settle();h.component('registration-board').onOpen(h.products[0],'견적서');await h.settle();const callback=h.component('quotation-panel').onProfilePrepared;
   if(change==='owner')h.switchOwner('another-owner');else if(change==='navigation')h.component('registration-board').onOpen(h.products[1],'견적서');else h.close();
   const reads=h.requests.length;assert.throws(()=>callback(saved,source),/현재 계정과 상품/);assert.equal(h.requests.length,reads);assert.equal(h.lateWrites,0);
  }finally{h.close();}
 }
});

test('actual dashboard deletion sends the saved version and removes only its row and selection after confirmation',async()=>{
 const h=harness();try{
  await h.settle();const first=h.products[0],second=h.products[1],board=h.component('registration-board');board.onSelected(new Set([first.id,second.id]));board.onOpen(second);await h.settle();
  const removing=h.component('registration-board').onDelete(first);await removing;await h.settle();
  const writes=h.requests.filter(request=>request.method==='DELETE');assert.equal(writes.length,1);assert.equal(writes[0].url,'/api/products/'+first.id);assert.deepEqual(JSON.parse(writes[0].init.body),{expectedVersion:first.updated_at});
  const after=h.component('registration-board');assert.deepEqual(Array.from(after.products,row=>row.id),[second.id]);assert.deepEqual(Array.from(after.selected),[second.id]);assert.equal(h.component('product-content-editor').product.id,second.id);assert.ok(h.requests.every(request=>request.method==='GET'||request.method==='DELETE'));
 }finally{h.close();}
});

test('pending and failed dashboard deletion preserve rows/selection and duplicate calls cannot issue another DELETE',async()=>{
 const h=harness();try{
  await h.settle();const first=h.products[0];h.component('registration-board').onSelected(new Set([first.id]));const pending=h.deferDelete(),handler=h.component('registration-board').onDelete;
  const saving=handler(first);await assert.rejects(()=>handler(first),/진행 중인 작업/);await h.settle();assert.equal(h.requests.filter(request=>request.method==='DELETE').length,1);assert.equal(h.component('registration-board').products.length,2);
  pending.resolve(Response.json({error:'상품 버전이 변경되었습니다.'},{status:409}));await assert.rejects(()=>saving,/버전/);await h.settle();assert.equal(h.component('registration-board').products.length,2);assert.deepEqual(Array.from(h.component('registration-board').selected),[first.id]);
  await h.component('registration-board').onDelete(first);await h.settle();assert.equal(h.component('registration-board').products.length,1);assert.equal(h.requests.filter(request=>request.method==='DELETE').length,2);
 }finally{h.close();}
});

test('malformed dashboard deletion confirmations cannot remove any product or its selected state',async()=>{
 for(const reply of [{productId:'wrong-product',removed:true},{productId:'product-a',removed:false},{}]){
  const h=harness({deleteReply:async()=>Response.json(reply)});try{
   await h.settle();h.component('registration-board').onSelected(new Set(['product-a','product-b']));await assert.rejects(()=>h.component('registration-board').onDelete(h.products[0]),/삭제 결과/);await h.settle();assert.deepEqual(Array.from(h.component('registration-board').products,row=>row.id),['product-a','product-b']);assert.deepEqual(Array.from(h.component('registration-board').selected),['product-a','product-b']);
  }finally{h.close();}
 }
});

test('retained deletion callbacks re-read current transmission evidence before any DELETE, even at the same product clock',async()=>{
 const reason='쿠팡에 이미 전송된 상품이라 삭제할 수 없습니다';
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}]){
  const h=harness();try{
   await h.settle();const first=h.products[0],handler=h.component('registration-board').onDelete;
   h.component('registration-board').onSelected(new Set([first.id]));
   const accepted={label:'견적서 접수',company,quotationId:'accepted-before-retry',fingerprint:'a'.repeat(64),categoryId:'69900',observedAt:1,includedOptions:1,issuedSkus:0};
   const latest={...first,hub_receipt:{...accepted,label:'파일 반려',quotationId:null,fingerprint:'b'.repeat(64)},removal_policy:{blocked:true,code:'PRODUCT_HUB_TRANSMITTED',reason,receipt:accepted}};
   h.setProductReply(async()=>Response.json({product:latest}));
   const start=h.requests.length;await assert.rejects(()=>handler(first),error=>error.message===reason);await h.settle();
   const requests=h.requests.slice(start);assert.equal(requests.length,1);assert.equal(requests[0].method,'GET');assert.equal(requests[0].url,'/api/products/'+first.id);assert.equal(requests[0].init.cache,'no-store');assert.ok(requests[0].init.signal instanceof AbortSignal);
   assert.equal(h.requests.filter(request=>request.method==='DELETE').length,0);assert.deepEqual(Array.from(h.component('registration-board').products,row=>row.id),['product-a','product-b']);assert.deepEqual(Array.from(h.component('registration-board').selected),[first.id]);
   // A failed preflight releases its lock. A fresh verified allowed response is
   // required before this same explicit callback can remove a local-only draft.
   h.setProductReply(async()=>Response.json({product:first}));await handler(first);await h.settle();assert.equal(h.requests.filter(request=>request.method==='DELETE').length,1);
  }finally{h.close();}
 }
});

test('missing or corrupt current deletion proof and changed source identity preserve the row without a DELETE',async()=>{
 for(const mutate of [
  row=>({...row,removal_policy:undefined}),row=>({...row,removal_policy:null}),row=>({...row,removal_policy:{blocked:false}}),
  row=>({...row,id:'different-product'}),row=>({...row,owner_id:'another-owner'}),row=>({...row,updated_at:'2026-10-07T00:00:01.000Z'}),
 ]){
  const h=harness();try{
   await h.settle();const first=h.products[0],before=JSON.stringify(h.products);h.component('registration-board').onSelected(new Set([first.id]));h.setProductReply(async()=>Response.json({product:mutate(first)}));
   await assert.rejects(()=>h.component('registration-board').onDelete(first));await h.settle();assert.equal(h.requests.filter(request=>request.method==='DELETE').length,0);assert.equal(JSON.stringify(h.products),before);assert.deepEqual(Array.from(h.component('registration-board').selected),[first.id]);
  }finally{h.close();}
 }
});

test('a locked visible product cannot start even the preflight and its legacy status never substitutes for server proof',async()=>{
 const h=harness();try{
  const reason='쿠팡에 이미 전송된 상품이라 삭제할 수 없습니다',first=h.products[0];first.removal_policy={blocked:true,code:'PRODUCT_HUB_EVIDENCE_UNCONFIRMED',reason:'전송 결과를 확인한 뒤 삭제해주세요.',receipt:null};
  await h.settle();let reads=h.requests.length;await assert.rejects(()=>h.component('registration-board').onDelete(first));assert.equal(h.requests.length,reads);
  first.removal_policy={blocked:false,code:null,reason:'',receipt:null};first.registration_status='전송완료';first.supplier_hub_status='전송완료';await h.settle();
  await h.component('registration-board').onDelete(first);await h.settle();assert.equal(h.requests.filter(request=>request.method==='DELETE').length,1);assert.equal(h.component('registration-board').products.length,1);assert.ok(!text(h.render()).includes(reason));
 }finally{h.close();}
});

test('unmounting a pending deletion preflight aborts it and retained callbacks cannot issue reads or writes',async()=>{
 const h=harness();await h.settle();const first=h.products[0],handler=h.component('registration-board').onDelete,pending=h.deferProduct(first.id),removing=handler(first);await h.settle();
 const request=h.requests.at(-1);assert.equal(request.method,'GET');assert.equal(request.url,'/api/products/'+first.id);assert.equal(request.init.signal.aborted,false);
 h.close();assert.equal(request.init.signal.aborted,true);pending.resolve(Response.json({product:first}));await removing;await h.settle();assert.equal(h.requests.filter(request=>request.method==='DELETE').length,0);assert.equal(h.lateWrites,0);
 const count=h.requests.length;await assert.rejects(()=>handler(first));assert.equal(h.requests.length,count);
});

test('detail image translation parent targets the free editor while rejecting missing images and paid or free busy work',async()=>{
 const h=harness();try{
  await h.settle();h.component('registration-board').onOpen(h.products[0],'상세 이미지');await h.settle();const source=JSON.parse(h.products[0].image_keys)[0];
  const closeCleanEditor=async()=>{h.component('free-image-translation-panel').onCloseGuard(()=>true);h.component('detail-image-edit-dialog').onClose();await h.settle();assert.equal(h.component('detail-image-edit-dialog').open,false);};
  assert.equal(h.component('free-image-translation-panel').translationTarget,undefined);
  for(const [language,sequence]of [['zh',1],['en',2],['zh',3]]){
   h.component('product-content-editor').onTranslateImage(source,language);await h.settle();assert.deepEqual(plain(h.component('free-image-translation-panel').translationTarget),{sourceKey:source,sourceLanguage:language,sequence});
   // A real user must close the clean Stage5 dialog before pressing another
   // background source button. Keep every original sequence/target assertion.
   await closeCleanEditor();
  }
  const previous=plain(h.component('free-image-translation-panel').translationTarget);h.component('product-content-editor').onTranslateImage('other-owner/foreign.png','en');await h.settle();assert.deepEqual(plain(h.component('free-image-translation-panel').translationTarget),previous);
  h.component('image-generation-panel').onBusyChange(true);await h.settle();assert.equal(h.component('product-content-editor').imageProcessingBusy,true);h.component('product-content-editor').onTranslateImage(source,'en');await h.settle();assert.deepEqual(plain(h.component('free-image-translation-panel').translationTarget),previous);
  h.component('image-generation-panel').onBusyChange(false);await h.settle();h.component('product-content-editor').onTranslateImage(source,'en');await h.settle();assert.equal(h.component('free-image-translation-panel').translationTarget.sequence,4);
  await closeCleanEditor();
  assert.equal(h.component('image-generation-panel').translationTarget,undefined);
  h.component('free-image-translation-panel').onBusyChange(true);h.component('product-content-editor').onTranslateImage(source,'zh','detailTop');await h.settle();assert.equal(h.component('free-image-translation-panel').translationTarget.sequence,4);
  h.component('free-image-translation-panel').onBusyChange(false);h.component('product-content-editor').onTranslateImage(source,'zh','detailTop');await h.settle();assert.deepEqual(plain(h.component('free-image-translation-panel').translationTarget),{sourceKey:source,sourceLanguage:'zh',sequence:5,role:'detailTop'});
 }finally{h.close();}
});

test('free image apply excludes its own reviewed draft but guards all other drafts, busy tasks and retained callbacks',async()=>{
 const h=harness();try{
  await h.settle();h.component('registration-board').onOpen(h.products[0],'상세 이미지');await h.settle();const beforeApply=h.component('free-image-translation-panel').beforeApply;
  h.setWorkspaceEdits({freeDirty:true});assert.equal(beforeApply(),true);const reads=h.requests.length;
  h.setWorkspaceEdits({dirty:true});assert.equal(beforeApply(),false);h.setWorkspaceEdits({dirty:false,busy:true});assert.equal(beforeApply(),false);h.setWorkspaceEdits({busy:false});
  h.component('image-generation-panel').onBusyChange(true);assert.equal(beforeApply(),false);h.component('image-generation-panel').onBusyChange(false);assert.equal(beforeApply(),true);
  await h.click('＋ 상품 추가');const intakeBusy=h.component('intake-queue-panel').onBusy;intakeBusy(true);assert.equal(beforeApply(),false);intakeBusy(false);assert.equal(beforeApply(),true);
  h.component('registration-board').onOpen(h.products[1],'상세 이미지');await h.settle();assert.equal(beforeApply(),false);assert.equal(h.component('free-image-translation-panel').productId,h.products[1].id);assert.equal(h.requests.length,reads+1);assert.equal(h.requests.at(-1).url,'/api/products/'+h.products[1].id+'/registration-layout');assert.ok(h.requests.every(request=>request.method==='GET'));
 }finally{h.close();}
});

test('translation selection stays scoped to its product and an unmounted product callback cannot seed a later product',async()=>{
 const h=harness();try{
  await h.settle();h.component('registration-board').onOpen(h.products[0],'상세 이미지');await h.settle();const old=h.component('product-content-editor').onTranslateImage,source=JSON.parse(h.products[0].image_keys)[0];old(source,'zh');await h.settle();assert.equal(h.component('free-image-translation-panel').translationTarget.sequence,1);
  h.component('registration-board').onOpen(h.products[1],'상세 이미지');await h.settle();assert.equal(h.component('image-generation-panel').productId,h.products[1].id);assert.equal(h.component('free-image-translation-panel').translationTarget,undefined);
  old(source,'en');await h.settle();assert.equal(h.component('free-image-translation-panel').translationTarget,undefined);
  const secondSource=JSON.parse(h.products[1].image_keys)[0];h.component('product-content-editor').onTranslateImage(secondSource,'en');await h.settle();assert.deepEqual(plain(h.component('free-image-translation-panel').translationTarget),{sourceKey:secondSource,sourceLanguage:'en',sequence:1});
 }finally{h.close();}
});

test('step 6 label translation entry reveals one existing panel without replacing its instance or saving anything',async()=>{
 const h=harness();try{
  await h.settle();h.component('registration-board').onOpen(h.products[0],'표시사항');await h.settle();
  const panel=()=>nodes(h.render()).find(node=>node.props?.id==='label-translation-'+h.products[0].id),mount=h.componentMount('translation-panel'),requestCount=h.requests.length;
  assert.equal(panel().props.hidden,true);assert.equal(h.button('한글 표시사항 번역').props['aria-expanded'],false);assert.equal(h.button('한글 표시사항 번역').props['aria-controls'],panel().props.id);assert.equal(h.component('product-content-editor').section,'표시사항');
  await h.click('한글 표시사항 번역');assert.equal(panel().props.hidden,false);assert.equal(h.button('한글 표시사항 번역').props['aria-expanded'],true);assert.match(text(panel()),/수집 상품 속성의 원문과 완료된 번역 결과/);assert.match(text(panel()),/번역한 상품 속성을 한글 표시사항에 연결/);assert.equal(h.componentCount('translation-panel'),1);assert.equal(h.componentMount('translation-panel'),mount);assert.equal(h.component('translation-panel').productId,h.products[0].id);assert.equal(h.requests.length,requestCount);
  await h.click('한글 표시사항 번역');assert.equal(panel().props.hidden,true);assert.equal(h.componentMount('translation-panel'),mount);
  await h.click('번역·SEO 생성');assert.equal(panel().props.hidden,false);assert.equal(h.componentMount('translation-panel'),mount);assert.equal(h.componentCount('translation-panel'),1);assert.equal(h.requests.length,requestCount);assert.ok(h.requests.every(request=>request.method==='GET'));
 }finally{h.close();}
});

test('step 6 translation visibility resets for a different product while label edits and document actions remain available',async()=>{
 const h=harness();try{
  await h.settle();h.component('registration-board').onOpen(h.products[0],'표시사항');await h.settle();await h.click('한글 표시사항 번역');const oldMount=h.componentMount('translation-panel');
  h.component('registration-board').onOpen(h.products[1],'표시사항');await h.settle();const panel=nodes(h.render()).find(node=>node.props?.id==='label-translation-'+h.products[1].id);
  assert.equal(panel.props.hidden,true);assert.equal(h.button('한글 표시사항 번역').props['aria-expanded'],false);assert.notEqual(h.componentMount('translation-panel'),oldMount);assert.equal(h.component('translation-panel').productId,h.products[1].id);assert.equal(h.componentCount('translation-panel'),1);assert.equal(h.component('product-content-editor').section,'표시사항');
  assert.ok(nodes(h.render()).some(node=>node.props?.['aria-label']==='상품 등록 작업 공간'));assert.ok(h.requests.every(request=>request.method==='GET'));
 }finally{h.close();}
});

test('initial workspace settings from another owner are rejected before products or settings enter dashboard state',async()=>{
 for(const invalidScope of [scope('other-owner'),null,{ownerId:'test-owner',company:{code:'A01526306',name:'와이홉'}}]){
  const h=harness({settingsBody:{settings:{brand:'다른 계정의 브랜드'},scope:invalidScope}});try{
   await h.settle();assert.equal(h.component('registration-board').products.length,0);assert.match(text(h.render()),/로그인 계정이 변경/);await h.click('＋ 상품 추가');assert.equal(h.component('intake-queue-panel').settings.brand,'');assert.ok(h.requests.every(request=>request.method==='GET'));
  }finally{h.close();}
 }
});

test('actual settings dialog passes its captured account scope to the dashboard PUT and saved intake defaults',async()=>{
 const h=harness();try{
  await h.settle();await h.click('⚙ 기본설정');const editor=h.component('workspace-settings-editor');assert.equal(editor.value.brand,'계정의 저장 브랜드');assert.match(text(h.render()),/유앤채 기본설정/);
  await editor.onSave({...editor.value,brand:'직접 저장한 새 브랜드'});await h.settle();const writes=h.requests.filter(request=>request.url==='/api/settings'&&request.method==='PUT');assert.equal(writes.length,1);assert.equal(JSON.parse(writes[0].init.body).expectedOwnerId,'test-owner');assert.equal(JSON.parse(writes[0].init.body).brand,'직접 저장한 새 브랜드');assert.equal(h.component('workspace-settings-editor'),undefined);
  await h.click('＋ 상품 추가');assert.equal(h.component('intake-queue-panel').settings.brand,'직접 저장한 새 브랜드');
 }finally{h.close();}
});

test('foreign settings dialog reads expose no editor and aborted stale reads cannot replace the reopened account values',async()=>{
 const h=harness();try{
  await h.settle();h.setSettingsBody({settings:{brand:'다른 계정'},scope:scope('other-owner')});await h.click('⚙ 기본설정');assert.equal(h.component('workspace-settings-editor'),undefined);assert.match(text(h.render()),/로그인 계정이 변경/);assert.equal(h.requests.some(request=>request.method==='PUT'),false);
  await h.click('⚙ 기본설정');const pending=h.deferSettings();await h.click('⚙ 기본설정');assert.equal(h.component('workspace-settings-editor'),undefined);await h.click('⚙ 기본설정');assert.equal(h.requests.filter(request=>request.url==='/api/settings').at(-1).init.signal.aborted,true);
  h.setSettingsBody({settings:{brand:'다시 연 현재 계정'},scope:scope()});await h.click('⚙ 기본설정');assert.equal(h.component('workspace-settings-editor').value.brand,'다시 연 현재 계정');pending.resolve(Response.json({settings:{brand:'늦게 온 이전 계정'},scope:scope('other-owner')}));await h.settle();assert.equal(h.component('workspace-settings-editor').value.brand,'다시 연 현재 계정');assert.equal(h.requests.some(request=>request.method==='PUT'),false);
 }finally{h.close();}
});

test('a PUT response bound to a different owner cannot replace current settings or close the captured editor',async()=>{
 const h=harness();try{
  await h.settle();await h.click('⚙ 기본설정');const editor=h.component('workspace-settings-editor');h.setSettingsPutReply(async()=>Response.json({settings:{brand:'다른 계정 저장 결과'},scope:scope('other-owner')}));await assert.rejects(()=>editor.onSave({...editor.value,brand:'보존할 입력'}),/저장한 기본설정의 계정/);await h.settle();assert.ok(h.component('workspace-settings-editor'));await h.click('＋ 상품 추가');assert.equal(h.component('intake-queue-panel').settings.brand,'계정의 저장 브랜드');
 }finally{h.close();}
});

test('workspace settings reads begun before or during a successful save cannot replace the saved intake defaults for either company',async()=>{
 for(const code of ['A01526306','A01464742'])for(const started of ['before-save','during-save']){
  const original={settings:{brand:'원래 브랜드',exchangeRate:350},scope:scope('test-owner',code)},h=harness({settingsBody:original});
  try{
   await h.settle();await h.click('⚙ 기본설정');const editor=h.component('workspace-settings-editor'),before=plain(h.products);
   const saved={...editor.value,brand:'직접 저장한 브랜드',exchangeRate:700},reply=deferred();
   h.setSettingsPutReply(async()=>reply.promise);
   let pending;
   if(started==='before-save'){pending=h.deferSettings();h.component('collection-batch-panel').onSaved();await h.settle();}
   const saving=editor.onSave(saved);await h.settle();
   if(started==='during-save'){pending=h.deferSettings();h.component('collection-batch-panel').onSaved();await h.settle();}
   reply.resolve(Response.json({settings:saved,scope:original.scope}));await saving;await h.settle();
   await h.click('＋ 상품 추가');assert.equal(h.component('intake-queue-panel').settings.exchangeRate,700);
   pending.resolve(Response.json(original));await h.settle();
   assert.equal(h.component('intake-queue-panel').settings.brand,saved.brand);assert.equal(h.component('intake-queue-panel').settings.exchangeRate,700);
   assert.equal(h.component('workspace-settings-editor'),undefined);assert.deepEqual(plain(h.products),before);
   const writes=h.requests.filter(request=>request.method!=='GET');assert.equal(writes.length,1);assert.equal(writes[0].url,'/api/settings');assert.equal(JSON.parse(writes[0].init.body).expectedOwnerId,'test-owner');
  }finally{h.close();}
 }
});

test('a failed settings save keeps the captured editor and permits a new successful workspace reload',async()=>{
 const h=harness();try{
  await h.settle();await h.click('⚙ 기본설정');const editor=h.component('workspace-settings-editor');
  h.setSettingsPutReply(async()=>Response.json({error:'보관 실패'},{status:503}));
  await assert.rejects(editor.onSave({...editor.value,brand:'보존할 입력',exchangeRate:700}),/보관 실패/);await h.settle();
  assert.ok(h.component('workspace-settings-editor'));assert.equal(h.componentMount('workspace-settings-editor').mounted,true);
  h.setSettingsBody({settings:{brand:'실제로 다시 조회한 설정',exchangeRate:425},scope:scope()});h.component('collection-batch-panel').onSaved();await h.settle();
  await h.click('＋ 상품 추가');assert.equal(h.component('intake-queue-panel').settings.brand,'실제로 다시 조회한 설정');assert.equal(h.component('intake-queue-panel').settings.exchangeRate,425);
  assert.equal(h.component('workspace-settings-editor').value.brand,editor.value.brand,'a background read does not replace the unsaved editor snapshot');
  assert.equal(h.requests.filter(request=>request.method==='PUT').length,1);
 }finally{h.close();}
});

test('a workspace read completed during settings saving cannot replace current defaults before the save acknowledgement',async()=>{
 const h=harness();try{
  await h.settle();await h.click('⚙ 기본설정');const editor=h.component('workspace-settings-editor'),reply=deferred();h.setSettingsPutReply(async()=>reply.promise);
  const saving=editor.onSave({...editor.value,brand:'저장할 브랜드',exchangeRate:700});await h.settle();
  const pending=h.deferSettings();h.component('collection-batch-panel').onSaved();await h.settle();
  pending.resolve(Response.json({settings:{brand:'저장 중 먼저 온 조회',exchangeRate:999},scope:scope()}));await h.settle();
  await h.click('＋ 상품 추가');assert.equal(h.component('intake-queue-panel').settings.brand,'계정의 저장 브랜드');assert.equal(h.component('intake-queue-panel').settings.exchangeRate,350);
  assert.ok(h.component('workspace-settings-editor'));reply.resolve(Response.json({settings:{...editor.value,brand:'저장할 브랜드',exchangeRate:700},scope:scope()}));await saving;await h.settle();
  assert.equal(h.component('intake-queue-panel').settings.exchangeRate,700);assert.equal(h.component('workspace-settings-editor'),undefined);
 }finally{h.close();}
});

test('a settings cancellation permits current reads and a newer read started after a successful save remains usable',async()=>{
 const h=harness();try{
  await h.settle();await h.click('⚙ 기본설정');const editor=h.component('workspace-settings-editor'),pending=h.deferSettings();
  h.component('collection-batch-panel').onSaved();await h.settle();editor.onClose();await h.settle();
  pending.resolve(Response.json({settings:{brand:'취소 후 현재 설정',exchangeRate:425},scope:scope()}));await h.settle();
  await h.click('＋ 상품 추가');assert.equal(h.component('intake-queue-panel').settings.exchangeRate,425);assert.equal(h.requests.filter(request=>request.method==='PUT').length,0);
  await h.click('⚙ 기본설정');const current=h.component('workspace-settings-editor');await current.onSave({...current.value,exchangeRate:700});await h.settle();
  h.setSettingsBody({settings:{brand:'다음 조회',exchangeRate:800},scope:scope()});h.component('collection-batch-panel').onSaved();await h.settle();
  assert.equal(h.component('intake-queue-panel').settings.exchangeRate,800);assert.equal(h.component('intake-queue-panel').settings.brand,'다음 조회');
 }finally{h.close();}
});

test('a late old-owner workspace read or save acknowledgement cannot replace or close the current owner editor',async()=>{
 for(const operation of ['read','save']){
  const h=harness();try{
   await h.settle();await h.click('⚙ 기본설정');const old=h.component('workspace-settings-editor');let pending,request;
   if(operation==='read'){pending=h.deferSettings();h.component('collection-batch-panel').onSaved();await h.settle();}
   else{pending=deferred();h.setSettingsPutReply(async()=>pending.promise);request=old.onSave({...old.value,brand:'첫 계정 저장'});await h.settle();}
   const nextScope=scope('next-owner','A01464742');h.setSettingsBody({settings:{brand:'다음 계정 설정',exchangeRate:425},scope:nextScope});h.switchOwner('next-owner');await h.settle();
   const current=h.component('workspace-settings-editor');assert.ok(current);assert.equal(current.value.brand,'다음 계정 설정');
   pending.resolve(Response.json({settings:{brand:'이전 계정의 늦은 결과',exchangeRate:700},scope:scope()}));
   if(request)await assert.rejects(request,/계정|변경/);await h.settle();
   assert.ok(h.component('workspace-settings-editor'));assert.equal(h.component('workspace-settings-editor').value.brand,'다음 계정 설정');
   await assert.rejects(old.onSave(old.value),/계정|변경/);
   await h.click('＋ 상품 추가');assert.equal(h.component('intake-queue-panel').settings.brand,'다음 계정 설정');assert.equal(h.component('intake-queue-panel').settings.exchangeRate,425);
   assert.equal(h.requests.filter(value=>value.method==='PUT').length,operation==='save'?1:0);
  }finally{h.close();}
 }
});

test('an unmounted settings save cannot write dashboard state after its acknowledgement',async()=>{
 const h=harness();await h.settle();await h.click('⚙ 기본설정');const editor=h.component('workspace-settings-editor'),reply=deferred();
 h.setSettingsPutReply(async()=>reply.promise);const saving=editor.onSave({...editor.value,exchangeRate:700});await h.settle();h.close();
 reply.resolve(Response.json({settings:{...editor.value,exchangeRate:700},scope:scope()}));await assert.rejects(saving,/계정|변경/);await h.settle();
 assert.equal(h.lateWrites,0);assert.equal(h.requests.filter(request=>request.method==='PUT').length,1);
});

test('verified queue reload uses the production owner and invalidates older workspace GETs without touching product data',async()=>{
 for(const code of ['A01526306','A01464742']){
  const accountScope=scope('test-owner',code),h=harness({settingsBody:{settings:{brand:'계정의 원래 설정',exchangeRate:350},scope:accountScope}});
  try{
   await h.settle();await h.click('＋ 상품 추가');const queue=h.component('intake-queue-panel'),before=plain(h.products);assert.equal(queue.workspaceOwnerId,'test-owner');
   const pending=h.deferSettings();h.component('collection-batch-panel').onSaved();await h.settle();
   const epoch=queue.onSettingsReloadStarted(),updated={...queue.settings,brand:'계정의 최신 설정',exchangeRate:700};queue.onSettingsReloaded(updated,accountScope,epoch);await h.settle();
   pending.resolve(Response.json({settings:{brand:'늦게 온 원래 설정',exchangeRate:350},scope:accountScope}));await h.settle();
   assert.equal(h.component('intake-queue-panel').settings.brand,updated.brand);assert.equal(h.component('intake-queue-panel').settings.exchangeRate,700);
   assert.throws(()=>queue.onSettingsReloaded(queue.settings,accountScope,epoch),/변경|다시/);assert.deepEqual(plain(h.products),before);assert.ok(h.requests.every(request=>request.method==='GET'));
  }finally{h.close();}
 }
});

test('queue reads begun before a settings PUT or attempted during saving cannot replace its acknowledgement; a post-save reload still works',async()=>{
 const h=harness();try{
  await h.settle();await h.click('＋ 상품 추가');const queue=h.component('intake-queue-panel'),epoch=queue.onSettingsReloadStarted();
  await h.click('⚙ 기본설정');const editor=h.component('workspace-settings-editor'),reply=deferred();h.setSettingsPutReply(async()=>reply.promise);
  const saved={...editor.value,brand:'실제 저장한 설정',exchangeRate:700},saving=editor.onSave(saved);await h.settle();const reads=h.requests.length;
  assert.throws(()=>queue.onSettingsReloadStarted(),/저장 중/);assert.throws(()=>queue.onSettingsReloaded(queue.settings,scope(),epoch),/변경|다시/);assert.equal(h.requests.length,reads);
  reply.resolve(Response.json({settings:saved,scope:scope()}));await saving;await h.settle();assert.throws(()=>queue.onSettingsReloaded(queue.settings,scope(),epoch),/변경|다시/);
  assert.equal(h.component('intake-queue-panel').settings.exchangeRate,700);
  const current=h.component('intake-queue-panel'),currentEpoch=current.onSettingsReloadStarted();current.onSettingsReloaded({...saved,brand:'다음 검증 조회',exchangeRate:800},scope(),currentEpoch);await h.settle();
  assert.equal(h.component('intake-queue-panel').settings.exchangeRate,800);assert.equal(h.component('intake-queue-panel').settings.brand,'다음 검증 조회');assert.equal(h.requests.filter(request=>request.method==='PUT').length,1);
 }finally{h.close();}
});

test('queue settings callbacks reject missing or foreign scope, replaced owner and unmount before changing defaults',async()=>{
 const h=harness();try{
  await h.settle();await h.click('＋ 상품 추가');const old=h.component('intake-queue-panel'),epoch=old.onSettingsReloadStarted(),before=plain(old.settings),requests=h.requests.length;
  for(const candidate of [undefined,null,{},scope('other-owner'),{ownerId:'test-owner',company:{code:'A01526306',name:'와이홉'}}])assert.throws(()=>old.onSettingsReloaded({...old.settings,brand:'받으면 안 되는 값'},candidate,epoch),/변경|다시/);
  assert.deepEqual(plain(h.component('intake-queue-panel').settings),before);assert.equal(h.requests.length,requests);
  h.setSettingsBody({settings:{brand:'다음 계정 설정',exchangeRate:425},scope:scope('next-owner','A01464742')});h.switchOwner('next-owner');await h.settle();
  assert.throws(()=>old.onSettingsReloadStarted(),/계정|변경/);assert.throws(()=>old.onSettingsReloaded(old.settings,scope(),epoch),/계정|변경/);
  const current=h.component('intake-queue-panel'),currentEpoch=current.onSettingsReloadStarted();assert.equal(current.workspaceOwnerId,'next-owner');current.onSettingsReloaded(current.settings,scope('next-owner','A01464742'),currentEpoch);await h.settle();
  assert.equal(h.component('intake-queue-panel').settings.brand,'다음 계정 설정');const final=plain(h.component('intake-queue-panel').settings);h.close();
  assert.throws(()=>current.onSettingsReloadStarted(),/계정|변경/);assert.throws(()=>current.onSettingsReloaded(current.settings,scope('next-owner','A01464742'),currentEpoch),/계정|변경/);assert.equal(h.lateWrites,0);assert.equal(final.brand,'다음 계정 설정');
 }finally{h.close();}
});

test('primary registration stage cells open the correct product option board before any editor or write',async()=>{
 const labels=['SEO설정','가격설정','대표이미지','추가이미지','상세이미지','한글표시사항','견적서'];
 for(const label of labels){
  const h=harness({realRegistrationBoard:true});try{
   await h.settle();const selectedProduct=h.products[1],initialReads=h.requests.length;
   const cell=nodes(h.render()).find(node=>node.type==='button'&&node.props['aria-label']===selectedProduct.title+' '+label+' 열기');assert.ok(cell,'Missing stage cell '+label);cell.props.onClick();await h.settle();
   assert.equal(h.component('product-option-board').productId,selectedProduct.id);assert.equal(h.component('product-content-editor'),undefined);assert.equal(h.component('product-options-editor'),undefined);assert.equal(h.requests.length,initialReads);assert.ok(h.requests.every(request=>request.method==='GET'));
  }finally{h.close();}
 }
});

test('every typed option stage opens the intended product workspace and retains the exact option identity',async()=>{
 for(const step of ['SEO','가격','대표 이미지','추가 이미지','상세 이미지','표시사항','견적서','옵션']){
  const h=harness();try{
   await h.settle();const selectedProduct=h.products[1],optionId='option-b-2';h.component('registration-board').onOptions(selectedProduct);await h.settle();const board=h.component('product-option-board');assert.equal(board.productId,selectedProduct.id);assert.equal(typeof board.onStage,'function');const initialReads=h.requests.length;
   board.onStage(optionId,step);await h.settle();assert.equal(h.componentVisible('product-option-board'),false);assert.equal(h.component('product-content-editor').product.id,selectedProduct.id);assert.equal(h.component('product-options-editor').product.id,selectedProduct.id);assert.equal(h.component('product-options-editor').focusedOptionId,optionId);assert.equal(h.component('product-options-editor').initialBulkAction,undefined);
   if(step==='옵션')assert.equal(h.button('옵션 관리').props['aria-pressed'],true);else assert.ok(nodes(h.render()).some(node=>node.type==='button'&&node.props['aria-current']==='step'&&text(node)===(['SEO','가격','대표 이미지','추가 이미지','상세 이미지','표시사항','견적서'].indexOf(step)+1)+({'SEO':'SEO 설정','가격':'가격 설정','표시사항':'한글 표시사항','견적서':'견적서 작업'}[step]??step)));
   if(step==='가격')assert.equal(h.component('product-options-editor').pricingView,true);
   if(step==='대표 이미지')assert.equal(h.component('product-options-editor').imageView,true);
   if(step==='견적서')assert.deepEqual(plain(h.component('quotation-panel').navigationTarget),{optionId,fieldId:'title'});
   assertProductNavigation(h.requests.slice(initialReads),selectedProduct.id);assert.ok(h.requests.every(request=>request.method==='GET'));
  }finally{h.close();}
 }
});

test('primary SEO and explicitly opened option SEO preserve independent drafts across steps',async()=>{
 const h=harness();try{
  await h.settle();const first=h.products[0],fresh={...first,updated_at:'2026-10-07T00:00:01.000Z'};
  h.setProductReply(async id=>Response.json({product:id===first.id?fresh:h.products[1]}));
  h.component('registration-board').onOptions(first);await h.settle();
  h.component('product-option-board').onStage('option-a-2','SEO');await h.settle();
  const editor=h.component('option-seo-editor');assert.ok(editor);assert.equal(editor.productId,first.id);assert.equal(editor.optionId,'option-a-2');assert.equal(editor.version,fresh.updated_at);
  const common=nodes(h.render()).find(node=>node.type==='details'&&text(node.props.children[0])==='옵션별 추가 SEO 편집');
  assert.ok(common);assert.notEqual(common.props.open,true);assert.equal(common.props.children[0].props.hidden,false);
  assert.equal(h.componentVisible('option-seo-editor'),false);assert.equal(h.componentVisible('seo-workspace-editor'),true);assert.equal(h.component('seo-workspace-editor').focusedOptionId,'option-a-2');
  await h.toggleDetails('옵션별 추가 SEO 편집');
  assert.equal(h.componentVisible('option-seo-editor'),true);assert.equal(h.componentVisible('seo-workspace-editor'),true);assert.equal(h.componentVisible('product-content-editor'),false);
  assert.equal(h.component('seo-workspace-editor').productId,first.id);assert.equal(h.component('seo-workspace-editor').version,fresh.updated_at);
  const before=editor.refreshToken;editor.onSaved();await h.settle();assert.notEqual(h.component('option-seo-editor').refreshToken,before);
  const mount=h.componentMount('option-seo-editor'),commonMount=h.componentMount('seo-workspace-editor');
  const combined=mount.ancestors.find(node=>node.props?.className==='seo-content-columns');
  assert.ok(combined);assert.ok(commonMount.ancestors.includes(combined),'both editors share the retained stage-one host');
  const input=name=>nodes(h.render()).find(node=>node.props?.['data-test-editor']===name);
  input('option-seo-editor').props.onChange({target:{value:'미저장 선택 옵션 제목'}});
  input('seo-workspace-editor').props.onChange({target:{value:'미저장 공통 SEO'}});
  await h.click('2가격 설정');assert.equal(h.componentMount('option-seo-editor'),mount);assert.equal(h.componentMount('seo-workspace-editor'),commonMount);
  assert.equal(h.componentVisible('option-seo-editor'),false);assert.equal(h.componentVisible('seo-workspace-editor'),false);
  assert.equal(input('option-seo-editor').props.value,'미저장 선택 옵션 제목');assert.equal(input('seo-workspace-editor').props.value,'미저장 공통 SEO');
  await h.click('1SEO 설정');assert.equal(h.componentMount('option-seo-editor'),mount);assert.equal(h.componentMount('seo-workspace-editor'),commonMount);
  assert.equal(h.componentVisible('option-seo-editor'),true);assert.equal(h.componentVisible('seo-workspace-editor'),true);
  assert.equal(input('option-seo-editor').props.value,'미저장 선택 옵션 제목');assert.equal(input('seo-workspace-editor').props.value,'미저장 공통 SEO');
  assert.ok(h.requests.every(request=>request.method==='GET'));
  h.component('registration-board').onOpen(h.products[1],'SEO');await h.settle();assert.equal(h.component('option-seo-editor'),undefined);assert.equal(h.component('seo-workspace-editor').productId,h.products[1].id);
  assert.equal(h.componentVisible('seo-workspace-editor'),true);assert.equal(input('seo-workspace-editor').props.value,'');
  const normal=nodes(h.render()).find(node=>node.type==='details'&&text(node.props.children[0])==='옵션별 추가 SEO 편집');assert.equal(normal.props.hidden,true);
 }finally{h.close();}
});

test('option management navigation prepares the existing removal editor without deleting or saving and resets for another product',async()=>{
 const h=harness();try{
  await h.settle();const first=h.products[0],second=h.products[1];h.component('registration-board').onOptions(first);await h.settle();const board=h.component('product-option-board'),initialReads=h.requests.length;assert.equal(typeof board.onManage,'function');board.onManage('option-a-2');await h.settle();
  const editor=h.component('product-options-editor');assert.equal(editor.product.id,first.id);assert.equal(editor.focusedOptionId,'option-a-2');assert.equal(editor.initialBulkAction,'remove');assert.equal(h.button('옵션 관리').props['aria-pressed'],true);assert.equal(h.componentVisible('product-option-board'),false);assertProductNavigation(h.requests.slice(initialReads),first.id);assert.ok(h.requests.every(request=>request.method==='GET'));
  h.component('registration-board').onOpen(second,'옵션');await h.settle();assert.equal(h.component('product-options-editor').product.id,second.id);assert.equal(h.component('product-options-editor').initialBulkAction,undefined);assert.equal(h.component('product-options-editor').focusedOptionId,undefined);assert.ok(h.requests.every(request=>request.method==='GET'));
 }finally{h.close();}
});

test('invalid option IDs and unsupported stages cannot turn option-board navigation into an editor action or write',async()=>{
 const h=harness();try{
  await h.settle();h.component('registration-board').onOptions(h.products[0]);await h.settle();const initialReads=h.requests.length;
  for(const optionId of ['', 'x'.repeat(81), 'other/option']){
   h.component('product-option-board').onStage(optionId,'가격');await h.settle();assert.equal(h.component('product-option-board').productId,h.products[0].id);assert.equal(h.component('product-options-editor'),undefined);
   h.component('product-option-board').onManage(optionId);await h.settle();assert.equal(h.component('product-option-board').productId,h.products[0].id);assert.equal(h.component('product-options-editor'),undefined);
  }
  for(const step of ['','unknown-stage','번역','작업']){h.component('product-option-board').onStage('option-a-2',step);await h.settle();assert.equal(h.component('product-option-board').productId,h.products[0].id);assert.equal(h.component('product-options-editor'),undefined);}
  assert.equal(h.requests.length,initialReads);assert.ok(h.requests.every(request=>request.method==='GET'));
 }finally{h.close();}
});

test('retained callbacks from a closed or replaced option board cannot issue reads or reopen its product',async()=>{
 for(const mode of ['closed','replaced']){
  const h=harness();try{
   await h.settle();h.component('registration-board').onOptions(h.products[0]);await h.settle();const old=h.component('product-option-board');
   if(mode==='closed')await h.click('×');else{h.component('registration-board').onOptions(h.products[1]);await h.settle();}
   const initialReads=h.requests.length;old.onStage('option-a-2','견적서');old.onManage('option-a-2');old.onContent('표시사항');old.onImage('option-a-2');old.onEdit('option-a-2');old.onQuotation('option-a-2');await h.settle();
   assert.equal(h.requests.length,initialReads);assert.equal(h.component('product-content-editor'),undefined);assert.equal(h.component('product-options-editor'),undefined);
   if(mode==='closed')assert.equal(h.component('product-option-board'),undefined);else assert.equal(h.component('product-option-board').productId,h.products[1].id);assert.ok(h.requests.every(request=>request.method==='GET'));
  }finally{h.close();}
 }
});

test('a delayed collection product read cannot replace the newer product option board',async()=>{
 const h=harness();try{
  await h.settle();const first=h.products[0],second=h.products[1],pending=h.deferProduct(first.id),controller=new AbortController();
  const opening=h.component('collection-batch-panel').onOpenProduct(first.id,'SEO',controller.signal);await h.settle();const read=h.requests.at(-1);assert.equal(read.url,'/api/products/'+first.id);assert.equal(read.init.signal,controller.signal);
  h.component('registration-board').onOptions(second);await h.settle();assert.equal(h.component('product-option-board').productId,second.id);pending.resolve(Response.json({product:first}));await opening;await h.settle();
  assert.equal(h.component('product-option-board').productId,second.id);assert.equal(h.component('product-content-editor'),undefined);assert.equal(h.component('product-options-editor'),undefined);assert.ok(h.requests.every(request=>request.method==='GET'));
 }finally{h.close();}
});

test('closing, replacing or unmounting a pending option-stage read aborts it and ignores the late product',async()=>{
 for(const mode of ['closed','replaced','unmounted']){
  const h=harness();try{
   await h.settle();const first=h.products[0];h.component('registration-board').onOptions(first);await h.settle();const pending=h.deferProduct(first.id);h.component('product-option-board').onStage('option-a-2','가격');await h.settle();const read=h.requests.at(-1);assert.equal(read.url,'/api/products/'+first.id);assert.equal(read.init.cache,'no-store');assert.equal(read.init.signal.aborted,false);
   if(mode==='closed')await h.click('×');else if(mode==='replaced'){h.component('registration-board').onOptions(h.products[1]);await h.settle();}else h.close();assert.equal(read.init.signal.aborted,true);
   pending.resolve(Response.json({product:{...first,title:'무시할 지연 상품',image_keys:'["test-owner/late.png"]'}}));await h.settle();assert.equal(h.lateWrites,0);assert.equal(h.component('product-content-editor'),undefined);assert.equal(h.component('product-options-editor'),undefined);
   if(mode==='replaced')assert.equal(h.component('product-option-board').productId,h.products[1].id);else if(mode==='closed')assert.equal(h.component('product-option-board'),undefined);assert.ok(h.requests.every(request=>request.method==='GET'));
  }finally{h.close();}
 }
});

test('pending option navigation locks stage and management callbacks to one product GET',async()=>{
 const h=harness();try{
  await h.settle();const first=h.products[0];h.component('registration-board').onOptions(first);await h.settle();const board=h.component('product-option-board'),initialReads=h.requests.length,pending=h.deferProduct(first.id);
  board.onStage('option-a-2','가격');board.onStage('option-a-2','대표 이미지');board.onManage('option-a-2');await h.settle();const reads=h.requests.slice(initialReads);assert.equal(reads.length,1);assert.equal(reads[0].url,'/api/products/'+first.id);assert.equal(reads[0].method,'GET');assert.equal(reads[0].init.cache,'no-store');assert.equal(reads[0].init.signal.aborted,false);assert.equal(h.component('product-options-editor'),undefined);
  pending.resolve(Response.json({product:first}));await h.settle();assert.equal(h.component('product-options-editor').focusedOptionId,'option-a-2');assert.equal(h.component('product-options-editor').pricingView,true);assert.equal(h.component('product-options-editor').initialBulkAction,undefined);assert.equal(h.componentVisible('product-option-board'),false);assert.ok(h.requests.every(request=>request.method==='GET'));
 }finally{h.close();}
});

test('option-stage navigation forwards the fresh owned product version and image library to the editor',async()=>{
 const h=harness();try{
  await h.settle();const first=h.products[0],fresh={...first,title:'새로 저장된 상품명',updated_at:'2026-10-06T00:00:01.000Z',image_keys:JSON.stringify(['test-owner/'+first.id+'/fresh.png'])};h.setProductReply(async id=>Response.json({product:id===first.id?fresh:h.products[1]}));
  h.component('registration-board').onOptions(first);await h.settle();const initialReads=h.requests.length;h.component('product-option-board').onStage('option-a-2','대표 이미지');await h.settle();
  assertProductNavigation(h.requests.slice(initialReads),first.id);assert.equal(h.component('product-content-editor').product.updated_at,fresh.updated_at);assert.equal(h.component('product-content-editor').product.image_keys,fresh.image_keys);assert.equal(h.component('product-options-editor').product.title,fresh.title);assert.deepEqual(Array.from(h.component('image-generation-panel').imageKeys),JSON.parse(fresh.image_keys));assert.equal(h.component('image-generation-panel').version,fresh.updated_at);assert.equal(h.component('product-options-editor').focusedOptionId,'option-a-2');assert.ok(h.requests.every(request=>request.method==='GET'));
 }finally{h.close();}
});

test('foreign or malformed fresh products retain the option board and permit a successful read-only retry',async()=>{
 const first=product('product-a');
 for(const reply of [{},{product:null},null,{product:{...first,id:'different-product'}},{product:{...first,owner_id:'other-owner'}},{product:{...first,owner_id:undefined}}]){
  const h=harness();try{
   await h.settle();h.component('registration-board').onOptions(h.products[0]);await h.settle();h.setProductReply(async()=>Response.json(reply));const initialReads=h.requests.length;h.component('product-option-board').onStage('option-a-2','가격');await h.settle();
   assert.equal(h.requests.length,initialReads+1);assert.equal(h.component('product-option-board').productId,first.id);assert.equal(h.component('product-content-editor'),undefined);assert.equal(h.component('product-options-editor'),undefined);assert.ok(nodes(h.render()).some(node=>node.props?.role==='status'));
   h.setProductReply(null);h.component('product-option-board').onStage('option-a-2','견적서');await h.settle();assert.equal(h.componentVisible('product-option-board'),false);assert.equal(h.component('product-options-editor').product.id,first.id);assert.deepEqual(plain(h.component('quotation-panel').navigationTarget),{optionId:'option-a-2',fieldId:'title'});assert.ok(h.requests.every(request=>request.method==='GET'));
  }finally{h.close();}
 }
});

test('dirty or busy workspace blocks a new option board, quotation entry and retained management navigation',async()=>{
 for(const mode of ['dirty','busy']){
  const h=harness();try{
   await h.settle();const first=h.products[0],second=h.products[1];h.component('registration-board').onOptions(first);await h.settle();const old=h.component('product-option-board');h.component('registration-board').onOpen(first,'SEO');await h.settle();h.setWorkspaceEdits({dirty:mode==='dirty',busy:mode==='busy'});const initialReads=h.requests.length;
   h.component('registration-board').onOptions(second);await h.settle();assert.equal(h.component('product-option-board'),undefined);assert.equal(h.component('product-content-editor').product.id,first.id);assert.equal(h.component('product-content-editor').section,'SEO');
   const quoteStep=nodes(h.render()).find(node=>node.type==='button'&&text(node)==='7견적서 작업');assert.ok(quoteStep);quoteStep.props.onClick();old.onStage('option-a-2','견적서');old.onManage('option-a-2');await h.settle();
   assert.equal(h.component('product-content-editor').product.id,first.id);assert.equal(h.component('product-content-editor').section,'SEO');assert.equal(h.component('product-options-editor').initialBulkAction,undefined);assert.equal(h.component('product-option-board'),undefined);assert.equal(h.requests.length,initialReads);assert.ok(h.requests.every(request=>request.method==='GET'));
  }finally{h.close();}
 }
});

test('global intake busy state blocks captured board and option callbacks before rerender and releases after completion',async()=>{
 const h=harness();try{
  await h.settle();await h.click('＋ 상품 추가');const intake=h.component('intake-queue-panel'),registration=h.component('registration-board'),first=h.products[0],initialReads=h.requests.length;
  intake.onBusy(true);registration.onOptions(first);await h.settle();assert.equal(h.componentVisible('product-option-board'),false);assert.equal(h.component('product-content-editor'),undefined);assert.equal(h.requests.length,initialReads);
  intake.onBusy(false);registration.onOptions(first);await h.settle();const optionBoard=h.component('product-option-board');assert.equal(optionBoard.productId,first.id);
  intake.onBusy(true);optionBoard.onStage('option-a-2','가격');optionBoard.onManage('option-a-2');await h.settle();assert.equal(h.requests.length,initialReads);assert.equal(h.component('product-option-board').productId,first.id);assert.equal(h.component('product-options-editor'),undefined);
  intake.onBusy(false);optionBoard.onStage('option-a-2','가격');await h.settle();assertProductNavigation(h.requests.slice(initialReads),first.id);assert.equal(h.componentVisible('product-option-board'),false);assert.equal(h.component('product-options-editor').focusedOptionId,'option-a-2');assert.equal(h.component('product-options-editor').initialBulkAction,undefined);assert.ok(h.requests.every(request=>request.method==='GET'));
 }finally{h.close();}
});


test('single receipt save refreshes only status and preserves current editable product and quotation session',async()=>{
 const h=harness();try{
  await h.settle();const first=h.products[0];h.component('registration-board').onOpen(first,'견적서');await h.settle();
  const quote=h.component('quotation-panel'),token=quote.refreshToken,mount=h.componentMount('quotation-panel'),summary=singleSummary();
  h.setProductReply(async()=>Response.json({product:{...first,title:'must not replace edited source',supply_price:999999,hub_single_receipt:summary,removal_policy:{blocked:true,code:'PRODUCT_HUB_TRANSMITTED',reason:'protected',receipt:null,singleReceipt:summary}}}));
  quote.onReceiptSaved();await h.settle();const updated=h.component('registration-board').products.find(row=>row.id===first.id);
  assert.equal(updated.hub_single_receipt.qvtRequestId,7901);assert.equal(updated.title,first.title);assert.equal(updated.supply_price,first.supply_price);assert.equal(updated.updated_at,first.updated_at);
  assert.equal(h.component('quotation-panel').refreshToken,token);assert.equal(h.componentMount('quotation-panel'),mount);assert.ok(h.requests.every(row=>row.method==='GET'));
 }finally{h.close();}
});
test('a late older receipt status read cannot overwrite the latest read or reset source clocks',async()=>{
 const h=harness();try{
  await h.settle();const first=h.products[0];h.component('registration-board').onOpen(first,'견적서');await h.settle();const saved=h.component('quotation-panel').onReceiptSaved;
  const older=h.deferProduct(first.id);saved();await h.settle();const summary=singleSummary();summary.qvtRequestId=7902;
  h.setProductReply(async()=>Response.json({product:{...first,hub_single_receipt:summary}}));saved();await h.settle();
  older.resolve(Response.json({product:{...first,hub_single_receipt:singleSummary()}}));await h.settle();
  assert.equal(h.component('registration-board').products.find(row=>row.id===first.id).hub_single_receipt.qvtRequestId,7902);assert.ok(h.requests.every(row=>row.method==='GET'));
 }finally{h.close();}
});
test('changed product versions or login owner discard receipt-only refreshes',async()=>{
 for(const kind of ['version','owner','unmount']){
  const h=harness();try{
   await h.settle();const first=h.products[0];h.component('registration-board').onOpen(first,'견적서');await h.settle();const saved=h.component('quotation-panel').onReceiptSaved;
   if(kind==='version'){h.setProductReply(async()=>Response.json({product:{...first,updated_at:'2099-01-01T00:00:00.000Z',hub_single_receipt:singleSummary()}}));saved();await h.settle();assert.equal(h.component('registration-board').products.find(row=>row.id===first.id).hub_single_receipt,undefined);}
   else{const pending=h.deferProduct(first.id);saved();await h.settle();if(kind==='owner')h.switchOwner('other-owner');else h.close();pending.resolve(Response.json({product:{...first,hub_single_receipt:singleSummary()}}));await h.settle();assert.equal(h.lateWrites,0);if(kind==='owner')assert.equal(h.component('registration-board').products.find(row=>row.id===first.id)?.hub_single_receipt,undefined);}
  }finally{h.close();}
 }
});

test('failed category layout is visible, blocks navigation and preparation, and retries without discarding SEO input',async()=>{
 let reads=0;
 const h=harness({registrationLayoutRequest:async()=>++reads===1?Response.json({error:'합성 조회 실패'},{status:503}):Response.json({format:'yoofam-registration-layout-v1',productId:'product-a',productVersion:version,sizeChartRequired:true,categoryContext:{source:'collection',profileId:null,categoryId:'81452',categoryPath:['합성 카테고리']}})});
 try{
  await h.settle();h.component('registration-board').onOpen(h.products[0],'SEO');await h.settle();
  assert.match(text(h.render()),/카테고리의 필수 단계를 다시 확인/);assert.equal(h.button('다음 →').props.disabled,true);
  const draft=nodes(h.render()).find(node=>node.props?.['data-test-editor']==='product-content-editor');draft.props.onChange({target:{value:'보존할 SEO 초안'}});
  h.component('quotation-panel').onPrepareSubmission();await h.settle();assert.equal(h.component('submission-review-panel'),undefined);
  await h.click('등록 단계 다시 확인');assert.equal(reads,2);
  const nav=nodes(h.render()).find(node=>node.props?.['aria-label']==='상품 등록 8단계');assert.ok(nav);assert.match(text(nav),/6사이즈표7한글 표시사항8견적서 작업/);
  assert.equal(h.button('다음 →').props.disabled,false);assert.equal(nodes(h.render()).find(node=>node.props?.['data-test-editor']==='product-content-editor').props.value,'보존할 SEO 초안');
  assert.ok(h.requests.every(request=>request.method==='GET'));
 }finally{h.close();}
});

test('quotation SEO navigation reaches the current product and cannot move a later product',async()=>{
 const h=harness();try{
  await h.settle();h.component('registration-board').onOpen(h.products[0],'견적서');await h.settle();const first=h.component('quotation-panel').onEditSeo;first();await h.settle();
  assert.equal(nodes(h.render()).find(node=>node.props?.['data-registration-stage']).props['data-registration-stage'],'SEO');
  h.component('registration-board').onOpen(h.products[1],'가격');await h.settle();first();await h.settle();
  assert.equal(nodes(h.render()).find(node=>node.props?.['data-registration-stage']).props['data-registration-stage'],'가격');assert.ok(h.requests.every(request=>request.method==='GET'));
 }finally{h.close();}
});

for(const company of schemaCompanies)test(`reviewed source ACK resumes only its pinned intake row and preserves category/guidance (${company.code})`,async()=>{
 const {before,saved}=reviewSourceFixture('test-owner',company),capture={format:'yoofam-saved-page-capture-v1',sourceUrl:before.snapshot.sourceUrl,captureId:before.id,fingerprint:before.fingerprint,revision:before.revision};
 const row={id:'reviewed-row',profile:{id:'00000000-0000-4000-8000-000000000764',revision:3,categoryId:'81452',categoryPath:['선택한 카테고리']},url:capture.sourceUrl,features:'직접 쓴 특징',keywords:'직접 키워드',status:'draft',message:'',sourceCapture:capture},other={...row,id:'untouched-row',url:'https://detail.1688.com/offer/764000000002.html',sourceCapture:undefined},accepted=[];
 const sourceState={items:[before],reload(){},acceptReviewed(old,next){accepted.push([old,next]);sourceState.items=[next];return true;}};
 const h=harness({initialIntakeRows:[row,other],sourceRegistrationsState:sourceState});try{
  await h.settle();await h.click('＋ 상품 추가');const queue=h.component('intake-queue-panel');queue.onReviewSource(before,row.id);await h.settle();
  const panel=h.component('source-inbox-panel');assert.equal(panel.initialItem.id,before.id);panel.onReviewed(saved,before);await h.settle();
  const current=h.component('source-inbox-panel');assert.equal(current.initialItem.revision,2);current.onAdd(saved);await h.settle();
  const resumed=h.component('intake-queue-panel');assert.equal(resumed.rows[0].sourceCapture.revision,2);assert.equal(resumed.rows[0].profile,row.profile);assert.equal(resumed.rows[0].features,row.features);assert.equal(resumed.rows[0].keywords,row.keywords);assert.equal(resumed.rows[1],other);assert.equal(resumed.sourceItems[0],saved);assert.equal(accepted.length,1);
  assert.ok(h.requests.every(request=>request.method==='GET'));
 }finally{h.close();}
});

test('closed and previous-owner source review callbacks never adopt a new source revision',async()=>{
 for(const mode of ['close','owner']){
  const {before,saved}=reviewSourceFixture('test-owner'),capture={format:'yoofam-saved-page-capture-v1',sourceUrl:before.snapshot.sourceUrl,captureId:before.id,fingerprint:before.fingerprint,revision:1},row={id:'row',url:capture.sourceUrl,sourceCapture:capture,status:'draft'},accepted=[];
  const h=harness({initialIntakeRows:[row],sourceRegistrationsState:{items:[before],reload(){},acceptReviewed(...args){accepted.push(args);return true;}}});try{
   await h.settle();await h.click('＋ 상품 추가');const queue=h.component('intake-queue-panel');queue.onReviewSource(before,row.id);await h.settle();const old=h.component('source-inbox-panel');
   if(mode==='close')old.onAdd(before);else h.switchOwner('next-owner');await h.settle();old.onReviewed(saved,before);await h.settle();
   let current;queue.onRows(rows=>{current=rows;return rows;});assert.equal(current[0],row);assert.equal(accepted.length,0);assert.equal(h.lateWrites,0);
  }finally{h.close();}
 }
});

for(const mode of ['same-owner reopen','owner A/B/A'])for(const staleAction of ['add','modal-close'])test(`${mode}: retained source ${staleAction} callback cannot close a fresh review session`,async()=>{
 const {before,saved}=reviewSourceFixture('test-owner'),capture={format:'yoofam-saved-page-capture-v1',sourceUrl:before.snapshot.sourceUrl,captureId:before.id,fingerprint:before.fingerprint,revision:1};
 const row={id:'retained-review-row',profile:{id:'00000000-0000-4000-8000-000000000764',revision:3,categoryId:'81452',categoryPath:['보존한 카테고리']},url:capture.sourceUrl,features:'직접 쓴 특징',keywords:'직접 키워드',status:'draft',message:'',sourceCapture:capture},accepted=[];
 const sourceState={items:[before],reload(){},acceptReviewed(old,next){accepted.push([old,next]);sourceState.items=[next];return true;}};
 const h=harness({initialIntakeRows:[row],sourceRegistrationsState:sourceState});
 const reviewClose=()=>{
  const dialog=nodes(h.render()).find(node=>node.props?.role==='dialog'&&node.props['aria-label']==='수집 상품정보 확인·수정');
  assert.ok(dialog,'The source review dialog must be visible');
  const close=nodes(dialog).find(node=>node.type==='button'&&node.props.className==='icon-close');assert.ok(close);return close.props.onClick;
 };
 try{
  await h.settle();await h.click('＋ 상품 추가');h.component('intake-queue-panel').onReviewSource(before,row.id);await h.settle();
  const old=h.component('source-inbox-panel'),oldClose=reviewClose();
  if(mode==='same-owner reopen')old.onAdd(before);
  else{h.switchOwner('next-owner');await h.settle();h.switchOwner('test-owner');}
  await h.settle();await h.click('＋ 상품 추가');h.component('intake-queue-panel').onReviewSource(before,row.id);await h.settle();
  const fresh=h.component('source-inbox-panel');assert.ok(fresh);assert.equal(fresh.initialItem,before);
  old.onReviewed(saved,before);if(staleAction==='add')old.onAdd(before);else oldClose();await h.settle();
  assert.equal(accepted.length,0);reviewClose();assert.equal(Boolean(h.component('intake-queue-panel')),false,'A retained close action must leave the new review open');
  h.component('source-inbox-panel').onReviewed(saved,before);await h.settle();assert.equal(accepted.length,1);
  reviewClose()();await h.settle();const resumed=h.component('intake-queue-panel');assert.ok(resumed);assert.equal(resumed.rows[0].sourceCapture.revision,2);assert.equal(resumed.rows[0].features,row.features);assert.equal(resumed.rows[0].keywords,row.keywords);assert.equal(resumed.rows[0].profile,row.profile);assert.equal(h.lateWrites,0);assert.ok(h.requests.every(request=>request.method==='GET'));
 }finally{h.close();}
});

for(const changedSelection of [false,true])test(`repeated source ACKs ${changedSelection?'keep a replaced target pruned':'advance the unchanged explicit row through revisions 1/2/3'}`,async()=>{
 const {before,saved}=reviewSourceFixture('test-owner'),capture={format:'yoofam-saved-page-capture-v1',sourceUrl:before.snapshot.sourceUrl,captureId:before.id,fingerprint:before.fingerprint,revision:1};
 const profile={id:'00000000-0000-4000-8000-000000000764',revision:3,categoryId:'81452',categoryPath:['보존한 카테고리']};
 const row={id:'review-progress-row',profile,url:capture.sourceUrl,features:'직접 쓴 특징',keywords:'직접 키워드',status:'draft',message:'기존 메시지',sourceCapture:capture},other={...row,id:'same-capture-other-row'},accepted=[];
 const sourceState={items:[before],reload(){},acceptReviewed(old,next){accepted.push([old,next]);sourceState.items=[next];return true;}};
 const h=harness({initialIntakeRows:[row,other],sourceRegistrationsState:sourceState});
 try{
  await h.settle();await h.click('＋ 상품 추가');const queue=h.component('intake-queue-panel');queue.onReviewSource(before,row.id);await h.settle();const first=h.component('source-inbox-panel');
  let replaced;
  if(changedSelection){queue.onRows(rows=>rows.map(value=>value.id===row.id?(replaced={...value,sourceCapture:{...value.sourceCapture,revision:2},message:'검토 중 바뀐 선택'}):value));await h.settle();}
  first.onReviewed(saved,before);await h.settle();let current;queue.onRows(rows=>{current=rows;return rows;});
  assert.equal(current[0].sourceCapture.revision,2);assert.equal(current[1],other);if(changedSelection)assert.equal(current[0],replaced,'The first ACK must skip a target whose exact selection changed');
  const next={...saved,revision:3,reviewed:{...saved.reviewed,title:'다시 검토한 상품명'}};h.component('source-inbox-panel').onReviewed(next,saved);await h.settle();queue.onRows(rows=>{current=rows;return rows;});
  assert.equal(accepted.length,2);assert.equal(current[0].sourceCapture.revision,changedSelection?2:3);assert.equal(current[1],other);assert.equal(current[0].profile,profile);assert.equal(current[0].features,row.features);assert.equal(current[0].keywords,row.keywords);if(changedSelection)assert.equal(current[0],replaced,'A skipped target must not be enrolled into later review ACKs');assert.equal(h.lateWrites,0);assert.ok(h.requests.every(request=>request.method==='GET'));
 }finally{h.close();}
});
