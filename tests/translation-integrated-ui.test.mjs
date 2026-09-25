import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const native = createRequire(import.meta.url);
const nodes = t => Array.isArray(t) ? t.flatMap(nodes) : t && typeof t === 'object' ? [t, ...nodes(t.props?.children)] : [];
const settle = async () => { for (let i=0;i<8;i++) await new Promise(r=>setImmediate(r)); };
const version='2026-09-25T01:00:00.000Z';
const plan={productId:'p',productVersion:version,contentRevision:0,optionRevision:1,fingerprint:'a'.repeat(64),preview:[{name:'상품명',before:'',after:'한국어'}],skipped:[]};
function harness(handler) {
 let slots=[],cleanups=[]; const calls=[]; let index=0,first=true,saved=0,closed=false,late=0,key; let props={productId:'p',version,jobId:'j',disabled:false,onSaved:()=>saved++};
 const hooks={useState(v){const i=index++;if(!(i in slots))slots[i]=v;return[slots[i],x=>{if(closed)late++;slots[i]=x;}];},useRef(v){const i=index++;return slots[i]??(slots[i]={current:v});},useEffect(fn){if(first)cleanups.push(fn());}};
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/translation-integrated-preview.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,fetch:async(url,init)=>{calls.push({url,init});return handler(init);},require:n=>n==='react'?hooks:native(n)});
 const render=(updates={})=>{props={...props,...updates};const root=exports.TranslationIntegratedPreview(props);if(key!==root.key){cleanups.forEach(fn=>fn?.());slots=[];cleanups=[];first=true;key=root.key;}index=0;const tree=root.type(root.props);first=false;return tree;};
 render();return {calls,render,click(i){nodes(render()).filter(n=>n.type==='button')[i].props.onClick();},close(){closed=true;cleanups.forEach(fn=>fn?.());},get saved(){return saved;},get late(){return late;}};
}
test('integrated UI submits only reviewed fingerprint and verifies save receipt',async()=>{
 for(const valid of [true,false]) {
  const h=harness(async init=>JSON.parse(init.body).action==='preview'?Response.json(plan):Response.json({productId:valid?'p':'other',productVersion:'2026-09-25T01:00:01.000Z',contentRevision:1,optionRevision:2,applied:1}));
  h.click(0);await settle();h.click(1);await settle();
  assert.deepEqual(JSON.parse(h.calls[1].init.body),{action:'apply',jobId:'j',expectedVersion:version,fingerprint:plan.fingerprint});
  assert.equal(h.saved,valid?1:0);assert.match(JSON.stringify(h.render()),valid ? /함께 저장했습니다/ : /응답이 일치하지/);
 }
});
test('integrated UI locks duplicate requests and ignores responses after close',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),h=harness(()=>pending);
 h.click(0);h.click(0);assert.equal(h.calls.length,1);h.close();assert.equal(h.calls[0].init.signal.aborted,true);
 resolve(Response.json(plan));await settle();assert.equal(h.saved,0);assert.equal(h.late,0);
});
test('malformed preview never exposes an apply action',async()=>{
 const h=harness(async()=>Response.json({...plan,productId:'other'}));h.click(0);await settle();
 assert.equal(nodes(h.render()).filter(n=>n.type==='button').length,1);assert.equal(h.saved,0);
});

test('changing product, version or translation job invalidates the reviewed plan',async()=>{
 for(const update of [{productId:'other'},{version:'2026-09-25T02:00:00.000Z'},{jobId:'new-job'}]){
  const h=harness(async()=>Response.json(plan));h.click(0);await settle();
  assert.equal(nodes(h.render()).filter(n=>n.type==='button').length,2);
  const tree=h.render(update);assert.equal(nodes(tree).filter(n=>n.type==='button').length,1);
  assert.equal(h.calls.length,1);assert.equal(h.saved,0);
 }
});

test('late preview and apply responses are ignored after changing product context',async()=>{
 for(const phase of ['preview','apply']){
  let finish;const pending=new Promise(resolve=>finish=resolve);
  const h=harness(init=>JSON.parse(init.body).action===phase?pending:Response.json(plan));
  h.click(0);if(phase==='apply'){await settle();h.click(1);}
  const request=h.calls.at(-1);h.render({version:'2026-09-25T02:00:00.000Z'});
  assert.equal(request.init.signal.aborted,true);
  finish(Response.json(phase==='preview'?plan:{productId:'p',productVersion:'2026-09-25T01:00:01.000Z',contentRevision:1,optionRevision:2,applied:1}));
  await settle();assert.equal(h.saved,0);assert.equal(nodes(h.render()).filter(n=>n.type==='button').length,1);
  assert.doesNotMatch(JSON.stringify(h.render()),/함께 저장했습니다/);
 }
});
