import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {pathToFileURL} from 'node:url';

const fixturePath='tests/option-image-editor.test.mjs',fixtureURL=pathToFileURL(process.cwd()+'/'+fixturePath),fixtureText=fs.readFileSync(fixtureURL,'utf8');
const ast=ts.createSourceFile(fixturePath,fixtureText,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let source=ast.statements.filter(node=>ts.isImportDeclaration(node)||ts.isVariableStatement(node)||ts.isFunctionDeclaration(node)&&['fixture','imageUI','dragTransfer','dragEvent'].includes(node.name?.text)).map(node=>{
 let value=node.getFullText(ast);if(ts.isImportDeclaration(node)){const name=node.moduleSpecifier.text;if(!name.startsWith('node:'))value=value.replace("'"+name+"'",JSON.stringify(name.startsWith('.')?new URL(name,fixtureURL).href:import.meta.resolve(name)));}return value;
}).join('\n').replaceAll('import.meta.url',JSON.stringify(fixtureURL.href));
source=source.replace('confirmImage=()=>true,onTranslate,onEdit}={})','confirmImage=()=>true,onTranslate,onEdit,onProcess,sidebarActions,uploadControl,additionalDraft=false,draftAuthority,onDraftEdit,onDraftReady}={})').replace('disabled,onTranslate,onEdit,onSaved(){','disabled,onTranslate,onEdit,onProcess,sidebarActions,uploadControl,additionalDraft,draftAuthority,onDraftEdit,onDraftReady,onSaved(){');
source=source.replace('saveMode(value){saveOnChange=value;render();}', 'authority(value){draftAuthority=value;render();},saveMode(value){saveOnChange=value;render();}');
source=source.replaceAll('(type,props)=>({type,props})','(type,props,key)=>({type,props,key})');
source+='\nexport {fixture,imageUI,nodes,text,deferred,plain};';
const {fixture,imageUI,nodes,text,plain}=await import('data:text/javascript,'+encodeURIComponent(source));
const writes=h=>h.calls.filter(call=>call.init?.method&&call.init.method!=='GET');

test('explicit additional draft keeps gallery usable through add order remove and restore until one Save',async()=>{
 const f=fixture(),before=plain(f.view),h=imageUI(f.reply,{additionalDraft:true});
 try{
  await h.idle();await h.click('추가 이미지 후보 3 추가');await h.click('추가 이미지 후보 4 추가');
  await h.click('추가 이미지 3 위로 이동');await h.click('추가 이미지 1 선택 제거');
  assert.deepEqual(h.ordered(),[f.keys[3],f.keys[2]]);assert.equal(writes(h).length,0);assert.deepEqual(plain(f.view),before);
  await h.click('선택 옵션 이미지 저장');assert.equal(writes(h).length,1);
  assert.equal(f.view.overrides.options.red.additionalImages,[f.keys[3],f.keys[2]].join('\n'));
  assert.equal(f.view.overrides.options.red['wire-additionalImages'],[f.keys[3],f.keys[2]].join('\n'));
 }finally{h.close();}
});

const {freeImageReanchorFixture}=await import('./helpers/free-image-reanchor-api.mjs');
const {schemaCompanies}=await import('./helpers/hub-schema.mjs');
for(const company of schemaCompanies)test(`owned unsaved additional pool edit preserves native and quotation fields and reopens its full document: ${company.code}`,async()=>{
 const f=await freeImageReanchorFixture(company);try{
  const route=f.h.load('app/api/products/[id]/image-text/route.ts'),before=await f.read();
  const open=(key,editor)=>route.GET(new Request('https://app.test'+f.base+'/image-text?'+new URLSearchParams({target:'additional-draft',role:'additional',sourceKey:key,optionId:f.selected,profileId:f.profile.id,...(editor?{editor}:{} )})),{params:Promise.resolve({id:f.id})});
  const original=await open(f.keys[8]);assert.equal(original.status,200,await original.clone().text());const {source}=await original.json();
  assert.equal(source.quotationTarget,undefined);assert.equal(source.additionalDraftTarget.kind,'additional-draft');
  const content=plain(await f.h.load('db/product-content.ts').readProductContent('owner',f.id)),document=f.doc();
  const response=await f.applyEdit(source,document,f.png(90));assert.equal(response.status,200,await response.clone().text());const saved=await response.json();
  const after=await f.read();assert.deepEqual(after.overrides,before.overrides);assert.equal(after.revision,before.revision);assert.deepEqual(after.resolved,before.resolved);assert.deepEqual(after.automatic,before.automatic);
  assert.deepEqual(plain(await f.h.load('db/product-content.ts').readProductContent('owner',f.id)),content);assert.deepEqual(after.imageKeys,[...before.imageKeys,saved.key]);
  const reopened=await open(saved.key,'saved-current-pool-v1');assert.equal(reopened.status,200,await reopened.clone().text());assert.deepEqual((await reopened.json()).editDocument,document);
  await f.saveImages([{input:'additionalImages',value:[f.keys[0],saved.key].join('\n')}]);
  const final=await f.open(saved.key);assert.equal(final.status,200,await final.clone().text());assert.deepEqual((await final.json()).editDocument,document);
 }finally{f.close();}
});

test('own additional draft exclusion keeps nested unknown work and hidden sibling drafts blocking',async()=>{
 const {Window}=await import('happy-dom'),window=new Window(),root=window.document.createElement('div');
 root.innerHTML='<section data-additional-draft="owned" data-workspace-dirty="true"><section data-free-image-editor data-workspace-dirty="true"></section></section><section hidden></section>';
 const h=imageUI(fixture().reply),guard=h.load('app/workspace-close.ts').workspaceAdditionalDraftWriteState,owner=root.firstElementChild,producer=owner.firstElementChild;
 try{
  assert.equal(typeof guard,'function');assert.equal(guard(root,owner,producer).dirty,false);
  const nested=window.document.createElement('div');nested.dataset.workspaceSaving='true';producer.append(nested);assert.equal(guard(root,owner,producer).busy,true);nested.remove();
  root.lastElementChild.dataset.workspaceDirty='true';assert.equal(guard(root,owner,producer).dirty,true);delete root.lastElementChild.dataset.workspaceDirty;
  assert.equal(guard(root,window.document.createElement('div'),producer).dirty,true);
 }finally{h.close();window.happyDOM.abort();}
});

const {manualPanelFixture}=await import('./helpers/option-detail-manual-edit.mjs');
test('actual manual editor delivers an unsaved candidate into the retained draft; lost final Save ACK recovers with one PUT',async()=>{
 const f=await freeImageReanchorFixture(schemaCompanies[0]),requests=[];let capture,slot,lose=true,panel;
 const transport=async(url,init={})=>{
  const method=init.method??'GET';requests.push({url,method});
  if(url.includes('/image-text'))return f.h.load('app/api/products/[id]/image-text/route.ts')[method](new Request('https://app.test'+url,init),{params:Promise.resolve({id:f.id})});
  const response=await f.h.route(url,{method,...(init.body?{body:JSON.parse(init.body)}:{})});
  if(method==='PUT'&&lose){lose=false;assert.equal(response.status,200);throw Error('LOCAL final Save ACK lost');}return response;
 };
 const before=await f.read(),native=plain(await f.h.load('db/product-content.ts').readProductContent('owner',f.id));
 const h=imageUI(transport,{productId:f.id,optionId:f.selected,version:before.productVersion,profileId:f.profile.id,additionalDraft:true,onDraftEdit(_key,index,_lang,_manual,value){capture=value;slot=index;}});
 try{
  await h.idle();const candidate=f.keys[8];await h.click(`추가 이미지 후보 ${before.imageKeys.indexOf(candidate)+1} 추가`);
  const index=h.ordered().indexOf(candidate);assert.ok(index>=0);await h.click(`추가 이미지 ${index+1} 크게 보기`);await h.click(`추가 이미지 ${index+1} 편집하기`);assert.ok(capture);assert.equal(capture.keys[slot],candidate);
  const client=f.h.load('app/free-image-translation-client.ts');assert.equal(capture.current(),true,'capture current before panel');
  panel=manualPanelFixture({productId:f.id,version:before.productVersion,imageKeys:before.imageKeys,translationTarget:{sourceKey:candidate,role:'additional',sequence:1,intent:'manual',additionalDraft:{capture,index:slot}}},{reviewFetch:transport,FreeImageApplyError:client.FreeImageApplyError});
  panel.setSource(async(image,signal,options)=>({...await client.readFreeImageSourceProof(f.id,image.source.productVersion,image.source.sourceKey,'additional',signal,transport,undefined,options),width:3,height:2,canvas:{},blob:new Blob([f.png()])}));
  panel.setRender(async(image,regions)=>({source:image.source,width:3,height:2,output:new Blob([f.png(91)],{type:'image/png'}),editDocument:{format:'free-image-edit-v1',width:3,height:2,sourceLanguage:'zh',regions:plain(regions)}}));
  panel.setApply((image,signal)=>client.applyFreeImageTranslation(image,signal,transport));
  await panel.settle();{const deadline=Date.now()+10000;while(panel.render().props['data-workspace-saving']==='true'){assert.ok(Date.now()<deadline,'manual source settles');await panel.settle();}}if(!panel.button('문구 영역 직접 추가')||panel.button('문구 영역 직접 추가').props.disabled){assert.equal(panel.button('원본 불러오기 · 수동 편집').props.disabled,false,JSON.stringify({cap:capture.current(),calls:panel.calls,dirty:panel.render().props['data-workspace-dirty'],busy:panel.render().props['data-workspace-saving']}));await panel.click('원본 불러오기 · 수동 편집');}assert.equal(capture.current(),true,'capture current after panel');assert.equal(panel.field('번역할 원본 이미지').props.value,candidate,JSON.stringify(panel.calls));assert.ok(panel.button('문구 영역 직접 추가')&&!panel.button('문구 영역 직접 추가').props.disabled,text(panel.render()));await panel.click('문구 영역 직접 추가');await panel.change('문구 1 한국어','초안 문구');await panel.click('번역 이미지 미리보기');await panel.click('검토한 번역 이미지 적용');
  {const deadline=Date.now()+10000;while(panel.render().props['data-workspace-saving']==='true'){assert.ok(Date.now()<deadline,'manual save settles');await panel.settle();}}assert.equal(panel.saved,1,text(panel.render()));await h.idle();const pooled=await f.read(),result=h.ordered()[slot];assert.notEqual(result,candidate);assert.equal(result,capture.keys[slot]);assert.deepEqual(pooled.overrides,before.overrides);assert.deepEqual(pooled.resolved,before.resolved);assert.deepEqual(plain(await f.h.load('db/product-content.ts').readProductContent('owner',f.id)),native);assert.equal(requests.filter(r=>r.method==='PUT').length,0);
  const record=JSON.parse(new TextDecoder().decode(f.h.objects.get(result+'.edit.json')));assert.equal(record.document.regions[0].translated,'초안 문구');
  h.source(pooled.productVersion);await h.idle();assert.equal(h.ordered()[slot],result);await h.click('선택 옵션 이미지 저장');assert.equal(requests.filter(r=>r.method==='PUT').length,1);
  await h.click('이미지 저장 결과 확인');assert.equal(requests.filter(r=>r.method==='PUT').length,1);const final=await f.read();assert.equal(final.revision,before.revision+1);
  for(const id of f.target('additionalImages').linked)assert.equal(final.resolved.rows.find(r=>r.optionId===f.selected).fields[id].value.split('\n')[slot],result);
 }finally{panel?.close();h.close();f.close();}
});

test('captured draft rejects option/profile/visibility ABA, newer occurrence edits and unrelated pool advances',async()=>{
 for(const mode of ['option','profile','visibility','authority','newer','foreign-pool']){
  const f=fixture();let tools;const h=imageUI(f.reply,{additionalDraft:true,onDraftReady:value=>{if(value)tools=value;}});
  try{await h.idle();const capture=tools.capture();assert.ok(capture);
   if(mode==='option'){h.select('blue');await h.idle();h.select('red');await h.idle();}
   if(mode==='profile'){h.profile('other');await h.idle();h.profile(undefined);await h.idle();}
   if(mode==='visibility'){h.active(false);h.active(true);}
   if(mode==='authority'){h.authority('different-company');h.authority(undefined);}
   if(mode==='newer')await h.click('추가 이미지 후보 3 추가');
   const after=plain(capture.view);after.productVersion=new Date(Date.parse(after.productVersion)+1).toISOString();after.imageKeys.push('owner/output.png');
   if(mode==='foreign-pool')after.imageKeys.push('owner/unrelated.png');
   assert.equal(capture.accept(after,['owner/output.png'],['owner/output.png']),false,mode);assert.equal(capture.readable(),!['option','profile','authority'].includes(mode),mode);assert.equal(capture.verify(after,['owner/output.png']),['visibility','newer'].includes(mode),mode);assert.equal(writes(h).length,0);
  }finally{h.close();}
 }
});

async function declarationFixture(file,expose,transform=value=>value){
 const url=new URL('./'+file,import.meta.url),raw=transform(fs.readFileSync(url,'utf8')),ast=ts.createSourceFile(file,raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),parts=[];
 for(const statement of ast.statements){
  if(ts.isImportDeclaration(statement)){const name=statement.moduleSpecifier.text;parts.push(statement.getText(ast).replace(statement.moduleSpecifier.getText(ast),JSON.stringify(name.startsWith('.')?new URL(name,url).href:import.meta.resolve(name))));}
  else if(ts.isVariableStatement(statement)||ts.isFunctionDeclaration(statement)||ts.isClassDeclaration(statement))parts.push(statement.getText(ast));else break;
 }
 return import('data:text/javascript,'+encodeURIComponent(parts.join('\n').replaceAll('import.meta.url',JSON.stringify(url.href))+'\nexport {'+expose+'};'));
}
const imagePanelHarness=(await declarationFixture('image-generation-panel-requests.test.mjs','harness')).harness;
const aiFixture=(await declarationFixture('additional-image-ai-apply.test.mjs','fixture',value=>value.replace('{implicitProfile=false}={}','{implicitProfile=false,beforeGeneration}={}').replace("  const model=backend.load('app/automation/image-edit.ts')", "  await beforeGeneration?.({backend,product,view,target,id,profile,base,endpoint});\n  const model=backend.load('app/automation/image-edit.ts')"))).fixture;
for(const company of schemaCompanies)test(`individual AI delivers its complete verified result to dirty draft without a final slot write: ${company.code}`,async()=>{
 let editor,capture;
 const f=await aiFixture(company,{beforeGeneration:async state=>{
  let tools;editor=imageUI((url,init={})=>state.backend.route(url,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})}),{productId:state.product.id,optionId:state.id,version:state.view.productVersion,profileId:state.profile.id,additionalDraft:true,onDraftReady:value=>{if(value)tools=value;}});
  await editor.idle();await editor.click('추가 이미지 1 선택 제거');capture=tools.capture();assert.ok(capture);
 }});
 try{
  const before=plain(f.target.quotationView),native=f.sourceState(),index=capture.keys.indexOf(f.source);assert.ok(index>=0);
  const target={ownerId:'owner',productId:f.product.id,sourceKey:f.source,productVersion:f.target.productVersion,originView:plain(capture.view),capture,index},order=editor.ordered();
  const pooled=await f.helper.applyAdditionalImageDraftAiResult(target,f.completed,f.request,false);await editor.idle();assert.deepEqual(editor.ordered(),order,'preview/cancel keeps the previous selection');
  editor.source(pooled.productVersion);await editor.idle();assert.equal(capture.current(),true,'own proven pool refresh preserves the captured occurrence');
  const panel=imagePanelHarness((url,init)=>f.request(url,init),{initialPending:f.request(f.base+'/image-generation'),initialProps:{productId:f.product.id,version:pooled.productVersion,imageKeys:pooled.imageKeys,draftProcessingTarget:{...target,sequence:1},processingTargetActive:true,processingResultActive:true,beforeSelectedImageApply:()=>true}});
  try{await panel.idle();panel.click('선택 옵션 추가이미지에 적용')();await panel.idle();assert.equal(panel.changed,1);}finally{panel.close();}
  const after=await f.read();
  await editor.idle();assert.equal(editor.ordered()[index],f.key);assert.deepEqual(after.overrides,before.overrides);assert.deepEqual(after.resolved,before.resolved);assert.deepEqual(after.automatic,before.automatic);assert.equal(after.revision,before.revision);assert.equal(f.sourceState(),native);assert.ok(f.calls.every(call=>call.method==='GET'));
  for(const forged of [{...f.completed,result:{...f.completed.result,storageKey:'foreign/result.png'}},{...f.completed,productVersion:new Date(0).toISOString()}])await assert.rejects(()=>f.helper.applyAdditionalImageDraftAiResult({ownerId:'owner',productId:f.product.id,sourceKey:f.source,productVersion:f.target.productVersion,capture,index},forged,f.request));
 }finally{editor?.close();f.close();}
});

