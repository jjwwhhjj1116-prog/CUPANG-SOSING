import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(' '):tree&&typeof tree==='object'?text(tree.props?.children):tree===null||tree===undefined||typeof tree==='boolean'?'':String(tree);
const report=(loopbackPermission,extra={})=>({secureContext:true,visibility:'visible',loopbackPermission,...extra});
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
async function until(predicate){for(let n=0;n<200;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,1));}throw Error('Synthetic browser status did not settle');}
function harness(reader){
 const slots=[],effects=[],requests=[],writes=[];let cursor=0,cleanup,tree;
 const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return[slots[index],value=>{writes.push({index,value});slots[index]=typeof value==='function'?value(slots[index]):value;}];},useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];},useEffect(setup){const index=cursor++;if(!(index in slots)){slots[index]=true;effects.push(setup);}}};
 const read=()=>{if(reader){requests.push({});return reader();}return new Promise((resolve,reject)=>requests.push({resolve,reject}));};
 const exports={},jsx=(type,props)=>({type,props});
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/cli-browser-status.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Promise,Error,fetch(){throw Error('Browser status may not make network requests');},require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name==='@/app/cli-browser-environment')return{readCliBrowserEnvironment:read};throw Error('Unsupported status component dependency '+name);}});
 const render=()=>{cursor=0;tree=exports.CliBrowserStatus();return tree;};
 return{requests,writes,render,mount(strict=false){render();cleanup=effects[0]();if(strict){cleanup();cleanup=effects[0]();}},unmount(){cleanup?.();},button(){return nodes(tree).find(node=>node.type==='button');},status:()=>text(nodes(tree).find(node=>node.props?.role==='status')),text:()=>text(tree)};
}
test('late initial diagnosis cannot replace a newer explicit refresh result',async()=>{
 const h=harness();try{h.mount();assert.equal(h.requests.length,1);h.button().props.onClick();h.render();assert.equal(h.requests.length,2);assert.equal(h.button().props.disabled,true);h.requests[1].resolve(report('granted'));await flush();h.render();assert.match(h.status(),/허용됨/);assert.equal(h.button().props.disabled,false);const writes=h.writes.length;h.requests[0].resolve(report('denied'));await flush();h.render();assert.equal(h.writes.length,writes);assert.match(h.status(),/허용됨/);assert.doesNotMatch(h.status(),/차단됨/);}finally{h.unmount();}
});
test('unmount discards both initial and refresh completions without any UI state write',async()=>{
 const h=harness();h.mount();h.button().props.onClick();h.unmount();const writes=h.writes.length;h.requests[0].resolve(report('denied'));h.requests[1].resolve(report('granted'));await flush();assert.equal(h.writes.length,writes);
});
test('StrictMode effect cleanup invalidates the first diagnosis while the replay remains active',async()=>{
 const h=harness();try{h.mount(true);assert.equal(h.requests.length,2);const writes=h.writes.length;h.requests[0].resolve(report('denied'));await flush();h.render();assert.equal(h.writes.length,writes);assert.match(h.status(),/확인 중/);h.requests[1].resolve(report('prompt'));await flush();h.render();assert.match(h.status(),/연결할 때 확인 필요/);assert.doesNotMatch(h.status(),/차단됨/);}finally{h.unmount();}
});
test('granted permission is labelled independently of actual CLI connection success',async()=>{
 const h=harness();try{h.mount();h.requests[0].resolve(report('granted'));await flush();h.render();assert.match(h.status(),/PC 연결 권한:.*허용됨/);assert.match(h.text(),/CLI 연결 성공 여부.*따로 확인/);assert.doesNotMatch(h.text(),/연결에 성공했습니다|CLI 연결 완료|접수 완료/);}finally{h.unmount();}
});
for(const permission of ['unsupported','unavailable','timeout'])test(`${permission} remains unknown and is never labelled as an actual denied permission`,async()=>{
 const h=harness();try{h.mount();h.requests[0].resolve(report(permission));await flush();h.render();assert.doesNotMatch(h.status(),/차단됨/);assert.match(h.text(),/권한 상태만으로 차단 여부를 판단할 수 없습니다/);assert.doesNotMatch(h.text(),/이 사이트의 PC 연결을 차단한 상태/);}finally{h.unmount();}
});
test('an explicit denied result is distinguishable from an unsupported browser',async()=>{
 const h=harness();try{h.mount();h.requests[0].resolve(report('denied'));await flush();h.render();assert.match(h.status(),/차단됨/);assert.match(h.text(),/브라우저가 이 페이지의 PC 연결 권한/);assert.match(h.text(),/이 결과만으로 사용자가 차단했는지/);assert.match(h.text(),/해당 항목이 없으면 같은 설정 변경을 반복하지/);assert.doesNotMatch(h.text(),/‘루프백 네트워크’ 상태를 확인/);assert.doesNotMatch(h.status(),/미지원/);}finally{h.unmount();}
});

test('an effective policy denial does not send the user to a missing Chrome permission item',async()=>{
 const h=harness();try{h.mount();h.requests[0].resolve(report('denied',{loopbackPolicy:'blocked',documentContext:'embedded'}));await flush();h.render();assert.match(h.text(),/현재 페이지의 문서 정책이 PC 연결을 허용하지/);assert.match(h.text(),/다른 페이지 안에 포함됨/);assert.doesNotMatch(h.text(),/이 기기의 앱·서비스 접근|Chrome.*확인해주세요/);}finally{h.unmount();}
});
test('a second refresh event is ignored once the current refresh is rendered busy',async()=>{
 const h=harness();try{h.mount();h.requests[0].resolve(report('prompt'));await flush();h.render();h.button().props.onClick();h.render();h.button().props.onClick();assert.equal(h.requests.length,2);h.requests[1].resolve(report('unsupported'));await flush();h.render();assert.equal(h.button().props.disabled,false);}finally{h.unmount();}
});
test('secure-context and tab-visibility warnings describe the document without guessing a CLI error',async()=>{
 const h=harness();try{h.mount();h.requests[0].resolve(report('unavailable',{secureContext:false,visibility:'hidden'}));await flush();h.render();assert.match(h.text(),/HTTPS 주소/);assert.match(h.text(),/탭이 배경/);assert.doesNotMatch(h.text(),/CLI 실행에 실패했습니다/);}finally{h.unmount();}
});
test('actual bounded permissions reader reaches a timeout label without contacting a socket or requesting access',async()=>{
 const helper={},timeouts=[],queries=[];
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/cli-browser-environment.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:helper,Error,Promise,isSecureContext:true,document:{visibilityState:'visible'},navigator:{permissions:{query(descriptor){queries.push(descriptor.name);return new Promise(()=>{});},request(){throw Error('A status query may not request permission');}}},setTimeout(callback,ms){timeouts.push(ms);return setTimeout(callback,20);},clearTimeout,fetch(){throw Error('No socket fetch permitted');}});
 const h=harness(()=>helper.readCliBrowserEnvironment());try{h.mount();await until(()=>{h.render();return /시간 초과/.test(h.status());});assert.deepEqual(queries,['loopback-network']);assert.deepEqual(timeouts,[1000]);assert.doesNotMatch(h.status(),/차단됨/);}finally{h.unmount();}
});
