import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';

const native=createRequire(import.meta.url),companies=[{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}];
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};

/** Synthetic products and an in-memory SQLite/R2 fixture only. The intake
 * helper supplies isolated route dependencies; its collector is never run. */
async function fixture(company){
 const api=mobileIntakeHarness(company),version='2026-10-18T02:00:00.000Z';
 try{
  const fields=['skuId','categoryId',...api.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field=>field.id)];
  const bytes=quotationWorkbook(fields),sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',bytes)).toString('hex');
  const storageKey=api.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');api.objects.set(storageKey,bytes);
  const profile=await api.load('db/category-profiles.ts').createCategoryProfile('owner',{...api.context.category,template:{name:'synthetic-719.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:field==='salePrice'}))},'cat');
  api.context.category=profile;api.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(api.context),'job');
  const product={id:'navigation-'+company.companyCode,owner_id:'owner',title:'격리 가격 상품',source_url:api.sourceUrl,source_price_cny:10,exchange_rate:350,supply_margin:50,coupang_margin:40,supply_price:7000,sale_price:11670,msrp:15170,options_count:3,seo_status:'대기',image_status:'대기',quote_status:'대기',registration_status:'미전송',supplier_hub_status:'미전송',image_keys:'[]',goal_stage:'work',created_at:version,updated_at:version};
  const policy={exchangeRate:350,supplyMargin:50,coupangMargin:40,minimumMargin:3000,msrpMultiple:1.3,roundingUnit:10,roundingMode:'nearest'};
  await api.load('db/queries.ts').insertProduct(product,policy);
  const model=api.load('app/product-options.ts'),rows=['red','blue','excluded'].map((id,index)=>({...model.emptyOptionInput(id),originalName:'원문 '+id,translatedName:'한국어 '+id,supplierSku:'sku-'+id,unitCostCny:10+index,included:id!=='excluded'}));
  assert.ok(await api.load('db/product-options.ts').saveProductOptions('owner',model.applyOptionRows(model.emptyProductOptions(product.id),rows,version),0,version));
  api.sqlite.prepare('INSERT INTO collection_products(job_id,owner_id,product_id,created_at) VALUES(?,?,?,?)').run('job','owner',product.id,version);
  const second={...product,id:product.id+'-second',title:'별도 격리 상품'};await api.load('db/queries.ts').insertProduct(second,policy);
  assert.ok(await api.load('db/product-options.ts').saveProductOptions('owner',model.applyOptionRows(model.emptyProductOptions(second.id),rows,version),0,version));
  api.sqlite.prepare('INSERT INTO collection_jobs SELECT ?,owner_id,offer_id,source_url,goal,status,created_at,updated_at FROM collection_jobs WHERE id=?').run('job-second','job');
  api.sqlite.prepare('INSERT INTO collection_context VALUES(?,?)').run('job-second',JSON.stringify(api.context));
  api.sqlite.prepare('INSERT INTO collection_products(job_id,owner_id,product_id,created_at) VALUES(?,?,?,?)').run('job-second','owner',second.id,version);
  const base='/api/products/'+product.id,initial=await json(await api.route(base+'/quotation-fields'));
  const protectedSnapshot=()=>JSON.stringify(['collection_context','category_profiles','collection_results','workspace_settings'].map(table=>[table,api.sqlite.prepare('SELECT * FROM '+table).all()]));
  return{api,product,second,profile,base,initial,protectedSnapshot,close:()=>api.close()};
 }catch(error){api.close();throw error;}
}

/** Real Dashboard navigation callbacks, DetailPanel, options grid, direct-price
 * editor and QuotationPanel. Other leaves and authentication are fixtures.
 * No real DOM/browser, source service, AI, Hub or operating storage is used. */
function navigationUI(f){
 const instances=new Map(),cache=new Map(),effects=[],layouts=[],calls=[],previews=[],downloads=[],requests=new Set();
 let active,tree,closed=false,late=0,board,optionBoard,discard=false,confirmations=0,hold=null,pausedWrites=0;
 const hooks={
  useState(initial){const instance=active,index=instance.index++;if(!(index in instance.slots))instance.slots[index]=typeof initial==='function'?initial():initial;return[instance.slots[index],value=>{if(!instance.mounted){late++;return;}instance.slots[index]=typeof value==='function'?value(instance.slots[index]):value;}];},
  useRef(initial){const index=active.index++;return active.slots[index]??(active.slots[index]={current:initial});},
  useMemo(fn,deps){const i=active.index++,old=active.slots[i];if(!old||!deps||deps.length!==old.deps?.length||deps.some((value,j)=>!Object.is(value,old.deps[j])))active.slots[i]={value:fn(),deps};return active.slots[i].value;},
  useCallback(fn,deps){return hooks.useMemo(()=>fn,deps);},
  useEffect(fn,deps){schedule(effects,fn,deps);},useLayoutEffect(fn,deps){schedule(layouts,fn,deps);},
  useId(){return 'navigation-'+active.index++;},
 };
 function schedule(queue,fn,deps){const instance=active,i=instance.index++,old=instance.slots[i];if(!old||!deps||deps.length!==old.deps?.length||deps.some((value,j)=>!Object.is(value,old.deps[j]))){const next={deps,cleanup:old?.cleanup};instance.slots[i]=next;queue.push({cleanup:old?.cleanup,commit(){if(instance.mounted)next.cleanup=fn();}});}}
 function request(url,init={}){const task=performRequest(url,init);requests.add(task);task.then(()=>requests.delete(task),()=>requests.delete(task));return task;}
 async function performRequest(url,init={}){
  const parsed=new URL(url,'https://app.test'),method=init.method??'GET';assert.equal(parsed.origin,'https://app.test');
  calls.push({url,method,body:init.body?JSON.parse(init.body):undefined,signal:init.signal});
  if(url==='/api/products')return Response.json({products:f.api.sqlite.prepare('SELECT * FROM products').all()});
  if(url==='/api/settings')return f.api.load('app/api/settings/route.ts').GET();
  if(url==='/api/collection-jobs')return Response.json({jobs:[]});
  if(url==='/api/category-profiles')return Response.json({profiles:await f.api.load('db/category-profiles.ts').listCategoryProfiles('owner'),nextCursor:null});
  if(/^\/api\/products\/[^/]+$/.test(parsed.pathname))return f.api.load('app/api/products/[id]/route.ts').GET(new Request(parsed.href),{params:Promise.resolve({id:parsed.pathname.split('/')[3]})});
  assert.ok(/^\/api\/products\/[^/]+\/(options|quotation-fields|quotation|pricing)$/.test(parsed.pathname),'Unexpected request '+url);
  if(hold&&method==='PUT'){const current=hold;hold=null;pausedWrites++;current.arrived.resolve();await current.release.promise;pausedWrites--;}
  const response=await f.api.route(url,{method,...(init.body?{body:JSON.parse(init.body)}:{})});
  if(parsed.pathname.endsWith('/quotation')){assert.equal(response.status,200,await response.clone().text());const action=JSON.parse(init.body).action;if(action==='preview')previews.push(await response.clone().json());else downloads.push(new Uint8Array(await response.clone().arrayBuffer()));}
  return response;
 }
 const implemented=new Set(['dashboard-client','price-editor','product-options-editor','option-price-table','option-quotation-prices','price-selection-dialog','quotation-panel']);
 function load(file){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
   {exports,Error,URL,URLSearchParams,Date,Intl,TextEncoder,TextDecoder,AbortController,structuredClone,crypto:webcrypto,Response,Blob,queueMicrotask,setTimeout:fn=>{fn();return 0;},clearTimeout(){},
    window:{addEventListener(){},removeEventListener(){},confirm(){confirmations++;return discard;},setTimeout:fn=>{fn();return 0;}},
    document:{activeElement:null,getElementById(){return null;},createElement(){return{click(){},set href(value){},set download(value){}};}},fetch:request,
    require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};if(name.endsWith('.css'))return{};
     if(name==='@/app/components/use-intake-draft')return{useIntakeDraft:()=>({rows:[],setRows(){},goal:'work',setGoal(){},ready:true,loading:false})};
     if(name==='@/app/components/registration-board')return{...load('app/components/registration-board.tsx'),RegistrationBoard:props=>{board=props;return null;}};
     if(name==='@/app/components/product-option-board')return{ProductOptionBoard:props=>{optionBoard=props;return null;}};
     if(name.startsWith('@/app/components/')&&!implemented.has(name.split('/').at(-1)))return new Proxy({},{get:()=>()=>null});
     return name.startsWith('@/')?load(name.slice(2)+(name.includes('/components/')?'.tsx':'.ts')):native(name);
    }});return exports;
 }
 const match=(node,selector)=>{const parts=/^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);return parts&&node.props&&Object.hasOwn(node.props,parts[1])&&(parts[2]===undefined||String(node.props[parts[1]])===parts[2]);};
 const dom=node=>({getAttribute:name=>node.props?.[name]===undefined?null:String(node.props[name]),querySelector:selector=>nodes(node.props?.children).filter(child=>match(child,selector)).map(dom)[0]??null,querySelectorAll:selector=>nodes(node.props?.children).filter(child=>match(child,selector)).map(dom),scrollTo(){},scrollIntoView(){},focus(){}});
 function expand(value,path,seen){
  if(Array.isArray(value))return value.map((child,index)=>expand(child,path+'/'+(child?.key??index),seen));if(!value||typeof value!=='object')return value;
  if(typeof value.type==='function'){const key=path+'/'+value.type.name+':'+(value.key??''),instance=instances.get(key)??{slots:[],mounted:true};instances.set(key,instance);seen.add(key);instance.index=0;active=instance;return expand(value.type(value.props),key,seen);}
  const next={...value,props:{...value.props,children:expand(value.props?.children,path+'/children',seen)}};if(next.props.ref&&typeof next.props.ref==='object')next.props.ref.current=dom(next);return next;
 }
 const Dashboard=load('app/components/dashboard-client.tsx').default;
 function render(){if(closed)return tree;const seen=new Set();tree=expand({type:Dashboard,props:{userName:'격리 검토자',workspaceOwnerId:'owner'}},'root',seen);
  for(const[key,instance]of instances)if(!seen.has(key)){instance.mounted=false;instance.slots.forEach(slot=>slot?.cleanup?.());instances.delete(key);}
  const commits=layouts.splice(0);commits.forEach(item=>item.cleanup?.());commits.reverse().forEach(item=>item.commit());effects.splice(0).forEach(item=>{item.cleanup?.();item.commit();});return tree;}
 const settle=async()=>{for(let i=0;i<14;i++){render();await new Promise(resolve=>setImmediate(resolve));if(!pausedWrites)await Promise.allSettled([...requests]);}return render();};
 const node=label=>{const found=nodes(render()).find(item=>item.props?.['aria-label']===label);assert.ok(found,'Missing '+label);return found;};
 const button=label=>{const found=nodes(render()).find(item=>item.type==='button'&&text(item)===label);assert.ok(found,'Missing button '+label);return found;};
 return{render,settle,node,button,calls,previews,downloads,load,
  async open(id=f.product.id,optionId='red'){await settle();const product=board.products.find(item=>item.id===id);assert.ok(product);board.onOptions(product);await settle();optionBoard.onStage(optionId,'가격');await settle();},
  async click(label){const target=button(label);assert.equal(Boolean(target.props.disabled),false,'Disabled '+label);target.props.onClick();await settle();},
  state(){return load('app/workspace-close.ts').workspaceEditState(dom(node('상품 등록 작업 공간')));},
  pending(){return load('app/workspace-close.ts').quotationSourceState(dom(node('상품 등록 작업 공간')));},
  get step(){return text(nodes(render()).find(item=>item.props?.['aria-current']==='step'));},
  get confirmations(){return confirmations;},get late(){return late;},
  discard(value){discard=value;},holdWrite(){const task={arrived:deferred(),release:deferred()};hold=task;return{arrived:task.arrived.promise,release:()=>task.release.resolve()};},
  closeWorkspace(){node('상품 작업 공간 닫기').props.onClick();},
  unmount(){for(const instance of instances.values()){instance.mounted=false;instance.slots.forEach(slot=>slot?.cleanup?.());}instances.clear();closed=true;},
 };
}

