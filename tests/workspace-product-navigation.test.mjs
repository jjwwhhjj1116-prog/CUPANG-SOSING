import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};

/** Real dashboard, archive, registration board and content editor. HTTP is held
 * at the response boundary; no browser, remote product or storage is used. */
function harness({submission=false,batch}={}){
 const instances=new Map(),cache=new Map(),effects=[],requests=[],archiveReads=[],settingsReads=[],settingsWrites=[],bannerUploads=[],productReads=[];let active,tree,closed=false,lateDashboardWrites=0,storedSettings=null,holdSettings=false,holdSettingsWrite=false,holdProductRead=false,intakeSettings;
 const now='2026-10-05T00:00:00.000Z';
 const product=id=>({id,title:'상품 '+id,source_url:'https://detail.1688.com/offer/'+(id==='a'?'813724060928':'813724060929')+'.html',created_at:now,updated_at:now,image_keys:'[]',options_count:0,source_price_cny:1,exchange_rate:200,supply_margin:50,coupang_margin:40,supply_price:400,sale_price:700,msrp:1000,seo_status:'대기',image_status:'대기',quote_status:'대기',registration_status:'검토 대기',supplier_hub_status:'미전송',goal_stage:'work'});
 const products=[batch?.product??product('b')];
 const profiles=['a','b'].map(id=>({id:'profile-'+id,name:'양식 '+id,revision:1,categoryId:'80719',categoryPath:['바스켓'],mappings:[],template:{name:id+'.xlsx',format:'xlsx',headerRow:1,headers:['상품명'],sheetName:'견적서'}}));
 let quotationEditor;
 const hooks={
  useState(initial){const instance=active,index=instance.index++;if(!(index in instance.slots))instance.slots[index]=typeof initial==='function'?initial():initial;return[instance.slots[index],value=>{if(!instance.mounted){if(instance.name==='DashboardClient')lateDashboardWrites++;return;}instance.slots[index]=typeof value==='function'?value(instance.slots[index]):value;}];},
  useRef(initial){const index=active.index++;return active.slots[index]??(active.slots[index]={current:initial});},
  useMemo(fn){return fn();},
  useCallback(fn,deps){const index=active.index++,old=active.slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))active.slots[index]={fn,deps};return active.slots[index].fn;},
  useEffect(fn,deps){const instance=active,index=instance.index++,old=instance.slots[index];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps[i]))){const next={deps,cleanup:old?.cleanup};instance.slots[index]=next;effects.push(()=>{next.cleanup?.();next.cleanup=fn();});}},
  useId(){const index=active.index++;return 'test-'+index;},
 };
 const implemented=new Set(['dashboard-client','product-archive','registration-board','product-content-editor','workspace-settings-dialog','workspace-settings-editor','settings-price-preview']);
 if(batch){implemented.add('batch-work-panel');implemented.add('image-generation-panel');}
 if(submission){implemented.add('quotation-panel');implemented.add('submission-review-panel');}
 async function request(url,init){
  requests.push({url,method:init?.method??'GET',body:init?.body});
  if(batch&&url.startsWith('/api/products/'+batch.product.id)){
   if(url==='/api/products/'+batch.product.id&&holdProductRead){holdProductRead=false;const pending=deferred();productReads.push({...pending,signal:init?.signal});return pending.promise;}
   return batch.request(url,init);
  }
  if(url==='/api/products')return Response.json({products});
  if(url==='/api/settings'){
   if(init?.method==='PUT'){
    if(holdSettingsWrite){holdSettingsWrite=false;const pending=deferred();settingsWrites.push(pending);return pending.promise;}
    storedSettings=JSON.parse(init.body);
   }
   else if(holdSettings){holdSettings=false;const pending=deferred();settingsReads.push({...pending,signal:init?.signal});return pending.promise;}
   return Response.json({settings:storedSettings});
  }
  if(url==='/api/files'&&init?.method==='POST'){const pending=deferred();bannerUploads.push(pending);return pending.promise;}
  if(url==='/api/collection-jobs')return Response.json({jobs:[]});
  if(url==='/api/category-profiles')return Response.json({profiles:submission?profiles:[],nextCursor:null});
  if(submission&&/^\/api\/products\/[ab]\/quotation-fields$/.test(url)){const id=url.split('/')[3];return Response.json({categoryContext:{source:'collection',profileId:'profile-'+id,categoryId:'80719',categoryPath:['바스켓']}});}
  if(submission&&/^\/api\/products\/[ab]\/submission-review/.test(url)){const parsed=new URL(url,'https://app.test'),id=parsed.pathname.split('/')[3];return Response.json({productId:id,requestedProfileId:parsed.searchParams.get('profileId'),title:'상품 '+id,sourceUrl:product(id).source_url,categoryId:'80719',categoryPath:['바스켓'],checkedAt:now,fingerprint:'a'.repeat(64),submissionReady:false,transport:'not-connected',includedOptions:1,errorCount:0,reviewCount:0,omittedIssueCount:0,issues:[],limits:[]});}
  if(url.startsWith('/api/product-archive?'))return Response.json({items:[{id:'a',sourceKind:'product',title:'상품 a',sourceUrl:product('a').source_url,offerId:'813724060928',createdAt:now,updatedAt:now,status:'검토 대기',supplierHubStatus:'미전송',category:null}],nextCursor:null,range:'7days',from:'2026-09-29',to:'2026-10-05',query:'',timeZone:'Asia/Seoul',limit:50});
  if(url==='/api/products/a'){const pending=deferred();archiveReads.push(pending);return pending.promise;}
  if(/^\/api\/products\/[ab]\/content$/.test(url)){
   const content=load('app/product-content.ts').emptyProductContent(url.split('/')[3]);content.seo.title.value='저장 상품명';return Response.json({content});
  }
  throw Error('Unexpected request '+url);
 }
 function load(file){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
   {exports,Error,AbortController,FormData,URL,URLSearchParams,Date,Intl,TextEncoder,TextDecoder,structuredClone,crypto,queueMicrotask,fetch:request,window:{addEventListener(){},removeEventListener(){},confirm(){throw Error('Unexpected discard prompt');},setTimeout},require(name){
    if(name==='react')return hooks;
    if(name==='react/jsx-runtime')return{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};
    if(name.endsWith('.css'))return{};
    if(name==='@/app/components/use-intake-draft')return{useIntakeDraft:()=>({rows:[],setRows(){},goal:'work',setGoal(){},ready:true,loading:false})};
    if(name==='@/app/components/intake-queue-panel')return{IntakeQueuePanel:props=>{intakeSettings=props.settings;return null;}};
    if(submission&&name==='@/app/components/quotation-fields-editor')return{QuotationFieldsEditor:props=>{quotationEditor=props;return null;}};
    if(name.startsWith('@/app/components/')&&!implemented.has(name.split('/').at(-1)))return new Proxy({},{get:()=>()=>null});
    if(name.startsWith('@/'))return load(name.slice(2)+(name.includes('/components/')?'.tsx':'.ts'));
    return native(name);
   }});return exports;
 }
 const Dashboard=load('app/components/dashboard-client.tsx').default;
 function expand(value,path,seen){
  if(Array.isArray(value))return value.map((child,index)=>expand(child,path+'/'+(child?.key??index),seen));
  if(!value||typeof value!=='object')return value;
  if(typeof value.type==='function'){
   const key=path+'/'+value.type.name+':'+(value.key??'');let instance=instances.get(key);
   if(!instance){instance={name:value.type.name,slots:[],mounted:true};instances.set(key,instance);}seen.add(key);instance.index=0;active=instance;
   return expand(value.type(value.props),key,seen);
  }
  const next={...value,props:{...value.props,children:expand(value.props?.children,path+'/children',seen)}};
  if(next.props.ref&&typeof next.props.ref==='object'){
   const match=(node,selector)=>{const parts=/^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);return parts&&node.props&&Object.hasOwn(node.props,parts[1])&&(parts[2]===undefined||String(node.props[parts[1]])===parts[2]);};
   const dom=node=>({getAttribute:name=>node.props?.[name],querySelector:selector=>nodes(node.props?.children).filter(child=>match(child,selector)).map(dom)[0]??null});
   next.props.ref.current={querySelector:selector=>nodes(next).filter(node=>match(node,selector)).map(dom)[0]??null,querySelectorAll:selector=>nodes(next).filter(node=>match(node,selector)).map(dom),scrollTo(){}};
  }
  return next;
 }
 function render(){
  if(closed)return tree;const seen=new Set();tree=expand({type:Dashboard,props:{userName:'검토자'}},'root',seen);
  for(const [key,instance]of instances)if(!seen.has(key)){instance.mounted=false;instance.slots.forEach(slot=>slot?.cleanup?.());instances.delete(key);}
  effects.splice(0).forEach(effect=>effect());return tree;
 }
 const settle=async()=>{for(let i=0;i<12;i++){render();await new Promise(resolve=>setImmediate(resolve));}};
 const button=label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label);
 return{requests,archiveReads,settingsReads,settingsWrites,bannerUploads,productReads,product,render,settle,button,get lateDashboardWrites(){return lateDashboardWrites;},get intakeSettings(){return intakeSettings;},get quotationEditor(){return quotationEditor;},
  setStoredSettings(value){storedSettings=value;},deferSettings(){holdSettings=true;},deferSettingsWrite(){holdSettingsWrite=true;},
  deferProduct(){holdProductRead=true;},
  settingsPanel:()=>nodes(render()).find(node=>node.props?.id==='workspace-settings-panel'),
  settingsForm:()=>nodes(render()).find(node=>node.type==='form'&&node.props.className==='settings-form couplus-settings'),
  title:()=>nodes(render()).find(node=>node.type==='input'&&node.props.maxLength===500),
  workspace:()=>nodes(render()).find(node=>node.props?.['aria-label']==='상품 등록 작업 공간'),
  async click(label){const target=button(label);assert.ok(target&&!target.props.disabled,'available button: '+label);target.props.onClick();await settle();},
  close(){closed=true;for(const instance of instances.values()){instance.mounted=false;instance.slots.forEach(slot=>slot?.cleanup?.());}},
 };
}

