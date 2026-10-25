import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {sourceReviewModule,reviewSourceFixture} from './helpers/source-review-intake.mjs';
const require=createRequire(import.meta.url),turn=()=>new Promise(resolve=>setImmediate(resolve));
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
function fixture(fetcher,{initialItem,onReviewed,onChanged,existingProducts=[]}={}){
 const states=[],effects=[],cleanups=[],calls=[],added=[];let cursor=0,first=true;
 let ownerId='owner';
 const hooks={useState(initial){const index=cursor++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;return[states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;}];},useRef(initial){const index=cursor++;return states[index]??(states[index]={current:initial});},useMemo(fn,deps){const index=cursor++,previous=states[index];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i])))states[index]={deps,value:fn()};return states[index].value;},useLayoutEffect(fn){effects.push(fn);},useEffect(fn){if(first)effects.push(fn);}};
 const events=new Map(),window={addEventListener:(type,fn)=>events.set(type,fn),removeEventListener:(type,fn)=>{if(events.get(type)===fn)events.delete(type);}},exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/source-inbox-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,Error,structuredClone,setTimeout,clearTimeout,crypto,window,location:{origin:'https://app.test'},fetch:async(path,init)=>{calls.push({path,init});return fetcher(path,init);},require:name=>name==='react'?hooks:name.startsWith('@/app/')?sourceReviewModule(name.slice(2)+'.ts'):require(name)});
 const render=()=>{cursor=0;const tree=exports.SourceInboxPanel({ownerId,disabled:false,initialItem,onReviewed,onChanged,existingProducts,onAdd:item=>added.push(item)});effects.splice(0).forEach(fn=>cleanups.push(fn()));first=false;return tree;};
 return {calls,added,render,window,event:data=>events.get('message')?.({source:window,origin:'https://app.test',data}),button:label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label),owner(value){ownerId=value;render();},open:()=>render().props.onToggle({currentTarget:{open:true}}),collapse:()=>render().props.onToggle({currentTarget:{open:false}}),close:()=>cleanups.forEach(fn=>fn?.())};
}
const item={...reviewSourceFixture().before,issues:[]};
const captureDiagnostics=(patch={})=>({format:'yoofam-page-capture-diagnostics-v1',collectorVersion:'2.1.29',
 sections:{tabCount:4,knownTabCount:3,panelCount:2,linkedKnownPanelCount:2,unlinkedKnownTabCount:1},
 bodyTitles:{attributes:1,packaging:2,detail:3},description:'reference-missing',...patch});
const diagnosticsNode=h=>nodes(h.render()).find(node=>node.type==='details'&&node.props['aria-label']==='수집 진단');

test('an existing same-offer product labels recapture as a separate draft and delegates only the exact selected item',()=>{
 const existingProducts=[{source_url:item.snapshot.sourceUrl+'?tracking=old'}],before=JSON.stringify(existingProducts),h=fixture(()=>assert.fail('choosing a capture does not fetch or write'),{initialItem:item,existingProducts});
 try{const add=h.button('카테고리 선택·별도 초안 작성');assert.ok(add);assert.equal(add.props.disabled,false);assert.match(text(h.render()),/기존 작업을 유지/);add.props.onClick();assert.deepEqual(h.added,[item]);assert.equal(h.calls.length,0);assert.equal(JSON.stringify(existingProducts),before);}finally{h.close();}
});
test('inbox stays lazy, and adding a reviewed source delegates category selection without creating/updating a product',async()=>{
 const h=fixture(async()=>Response.json({ownerId:'owner',items:[item]}));try{
  h.render();assert.equal(h.calls.length,0);h.open();await turn();assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/source-inbox');
  const add=h.button('카테고리 선택·초안 작성');assert.equal(add.props.disabled,false);add.props.onClick();assert.equal(h.added.length,1);assert.equal(h.added[0].id,item.id);assert.equal(h.calls.length,1);assert.equal(h.calls.some(call=>call.init?.method==='POST'),false);
 }finally{h.close();}
});
test('closing the view aborts the pending load and cannot publish a late member response',async()=>{
 let release;const h=fixture(()=>new Promise(resolve=>{release=resolve;}));h.render();h.open();assert.equal(h.calls.length,1);h.close();assert.equal(h.calls[0].init.signal.aborted,true);release(Response.json({ownerId:'owner',items:[item]}));await turn();assert.equal(h.button('카테고리 선택·초안 작성'),undefined);assert.equal(h.added.length,0);
});