for(const company of companies)test(`direct price drafts block quotation navigation until explicit save and reach XLSX afterward (${company.companyCode})`,async()=>{
 const f=await fixture(company),ui=navigationUI(f);try{
  const protectedBefore=f.protectedSnapshot();await ui.open();
  assert.equal(ui.node('가격 옵션 1 판매가').props.value,f.initial.resolved.rows.find(row=>row.optionId==='red').fields.salePrice.value);
  ui.node('가격 옵션 1 판매가').props.onChange({target:{value:'22222'}});await ui.settle();
  assert.equal(ui.node('가격 옵션 1 판매가').props.value,'22222');assert.equal(ui.state().dirty,true);assert.equal(ui.state().busy,false);
  await ui.click('3대표 이미지');await ui.click('7견적서 작업');
  if(ui.step==='7견적서 작업'){
   await ui.click('견적 자료 검토');const preview=ui.previews.at(-1),column=f.profile.mappings.find(item=>item.field==='salePrice').column;assert.ok(preview,text(ui.render()));
   console.log(JSON.stringify({reproduction:'step719-missing-price-source-step',company:company.companyCode,draft:ui.node('가격 옵션 1 판매가').props.value,step:ui.step,sourceSteps:Array.from(ui.pending().steps),puts:ui.calls.filter(call=>call.method==='PUT').length,previewSalePrice:preview.rows[0][column]}));
  }
  assert.equal(ui.step,'2가격 설정','direct quotation-price edits must return to their saving stage');
  assert.deepEqual(Array.from(ui.pending().steps),['가격']);assert.equal(ui.calls.filter(call=>call.method==='PUT').length,0);
  assert.equal(ui.previews.length,0);assert.equal(ui.node('가격 옵션 1 판매가').props.value,'22222');
  await ui.click('옵션 저장·가격 계산');assert.equal(ui.state().dirty,false);assert.equal(ui.state().busy,false);
  const writes=ui.calls.filter(call=>call.method==='PUT');assert.equal(writes.length,1);assert.equal(writes[0].url,f.base+'/quotation-fields');assert.equal(writes[0].body.expectedInputFingerprint,f.initial.inputFingerprint);
  const saved=await json(await f.api.route(f.base+'/quotation-fields'));assert.equal(saved.overrides.options.red.salePrice,'22222');assert.equal(saved.resolved.rows.find(row=>row.optionId==='red').fields.salePrice.source,'manual-option');
  await ui.click('7견적서 작업');assert.equal(ui.step,'7견적서 작업');await ui.click('견적 자료 검토');await ui.click('채운 견적서 파일 다운로드');
  const preview=ui.previews.at(-1),column=f.profile.mappings.find(item=>item.field==='salePrice').column;assert.equal(Number(preview.rows[0][column]),22222);assert.equal(preview.rows.length,2);assert.equal(preview.report.submissionReady,false);
  const reader=f.api.load('app/xlsx-template.ts'),bytes=ui.downloads.at(-1),book=reader.inspectXlsxArchive(await reader.readXlsxArchive(bytes.buffer));assert.equal(reader.xlsxHeaders(book,'견적서',2)[column],'22222');
  assert.equal(f.protectedSnapshot(),protectedBefore);assert.equal(f.api.network.length,0);assert.equal(f.api.aiSources.length,0);
 }finally{ui.unmount();f.close();}
});