test('reviewed archive product enters transmission preparation with its own profile without replacing board selection',async()=>{
 const h=harness({submission:true});try{
  await h.settle();nodes(h.render()).find(node=>node.props?.['aria-label']==='상품 b 선택').props.onChange({target:{checked:true}});
  await h.click('▦상품 관리');await h.click('상품 작업 열기 →');h.archiveReads[0].resolve(Response.json({product:h.product('a')}));await h.settle();
  const step=nodes(h.render()).find(node=>node.type==='button'&&text(node)==='7견적서');assert.ok(step);step.props.onClick();await h.settle();
  await h.click('저장한 견적 전송 준비');
  assert.equal(h.workspace(),undefined);assert.match(text(h.render()),/선택한 상품 1건/);
  let reads=h.requests.filter(request=>request.url.includes('/submission-review'));assert.equal(reads.length,1);assert.equal(reads[0].url,'/api/products/a/submission-review?profileId=profile-a');
  await h.click('견적서 수정하기');assert.match(text(h.workspace()),/상품 a/);assert.equal(h.quotationEditor.profileId,'profile-a');
  await h.click('저장한 견적 전송 준비');reads=h.requests.filter(request=>request.url.includes('/submission-review'));assert.equal(reads.length,2);assert.equal(reads[1].url,reads[0].url);
  await h.click('×');await h.click('✦AI 상품등록');
  assert.equal(nodes(h.render()).find(node=>node.props?.['aria-label']==='상품 b 선택').props.checked,true);
  await h.click('등록 전송');reads=h.requests.filter(request=>request.url.includes('/submission-review'));assert.equal(reads.at(-1).url,'/api/products/b/submission-review');
  assert.ok(h.requests.every(request=>request.method==='GET'),'preparation navigation never writes, exports or sends files');
 }finally{h.close();}
});

