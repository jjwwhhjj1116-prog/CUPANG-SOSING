import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url),nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));};
const version='2026-10-05T00:00:00.000Z',next='2026-10-05T00:00:00.001Z';
function harness(prepare,onBusyChange){
 const state=[],refs=[],effects=[],cleanups=[],requests=[],opened=[],cache=new Map();let si=0,ri=0,first=true;
 const hooks={useState(initial){const i=si++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return[state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},useRef(initial){const i=ri++;return refs[i]??(refs[i]={current:initial});},useEffect(fn){if(first)effects.push(fn);},useLayoutEffect(fn){fn();}};
 const fetcher=async function(url,init){assert.equal(this,undefined,'native fetch cannot receive helper options as its receiver');requests.push({url,init});if(url==='/api/products/p')return Response.json({product:{id:'p',updated_at:version}});if(url.endsWith('/work-draft'))return prepare();assert.equal(url,'/api/products/p/automation');const body=JSON.parse(init.body);return Response.json({workflow:{productId:'p',productVersion:body.expectedVersion,stages:[{id:'pricing',status:'complete'},{id:'mainImage',status:'draft'},{id:'additionalImages',status:'draft'},{id:'detailImage',status:'draft'},{id:'quotation',status:'blocked'}]}});};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,crypto,fetch:fetcher,require:name=>name==='react'?hooks:name.includes('/batch-seo-work-panel')?{BatchSeoWorkPanel:()=>null}:name.includes('/batch-label-panel')?{BatchLabelPanel:()=>null}:name.includes('/batch-label-draft-panel')?{BatchLabelDraftPanel:()=>null}:name.includes('/batch-image-work-panel')?{BatchImageWorkPanel:()=>null}:name.includes('/batch-translation-panel')?{BatchTranslationPanel:()=>null}:name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name)});return exports;}
 const component=load('app/components/batch-work-panel.tsx').BatchWorkPanel;
 const render=()=>{si=0;ri=0;const tree=component({products:[{id:'p',title:'검토 상품',updated_at:version}],onOpen:(...values)=>opened.push(values),onBusyChange});if(first){first=false;effects.forEach(fn=>cleanups.push(fn()));}return tree;};
 const button=label=>nodes(render()).find(node=>node.type==='button'&&node.props.children===label);
 return {render,button,requests,opened,unmount(){cleanups.forEach(fn=>fn?.());}};
}

test('work panel explicitly prepares drafts once, uses the saved version and opens the matching review stage',async()=>{
 let finish;const h=harness(()=>new Promise(resolve=>{finish=resolve;}));
 h.button('이미지 초안 검토').props.onClick();h.button('견적 초안 검토').props.onClick();
 assert.deepEqual(h.opened,[['p','대표 이미지'],['p','견적서']]);
 const start=h.button('선택 상품 초안 준비·가격 확인').props.onClick;start();start();await settle();
 assert.equal(h.requests.length,0,'SEO review comes before work-draft and pricing');
 const seo=nodes(h.render()).find(node=>typeof node.type==='function'&&node.props.onComplete);assert.ok(seo);seo.props.onBusyChange(false);seo.props.onComplete(seo.props.products);await settle();
 assert.equal(h.requests.filter(request=>request.url.endsWith('/work-draft')).length,1);
 assert.equal(h.button('이미지 초안 검토').props.disabled,true);
 finish(Response.json({productId:'p',productVersion:next,prepared:true,changedRoles:3,changedOptions:6,availableImages:19,message:'원본 이미지 초안을 연결했습니다. 각 단계에서 검토해주세요.'}));await settle();
 const automation=h.requests.find(request=>request.url.endsWith('/automation'));assert.equal(JSON.parse(automation.init.body).expectedVersion,next);
 const status=nodes(h.render()).find(node=>node.props.role==='status').props.children;
 assert.match(status,/원본 이미지 초안/);assert.match(status,/가격 확인됨/);assert.match(status,/저장 초안 3단계/);assert.ok(!status.includes('이미지 완료'));
 assert.equal(h.button('이미지 초안 검토').props.disabled,false);
 const imageReview=nodes(h.render()).find(node=>typeof node.type==='function'&&node.props.onPendingChange);
 assert.ok(imageReview,'work start advances into the image review queue');assert.equal(imageReview.props.autoPrepare,true);
 imageReview.props.onPendingChange(true);assert.equal(h.button('이미지 초안 검토').props.disabled,true);
 h.button('← 초안 준비 작업').props.onClick();assert.ok(nodes(h.render()).some(node=>node.props.onPendingChange),'pending preview cannot be discarded by back navigation');
 imageReview.props.onPendingChange(false);assert.equal(h.button('이미지 초안 검토').props.disabled,false);
});

