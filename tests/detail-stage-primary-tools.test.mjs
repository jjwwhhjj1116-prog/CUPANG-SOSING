import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {companies,downloadFixture,downloadUI,json,text} from './helpers/image-download-ui.mjs';
import {panel as workspacePanel} from './helpers/detail-workspace.mjs';

const native=createRequire(import.meta.url),plain=value=>JSON.parse(JSON.stringify(value));
function entries(value,ancestors=[]){
 if(Array.isArray(value))return value.flatMap(child=>entries(child,ancestors));
 if(!value||typeof value!=='object')return[];
 const next=[...ancestors,value],label=value.type?.label;
 // These child boundaries consume one upload slot in their real render.
 // Follow those slots explicitly; unrelated ReactNode props are not children.
 const controls=label?.endsWith(':OptionImageEditor')?[value.props.uploadControl,value.props.sidebarActions]
  :label?.endsWith(':ProductOptionsEditor')?value.props.mainImageUploadControl:undefined;
 return[{node:value,ancestors},...entries(value.props?.children,next),...entries(controls,next)];
}
const initiallyVisible=entry=>!entry.ancestors.some(node=>node.props?.hidden===true||node.type==='details'&&node.props.open!==true);

// Execute the actual private DetailPanel; leave imported child components as
// stable nodes so ancestor visibility and the original callbacks are inspected.
function dashboard(){
 const slots=[],effects=[],layouts=[],modules=new Map(),components=new Map();let index=0,allowed=true,saved=0,checks=0;
 const effect=(queue,callback,deps)=>{const slot=index++,old=slots[slot];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps?.[i]))){const next={deps,cleanup:old?.cleanup};slots[slot]=next;queue.push(()=>{next.cleanup?.();next.cleanup=callback();});}};
 const hooks={useState(initial){const slot=index++;if(!(slot in slots))slots[slot]=typeof initial==='function'?initial():initial;return[slots[slot],value=>{slots[slot]=typeof value==='function'?value(slots[slot]):value;}];},useRef(initial){const slot=index++;return slots[slot]??(slots[slot]={current:initial});},useMemo(callback,deps){const slot=index++,old=slots[slot];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))slots[slot]={deps,value:callback()};return slots[slot].value;},useCallback(callback,deps){return hooks.useMemo(()=>callback,deps);},useEffect(callback,deps){effect(effects,callback,deps);},useLayoutEffect(callback,deps){effect(layouts,callback,deps);}};
 function load(file){
  if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);
  const source=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8')+(file.endsWith('dashboard-client.tsx')?'\nexport {DetailPanel};':'');
  vm.runInNewContext(ts.transpileModule(source,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,TextEncoder,crypto,fetch(){throw Error('Presenting stage tools must not send requests.');},require(name){
   if(name==='react')return hooks;
   if(name==='react/jsx-runtime')return{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};
   if(name.endsWith('.css'))return{};
   if(name.startsWith('@/app/components/')){if(!components.has(name))components.set(name,new Proxy({},{get:(_,key)=>{const label=name+':'+String(key);if(!components.has(label))components.set(label,Object.assign(()=>null,{label}));return components.get(label);}}));return components.get(name);}
   return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);
  }});return exports;
 }
 const Detail=load('app/components/dashboard-client.tsx').DetailPanel,settings=load('app/workspace-settings.ts').defaultSettings;
 const product={id:'stage-tools',owner_id:'owner',title:'검수 상품',image_keys:'["owner/a.png"]',updated_at:'2026-10-21T00:00:00.000Z'};
 let props={product,settings,tab:'상세 이미지',focusedOptionId:'red',preferredProfileId:'cat',onSaved(){saved++;},onUpload(){},onSavePrice:async()=>{},onManageCategories(){},onBeforeFreeImageApply(){checks++;return allowed;}};
 const render=(patch={})=>{props={...props,...patch};index=0;const tree=Detail(props);layouts.splice(0).forEach(run=>run());effects.splice(0).forEach(run=>run());return tree;};
 const child=(name,stage)=>{const found=entries(render()).filter(({node})=>node.type?.label?.endsWith(':'+name)&&(stage===undefined||node.props.stage===stage));assert.equal(found.length,1,name);return found[0];};
 return{render,child,product,get saved(){return saved;},get checks(){return checks;},allow(value){allowed=value;},close(){slots.forEach(slot=>slot?.cleanup?.());}};
}

