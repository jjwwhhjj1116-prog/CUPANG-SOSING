import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';

const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
const plain=value=>JSON.parse(JSON.stringify(value));
const settle=async()=>{for(let index=0;index<12;index++)await new Promise(resolve=>setImmediate(resolve));};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const prepare='이미지 요청 검토하기 · 무료';
const refresh='저장된 설정·실행 이력 새로고침 · 무료';

// Real component handlers and content models; HTTP, image decoding and DOM
// focus/scroll are isolated. These tests never access a live product or provider.
function componentHarness(file,exportName,initialProps,request,overrides={}){
 const slots=[],effects=[],cache=new Map(),domActions=[];let index=0,closed=false,props=initialProps;
 const hooks={
  useState(initial){const slot=index++;if(!(slot in slots))slots[slot]=typeof initial==='function'?initial():initial;return[slots[slot],value=>{slots[slot]=typeof value==='function'?value(slots[slot]):value;}];},
  useRef(initial){const slot=index++;return slots[slot]??(slots[slot]={current:initial});},
  useCallback(fn,deps){const slot=index++,old=slots[slot];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))slots[slot]={fn,deps};return slots[slot].fn;},
  useEffect(fn,deps){const slot=index++,old=slots[slot];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps[i]))){const next={deps,cleanup:null};slots[slot]=next;effects.push(()=>{old?.cleanup?.();next.cleanup=fn();});}}
 };
 function load(path){
  if(cache.has(path))return cache.get(path);
  const exports={};cache.set(path,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+path,import.meta.url),'utf8'),{fileName:path,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
   {exports,Error,AbortController,DOMException,TextEncoder,crypto,structuredClone,URL,fetch:request,require(name){if(name==='react')return hooks;if(overrides[name])return overrides[name];if(name.startsWith('@/'))return load(name.slice(2)+(name.includes('/components/')?'.tsx':'.ts'));return native(name);}});
  return exports;
 }
 const Component=load(file)[exportName];
 function render(){
  index=0;let tree=Component(props);if(typeof tree.type==='function')tree=tree.type(tree.props);
  for(const node of nodes(tree))if(typeof node.type==='string'&&node.props.ref&&typeof node.props.ref==='object')node.props.ref.current={focus(options){domActions.push({action:'focus',options});},scrollIntoView(options){domActions.push({action:'scroll',options});}};
  effects.splice(0).forEach(fn=>fn());return tree;
 }
 return{load,render,domActions,update(next){props={...props,...next};return render();},close(){if(closed)return;closed=true;slots.forEach(slot=>slot?.cleanup?.());}};
}

