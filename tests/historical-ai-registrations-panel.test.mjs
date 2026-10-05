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
function ui(h,fetcher=h.fetcher){
 const states=[],effects=[];let cursor=0,tree;
 const hooks={useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>states[i]=typeof value==='function'?value(states[i]):value];},useRef(initial){const i=cursor++;return states[i]??(states[i]={current:initial});},useEffect(fn,deps){const i=cursor++,old=states[i];if(!old||deps.some((value,j)=>!Object.is(value,old.deps[j]))){const next={deps};states[i]=next;effects.push(()=>{old?.cleanup?.();next.cleanup=fn();});}}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/historical-ai-registrations-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,URLSearchParams,queueMicrotask,fetch:fetcher,require:name=>name==='react'?hooks:native(name)});
 const render=()=>{cursor=0;tree=exports.default();effects.splice(0).forEach(effect=>effect());return tree;};
 const button=label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label);
 render();return{render,button,
  select(documents){nodes(render()).find(node=>node.type==='input'&&node.props.type==='file').props.onChange({target:{files:documents.map(document=>new File([document.text],document.name,{type:'application/json'}))}});render();},
  click(label){const node=button(label);assert.ok(node&&!node.props.disabled,label);node.props.onClick();render();},
  async flush(){for(let i=0;i<8;i++){await new Promise(resolve=>setImmediate(resolve));render();}},
  search(value){nodes(render()).find(node=>node.type==='input'&&node.props.maxLength===200).props.onChange({target:{value}});render();nodes(render()).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});render();},
  close(){states.forEach(state=>state?.cleanup?.());},
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
