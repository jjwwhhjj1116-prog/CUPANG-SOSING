import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url),plain=value=>JSON.parse(JSON.stringify(value));
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const defer=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const admin={id:'admin-a',email:'admin@example.test',role:'admin',status:'approved',companyCode:'A01526306',companyName:'유앤채'};
const applicant=(id='pending-one')=>({id,email:id,loginId:id,name:'테스트 신청자',phoneNumber:'+821012345678',createdAt:'2026-10-30T01:02:00.000Z',role:'member',status:'pending',companyCode:'',companyName:'',passwordHash:'MUST-NEVER-RENDER',password:'MUST-NEVER-RENDER-EITHER'});

function fixture({path='/',owner=admin,members=[applicant()],status=200,reply}={}){
 const requests=[],timers=new Set(),events=new Map(),documentEvents=new Map(),effects=[];let pathname=path,scope=null,tree=null,now=1_000_000,currentOwner=plain(owner),rows=plain(members),responseStatus=status,lateWrites=0,closed=false;
 const window={setInterval(fn,delay){assert.equal(delay,60000);timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn),addEventListener(type,fn){if(!events.has(type))events.set(type,new Set());events.get(type).add(fn);},removeEventListener:(type,fn)=>events.get(type)?.delete(fn),dispatchEvent(event){for(const fn of [...events.get(event.type)??[]])fn(event);}};
 class Element{isConnected=true;focus(){}querySelectorAll(){return[];}}
 const document={visibilityState:'visible',activeElement:new Element(),addEventListener(type,fn){if(!documentEvents.has(type))documentEvents.set(type,new Set());documentEvents.get(type).add(fn);},removeEventListener:(type,fn)=>documentEvents.get(type)?.delete(fn)};
 class Clock extends Date{static now(){return now;}}
 const hooks={
  useState(initial){const owner=scope,index=owner.cursor++;if(!(index in owner.slots))owner.slots[index]={value:typeof initial==='function'?initial():initial};return[owner.slots[index].value,value=>{if(!owner.mounted){lateWrites++;return;}owner.slots[index].value=typeof value==='function'?value(owner.slots[index].value):value;}];},
  useRef(initial){const index=scope.cursor++;return scope.slots[index]??(scope.slots[index]={current:initial});},
  useEffect(fn,deps){const owner=scope,index=owner.cursor++,old=owner.slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i]))){owner.slots[index]={deps,cleanup:old?.cleanup};effects.push(()=>{if(!owner.mounted)return;old?.cleanup?.();owner.slots[index].cleanup=fn();});}},
 };
 const fetcher=async(url,init={})=>{
  assert.equal(url,'/api/membership');assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
  const call={url,method:init.method??'GET',body:init.body?JSON.parse(init.body):null,signal:init.signal};requests.push(call);if(reply)return reply(call,h);
  if(call.method==='POST'){const row=rows.find(row=>row.id===call.body.memberId);if(row)row.status=call.body.action==='approve'?'approved':'rejected';return Response.json({ok:true});}
  return Response.json(responseStatus===200?{member:plain(currentOwner),members:plain(rows)}:{error:'expired'},{status:responseStatus});
 };
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/member-approval-notifications.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,Date:Clock,Intl,Set,AbortController,HTMLElement:Element,Event,document,window,fetch:fetcher,require:name=>name==='react'?hooks:name==='next/navigation'?{usePathname:()=>pathname}:name.endsWith('.css')?{}:native(name)});
 function cleanup(){if(!scope)return;for(const slot of scope.slots)slot?.cleanup?.();scope.mounted=false;scope=null;}
 function render(){
  if(closed)return null;const wrapper=exports.MemberApprovalNotifications();if(!wrapper){cleanup();tree=null;return null;}
  if(!scope)scope={slots:[],cursor:0,mounted:true};scope.cursor=0;tree=wrapper.type(wrapper.props);
  for(const node of nodes(tree))if(node.props?.ref&&typeof node.props.ref==='object')node.props.ref.current=new Element();
  effects.splice(0).forEach(fn=>fn());return tree;
 }
 const h={requests,render,text:()=>text(render()),get lateWrites(){return lateWrites;},get scope(){return scope;},
  setIdentity(owner,members=[]){currentOwner=plain(owner);rows=plain(members);},setStatus(value){responseStatus=value;},setReply(fn){reply=fn;},
  emit(type){window.dispatchEvent(new Event(type));},visible(value){document.visibilityState=value;for(const fn of documentEvents.get('visibilitychange')??[])fn();},advance(ms){now+=ms;for(const fn of [...timers])fn();},
  path(value){pathname=value;render();},button(label){return nodes(render()).find(node=>node.type==='button'&&(node.props['aria-label']===label||text(node)===label));},
  click(label){const button=h.button(label);assert.ok(button,label);assert.equal(Boolean(button.props.disabled),false,label);button.props.onClick();render();return button.props.onClick;},
  async settle(){for(let i=0;i<12;i++){render();await new Promise(done=>setImmediate(done));}},close(){cleanup();closed=true;},dialog(){return nodes(render()).find(node=>node.props?.role==='dialog');},};
 render();return h;
}

