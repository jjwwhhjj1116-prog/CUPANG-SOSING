import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const productId='e2f8037c-294e-45a8-b06d-58cc5909683c',requestId='f29491bd-1882-456a-8a63-eec8586db6c6';
const diagnostic={status:'different-request',requestId:'00000000-0000-4000-8000-000000000734',createdAt:Date.now()-60000,sameRequest:false,message:'웹에는 다른 요청번호가 보관되어 있습니다.'};
class InspectionError extends Error { constructor(message,pendingDiagnostic){super(message);this.pendingDiagnostic=pendingDiagnostic;} }
function harness(){
 const slots=[],effects=[],calls=[];let cursor=0,tree,props={ownerId:'member-a'};
 const react={
  useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return[slots[index],next=>{slots[index]=typeof next==='function'?next(slots[index]):next;}];},
  useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];},
  useLayoutEffect(run,deps){const index=cursor++,old=slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i]))){const next={deps,cleanup:old?.cleanup};slots[index]=next;effects.push(()=>{next.cleanup?.();next.cleanup=run();});}},
 };
 const api={PreservedProductInspectionError:InspectionError,inspectPreservedProductRequest(selection,ownerId,signal){return new Promise((resolve,reject)=>calls.push({selection,ownerId,signal,resolve,reject}));}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/preserved-product-request-inspector.tsx',import.meta.url),'utf8'),{fileName:'inspector.tsx',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,Date,require:name=>name==='react'?react:name==='react/jsx-runtime'?require(name):name==='@/app/preserved-product-request-client'?api:(()=>{throw Error(name);})()});
 const render=(next=props)=>{props=next;cursor=0;tree=exports.PreservedProductRequestInspector(props);effects.splice(0).forEach(run=>run());return tree;};
 const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'&&value.props?[value,...nodes(value.props.children)]:[];
 const find=predicate=>{const value=nodes(tree).find(predicate);assert.ok(value,'UI target exists');return value;};
 const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
 const input=(name,value)=>{find(node=>node.type==='input'&&node.props['aria-label']===name).props.onChange({target:{value}});render();};
 render();
 return{render,find,input,calls,text:()=>text(tree),start(){input('보관 요청 상품 ID',productId);input('보관 요청번호',requestId);input('보관 문서번호','2347603');find(node=>node.type==='button'&&text(node)==='원래 전송 기록 조회').props.onClick();render();}};
}
const settle=async()=>{for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));};

test('inspector displays read-only local metadata alongside an unsupported extension error',async()=>{
 const h=harness();h.start();assert.equal(h.calls.length,1);assert.equal(h.calls[0].ownerId,'member-a');
 h.calls[0].reject(new InspectionError('현재 Chrome 확장 2.1.59은 원래 전송 기록 조회를 지원하지 않습니다.',diagnostic));await settle();h.render();
 const section=h.find(node=>node.type==='section'&&node.props['aria-label']==='웹에 보관된 요청 연결');
 assert.match(h.text(),/현재 Chrome 확장 2.1.59/);assert.match(h.text(),/다른 요청번호/);assert.match(h.text(),new RegExp(diagnostic.requestId));
 assert.ok(section);assert.match(h.text(),/전송 재개 권한은 아닙니다/);assert.equal(h.calls.length,1);
});

test('changing a requested identity clears previously displayed metadata and extension errors',async()=>{
 const h=harness();h.start();h.calls[0].reject(new InspectionError('older worker',diagnostic));await settle();h.render();assert.match(h.text(),new RegExp(diagnostic.requestId));
 h.input('보관 요청번호','00000000-0000-4000-8000-000000000735');
 assert.doesNotMatch(h.text(),new RegExp(diagnostic.requestId));assert.doesNotMatch(h.text(),/older worker|다른 요청번호/);
});

test('an account change cancels the original query and discards its delayed diagnostic',async()=>{
 const h=harness();h.start();h.render({ownerId:'member-b'});h.render();assert.equal(h.calls[0].signal.aborted,true);
 h.calls[0].reject(new InspectionError('old member error',diagnostic));await settle();h.render();
 assert.doesNotMatch(h.text(),/old member error|다른 요청번호/);assert.doesNotMatch(h.text(),new RegExp(diagnostic.requestId));
 for(const name of ['보관 요청 상품 ID','보관 요청번호','보관 문서번호'])assert.equal(h.find(node=>node.type==='input'&&node.props['aria-label']===name).props.value,'');
});

test('ordinary account or cancellation errors do not retain a guessed local descriptor',async()=>{
 const h=harness();h.start();h.calls[0].reject(Error('조회 중 로그인 회원·회사가 달라졌습니다.'));await settle();h.render();
 assert.match(h.text(),/로그인 회원·회사가 달라/);assert.doesNotMatch(h.text(),/웹 기록 시각|같은 요청번호|다른 요청번호/);
});
