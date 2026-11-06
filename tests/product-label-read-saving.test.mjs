import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stageRefreshDOM} from './helpers/stage-refresh-dom.mjs';
import {assetApiFixture,companies} from './helpers/supplier-hub-single-assets.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const handlers=node=>node?.[Object.keys(node).find(key=>key.startsWith('__reactProps'))];
async function fixture(){const f=await assetApiFixture(companies[0]);return{...f,product:await f.h.load('db/queries.ts').findProduct('owner',f.id)};}
async function until(h,check){for(let i=0;i<48&&!check();i++)await h.settle();assert.ok(check(),'actual nested React read reached expected state: '+h.container.textContent.slice(0,500));}
function textInput(h){return h.container.querySelector('.product-label-value-input');}
function buttons(h,label){return[...h.container.querySelectorAll('button')].filter(node=>node.textContent===label||node.getAttribute('aria-label')===label);}
async function click(h,label){const node=buttons(h,label)[0];assert.ok(node&&!node.disabled,label+' is enabled');await h.React.act(async()=>node.click());await h.settle();}
async function heldNested(){
 const f=await fixture(),gate=deferred(),calls=[],busy=[];let parentReturned=false,heldCall;
 const h=await stageRefreshDOM(async(url,init={})=>{const reference=/readProductLabelReferences/.test(new Error().stack),call={url:String(url),method:init.method??'GET',signal:init.signal,reference};calls.push(call);assert.equal(call.method,'GET');const reply=await f.h.route(String(url));if(!reference)parentReturned=true;if(!heldCall&&reference&&parentReturned&&!init.signal.aborted){heldCall=call;await gate.promise;}return reply;});
 const Label=h.load('app/components/product-label-editor.tsx').ProductLabelEditor,props={productId:f.id,optionId:null,version:f.product.updated_at,profileId:f.profile.id,active:true,onBusyChange:value=>busy.push(value)};
 await h.render(Label,props);await until(h,()=>heldCall&&textInput(h));return{f,h,Label,props,calls,busy,gate,get heldCall(){return heldCall;},async close(){gate.resolve();await h.close();f.close();}};
}