test('manual refresh shows saved server captures before waiting for an extension FLUSH',async()=>{
 const posted=[],h=fixture(async()=>Response.json({ownerId:'owner',items:[item]}));h.window.postMessage=value=>posted.push(value);
 try{h.render();h.button('수집함 불러오기').props.onClick();await turn();assert.equal(h.calls.length,1);assert.ok(h.button('카테고리 선택·초안 작성'));assert.match(text(h.render()),/서버 수집함을 불러왔습니다/);assert.equal(posted[0].type,'FLUSH');
  h.event({channel:'YOOFAM_SOURCE_INBOX_RESULT',requestId:posted[0].requestId,result:{ok:true,pending:0}});await turn();assert.equal(h.calls.length,2);assert.match(text(h.render()),/최신 수집함을 불러왔습니다/);
 }finally{h.close();}
});

test('saved notifications during a read queue a refresh and a closed loaded panel refreshes when reopened',async()=>{
 const pending=[],h=fixture(()=>new Promise(resolve=>pending.push(resolve)));
 try{h.render();h.open();h.event({channel:'YOOFAM_SOURCE_INBOX_UPDATED'});pending.shift()(Response.json({ownerId:'owner',items:[]}));await turn();assert.equal(h.calls.length,2);
  pending.shift()(Response.json({ownerId:'owner',items:[item]}));await turn();h.collapse();h.event({channel:'YOOFAM_SOURCE_INBOX_UPDATED'});assert.equal(h.calls.length,2);h.open();assert.equal(h.calls.length,3);pending.shift()(Response.json({ownerId:'owner',items:[item]}));await turn();assert.ok(h.button('카테고리 선택·초안 작성'));
 }finally{h.close();}
});

test('a late list response from the prior account cannot replace the current panel',async()=>{
 const captured={...structuredClone(item),snapshot:{...structuredClone(item.snapshot),captureDiagnostics:captureDiagnostics()}};
 let release;const h=fixture(()=>new Promise(resolve=>{release=resolve;}));try{h.render();h.open();h.owner('other');release(Response.json({ownerId:'owner',items:[captured]}));await turn();assert.equal(h.button('카테고리 선택·초안 작성'),undefined);assert.equal(diagnosticsNode(h),undefined);assert.doesNotMatch(text(h.render()),/수집기 2\.1\.29/);}finally{h.close();}
});

test('a partial capture may choose a category before reviewing missing source facts',async()=>{
 const partial={...item,issues:['공급자 SKU','위안 원가']};
 const h=fixture(async()=>Response.json({ownerId:'owner',items:[partial]}));try{
  h.render();h.open();await turn();const button=h.button('카테고리 선택·초안 작성');
  assert.equal(button.props.disabled,false);button.props.onClick();assert.equal(h.added[0].id,partial.id);
  assert.equal(h.calls.length,1);assert.ok(h.calls.every(call=>!call.init.method));
 }finally{h.close();}
});

test('same-offer recaptures remain separate choices with their own source, revision and version label',async()=>{
 const previous={...structuredClone(item),id:'original',captureVersion:1,revision:3,receivedAt:'2026-10-20T00:00:00.000Z',fingerprint:'a'.repeat(64),reviewed:{...structuredClone(item.snapshot),title:'직접 검토한 이전 원문'}};
 const latest={...structuredClone(item),id:'recapture',captureVersion:2,revision:1,receivedAt:'2026-10-20T00:01:00.000Z',fingerprint:'b'.repeat(64),snapshot:{...structuredClone(item.snapshot),title:'새로 수집한 상품'}};
 const h=fixture(async()=>Response.json({ownerId:'owner',items:[latest,previous]}));try{
  h.render();h.open();await turn();const entries=nodes(h.render()).filter(node=>node.type==='li');assert.equal(entries.length,2);
  assert.match(text(entries[0]),/새로 수집한 상품.*수집본 2/);assert.match(text(entries[1]),/직접 검토한 이전 원문.*수집본 1/);
  for(const entry of [entries[1],entries[0]])nodes(entry).find(node=>node.type==='button'&&text(node)==='카테고리 선택·초안 작성').props.onClick();
  assert.deepEqual(h.added.map(value=>[value.id,value.revision,value.fingerprint]),[['original',3,'a'.repeat(64)],['recapture',1,'b'.repeat(64)]]);
  assert.equal(h.calls.length,1);assert.ok(h.calls.every(call=>!call.init?.method),'choosing a source does not write or replace either version');
 }finally{h.close();}
});

