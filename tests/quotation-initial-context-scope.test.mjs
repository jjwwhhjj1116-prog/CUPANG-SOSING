import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';

const native=createRequire(import.meta.url);
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const quotationProfileSelect=tree=>{const labels=nodes(tree).filter(node=>node.type==='label'&&nodes(node).some(child=>child.type==='span'&&child.props.children==='카테고리·견적서 연결'));assert.equal(labels.length,1,'the actual quotation workbook selection label must be present exactly once');const select=nodes(labels[0]).find(node=>node.type==='select');assert.ok(select);return select;};
const companies=[{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}];
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};

// Real DetailPanel and QuotationPanel effects drive the actual option-price
// child. Other stage leaves are inert: no browser, source or Hub is contacted.
function scopeUI({product,fetcher,preferredProfileId,panelOnly=false,contextProps={}}){
 const instances=new Map(),cache=new Map(),effects=[],layouts=[],calls=[],notifications=[];let currentInstance,cursor=0,closed=false,lateUpdates=0;
 let rootProps={product,preferredProfileId},tree;
 const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&b.every((value,i)=>Object.is(value,a[i]));
 const schedule=(queue,effect,deps)=>{const i=cursor++,instance=currentInstance,before=instance.slots[i];if(!before||!same(before.deps,deps)){const next={deps,cleanup:before?.cleanup};instance.slots[i]=next;queue.push(()=>{next.cleanup?.();next.cleanup=effect();});}};
 const hooks={useState(initial){const i=cursor++,instance=currentInstance;if(!(i in instance.slots))instance.slots[i]=typeof initial==='function'?initial():initial;return [instance.slots[i],value=>{if(closed){lateUpdates++;return;}instance.slots[i]=typeof value==='function'?value(instance.slots[i]):value;}];},
  useRef(initial){const i=cursor++;return currentInstance.slots[i]??(currentInstance.slots[i]={current:initial});},
  useMemo(factory,deps){const i=cursor++,before=currentInstance.slots[i];if(!before||!same(before.deps,deps))currentInstance.slots[i]={deps,value:factory()};return currentInstance.slots[i].value;},
  useCallback(fn,deps){return hooks.useMemo(()=>fn,deps);},useEffect(fn,deps){schedule(effects,fn,deps);},useLayoutEffect(fn,deps){schedule(layouts,fn,deps);}};
 function PriceStage(props){return {type:load('app/components/option-quotation-prices.tsx').OptionQuotationPrices,props:{productId:props.product.id,version:props.product.updated_at,profileId:props.profileId,refreshToken:props.refreshToken,onSaved:props.onSaved}};}
 function load(file){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  const source=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8')+(file==='app/components/dashboard-client.tsx'?'\nexport {DetailPanel};':'');
  vm.runInNewContext(ts.transpileModule(source,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
   {exports,Error,URL,URLSearchParams,Date,Intl,TextEncoder,TextDecoder,AbortController,structuredClone,crypto:webcrypto,setTimeout,clearTimeout,
    window:{addEventListener(){},removeEventListener(){}},document:{getElementById(){return null;}},
    fetch:async(url,init={})=>{calls.push({url,init});return fetcher(url,init);},require(name){
     if(name==='react')return hooks;if(name==='react/jsx-runtime')return {jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};
     if(name.endsWith('.css'))return {};
     if(name==='@/app/components/product-options-editor')return {ProductOptionsEditor:PriceStage};
     if(name.startsWith('@/app/components/')&&!['@/app/components/quotation-panel','@/app/components/option-quotation-prices'].includes(name))return new Proxy({},{get:(_target,key)=>String(key)});
     return name.startsWith('@/')?load(name.slice(2)+(name.includes('/components/')?'.tsx':'.ts')):native(name);
    }});return exports;
 }
 function resolve(node,path='root',visited=new Set()){
  if(Array.isArray(node))return node.map((child,i)=>resolve(child,path+'/'+i,visited));if(!node||typeof node!=='object')return node;
  if(typeof node.type==='function'){
   const key=path+'/'+node.type.name+':'+(node.key??''),instance=instances.get(key)??{slots:[]};instances.set(key,instance);visited.add(key);
   const before=currentInstance,oldCursor=cursor;currentInstance=instance;cursor=0;const result=resolve(node.type(node.props),key,visited);currentInstance=before;cursor=oldCursor;return result;
  }
  return {...node,props:{...node.props,children:resolve(node.props?.children,path+'/children',visited)}};
 }
 function render(updates={}){
  rootProps={...rootProps,...updates};const visited=new Set(),props=panelOnly?{productId:rootProps.product.id,preferredProfileId:rootProps.preferredProfileId,onManageCategories(){},onProfileChange:id=>notifications.push(id),...contextProps}: {
   workspaceOwnerId:'owner',tab:'가격',product:rootProps.product,settings:{},preferredProfileId:rootProps.preferredProfileId,focusedOptionId:'fixture-option',
   onReceiptSaved(){},onSaved(){},onSavePrice:async()=>{},onBeforeSeoGenerate:()=>false,onBeforeFreeImageApply:()=>false,onPrepareSubmission(){},onProfilePrepared(){},onProfileSelected:id=>notifications.push(id),onReviewPackaging(){},onManageCategories(){},onUpload(){}};
  tree=resolve({type:panelOnly?load('app/components/quotation-panel.tsx').QuotationPanel:load('app/components/dashboard-client.tsx').DetailPanel,key:rootProps.product.id,props},'root',visited);
  for(const [key,instance]of instances)if(!visited.has(key)){instance.slots.forEach(slot=>slot?.cleanup?.());instances.delete(key);}
  layouts.splice(0).forEach(fn=>fn());effects.splice(0).forEach(fn=>fn());return tree;
 }
 const settle=async()=>{for(let i=0;i<16;i++){render();await new Promise(resolve=>setImmediate(resolve));}return render();};
 const field=label=>nodes(render()).find(node=>node.props?.['aria-label']===label),button=label=>nodes(render()).find(node=>node.type==='button'&&node.props.children===label);
 render();return {render,settle,field,button,calls,notifications,get lateUpdates(){return lateUpdates;},close(){for(const instance of instances.values())instance.slots.forEach(slot=>slot?.cleanup?.());instances.clear();closed=true;}};
}

async function draftFixture(company,{manual=false}={}){
 const api=mobileIntakeHarness(company);try{
  const fields=['skuId','categoryId',...api.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field=>field.id)],workbook=quotationWorkbook(fields),sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const storageKey=api.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');api.objects.set(storageKey,workbook);
  const profile=await api.load('db/category-profiles.ts').createCategoryProfile('owner',{...api.context.category,template:{name:'synthetic-717.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  api.context.category=profile;api.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(api.context),'job');await api.intake();
  let product=api.sqlite.prepare('SELECT * FROM products').get();
  const optionModel=api.load('app/product-options.ts'),options=await api.load('db/product-options.ts').readProductOptions('owner',product.id),keys=['id',...Object.keys(optionModel.optionFieldNames)];
  await json(await api.route('/api/products/'+product.id+'/options',{method:'PATCH',body:{expectedRevision:options.revision,expectedProductVersion:product.updated_at,
   rows:options.rows.map((row,index)=>({...Object.fromEntries(keys.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]])),included:index<options.rows.length-1}))}}));
  product=api.sqlite.prepare('SELECT * FROM products').get();if(manual){api.sqlite.prepare('UPDATE products SET source_url=? WHERE id=?').run('synthetic://step717-manual',product.id);product=api.sqlite.prepare('SELECT * FROM products').get();}
  const base='/api/products/'+product.id,initial=await json(await api.route(base+'/quotation-fields')),contextBefore=api.sqlite.prepare('SELECT payload FROM collection_context').get().payload;
  let release;const gate=new Promise(resolve=>{release=resolve;});let catalogReleased=false;
  const fetcher=async(url,init={})=>{if(url==='/api/category-profiles'){await gate;return Response.json({profiles:await api.load('db/category-profiles.ts').listCategoryProfiles('owner')});}return api.route(url,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})});};
  const retained=()=>JSON.stringify(['products','product_content','product_options','product_quotation_fields','collection_context','category_profiles','workspace_settings'].map(table=>[table,api.sqlite.prepare('SELECT * FROM '+table).all()]));
  return {api,product,profile,base,initial,fetcher,retained,contextBefore,release(){catalogReleased=true;release();},get catalogReleased(){return catalogReleased;},close(){api.close();}};
 }catch(error){api.close();throw error;}
}