test('administrator gets an automatic pending-request popup with safe identity details and can dismiss and reopen it',async()=>{
 const h=fixture();try{
  await h.settle();assert.equal(h.requests.length,1);assert.ok(h.dialog());assert.match(h.text(),/pending-one/);assert.match(h.text(),/테스트 신청자/);assert.match(h.text(),/\+821012345678/);assert.match(h.text(),/2026/);assert.doesNotMatch(h.text(),/MUST-NEVER|비밀번호/);assert.ok(h.button('승인'));assert.ok(h.button('거절'));assert.ok(h.requests.every(call=>call.method==='GET'));
  h.click('승인 요청 창 닫기');assert.equal(h.dialog(),undefined);h.advance(60000);await h.settle();assert.equal(h.requests.length,2);assert.equal(h.dialog(),undefined,'polling the same pending request must preserve dismissal');
  h.click('가입 승인 요청 1건 보기');assert.ok(h.dialog());
 }finally{h.close();}
});

test('approval and rejection are distinct explicit one-event actions tied to the exact pending member',async()=>{
 for(const action of ['approve','reject']){
  const h=fixture(),held=defer();try{
   await h.settle();const handler=h.button(action==='approve'?'승인':'거절').props.onClick;h.setReply(call=>call.method==='POST'?held.promise:Response.json({member:admin,members:[]}));
   handler();handler();await h.settle();const posts=h.requests.filter(call=>call.method==='POST');assert.equal(posts.length,1);assert.deepEqual(posts[0].body,{action,memberId:'pending-one',expectedStatus:'pending'});assert.ok(h.button('승인').props.disabled);assert.ok(h.button('거절').props.disabled);
   h.click('승인 요청 창 닫기');held.resolve(Response.json({ok:true}));await h.settle();assert.equal(h.dialog(),undefined);assert.equal(h.requests.filter(call=>call.method==='POST').length,1);
   handler();await h.settle();assert.equal(h.requests.filter(call=>call.method==='POST').length,1,'retained processed-request callback is stale');
  }finally{h.close();}
 }
});

test('public authentication routes, unauthorized users and regular members do not trigger a background request storm or a popup',async()=>{
 for(const path of ['/login','/signup','/recover','/recover/verify','/recovery']){
  const h=fixture({path});try{await h.settle();h.advance(600000);h.emit('focus');await h.settle();assert.equal(h.requests.length,0);assert.equal(h.dialog(),undefined);}finally{h.close();}
 }
 for(const options of [{status:401},{owner:{...admin,id:'regular',role:'member'}}]){
  const h=fixture(options);try{await h.settle();assert.equal(h.requests.length,1);for(let i=0;i<3;i++){h.advance(60000);h.emit('focus');h.visible('visible');}await h.settle();assert.equal(h.requests.length,1);assert.equal(h.dialog(),undefined);assert.equal(h.text(),'');}finally{h.close();}
 }
});

