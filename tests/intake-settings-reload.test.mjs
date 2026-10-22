import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const settle=async()=>{for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));};
function harness(read,{workspaceOwnerId,onSettingsReloadStarted,onAdopt}={}){
 const slots=[],layouts=[],calls=[],changes=[],proofs=[];let index=0,settings,rows,closed=false,tree,lateWrites=0;
 const hooks={useState(v){const i=index++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return[slots[i],v=>{if(closed){lateWrites++;return;}slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(v){const i=index++;return slots[i]??(slots[i]={current:v});},useLayoutEffect(fn){layouts.push(fn);},useEffect(fn,deps){const i=index++,old=slots[i];if(!old||!deps||deps.some((value,j)=>!Object.is(value,old.deps[j]))){old?.cleanup?.();slots[i]={deps,cleanup:fn()};}}};
 function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,URL,AbortController,crypto,fetch:async(url,init)=>{calls.push({url,init});return url==='/api/settings'?read(init):Response.json({code:'REGISTRATION_SETTINGS_CHANGED',error:'기본설정 변경'},{status:409});},require(name){if(name==='react')return hooks;if(name==='@/app/components/category-picker')return{CategoryPicker:()=>null};if(name==='@/app/components/collection-result-panel')return{CollectionResultPanel:()=>null};if(name==='@/app/components/intake-quotation-preview')return{IntakeQuotationPreview:()=>null};if(name==='@/app/intake-collection')return{collectIntakeProduct:async()=>{throw Error('must not collect');}};return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);}});return exports;}
 settings=load('app/workspace-settings.ts').savedRegistrationSettings({brand:'이전',exchangeRate:190});
 rows=[1,2].map(n=>({id:String(n),profile:{id:'00000000-0000-0000-0000-000000000001',revision:1,categoryId:'80719',categoryPath:['주방','바스켓']},url:`https://detail.1688.com/offer/${n}.html`,features:'입력 특징',keywords:'입력 키워드',status:'draft',message:''}));
 const Component=load('app/components/intake-queue-panel.tsx').IntakeQueuePanel;
 const render=()=>{if(closed)return tree;index=0;tree=Component({workspaceOwnerId,rows,settings,profiles:[],onRows:update=>rows=update(rows),onProfile(){},onAdvanced(){},onJobs(){},onBusy(){},goal:'price',onGoal(){},onSettingsReloadStarted,onSettingsReloaded:(value,scope,epoch)=>{onAdopt?.(value,scope,epoch);settings=value;changes.push(value);proofs.push({scope,epoch});}});layouts.splice(0).forEach(fn=>fn());return tree;};
 const button=text=>nodes(render()).find(n=>n.type==='button'&&String(n.props.children).includes(text));
 return{render,button,calls,changes,proofs,switchOwner(value){workspaceOwnerId=value;return render();},get rows(){return rows;},get settings(){return settings;},get lateWrites(){return lateWrites;},close(){closed=true;slots.forEach(slot=>slot?.cleanup?.());}};
}
test('settings conflict reload preserves URLs/category/selection and does not automatically restart collection',async()=>{
 const h=harness(async()=>Response.json({settings:{brand:'최신',exchangeRate:350}}));
 nodes(h.render()).find(n=>n.props?.['aria-label']==='2번째 상품 선택').props.onChange({target:{checked:false}});
 const original=JSON.stringify(h.rows.map(({status,message,...row})=>row));
 h.button('시작 (').props.onClick();await settle();assert.equal(h.calls.length,1);assert.equal(h.button('시작 (').props.disabled,true);
 h.button('최신 기본설정 불러오기').props.onClick();await settle();
 assert.equal(h.settings.brand,'최신');assert.equal(h.settings.exchangeRate,350);assert.equal(h.calls.length,2);assert.equal(h.changes.length,1);
 assert.equal(JSON.stringify(h.rows.map(({status,message,...row})=>row)),original);assert.equal(nodes(h.render()).find(n=>n.props?.['aria-label']==='2번째 상품 선택').props.checked,false);
 assert.equal(h.button('시작 (').props.disabled,false);h.button('시작 (').props.onClick();await settle();assert.equal(JSON.parse(h.calls[2].init.body).expectedSettings.brand,'최신');
});
test('failed or malformed settings reads retain old values and allow another reload',async()=>{
 for(const body of [null,{}, {settings:{exchangeRate:-1}}]){
  const h=harness(async()=>Response.json(body));h.button('시작 (').props.onClick();await settle();h.button('최신 기본설정 불러오기').props.onClick();await settle();
  assert.equal(h.changes.length,0);assert.equal(h.settings.brand,'이전');assert.equal(h.button('시작 (').props.disabled,true);assert.equal(h.button('최신 기본설정 불러오기').props.disabled,false);assert.ok(nodes(h.render()).some(n=>n.props?.role==='alert'));
 }
});
test('double reload is single-flight and unmount discards a late settings response',async()=>{
 let finish,signal;const pending=new Promise(r=>finish=r);const h=harness(init=>{signal=init.signal;return pending;});
 h.button('시작 (').props.onClick();await settle();const click=h.button('최신 기본설정 불러오기').props.onClick;click();click();assert.equal(h.calls.filter(c=>c.url==='/api/settings').length,1);
 h.close();assert.equal(signal.aborted,true);finish(Response.json({settings:{brand:'늦은 값'}}));await settle();assert.equal(h.changes.length,0);
});