for(const committed of [false,true])for(const retired of [false,true])test('R12 batch original recovery committed='+committed+'; retired='+retired,async()=>{
 const f=await freeImageReanchorFixture(schemaCompanies[0]);let tools,batch;const calls=[];
 const transport=async(url,init={})=>{const method=init.method??'GET';calls.push({url,method,action:init.body instanceof FormData?init.body.get('action'):typeof init.body==='string'?JSON.parse(init.body).action:undefined});
  if(!committed&&lose&&init.body instanceof FormData){lose=false;throw Error('LOCAL original apply never reached storage');}
  if(url.includes('/image-text')){const response=await f.h.load('app/api/products/[id]/image-text/route.ts')[method](new Request('https://app.test'+url,init),{params:Promise.resolve({id:f.id})});if(init.body instanceof FormData&&lose){lose=false;assert.equal(response.status,200);throw Error('LOCAL image apply ACK lost');}return response;}
  return f.h.route(url,{method,...(init.body?{body:JSON.parse(init.body)}:{})});};let lose=true;
 const before=await f.read(),native=plain(await f.h.load('db/product-content.ts').readProductContent('owner',f.id)),h=imageUI(transport,{productId:f.id,optionId:f.selected,version:before.productVersion,profileId:f.profile.id,additionalDraft:true,onDraftReady:value=>{if(value)tools=value;}});
 try{
  await h.idle();await h.click(`추가 이미지 후보 ${before.imageKeys.indexOf(f.keys[8])+1} 추가`);const capture=tools.capture(),model=f.h.load('app/detail-image-batch.ts'),client=f.h.load('app/free-image-translation-client.ts'),signal=new AbortController().signal;
  const deps={fetcher:transport,readSource:async(id,version,key,role,signal,fetcher,target,options)=>({...await client.readFreeImageSourceProof(id,version,key,role,signal,fetcher,target,options),width:3,height:2,canvas:{},blob:new Blob([f.png()])}),recognize:async()=>[f.doc().regions[0]],translate:async(_source,_lang,rows)=>({regions:rows.map(row=>({...row,original:row.text,translated:'일괄 문구',issue:null})),warnings:[]}),render:async(image,regions)=>({source:image.source,width:3,height:2,output:new Blob([f.png(93)],{type:'image/png'}),editDocument:{format:'free-image-edit-v1',width:3,height:2,sourceLanguage:'zh',regions:plain(regions)}})};
  batch=await model.prepareDetailImageBatch({productId:f.id,optionId:f.selected,profileId:f.profile.id,stage:'additional',view:capture.view,language:'zh',additionalDraft:capture},signal,()=>{},deps);assert.ok(batch.items.every(item=>item.status==='ready'));
  const slot=batch.items.length-1;await assert.rejects(()=>model.applyDetailBatchResult(batch,slot,signal,value=>{batch=value;},deps));assert.equal(batch.items[slot].status,'uncertain');
  if(retired){h.active(false);h.active(true);assert.equal(capture.current(),false);
  }
  if(!committed){const files=f.h.objects.size;if(retired)await assert.rejects(()=>model.recoverDetailBatchResult(batch,signal,value=>{batch=value;},deps));else{batch=await model.recoverDetailBatchResult(batch,signal,value=>{batch=value;},deps);assert.equal(batch.items[slot].status,'ready');}assert.equal(f.h.objects.size,files);assert.equal(calls.filter(call=>call.action==='apply').length,1);assert.deepEqual((await f.read()).imageKeys,before.imageKeys);return;}
  if(retired){
   const original=batch.items[slot].attempt;for(const patch of [{productId:'foreign'},{sourceKey:'owner/foreign.png'},{sourceSha256:'f'.repeat(64)}]){const forged={...batch,items:batch.items.map(item=>item.slotIndex===slot?{...item,attempt:{...original,image:{...original.image,source:{...original.image.source,...patch}}}}:item)};await assert.rejects(()=>model.recoverDetailBatchResult(forged,signal,()=>{},deps));}
  }
  const files=f.h.objects.size;batch=await model.recoverDetailBatchResult(batch,signal,value=>{batch=value;},deps);assert.equal(batch.items[slot].status,'applied');assert.equal(f.h.objects.size,files);assert.equal(calls.filter(call=>call.action==='apply').length,1);assert.equal(calls.filter(call=>call.action==='recover').length,retired?4:1);assert.equal(calls.filter(call=>call.method==='PUT').length,0);
  const after=await f.read();assert.deepEqual(after.overrides,before.overrides);assert.deepEqual(after.resolved,before.resolved);assert.deepEqual(plain(await f.h.load('db/product-content.ts').readProductContent('owner',f.id)),native);await h.idle();assert.equal(h.ordered()[slot],retired?f.keys[8]:batch.items[slot].appliedKey);
 }finally{h.close();f.close();}
});