test('selected Stage5 opens its stored BODY editor with stable busy ownership and no quotation-slot batch or automatic operation',()=>{
 const h=dashboard();try{
  const image=h.child('OptionImageEditor','detail');
  assert.equal(initiallyVisible(image),true);assert.equal(image.node.props.primaryDetailTools,true);assert.equal(image.node.props.active,true);
  assert.equal(image.node.props.optionId,'red');assert.equal(image.node.props.profileId,'cat');assert.equal(typeof image.node.props.onDetailWorkBusyChange,'function');
  assert.equal(entries(h.render()).some(({node})=>node.type?.label?.endsWith(':DetailImageBatchPanel')&&node.props.stage==='detail'),false,'Stage5 translates its stored BODY composition');
  assert.equal(initiallyVisible(h.child('ProductContentEditor')),false,'common editor is optional with a focused detail option');
  const imageKey=image.node.key;
  for(const tab of ['견적서','SEO','추가 이미지','상세 이미지']){h.render({tab});const current=h.child('OptionImageEditor','detail');assert.equal(current.node.type,image.node.type);assert.equal(current.node.key,imageKey);assert.equal(current.node.props.onDetailWorkBusyChange,image.node.props.onDetailWorkBusyChange);assert.equal(initiallyVisible(current),tab==='상세 이미지');assert.equal(current.node.props.active,tab==='상세 이미지');}
  assert.equal(h.saved,0);assert.equal(h.checks,0);
 }finally{h.close();}
});

test('selected Stage4 opens its existing gallery and instant tools while unscoped common upload remains intact',()=>{
 const h=dashboard();try{
  h.render({tab:'추가 이미지'});const image=h.child('OptionImageEditor','additional'),batch=h.child('DetailImageBatchPanel','additional');
  assert.equal(initiallyVisible(image),true);assert.equal(initiallyVisible(batch),true);assert.equal(image.node.props.saveOnChange,true);assert.equal(initiallyVisible(h.child('ProductContentEditor')),false);
  assert.equal(image.node.props.optionId,'red');assert.equal(batch.node.props.optionId,'red');assert.equal(batch.node.props.profileId,'cat');assert.notEqual(batch.node.props.autoPrepare,true);assert.equal(batch.node.props.compactToolbar,true);
  const imageKey=image.node.key,batchKey=batch.node.key;
  for(const tab of ['견적서','SEO','상세 이미지','추가 이미지']){h.render({tab});const current=h.child('OptionImageEditor','additional'),currentBatch=h.child('DetailImageBatchPanel','additional');assert.equal(current.node.type,image.node.type);assert.equal(current.node.key,imageKey);assert.equal(currentBatch.node.key,batchKey);assert.equal(initiallyVisible(current),tab==='추가 이미지');assert.equal(current.node.props.active,tab==='추가 이미지');}
  h.render({tab:'추가 이미지',focusedOptionId:undefined});assert.equal(initiallyVisible(h.child('ProductContentEditor')),true);assert.equal(entries(h.render()).some(({node})=>node.type?.label?.endsWith(':OptionImageEditor')),false);
  h.render({tab:'상세 이미지',focusedOptionId:undefined});assert.equal(initiallyVisible(h.child('ProductContentEditor')),true);
  assert.equal(entries(h.render()).some(({node})=>node.type?.label?.endsWith(':OptionImageEditor')),false);
  const upload=h.child('ProductImageUploadQueue','detail').node;assert.equal(upload.props.target.optionId,null);assert.equal(upload.props.immediate,true);assert.equal(upload.props.active,true);assert.equal(h.saved,0);assert.equal(h.checks,0);
 }finally{h.close();}
});

