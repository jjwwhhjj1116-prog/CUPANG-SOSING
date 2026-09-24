import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const nativeRequire=createRequire(import.meta.url);
function load(file,dependencies){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,setTimeout:(fn)=>setImmediate(fn),fetch:dependencies.fetch,require(name){if(name in dependencies)return dependencies[name];if(name==='react/jsx-runtime')return nativeRequire(name);return load(name.slice(2)+'.ts',dependencies);}});return exports;}
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return[];return[tree,...nodes(tree.props?.children)];}
const result={title:'수집 상품 원문',provider:'synthetic',collectedAt:'2026-01-01T00:00:00Z',sourceUrl:'https://detail.1688.com/offer/123.html',description:'판매자 설명',options:[{sku:'a',name:'옵션 A',unitPriceCny:2,minimumOrder:1,stock:1}],images:[{url:'https://cbu01.alicdn.com/a.png',role:'main'},{url:'https://cbu01.alicdn.com/b.png',role:'detail'}]};
const capacity={usedSlots:0,totalImages:2,reusableIndices:[]};
function harness(fetcher,importer){const states=[],refs=[];let index=0,ri=0,saved=0;const hooks={useState(initial){const slot=index++;if(slot>=states.length)states.push(initial);return[states[slot],next=>{states[slot]=typeof next==='function'?next(states[slot]):next;}];},useRef(initial){const slot=ri++;if(slot>=refs.length)refs.push({current:initial});return refs[slot];},useEffect(){}};const panel=load('app/components/collection-result-panel.tsx',{react:hooks,fetch:fetcher,...(importer?{'@/app/collection-import':{runCollectionImport:importer}}:{})});const render=()=>{index=0;ri=0;const root=panel.CollectionResultPanel({jobId:'job',onSaved(){saved++;}});return root.type(root.props);};const find=predicate=>{const node=nodes(render()).find(predicate);assert.ok(node);return node;};const button=name=>find(n=>n.type==='button'&&n.props.children===name);return{render,find,button,get saved(){return saved;},async click(name){button(name).props.onClick();for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));}};}

test('capacity failure retains receipt and options; capacity-only retry and product promotion remain available',async()=>{
 const calls=[];let fail=true;
 const h=harness(async(url,init)=>{calls.push([url,init?.method]);if(url.endsWith('/result'))return Response.json({receipt:{result},message:'수신됨'});if(url.endsWith('/product'))return Response.json({productId:'p'});return fail?Response.json({error:'저장소 일시 오류'},{status:503}):Response.json({capacity});});
 await h.click('수신 결과 조회');assert.match(JSON.stringify(h.render()),/수집 상품 원문/);assert.match(JSON.stringify(h.render()),/옵션 A/);assert.match(JSON.stringify(h.render()),/원문은 유지/);
 assert.equal(h.button('원문을 상품·옵션으로 반영').props.disabled,false);
 assert.equal(h.find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children[0]==='상품·선택 이미지 ').props.disabled,true);
 fail=false;await h.click('이미지 저장 상태 다시 조회');assert.equal(calls.filter(([url])=>url.endsWith('/result')).length,1);assert.doesNotMatch(JSON.stringify(h.render()),/저장소 일시 오류/);
 await h.click('원문을 상품·옵션으로 반영');assert.equal(h.saved,1);assert.equal(calls.filter(([,method])=>method==='POST').length,1);
});

test('import refreshes capacity, removes newly blocked selections and preserves remaining user choice',async()=>{
 let reads=0,imports=0;
 const h=harness(async url=>url.endsWith('/result')?Response.json({receipt:{result},message:'수신됨'}):Response.json({capacity:++reads===1?capacity:{...capacity,usedSlots:1,reusableIndices:[1],blockedIndices:[0]}}),async()=>{imports++;return{status:'completed',productId:'p',completedImages:2};});
 await h.click('수신 결과 조회');const run=h.find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children[0]==='상품·선택 이미지 ');run.props.onClick();for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(imports,1);assert.equal(reads,2);assert.equal(h.saved,1);
 const checks=nodes(h.render()).filter(n=>n.type==='input');assert.equal(checks[0].props.checked,false);assert.equal(checks[0].props.disabled,true);assert.equal(checks[1].props.checked,true);
 assert.match(JSON.stringify(h.render()),/원본 이미지 2개 저장을 확인/);
});

test('duplicate clicks are coalesced and refresh failures never erase a displayed receipt',async()=>{
 let finish,calls=0,fail=false;const pending=new Promise(resolve=>{finish=resolve;});
 const h=harness(async url=>{calls++;if(fail)throw Error('연결 끊김');if(url.endsWith('/result')){await pending;return Response.json({receipt:{result},message:'수신됨'});}return Response.json({capacity});});
 const click=h.button('수신 결과 조회').props.onClick;click();click();assert.equal(calls,1);finish();for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
 fail=true;await h.click('수신 결과 조회');assert.match(JSON.stringify(h.render()),/수집 상품 원문/);assert.match(JSON.stringify(h.render()),/연결 끊김/);
});