test('manual blank, cancellation and close rejection keep direct-price scope and do not write',async()=>{
 const f=await fixture(companies[0]),ui=navigationUI(f);try{
  await ui.open(undefined,'blue');ui.node('가격 옵션 2 판매가').props.onChange({target:{value:''}});await ui.settle();
  await ui.click('7견적서 작업');assert.equal(ui.step,'2가격 설정');assert.equal(ui.node('가격 옵션 2 판매가').props.value,'');assert.equal(ui.calls.filter(call=>call.method==='PUT').length,0);
  ui.closeWorkspace();await ui.settle();assert.equal(ui.confirmations,1);assert.ok(ui.node('상품 등록 작업 공간'));assert.equal(ui.node('가격 옵션 2 판매가').props.value,'');
  await ui.click('입력 취소·저장 가격 다시 조회');assert.equal(ui.state().dirty,false);assert.equal(ui.calls.filter(call=>call.method==='PUT').length,0);
  await ui.click('7견적서 작업');assert.equal(ui.step,'7견적서 작업');assert.equal(ui.node('가격 옵션 2 판매가').props.value,f.initial.resolved.rows.find(row=>row.optionId==='blue').fields.salePrice.value);
 }finally{ui.unmount();f.close();}
});

test('pending direct-price save blocks quotation entry and close until acknowledged',async()=>{
 const f=await fixture(companies[0]),ui=navigationUI(f);try{
  await ui.open();ui.node('가격 옵션 1 판매가').props.onChange({target:{value:'23333'}});await ui.settle();const gate=ui.holdWrite();ui.button('옵션 저장·가격 계산').props.onClick();await gate.arrived;await ui.settle();
  assert.equal(ui.state().busy,true);await ui.click('7견적서 작업');assert.equal(ui.step,'2가격 설정');ui.closeWorkspace();await ui.settle();assert.equal(ui.confirmations,0);assert.ok(ui.node('상품 등록 작업 공간'));assert.equal(ui.previews.length,0);
  gate.release();await ui.settle();assert.equal(ui.state().busy,false);assert.equal(ui.state().dirty,false);await ui.click('7견적서 작업');assert.equal(ui.step,'7견적서 작업');
 }finally{ui.unmount();f.close();}
});