const editorKeys=['owner/main.png','owner/additional.png','owner/top.png','owner/body-a.png','owner/body-b.png','owner/body-c.png','owner/bottom.png','owner/label.png','owner/size.png','owner/unused.png'];
function editorHarness({handler,readSource,missing=false,shared=false,initialPending}={}){
 const calls=[],translations=[],sourceReads=[];
 const product={id:'synthetic-detail',title:'시험 상품',image_keys:JSON.stringify(editorKeys)};
 let persisted,notices=0;
 const request=async(url,init)=>{calls.push({url,init});if(calls.length===1&&initialPending)return initialPending;
  const custom=handler?.(url,init,persisted);if(custom!==undefined)return custom;
  if(init?.method==='PATCH'){persisted=h.load('app/product-content.ts').applyContentPatch(persisted,JSON.parse(init.body).patch,'2026-10-06T00:00:00Z');return Response.json({content:persisted});}
  assert.equal(init?.method,undefined,'only the initial content read is implicit');return Response.json({content:persisted});
 };
 const h=componentHarness('app/components/product-content-editor.tsx','ProductContentEditor',{product,section:'이미지',focusedAssetRole:'detail',onTranslateImage(sourceKey,sourceLanguage){translations.push({sourceKey,sourceLanguage});},onSaved(){notices++;}},request,
  {'@/app/local-image-resize':{readResizeSource(...args){sourceReads.push(args);return readSource?.(...args)??Promise.resolve({key:args[1],width:100,height:150,contentRevision:args[2],productVersion:'synthetic'});}}});
 persisted=h.load('app/product-content.ts').emptyProductContent(product.id);persisted.revision=3;
 for(const [role,keys]of Object.entries({main:[editorKeys[0]],additional:[editorKeys[1]],detailTop:[editorKeys[2]],detail:[...editorKeys.slice(3,6),...(missing?['owner/no-longer-attached.png']:[])],detailBottom:[editorKeys[6]],label:[editorKeys[7]],size:[editorKeys[8]]}))persisted.assets[role].value=keys;
 if(shared)persisted.assets.main.value=[editorKeys[3]];
 persisted.detail.description.value='검토할 상세 설명';
 const initial=structuredClone(persisted);
 return{...h,calls,translations,sourceReads,product,initial,get persisted(){return persisted;},get notices(){return notices;},async start(){h.render();await settle();h.render();},
  button(label){const found=nodes(h.render()).find(node=>node.type==='button'&&(node.props['aria-label']===label||text(node)===label));assert.ok(found,label);return found;},
  preview(){const preview=nodes(h.render()).find(node=>node.props?.['aria-label']==='상세페이지 배치 미리보기');assert.ok(preview,'stage-five detail preview');return nodes(preview).filter(node=>node.type==='figure');}
 };
}
const previewKeys=h=>h.preview().map(figure=>figure.key);
const writes=h=>h.calls.filter(call=>call.init?.method);
const toolbarActions=['중국어→한국어 번역','영어→한국어 번역','편집','위로','아래로','상세에서 제외'];

test('stage-five preview toolbar retains source keys and excludes unavailable references',async()=>{
 const h=editorHarness({missing:true});try{await h.start();assert.deepEqual(previewKeys(h),editorKeys.slice(2,7));
  for(const figure of h.preview()){
   const sourceIndex=editorKeys.indexOf(figure.key)+1;
   for(const action of toolbarActions)assert.ok(nodes(figure).some(node=>node.type==='button'&&node.props['aria-label']===`이미지 ${sourceIndex} ${action}`));
   const image=nodes(figure).find(node=>node.type==='img');assert.equal(decodeURIComponent(image.props.src.slice('/api/files/'.length)),figure.key);
  }
  for(const sourceIndex of [3,7])for(const action of ['위로','아래로'])assert.equal(h.button(`이미지 ${sourceIndex} ${action}`).props.disabled,true,'top/bottom stay in their single-image roles');
  assert.equal(h.button('이미지 4 위로').props.disabled,true);
  for(const [label,sourceLanguage]of [['중국어→한국어 번역','zh'],['영어→한국어 번역','en']]){
   const button=h.button(`이미지 5 ${label}`);assert.equal(text(button),label);button.props.onClick();assert.deepEqual(h.translations.at(-1),{sourceKey:editorKeys[4],sourceLanguage});
  }
  assert.equal(h.translations.length,2);assert.equal(writes(h).length,0);assert.equal(h.sourceReads.length,0);
 }finally{h.close();}
});

test('inline movement and exclusion become persistent only after explicit detail PATCH save',async()=>{
 const h=editorHarness();try{await h.start();const references=h.product.image_keys;assert.equal(h.button('이미지 6 아래로').props.disabled,true);
  h.button('이미지 4 아래로').props.onClick();assert.deepEqual(previewKeys(h),[editorKeys[2],editorKeys[4],editorKeys[3],editorKeys[5],editorKeys[6]]);
  h.button('이미지 5 상세에서 제외').props.onClick();assert.deepEqual(previewKeys(h),[editorKeys[2],editorKeys[3],editorKeys[5],editorKeys[6]]);
  assert.equal(writes(h).length,0);assert.deepEqual(plain(h.persisted),plain(h.initial));assert.equal(h.product.image_keys,references,'draft exclusion retains every stored file reference');
  h.button('상세 설명·이미지 저장').props.onClick();await settle();
  const saved=writes(h);assert.equal(saved.length,1);assert.equal(saved[0].init.method,'PATCH');assert.ok(saved[0].url.endsWith('/content'));
  const body=JSON.parse(saved[0].init.body);assert.equal(body.expectedRevision,3);assert.deepEqual(body.patch.assets,{detail:[editorKeys[3],editorKeys[5]]});
  assert.deepEqual(plain(h.persisted.assets.detail.value),[editorKeys[3],editorKeys[5]]);
  for(const role of ['main','additional','detailTop','detailBottom','label','size'])assert.deepEqual(plain(h.persisted.assets[role]),plain(h.initial.assets[role]),role);
  assert.equal(h.product.image_keys,references);assert.equal(h.notices,1);assert.equal(h.calls.some(call=>call.init?.method==='POST'||call.init?.method==='DELETE'),false);
 }finally{h.close();}
});

