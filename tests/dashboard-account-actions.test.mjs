import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const scope=(ownerId='test-owner')=>({ownerId,company:{code:'A01526306',name:'유앤채'}});
const plain=value=>JSON.parse(JSON.stringify(value));
const version='2026-10-06T00:00:00.000Z';
const product=id=>({id,owner_id:'test-owner',title:'상품 '+id,source_url:'https://source.example.test/product/'+id,created_at:version,updated_at:version,image_keys:JSON.stringify(['test-owner/'+id+'/source.png','test-owner/'+id+'/second.png']),options_count:1,source_price_cny:2,exchange_rate:350,supply_margin:50,coupang_margin:40,supply_price:1400,sale_price:2340,msrp:3050,seo_status:'대기',image_status:'대기',quote_status:'대기',registration_status:'검토 대기',supplier_hub_status:'미전송',goal_stage:'work'});

/** Actual DashboardClient, its private DetailPanel and settings dialog. Child
 * renderers record their received props; every tested callback is the real
 * parent callback, and requests run through its real fetch/readJson code. */
function harness({workspaceOwnerId='test-owner',settingsBody={settings:{brand:'계정의 저장 브랜드',exchangeRate:350},scope:scope()},deleteReply=async id=>Response.json({productId:id,removed:true})}={}){
 const instances=new Map(),cache=new Map(),components=new Map(),componentMounts=new Map(),componentCounts=new Map(),effects=[],requests=[];let active,tree,closed=false,lateWrites=0;
 let currentSettings=settingsBody,replyDelete=deleteReply,nextDelete=null,nextSettings=null,replySettingsPut=null;
 const products=[product('product-a'),product('product-b')];
 const draft={rows:[],setRows(){},goal:'work',setGoal(){},ready:true,loading:false,saving:false,dirty:false,message:'',save(){},load(){}};
 const hooks={
  useState(initial){const instance=active,slot=instance.index++;if(!(slot in instance.slots))instance.slots[slot]=typeof initial==='function'?initial():initial;return[instance.slots[slot],value=>{if(!instance.mounted){lateWrites++;return;}instance.slots[slot]=typeof value==='function'?value(instance.slots[slot]):value;}];},
  useRef(initial){const slot=active.index++;return active.slots[slot]??(active.slots[slot]={current:initial});},
  useCallback(fn,deps){const slot=active.index++,old=active.slots[slot];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))active.slots[slot]={fn,deps};return active.slots[slot].fn;},
  useEffect(fn,deps){const instance=active,slot=instance.index++,old=instance.slots[slot];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps[i]))){const next={deps,cleanup:old?.cleanup};instance.slots[slot]=next;effects.push(()=>{next.cleanup?.();next.cleanup=fn();});}},
  useMemo(fn){return fn();},
 };
 async function request(url,init={}){
  requests.push({url,init,method:init.method??'GET'});
  if(url==='/api/products')return Response.json({products});
  if(url==='/api/collection-jobs')return Response.json({jobs:[]});
  if(url==='/api/settings'){
   if(init.method==='PUT'){
    if(replySettingsPut)return replySettingsPut(url,init);
    currentSettings={settings:JSON.parse(init.body),scope:scope(workspaceOwnerId)};return Response.json(currentSettings);
   }
   if(nextSettings){const pending=nextSettings;nextSettings=null;return pending.promise;}
   return Response.json(currentSettings);
  }
  if(url.startsWith('/api/products/')&&init.method==='DELETE'){
   if(nextDelete){const pending=nextDelete;nextDelete=null;return pending.promise;}
   return replyDelete(decodeURIComponent(url.split('/').at(-1)),init);
  }
  if(url.startsWith('/api/products/'))return Response.json({product:products.find(row=>row.id===decodeURIComponent(url.split('/').at(-1)))});
  throw Error('Unexpected request '+url);
 }
 const stubs=new Map();
 function componentModule(name){
  let component=stubs.get(name);if(!component){component=props=>{components.set(name,props);componentMounts.set(name,active);componentCounts.set(name,(componentCounts.get(name)??0)+1);return null;};component.displayName=name;stubs.set(name,component);}
  return new Proxy({__esModule:true,default:component,registrationTitle:value=>value.title},{get(target,key){return key in target?target[key]:component;}});
 }
 function load(file){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,URL,URLSearchParams,Date,Intl,TextEncoder,TextDecoder,structuredClone,crypto,fetch:request,window:{addEventListener(){},removeEventListener(){},confirm:()=>false,setTimeout:()=>0},require(name){
   if(name==='react')return hooks;
   if(name==='react/jsx-runtime')return{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};
   if(name==='@/app/components/use-intake-draft')return{useIntakeDraft:()=>draft};
   if(name==='@/app/load-category-profiles')return{loadCategoryProfiles:async()=>[]};
   if(name==='@/app/components/workspace-settings-dialog')return load('app/components/workspace-settings-dialog.tsx');
   if(name.startsWith('@/app/components/'))return componentModule(name.split('/').at(-1));
   return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);
  }});return exports;
 }
 const Dashboard=load('app/components/dashboard-client.tsx').default;
 function expand(value,path,seen){
  if(Array.isArray(value))return value.map((child,index)=>expand(child,path+'/'+(child?.key??index),seen));
  if(!value||typeof value!=='object')return value;
  if(typeof value.type==='function'){
   const key=path+'/'+(value.type.displayName??value.type.name)+':'+(value.key??'');let instance=instances.get(key);
   if(!instance){instance={slots:[],mounted:true};instances.set(key,instance);}seen.add(key);instance.index=0;active=instance;
   return expand(value.type(value.props),key,seen);
  }
  const next={...value,props:{...value.props,children:expand(value.props?.children,path+'/children',seen)}};
  if(next.props.ref&&typeof next.props.ref==='object')next.props.ref.current={querySelector:()=>null,querySelectorAll:()=>[],scrollTo(){}};
  return next;
 }
 function render(){
  if(closed)return tree;components.clear();componentMounts.clear();componentCounts.clear();const seen=new Set();tree=expand({type:Dashboard,props:{userName:'테스트 관리자',workspaceOwnerId}},'root',seen);
  for(const [key,instance]of instances)if(!seen.has(key)){instance.mounted=false;instance.slots.forEach(slot=>slot?.cleanup?.());instances.delete(key);}
  effects.splice(0).forEach(effect=>effect());return tree;
 }
 const settle=async()=>{for(let i=0;i<10;i++){if(!closed)render();await new Promise(resolve=>setImmediate(resolve));}};
 const component=name=>{render();return components.get(name);};
 const button=label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label);
 return{products,requests,render,settle,component,button,componentMount(name){render();return componentMounts.get(name);},componentCount(name){render();return componentCounts.get(name)??0;},async click(label){const found=button(label);assert.ok(found,'Missing button '+label);found.props.onClick();await settle();},deferDelete(){return nextDelete=deferred();},deferSettings(){return nextSettings=deferred();},setSettingsBody(value){currentSettings=value;},setDeleteReply(fn){replyDelete=fn;},setSettingsPutReply(fn){replySettingsPut=fn;},close(){closed=true;for(const instance of instances.values()){instance.mounted=false;instance.slots.forEach(slot=>slot?.cleanup?.());}},get lateWrites(){return lateWrites;}};
}

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
  const saving=handler(first);await assert.rejects(()=>handler(first),/진행 중인 작업/);assert.equal(h.requests.filter(request=>request.method==='DELETE').length,1);assert.equal(h.component('registration-board').products.length,2);
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