const scope=(ownerId,code)=>({ownerId,company:{code,name:code==='A01526306'?'유앤채':'와이홉'}});
const queueInputs=rows=>rows.map(row=>{const value={...row};delete value.status;delete value.message;return value;});
test('account-bound reload verifies the exact returned owner and fixed company scope before adopting settings',async()=>{
 for(const code of ['A01526306','A01464742']){
  const ownerId='owner-'+code,proof=scope(ownerId,code),h=harness(async()=>Response.json({settings:{brand:proof.company.name,exchangeRate:350},scope:proof}),{workspaceOwnerId:ownerId,onSettingsReloadStarted:()=>17});
  const original=JSON.stringify(h.rows);h.button('시작 (').props.onClick();await settle();h.button('최신 기본설정 불러오기').props.onClick();await settle();
  assert.equal(h.settings.brand,proof.company.name);assert.deepEqual(JSON.parse(JSON.stringify(h.proofs)),[{scope:proof,epoch:17}]);
  assert.equal(h.calls.filter(call=>call.url==='/api/settings').length,1);assert.equal(h.calls.length,2);assert.equal(JSON.stringify(queueInputs(h.rows)),JSON.stringify(queueInputs(JSON.parse(original))));
  assert.equal(h.button('시작 (').props.disabled,false);h.close();
 }
});

test('missing, foreign and malformed response scopes cannot replace account-bound defaults or claim reload success',async()=>{
 for(const proof of [undefined,null,{},[],scope('foreign-owner','A01464742'),{ownerId:'owner',company:{code:'A01526306',name:'와이홉'}}]){
  const h=harness(async()=>Response.json({settings:{brand:'다른 설정',exchangeRate:700},...(proof===undefined?{}:{scope:proof})}),{workspaceOwnerId:'owner'});
  h.button('시작 (').props.onClick();await settle();h.button('최신 기본설정 불러오기').props.onClick();await settle();
  assert.equal(h.changes.length,0);assert.equal(h.settings.brand,'이전');assert.equal(h.button('시작 (').props.disabled,true);
  assert.ok(nodes(h.render()).some(node=>node.props?.role==='alert'));assert.ok(!nodes(h.render()).some(node=>String(node.props?.children).includes('최신 기본설정을 불러왔습니다.')));h.close();
 }
 for(const proof of [null,{},[],{ownerId:'owner',company:{code:'A01526306',name:'와이홉'}}]){
  const h=harness(async()=>Response.json({settings:{brand:'잘못된 응답'},scope:proof}));h.button('시작 (').props.onClick();await settle();h.button('최신 기본설정 불러오기').props.onClick();await settle();assert.equal(h.changes.length,0);h.close();
 }
});

test('a stale owner reload is discarded and a valid current-owner retry preserves the queue inputs',async()=>{
 let reply,attempt=0;const pending=new Promise(resolve=>reply=resolve),next=scope('next-owner','A01464742');
 const h=harness(async()=>++attempt===1?pending:Response.json({settings:{brand:'현재 계정 설정'},scope:next}),{workspaceOwnerId:'old-owner'});
 h.button('시작 (').props.onClick();await settle();const original=JSON.stringify(h.rows),oldReload=h.button('최신 기본설정 불러오기').props.onClick;oldReload();h.switchOwner('next-owner');
 reply(Response.json({settings:{brand:'이전 계정 설정'},scope:scope('old-owner','A01526306')}));await settle();assert.equal(h.changes.length,0);assert.equal(h.settings.brand,'이전');
 h.button('최신 기본설정 불러오기').props.onClick();await settle();assert.equal(h.settings.brand,'현재 계정 설정');assert.equal(JSON.stringify(h.rows),original);const calls=h.calls.length;oldReload();await settle();assert.equal(h.calls.length,calls);h.close();
});

test('invalid reload tokens or an adoption rejection preserve settings and never announce success',async()=>{
 for(const token of [-1,NaN,1.5,'17',null]){
  const h=harness(async()=>Response.json({settings:{brand:'새 값'}}),{onSettingsReloadStarted:()=>token});h.button('시작 (').props.onClick();await settle();h.button('최신 기본설정 불러오기').props.onClick();await settle();
  assert.equal(h.calls.filter(call=>call.url==='/api/settings').length,0);assert.equal(h.changes.length,0);assert.equal(h.settings.brand,'이전');h.close();
 }
 const h=harness(async()=>Response.json({settings:{brand:'미확정 값'}}),{onSettingsReloadStarted:()=>17,onAdopt(){throw Error('저장 작업 이후 오래된 조회입니다.');}});
 h.button('시작 (').props.onClick();await settle();h.button('최신 기본설정 불러오기').props.onClick();await settle();assert.equal(h.changes.length,0);assert.equal(h.settings.brand,'이전');assert.equal(h.button('시작 (').props.disabled,true);
 assert.ok(nodes(h.render()).some(node=>node.props?.role==='alert'&&String(node.props.children).includes('오래된 조회')));h.close();
});

test('an unmounted reload response and retained callback cannot adopt settings, set state or issue another GET',async()=>{
 let reply;const pending=new Promise(resolve=>reply=resolve),h=harness(async()=>pending,{workspaceOwnerId:'owner'});
 h.button('시작 (').props.onClick();await settle();const reload=h.button('최신 기본설정 불러오기').props.onClick;reload();const before=h.calls.length;h.close();
 reply(Response.json({settings:{brand:'늦은 값'},scope:scope('owner','A01526306')}));await settle();reload();await settle();assert.equal(h.calls.length,before);assert.equal(h.changes.length,0);assert.equal(h.lateWrites,0);
});
