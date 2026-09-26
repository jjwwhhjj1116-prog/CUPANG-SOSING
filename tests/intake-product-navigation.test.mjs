import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const settle=async()=>{for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));};
function harness(open){
 const slots=[],cleanups=[],calls=[],changes=[];let index=0,first=true,settings,rows;
 const hooks={useState(v){const i=index++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},useRef(v){const i=index++;return slots[i]??(slots[i]={current:v});},useEffect(fn){if(first){const cleanup=fn();if(cleanup)cleanups.push(cleanup);}}};
 function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,URL,AbortController,crypto,fetch:async(url,init)=>{calls.push({url,init});return url==='/api/settings'?Promise.reject(Error('unexpected request')):Response.json({code:'REGISTRATION_SETTINGS_CHANGED',error:'기본설정 변경'},{status:409});},require(name){if(name==='react')return hooks;if(name==='@/app/components/category-picker')return{CategoryPicker:()=>null};if(name==='@/app/components/intake-quotation-preview')return{IntakeQuotationPreview:()=>null};if(name==='@/app/intake-collection')return{collectIntakeProduct:async()=>{throw Error('must not collect');}};return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);}});return exports;}
 settings=load('app/workspace-settings.ts').savedRegistrationSettings({brand:'이전',exchangeRate:190});
 rows=[1,2].map(n=>({id:String(n),profile:{id:'00000000-0000-0000-0000-000000000001',revision:1,categoryId:'80719',categoryPath:['주방','바스켓']},url:`https://detail.1688.com/offer/${n}.html`,features:'입력 특징',keywords:'입력 키워드',status:n===1?'saved':'draft',message:''}));
 const Component=load('app/components/intake-queue-panel.tsx').IntakeQueuePanel;
 const render=()=>{index=0;const tree=Component({rows,settings,profiles:[],jobs:[{source_url:rows[0].url,product_id:'p1',status:'awaiting_connector'}],onOpenProduct:open,onRows:update=>rows=update(rows),onProfile(){},onAdvanced(){},onJobs(){},onBusy(){},goal:'price',onGoal(){},onSettingsReloaded:value=>{settings=value;changes.push(value);}});first=false;return tree;};
 const button=text=>nodes(render()).find(n=>n.type==='button'&&String(n.props.children).includes(text));
 return{render,button,calls,changes,get rows(){return rows;},get settings(){return settings;},close(){cleanups.forEach(fn=>fn());}};
}

test('saved row opens its existing editor only on click; double click is coalesced and other inputs survive',async()=>{
 let finish;const waiting=new Promise(resolve=>finish=resolve),calls=[];
 const h=harness((id,signal)=>{calls.push({id,signal});return waiting;});const before=JSON.stringify(h.rows);
 assert.equal(calls.length,0);const click=h.button('1~7단계 확인').props.onClick;click();click();await settle();
 assert.equal(calls.length,1);assert.equal(calls[0].id,'p1');assert.equal(h.button('1~7단계 확인').props.disabled,true);
 finish();await settle();assert.equal(JSON.stringify(h.rows),before);assert.equal(h.calls.length,0);assert.equal(h.button('1~7단계 확인').props.disabled,false);
});
test('editor read failure keeps the queue and allows retry; unmount aborts the request',async()=>{
 let attempts=0,signal;
 const h=harness(async(id,s)=>{signal=s;if(++attempts===1)throw Error('상품 조회 실패');await new Promise(()=>{});});
 h.button('1~7단계 확인').props.onClick();await settle();assert.match(JSON.stringify(h.render()),/상품 조회 실패/);assert.equal(h.rows.length,2);
 h.button('1~7단계 확인').props.onClick();await settle();assert.equal(attempts,2);h.close();assert.equal(signal.aborted,true);
});