test('label running and uncertain-save callbacks keep the parent mode and release navigation only after resolution',()=>{
 const events=[],h=harness(()=>{throw Error('no write expected');},value=>events.push(value));
 try{
  h.button('선택 상품 표시사항 PNG 일괄 생성·연결').props.onClick();
  const back=h.button('← 초안 준비 작업').props.onClick;
  const labels=nodes(h.render()).find(node=>typeof node.type==='function'&&node.props.onBusyChange);
  assert.ok(labels);
  labels.props.onBusyChange(true);back();
  assert.equal(h.button('← 초안 준비 작업').props.disabled,true);
  assert.equal(h.requests.length,0);
  labels.props.onBusyChange(false);
  assert.equal(h.button('← 초안 준비 작업').props.disabled,false);
  back();assert.ok(h.button('선택 상품 표시사항 PNG 일괄 생성·연결'));
  assert.deepEqual(events,[true,false]);
 }finally{h.unmount();}
});

test('work panel keeps an unavailable-source explanation with price results and stops after closing during preparation',async()=>{
 const h=harness(async()=>Response.json({productId:'p',productVersion:version,prepared:false,changedRoles:0,changedOptions:0,availableImages:0,message:'연결된 수집 원문이 없어 이미지 초안을 만들지 않았습니다.'}));
 h.button('선택 상품 초안 준비·가격 확인').props.onClick();let seo=nodes(h.render()).find(node=>node.props.onComplete);seo.props.onBusyChange(false);seo.props.onComplete(seo.props.products);await settle();assert.match(nodes(h.render()).find(node=>node.props.role==='status').props.children,/수집 원문이 없어/);
 let finish;const closed=harness(()=>new Promise(resolve=>{finish=resolve;}));closed.button('선택 상품 초안 준비·가격 확인').props.onClick();seo=nodes(closed.render()).find(node=>node.props.onComplete);seo.props.onBusyChange(false);seo.props.onComplete(seo.props.products);await settle();closed.unmount();
 assert.equal(closed.requests.at(-1).init.signal.aborted,true);
 finish(Response.json({productId:'p',productVersion:next,prepared:true,changedRoles:3,changedOptions:6,availableImages:19,message:'초안 검토 필요'}));await settle();
 assert.equal(closed.requests.some(request=>request.url.endsWith('/automation')),false);
});

test('stage-six draft review is an explicit action and preserves pending edits before PNG generation or navigation',()=>{
 const events=[],h=harness(()=>{throw Error('No product write expected');},value=>events.push(value));
 try{
  h.button('선택 상품 표시사항 초안 작성·검토').props.onClick();
  const draft=nodes(h.render()).find(node=>typeof node.type==='function'&&node.props.autoGenerateDraft===true);
  assert.ok(draft);assert.deepEqual(draft.props.products.map(product=>product.id),['p']);assert.equal(h.requests.length,0);
  const back=h.button('← 초안 준비 작업').props.onClick,next=h.button('다음: 저장한 표시사항 PNG 일괄 생성·연결').props.onClick;
  draft.props.onBusyChange(true);back();next();assert.equal(h.button('견적 초안 검토').props.disabled,true);
  draft.props.onPendingChange(true);draft.props.onBusyChange(false);back();next();
  assert.equal(h.button('다음: 저장한 표시사항 PNG 일괄 생성·연결').props.disabled,true);
  assert.ok(nodes(h.render()).some(node=>node.props.autoGenerateDraft===true));
  draft.props.onPendingChange(false);next();
  assert.ok(nodes(h.render()).some(node=>typeof node.type==='function'&&node.props.onBusyChange&&!node.props.onPendingChange));
  assert.deepEqual(events,[true,true,true,false]);assert.equal(h.requests.length,0);
 }finally{h.unmount();}
});

test('image review advances to stage-six only after its busy and pending results are resolved',()=>{
 const h=harness(()=>{throw Error('No product write expected');});try{
  h.button('대표·추가·상세 이미지 모아서 번역').props.onClick();
  const image=nodes(h.render()).find(node=>typeof node.type==='function'&&node.props.autoPrepare===false);
  const next=h.button('다음: 한글표시사항 초안 작성').props.onClick;
  image.props.onBusyChange(true);next();assert.equal(h.button('다음: 한글표시사항 초안 작성').props.disabled,true);
  image.props.onPendingChange(true);image.props.onBusyChange(false);next();assert.ok(h.button('다음: 한글표시사항 초안 작성'));
  image.props.onPendingChange(false);next();
  assert.ok(nodes(h.render()).some(node=>node.props.autoGenerateDraft===true));assert.equal(h.requests.length,0);
 }finally{h.unmount();}
});