test('changing the selected row and visiting other stages retain the original option price draft',async()=>{
 const f=await fixture(companies[0]),ui=navigationUI(f);try{
  await ui.open();ui.node('가격 옵션 1 판매가').props.onChange({target:{value:'24444'}});await ui.settle();
  ui.node('가격 옵션 1 선택').props.onChange({target:{checked:false}});ui.node('가격 옵션 2 선택').props.onChange({target:{checked:true}});await ui.settle();
  assert.equal(ui.node('가격 옵션 2 선택').props.checked,true);assert.equal(ui.node('가격 옵션 1 판매가').props.value,'24444');
  assert.equal(ui.node('가격 옵션 2 판매가').props.value,f.initial.resolved.rows.find(row=>row.optionId==='blue').fields.salePrice.value);
  await ui.click('1SEO 설정');await ui.click('6한글 표시사항');await ui.click('7견적서 작업');assert.equal(ui.step,'2가격 설정');
  assert.equal(ui.node('가격 옵션 1 판매가').props.value,'24444');assert.equal(ui.calls.filter(call=>call.method==='PUT').length,0);
  await ui.click('입력 취소·저장 가격 다시 조회');assert.equal(ui.state().dirty,false);await ui.click('7견적서 작업');assert.equal(ui.step,'7견적서 작업');
 }finally{ui.unmount();f.close();}
});