for(const company of companies)test(`late initial captured-context resolution retains a stage-two draft and its exact save/export scope (${company.companyCode})`,async()=>{
 const f=await draftFixture(company);let ui;try{
  if(company.companyCode==='A01526306'){
   const changed=await f.api.load('db/category-profiles.ts').updateCategoryProfile('owner','cat',f.profile.revision,{...f.profile,name:'현재 저장 양식 개정',template:{...f.profile.template,dataStartRow:9}});assert.equal(changed.revision,f.profile.revision+1);
   const captured=await f.api.load('app/exports/quotation-source.ts').readQuotationExportSource('owner',f.product.id,null),current=await f.api.load('app/exports/quotation-source.ts').readQuotationExportSource('owner',f.product.id,'cat');
   assert.notEqual(captured.template.dataStartRow,current.template.dataStartRow);assert.equal(current.template.dataStartRow,9);
   assert.equal((await json(await f.api.route(f.base+'/quotation-fields'))).inputFingerprint,f.initial.inputFingerprint,'default source stays frozen when the mutable profile is revised');
  }
  const explicit=await json(await f.api.route(f.base+'/quotation-fields?profileId=cat'));
  assert.equal(explicit.productVersion,f.initial.productVersion);assert.equal(explicit.revision,f.initial.revision);
  assert.deepEqual(explicit.resolved,f.initial.resolved);assert.equal(explicit.categoryContext.profileId,f.initial.categoryContext.profileId);
  // Source provenance is still different; do not weaken endpoint/fingerprint
  // guards merely because both views happen to resolve the same values.
  assert.notEqual(explicit.inputFingerprint,f.initial.inputFingerprint);
  const before=f.retained(),network=f.api.network.length,ai=f.api.aiSources.length;
  ui=scopeUI({product:f.product,fetcher:f.fetcher});await ui.settle();
  const row=f.initial.resolved.rows.find(row=>row.optionId!==null&&row.included),label=row.optionLabel+' 판매가';
  ui.field(label).props.onChange({target:{value:'22222'}});assert.equal(ui.field(label).props.value,'22222');
  const reads=ui.calls.filter(call=>call.url.includes('quotation-fields')).length;f.release();await ui.settle();
  assert.equal(ui.field(label).props.value,'22222');assert.ok(nodes(ui.render()).some(node=>node.props?.['data-workspace-dirty']===true));
  assert.equal(ui.calls.filter(call=>call.url.includes('quotation-fields')).length,reads,'initial discovery must not rebase the existing price endpoint');
  const selected=quotationProfileSelect(ui.render());assert.equal(selected.props.value,'cat','the quotation panel still selects its captured workbook locally');assert.equal(selected.props.disabled,true);assert.equal(ui.notifications.at(-1),undefined,'captured default discovery does not change the price endpoint to an explicit profile');
  assert.equal(f.retained(),before);assert.equal(ui.calls.some(call=>call.init.method==='PUT'),false);
  ui.button('옵션 가격 저장').props.onClick();await ui.settle();
  const writes=ui.calls.filter(call=>call.init.method==='PUT');assert.equal(writes.length,1);assert.equal(writes[0].url,f.base+'/quotation-fields');
  const body=JSON.parse(writes[0].init.body);assert.equal(body.expectedInputFingerprint,f.initial.inputFingerprint);assert.equal(body.expectedRevision,f.initial.revision);
  assert.deepEqual(body.changes,[{optionId:row.optionId,fieldKey:'salePrice',value:'22222'}]);
  const current=await json(await f.api.route(f.base+'/quotation-fields'));assert.equal(current.overrides.options[row.optionId].salePrice,'22222');
  assert.ok(current.resolved.rows.some(row=>row.optionId!==null&&!row.included));
  assert.deepEqual(current.resolved.rows.map(row=>[row.optionId,row.included]),f.initial.resolved.rows.map(row=>[row.optionId,row.included]));
  const preview=await json(await f.api.route(f.base+'/quotation',{method:'POST',body:{action:'preview',profileId:'cat'}}));
  assert.deepEqual(preview.report.company,{code:company.companyCode,name:company.companyName});assert.equal(preview.report.categoryId,'80719');
  assert.equal(preview.report.rowCount,5);if(company.companyCode==='A01526306')assert.equal(preview.report.dataStartRow,9,'explicit quotation output retains its existing current-template behavior');
  const exported=await f.api.route(f.base+'/quotation',{method:'POST',body:{action:'download',profileId:'cat',fingerprint:preview.fingerprint}});assert.equal(exported.status,200,await exported.clone().text());
  const archive=await f.api.load('app/xlsx-template.ts').readXlsxArchive(await exported.arrayBuffer());assert.ok(new TextDecoder().decode(archive.get('xl/worksheets/sheet1.xml')).includes('22222'));
  assert.equal(f.api.sqlite.prepare('SELECT payload FROM collection_context').get().payload,f.contextBefore);assert.equal(f.api.network.length,network);assert.equal(f.api.aiSources.length,ai);
 }finally{ui?.close();f.close();}
});