test('actual parent remains editable/non-saving while nested reference proof is held, and public busy still reports read activity',async()=>{
 const f=await fixture(),gate=deferred(),calls=[],busy=[];let held=false,parentReturned=false;
 const h=await stageRefreshDOM(async(url,init={})=>{
  const reference=/readProductLabelReferences/.test(new Error().stack),call={url:String(url),method:init.method??'GET',cache:init.cache,signal:init.signal,reference};calls.push(call);assert.equal(call.method,'GET');
  const response=await f.h.route(String(url));if(!reference)parentReturned=true;if(!held&&reference&&parentReturned&&!init.signal.aborted){held=true;await gate.promise;}return response;
 });
 try{
  const Label=h.load('app/components/product-label-editor.tsx').ProductLabelEditor,props={productId:f.id,optionId:null,version:f.product.updated_at,profileId:f.profile.id,active:true,onBusyChange:value=>busy.push(value)};
  await h.render(Label,props);await until(h,()=>held&&textInput(h));const parent=h.container.querySelector('.product-label-editor'),child=h.container.querySelector('[aria-label="상품 공통 최종 라벨 연결"]');
  const evidence={baseResolved:true,referenceProofHeld:true,parentInputDisabled:textInput(h).disabled,parentSaving:parent.getAttribute('data-workspace-saving'),childSaving:child.getAttribute('data-workspace-saving'),publicBusy:busy.at(-1),calls:calls.map(({url,method,cache})=>({url,method,cache}))};
  if(process.env.LABEL_READ_EVIDENCE)fs.writeFileSync(process.env.LABEL_READ_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
  assert.equal(textInput(h).disabled,false,'read-only reference proof must not disable parent text');
  assert.equal(parent.getAttribute('data-workspace-saving'),'false');assert.equal(child.getAttribute('data-workspace-saving'),'false');assert.equal(busy.at(-1),true,'public batch busy remains activity');
  assert.equal(buttons(h,'최종 라벨 저장본 조회')[0].disabled,true,'reference controls retain their local request lock');
  const guards=h.load('app/workspace-close.ts');assert.equal(guards.workspaceEditState(h.container).busy,false);assert.equal(guards.quotationSourceState(h.container).steps.length,0);assert.equal(guards.requestWorkspaceClose(h.container,()=>false),'close');
  await h.React.act(async()=>gate.resolve());await until(h,()=>busy.at(-1)===false);
  assert.deepEqual(calls.filter(call=>call.reference&&!call.signal.aborted).map(call=>call.url),[f.base+'/product-labels'+f.query,f.base+'/quotation-fields'+f.query,f.base+'/product-labels'+f.query]);assert.equal(calls.filter(call=>!call.reference).length,1);assert.ok(calls.every(call=>call.cache==='no-store'));
 }finally{gate.resolve();await h.close();f.close();}
});

test('initial empty-view label/reference GETs do not advertise saving and closing retires their read controllers',async()=>{
 const f=await fixture(),gate=deferred(),calls=[],busy=[];let closed=false;
 const h=await stageRefreshDOM(async(url,init={})=>{calls.push({url:String(url),method:init.method??'GET',signal:init.signal});const reply=await f.h.route(String(url));await gate.promise;return reply;});
 try{
  const Label=h.load('app/components/product-label-editor.tsx').ProductLabelEditor;await h.render(Label,{productId:f.id,optionId:null,version:f.product.updated_at,profileId:f.profile.id,active:true,onBusyChange:value=>busy.push(value)});await until(h,()=>calls.length>=2);
  assert.equal(textInput(h),null);assert.ok([...h.container.querySelectorAll('[data-workspace-saving]')].every(node=>node.getAttribute('data-workspace-saving')==='false'));assert.equal(busy.at(-1),true);
  assert.equal(h.load('app/workspace-close.ts').requestWorkspaceClose(h.container,()=>false),'close');await h.close();closed=true;assert.ok(calls.every(call=>call.signal.aborted));assert.ok(calls.every(call=>call.method==='GET'));assert.equal(busy.at(-1),false);
 }finally{gate.resolve();if(!closed)await h.close();f.close();}
});

for(const mode of ['blank','name','order'])test(`parent ${mode} edit during held actual reference proof survives its abort, late response and source/stage ABA`,async()=>{
 const x=await heldNested(),{h}=x;
 try{
  const beforeOrder=[...h.container.querySelectorAll('[data-label-sort-id]')].map(node=>node.getAttribute('data-label-sort-id'));
  if(mode==='blank'){const input=textInput(h);assert.equal(input.disabled,false);await h.React.act(async()=>handlers(input).onChange({target:{value:''}}));}
  if(mode==='name'){await click(h,'상품 공통 표시사항 항목 1 이름 편집');const input=h.container.querySelector('[aria-label="상품 공통 표시사항 항목 1 이름"]');await h.React.act(async()=>handlers(input).onChange({target:{value:'검토한 항목 이름'}}));await h.React.act(async()=>handlers(input).onBlur());}
  if(mode==='order')await click(h,'상품 공통 표시사항 항목 1 아래로');
  await until(h,()=>x.heldCall.signal.aborted);const values=[...h.container.querySelectorAll('.product-label-value-input')].map(node=>node.value),order=[...h.container.querySelectorAll('[data-label-sort-id]')].map(node=>node.getAttribute('data-label-sort-id'));
  if(mode==='blank')assert.equal(values[0],'');if(mode==='name')assert.match(h.container.querySelector('.product-label-name-caption').textContent,/검토한 항목 이름/);if(mode==='order')assert.equal(order[1],beforeOrder[0]);
  assert.equal(h.load('app/workspace-close.ts').workspaceEditState(h.container).dirty,true);assert.equal(h.load('app/workspace-close.ts').requestWorkspaceClose(h.container,()=>false),'cancel');
  await h.render(x.Label,{...x.props,active:false,version:'2026-01-01T00:00:00.000Z'});await h.render(x.Label,x.props);await h.React.act(async()=>x.gate.resolve());for(let i=0;i<6;i++)await h.settle();
  assert.deepEqual([...h.container.querySelectorAll('.product-label-value-input')].map(node=>node.value),values);assert.deepEqual([...h.container.querySelectorAll('[data-label-sort-id]')].map(node=>node.getAttribute('data-label-sort-id')),order);if(mode==='name')assert.match(h.container.querySelector('.product-label-name-caption').textContent,/검토한 항목 이름/);assert.ok(x.calls.every(call=>call.method==='GET'));
 }finally{await x.close();}
});

for(const mode of ['stage','source'])test(`clean nested reference proof ${mode} ABA ignores its retired read and starts a current fresh proof`,async()=>{
 const x=await heldNested(),{h}=x;
 try{
  await h.render(x.Label,{...x.props,...(mode==='stage'?{active:false}:{version:'2026-01-01T00:00:00.000Z'})});assert.equal(x.heldCall.signal.aborted,true);await h.render(x.Label,x.props);await h.React.act(async()=>x.gate.resolve());await until(h,()=>x.busy.at(-1)===false&&textInput(h));
  assert.equal(textInput(h).disabled,false);assert.equal(h.container.querySelector('.product-label-editor').getAttribute('data-workspace-saving'),'false');assert.ok(x.calls.filter(call=>call.reference&&!call.signal.aborted).length>=3);assert.ok(x.calls.every(call=>call.method==='GET'));
 }finally{await x.close();}
});

for(const lost of [false,true])test(`nested reference ${lost?'lost':'normal'} PUT ACK keeps the write barrier; recovery remains original read-only proof`,async()=>{
 const f=await fixture(),putGate=deferred(),readGate=deferred(),calls=[],busy=[],saving=[];let pausePut=true,failRecovery=false,pauseRecovery=false,saved=0,putArrived=false;
 const h=await stageRefreshDOM(async(url,init={})=>{
  const call={url:String(url),method:init.method??'GET',cache:init.cache,signal:init.signal};calls.push(call);
  if(call.method==='PUT'){putArrived=true;if(pausePut)await putGate.promise;const response=await f.h.route(String(url),{method:'PUT',body:init.body});assert.equal(response.status,200,await response.clone().text());if(lost){failRecovery=true;throw Error('committed reference PUT lost ACK');}return response;}
  if(failRecovery)return Response.json({error:'reference confirmation unavailable'},{status:503});const reply=await f.h.route(String(url));if(pauseRecovery){pauseRecovery=false;await readGate.promise;}return reply;
 });
 try{
  const Label=h.load('app/components/product-label-editor.tsx').ProductLabelEditor,props={productId:f.id,optionId:null,version:f.product.updated_at,profileId:f.profile.id,active:true,onBusyChange:value=>busy.push(value),onSavingChange:value=>saving.push(value),onSaved:()=>saved++};
  await h.render(Label,props);await until(h,()=>h.container.querySelector('[aria-label="최종 라벨 전체 교체 이미지"]')&&!h.container.querySelector('[aria-label="최종 라벨 전체 교체 이미지"]').disabled);
  const oldInput=handlers(textInput(h)).onChange,oldValue=textInput(h).value,next=f.keys[0];await h.React.act(async()=>{const select=h.container.querySelector('[aria-label="최종 라벨 전체 교체 이미지"]');select.value=next;select.dispatchEvent(new h.window.Event('change',{bubbles:true}));});await click(h,'선택 파일로 최종 라벨 전체 교체');const retainedRecovery=handlers(buttons(h,'선택 유지·최신 라벨 조회')[0]).onClick;await h.React.act(async()=>oldInput({target:{value:'거부되어야 할 늦은 텍스트'}}));assert.equal(textInput(h).value,oldValue,'reference dirty synchronously protects parent from retained text callback');
  await click(h,'최종 라벨 연결 저장');await until(h,()=>putArrived);assert.equal(h.container.querySelector('.product-label-editor').getAttribute('data-workspace-saving'),'true');assert.equal(h.container.querySelector('[aria-label="상품 공통 최종 라벨 연결"]').getAttribute('data-workspace-saving'),'true');assert.equal(saving.at(-1),true);assert.equal(busy.at(-1),true);assert.equal(h.load('app/workspace-close.ts').requestWorkspaceClose(h.container,()=>true),'busy');assert.equal(calls.find(call=>call.method==='PUT').signal.aborted,false);
  pausePut=false;await h.React.act(async()=>putGate.resolve());await until(h,()=>busy.at(-1)===false);
  if(lost){assert.equal(saved,0);assert.equal(h.load('app/workspace-close.ts').workspaceEditState(h.container).dirty,true);const before=calls.length;failRecovery=false;pauseRecovery=true;await h.React.act(async()=>retainedRecovery());await until(h,()=>busy.at(-1)===true);assert.equal(saving.at(-1),true,'unknown-result recovery remains a saving barrier while its fresh proof is held');readGate.resolve();await until(h,()=>busy.at(-1)===false);assert.equal(calls.slice(before).filter(call=>call.method==='PUT').length,0);assert.deepEqual(calls.slice(before).map(call=>call.url),[f.base+'/product-labels'+f.query,f.base+'/quotation-fields'+f.query,f.base+'/product-labels'+f.query]);}
  assert.equal(saved,1);assert.equal(saving.at(-1),false);assert.equal(h.load('app/workspace-close.ts').workspaceEditState(h.container).dirty,false);assert.equal(textInput(h).disabled,false);assert.equal(calls.filter(call=>call.method==='PUT').length,1);
 }finally{putGate.resolve();readGate.resolve();await h.close();f.close();}
});

test('actual BatchLabelDraftPanel still receives read busy and cannot hand off or automatically generate during the child proof',async()=>{
 const api=mobileIntakeHarness();await api.intake();await api.load('db/queries.ts').saveSettings('owner',JSON.stringify(api.settings));const product=await api.load('db/queries.ts').findProduct('owner',api.latest.product_id),gate=deferred(),calls=[],busy=[];let parentReturned=false,held=false;
 const components={'product-label-editor':true},h=await stageRefreshDOM(async(url,init={})=>{
  const stack=new Error().stack,reference=/readProductLabelReferences/.test(stack),parent=!reference&&/at read \(/.test(stack);calls.push({url:String(url),method:init.method??'GET',reference,parent});
  if(init.method&&init.method!=='GET')return Response.json({error:'no model or write in read-proof scenario'},{status:503});
  const response=String(url)==='/api/settings'?await api.load('app/api/settings/route.ts').GET():await api.route(String(url));
  if(parent)parentReturned=true;if(!held&&reference&&parentReturned&&!init.signal.aborted){held=true;await gate.promise;}return response;
 },{components});
 try{
  const Batch=h.load('app/components/batch-label-draft-panel.tsx').BatchLabelDraftPanel;await h.render(Batch,{products:[{id:product.id,title:product.title}],onBusyChange:value=>busy.push(value)});await until(h,()=>[...h.container.querySelectorAll('button')].some(node=>node.getAttribute('aria-pressed')==='false'&&!node.disabled));
  const task=[...h.container.querySelectorAll('button')].find(node=>node.getAttribute('aria-pressed')==='false'&&!node.disabled);await h.React.act(async()=>task.click());await until(h,()=>held&&textInput(h));
  assert.equal(busy.at(-1),true,'external batch continues receiving reference READ activity');assert.equal([...h.container.querySelectorAll('button[aria-pressed]')].every(node=>node.disabled),true,'batch handoff stays locked');assert.equal(textInput(h).disabled,false,'local text is editable independently of batch activity');assert.equal(calls.filter(call=>call.method!=='GET').length,0,'auto draft waits for current reference proof');
  await h.React.act(async()=>gate.resolve());await until(h,()=>calls.some(call=>call.method==='POST'));assert.equal(calls.filter(call=>call.method==='POST').length,1,'automatic draft resumes once after the exact proof resolves');assert.equal(new URL(calls.find(call=>call.method==='POST').url,'https://app.test').pathname,'/api/products/'+product.id+'/product-label-draft','only the current local rejected draft transport is reached; no model is called');
 }finally{await h.close();gate.resolve();api.close();}
});

test('actual Dashboard advances label→quotation during held read proof and closes without treating that read as a save',async()=>{
 const f=await fixture(),gate=deferred(),calls=[];let parentReturned=false,heldCall;
 const components={'product-label-editor':true},h=await stageRefreshDOM(async(url,init={})=>{
  const value=String(url),parsed=new URL(value,'https://app.test'),reference=/readProductLabelReferences/.test(new Error().stack),call={url:value,method:init.method??'GET',signal:init.signal,reference};calls.push(call);assert.equal(call.method,'GET');
  const response=parsed.pathname.startsWith(f.base+'/')?await f.h.route(value):parsed.pathname===f.base?await f.h.load('app/api/products/[id]/route.ts').GET(new Request(parsed),{params:Promise.resolve({id:f.id})}):await f.h.load('app'+parsed.pathname+'/route.ts').GET(new Request(parsed));
  if(!reference&&parsed.pathname===f.base+'/product-labels')parentReturned=true;if(!heldCall&&reference&&parentReturned&&!init.signal.aborted){heldCall=call;await gate.promise;}return response;
 },{components});
 try{
  components['use-registration-layout']=h.load('app/components/use-registration-layout.ts');const Dashboard=h.load('app/components/dashboard-client.tsx').default;
  await h.render(Dashboard,{userName:'fixture',workspaceOwnerId:'owner'});await until(h,()=>h.records.get('registration-board')?.products?.some(product=>product.id===f.id));let opened;await h.React.act(async()=>{opened=h.records.get('registration-board').onOpen(f.product,'표시사항',f.profile.id);});assert.equal(opened,true,'fixture current owner may open actual drawer');await until(h,()=>heldCall&&textInput(h));
  const next=h.container.querySelector('button[aria-label="다음 단계"]');await until(h,()=>!next.disabled);assert.equal(h.container.querySelector('.product-label-editor').getAttribute('data-workspace-saving'),'false');assert.equal(textInput(h).disabled,false);
  await h.React.act(async()=>next.click());await until(h,()=>h.container.querySelector('[data-registration-stage="견적서"]'));assert.equal(heldCall.signal.aborted,true,'navigation retires only the automatic reference READ');
  const close=h.container.querySelector('button[aria-label="상품 작업 공간 닫기"]');assert.ok(close);await h.React.act(async()=>close.click());await until(h,()=>!h.container.querySelector('.detail-drawer'));assert.ok(calls.every(call=>call.method==='GET'));
 }finally{gate.resolve();await h.close();f.close();}
});


test('canceling choices after a lost committed reference PUT ACK preserves the write-result barrier during the fresh saved-copy proof',async()=>{
 const f=await fixture(),gate=deferred(),calls=[],busy=[],saving=[];let unknown=false,readRequested=false,heldRead,saved=0;
 const h=await stageRefreshDOM(async(url,init={})=>{
  const call={url:String(url),method:init.method??'GET',cache:init.cache,signal:init.signal};calls.push(call);
  if(call.method==='PUT'){const response=await f.h.route(call.url,{method:'PUT',body:init.body});assert.equal(response.status,200,await response.clone().text());unknown=true;throw Error('committed reference PUT lost ACK');}
  if(unknown&&!readRequested)return Response.json({error:'original confirmation unavailable'},{status:503});const response=await f.h.route(call.url);
  if(readRequested&&!heldRead){heldRead=call;await gate.promise;}return response;
 });
 try{
  const Label=h.load('app/components/product-label-editor.tsx').ProductLabelEditor,props={productId:f.id,optionId:null,version:f.product.updated_at,profileId:f.profile.id,active:true,onBusyChange:value=>busy.push(value),onSavingChange:value=>saving.push(value),onSaved:()=>saved++};
  await h.render(Label,props);await until(h,()=>{const select=h.container.querySelector('[aria-label="최종 라벨 전체 교체 이미지"]');return select&&!select.disabled;});
  await h.React.act(async()=>{const select=h.container.querySelector('[aria-label="최종 라벨 전체 교체 이미지"]');select.value=f.keys[0];select.dispatchEvent(new h.window.Event('change',{bubbles:true}));});await click(h,'선택 파일로 최종 라벨 전체 교체');await click(h,'최종 라벨 연결 저장');await until(h,()=>unknown&&busy.at(-1)===false);
  const guards=h.load('app/workspace-close.ts');assert.equal(guards.workspaceEditState(h.container).dirty,true);const before=calls.length;readRequested=true;await click(h,'선택 취소·저장 라벨 조회');await until(h,()=>heldRead&&busy.at(-1)===true);
  assert.equal(guards.workspaceEditState(h.container).busy,true,'canceling choices must not classify an unknown-write confirmation as an ordinary read');assert.equal(guards.requestWorkspaceClose(h.container,()=>true),'busy');assert.equal(saving.at(-1),true);assert.equal(h.container.querySelector('.product-label-editor').getAttribute('data-workspace-saving'),'true');assert.equal(h.container.querySelector('[aria-label="상품 공통 최종 라벨 연결"]').getAttribute('data-workspace-saving'),'true');assert.equal(textInput(h).disabled,true);assert.equal(heldRead.signal.aborted,false);assert.equal(saved,0);
  await h.React.act(async()=>gate.resolve());await until(h,()=>busy.at(-1)===false);assert.equal(saving.at(-1),false);assert.equal(calls.filter(call=>call.method==='PUT').length,1);assert.deepEqual(calls.slice(before).map(call=>call.url),[f.base+'/product-labels'+f.query,f.base+'/quotation-fields'+f.query,f.base+'/product-labels'+f.query]);assert.ok(calls.slice(before).every(call=>call.method==='GET'&&call.cache==='no-store'));assert.equal(saved,0,'cancel/read cannot confirm or replay the prior write');assert.match(h.container.textContent,/상품 저장 상태가 변경되었습니다/,'the original product-version guard still rejects adoption under the old clock');
 }finally{gate.resolve();await h.close();f.close();}
});