test('unknown supplier MOQ warns alongside draft readiness and continues to category selection with only a GET',async()=>{
 const warning='공급자 최소 주문 수량 미확인 · 초안 작성 후 가격 설정에서 확인하세요.';
 const unknown={...structuredClone(item),warnings:[warning],snapshot:{...structuredClone(item.snapshot),options:[{key:'black',name:'黑色',supplierSku:'supplier-black',unitPriceCny:2.99,currency:'CNY',minimumOrder:null,stock:null,imageUrl:null}]}};
 const h=fixture(async()=>Response.json({ownerId:'owner',items:[unknown]}));
 try{
  h.render();h.open();await turn();const view=text(h.render());assert.match(view,/상품정보 준비됨 · 견적서 전송 전 검토 필요/);assert.ok(view.includes(warning));assert.doesNotMatch(view,/전송 완료|접수 완료|등록 완료/);
  const button=h.button('카테고리 선택·초안 작성');assert.equal(button.props.disabled,false);button.props.onClick();
  assert.equal(h.added.length,1);assert.deepEqual(h.added[0],unknown);assert.equal(h.added[0].snapshot.options[0].minimumOrder,null);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/source-inbox');assert.equal(h.calls[0].init.method,undefined);
 }finally{h.close();}
});

test('review keeps MOQ blank as null without inventing required SKU, price or currency values',async()=>{
 const warning='공급자 최소 주문 수량 미확인 · 초안 작성 후 가격 설정에서 확인하세요.';
 const unknown={...structuredClone(item),warnings:[warning],snapshot:{...structuredClone(item.snapshot),options:[{key:'black',name:'黑色',supplierSku:'supplier-black',unitPriceCny:2.99,currency:'CNY',minimumOrder:null,stock:null,imageUrl:null}]}};
 let payload;
 const h=fixture(async(_path,init)=>{if(init.method==='PUT'){payload=JSON.parse(init.body);return Response.json({ownerId:'owner',item:{...unknown,revision:2,reviewed:{...unknown.snapshot,options:unknown.snapshot.options.map(row=>({...row,...payload.review.options.find(option=>option.key===row.key)}))}}});}
  return Response.json({ownerId:'owner',items:[unknown]});});
 try{
  h.render();h.open();await turn();h.button('상품정보 확인').props.onClick();
  const control=()=>nodes(h.render()).find(node=>node.props?.['aria-label']==='1번째 최소 주문 수량');assert.equal(control().props.value,'');assert.match(control().props.placeholder,/미확인.*공란/);
  assert.match(text(h.render()),/최소 주문 수량은 미확인이면 공란으로 두고 초안을 작성할 수 있습니다/);
  control().props.onChange({target:{value:'3'}});assert.equal(control().props.value,3);control().props.onChange({target:{value:''}});assert.equal(control().props.value,'');
  const save=h.button('검토한 상품정보 저장');assert.equal(save.props.disabled,false);save.props.onClick();await turn();
  assert.equal(payload.review.options[0].minimumOrder,null);assert.equal(payload.review.options[0].supplierSku,'supplier-black');assert.equal(payload.review.options[0].unitPriceCny,2.99);assert.equal(payload.review.options[0].currency,'CNY');
  assert.deepEqual(h.calls.map(call=>call.init.method??'GET'),['GET','PUT']);assert.equal(h.added.length,0);
 }finally{h.close();}
});

test('review UI delivers the strict saved acknowledgement before list refresh without creating a product',async()=>{
 const {before,saved}=reviewSourceFixture(),events=[];
 const h=fixture(async(_path,init)=>{assert.equal(init.method,'PUT');return Response.json({ownerId:'owner',item:saved});},
  {initialItem:before,onReviewed:(result,original)=>events.push({type:'reviewed',result,original}),onChanged:()=>events.push({type:'changed'})});
 try{h.button('검토한 상품정보 저장').props.onClick();await turn();assert.deepEqual(events.map(value=>value.type),['reviewed','changed']);
  assert.deepEqual(events[0].result,saved);assert.deepEqual(events[0].original,before);assert.equal(h.calls.length,1);assert.equal(h.added.length,0);assert.match(text(h.render()),/저장했습니다/);
 }finally{h.close();}
});