const {productImageUploadFixture,imageFile}=await import('./helpers/product-image-upload.mjs');
test('pool-only upload component delivers the captured draft after GET recovery without duplicate upload or attachment',async()=>{
 const f=await productImageUploadFixture(),before=await (await f.fetcher(`/api/products/${f.id}/quotation-fields`)).json();let tools;
 const h=imageUI(f.fetcher,{productId:f.id,optionId:before.resolved.rows.find(row=>row.optionId).optionId,version:f.product().updated_at,additionalDraft:true,onDraftReady:value=>{if(value)tools=value;}});let ui,holds=0,confirms=0;
 try{
  await h.idle();const capture=tools.capture();assert.ok(capture);ui=f.ui({additionalDraft:{capture:()=>capture},onBeginSourceWrite(){holds++;return{confirm(){confirms++;}};}});
  let lose=true;f.controls.response=(call,response)=>{if(lose&&call.url.endsWith('/attachments')){lose=false;return Response.json({error:'LOCAL pool attach ACK lost'},{status:503});}return response;};
  await ui.select([imageFile('draft.png')]);await ui.click('업로드 시작 (1)');assert.equal(ui.saved,0);assert.equal(holds,1);assert.equal(confirms,0);const writes=f.calls.filter(call=>call.method==='POST').length;await ui.click('draft.png 저장 결과 확인');assert.equal(ui.saved,1);assert.equal(confirms,1);assert.equal(f.calls.filter(call=>call.method==='POST').length,writes);assert.equal(writes,2);assert.equal(f.protectedSnapshot(),f.before);assert.equal(f.calls.filter(call=>call.method==='PUT').length,0);await h.idle();assert.match(h.ordered().at(-1),/-draft.png$/);const order=h.ordered();h.source(f.product().updated_at);await h.idle();assert.equal(capture.current(),true);
  await ui.select([imageFile('second-draft.png')]);await ui.click('업로드 시작 (1)');await h.idle();assert.deepEqual(h.ordered().slice(0,order.length),order);assert.match(h.ordered().at(-1),/-second-draft.png$/);assert.equal(f.calls.filter(call=>call.method==='POST').length,4);assert.equal(confirms,2);assert.equal(f.protectedSnapshot(),f.before);
 }finally{ui?.close();h.close();f.close();}
});

const commonHarness=(await declarationFixture('content-editor-requests.test.mjs','harness',value=>value.replace('initialize=()=>{}){','initialize=()=>{},extraProps={}){').replace("product:{id:'p',title:'상품',image_keys:'[\"owner/a.png\",\"owner/b.png\",\"owner/c.png\"]',updated_at:productVersion}","product:{id:extraProps.productId??'p',title:'상품',image_keys:JSON.stringify(extraProps.imageKeys??['owner/a.png','owner/b.png','owner/c.png']),updated_at:productVersion}").replace('section,focusedAssetRole,active:stageActive,onSaved()', 'section,...extraProps,focusedAssetRole,active:stageActive,onSaved()'))).harness;
for(const retired of [false,true])test('R12 common retired='+retired+' additional editor keeps pool outputs and other local fields until its explicit native Save',async()=>{
 const f=await freeImageReanchorFixture(schemaCompanies[0]),route=f.h.load('app/api/products/[id]/image-text/route.ts'),calls=[];let tools;
 const readPool=(key)=>route.GET(new Request('https://app.test'+f.base+'/image-text?'+new URLSearchParams({target:'additional-draft',role:'additional',sourceKey:key,profileId:f.profile.id})),{params:Promise.resolve({id:f.id})}).then(async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();});
 const initial=(await readPool(f.keys[8])).source,stored=await f.applyEdit(initial,f.doc(),f.png(94)).then(async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();});
 const before=await f.read(),native=plain(await f.h.load('db/product-content.ts').readProductContent('owner',f.id));
 const transport=(url,init={})=>{calls.push({url,method:init.method??'GET'});return f.h.route(url,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})});};
 const h=commonHarness(transport,'additional',true,()=>{},{productId:f.id,imageKeys:before.imageKeys,additionalDraft:true,profileId:f.profile.id,onDraftReady:value=>{if(value)tools=value;}});
 const settle=async()=>{for(let i=0;i<10;i++){h.render();await h.flush();}};
 try{
  h.setVersion(before.productVersion);await h.start();await settle();assert.ok(tools?.capture());
  const card=nodes(h.render()).find(node=>node.props?.className?.startsWith('image-asset-card')&&nodes(node).some(child=>child.type==='img'&&child.props.src.endsWith(stored.key)));
  assert.ok(card);const choose=nodes(card).find(node=>node.type==='button'&&node.props['aria-pressed']===false);assert.ok(choose);choose.props.onClick();await settle();
  const capture=tools.capture();assert.ok(capture);assert.ok(capture.keys.includes(stored.key));
  const source=(await readPool(stored.key)).source,saved=await f.applyEdit(source,f.doc(),f.png(95)).then(async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();}),after=await f.read(),keys=capture.keys.map(key=>key===stored.key?saved.key:key);
  if(retired){h.setActive(false);await settle();h.setActive(true);await settle();assert.equal(capture.current(),false);assert.equal(capture.readable(),true);assert.equal(capture.verify(after,[saved.key]),true);assert.equal(capture.verify(before,[saved.key]),false);assert.equal(capture.accept(after,keys,[saved.key]),false);assert.equal(calls.filter(call=>call.method==='PATCH').length,0);return;}
  assert.equal(capture.accept(after,keys,[saved.key]),true);h.setVersion(after.productVersion);await settle();assert.ok(tools.capture().keys.includes(saved.key));assert.deepEqual(after.overrides,before.overrides);assert.deepEqual(plain(await f.h.load('db/product-content.ts').readProductContent('owner',f.id)),native);assert.equal(calls.filter(call=>call.method==='PATCH').length,0);
  h.button('이미지 역할·순서 저장').props.onClick();await settle();assert.equal(calls.filter(call=>call.method==='PATCH').length,1);const final=plain(await f.h.load('db/product-content.ts').readProductContent('owner',f.id));assert.deepEqual(final.assets.additional.value,plain(keys));for(const role of Object.keys(native.assets).filter(role=>role!=='additional'))assert.deepEqual(final.assets[role],native.assets[role]);
 }finally{h.unmount();f.close();}
});