test('inline editing reads the exact displayed source without changing saved roles',async()=>{
 const h=editorHarness();try{await h.start();h.button('이미지 6 편집').props.onClick();await settle();
  assert.equal(h.sourceReads.length,1);assert.deepEqual(h.sourceReads[0].slice(0,3),['synthetic-detail',editorKeys[5],3]);assert.equal(h.sourceReads[0][3].aborted,false);
  assert.ok(nodes(h.render()).some(node=>node.props?.['aria-label']==='이미지 편집'));assert.deepEqual(plain(h.persisted),plain(h.initial));assert.equal(writes(h).length,0);
 }finally{h.close();}
});

test('detail exclusion preserves a legacy shared main role and every source file reference',async()=>{
 const h=editorHarness({shared:true});try{await h.start();h.button('이미지 4 상세에서 제외').props.onClick();
  assert.deepEqual(previewKeys(h),[editorKeys[2],editorKeys[4],editorKeys[5],editorKeys[6]]);assert.equal(writes(h).length,0);assert.deepEqual(plain(h.persisted),plain(h.initial));
  h.button('상세 설명·이미지 저장').props.onClick();await settle();
  assert.deepEqual(JSON.parse(writes(h)[0].init.body).patch.assets,{detail:[editorKeys[4],editorKeys[5]]});
  assert.deepEqual(plain(h.persisted.assets.main),plain(h.initial.assets.main));assert.equal(h.product.image_keys,JSON.stringify(editorKeys));
 }finally{h.close();}
});

test('content loading leaves no callable inline image action before the saved roles arrive',async()=>{
 const pending=deferred(),h=editorHarness({initialPending:pending.promise});try{h.render();
  assert.equal(nodes(h.render()).some(node=>node.type==='button'&&/^이미지 \d+ (중국어→한국어 번역|영어→한국어 번역|편집|위로|아래로|상세에서 제외)$/.test(node.props['aria-label']??'')),false);
  assert.equal(h.calls.length,1);assert.equal(h.translations.length,0);assert.equal(h.sourceReads.length,0);
  pending.resolve(Response.json({content:h.initial}));await settle();assert.equal(h.button('이미지 5 중국어→한국어 번역').props.disabled,false);assert.equal(writes(h).length,0);
 }finally{h.close();}
});

test('inline toolbar blocks external processing and failed-save conflicts',async()=>{
 const h=editorHarness({handler(_url,init){if(init?.method==='PATCH')return Response.json({error:'시험 저장 충돌'},{status:409});}});
 try{await h.start();h.update({imageProcessingBusy:true});
  for(const action of toolbarActions){const button=h.button(`이미지 5 ${action}`);assert.equal(button.props.disabled,true,action);button.props.onClick();}
  assert.equal(h.translations.length,0);assert.equal(h.sourceReads.length,0);assert.deepEqual(previewKeys(h),editorKeys.slice(2,7));assert.equal(writes(h).length,0);
  h.update({imageProcessingBusy:false});h.button('이미지 5 위로').props.onClick();const pendingOrder=previewKeys(h);h.button('상세 설명·이미지 저장').props.onClick();await settle();
  for(const action of toolbarActions){const button=h.button(`이미지 5 ${action}`);assert.equal(button.props.disabled,true,action);button.props.onClick();}
  assert.deepEqual(previewKeys(h),pendingOrder);assert.equal(h.translations.length,0);assert.equal(h.sourceReads.length,0);assert.deepEqual(plain(h.persisted),plain(h.initial));assert.equal(writes(h).length,1);
 }finally{h.close();}
});