test('invalid review ACK cannot publish a callback, refresh the parent or close the review',async()=>{
 const {before,saved}=reviewSourceFixture();
 for(const patch of [{revision:3},{ownerId:'other'},{fingerprint:'b'.repeat(64)},{snapshot:{...saved.snapshot,title:'바뀐 최초 원문'}},{company:{code:'A01526306',name:'유앤채'}}]){
  const events=[],h=fixture(async()=>Response.json({ownerId:'owner',item:{...saved,...patch}}),{initialItem:before,onReviewed:()=>events.push('reviewed'),onChanged:()=>events.push('changed')});
  try{h.button('검토한 상품정보 저장').props.onClick();await turn();assert.deepEqual(events,[]);assert.ok(h.button('검토한 상품정보 저장'));assert.match(text(h.render()),/저장을 확인하지 못했습니다/);}
  finally{h.close();}
 }
});

test('old review handlers and responses cannot act after account changes or the review closes',async()=>{
 const {before,saved}=reviewSourceFixture(),events=[];let release;
 const h=fixture(()=>new Promise(resolve=>{release=resolve;}),{initialItem:before,onReviewed:()=>events.push('reviewed'),onChanged:()=>events.push('changed')});
 try{const save=h.button('검토한 상품정보 저장');save.props.onClick();h.owner('other');release(Response.json({ownerId:'owner',item:saved}));await turn();assert.deepEqual(events,[]);assert.equal(h.calls.length,1);
  save.props.onClick();assert.equal(h.calls.length,1);
 }finally{h.close();}
 const closed=fixture(async()=>{throw Error('no stale write');},{initialItem:before});try{const save=closed.button('검토한 상품정보 저장');closed.button('닫기').props.onClick();closed.render();save.props.onClick();assert.equal(closed.calls.length,0);}finally{closed.close();}
});

test('capture diagnostics show immutable observed counts and collector version rather than reviewed values without requests',()=>{
 const original=structuredClone(item);
 original.snapshot.captureDiagnostics=captureDiagnostics();
 original.snapshot.attributes=[{name:'材质',value:'棉'},{name:'颜色',value:'黑'}];
 original.snapshot.options=[{...original.snapshot.options[0],packaging:{source:'package-table',weightG:15}},
  {...original.snapshot.options[0],key:'gray'},
  {...original.snapshot.options[0],key:'blue',packaging:{source:'package-table',widthMm:5}}];
 original.snapshot.images.push({url:'https://cbu01.alicdn.com/detail-one.png',role:'detail'},{url:'https://cbu01.alicdn.com/detail-two.png',role:'detail'});
 original.reviewed={...structuredClone(original.snapshot),captureDiagnostics:captureDiagnostics({collectorVersion:'99.8.7'}),attributes:[],options:[original.snapshot.options[1]],images:[]};
 const before=JSON.stringify(original),h=fixture(()=>assert.fail('reading capture diagnostics does not fetch or write'),{initialItem:original});
 try{
  const panel=diagnosticsNode(h),view=text(panel);assert.ok(panel);assert.equal(panel.props.open,undefined);
  assert.match(view,/수집기 2\.1\.29/);assert.doesNotMatch(view,/99\.8\.7/);
  assert.match(view,/제품속성 2개 · 포장정보 2\/3옵션 · 상세이미지 2장/);
  assert.match(view,/탭 4개 · 상품정보 탭 3개 · 본문 패널 2개 · 연결 확인 2개 · 연결 미확인 1개/);
  assert.match(view,/일반 본문 제목: 속성 1개 · 포장 2개 · 상세 3개/);
  assert.match(view,/현재 상품의 상세문서 주소를 찾지 못했습니다/);
  assert.equal(panel.props.onToggle,undefined,'expansion is native display with no action');
  h.button('카테고리 선택·초안 작성').props.onClick();assert.deepEqual(h.added,[original]);assert.equal(h.calls.length,0);assert.equal(JSON.stringify(original),before);
 }finally{h.close();}
});

test('each selected recapture displays only its own diagnostics and old captures explicitly lack records',async()=>{
 const latest={...structuredClone(item),id:'latest',captureVersion:2,snapshot:{...structuredClone(item.snapshot),captureDiagnostics:captureDiagnostics()}},previous={...structuredClone(item),id:'previous',captureVersion:1};
 const before=JSON.stringify([latest,previous]),h=fixture(async()=>Response.json({ownerId:'owner',items:[latest,previous]}));
 try{
  h.render();h.open();await turn();
  const entries=()=>nodes(h.render()).filter(node=>node.type==='li');
  const open=index=>nodes(entries()[index]).find(node=>node.type==='button'&&text(node)==='상품정보 확인').props.onClick();
  open(0);assert.match(text(diagnosticsNode(h)),/수집기 2\.1\.29/);h.button('닫기').props.onClick();
  open(1);const older=text(diagnosticsNode(h));assert.match(older,/수집 진단 · 기록 없음/);assert.match(older,/수집기 버전·진단 기록이 없습니다/);assert.doesNotMatch(older,/2\.1\.29|연결 확인 2개/);
  assert.deepEqual(h.calls.map(call=>[call.path,call.init.method??'GET']),[['/api/source-inbox','GET']]);assert.equal(JSON.stringify([latest,previous]),before);
 }finally{h.close();}
});