test('pool sources reject foreign membership, malformed proof, stale source and company drift before adopting anything',async()=>{
 for(const company of schemaCompanies){
  const f=await freeImageReanchorFixture(company);try{
   const route=f.h.load('app/api/products/[id]/image-text/route.ts'),get=(key)=>route.GET(new Request('https://app.test'+f.base+'/image-text?'+new URLSearchParams({target:'additional-draft',role:'additional',sourceKey:key,optionId:f.selected,profileId:f.profile.id})),{params:Promise.resolve({id:f.id})});
   for(const key of ['someone/foreign.png','owner/not-in-this-product.png'])assert.equal((await get(key)).status,404);
   const response=await get(f.keys[8]);assert.equal(response.status,200);const {source}=await response.json(),before=f.snapshot(),files=[...f.h.objects.keys()];
   for(const proof of [{...source,productVersion:new Date(0).toISOString()},{...source,sourceSha256:'f'.repeat(64)},{...source,additionalDraftTarget:{...source.additionalDraftTarget,revision:source.additionalDraftTarget.revision+1}},{...source,additionalDraftTarget:{...source.additionalDraftTarget,profileId:123}}]){
    assert.ok([400,409].includes((await f.applyEdit(proof,f.doc())).status));assert.equal(f.snapshot(),before);assert.deepEqual([...f.h.objects.keys()],files);
   }
   f.h.setCompany(schemaCompanies.find(other=>other.code!==company.code));assert.equal((await f.applyEdit(source,f.doc())).status,409);assert.equal(f.snapshot(),before);assert.deepEqual([...f.h.objects.keys()],files);
  }finally{f.close();}
 }
});

test('a proven upload before an unknown later attachment preserves its hold through an unchanged recovery read',async()=>{
 const f=await productImageUploadFixture(),before=await (await f.fetcher('/api/products/'+f.id+'/quotation-fields')).json();let tools,holds=0,confirms=0,ui;
 const h=imageUI(f.fetcher,{productId:f.id,optionId:before.resolved.rows.find(row=>row.optionId).optionId,version:f.product().updated_at,additionalDraft:true,onDraftReady:value=>{if(value)tools=value;}});
 try{
  await h.idle();const capture=tools.capture();ui=f.ui({additionalDraft:{capture:()=>capture},onBeginSourceWrite(){holds++;return{confirm(){confirms++;}};}});
  let fail=true;f.controls.before=call=>{if(fail&&call.url.endsWith('/attachments')&&call.body?.key.endsWith('-second.png')){fail=false;throw Error('LOCAL second attachment sent without acknowledgment');}};
  await ui.select([imageFile('first.png'),imageFile('second.png')]);await ui.click('업로드 시작 (2)');
  assert.equal(holds,1);assert.equal(confirms,0,'a different unconfirmed item retains the producer hold');await h.idle();assert.match(h.ordered().at(-1),/-first.png$/);
  h.source(f.product().updated_at);await h.idle();await ui.click('second.png 저장 결과 확인');assert.equal(confirms,0,'an unchanged read is not positive acknowledgment');
  await ui.click('저장된 파일 연결');assert.equal(confirms,1);assert.equal(f.calls.filter(call=>call.url==='/api/files'&&call.method==='POST').length,2);assert.equal(f.protectedSnapshot(),f.before);
 }finally{ui?.close();h.close();f.close();}
});

const batchPanelHarness=(await declarationFixture('detail-image-batch-panel.test.mjs','ui',value=>value.replace('{exports,Error,AbortController,Blob,URL,require','{exports,Error,AbortController,Blob,URL,fetch:async()=>Response.json({}),require').replace('return{render,calls,busy,button,control,','return{helpers,view,render,calls,busy,button,control,'))).ui;
test('batch draft hold survives an unchanged recovery of a later item after a proven earlier result',async()=>{
 const h=batchPanelHarness({stage:'additional'});let confirms=0;
 const capture={view:h.view,keys:['owner/a.png','owner/b.png','owner/c.png'],target:{profileId:'cat',optionId:'red'},current:()=>true,root:()=>null};
 const apply=h.helpers.applyDetailBatchResult;
 h.helpers.applyDetailBatchResult=async(batch,index,signal,progress,deps)=>{
  await deps.fetcher('/local-fixture-only',{method:'POST'});
  if(index===1){const value={...batch,items:batch.items.map(item=>item.slotIndex===index?{...item,status:'uncertain'}:item)};progress(value);throw Error('LOCAL unknown second image');}
  return apply(batch,index,signal,progress);
 };
 h.helpers.recoverDetailBatchResult=async batch=>({...batch,items:batch.items.map(item=>item.status==='uncertain'?{...item,status:'ready'}:item)});
 h.update({additionalDraft:{capture:()=>capture},onBeginSourceWrite(){return{confirm(){confirms++;}};}});
 try{
  await h.start();await h.click('모든 이미지 일괄 처리');h.review(0);h.review(1);await h.click('검토한 추가 이미지 2개 적용');assert.equal(confirms,0);
  await h.click('같은 이미지 저장 상태 확인');assert.equal(confirms,0,'unchanged later item cannot confirm the shared source hold');
 }finally{h.close();}
});

for(const mode of ['quotation','role'])test('additional pool reopening preserves an existing '+mode+' full edit document',async()=>{
 const f=await freeImageReanchorFixture(schemaCompanies[0]);try{
  const route=f.h.load('app/api/products/[id]/image-text/route.ts');
  if(mode==='role'){const db=f.h.load('db/product-content.ts'),content=await db.readProductContent('owner',f.id);await db.saveProductContent('owner',f.h.load('app/product-content.ts').applyContentPatch(content,{assets:{additional:[f.keys[2]]}},new Date().toISOString()),content.revision);}
  const original=mode==='quotation'?await f.source():await route.GET(new Request('https://app.test'+f.base+'/image-text?'+new URLSearchParams({sourceKey:f.keys[2],role:'additional'})),{params:Promise.resolve({id:f.id})});
  assert.equal(original.status,200,await original.clone().text());const {source}=await original.json(),doc=f.doc(),saved=await f.applyEdit(source,doc,f.png(96)).then(async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();});
  const before=f.snapshot(),record=f.h.objects.get(saved.key+'.edit.json').slice(),opened=await route.GET(new Request('https://app.test'+f.base+'/image-text?'+new URLSearchParams({target:'additional-draft',role:'additional',sourceKey:saved.key,optionId:f.selected,profileId:f.profile.id,editor:'saved-current-pool-v1'})),{params:Promise.resolve({id:f.id})});
  assert.equal(opened.status,200,await opened.clone().text());const body=await opened.json();assert.deepEqual(body.editDocument,doc);assert.equal(body.source.quotationTarget,undefined);assert.equal(body.source.additionalDraftTarget.kind,'additional-draft');assert.equal(body.source.editorSource.anchorPolicy,'current-pool-v1');assert.equal(f.snapshot(),before);assert.deepEqual(f.h.objects.get(saved.key+'.edit.json'),record);
 }finally{f.close();}
});

test('buffered clear and common reset remain local and preserve explicit blanks and sibling/manual fields on one Save',async()=>{
 const f=fixture();f.reply('',{method:'PUT',body:JSON.stringify({expectedRevision:f.view.revision,changes:['additionalImages','wire-additionalImages'].map(fieldKey=>({optionId:'red',fieldKey,value:[f.keys[2],f.keys[0]].join('\n')}))})});
 const before=plain(f.view),h=imageUI(f.reply,{version:f.view.productVersion,additionalDraft:true});
 try{
  await h.idle();await h.click('추가 이미지 선택 비우기');assert.deepEqual(h.ordered(),[]);assert.equal(writes(h).length,0);assert.deepEqual(plain(f.view),before);
  await h.click('추가 이미지 공통·자동값 복원');assert.deepEqual(h.ordered(),[f.keys[1]]);assert.equal(writes(h).length,0);assert.deepEqual(plain(f.view),before);
  await h.click('선택 옵션 이미지 저장');assert.equal(writes(h).length,1);assert.equal(f.view.revision,before.revision+1);assert.equal(Object.hasOwn(f.view.overrides.options.red,'additionalImages'),false);assert.equal(Object.hasOwn(f.view.overrides.options.red,'wire-additionalImages'),false);assert.deepEqual(f.view.overrides.common,before.overrides.common);assert.deepEqual(f.view.overrides.options.blue,before.overrides.options.blue);assert.equal(f.view.overrides.options.red.unrelated,'보존');
 }finally{h.close();}
});