test('captured inline callbacks cannot alter a draft while save or local image read is active',async()=>{
 for(const operation of ['save','edit']){
  const pending=deferred();
  const h=editorHarness({handler(_url,init,content){if(operation==='save'&&init?.method==='PATCH')return pending.promise.then(()=>Response.json({content}));},readSource:operation==='edit'?()=>pending.promise:undefined});
  try{await h.start();const stale=toolbarActions.map(action=>h.button(`이미지 5 ${action}`).props.onClick);
   if(operation==='save'){h.button('이미지 4 아래로').props.onClick();h.button('상세 설명·이미지 저장').props.onClick();}else h.button('이미지 4 편집').props.onClick();
   const before=previewKeys(h);stale.forEach(click=>click());
   for(const action of toolbarActions)assert.equal(h.button(`이미지 5 ${action}`).props.disabled,true,`${operation}: ${action}`);
   assert.deepEqual(previewKeys(h),before);assert.equal(h.translations.length,0);assert.equal(h.sourceReads.length,operation==='edit'?1:0);assert.equal(writes(h).length,operation==='save'?1:0);
   pending.resolve({key:editorKeys[3],width:100,height:150});await settle();
  }finally{h.close();}
 }
});

const panelKeys=['owner/raw.png','owner/第二 張.png','owner/label.png'];
function panelHarness(handler=(_url,_init,{view,job})=>Response.json({...view,job}),initialProps={},status='prepared'){
 const calls=[],busyChanges=[];let changed=0;
 const job={id:'synthetic-image-job',productId:'synthetic-detail',productVersion:'v',contentRevision:3,status,createdAt:'2026-10-06T00:00:00Z',
  review:{sourceKey:panelKeys[0],source:{width:100,height:100,bytes:100,mime:'image/png',sha256:'fixture'},model:'synthetic-model',size:'1024x1024',quality:'low',purpose:'translate',prompt:'',effectivePrompt:'시험 요청',settingsFingerprint:'settings',recipeVersion:1,expiresAt:'2099-01-01',paidNotice:'시험 요청',pricingUrl:'https://example.invalid',fingerprint:'fixture'},result:null,error:null};
 const view={configuration:{configured:true,issues:[]},settings:{translateImages:true,removeBackground:false,addCopyright:false,translationPrompt:''},settingsFingerprint:'settings',jobs:[job]};
 const request=async(url,init)=>{calls.push({url,init});return calls.length===1?Response.json(view):handler(url,init,{view,job});};
 const h=componentHarness('app/components/image-generation-panel.tsx','default',{productId:'synthetic-detail',version:'v',imageKeys:[...panelKeys],onProductChanged(){changed++;},onBusyChange(value){busyChanges.push(value);},...initialProps},request);
 const select=value=>{const found=nodes(h.render()).find(node=>node.type==='select'&&nodes(node.props.children).some(option=>option.type==='option'&&option.props.value===value));assert.ok(found,`select for ${value}`);return found;};
 return{...h,calls,view,job,busyChanges,select,get changed(){return changed;},async start(){h.render();await settle();h.render();},
  prompt(){const found=nodes(h.render()).find(node=>node.type==='textarea'&&node.props.maxLength===4000);assert.ok(found,'editable image request');return found;},
  checkbox(){const found=nodes(h.render()).find(node=>node.type==='input'&&node.props.type==='checkbox');assert.ok(found,'paid confirmation');return found;},
  button(label){const found=nodes(h.render()).find(node=>node.type==='button'&&text(node)===label);assert.ok(found,label);return found;}
 };
}