test('detail image translation parent forwards owned source/language with a new sequence and rejects missing images or busy work',async()=>{
 const h=harness();try{
  await h.settle();h.component('registration-board').onOpen(h.products[0],'상세 이미지');await h.settle();const source=JSON.parse(h.products[0].image_keys)[0];
  assert.equal(h.component('image-generation-panel').translationTarget,undefined);
  for(const [language,sequence]of [['zh',1],['en',2],['zh',3]]){
   h.component('product-content-editor').onTranslateImage(source,language);await h.settle();assert.deepEqual(plain(h.component('image-generation-panel').translationTarget),{sourceKey:source,sourceLanguage:language,sequence});
  }
  const previous=plain(h.component('image-generation-panel').translationTarget);h.component('product-content-editor').onTranslateImage('other-owner/foreign.png','en');await h.settle();assert.deepEqual(plain(h.component('image-generation-panel').translationTarget),previous);
  h.component('image-generation-panel').onBusyChange(true);await h.settle();assert.equal(h.component('product-content-editor').imageProcessingBusy,true);h.component('product-content-editor').onTranslateImage(source,'en');await h.settle();assert.deepEqual(plain(h.component('image-generation-panel').translationTarget),previous);
  h.component('image-generation-panel').onBusyChange(false);await h.settle();h.component('product-content-editor').onTranslateImage(source,'en');await h.settle();assert.equal(h.component('image-generation-panel').translationTarget.sequence,4);
 }finally{h.close();}
});

test('translation selection stays scoped to its product and an unmounted product callback cannot seed a later product',async()=>{
 const h=harness();try{
  await h.settle();h.component('registration-board').onOpen(h.products[0],'상세 이미지');await h.settle();const old=h.component('product-content-editor').onTranslateImage,source=JSON.parse(h.products[0].image_keys)[0];old(source,'zh');await h.settle();assert.equal(h.component('image-generation-panel').translationTarget.sequence,1);
  h.component('registration-board').onOpen(h.products[1],'상세 이미지');await h.settle();assert.equal(h.component('image-generation-panel').productId,h.products[1].id);assert.equal(h.component('image-generation-panel').translationTarget,undefined);
  old(source,'en');await h.settle();assert.equal(h.component('image-generation-panel').translationTarget,undefined);
  const secondSource=JSON.parse(h.products[1].image_keys)[0];h.component('product-content-editor').onTranslateImage(secondSource,'en');await h.settle();assert.deepEqual(plain(h.component('image-generation-panel').translationTarget),{sourceKey:secondSource,sourceLanguage:'en',sequence:1});
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