test('primary detail callbacks keep their exact slot and existing same-tick processing guards',()=>{
 const h=dashboard();try{
  h.render({tab:'대표 이미지'});h.render({tab:'추가 이미지'});h.render({tab:'상세 이미지'});
  const image=h.child('OptionImageEditor','detail').node,batch=h.child('DetailImageBatchPanel','additional').node;
  const target={kind:'quotation',profileId:'cat',optionId:'red',input:'detailImages',fieldKey:'detailImages',slotIndex:0,revision:1,inputFingerprint:'a'.repeat(64),optionRevision:1,value:'owner/a.png'};
  const upload=h.child('ProductImageUploadQueue','main').node;upload.props.onBusyChange(true);
  image.props.onEdit('owner/a.png','detail',target);assert.equal(batch.props.beforeApply(),false);assert.equal(h.checks,0);assert.equal(h.child('OptionImageEditor','detail').node.props.disabled,true);
  upload.props.onBusyChange(false);h.allow(false);assert.equal(batch.props.beforeApply(),false);h.allow(true);assert.equal(batch.props.beforeApply(),true);
  image.props.onDetailWorkBusyChange(true);
  assert.equal(upload.props.beforeUpload(),false,'a captured sibling callback sees BODY work before React rerenders');assert.equal(batch.props.beforeApply(),false,'Stage4 cannot overlap BODY work in the same tick');
  image.props.onEdit('owner/a.png','detail',target);const inactive=entries(h.render()).find(({node})=>node.type?.label?.endsWith('free-image-translation-panel:default')).node;
  assert.equal(inactive.props.active,false);assert.equal(inactive.props.translationTarget,undefined,'captured edit cannot open a competing photo operation');
  assert.equal(h.child('OptionImageEditor','detail').node.props.disabled,false,'BODY busy ownership does not disable its own editor');assert.equal(h.child('OptionImageEditor','additional').node.props.disabled,true);
  assert.equal(h.child('ProductImageUploadQueue','detail').node.props.disabled,true);image.props.onDetailWorkBusyChange(false);assert.equal(upload.props.beforeUpload(),true);
  image.props.onEdit('owner/a.png','detail',target);const free=entries(h.render()).find(({node})=>node.type?.label?.endsWith('free-image-translation-panel:default')).node;
  assert.deepEqual(plain(free.props.translationTarget.quotationTarget),target);assert.equal(free.props.translationTarget.intent,'manual');assert.equal(h.child('OptionImageEditor','detail').node.props.disabled,true);assert.equal(h.saved,0);
 }finally{h.close();}
});