test('translation handoff selects the exact source and resets approval without making a request',async()=>{
 const h=panelHarness();try{await h.start();h.select('translate').props.onChange({target:{value:'cleanup'}});h.checkbox().props.onChange({target:{checked:true}});
  const userPrompt='  직접 입력한 요청\n중국어→한국어 번역: 사용자가 직접 쓴 지침  \n';h.prompt().props.onChange({target:{value:userPrompt}});
  assert.equal(h.checkbox().props.checked,true);h.update({translationTarget:{sourceKey:panelKeys[1],sequence:1}});
  assert.equal(h.select(panelKeys[1]).props.value,panelKeys[1]);assert.equal(h.select('translate').props.value,'translate');assert.equal(h.checkbox().props.checked,false);assert.equal(h.prompt().props.value,userPrompt,'language-less handoff leaves the full prompt verbatim');
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].init.method,undefined);assert.equal(h.calls[0].init.cache,'no-store');assert.equal(h.changed,0);
  assert.deepEqual(h.domActions.map(item=>item.action),['scroll','focus']);
  h.button(prepare).props.onClick();await settle();h.render();assert.equal(h.calls.length,2);
  const body=JSON.parse(h.calls[1].init.body);assert.equal(body.action,'prepare');assert.equal(body.expectedVersion,'v');assert.equal(body.sourceKey,panelKeys[1]);assert.equal(body.purpose,'translate');assert.equal(body.prompt,userPrompt);assert.equal(body.sourceLanguage,undefined,'language instructions use the existing prompt contract');
  assert.equal(h.calls.some(call=>call.init?.method==='PATCH'||call.init?.method==='DELETE'),false);assert.equal(h.calls.filter(call=>call.init?.method==='POST').length,1);assert.equal(h.changed,0);
 }finally{h.close();}
});

test('translation targets reject nonmember keys and accept a new sequence for the same image',async()=>{
 const h=panelHarness();try{await h.start();h.select('translate').props.onChange({target:{value:'thumbnail'}});h.checkbox().props.onChange({target:{checked:true}});
  h.update({translationTarget:{sourceKey:'other-owner/private.png',sequence:1}});assert.equal(h.select(panelKeys[0]).props.value,panelKeys[0]);assert.equal(h.select('translate').props.value,'thumbnail');assert.equal(h.checkbox().props.checked,true);assert.equal(h.domActions.length,0);
  h.update({translationTarget:{sourceKey:panelKeys[1],sequence:2}});assert.equal(h.select(panelKeys[1]).props.value,panelKeys[1]);
  h.select('translate').props.onChange({target:{value:'cleanup'}});h.checkbox().props.onChange({target:{checked:true}});
  h.update({translationTarget:{sourceKey:panelKeys[1],sequence:3}});assert.equal(h.select('translate').props.value,'translate');assert.equal(h.checkbox().props.checked,false);assert.equal(h.domActions.length,4);assert.equal(h.calls.length,1);
 }finally{h.close();}
});

for(const [sourceLanguage,language]of [['zh','중국어'],['en','영어']])test(`${language} shortcut preserves user input and sends its editable instruction only on manual prepare`,async()=>{
 const h=panelHarness();try{await h.start();const original='  직접 요청: 상품 표면 인쇄와 원본 배치를 유지해주세요.\n수량 １２개 · A-123 · 20 cm\n';
  h.prompt().props.onChange({target:{value:original}});h.select('translate').props.onChange({target:{value:'thumbnail'}});h.checkbox().props.onChange({target:{checked:true}});
  h.update({translationTarget:{sourceKey:panelKeys[1],sourceLanguage,sequence:1}});
  const prompt=h.prompt().props.value;assert.equal(prompt.startsWith(original),true,'existing whitespace and Unicode text stay verbatim');
  const instruction=prompt.slice(original.length).trim();assert.ok(instruction.startsWith(`${language}→한국어 번역:`));assert.match(instruction,/한국어/);assert.match(instruction,/원문|보존/);assert.equal(prompt.split(`${language}→한국어 번역:`).length-1,1);
  assert.equal(h.select(panelKeys[1]).props.value,panelKeys[1]);assert.equal(h.select('translate').props.value,'translate');assert.equal(h.checkbox().props.checked,false);assert.equal(h.calls.length,1,'shortcut does not prepare, approve or execute');
  h.button(prepare).props.onClick();await settle();h.render();const body=JSON.parse(h.calls[1].init.body);
  assert.equal(body.action,'prepare');assert.equal(body.sourceKey,panelKeys[1]);assert.equal(body.purpose,'translate');assert.equal(body.prompt,prompt);assert.equal(body.sourceLanguage,undefined);assert.equal(h.changed,0);
  assert.deepEqual(h.calls.filter(call=>call.init?.method==='POST').map(call=>JSON.parse(call.init.body).action),['prepare']);
 }finally{h.close();}
});