test('transmission preparation preserves unsaved quotation and retained source input',async()=>{
 const h=harness({submission:true});try{
  await h.settle();await h.click('상품 b');
  const step=nodes(h.render()).find(node=>node.type==='button'&&text(node)==='7견적서');step.props.onClick();await h.settle();
  h.quotationEditor.onDirtyChange(true);await h.settle();assert.equal(h.button('저장한 견적 전송 준비').props.disabled,true);
  h.quotationEditor.onDirtyChange(false);await h.settle();h.title().props.onChange({target:{value:'보존할 미저장 상품명'}});await h.settle();
  await h.click('저장한 견적 전송 준비');assert.ok(h.workspace());assert.equal(h.title().props.value,'보존할 미저장 상품명');
  assert.equal(h.requests.some(request=>request.url.includes('/submission-review')),false);assert.ok(h.requests.every(request=>request.method==='GET'));
 }finally{h.close();}
});

test('late archive open cannot replace a newer product workspace or its unsaved SEO value',async()=>{
 for(const value of ['직접 수정한 상품명','']){const h=harness();try{
  await h.settle();await h.click('▦상품 관리');await h.click('상품 작업 열기 →');assert.equal(h.archiveReads.length,1);
  await h.click('✦AI 상품등록');await h.click('상품 b');
  h.title().props.onChange({target:{value}});await h.settle();assert.equal(h.title().props.value,value);
  h.archiveReads[0].resolve(Response.json({product:h.product('a')}));await h.settle();
  assert.match(text(h.workspace()),/상품 b/);assert.equal(h.title().props.value,value);
  assert.equal(h.requests.some(request=>request.method!=='GET'),false);
 }finally{h.close();}}
});