for(const lostAttachmentAck of [false,true])test('ADS-001 retains read-only draft delivery after '+(lostAttachmentAck?'attachment recovery':'normal attachment')+' quotation read failure',async()=>{
 const f=await productImageUploadFixture(),before=await (await f.fetcher('/api/products/'+f.id+'/quotation-fields')).json();let tools,ui,holds=0,confirms=0,failed=false,attached=false;
 const h=imageUI(f.fetcher,{productId:f.id,optionId:before.resolved.rows.find(row=>row.optionId).optionId,version:f.product().updated_at,additionalDraft:true,onDraftReady:value=>{if(value)tools=value;}});
 try{
  await h.idle();const capture=tools.capture();assert.ok(capture);ui=f.ui({additionalDraft:{capture:()=>capture},onBeginSourceWrite(){holds++;return{confirm(){confirms++;}};}});
  f.controls.response=(call,response)=>{if(call.url.endsWith('/attachments')){attached=true;if(lostAttachmentAck)return Response.json({error:'LOCAL attachment ACK lost'},{status:503});}if(attached&&call.url.endsWith('/quotation-fields')&&!failed){failed=true;throw Error('LOCAL quotation delivery read lost');}return response;};
  await ui.select([imageFile('delivery.png')]);await ui.click('업로드 시작 (1)');if(lostAttachmentAck)await ui.click('delivery.png 저장 결과 확인');
  assert.equal(ui.saved,0);assert.equal(holds,1);assert.equal(confirms,0);assert.equal(ui.render().props['data-workspace-dirty'],true,'attached but undelivered images stay pending');
  assert.equal(f.calls.filter(call=>call.method==='POST'&&call.url==='/api/files').length,1);assert.equal(f.calls.filter(call=>call.method==='POST'&&call.url.endsWith('/attachments')).length,1);assert.equal(f.protectedSnapshot(),f.before);
  ui.render({additionalDraft:{capture(){assert.fail('read retry must retain the original delivery capture');}}});const start=f.calls.length;
  await ui.click('추가 이미지 초안 연결 결과 다시 확인');assert.ok(f.calls.slice(start).every(call=>call.method==='GET'),'delivery retry must only read');
  assert.equal(ui.saved,1);assert.equal(confirms,1);assert.equal(holds,1);assert.equal(ui.render().props['data-workspace-dirty'],false);assert.equal(f.calls.filter(call=>call.method==='POST').length,2);assert.equal(f.protectedSnapshot(),f.before);
  await h.idle();assert.match(h.ordered().at(-1),/-delivery.png$/);const after=await (await f.fetcher('/api/products/'+f.id+'/quotation-fields')).json();assert.deepEqual(after.overrides,before.overrides);assert.deepEqual(after.resolved,before.resolved);assert.deepEqual(after.automatic,before.automatic);
 }finally{ui?.close();h.close();f.close();}
});

for(const action of ['execute','attach'])for(const blocker of ['other-dirty','nested-unknown'])test('ADS-002 blocks draft '+action+' before dispatch for '+blocker,async()=>{
 const {Window}=await import('happy-dom'),window=new Window(),root=window.document.createElement('div');root.innerHTML='<section data-additional-draft data-workspace-dirty="true"></section><section></section>';
 const owner=root.firstElementChild,marker=window.document.createElement('div');(blocker==='other-dirty'?root.lastElementChild:owner).append(marker);marker.dataset.workspaceDirty='true';if(blocker==='nested-unknown')marker.dataset.workspaceSaving='true';
 const guardUI=imageUI(fixture().reply),guard=guardUI.load('app/workspace-close.ts').workspaceAdditionalDraftWriteState,capture={current:()=>true,keys:['owner/raw'],root:()=>owner,view:{},target:{}};
 let resolve,guardCalls=0,holds=0;const pending=new Promise(done=>{resolve=done;});
 const h=imagePanelHarness(async()=>Response.json({error:'LOCAL stopped before provider/storage'},{status:503}),{status:action==='execute'?'approved':'completed',attached:action!=='attach',initialPending:pending,initialProps:{draftProcessingTarget:{capture,index:0,sourceKey:'owner/raw',productVersion:'v',ownerId:'owner',originView:{},sequence:1},processingTargetActive:true,processingResultActive:true,beforeSelectedImageApply(actualOwner,producer){guardCalls++;assert.equal(actualOwner,owner);const state=guard(root,actualOwner,producer);return !state.busy&&!state.dirty;},onBeginSourceWrite(){holds++;return{confirm(){assert.fail('a rejected/unknown write cannot confirm');}};}}});
 try{
  h.job.review.purpose='cleanup';resolve(Response.json(h.view));await h.idle();const invoke=h.click(action==='execute'?'승인한 이미지 1장 가공 · 비용 발생':'생성된 결과를 현재 상품에 추가 · 무료');invoke();await h.idle();
  assert.ok(guardCalls>0);assert.equal(h.calls.length,0,'dirty/busy guard must precede execute/attach POST');assert.equal(holds,0);
  marker.remove();invoke();await h.idle();assert.equal(h.calls.length,1,'same current target can dispatch after its blocker is removed');assert.equal(JSON.parse(h.calls[0].init.body).action,action);assert.equal(holds,1);
 }finally{h.close();guardUI.close();window.happyDOM.abort();}
});

for(const retired of [false,true])for(const failure of ['ack','network','json'])for(const driftCompany of [false,true])test('R12 manual '+failure+' original recovery retired='+retired+(driftCompany?' with actor guard':''),async()=>{
 const company=schemaCompanies[0],f=await freeImageReanchorFixture(company),before=await f.read(),requests=[];let tools,panel,lose=true,originalImage,holds=0,confirms=0,deliveries=0;
 const transport=async(url,init={})=>{const method=init.method??'GET',action=init.body instanceof FormData?init.body.get('action'):typeof init.body==='string'?JSON.parse(init.body).action:undefined;requests.push({url,method,action,body:init.body});
  if(url.includes('/image-text')){const response=await f.h.load('app/api/products/[id]/image-text/route.ts')[method](new Request('https://app.test'+url,init),{params:Promise.resolve({id:f.id})});if(action==='apply'&&lose&&failure==='ack'){lose=false;assert.equal(response.status,200,await response.clone().text());throw Error('LOCAL original manual ACK lost');}return response;}
  if(lose&&failure!=='ack'&&url.includes('/quotation-fields')&&requests.some(call=>call.action==='apply')){lose=false;if(failure==='network')throw Error('LOCAL delivery GET rejected');return new Response('invalid-json');}
  return f.h.route(url,{method,...(init.body?{body:JSON.parse(init.body)}:{})});};
 const h=imageUI(transport,{productId:f.id,optionId:f.selected,version:before.productVersion,profileId:f.profile.id,additionalDraft:true,onDraftReady:value=>{if(value)tools=value;}});
 try{
  await h.idle();await h.click('추가 이미지 후보 '+(before.imageKeys.indexOf(f.keys[8])+1)+' 추가');const capture=tools.capture(),index=capture.keys.indexOf(f.keys[8]),accept=capture.accept;capture.accept=(...args)=>{deliveries++;return accept(...args);};
  const client=f.h.load('app/free-image-translation-client.ts');
  panel=manualPanelFixture({productId:f.id,version:before.productVersion,imageKeys:before.imageKeys,translationTarget:{sourceKey:f.keys[8],role:'additional',sequence:1,intent:'manual',additionalDraft:{capture,index}},onBeginSourceWrite(){holds++;return{confirm(){confirms++;}};}},{reviewFetch:transport,FreeImageApplyError:client.FreeImageApplyError,applyFreeImageTranslation(image,signal,fetcher){originalImage=image;return client.applyFreeImageTranslation(image,signal,fetcher);},recoverFreeImageTranslation:(image,signal)=>client.recoverFreeImageTranslation(image,signal,transport)});
  panel.setSource(async(image,signal,options)=>({...await client.readFreeImageSourceProof(f.id,image.source.productVersion,image.source.sourceKey,'additional',signal,transport,undefined,options),width:3,height:2,canvas:{},blob:new Blob([f.png()])}));
  panel.setRender(async(image,regions)=>({source:image.source,width:3,height:2,output:new Blob([f.png(99)],{type:'image/png'}),editDocument:{format:'free-image-edit-v1',width:3,height:2,sourceLanguage:'zh',regions:plain(regions)}}));
  const settle=async()=>{await panel.settle();const deadline=Date.now()+10000;while(panel.render().props['data-workspace-saving']==='true'){assert.ok(Date.now()<deadline);await panel.settle();}};
  await settle();await panel.click('문구 영역 직접 추가');await panel.change('문구 1 한국어','복구할 원래 문구');await panel.click('번역 이미지 미리보기');await panel.click('검토한 번역 이미지 적용');await settle();assert.equal(holds,1);assert.equal(confirms,0);assert.equal(panel.saved,0);
  const files=f.h.objects.size;if(retired){h.active(false);panel.setProps({active:false});h.active(true);panel.setProps({active:true});}await settle();assert.equal(capture.current(),!retired);
  assert.equal(!!panel.button('같은 결과의 저장 상태 다시 확인').props.disabled,false,'retired delivery must not disable original read recovery');
  if(driftCompany){f.h.setCompany(schemaCompanies[1]);await panel.click('같은 결과의 저장 상태 다시 확인');await settle();assert.equal(panel.saved,0);assert.equal(confirms,0);assert.equal(deliveries,0);f.h.setCompany(company);}
  await panel.click('같은 결과의 저장 상태 다시 확인');await settle();assert.equal(panel.saved,1);assert.equal(confirms,1);assert.equal(deliveries,retired?0:1);assert.equal(capture.current(),!retired);await h.idle();assert.equal(h.ordered()[index],retired?f.keys[8]:(await f.read()).imageKeys.at(-1));
  assert.equal(requests.filter(call=>call.action==='apply').length,1);const recovery=requests.filter(call=>call.action==='recover');assert.equal(recovery.length,driftCompany?2:1);for(const call of recovery){assert.equal(call.method,'POST');assert.deepEqual(JSON.parse(call.body).source,plain(originalImage.source));}assert.equal(requests.filter(call=>call.method==='PUT').length,0);assert.equal(f.h.objects.size,files);
  const after=await f.read();assert.deepEqual(after.overrides,before.overrides);assert.deepEqual(after.resolved,before.resolved);assert.equal(accept(after,capture.keys,[after.imageKeys.at(-1)]),false,'read recovery cannot revive ABA delivery');
 }finally{panel?.close();h.close();f.close();}
});