test('discarded product drafts and stale handlers cannot write into a new product or an unmounted workspace',async()=>{
 const f=await fixture(companies[0]),ui=navigationUI(f);try{
  await ui.open();ui.node('가격 옵션 1 판매가').props.onChange({target:{value:'25555'}});await ui.settle();
  const oldChange=ui.node('가격 옵션 1 판매가').props.onChange,oldSave=ui.button('옵션 저장·가격 계산').props.onClick;
  ui.discard(true);await ui.open(f.second.id,'blue');assert.equal(ui.confirmations,1);
  assert.equal(ui.state().dirty,false);assert.notEqual(ui.node('가격 옵션 1 판매가').props.value,'25555');
  oldChange({target:{value:'26666'}});oldSave();await ui.settle();assert.equal(ui.state().dirty,false);assert.equal(ui.calls.filter(call=>call.method==='PUT').length,0);
  const currentChange=ui.node('가격 옵션 2 판매가').props.onChange,currentSave=ui.button('옵션 저장·가격 계산').props.onClick,lateBefore=ui.late;
  ui.unmount();currentChange({target:{value:'27777'}});currentSave();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ui.calls.filter(call=>call.method==='PUT').length,0);assert.equal(ui.late,lateBefore);
  for(const id of[f.product.id,f.second.id]){const view=await json(await f.api.route('/api/products/'+id+'/quotation-fields'));assert.equal(Object.keys(view.overrides.options).length,0);}
  assert.equal(f.api.network.length,0);assert.equal(f.api.aiSources.length,0);
 }finally{ui.unmount();f.close();}
});
