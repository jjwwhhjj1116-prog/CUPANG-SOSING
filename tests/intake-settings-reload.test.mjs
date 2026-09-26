import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const settle=async()=>{for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));};
function harness(read){
 const slots=[],cleanups=[],calls=[],changes=[];let index=0,first=true,settings,rows;
 const hooks={useState(v){const i=index++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},useRef(v){const i=index++;return slots[i]??(slots[i]={current:v});},useEffect(fn){if(first){const cleanup=fn();if(cleanup)cleanups.push(cleanup);}}};
 function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,URL,AbortController,crypto,fetch:async(url,init)=>{calls.push({url,init});return url==='/api/settings'?read(init):Response.json({code:'REGISTRATION_SETTINGS_CHANGED',error:'기본설정 변경'},{status:409});},require(name){if(name==='react')return hooks;if(name==='@/app/components/category-picker')return{CategoryPicker:()=>null};if(name==='@/app/components/intake-quotation-preview')return{IntakeQuotationPreview:()=>null};if(name==='@/app/intake-collection')return{collectIntakeProduct:async()=>{throw Error('must not collect');}};return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);}});return exports;}
 settings=load('app/workspace-settings.ts').savedRegistrationSettings({brand:'이전',exchangeRate:190});
 rows=[1,2].map(n=>({id:String(n),profile:{id:'00000000-0000-0000-0000-000000000001',revision:1,categoryId:'80719',categoryPath:['주방','바스켓']},url:`https://detail.1688.com/offer/${n}.html`,features:'입력 특징',keywords:'입력 키워드',status:'draft',message:''}));
 const Component=load('app/components/intake-queue-panel.tsx').IntakeQueuePanel;
 const render=()=>{index=0;const tree=Component({rows,settings,profiles:[],onRows:update=>rows=update(rows),onProfile(){},onAdvanced(){},onJobs(){},onBusy(){},goal:'price',onGoal(){},onSettingsReloaded:value=>{settings=value;changes.push(value);}});first=false;return tree;};
 const button=text=>nodes(render()).find(n=>n.type==='button'&&String(n.props.children).includes(text));
 return{render,button,calls,changes,get rows(){return rows;},get settings(){return settings;},close(){cleanups.forEach(fn=>fn());}};
}
test('settings conflict reload preserves URLs/category/selection and does not automatically restart collection',async()=>{
 const h=harness(async()=>Response.json({settings:{brand:'최신',exchangeRate:350}}));
 nodes(h.render()).find(n=>n.props?.['aria-label']==='2번째 상품 선택').props.onChange({target:{checked:false}});
 const original=JSON.stringify(h.rows.map(({status,message,...row})=>row));
 h.button('요청 저장').props.onClick();await settle();assert.equal(h.calls.length,1);assert.equal(h.button('요청 저장').props.disabled,true);
 h.button('최신 기본설정 불러오기').props.onClick();await settle();
 assert.equal(h.settings.brand,'최신');assert.equal(h.settings.exchangeRate,350);assert.equal(h.calls.length,2);assert.equal(h.changes.length,1);
 assert.equal(JSON.stringify(h.rows.map(({status,message,...row})=>row)),original);assert.equal(nodes(h.render()).find(n=>n.props?.['aria-label']==='2번째 상품 선택').props.checked,false);
 assert.equal(h.button('요청 저장').props.disabled,false);h.button('요청 저장').props.onClick();await settle();assert.equal(JSON.parse(h.calls[2].init.body).expectedSettings.brand,'최신');
});
test('failed or malformed settings reads retain old values and allow another reload',async()=>{
 for(const body of [null,{}, {settings:{exchangeRate:-1}}]){
  const h=harness(async()=>Response.json(body));h.button('요청 저장').props.onClick();await settle();h.button('최신 기본설정 불러오기').props.onClick();await settle();
  assert.equal(h.changes.length,0);assert.equal(h.settings.brand,'이전');assert.equal(h.button('요청 저장').props.disabled,true);assert.equal(h.button('최신 기본설정 불러오기').props.disabled,false);assert.ok(nodes(h.render()).some(n=>n.props?.role==='alert'));
 }
});
test('double reload is single-flight and unmount discards a late settings response',async()=>{
 let finish,signal;const pending=new Promise(r=>finish=r);const h=harness(init=>{signal=init.signal;return pending;});
 h.button('요청 저장').props.onClick();await settle();const click=h.button('최신 기본설정 불러오기').props.onClick;click();click();assert.equal(h.calls.filter(c=>c.url==='/api/settings').length,1);
 h.close();assert.equal(signal.aborted,true);finish(Response.json({settings:{brand:'늦은 값'}}));await settle();assert.equal(h.changes.length,0);
});