test('ADS-003 retired unapplied recovery cannot retry a write or read under a different profile context',async()=>{
 class UnknownApply extends Error{constructor(){super('LOCAL uncertain original');this.uncertain=true;}}
 let current=true,sent;const capture={current:()=>current,keys:['owner/original.png'],target:{profileId:null,optionId:'red'},root:()=>null};
 const panel=manualPanelFixture({translationTarget:{sourceKey:'owner/original.png',role:'additional',sequence:1,intent:'manual',additionalDraft:{capture,index:0}}},{FreeImageApplyError:UnknownApply});
 try{
  panel.setRender(async(image,regions)=>({source:image.source,width:20,height:12,output:new Blob(['same pending PNG'],{type:'image/png'}),editDocument:{format:'free-image-edit-v1',width:20,height:12,sourceLanguage:'zh',regions}}));
  panel.setApply(async image=>{sent=image;throw new UnknownApply();});panel.setRecover(async image=>{assert.equal(image,sent);return{applied:false};});
  await panel.settle();await panel.click('문구 영역 직접 추가');await panel.change('문구 1 한국어','원래 문구');await panel.click('번역 이미지 미리보기');await panel.click('검토한 번역 이미지 적용');current=false;panel.setProps({active:false});panel.setProps({active:true});await panel.settle();
  panel.setProps({editorProfileId:'different'});await panel.settle();const foreign=panel.button('같은 결과의 저장 상태 다시 확인');assert.equal(foreign.props.disabled,true);foreign.props.onClick();await panel.settle();assert.equal(panel.calls.filter(call=>call.action==='recover').length,0);
  panel.setProps({editorProfileId:undefined});await panel.settle();await panel.click('같은 결과의 저장 상태 다시 확인');assert.equal(panel.calls.filter(call=>call.action==='recover').length,1);assert.equal(panel.calls.filter(call=>call.action==='apply').length,1);assert.equal(panel.saved,0);assert.equal(panel.button('같은 미리보기 다시 적용'),undefined);assert.ok(panel.button('같은 결과의 저장 상태 다시 확인'));
 }finally{panel.close();}
});


for(const retired of [false,true])for(const failRecoveredDelivery of [false,true])test('R12 retired='+retired+' ADS-005 recovers the original committed second attachment while aggregate delivery is pending'+(failRecoveredDelivery?' through another delivery GET failure':''),async()=>{
 const f=await productImageUploadFixture(),before=await (await f.fetcher('/api/products/'+f.id+'/quotation-fields')).json();let tools,ui,holds=0,confirms=0,secondLost=false,recovered=false,deliveryFailed=false;
 const h=imageUI(f.fetcher,{productId:f.id,optionId:before.resolved.rows.find(row=>row.optionId).optionId,version:f.product().updated_at,additionalDraft:true,onDraftReady:value=>{if(value)tools=value;}});
 try{
  await h.idle();const capture=tools.capture();assert.ok(capture);ui=f.ui({additionalDraft:{capture:()=>capture},onBeginSourceWrite(){holds++;return{confirm(){confirms++;}};}});
  f.controls.response=(call,response)=>{
   if(call.url.endsWith('/attachments')&&call.body?.key.endsWith('-second.png')){secondLost=true;return Response.json({error:'LOCAL second attachment committed but ACK lost'},{status:503});}
   if(failRecoveredDelivery&&recovered&&call.url.endsWith('/quotation-fields')&&!deliveryFailed){deliveryFailed=true;throw Error('LOCAL aggregate delivery GET lost after positive recovery');}
   return response;
  };
  await ui.select([imageFile('first.png'),imageFile('second.png')]);const retainedStart=ui.button('업로드 시작 (2)').props.onClick;await ui.click('업로드 시작 (2)');
  assert.equal(secondLost,true);assert.equal(JSON.parse(f.product().image_keys).length,3);assert.equal(ui.saved,0);assert.equal(confirms,0);assert.equal(ui.render().props['data-workspace-dirty'],true);
  const start=f.calls.length;retainedStart();await ui.idle();assert.equal(f.calls.length,start,'pending delivery still blocks retained write starts');
  await ui.click('추가 이미지 초안 연결 결과 다시 확인');assert.equal(ui.saved,0);assert.equal(confirms,0,'the incomplete first-only basis cannot acknowledge the second');
  if(retired){h.active(false);ui.render({active:false});h.active(true);ui.render({active:true});assert.equal(capture.current(),false);}
  const read=ui.button('second.png 저장 결과 확인');assert.equal(!!read.props.disabled,false,'original uncertain attachment recovery remains readable');
  ui.render({additionalDraft:{capture(){assert.fail('aggregate recovery must retain the original capture');}}});recovered=true;const recoveryStart=f.calls.length;
  await ui.click('second.png 저장 결과 확인');assert.ok(f.calls.slice(recoveryStart).every(call=>call.method==='GET'),'original attachment recovery does not upload/attach again');
  if(failRecoveredDelivery){assert.equal(ui.saved,0);assert.equal(confirms,0);assert.equal(ui.render().props['data-workspace-dirty'],true);const retryStart=f.calls.length;await ui.click('추가 이미지 초안 연결 결과 다시 확인');assert.ok(f.calls.slice(retryStart).every(call=>call.method==='GET'));}
  assert.equal(ui.saved,1);assert.equal(holds,1);assert.equal(confirms,1);assert.equal(ui.render().props['data-workspace-dirty'],false);
  assert.equal(f.calls.filter(call=>call.url==='/api/files'&&call.method==='POST').length,2);assert.equal(f.calls.filter(call=>call.url.endsWith('/attachments')&&call.method==='POST').length,2);assert.equal(f.calls.filter(call=>call.method==='PUT').length,0);
  await h.idle();assert.deepEqual(h.ordered(),plain(capture.keys));if(retired){assert.deepEqual(plain(capture.keys),[]);assert.equal(capture.current(),false);}else{assert.match(capture.keys.at(-2),/-first.png$/);assert.match(capture.keys.at(-1),/-second.png$/);}assert.equal(f.protectedSnapshot(),f.before);
  const after=await (await f.fetcher('/api/products/'+f.id+'/quotation-fields')).json();assert.deepEqual(after.overrides,before.overrides);assert.deepEqual(after.resolved,before.resolved);assert.deepEqual(after.automatic,before.automatic);
 }finally{ui?.close();h.close();f.close();}
});

