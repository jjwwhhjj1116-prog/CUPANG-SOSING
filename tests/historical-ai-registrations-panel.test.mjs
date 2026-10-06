import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {historicalHarness,historicalRow,historicalQuote,historicalDocument as doc} from './helpers/historical-ai-registrations.mjs';
const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
function ui(h,fetcher=h.fetcher,initialProps={}){
 const states=[],effects=[];let cursor=0,tree,props=initialProps;
 const hooks={useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>states[i]=typeof value==='function'?value(states[i]):value];},useRef(initial){const i=cursor++;return states[i]??(states[i]={current:initial});},useCallback(fn,deps){const i=cursor++,old=states[i];if(!old||deps.some((value,j)=>!Object.is(value,old.deps[j])))states[i]={deps,callback:fn};return states[i].callback;},useEffect(fn,deps){const i=cursor++,old=states[i];if(!old||deps.some((value,j)=>!Object.is(value,old.deps[j]))){const next={deps};states[i]=next;effects.push(()=>{old?.cleanup?.();next.cleanup=fn();});}}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/historical-ai-registrations-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,URLSearchParams,queueMicrotask,fetch:fetcher,require:name=>name==='react'?hooks:name==='@/app/historical-ai-registrations'?h.load('app/historical-ai-registrations.ts'):native(name)});
 const render=()=>{cursor=0;tree=exports.default(props);effects.splice(0).forEach(effect=>effect());return tree;};
 const button=label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label);
 render();return{render,button,
  select(documents){nodes(render()).find(node=>node.type==='input'&&node.props.type==='file').props.onChange({target:{files:documents.map(document=>new File([document.text],document.name,{type:'application/json'}))}});render();},
  click(label){const node=button(label);assert.ok(node&&!node.props.disabled,label);node.props.onClick();render();},
  async flush(){for(let i=0;i<8;i++){await new Promise(resolve=>setImmediate(resolve));render();}},
  async waitUntil(check){const deadline=Date.now()+3000;do{await new Promise(resolve=>setTimeout(resolve,1));if(check(render()))return;}while(Date.now()<deadline);assert.fail('historical UI response timed out');},
  search(value){nodes(render()).find(node=>node.type==='input'&&node.props.maxLength===200).props.onChange({target:{value}});render();nodes(render()).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});render();},
  close(){states.forEach(state=>state?.cleanup?.());},
  setProps(next){props=next;render();},
 };
}

test('actual panel preview and explicit save round-trip through API/SQLite, preserve partial fields and never create products',async()=>{
 const h=historicalHarness(),panel=ui(h);try{
  await panel.flush();panel.select([doc('page1.json',[historicalRow(),historicalRow('261002001001_1',3)]),doc('quote.json',historicalQuote())]);panel.click('기록 미리보기');await panel.flush();
  assert.match(text(panel.render()),/원본 등록 목록 2개 · 부분 견적자료 1개 · 신규 3개/);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM historical_ai_records').get().n,0);
  panel.click('원본 기록 보관');await panel.flush();assert.match(text(panel.render()),/원본 등록 기록 2개 · 원본에 표시된 옵션 수 합계 5개/);assert.match(text(panel.render()),/신규 3개 기록을 보관/);
  panel.click('자료 1개 보기');await panel.flush();assert.match(text(panel.render()),/명시 공란빈칸/);assert.match(text(panel.render()),/배터리선택 안 함/);assert.match(text(panel.render()),/원본 옵션번호 261002001001/);
  panel.search('261002001001_1');await panel.flush();assert.match(text(panel.render()),/원본 등록 기록 1개 · 원본에 표시된 옵션 수 합계 3개/);
  assert.ok(h.state.calls.every(call=>call.url.startsWith('/api/historical-ai-registrations')));assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM products').get().n,0);
 }finally{panel.close();h.close();}
});

test('lost committed response keeps chosen files and retry uses the identical preview without duplicate or replacement writes',async()=>{
 const h=historicalHarness();let lose=true;const panel=ui(h,async(url,init)=>{const response=await h.fetcher(url,init);if(init?.method==='POST'&&JSON.parse(init.body).action==='import'&&lose){lose=false;throw Error('시험 응답 유실');}return response;});try{
  await panel.flush();panel.select([doc('page.json',[historicalRow()])]);panel.click('기록 미리보기');await panel.flush();panel.click('원본 기록 보관');await panel.flush();
  assert.match(text(panel.render()),/시험 응답 유실/);assert.ok(panel.button('원본 기록 보관'));const before=JSON.stringify(h.sqlite.prepare('SELECT * FROM historical_ai_records').all());
  panel.click('원본 기록 보관');await panel.flush();assert.match(text(panel.render()),/신규 0개 기록을 보관했습니다. 동일한 원본 1개는 유지/);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM historical_ai_records').all()),before);
  const commits=h.state.calls.filter(call=>call.method==='POST'&&JSON.parse(call.body).action==='import');assert.equal(commits.length,2);assert.equal(commits[0].body,commits[1].body);
 }finally{panel.close();h.close();}
});