test('malformed capture diagnostics show a safe unavailable state without exposing untrusted metadata',()=>{
 const marker='UNTRUSTED_DIAGNOSTIC_TEXT';
 for(const invalid of [null,undefined,captureDiagnostics({collectorVersion:marker}),captureDiagnostics({description:marker}),captureDiagnostics({rawPageText:marker}),
  captureDiagnostics({sections:{tabCount:4,knownTabCount:3,panelCount:2,linkedKnownPanelCount:2,unlinkedKnownTabCount:2}}),
  captureDiagnostics({bodyTitles:{attributes:60,packaging:1,detail:0}})]){
  const captured={...structuredClone(item),snapshot:{...structuredClone(item.snapshot),captureDiagnostics:invalid}},before=JSON.stringify(captured);
  const h=fixture(()=>assert.fail('invalid diagnostic display must not fetch'),{initialItem:captured});
  try{const view=text(diagnosticsNode(h));assert.match(view,/수집 진단 · 기록 확인 불가/);assert.match(view,/진단 기록의 형식을 확인할 수 없습니다/);assert.doesNotMatch(view,new RegExp(marker+'|수집기 2\\.1\\.28|일반 본문 제목|수집 당시 문서 영역'));assert.equal(h.calls.length,0);assert.equal(JSON.stringify(captured),before);}finally{h.close();}
 }
});

test('description diagnostic states use fixed labels and optional body-title records stay absent',()=>{
 const messages={'not-needed':'별도 상세문서 조회가 필요하지 않았습니다','reference-missing':'상세문서 주소를 찾지 못했습니다',
  'reference-invalid':'일치하는 상세문서 주소를 확인하지 못했습니다',unavailable:'상세문서에서 추가 자료를 확인하지 못했습니다',captured:'연결된 상세문서에서 상세이미지를 수집했습니다'};
 for(const [description,message]of Object.entries(messages)){
  const diagnostic=captureDiagnostics({description});delete diagnostic.bodyTitles;
  const captured={...structuredClone(item),snapshot:{...structuredClone(item.snapshot),captureDiagnostics:diagnostic}},h=fixture(()=>assert.fail('display only'),{initialItem:captured});
  try{const view=text(diagnosticsNode(h));assert.ok(view.includes(message));assert.doesNotMatch(view,/일반 본문 제목/);assert.equal(h.calls.length,0);}finally{h.close();}
 }
});

test('review saves only editable source facts and retains immutable capture diagnostics',async()=>{
 const {before,saved}=reviewSourceFixture();before.snapshot.captureDiagnostics=captureDiagnostics();saved.snapshot.captureDiagnostics=captureDiagnostics();saved.reviewed.captureDiagnostics=captureDiagnostics();
 const original=JSON.stringify(before),events=[];let payload;
 const h=fixture(async(path,init)=>{assert.equal(path,'/api/source-inbox');assert.equal(init.method,'PUT');payload=JSON.parse(init.body);return Response.json({ownerId:'owner',item:saved});},{initialItem:before,onReviewed:(value,prior)=>events.push({value,prior})});
 try{
  assert.match(text(diagnosticsNode(h)),/수집기 2\.1\.29/);h.button('검토한 상품정보 저장').props.onClick();await turn();
  assert.deepEqual(Object.keys(payload).sort(),['expectedOwnerId','expectedRevision','id','review']);assert.deepEqual(Object.keys(payload.review).sort(),['options','title']);
  for(const option of payload.review.options)assert.deepEqual(Object.keys(option).sort(),['currency','key','minimumOrder','name','supplierSku','unitPriceCny']);
  assert.equal(events.length,1);assert.deepEqual(events[0].value.snapshot.captureDiagnostics,captureDiagnostics());assert.equal(events[0].prior,before);assert.equal(h.added.length,0);
  h.button('상품정보 확인').props.onClick();assert.match(text(diagnosticsNode(h)),/수집기 2\.1\.29/);assert.equal(h.calls.length,1);assert.equal(JSON.stringify(before),original);
 }finally{h.close();}
});