for(const retired of [false,true])test('R12 unchanged second recovery retains mixed hold; retired='+retired,async()=>{
 const f=await productImageUploadFixture(),before=await (await f.fetcher('/api/products/'+f.id+'/quotation-fields')).json();let tools,ui,holds=0,confirms=0,secondAttempted=false,firstReadFailed=false;
 const h=imageUI(f.fetcher,{productId:f.id,optionId:before.resolved.rows.find(row=>row.optionId).optionId,version:f.product().updated_at,additionalDraft:true,onDraftReady:value=>{if(value)tools=value;}});
 try{
  await h.idle();const capture=tools.capture();ui=f.ui({additionalDraft:{capture:()=>capture},onBeginSourceWrite(){holds++;return{confirm(){confirms++;}};}});
  f.controls.before=call=>{if(!secondAttempted&&call.url.endsWith('/attachments')&&call.body?.key.endsWith('-second.png')){secondAttempted=true;throw Error('LOCAL second attempt did not commit');}};
  f.controls.response=(call,response)=>{if(secondAttempted&&call.url.endsWith('/quotation-fields')&&!firstReadFailed){firstReadFailed=true;throw Error('LOCAL first delivery GET lost');}return response;};
  await ui.select([imageFile('first.png'),imageFile('second.png')]);await ui.click('업로드 시작 (2)');assert.equal(ui.saved,0);assert.equal(confirms,0);assert.equal(JSON.parse(f.product().image_keys).length,2);
  if(retired){h.active(false);ui.render({active:false});h.active(true);ui.render({active:true});assert.equal(capture.current(),false);}
  assert.equal(!!ui.button('second.png 저장 결과 확인').props.disabled,false);const readsStart=f.calls.length;await ui.click('second.png 저장 결과 확인');assert.ok(f.calls.slice(readsStart).every(call=>call.method==='GET'));assert.equal(confirms,0);
  const second=nodes(ui.render()).find(node=>node.type==='li'&&text(node).includes('second.png'));assert.match(text(second),/파일 보관 · 연결 대기/);assert.doesNotMatch(text(second),/추가 완료/);
  const blockedLink=ui.button('저장된 파일 연결');assert.equal(blockedLink.props.disabled,true);const blockedStart=f.calls.length;blockedLink.props.onClick();await ui.idle();assert.equal(f.calls.length,blockedStart,'pending delivery still prohibits attachment retry');
  ui.render({additionalDraft:{capture(){assert.fail('delivery must use its original capture');}}});const deliveryStart=f.calls.length;await ui.click('추가 이미지 초안 연결 결과 다시 확인');assert.ok(f.calls.slice(deliveryStart).every(call=>call.method==='GET'));
  assert.equal(ui.saved,1,'only the first positively proven image was delivered');assert.equal(confirms,0,'unchanged second read is not a positive acknowledgment');assert.equal(holds,1);assert.equal(ui.render().props['data-workspace-dirty'],true);if(retired)assert.deepEqual(plain(capture.keys),[]);else assert.match(capture.keys.at(-1),/-first.png$/);assert.ok(!capture.keys.some(key=>key.endsWith('-second.png')));assert.equal(f.protectedSnapshot(),f.before);
  assert.equal(f.calls.filter(call=>call.url==='/api/files'&&call.method==='POST').length,2);assert.equal(f.calls.filter(call=>call.url.endsWith('/attachments')&&call.method==='POST').length,2);
  if(retired){const start=f.calls.length;ui.render({additionalDraft:{capture:()=>capture}});ui.button('저장된 파일 연결').props.onClick();await ui.idle();assert.equal(f.calls.length,start);assert.equal(confirms,0);return;}
  ui.render({additionalDraft:{capture:()=>capture}});h.source(f.product().updated_at);await h.idle();assert.equal(capture.current(),true);await ui.click('저장된 파일 연결');assert.equal(confirms,1);assert.equal(f.calls.filter(call=>call.url==='/api/files'&&call.method==='POST').length,2);assert.equal(f.calls.filter(call=>call.url.endsWith('/attachments')&&call.method==='POST').length,3);assert.equal(f.protectedSnapshot(),f.before);
 }finally{ui?.close();h.close();f.close();}
});

for(const drift of ['none','authority','profile','option'])test('R12 AI original read after retirement guards '+drift,async()=>{
 let editor,capture;
 const f=await aiFixture(schemaCompanies[0],{beforeGeneration:async state=>{
  let tools;editor=imageUI((url,init={})=>state.backend.route(url,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})}),{productId:state.product.id,optionId:state.id,version:state.view.productVersion,profileId:state.profile.id,additionalDraft:true,onDraftReady:value=>{if(value)tools=value;}});
  await editor.idle();capture=tools.capture();
 }});
 try{
  const target={ownerId:'owner',productId:f.product.id,sourceKey:f.source,productVersion:f.target.productVersion,originView:plain(capture.view),capture,index:capture.keys.indexOf(f.source)},order=editor.ordered();
  editor.active(false);editor.active(true);assert.equal(capture.current(),false);
  if(drift==='authority')editor.authority('foreign');if(drift==='profile')editor.profile('foreign');if(drift==='option')editor.select('foreign');
  const start=f.calls.length;
  if(drift!=='none'){await assert.rejects(()=>f.helper.applyAdditionalImageDraftAiResult(target,f.completed,f.request,false));assert.equal(f.calls.length,start);return;}
  for(const forged of [{...target,ownerId:'foreign'},{...target,sourceKey:'owner/foreign.png'},{...target,productId:'foreign'}])await assert.rejects(()=>f.helper.applyAdditionalImageDraftAiResult(forged,f.completed,f.request,false));
  await assert.rejects(()=>f.helper.applyAdditionalImageDraftAiResult(target,f.completed,f.request,true));assert.equal(f.calls.length,start,'retired capture cannot deliver or dispatch writes');
  const after=await f.helper.applyAdditionalImageDraftAiResult(target,f.completed,f.request,false);assert.ok(f.calls.length>start);assert.ok(f.calls.every(call=>call.method==='GET'));await editor.idle();assert.deepEqual(editor.ordered(),order);assert.equal(capture.current(),false);assert.deepEqual(after.overrides,target.originView.overrides);
  const panel=imagePanelHarness((url,init)=>f.request(url,init),{initialPending:f.request(f.base+'/image-generation'),initialProps:{productId:f.product.id,version:after.productVersion,imageKeys:after.imageKeys,draftProcessingTarget:{...target,sequence:1},processingTargetActive:false,processingResultActive:false}});
  try{await panel.idle();panel.click('저장된 설정·실행 이력 새로고침 · 무료')();await panel.idle();assert.equal(panel.changed,1);}finally{panel.close();}
 }finally{editor?.close();f.close();}
});

test('R12 retired AI panel confirms only its originally dispatched job with read-only refresh',async()=>{
 let editor,capture;
 const f=await aiFixture(schemaCompanies[0],{beforeGeneration:async state=>{
  let tools;editor=imageUI((url,init={})=>state.backend.route(url,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})}),{productId:state.product.id,optionId:state.id,version:state.view.productVersion,profileId:state.profile.id,additionalDraft:true,onDraftReady:value=>{if(value)tools=value;}});await editor.idle();capture=tools.capture();
 }});
 let panel,holds=0,confirms=0,posts=0,foreign=true;
 try{
  const target={ownerId:'owner',sourceKey:f.source,productVersion:f.target.productVersion,originView:plain(capture.view),capture,index:capture.keys.indexOf(f.source),sequence:1},order=editor.ordered();
  const history=await (await f.request(f.base+'/image-generation')).json();
  const initial={...history,configuration:{...history.configuration,configured:true},product:{...history.product,version:target.productVersion,imageKeys:target.originView.imageKeys},jobs:[{...f.completed,status:'approved',result:null}]};
  const request=async(url,init={})=>{if(init.method==='POST'){posts++;assert.equal(JSON.parse(init.body).action,'execute');assert.equal(JSON.parse(init.body).jobId,f.completed.id);throw Error('LOCAL execute ACK lost; original fixture result already stored');}if(url===f.base+'/image-generation')return Response.json({...history,jobs:[{...f.completed,id:foreign?'foreign-job':f.completed.id}]});return f.request(url,init);};
  panel=imagePanelHarness(request,{initialPending:Promise.resolve(Response.json(initial)),initialProps:{productId:f.product.id,version:target.productVersion,imageKeys:target.originView.imageKeys,draftProcessingTarget:target,processingTargetActive:true,beforeSelectedImageApply:()=>true,onBeginSourceWrite(){holds++;return{confirm(){confirms++;}};}}});
  await panel.idle();panel.click('승인한 이미지 1장 가공 · 비용 발생')();await panel.idle();assert.equal(posts,1);assert.equal(holds,1);assert.equal(confirms,0);
  editor.active(false);editor.active(true);panel.update({processingTargetActive:false});await panel.idle();assert.equal(capture.current(),false);
  panel.click('저장된 설정·실행 이력 새로고침 · 무료')();await panel.idle();assert.equal(confirms,0,'foreign completed job cannot acknowledge the original hold');
  foreign=false;panel.click('저장된 설정·실행 이력 새로고침 · 무료')();await panel.idle();assert.equal(confirms,1);assert.equal(posts,1);assert.deepEqual(editor.ordered(),order);assert.equal(capture.current(),false);
 }finally{panel?.close();editor?.close();f.close();}
});