test('an explicit preferred captured profile already owns its endpoint and initial discovery preserves its draft',async()=>{
 const f=await draftFixture(companies[0]);let ui;try{
  ui=scopeUI({product:f.product,fetcher:f.fetcher,preferredProfileId:'cat'});await ui.settle();const row=f.initial.resolved.rows.find(row=>row.optionId),label=row.optionLabel+' 판매가';
  ui.field(label).props.onChange({target:{value:'23333'}});f.release();await ui.settle();assert.equal(ui.field(label).props.value,'23333');
  assert.ok(ui.calls.filter(call=>call.url.includes('quotation-fields')).some(call=>call.url.endsWith('?profileId=cat')));
  assert.equal(ui.calls.some(call=>call.init.method==='PUT'),false);
 }finally{ui?.close();f.close();}
});

test('explicit selection of a genuinely different manual profile still discards the old endpoint draft and cannot cross-save',async()=>{
 const f=await draftFixture(companies[0],{manual:true});let ui;try{
  await f.api.load('db/category-profiles.ts').createCategoryProfile('owner',{...f.profile,name:'다른 수동 양식'},'other');f.release();
  ui=scopeUI({product:f.product,fetcher:f.fetcher});await ui.settle();let select=quotationProfileSelect(ui.render());assert.equal(select.props.value,'');assert.equal(select.props.disabled,false);select.props.onChange({target:{value:'cat'}});await ui.settle();
  const row=f.initial.resolved.rows.find(row=>row.optionId),label=row.optionLabel+' 판매가';ui.field(label).props.onChange({target:{value:'24444'}});assert.equal(ui.field(label).props.value,'24444');
  const staleSave=ui.button('옵션 가격 저장').props.onClick,previous=await json(await f.api.route(f.base+'/quotation-fields?profileId=cat'));
  select=quotationProfileSelect(ui.render());assert.equal(select.props.value,'cat');select.props.onChange({target:{value:'other'}});await ui.settle();
  assert.notEqual(ui.field(label).props.value,'24444');assert.equal(ui.button('옵션 가격 저장').props.disabled,true);assert.ok(ui.calls.some(call=>call.url.endsWith('?profileId=other')));
  const current=await json(await f.api.route(f.base+'/quotation-fields?profileId=other'));assert.notEqual(current.inputFingerprint,previous.inputFingerprint);assert.equal(ui.notifications.at(-1),'other');staleSave();await ui.settle();
  assert.equal(ui.calls.some(call=>call.init.method==='PUT'),false);assert.deepEqual(current.overrides.options,{});assert.deepEqual((await json(await f.api.route(f.base+'/quotation-fields?profileId=cat'))).overrides.options,{});
 }finally{ui?.close();f.close();}
});