test('archive open ignores completion after dashboard unmount',async()=>{
 const h=harness();await h.settle();await h.click('▦상품 관리');await h.click('상품 작업 열기 →');h.close();
 h.archiveReads[0].resolve(Response.json({product:h.product('a')}));await h.settle();assert.equal(h.lateDashboardWrites,0);
});

test('inline settings toggle and cancel reread saved settings while only explicit save updates future intake defaults',async()=>{
 const h=harness();try{
  h.setStoredSettings({brand:'처음 저장한 브랜드',exchangeRate:270});await h.settle();
  const input=label=>nodes(nodes(h.settingsForm()).find(node=>node.type==='label'&&nodes(node).some(child=>child.type==='span'&&child.props.children===label))).find(node=>node.type==='input');
  assert.equal(h.button('⚙ 기본설정').props['aria-expanded'],false);
  await h.click('⚙ 기본설정');assert.equal(h.button('⚙ 기본설정').props['aria-expanded'],true);
  assert.equal(h.button('⚙ 기본설정').props['aria-controls'],h.settingsPanel().props.id);
  assert.match(text(h.settingsPanel()),/기본 등록 정보 설정/);assert.ok(h.button('상품 b'));
  assert.ok(nodes(h.render()).some(node=>node.props?.['aria-label']==='수집 대기열'));
  assert.equal(nodes(h.render()).some(node=>node.props?.role==='dialog'),false);
  assert.equal(input('브랜드명').props.value,'처음 저장한 브랜드');input('브랜드명').props.onChange({target:{value:'취소할 값'}});
  await h.click('취소');assert.equal(h.settingsPanel(),undefined);assert.equal(h.requests.some(request=>request.method==='PUT'),false);
  h.setStoredSettings({brand:'다른 화면에서 저장한 브랜드',exchangeRate:330});
  await h.click('⚙ 기본설정');assert.equal(input('브랜드명').props.value,'다른 화면에서 저장한 브랜드');
  input('브랜드명').props.onChange({target:{value:'접으며 버릴 값'}});await h.click('⚙ 기본설정');assert.equal(h.settingsPanel(),undefined);
  await h.click('⚙ 기본설정');assert.equal(input('브랜드명').props.value,'다른 화면에서 저장한 브랜드');
  input('브랜드명').props.onChange({target:{value:''}});input('적용환율 (CNY → KRW)').props.onChange({target:{value:'350'}});
  await h.settingsForm().props.onSubmit({preventDefault(){}});await h.settle();assert.equal(h.settingsPanel(),undefined);
  const writes=h.requests.filter(request=>request.method!=='GET');assert.equal(writes.length,1);assert.equal(writes[0].url,'/api/settings');assert.equal(writes[0].method,'PUT');
  assert.equal(JSON.parse(writes[0].body).brand,'');assert.equal(JSON.parse(writes[0].body).exchangeRate,350);
  await h.click('＋ 상품 추가');assert.equal(h.intakeSettings.brand,'');assert.equal(h.intakeSettings.exchangeRate,350);
  assert.equal(h.requests.filter(request=>request.url==='/api/settings'&&request.method==='GET').length,4);
 }finally{h.close();}
});