const terminalImageMetadata=(await import('./helpers/provided-option-quotation.mjs')).providedOptionModule('app/automation/image-edit.ts').imageMetadata;
const terminalPng=(await declarationFixture('additional-image-ai-apply.test.mjs','png')).png(1024,1024);
async function terminalPanelFixture(kind,{lost=false,retired=false,changed=false,invalid='none',operation='execute'}={}){
 const version='2026-11-07T02:00:00.000Z',jobId='00000000-0000-4000-8000-000000000091',source='owner/raw.png',key='owner/ai-'+jobId+'.png';
 const metadata=plain(await terminalImageMetadata(terminalPng,'image/png'));let current=true,readable=true,holds=0,confirms=0,posts=0,accepts=0,history,validHistory,lastPost,deny=false;
 const origin={productVersion:version,contentRevision:1,imageKeys:[source]},capture={view:origin,keys:[source],target:{profileId:null,optionId:'one'},current:()=>current,readable:()=>readable,root:()=>null,accept:()=>{accepts++;return false;},verify:()=>false};
 const target={sourceKey:source,productVersion:version,ownerId:'owner',sequence:1,index:0,originView:origin,capture};let firstResolve;const initialPending=new Promise(resolve=>{firstResolve=resolve;});
 const h=imagePanelHarness(async(url,init={})=>{
  if(init.method==='POST'){posts++;lastPost=JSON.parse(init.body);if(posts===1){assert.equal(lastPost.action,operation);if(lost)throw Error('LOCAL terminal ACK lost');return Response.json({job:validHistory.jobs[0]});}assert.ok(['prepare','attach'].includes(lastPost.action));return Response.json({error:'LOCAL explicit follow-up intercepted'},{status:409});}
  if(deny)throw Error('LOCAL original proof unavailable');
  if(url.startsWith('/api/files/'))return new Response(terminalPng,{headers:{'content-type':'image/png'}});
  assert.equal(url,'/api/products/p/image-generation');return Response.json(history);
 },{initialPending,initialProps:{productId:'p',version,imageKeys:[source],draftProcessingTarget:target,beforeSelectedImageApply:()=>true,onBeginSourceWrite(){holds++;return{confirm(){confirms++;}};}}});
 const approved={...plain(h.job),id:jobId,productId:'p',productVersion:version,contentRevision:1,status:'approved',createdAt:version,approvedAt:version,startedAt:version,finishedAt:null,result:null,error:null,review:{...plain(h.job.review),sourceKey:source,purpose:'cleanup',fingerprint:'a'.repeat(64),source:{...metadata,sha256:'b'.repeat(64)}}};
 const failed=kind.startsWith('failed'),terminal={...approved,status:failed?'failed':'completed',finishedAt:'2026-11-07T02:00:01.000Z',error:failed?{code:'IMAGE_PROVIDER_HTTP_400',message:'LOCAL definite failure',mayHaveBeenCharged:kind==='failed-charged'}:null,result:failed?null:{...metadata,storageKey:key,model:approved.review.model,purpose:'cleanup',generatedAt:'2026-11-07T02:00:01.000Z',providerRequestId:null,usage:null,attached:false,assignedRole:false,provenance:'generated',reviewRequired:true}};
 const product={id:'p',version,imageKeys:[source]},initial={...plain(h.view),product,jobs:[operation==='attach'?terminal:approved]};validHistory={...initial,jobs:[terminal]};history=plain(validHistory);
 if(retired||changed){history.product={id:'p',version:'2026-11-07T02:00:02.000Z',imageKeys:[source,'owner/unrelated.png']};validHistory=plain(history);}
 if(invalid==='running'){history.jobs[0]={...approved,status:'running'};}
 if(invalid==='uncertain'){history.jobs[0]={...terminal,status:'uncertain',result:null,error:{code:'PROVIDER_OUTCOME_UNCERTAIN',message:'LOCAL uncertain',mayHaveBeenCharged:true}};}
 if(invalid==='foreign-id')history.jobs[0].id='00000000-0000-4000-8000-000000000092';
 if(invalid==='duplicate')history.jobs.push(plain(history.jobs[0]));
 if(invalid==='review')history.jobs[0].review.fingerprint='c'.repeat(64);
 if(invalid==='source')history.jobs[0].review.sourceKey='owner/other.png';
 if(invalid==='content')history.jobs[0].contentRevision++;
 if(invalid==='contradictory-error')history.jobs[0].error.code='PROVIDER_OUTCOME_UNCERTAIN';
 if(invalid==='product')history.product.id='foreign';
 if(invalid==='membership')history.product.imageKeys.push(key);
 if(invalid==='invalid-error')history.jobs[0].error.mayHaveBeenCharged='true';
 if(invalid==='invalid-result')history.jobs[0].result.storageKey='foreign/result.png';
 if(invalid==='bytes')history.jobs[0].result.sha256='d'.repeat(64);
 if(invalid==='missing')history.jobs=[];
 if(invalid==='unreadable')readable=false;
 if(invalid==='read-failure')deny=true;
 firstResolve(Response.json(initial));await h.idle();
 return {h,key,target,initial,validHistory,get counts(){return{holds,confirms,posts,accepts};},get lastPost(){return lastPost;},async execute(){h.click(operation==='execute'?'승인한 이미지 1장 가공 · 비용 발생':'생성된 결과를 현재 상품에 추가 · 무료')();await h.idle();if(retired){current=false;h.update({processingTargetActive:false});await h.idle();}},async refresh(){h.click('저장된 설정·실행 이력 새로고침 · 무료')();await h.idle();},button(label){return nodes(h.render()).find(node=>node.type==='button'&&text(node)===label);},fresh(){current=true;readable=true;h.update({version:history.product.version,imageKeys:history.product.imageKeys,draftProcessingTarget:{...target,capture:{...capture,view:{...origin,productVersion:history.product.version,imageKeys:history.product.imageKeys}}},processingTargetActive:true});},close(){h.close();}};
}
for(const kind of ['failed','failed-charged','unattached'])for(const lost of [false,true])test('SR1 exact '+kind+' terminal releases only its execution; lost='+lost,async()=>{
 const f=await terminalPanelFixture(kind,{lost});try{await f.execute();if(lost){assert.equal(f.counts.confirms,0);assert.equal(f.button('이미지 요청 검토하기 · 무료').props.disabled,true);await f.refresh();}assert.deepEqual(f.counts,{holds:1,confirms:1,posts:1,accepts:0});assert.equal(f.button('이미지 요청 검토하기 · 무료').props.disabled,false);if(kind==='failed-charged')assert.match(text(f.h.render()),/비용이 발생했을 수 있습니다/);
  const follow=kind==='unattached'?'생성된 결과를 현재 상품에 추가 · 무료':'이미지 요청 검토하기 · 무료';f.h.click(follow)();await f.h.idle();assert.equal(f.counts.posts,2);assert.equal(f.lastPost.action,kind==='unattached'?'attach':'prepare');
 }finally{f.close();}
});
for(const kind of ['failed-charged','unattached'])test('SR1 retired '+kind+' settles original execution without reviving delivery or write permission',async()=>{
 const f=await terminalPanelFixture(kind,{lost:true,retired:true});try{await f.execute();await f.refresh();assert.deepEqual(f.counts,{holds:1,confirms:1,posts:1,accepts:0});assert.equal(f.button('이미지 요청 검토하기 · 무료').props.disabled,true);f.fresh();await f.h.idle();assert.equal(f.button('이미지 요청 검토하기 · 무료').props.disabled,false);if(kind==='unattached'){f.h.click('생성된 결과를 현재 상품에 추가 · 무료')();await f.h.idle();assert.equal(f.counts.posts,2);assert.equal(f.lastPost.action,'attach');assert.equal(f.lastPost.expectedVersion,'2026-11-07T02:00:02.000Z');}}
 finally{f.close();}
});
for(const invalid of ['running','uncertain','foreign-id','duplicate','review','source','content','product','membership','invalid-error','contradictory-error','invalid-result','bytes','missing','unreadable','read-failure'])test('SR1 original terminal proof stays blocked for '+invalid,async()=>{
 const f=await terminalPanelFixture(['invalid-result','bytes'].includes(invalid)?'unattached':'failed-charged',{lost:true,invalid});try{await f.execute();await f.refresh();assert.deepEqual(f.counts,{holds:1,confirms:0,posts:1,accepts:0});assert.equal(f.button('이미지 요청 검토하기 · 무료').props.disabled,true);}finally{f.close();}
});
test('SR1 unchanged completed-unattached read cannot settle a lost attachment attempt',async()=>{
 const f=await terminalPanelFixture('unattached',{operation:'attach',lost:true});try{await f.execute();await f.refresh();assert.deepEqual(f.counts,{holds:1,confirms:0,posts:1,accepts:0});assert.equal(f.button('생성된 결과를 현재 상품에 추가 · 무료').props.disabled,true);}finally{f.close();}
});

test('SR1 completed-unattached contradicting current membership cannot release execution',async()=>{
 const f=await terminalPanelFixture('unattached',{lost:true,invalid:'membership'});try{await f.execute();await f.refresh();assert.deepEqual(f.counts,{holds:1,confirms:0,posts:1,accepts:0});}finally{f.close();}
});

for(const lost of [false,true])test('SR1 changed terminal snapshot blocks retained stale writes until fresh source; lost='+lost,async()=>{
 const f=await terminalPanelFixture('unattached',{lost,changed:true});try{const retained=f.h.click('이미지 요청 검토하기 · 무료');await f.execute();if(lost)await f.refresh();assert.deepEqual(f.counts,{holds:1,confirms:1,posts:1,accepts:0});retained();await f.h.idle();assert.equal(f.counts.posts,1,'old props cannot dispatch after newer terminal proof');assert.equal(f.button('이미지 요청 검토하기 · 무료').props.disabled,true);f.fresh();await f.h.idle();f.h.click('생성된 결과를 현재 상품에 추가 · 무료')();await f.h.idle();assert.equal(f.counts.posts,2);assert.equal(f.lastPost.action,'attach');assert.equal(f.lastPost.expectedVersion,'2026-11-07T02:00:02.000Z');}finally{f.close();}
});