test('visible/focus polling is bounded to once per minute, new pending IDs reopen, and hidden tabs wait',async()=>{
 const h=fixture();try{
  await h.settle();h.click('승인 요청 창 닫기');h.emit('focus');h.visible('visible');h.advance(59999);await h.settle();assert.equal(h.requests.length,1);
  h.visible('hidden');h.advance(60000);h.emit('focus');await h.settle();assert.equal(h.requests.length,1);
  h.setIdentity(admin,[applicant(),applicant('pending-two')]);h.visible('visible');await h.settle();assert.equal(h.requests.length,2);assert.ok(h.dialog());assert.match(h.text(),/pending-two/);
 }finally{h.close();}
});

test('identity changes invalidate retained review callbacks and 401 immediately clears member data and future polling',async()=>{
 const h=fixture();try{
  await h.settle();const stale=h.button('승인').props.onClick;
  h.setIdentity({...admin,id:'admin-b'},[applicant('pending-b')]);h.emit('membership-updated');await h.settle();assert.doesNotMatch(h.text(),/pending-one/);assert.match(h.text(),/pending-b/);stale();await h.settle();assert.equal(h.requests.filter(call=>call.method==='POST').length,0);
  h.setIdentity(admin,[applicant()]);h.emit('membership-updated');await h.settle();stale();await h.settle();assert.equal(h.requests.filter(call=>call.method==='POST').length,0,'A/B/A does not revive old callbacks');
  h.setStatus(401);h.emit('membership-updated');await h.settle();assert.equal(h.text(),'');const count=h.requests.length;h.advance(600000);h.emit('focus');await h.settle();assert.equal(h.requests.length,count);
 }finally{h.close();}
});

test('navigation, logout and unmount abort outstanding requests and ignore late responses without state writes',async()=>{
 for(const leave of ['public-route','session-change','unmount']){
  const held=defer(),h=fixture({reply:()=>held.promise});await h.settle();const request=h.requests[0];
  if(leave==='public-route')h.path('/login');else if(leave==='session-change')h.emit('membership-session-changed');else h.close();
  assert.equal(request.signal.aborted,true);held.resolve(Response.json({member:admin,members:[applicant()]}));await h.settle();assert.equal(h.lateWrites,0);assert.equal(h.dialog(),undefined);assert.equal(h.text(),'');h.close();
 }
});

test('an uncertain or conflicting review never retries the mutation automatically',async()=>{
 for(const failure of ['network','conflict']){
  const h=fixture();try{
   await h.settle();h.setReply(call=>call.method==='POST'?(failure==='network'?Promise.reject(Error('network')):Response.json({error:'이미 처리된 요청입니다.'},{status:409})):Response.json({member:admin,members:[]}));
   h.click('승인');await h.settle();assert.equal(h.requests.filter(call=>call.method==='POST').length,1);assert.equal(h.lateWrites,0);
   h.advance(60000);await h.settle();assert.equal(h.requests.filter(call=>call.method==='POST').length,1);
  }finally{h.close();}
 }
});

test('session change cancels an in-flight approval and discards its late response',async()=>{
 const h=fixture(),held=defer();try{
  await h.settle();h.setReply(call=>call.method==='POST'?held.promise:Response.json({member:admin,members:[]}));h.click('승인');await h.settle();const mutation=h.requests.find(call=>call.method==='POST');h.emit('membership-session-changed');assert.equal(mutation.signal.aborted,true);assert.equal(h.text(),'');
  held.resolve(Response.json({ok:true}));await h.settle();assert.equal(h.text(),'');assert.equal(h.lateWrites,0);assert.equal(h.requests.filter(call=>call.method==='POST').length,1);
 }finally{h.close();}
});