test('pending settings save blocks a captured close handler before rerender and preserves failed input for retry',async()=>{
 const h=harness();try{
  h.setStoredSettings({brand:'저장 전'});await h.settle();await h.click('⚙ 기본설정');
  const brand=()=>nodes(h.settingsForm()).find(node=>node.type==='input'&&node.props.value==='유지할 저장값');
  nodes(h.settingsForm()).find(node=>node.type==='input'&&node.props.value==='저장 전').props.onChange({target:{value:'유지할 저장값'}});
  const toggle=h.button('⚙ 기본설정'),cancel=h.button('취소'),form=h.settingsForm();h.deferSettingsWrite();
  const saving=form.props.onSubmit({preventDefault(){}});toggle.props.onClick();cancel.props.onClick();
  assert.ok(h.settingsPanel(),'pending save cannot unmount the original settings form');
  assert.equal(h.button('⚙ 기본설정').props.disabled,true);assert.ok(brand());
  await form.props.onSubmit({preventDefault(){}});assert.equal(h.settingsWrites.length,1);
  h.settingsWrites[0].resolve(Response.json({error:'일시적인 저장 실패'},{status:503}));await saving;await h.settle();
  assert.ok(brand());assert.match(text(h.settingsForm()),/일시적인 저장 실패/);assert.equal(h.button('⚙ 기본설정').props.disabled,false);
  await h.settingsForm().props.onSubmit({preventDefault(){}});await h.settle();
  assert.equal(h.settingsPanel(),undefined);await h.click('⚙ 기본설정');assert.ok(brand());
  assert.equal(h.requests.filter(request=>request.url==='/api/settings'&&request.method==='PUT').length,2);
 }finally{h.close();}
});

test('pending banner upload blocks inline collapse and keeps the selected image until explicit settings save',async()=>{
 const h=harness();try{
  h.setStoredSettings({brand:'업로드할 브랜드',topImageEnabled:true});await h.settle();await h.click('⚙ 기본설정');
  const toggle=h.button('⚙ 기본설정'),cancel=h.button('취소');
  const upload=nodes(h.settingsForm()).find(node=>node.props?.['aria-label']==='공통 상단 이미지 업로드');
  upload.props.onChange({target:{files:[new File(['image'],'banner.png',{type:'image/png'})],value:'banner.png'}});
  toggle.props.onClick();cancel.props.onClick();
  assert.ok(h.settingsPanel(),'pending upload cannot unmount the original settings form');
  assert.equal(h.button('⚙ 기본설정').props.disabled,true);assert.equal(h.bannerUploads.length,1);
  h.bannerUploads[0].resolve(Response.json({key:'owner/banner.png'}));await h.settle();
  assert.equal(h.button('⚙ 기본설정').props.disabled,false);
  assert.ok(nodes(h.settingsForm()).some(node=>node.type==='img'&&node.props.src==='/api/files/owner/banner.png'));
  assert.equal(h.requests.some(request=>request.method==='PUT'),false);
  await h.settingsForm().props.onSubmit({preventDefault(){}});await h.settle();assert.equal(h.settingsPanel(),undefined);
  const saved=JSON.parse(h.requests.find(request=>request.method==='PUT').body);assert.equal(saved.topImageKey,'owner/banner.png');assert.equal(saved.topImageEnabled,true);
 }finally{h.close();}
});