test('switching untouched language shortcuts replaces the prior directive without conflicting or duplicate instructions',async()=>{
 const h=panelHarness();try{await h.start();const original='  요청자가 쓴 모든 문구\n로고와 치수를 보존해주세요.  ';
  h.prompt().props.onChange({target:{value:original}});h.update({translationTarget:{sourceKey:panelKeys[1],sourceLanguage:'zh',sequence:1}});
  assert.equal(h.prompt().props.value.startsWith(original),true);assert.match(h.prompt().props.value,/중국어→한국어 번역:/);
  h.checkbox().props.onChange({target:{checked:true}});h.update({translationTarget:{sourceKey:panelKeys[0],sourceLanguage:'en',sequence:2}});
  const english=h.prompt().props.value;assert.equal(english.startsWith(original),true);assert.doesNotMatch(english,/중국어→한국어 번역:/);assert.equal(english.split('영어→한국어 번역:').length-1,1);assert.equal(h.checkbox().props.checked,false);
  h.update({translationTarget:{sourceKey:panelKeys[0],sourceLanguage:'en',sequence:3}});assert.equal(h.prompt().props.value,english,'repeating the same language does not grow the prompt');
  assert.equal(h.calls.length,1);h.button(prepare).props.onClick();await settle();assert.equal(JSON.parse(h.calls[1].init.body).prompt,english);assert.equal(JSON.parse(h.calls[1].init.body).sourceKey,panelKeys[0]);
 }finally{h.close();}
});

test('a user-edited shortcut directive survives language switching verbatim',async()=>{
 const h=panelHarness();try{await h.start();const original='원문 그림과 단위를 보존해주세요.\n';
  h.prompt().props.onChange({target:{value:original}});h.update({translationTarget:{sourceKey:panelKeys[1],sourceLanguage:'zh',sequence:1}});
  const edited=h.prompt().props.value.replace('중국어→한국어 번역:','중국어→한국어 번역: [직접 수정한 조건]');assert.notEqual(edited,h.prompt().props.value);
  h.prompt().props.onChange({target:{value:edited}});h.update({translationTarget:{sourceKey:panelKeys[0],sourceLanguage:'en',sequence:2}});
  const english=h.prompt().props.value;assert.equal(english.startsWith(edited),true,'manual changes to the previous directive are never removed');assert.equal(english.split('영어→한국어 번역:').length-1,1);assert.equal(h.calls.length,1);
  h.update({translationTarget:{sourceKey:panelKeys[1],sequence:3}});assert.equal(h.prompt().props.value,english,'a language-less target preserves the edited prompt and both instructions');
  h.button(prepare).props.onClick();await settle();assert.equal(JSON.parse(h.calls[1].init.body).prompt,english);assert.equal(h.changed,0);
 }finally{h.close();}
});