for(const mode of ['unknown-default','captured-category-mismatch'])test(`initial profile notification retains existing ${mode} behavior`,async()=>{
 const profile={id:'cat',name:'검토 양식',categoryId:'80719',categoryPath:['주방'],template:{name:'synthetic.xlsx',headerRow:1}},context={source:mode==='unknown-default'?'unknown':'collection',profileId:'cat',categoryId:mode==='unknown-default'?'80719':'77442',categoryPath:['주방']};
 const ui=scopeUI({panelOnly:true,product:{id:'synthetic'},fetcher:async url=>Response.json(url==='/api/category-profiles'?{profiles:[profile]}:{categoryContext:context})});try{
  await ui.settle();assert.equal(ui.notifications.at(-1),mode==='unknown-default'?'cat':undefined);
  assert.equal(quotationProfileSelect(ui.render()).props.value,mode==='unknown-default'?'cat':'');
  if(mode==='captured-category-mismatch')assert.match(JSON.stringify(ui.render()),/원래 분류를 유지/);assert.equal(ui.calls.some(call=>call.init.method==='PUT'),false);
 }finally{ui.close();}
});

test('a late context response from a closed product cannot change a newly opened product or its price draft',async()=>{
 const first=await draftFixture(companies[0]),second=await draftFixture(companies[1]);let oldUI,newUI;try{
  oldUI=scopeUI({product:first.product,fetcher:first.fetcher});await oldUI.settle();oldUI.close();
  newUI=scopeUI({product:second.product,fetcher:second.fetcher});await newUI.settle();const row=second.initial.resolved.rows.find(row=>row.optionId),label=row.optionLabel+' 판매가';newUI.field(label).props.onChange({target:{value:'25555'}});
  first.release();second.release();await newUI.settle();assert.equal(oldUI.lateUpdates,0);assert.equal(newUI.field(label).props.value,'25555');
  assert.ok(newUI.calls.every(call=>!call.url.includes(first.product.id)));assert.equal(newUI.calls.some(call=>call.init.method==='PUT'),false);
 }finally{newUI?.close();if(oldUI&&!oldUI.lateUpdates)oldUI.close();first.close();second.close();}
});