test('collapsing an inline settings read aborts it and reopening ignores the old response',async()=>{
 const h=harness();try{
  await h.settle();h.deferSettings();await h.click('⚙ 기본설정');assert.equal(h.settingsForm(),undefined);
  await h.click('⚙ 기본설정');assert.equal(h.settingsReads[0].signal.aborted,true);assert.equal(h.settingsPanel(),undefined);
  h.setStoredSettings({brand:'다시 연 저장값'});await h.click('⚙ 기본설정');
  h.settingsReads[0].resolve(Response.json({settings:{brand:'지연된 이전 값'}}));await h.settle();
  assert.ok(nodes(h.settingsForm()).some(node=>node.type==='input'&&node.props.value==='다시 연 저장값'));
  assert.equal(nodes(h.settingsForm()).some(node=>node.type==='input'&&node.props.value==='지연된 이전 값'),false);
  assert.equal(h.requests.some(request=>request.method!=='GET'),false);assert.ok(h.button('상품 b'));
 }finally{h.close();}
});

test('leaving the archive cancels a pending product open before another product is selected',async()=>{
 for(const returnToArchive of [null,'▦상품 관리','전체 보관함']){const h=harness();try{
  await h.settle();await h.click('▦상품 관리');await h.click('상품 작업 열기 →');
  await h.click('✦AI 상품등록');
  if(returnToArchive)await h.click(returnToArchive);
  h.archiveReads[0].resolve(Response.json({product:h.product('a')}));await h.settle();
  assert.equal(Boolean(h.workspace()),false);
  if(returnToArchive){
   await h.click('상품 작업 열기 →');h.archiveReads[1].resolve(Response.json({product:h.product('a')}));await h.settle();
   assert.match(text(h.workspace()),/상품 a/);
  }else assert.ok(h.button('상품 b'));
 }finally{h.close();}}
});

test('missing or mismatched archive product keeps the archive available for a successful retry',async()=>{
 for(const response of [Response.json({error:'상품 없음'},{status:404}),Response.json({product:{id:'unexpected'}})]){
  const h=harness();try{
   await h.settle();await h.click('▦상품 관리');await h.click('상품 작업 열기 →');h.archiveReads[0].resolve(response);await h.settle();
   assert.equal(Boolean(h.workspace()),false);assert.match(text(h.render()),/상품을 열지 못했습니다/);
   await h.click('상품 작업 열기 →');h.archiveReads[1].resolve(Response.json({product:h.product('a')}));await h.settle();assert.match(text(h.workspace()),/상품 a/);
  }finally{h.close();}
 }
});

async function batchFixture(){
 const api=mobileIntakeHarness();await api.intake();
 // The intake fixture appends a uniqueness byte for download identity. Image
 // preparation validates the full PNG, so use its original complete bytes.
 for(const [key,bytes]of api.objects)api.objects.set(key,bytes.slice(0,-1));
 api.bindings.OPENAI_API_KEY='TEST-ONLY-NOT-A-REAL-KEY';api.bindings.SOURCEFLOW_IMAGE_MODEL='gpt-image-1.5';
 const product=api.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
 const request=async(url,init={})=>url===base
  ?api.load('app/api/products/[id]/route.ts')[init.method??'GET'](new Request('https://app.test'+url,init),{params:Promise.resolve({id:product.id})})
  :api.route(url,{method:init.method??'GET',body:init.body});
 const h=harness({batch:{product,request}});
 const start=async()=>{await h.settle();nodes(h.render()).find(node=>node.props?.['aria-label']===product.title+' 선택').props.onChange({target:{checked:true}});await h.click('작업 개시');await h.click('선택 상품 초안 준비·가격 확인');};
 return{api,h,product,base,request,start,close(){h.close();api.close();}};
}