test('actual forbidden account response hides the panel while server and network errors remain visible',async()=>{
 const h=historicalHarness();h.state.user={userId:'admin-test',verifiedAccess:true,membership:{id:'admin-test',email:'jwhj1116@kakao.com',role:'admin',status:'approved',companyCode:'A01526306',companyName:'유앤채'}};
 const hidden=ui(h);try{await hidden.flush();assert.equal(hidden.render(),null);assert.equal(h.state.calls.length,1);assert.equal(h.state.calls[0].method,'GET');}finally{hidden.close();}
 for(const fetcher of [async()=>Response.json({error:'시험 서버 오류'},{status:503}),async()=>{throw Error('시험 네트워크 오류');}]){
  const visible=ui(h,fetcher);try{await visible.flush();assert.ok(nodes(visible.render()).some(node=>node.props?.['aria-label']==='쿠플러스 원본 AI 등록 기록'));assert.ok(nodes(visible.render()).some(node=>node.props?.role==='alert'&&/시험/.test(text(node))));}finally{visible.close();}
 }
 h.close();
});

async function storedHistory(h){const row=historicalRow();row.cells[13]='등록완료';const documents=[doc('page.json',[row]),doc('quote.json',historicalQuote())],preview=await(await h.submit(documents)).json();assert.equal((await h.submit(documents,{action:'import',sha256:preview.sha256})).status,200);}
const unchangedHistory=h=>JSON.stringify(['historical_ai_records','products','product_content','product_options','collection_jobs','supplier_hub_receipts'].map(table=>h.sqlite.prepare(`SELECT * FROM ${table}`).all()));

test('explicit URL reuse passes only the exact current source and account to its parent without changing originals or partial quotes',async()=>{
 const h=historicalHarness();await storedHistory(h);const before=unchangedHistory(h),calls=[],panel=ui(h,h.fetcher,{onReuseUrl:(target,signal)=>calls.push({target,signal})});try{
  await panel.flush();assert.equal(calls.length,0);const start=panel.button('이 URL로 상품 추가');assert.equal(start.props.disabled,false);start.props.onClick();start.props.onClick();await panel.flush();
  assert.equal(calls.length,1);assert.deepEqual(Object.keys(calls[0].target).sort(),['accountContext','company','registrationId','sourceUrl']);assert.equal(calls[0].target.sourceUrl,'https://detail.1688.com/offer/813724060928.html');assert.equal(calls[0].target.registrationId,'261002001001');assert.deepEqual(JSON.parse(JSON.stringify(calls[0].target.company)),{code:'A01464742',name:'와이홉'});assert.match(calls[0].target.accountContext,/^[a-f0-9]{64}$/);assert.equal(calls[0].signal.aborted,false);
  panel.click('자료 1개 보기');await panel.flush();assert.match(text(panel.render()),/명시 공란빈칸/);assert.match(text(panel.render()),/배터리선택 안 함/);assert.match(text(panel.render()),/등록완료/);assert.equal(unchangedHistory(h),before);
  assert.ok(h.state.calls.slice(2).every(call=>call.method==='GET'));
 }finally{panel.close();h.close();}
});

test('empty, noncanonical and unsafe historical URLs disable reuse and never reach a callback',async()=>{
 for(const sourceUrl of ['', ' https://detail.1688.com/offer/813724060928.html','http://detail.1688.com/offer/813724060928.html','https://detail.1688.com/offer/0.html','https://detail.1688.com/offer/813724060928.html?x=1','https://detail.1688.com/offer/813724060928.html#x','https://detail.1688.com:443/offer/813724060928.html','https://user@detail.1688.com/offer/813724060928.html','https://detail.1688.com.evil.test/offer/813724060928.html','javascript:alert(1)']){
  const h=historicalHarness();await storedHistory(h);let called=0;const panel=ui(h,async(url,init)=>{const response=await h.fetcher(url,init),body=await response.json();body.records=body.records.map(row=>({...row,sourceUrl}));return Response.json(body);},{onReuseUrl:()=>called++});try{
   await panel.flush();const requests=h.state.calls.length,start=panel.button('이 URL로 상품 추가');assert.equal(start.props.disabled,true,sourceUrl);start.props.onClick();await panel.flush();assert.equal(called,0);assert.equal(h.state.calls.length,requests);assert.ok(!nodes(panel.render()).some(node=>node.type==='a'&&text(node)==='1688 원본'));
  }finally{panel.close();h.close();}
 }
});

test('legacy list responses need a fresh verified account context before URL reuse',async()=>{
 for(const available of [true,false]){
  const h=historicalHarness();await storedHistory(h);let reads=0,called=0;const panel=ui(h,async(url,init)=>{const response=await h.fetcher(url,init),body=await response.json();if(++reads===1||!available)delete body.accountContext;return Response.json(body);},{onReuseUrl:()=>called++});try{
   await panel.flush();panel.click('이 URL로 상품 추가');await panel.flush();assert.equal(reads,2);assert.equal(called,available?1:0);if(!available)assert.match(text(panel.render()),/현재 계정·회사의 원본 기록을 확인하지 못/);
  }finally{panel.close();h.close();}
 }
});