test('an overflowing language instruction rejects the complete handoff without truncating user input or making a request',async()=>{
 const h=panelHarness();try{await h.start();const original='가'.repeat(4000);h.prompt().props.onChange({target:{value:original}});
  h.select(panelKeys[2]).props.onChange({target:{value:panelKeys[2]}});h.select('translate').props.onChange({target:{value:'cleanup'}});h.checkbox().props.onChange({target:{checked:true}});
  h.update({translationTarget:{sourceKey:panelKeys[1],sourceLanguage:'zh',sequence:1}});
  assert.equal(h.prompt().props.value,original);assert.equal(h.select(panelKeys[2]).props.value,panelKeys[2]);assert.equal(h.select('translate').props.value,'cleanup');assert.equal(h.checkbox().props.checked,true);
  const errors=nodes(h.render()).filter(node=>node.props?.role==='alert').map(text).join(' ');assert.match(errors,/길|초과/);assert.match(errors,/요청|문구|입력/);
  assert.equal(h.calls.length,1);assert.equal(h.domActions.length,0);assert.equal(h.changed,0);
  const shortened='사용자 축약 요청';h.prompt().props.onChange({target:{value:shortened}});h.update({translationTarget:{sourceKey:panelKeys[1],sourceLanguage:'zh',sequence:2}});
  const prompt=h.prompt().props.value;assert.equal(prompt.startsWith(shortened),true);assert.match(prompt,/중국어→한국어 번역:/);assert.ok(prompt.length<=4000);assert.equal(h.select(panelKeys[1]).props.value,panelKeys[1]);assert.equal(h.calls.length,1);
  assert.equal(nodes(h.render()).some(node=>node.props?.role==='alert'),false,'a successful shorter retry clears the length error');
  h.button(prepare).props.onClick();await settle();assert.equal(JSON.parse(h.calls[1].init.body).prompt,prompt);assert.deepEqual(h.calls.filter(call=>call.init?.method==='POST').map(call=>JSON.parse(call.init.body).action),['prepare']);
 }finally{h.close();}
});

test('active image requests report busy and discard translation targets without a deferred paid call',async()=>{
 const pending=deferred(),h=panelHarness(()=>pending.promise);
 try{await h.start();assert.deepEqual(h.busyChanges,[true,false]);h.select('translate').props.onChange({target:{value:'thumbnail'}});
  h.button(prepare).props.onClick();h.update({translationTarget:{sourceKey:panelKeys[1],sourceLanguage:'zh',sequence:1}});
  assert.equal(h.select(panelKeys[0]).props.value,panelKeys[0]);assert.equal(h.select('translate').props.value,'thumbnail');assert.equal(h.prompt().props.value,'');assert.equal(h.button(refresh).props.disabled,true);assert.equal(h.busyChanges.at(-1),true);assert.equal(h.domActions.length,0);
  pending.resolve(Response.json({job:h.job}));await settle();h.render();assert.equal(h.busyChanges.at(-1),false);
  assert.equal(h.select(panelKeys[0]).props.value,panelKeys[0]);assert.equal(h.select('translate').props.value,'thumbnail');assert.equal(h.prompt().props.value,'');assert.equal(h.calls.length,2,'a discarded target cannot run later');
  h.update({translationTarget:{sourceKey:panelKeys[1],sequence:2}});assert.equal(h.select(panelKeys[1]).props.value,panelKeys[1]);assert.equal(h.select('translate').props.value,'translate');assert.equal(h.calls.length,2);
  assert.deepEqual(h.calls.filter(call=>call.init?.method==='POST').map(call=>JSON.parse(call.init.body).action),['prepare']);assert.equal(h.changed,0);
  h.close();assert.equal(h.busyChanges.at(-1),false);
 }finally{h.close();}
});

test('a persisted running image job keeps external actions busy and ignores translation handoff',async()=>{
 const h=panelHarness(undefined,{},'running');try{await h.start();assert.equal(h.busyChanges.at(-1),true);
  h.select('translate').props.onChange({target:{value:'cleanup'}});h.update({translationTarget:{sourceKey:panelKeys[1],sourceLanguage:'en',sequence:1}});
  assert.equal(h.select(panelKeys[0]).props.value,panelKeys[0]);assert.equal(h.select('translate').props.value,'cleanup');assert.equal(h.prompt().props.value,'');assert.equal(h.domActions.length,0);assert.equal(h.calls.length,1);assert.equal(h.changed,0);
  h.close();assert.equal(h.busyChanges.at(-1),false);
 }finally{h.close();}
});