for(const company of companies)test(`${company.companyCode} primary stored BODY save stays visible while final-photo fallback preserves its exact save guards`,async()=>{
 const f=await downloadFixture(company);let h,workspaceUI;
 try{
  const props={productId:f.product.id,optionId:'1688-red',version:f.product.updated_at,profileId:'cat',stage:'detail',primaryDetailTools:true,onTranslate(){throw Error('No implicit translation');},onEdit(){}};
  const view=await json(await f.api.route(f.base+'/quotation-fields?profileId=cat')),selected=view.resolved.rows.find(row=>row.optionId&&row.included!==false);assert.ok(selected,'an actual included option rather than the common row');props.optionId=selected.optionId;
  const confirmations=[];h=downloadUI('app/components/option-image-editor.tsx','OptionImageEditor',props,f.request,{confirm:message=>{confirmations.push(message);return true;}});await h.idle();
  const composite=entries(h.render()).find(({node})=>typeof node.type==='function'&&node.type.name==='DetailImageCompositePanel');assert.ok(composite);assert.equal(initiallyVisible(composite),false,'saved final-image composite remains a secondary tool');assert.equal(composite.node.props.disabled,false);assert.equal(composite.node.props.beforeApply(),true);
  assert.equal(entries(h.render()).filter(({node})=>node.type?.name==='DetailImageCompositePanel').length,1,'one original composite controller');
  const zip=entries(h.render()).find(({node})=>node.type==='button'&&text(node)==='상세 이미지 ZIP 다운로드');assert(zip);assert.equal(initiallyVisible(zip),false);
  for(const name of ['상세 이미지 2 번역·수정','상세 이미지 2 순서·삭제'])assert(entries(h.render()).some(({node})=>node.props?.role==='group'&&node.props['aria-label']===name));
  const workspace=entries(h.render()).find(({node})=>typeof node.type==='function'&&node.type.name==='DetailWorkspacePanel');assert.ok(workspace);assert.equal(initiallyVisible(workspace),true,'stored BODY composition is the primary editor');assert.equal(workspace.node.props.primaryDetailTools,true);
  const workspaceCalls=[],request=async(url,init={})=>{
   workspaceCalls.push({url,init});assert.equal(init.method??'GET','GET','opening the BODY seed must not write');
   const query=new URL(url,'https://fixture.test');assert.equal(query.pathname,f.base+'/detail-workspace');assert.equal(query.searchParams.get('optionId'),props.optionId);assert.equal(query.searchParams.get('profileId'),'cat');
   return Response.json({view:workspace.node.props.view,workspace:null,roles:{top:[f.keys[2]],bottom:[f.keys[6]]}});
  };
  workspaceUI=workspacePanel({selection:()=>workspace.node.props,request,storage:new Map(),calls:workspaceCalls});await workspaceUI.idle();await h.idle();
  assert.equal(workspaceCalls.length,1,'opening the exact BODY seed performs one read');
  const primarySave=entries(h.render()).find(({node})=>node.type==='button'&&node.props['aria-label']==='상세 이미지 저장 검토');assert.ok(primarySave);assert.equal(initiallyVisible(primarySave),true);assert.equal(primarySave.node.props.disabled,false,'collected BODY seed can explicitly save before composite preparation: '+text(workspaceUI.render()));
  workspaceUI.close();workspaceUI=null;
  for(const label of ['상세 이미지 2 편집하기','상세 이미지 2 영어 한국어 번역','상세 이미지 2 위로 이동','상세 이미지 2 선택 제거','선택 옵션 이미지 저장']){const entry=entries(h.render()).find(({node})=>node.type==='button'&&(node.props['aria-label']===label||text(node)===label));assert.ok(entry,label);assert.equal(initiallyVisible(entry),false,'saved final-image tools remain in their disclosure: '+label);}
  const before=f.retained(),files=f.originals(),sourceOptions=JSON.stringify(f.api.sqlite.prepare('SELECT * FROM product_options').all());assert.equal(h.button('선택 옵션 이미지 저장').props.disabled,true);
  h.button('상세 이미지 2 선택 제거').props.onClick();assert.equal(confirmations.length,1);assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(h.button('선택 옵션 이미지 저장').props.disabled,false);
  assert.equal(h.button('상세 이미지 1 편집하기').props.disabled,true);const blocked=entries(h.render()).find(({node})=>node.type?.name==='DetailImageCompositePanel');assert.equal(blocked.node.props.disabled,true);assert.equal(blocked.node.props.beforeApply(),false);
  assert.equal(f.retained(),before);assert.equal(f.originals(),files);assert.equal(h.requests.filter(call=>call.init?.method==='PUT'||call.init?.method==='POST').length,0);
  const retainedSave=h.button('선택 옵션 이미지 저장').props.onClick;
  h.props({active:false});retainedSave();await h.idle();assert.equal(h.requests.filter(call=>call.init?.method==='PUT').length,0,'inactive retained save callback cannot write');
  h.props({active:true});await h.click('선택 옵션 이미지 저장');assert.equal(h.saved.length,1,text(h.render()));assert.equal(h.requests.filter(call=>call.init?.method==='PUT').length,1);assert.equal(h.requests.filter(call=>call.init?.method==='POST').length,0);
  const after=await json(await f.api.route(f.base+'/quotation-fields?profileId=cat')),prior=view.resolved.rows.find(row=>row.optionId===props.optionId),current=after.resolved.rows.find(row=>row.optionId===props.optionId);
  const expected=prior.fields.detailImages.value.split(/\r?\n/).filter((_,index)=>index!==1).join('\n');
  assert.equal(current.fields.detailImages.value,expected);assert.equal(current.fields.detailHtml.source,prior.fields.detailHtml.source);assert.equal(after.overrides.options[props.optionId]?.detailHtml,view.overrides.options[props.optionId]?.detailHtml);assert.deepEqual(plain(after.overrides.common),plain(view.overrides.common));
  assert.deepEqual(plain(after.resolved.rows.filter(row=>row.optionId!==props.optionId)),plain(view.resolved.rows.filter(row=>row.optionId!==props.optionId)));
  assert.equal(JSON.stringify(f.api.sqlite.prepare('SELECT * FROM product_options').all()),sourceOptions);assert.equal(f.originals(),files);assert.deepEqual(plain(after.imageKeys),plain(view.imageKeys));
 }finally{workspaceUI?.close();h?.close();f.api.close();}
});