test('changed owner, company, source URL or a forbidden history read cannot reuse the displayed original',async()=>{
 for(const change of ['owner','company','url','forbidden']){
  const h=historicalHarness();await storedHistory(h);let reads=0,called=0;const before=unchangedHistory(h),panel=ui(h,async(url,init)=>{const response=await h.fetcher(url,init),body=await response.json();if(++reads>1){if(change==='company')body.company={code:'A01526306',name:'유앤채'};if(change==='url')body.records[0].sourceUrl='https://detail.1688.com/offer/999999.html';}return Response.json(body,{status:response.status});},{onReuseUrl:()=>called++});try{
   await panel.flush();if(change==='owner'){panel.click('자료 1개 보기');await panel.flush();const old=h.state.user;h.state.user={...old,userId:'changed-history-owner',membership:{...old.membership,id:'changed-history-owner'}};}if(change==='forbidden')h.state.user=null;
   panel.click('이 URL로 상품 추가');await panel.waitUntil(tree=>change==='forbidden'?tree===null:nodes(tree).some(node=>node.props?.role==='alert'));assert.equal(called,0,change);assert.equal(unchangedHistory(h),before);if(change==='forbidden')assert.equal(panel.render(),null);else assert.ok(nodes(panel.render()).some(node=>node.props?.role==='alert'),`${change} rejected after ${reads} reads`);if(change==='owner')assert.ok(!nodes(panel.render()).some(node=>node.props?.['aria-label']==='부분 견적자료'));
  }finally{panel.close();h.close();}
 }
});

test('refresh, search, callback removal and unmount abort a pending source read before invoking its parent',async()=>{
 for(const action of ['refresh','search','remove','unmount']){
  const h=historicalHarness();await storedHistory(h);let reads=0,release,pendingSignal,called=0;const panel=ui(h,async(url,init)=>{const response=await h.fetcher(url,init);if(++reads===2){pendingSignal=init.signal;return await new Promise(resolve=>release=()=>resolve(response));}return response;},{onReuseUrl:()=>called++});try{
   await panel.flush();panel.click('이 URL로 상품 추가');await panel.flush();assert.ok(release);assert.equal(panel.button('이 URL로 상품 추가').props.disabled,true);
   if(action==='refresh')panel.click('새로고침');if(action==='search')panel.search('다른 검색');if(action==='remove')panel.setProps({});if(action==='unmount')panel.close();assert.equal(pendingSignal.aborted,true,action);release();
   if(action==='unmount'){await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));}else await panel.flush();assert.equal(called,0,action);
  }finally{panel.close();h.close();}
 }
});

test('a pending read calls the latest parent guard and cannot invoke the stale callback after a list refresh',async()=>{
 const h=historicalHarness();await storedHistory(h);let reads=0,release,old=0,latest=0;const panel=ui(h,async(url,init)=>{const response=await h.fetcher(url,init);if(++reads===2)return await new Promise(resolve=>release=()=>resolve(response));return response;},{onReuseUrl:()=>old++});try{
  await panel.flush();panel.click('이 URL로 상품 추가');await panel.flush();panel.setProps({onReuseUrl:()=>{latest++;throw Error('현재 상품 추가 작업이 진행 중입니다.');}});release();await panel.flush();assert.equal(old,0);assert.equal(latest,1);assert.match(text(panel.render()),/현재 상품 추가 작업이 진행 중/);
  const retained=panel.button('이 URL로 상품 추가').props.onClick;panel.click('새로고침');await panel.flush();const before=reads;retained();await panel.flush();assert.equal(reads,before);assert.equal(latest,1);
 }finally{panel.close();h.close();}
});

test('a pending JSON preview keeps URL reuse callbacks idle and does not change stored originals',async()=>{
 const h=historicalHarness();await storedHistory(h);let called=0;const before=unchangedHistory(h),panel=ui(h,h.fetcher,{onReuseUrl:()=>called++});try{
  await panel.flush();const retained=panel.button('이 URL로 상품 추가').props.onClick;panel.select([doc('same.json',[historicalRow()])]);panel.click('기록 미리보기');retained();await panel.flush();assert.equal(called,0);assert.equal(unchangedHistory(h),before);
 }finally{panel.close();h.close();}
});

test('a failed history refresh blocks retained rows until a successful retry without losing the original data',async()=>{
 const h=historicalHarness();await storedHistory(h);let reads=0,called=0;const before=unchangedHistory(h),panel=ui(h,async(url,init)=>++reads===2?Response.json({error:'시험 조회 오류'},{status:503}):h.fetcher(url,init),{onReuseUrl:()=>called++});try{
  await panel.flush();const retained=panel.button('이 URL로 상품 추가').props.onClick;panel.click('새로고침');await panel.flush();assert.equal(panel.button('이 URL로 상품 추가').props.disabled,true);retained();await panel.flush();assert.equal(called,0);assert.match(text(panel.render()),/시험 조회 오류/);
  panel.click('새로고침');await panel.flush();panel.click('이 URL로 상품 추가');await panel.flush();assert.equal(called,1);assert.equal(unchangedHistory(h),before);
 }finally{panel.close();h.close();}
});