test('product button retries transient failures through the real importer without image requests',async()=>{
 const writes=[];let capacityReads=0;
 const h=harness(async(url,init)=>{
  if(url.endsWith('/result'))return Response.json({receipt:{result},message:'수신됨'});
  if(url.endsWith('/capacity')){capacityReads++;return Response.json({error:'이미지 저장소 오류'},{status:503});}
  writes.push([url,init.method]);return writes.length===1?Response.json({error:'일시 오류'},{status:503}):Response.json({productId:'p'});
 });
 await h.click('수신 결과 조회');await h.click('원문을 상품·옵션으로 반영');
 assert.equal(writes.length,2);assert.ok(writes.every(([url,method])=>url.endsWith('/product')&&method==='POST'));
 assert.equal(capacityReads,1);assert.equal(h.saved,1);assert.match(JSON.stringify(h.render()),/상품 관리에 반영했습니다/);
});

test('product button stops retry after in-flight failure and never reports an unconfirmed save',async()=>{
 let finish,writes=0;const pending=new Promise(resolve=>{finish=resolve;});
 const h=harness(async url=>{
  if(url.endsWith('/result'))return Response.json({receipt:{result},message:'수신됨'});
  if(url.endsWith('/capacity'))return Response.json({capacity});
  writes++;await pending;return Response.json({error:'연결 오류'},{status:503});
 });
 await h.click('수신 결과 조회');const click=h.button('원문을 상품·옵션으로 반영').props.onClick;click();click();
 assert.equal(writes,1);h.button('연속 작업 중단').props.onClick();finish();
 for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(writes,1);assert.equal(h.saved,0);assert.match(JSON.stringify(h.render()),/상품 반영 미확인/);
 assert.equal(h.button('원문을 상품·옵션으로 반영').props.disabled,false);
});

test('large receipts recommend main and option images, preserve manual choice on refresh and apply only selected indices',async()=>{
 const source={...result,images:Array.from({length:60},(_,i)=>({url:`https://cbu01.alicdn.com/${i}.png`,role:i===55?'main':i===30?'additional':'detail'})),options:[{...result.options[0],imageIndex:59}]};
 const cap={usedSlots:47,totalImages:60,reusableIndices:[0],blockedIndices:[1]};let applied;const requests=[];
 const h=harness(async(url,init)=>{requests.push([url,init?.method]);return url.endsWith('/result')?Response.json({receipt:{result:source},message:'수신됨'}):Response.json({capacity:cap});},async(_job,_total,options)=>{applied=Array.from(options.imageIndices);return{status:'completed',productId:'p',completedImages:applied.length};});
 const selected=()=>nodes(h.render()).filter(n=>n.type==='input').flatMap((n,i)=>n.props.checked?[i]:[]);
 await h.click('수신 결과 조회');assert.deepEqual(selected(),[0,30,55,59]);assert.equal(requests.filter(([,method])=>method==='POST').length,0);
 const checks=nodes(h.render()).filter(n=>n.type==='input');checks[30].props.onChange({target:{checked:false}});
 await h.click('이미지 저장 상태 다시 조회');assert.deepEqual(selected(),[0,55,59]);
 await h.click('선택 해제');assert.deepEqual(selected(),[]);await h.click('저장 여유에 맞춰 추천 선택');assert.deepEqual(selected(),[0,30,55,59]);
 h.find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children[0]==='상품·선택 이미지 ').props.onClick();
 for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(applied,[0,30,55,59]);assert.equal(h.saved,1);assert.equal(nodes(h.render()).filter(n=>n.type==='input').length,60);
});

test('import displays image assignment warnings alongside confirmed file storage',async()=>{
 const h=harness(async url=>url.endsWith('/result')?Response.json({receipt:{result},message:'수신됨'}):Response.json({capacity}),async()=>({status:'completed',productId:'p',completedImages:2,warnings:['원본 2번: 상세 배치에 연결되지 않았습니다.']}));
 await h.click('수신 결과 조회');h.find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children[0]==='상품·선택 이미지 ').props.onClick();
 for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.match(JSON.stringify(h.render()),/저장된 원본의 연결 확인 필요/);assert.match(JSON.stringify(h.render()),/원본 2번: 상세 배치/);assert.equal(h.saved,1);
 await h.click('수신 결과 조회');assert.doesNotMatch(JSON.stringify(h.render()),/저장된 원본의 연결 확인 필요/);
});