test('batch draft review rereads the saved product before image preparation and retains the chosen step and list version',async()=>{
 const f=await batchFixture(),{h,api,product,base}=f;try{
  await f.start();const saved=api.sqlite.prepare('SELECT * FROM products').get();assert.notEqual(saved.updated_at,product.updated_at);
  await h.click('이미지 초안 검토');assert.equal(h.button('3대표 이미지').props['aria-current'],'step');
  await h.click('이미지 요청 검토하기 · 무료');
  const sent=h.requests.find(request=>request.url===base+'/image-generation'&&request.method==='POST');
  assert.equal(JSON.parse(sent.body).expectedVersion,saved.updated_at);
  assert.equal(api.sqlite.prepare('SELECT count(*) n FROM image_jobs').get().n,1,'actual API accepts the newly opened draft version: '+nodes(h.render()).filter(node=>node.props?.role==='alert').map(text).join(' '));
  assert.equal(h.requests.filter(request=>request.url==='/api/products').length,1,'only the selected product is refreshed');
  assert.equal(h.requests.filter(request=>request.url===base).length,2,'batch run and review each read the current product');
  const close=nodes(h.render()).find(node=>node.props?.['aria-label']==='상품 작업 공간 닫기');close.props.onClick();await h.settle();
  nodes(h.render()).find(node=>node.type==='button'&&node.props.className==='registration-title').props.onClick();await h.settle();await h.click('이미지 요청 검토하기 · 무료');
  assert.equal(JSON.parse(h.requests.filter(request=>request.url===base+'/image-generation'&&request.method==='POST').at(-1).body).expectedVersion,saved.updated_at,'board row retains the refreshed product version');
  assert.ok(h.requests.every(request=>request.method!=='POST'||!request.url.endsWith('/image-generation')||JSON.parse(request.body).action==='prepare'),'no paid image execution');
 }finally{f.close();}
});

test('batch review read errors retain retry and quotation/work review choices',async()=>{
 const f=await batchFixture(),{h,base}=f;try{
  await f.start();
  for(const response of [Response.json({error:'상품 읽기 실패'},{status:503}),Response.json({product:{id:'different'}})]){
   h.deferProduct();await h.click('견적 초안 검토');assert.equal(Boolean(h.workspace()),false);
   h.productReads.at(-1).resolve(response);await h.settle();assert.equal(Boolean(h.workspace()),false);
   assert.ok(nodes(h.render()).some(node=>node.props?.role==='alert'));
  }
  await h.click('견적 초안 검토');assert.equal(h.button('7견적서').props['aria-current'],'step');
  nodes(h.render()).find(node=>node.props?.['aria-label']==='상품 작업 공간 닫기').props.onClick();await h.settle();
  await h.click('작업 개시');await h.click('상품별 작업 열기');assert.equal(nodes(h.workspace()).find(node=>node.type==='button'&&text(node)==='작업 이력').props['aria-pressed'],true);
  assert.equal(h.requests.filter(request=>request.url===base+'/work-draft').length,1,'opening review does not repeat draft preparation');
 }finally{f.close();}
});

test('late batch review responses cannot reopen a closed modal or replace a newer workspace, and unmount aborts the read',async()=>{
 const f=await batchFixture(),{h,base}=f;try{
  await f.start();h.deferProduct();await h.click('이미지 초안 검토');const closed=h.productReads.at(-1);
  await h.click('×');assert.equal(closed.signal.aborted,true);
  closed.resolve(await f.request(base));await h.settle();assert.equal(Boolean(h.workspace()),false);
  await h.click('작업 개시');h.deferProduct();await h.click('이미지 초안 검토');const stale=h.productReads.at(-1);
  await h.click('▦상품 관리');await h.click('상품 작업 열기 →');h.archiveReads[0].resolve(Response.json({product:h.product('a')}));await h.settle();
  h.title().props.onChange({target:{value:''}});await h.settle();stale.resolve(await f.request(base));await h.settle();
  assert.match(text(h.workspace()),/상품 a/);assert.equal(h.title().props.value,'');
  h.deferProduct();await h.click('이미지 초안 검토');const unmounted=h.productReads.at(-1);h.close();assert.equal(unmounted.signal.aborted,true);
  unmounted.resolve(await f.request(base));await h.settle();assert.equal(h.lateDashboardWrites,0);
 }finally{f.close();}
});
