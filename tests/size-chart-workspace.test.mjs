import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {sizeChartApiFixture,companies,json,plain} from './helpers/supplier-hub-single-size-chart.mjs';
import {SINGLE_DOCUMENT_LIVE_VERIFIED} from '../extensions/supplier-hub/single-dispatch.mjs';

const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
const sleep=()=>new Promise(resolve=>setTimeout(resolve,1));
const trace=[];
const files=['app/components/size-chart-workspace.tsx','app/components/document-image-panel.tsx','app/document-image-render.ts','app/manual-size-chart.ts','app/product-content.ts'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')]));
const beforeHashes=hashes();
test.after(()=>{assert.deepEqual(hashes(),beforeHashes);fs.writeFileSync(new URL('../'+(process.env.SIZE_CHART_WORKSPACE_PROOF_PATH||'outputs/step707-size-chart-ui-proof.json'),import.meta.url),JSON.stringify({sourceHashes:beforeHashes,trace,boundary:'Actual React callbacks and local content APIs/SQLite. Renderer uses a synthetic canvas. No real browser pixels, source collection, provider or Supplier Hub writes.'},null,2)+'\n');});

// Reuse the existing real document component harness without registering its
// test cases again. Its PNG encoder is synthetic; the renderer is tested below.
const documentFixtureUrl=new URL('./document-image-recovery.test.mjs',import.meta.url),documentSource=fs.readFileSync(documentFixtureUrl,'utf8');
const documentAst=ts.createSourceFile(documentFixtureUrl.pathname,documentSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const documentDeclaration=documentAst.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='documentPanel');
const documentUi=vm.runInNewContext('('+documentDeclaration.getText(documentAst).replaceAll('import.meta.url',JSON.stringify(documentFixtureUrl.href))+')',{
 fs,vm,ts,assert,nodes,text,Blob,File,FormData,URL,png:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'),setTimeout,Date,
});

function workspace(f,intercept){
 const state=[],effects=[];let cursor=0,version=f.h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(f.id).updated_at,saves=0,closed=false;
 let confirmation=true;const confirmations=[],calls=[];
 const hooks={useState(initial){const at=cursor++;if(!(at in state))state[at]=typeof initial==='function'?initial():initial;return[state[at],value=>state[at]=typeof value==='function'?value(state[at]):value];},useRef(initial){const at=cursor++;return state[at]??(state[at]={current:initial});},useCallback(fn){cursor++;return fn;},useLayoutEffect(fn,deps){hooks.useEffect(fn,deps);},useEffect(fn,deps){const at=cursor++,old=state[at];if(!old||!deps||!old.deps||deps.some((value,index)=>value!==old.deps[index])){state[at]={deps};effects.push(()=>{old?.cleanup?.();state[at].cleanup=fn();});}}};
 const DocumentImagePanel=()=>{},jsx=(type,props)=>({type,props}),exports={};
 const request=async(path,init={})=>{calls.push({path,method:init.method??'GET'});const send=()=>path===f.base?f.h.load('app/api/products/[id]/route.ts').GET(new Request('https://app.test'+path),{params:Promise.resolve({id:f.id})}):f.route(path,{method:init.method??'GET',...(init.body?{body:init.body}:{})});return intercept?intercept(path,init,send):send();};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/size-chart-workspace.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,structuredClone,fetch:request,window:{confirm(message){confirmations.push(message);return confirmation;}},require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name==='@/app/components/document-image-panel')return{DocumentImagePanel};if(name==='@/app/components/size-chart-extraction-panel')return{SizeChartExtractionPanel:()=>{}};return f.h.load(name.slice(2)+'.ts');}});
 const render=()=>{cursor=0;const wrapper=exports.SizeChartWorkspace({productId:f.id,version,onSaved(){saves++;version=f.h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(f.id).updated_at;}});const tree=wrapper.type(wrapper.props);effects.splice(0).forEach(effect=>effect());return tree;};
 const idle=async()=>{for(let i=0;i<100;i++){if(closed)return;render();await sleep();const tree=render();if(!tree.props['aria-busy']&&(nodes(tree).some(node=>node.props?.role==='alert')||state[0]&&(state[1]!==undefined||state[0].version===version)))return;}throw Error('size workspace did not settle');};
 const button=label=>nodes(render()).find(node=>node.type==='button'&&text(node.props.children)===label);
 const input=label=>nodes(render()).find(node=>node.props?.['aria-label']===label&&['input','select'].includes(node.type));
 return{render,idle,button,input,calls,confirmations,confirm(value){confirmation=value;},get saves(){return saves;},get png(){return nodes(render()).find(node=>node.type===DocumentImagePanel);},alerts:()=>nodes(render()).filter(node=>node.props?.role==='alert').map(node=>text(node)),
  edit(label,value){const node=input(label);assert.ok(node&&!node.props.disabled,label);node.props.onChange({target:{value}});render();},
  async click(label){const node=button(label);assert.ok(node&&!node.props.disabled,label);node.props.onClick();await idle();},
  setVersion(value){version=value;render();},close(){closed=true;state.forEach(value=>value?.cleanup?.());},
 };
}
async function inputGrid(ui){
 if(ui.button('재작성'))await ui.click('재작성');
 await ui.click('사이즈표 직접 작성');ui.edit('사이즈 유형','직접 확인한 의류 규격');ui.edit('사이즈표 단위','mm');ui.edit('사이즈 목록',' S, M, XL ');
 ui.edit('측정 항목 1 이름','총장');ui.edit('측정 항목 1 사이즈 1 값','610');ui.edit('측정 항목 1 사이즈 2 값','650');ui.edit('측정 항목 1 사이즈 3 값','710');
 await ui.click('＋ 측정 항목 추가');ui.edit('측정 항목 2 이름','가슴둘레');ui.edit('측정 항목 2 사이즈 2 값','  ');
}
for(const company of companies)test(`manual size editor saves/reloads row-column text without touching source dimensions (${company.code})`,async()=>{
 const f=await sizeChartApiFixture(company),{h}=f;let ui;
 try{
  const optionBefore=h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.id).payload,objects=new Map([...h.objects].map(([key,value])=>[key,value.slice()]));
  ui=workspace(f);await ui.idle();assert.equal(ui.png,undefined);assert.ok(nodes(ui.render()).some(node=>node.props?.['data-saved-size-chart']));await inputGrid(ui);assert.equal(ui.render().props['data-workspace-dirty'],true);assert.equal(ui.png.props.disabled,true);
  await ui.click('사이즈표 정보 저장');assert.deepEqual(ui.alerts(),[]);assert.equal(ui.saves,1);assert.equal(ui.render().props['data-workspace-dirty'],false);assert.equal(ui.png.props.disabled,false);
  const saved=(await json(await f.route(f.base+'/content'))).content;
  assert.deepEqual(saved.manualSizeChart,{sizeType:'직접 확인한 의류 규격',sizeUnits:'mm',sizes:['S','M','XL'],measurements:[{name:'총장',values:['610','650','710']},{name:'가슴둘레',values:['','  ','']}]});assert.deepEqual(saved.assets.size.value,[]);
  await ui.click('저장 사이즈표 다시 조회');assert.equal(ui.input('측정 항목 2 사이즈 2 값').props.value,'  ');
  ui.edit('사이즈 목록','S,M');ui.edit('사이즈 목록','S,M,XL');assert.equal(ui.input('측정 항목 1 사이즈 3 값').props.value,'');
  nodes(ui.render()).find(node=>node.type==='button'&&node.props['aria-label']==='측정 항목 2 삭제').props.onClick();assert.equal(ui.input('측정 항목 2 이름'),undefined);
  await ui.click('입력 취소·저장 사이즈표 조회');assert.equal(ui.input('측정 항목 1 사이즈 3 값').props.value,'710');
  assert.equal(h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.id).payload,optionBefore);for(const[key,bytes]of objects)assert.deepEqual(h.objects.get(key),bytes);assert.deepEqual(h.network,[]);
  trace.push({kind:'manual-save-reload-cancel',company,rows:2,columns:3,sourceOptionsUnchanged:true,oldFilesRetained:true,externalRequests:0});
 }finally{ui?.close();h.close();}
});
test('an unsaved table disables the actual PNG callbacks before rendering or uploading',async()=>{
 const f=await sizeChartApiFixture();let panel;
 try{
  let requests=0;const disabledUi=vm.runInNewContext('('+documentDeclaration.getText(documentAst).replaceAll('import.meta.url',JSON.stringify(documentFixtureUrl.href)).replace('{productId,version,section,onSaved','{productId,version,section,disabled:true,onSaved')+')',{
   fs,vm,ts,assert,nodes,text,Blob,File,FormData,URL,png:Buffer.from('synthetic'),setTimeout,Date,
  });
  panel=disabledUi(f.h,f.id,async()=>{requests++;throw Error('disabled editor must not request');},'size');
  const button=panel.button('사이즈표 생성·견적 첨부');assert.equal(button.props.disabled,true);button.props.onClick();await sleep();assert.equal(requests,0);assert.equal(panel.plans.length,0);
  trace.push({kind:'dirty-PNG-callback-blocked',requests,renderedPlans:0});
 }finally{panel?.close();f.h.close();}
});
test('an extracted candidate opens a manual draft and cannot save or generate PNG while extraction is busy',async()=>{
 const f=await sizeChartApiFixture();let ui;try{
  ui=workspace(f);await ui.idle();await ui.click('재작성');const before=(await json(await f.route(f.base+'/content'))).content;
  const extraction=()=>nodes(ui.render()).find(node=>typeof node.type==='function'&&typeof node.props?.onDraft==='function');
  assert.equal(extraction(),undefined);await ui.click('이미지에서 사이즈표 초안 만들기');
  extraction().props.onBusyChange(true);assert.equal(ui.png.props.disabled,true);assert.equal(ui.button('사이즈표 직접 작성').props.disabled,true);extraction().props.onBusyChange(false);
  extraction().props.onDraft({sizeType:'원문에서 가져온 표',sizeUnits:'cm',sizes:['S'],measurements:[{name:'총장',values:['61']}]});assert.equal(ui.render().props['data-workspace-dirty'],true);assert.equal(ui.input('측정 항목 1 사이즈 1 값').props.value,'61');assert.equal(ui.png.props.disabled,true);assert.deepEqual((await json(await f.route(f.base+'/content'))).content,before);
  await ui.click('사이즈표 정보 저장');assert.equal((await json(await f.route(f.base+'/content'))).content.manualSizeChart.measurements[0].values[0],'61');
  trace.push({kind:'extraction-parent-draft-only',automaticContentWrites:0,explicitSave:true});
 }finally{ui?.close();f.close();}
});
for(const loss of ['fetch','json'])test(`manual-grid exact committed ${loss} acknowledgement is recovered without a second PATCH`,async()=>{
 const f=await sizeChartApiFixture();let ui,patches=0;
 try{
  ui=workspace(f,async(_path,init,send)=>{const response=await send();if(init.method==='PATCH'){patches++;assert.equal(response.status,200);if(loss==='fetch')throw Error('saved reply lost');return{ok:true,json:async()=>{throw Error('saved body lost');}};}return response;});await ui.idle();await inputGrid(ui);await ui.click('사이즈표 정보 저장');
  assert.equal(patches,1);assert.equal(ui.saves,1);assert.deepEqual(ui.alerts(),[]);assert.equal(ui.render().props['data-workspace-dirty'],false);trace.push({kind:'exact-ack-recovery',loss,patches,saves:ui.saves});
 }finally{ui?.close();f.h.close();}
});
test('dirty grid survives an external save and must explicitly rebase before PNG generation or saving',async()=>{
 const f=await sizeChartApiFixture();let ui;
 try{
  ui=workspace(f);await ui.idle();await inputGrid(ui);const before=(await json(await f.route(f.base+'/content'))).content;
  await json(await f.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:before.revision,patch:{label:{material:'다른 편집기에서 확인한 재질'}}}}));
  ui.setVersion(f.h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(f.id).updated_at);await ui.idle();assert.equal(ui.button('사이즈표 정보 저장').props.disabled,true);assert.equal(ui.png.props.disabled,true);assert.equal(ui.input('측정 항목 1 사이즈 1 값').props.value,'610');
  await ui.click('입력 유지·최신 사이즈표 조회');assert.equal(ui.button('사이즈표 정보 저장').props.disabled,false);await ui.click('사이즈표 정보 저장');const after=(await json(await f.route(f.base+'/content'))).content;assert.equal(after.label.material.value,'다른 편집기에서 확인한 재질');assert.equal(after.manualSizeChart.measurements[0].values[0],'610');
  trace.push({kind:'explicit-rebase',externalManualValuePreserved:true});
 }finally{ui?.close();f.h.close();}
});
test('validation, failed writes and unmounted responses retain input and cannot acknowledge a stale grid',async()=>{
 const f=await sizeChartApiFixture();let ui,resolvePatch,patches=0,blocked=true;
 try{
  ui=workspace(f,async(_path,init,send)=>{if(init.method==='PATCH'){patches++;if(blocked)return Response.json({error:'동시 수정'}, {status:409});await new Promise(resolve=>{resolvePatch=resolve;});}return send();});await ui.idle();await ui.click('재작성');await ui.click('사이즈표 직접 작성');await ui.click('사이즈표 정보 저장');assert.equal(patches,0);assert.ok(ui.alerts().length);
  ui.edit('측정 항목 1 이름','폭');ui.edit('측정 항목 1 사이즈 1 값','10');await ui.click('사이즈표 정보 저장');assert.equal(patches,1);assert.equal(ui.render().props['data-workspace-dirty'],true);assert.equal(ui.input('측정 항목 1 사이즈 1 값').props.value,'10');assert.equal(ui.saves,0);
  blocked=false;ui.button('사이즈표 정보 저장').props.onClick();while(!resolvePatch)await sleep();ui.close();resolvePatch();await sleep();await sleep();assert.equal(ui.saves,0);trace.push({kind:'validation-conflict-unmount',invalidProviderCalls:0,acknowledgedAfterUnmount:false});
 }finally{ui?.close();f.h.close();}
});
test('manual PNG wraps long titles/column headers and retains every text cell',async()=>{
 const f=await sizeChartApiFixture();try{
  const plan=f.h.load('app/document-image.ts').documentImagePlan('size',{...(await json(await f.route(f.base+'/content'))).content,manualSizeChart:{sizeType:'사이즈'.repeat(25),sizeUnits:'inch',sizes:['긴사이즈'.repeat(15),'M'],measurements:[{name:'소매 길이',values:['12 / 13','']}]}},(await json(await f.route(f.base+'/options'))).options);
  const calls=[],canvas={width:0,height:0,getContext:()=>({measureText:value=>({width:[...value].length*24}),fillRect(){},strokeRect(){},fillText(value,x,y){calls.push({value,x,y});}}),toBlob(callback){callback(new Blob(['synthetic canvas PNG'],{type:'image/png'}));}};
  const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/document-image-render.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Blob,Error,document:{fonts:{load:async()=>[],ready:Promise.resolve()},createElement:()=>canvas},require:()=>f.h.load('app/document-image.ts')});
  const baseline=await exports.renderDocument({...plan,title:'표',headers:['측정 부위','S','M']});calls.length=0;
  const rendered=await exports.renderDocument(plan);assert.equal(rendered.width,plan.width);assert.ok(rendered.height>baseline.height+200);assert.ok(calls.filter(call=>call.x===336).map(call=>call.value).join('').endsWith('12 / 13'));assert.ok(calls.some(call=>call.value==='-'));assert.ok(calls.filter(call=>/긴|사|이|즈/.test(call.value)).length>5);assert.ok(calls.every(call=>call.x<canvas.width&&call.y<canvas.height));trace.push({kind:'synthetic-canvas-render',width:rendered.width,height:rendered.height,textCommands:calls.length,realPixelClaim:false});
 }finally{f.h.close();}
});
for(const company of companies)test(`manual editor to regenerated PNG to exact Single chart URL stays one active image (${company.code})`,async()=>{
 const f=await sizeChartApiFixture(company),{h}=f;let ui,panel;
 try{
  const initialObjects=new Map([...h.objects].map(([key,value])=>[key,value.slice()])),originalOptions=h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.id).payload;
  ui=workspace(f);await ui.idle();await inputGrid(ui);await ui.click('사이즈표 정보 저장');ui.close();
  const originalGet=h.bindings.FILES.get;h.bindings.FILES.get=async(key,options)=>{const value=await originalGet(key);if(!value)return value;const bytes=Uint8Array.from(h.objects.get(key));return{...value,body:new Response(bytes.slice(options?.range?.offset??0,(options?.range?.offset??0)+(options?.range?.length??bytes.length))).body};};
  const request=async(path,init={})=>path==='/api/files'?h.load('app/api/files/route.ts').POST(new Request('https://app.test'+path,{method:'POST',body:init.body})):path===f.base?h.load('app/api/products/[id]/route.ts').GET(new Request('https://app.test'+path),{params:Promise.resolve({id:f.id})}):f.route(path,{method:init.method??'GET',...(init.body?{body:init.body}:{})});
  const generated=[];
  for(let i=0;i<2;i++){
   panel=documentUi(h,f.id,request,'size');await panel.click('사이즈표 생성·견적 첨부');assert.deepEqual(panel.alerts(),[]);assert.equal(panel.notifications,1);assert.equal(panel.plans[0].format,'manual-size-chart');assert.deepEqual(plain(panel.plans[0].rows),[['총장','610','650','710'],['가슴둘레','-','  ','-']]);
   const saved=(await json(await f.route(f.base+'/content'))).content;assert.equal(saved.assets.size.value.length,1);generated.push(saved.assets.size.value[0]);panel.close();
  }
  assert.notEqual(generated[0],generated[1]);assert.ok(h.objects.has(generated[0]));
  const view=await json(await f.route(f.endpoint));assert.equal(view.review.canPrepare,true,JSON.stringify(view.review.issues));const prepared=await json(await f.prepare(view.fingerprint));assert.equal(prepared.prepared,true);
  const slot=prepared.manifest.find(item=>item.role==='size'&&item.optionId==='synthetic-one');assert.deepEqual(slot.keys,[generated[1]]);const packet=await h.load('app/supplier-hub-single-client.ts').singlePackagePacket(prepared,'owner','synthetic-one');assert.equal(packet.body.jsonDocument[0].imagePage.images.sizeChartImage,slot.files[0].url);
  const bytes=await f.serve(slot.files[0].url);assert.equal(bytes.status,200);assert.deepEqual(new Uint8Array(await bytes.arrayBuffer()),h.objects.get(generated[1]));
  assert.equal(h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.id).payload,originalOptions);for(const[key,value]of initialObjects)assert.deepEqual(h.objects.get(key),value);assert.deepEqual(h.network,[]);assert.equal(SINGLE_DOCUMENT_LIVE_VERIFIED,false);assert.equal(prepared.registered,false);assert.equal(prepared.submissionReady,false);
  trace.push({kind:'editor-PNG-Single-local',company,regenerations:2,activeChartCount:1,oldFilesRetained:true,privateImageBytesMatchPreparedUrl:true,packetChartUrlPreserved:true,registered:false,externalRequests:0});
 }finally{ui?.close();panel?.close();h.close();}
});
