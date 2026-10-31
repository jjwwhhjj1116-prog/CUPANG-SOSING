import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url),plain=value=>JSON.parse(JSON.stringify(value));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
const defer=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
function account({code='',name='',status='approved',role='admin',pending=[],read,post}={}){
 const slots=[],effects=[],requests=[],redirects=[],controls=new Map(),events=new Map();let cursor=0,closed=false,lateWrites=0,formKey=null;
 let self={id:'admin',email:'fixture-admin@example.test',role,status,companyCode:code,companyName:name};let rows=[self,...plain(pending)];
 const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]={value:typeof initial==='function'?initial():initial};return[slots[index].value,value=>{if(closed){lateWrites++;return;}slots[index].value=typeof value==='function'?value(slots[index].value):value;}];},useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useEffect(fn,deps){const index=cursor++,old=slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i]))){slots[index]={deps,cleanup:old?.cleanup};effects.push(()=>{old?.cleanup?.();slots[index].cleanup=fn();});}}};
 class FormValues{constructor(form){this.values=new Map([...form.controls.values()].filter(row=>!row.disabled).map(row=>[row.name,row.value]));}get(name){return this.values.get(name)??null;}}
 const window={location:{assign:path=>redirects.push(path),replace:path=>redirects.push(path)},addEventListener(type,fn){if(!events.has(type))events.set(type,new Set());events.get(type).add(fn);},removeEventListener:(type,fn)=>events.get(type)?.delete(fn),dispatchEvent(event){for(const fn of [...events.get(event.type)??[]])fn();}};
 const stubs={AccountSecurityPanel:function AccountSecurityPanel(){},LoginPreferencesPanel:function LoginPreferencesPanel(){},MemberConnectionsPanel:function MemberConnectionsPanel(){},MemberRegistrationConsentsPanel:function MemberRegistrationConsentsPanel(){}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/account/page.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,Event,Date,Intl,JSON,FormData:FormValues,window,fetch:async(url,init)=>{
  const body=init?.body?JSON.parse(init.body):null,call={url,body,signal:init?.signal};requests.push(call);
  if(body){if(post)return post(call);const row=rows.find(row=>row.id===body.memberId);if(row&&['approve','reject','suspend'].includes(body.action))row.status=body.action==='approve'?'approved':body.action==='reject'?'rejected':'suspended';return Response.json({ok:true,reauthenticate:body.action==='change-password'});}
  return read?read(call):Response.json({member:plain(self),members:plain(rows)});
 },require(name){if(name==='react')return hooks;if(name.endsWith('.css'))return{default:new Proxy({},{get:(_object,key)=>String(key)})};if(name.startsWith('@/app/components/'))return stubs;return native(name);}});
 const Page=exports.default;
 function render(){if(closed)return null;cursor=0;const tree=Page(),form=nodes(tree).find(node=>node.type==='form');if(form){if(form.key!==formKey){controls.clear();formKey=form.key;}for(const node of nodes(form).filter(node=>node.type==='input')){const {name,type}=node.props;if(!controls.has(name))controls.set(name,{name,type,value:''});controls.get(name).disabled=Boolean(node.props.disabled);}form.props.ref.current={controls,elements:{namedItem:name=>controls.get(name)??null}};}else controls.clear();effects.splice(0).forEach(effect=>effect());return tree;}
 const h={render,requests,redirects,get lateWrites(){return lateWrites;},text:()=>text(render()),close(){for(const slot of slots)slot?.cleanup?.();closed=true;},
  async settle(){for(let index=0;index<12;index++){render();await new Promise(done=>setImmediate(done));}},async start(){render();await h.settle();},
  button(label){return nodes(render()).find(node=>node.type==='button'&&text(node)===label);},field(name){return nodes(render()).find(node=>node.props?.name===name);},input(name){render();return controls.get(name);},choose(name,value){const input=h.input(name);assert.ok(input&&!input.disabled);input.value=value;},
  submit(){const form=nodes(render()).find(node=>node.type==='form');assert.ok(form);form.props.onSubmit({preventDefault(){},currentTarget:form.props.ref.current});render();},
  notify(type='membership-updated'){window.dispatchEvent(new Event(type));},identity(next,nextRows=[]){self=plain(next);rows=[self,...plain(nextRows)];},setRead(fn){read=fn;},setPost(fn){post=fn;},};return h;
}

const member=(status='pending')=>({id:'member',loginId:'new.member',email:'new.member',name:'신규 회원',phoneNumber:'+821012345678',createdAt:'2026-10-30T00:00:00.000Z',role:'member',status,companyCode:'',companyName:'',passwordHash:'MUST-NEVER-RENDER'});

test('assigned company is read-only and the account screen exposes no reassignment form',async()=>{
 const h=account({code:'A01526306',name:'유앤채'});try{await h.start();assert.equal(h.button('회사정보 수정'),undefined);assert.equal(h.field('companyCode'),undefined);assert.equal(h.field('companyName'),undefined);assert.equal(h.requests.some(request=>request.body),false);}finally{h.close();}
});

test('connection settings mount only for the approved current member with an actual company',async()=>{
 for(const status of ['approved','pending','suspended']){
  const h=account({code:'A01526306',name:'유앤채',status});try{await h.start();const panel=nodes(h.render()).find(node=>node.type?.name==='MemberConnectionsPanel');if(status==='approved'){assert.ok(panel);assert.equal(panel.props.ownerId,'admin');assert.deepEqual(plain(panel.props.company),{code:'A01526306',name:'유앤채'});}else assert.equal(panel,undefined);assert.equal(h.requests.some(request=>request.body),false);}finally{h.close();}
 }
 const h=account({role:'member'});try{await h.start();assert.equal(nodes(h.render()).find(node=>node.type?.name==='MemberConnectionsPanel'),undefined);assert.match(h.text(),/회사 연동 미설정/);assert.doesNotMatch(h.text(),/유앤채|와이홉/);const profile=nodes(h.render()).find(node=>node.type?.name==='AccountSecurityPanel');assert.equal(profile.props.ownerId,'admin');assert.equal(profile.props.isAdmin,false);}finally{h.close();}
});

test('registration consent settings bind only the approved own-company account and never supply unseen terms',async()=>{
 for(const status of ['approved','pending','suspended']){
  const h=account({code:'A01526306',name:'유앤채',status});try{await h.start();const panel=nodes(h.render()).find(node=>node.type?.name==='MemberRegistrationConsentsPanel');
   if(status==='approved'){assert.ok(panel);assert.equal(panel.props.ownerId,'admin');assert.deepEqual(plain(panel.props.company),{code:'A01526306',name:'유앤채'});assert.equal(panel.props.challenge,undefined);}
   else assert.equal(panel,undefined);assert.equal(h.requests.some(row=>row.body),false);
  }finally{h.close();}
 }
 const h=account({role:'member'});try{await h.start();assert.equal(nodes(h.render()).find(node=>node.type?.name==='MemberRegistrationConsentsPanel'),undefined);}finally{h.close();}
});

test('administrator retains suspend/resume controls and full status information without displaying secrets',async()=>{
 for(const status of ['approved','suspended']){
  const h=account({code:'A01526306',name:'유앤채',pending:[member(status)]});try{await h.start();assert.match(h.text(),/new.member/);assert.match(h.text(),/신규 회원/);assert.match(h.text(),/\+821012345678/);assert.doesNotMatch(h.text(),/MUST-NEVER-RENDER/);h.button(status==='approved'?'이용 정지':'이용 재개').props.onClick();await h.settle();assert.deepEqual(h.requests.find(request=>request.body).body,{action:status==='approved'?'suspend':'approve',memberId:'member'});}finally{h.close();}
 }
});

test('pending approval/rejection submits its exact status once and rejects a stale retained callback',async()=>{
 for(const action of ['approve','reject']){
  const h=account({pending:[member()]}),held=defer();try{await h.start();const callback=h.button(action==='approve'?'승인':'거절').props.onClick;h.setPost(()=>held.promise);callback();callback();await h.settle();assert.equal(h.requests.filter(row=>row.body).length,1);assert.deepEqual(h.requests.find(row=>row.body).body,{action,memberId:'member',expectedStatus:'pending'});held.resolve(Response.json({ok:true}));await h.settle();callback();await h.settle();assert.equal(h.requests.filter(row=>row.body).length,1);}finally{h.close();}
 }
});

test('password changes validate confirmation locally, clear fields before send and require a fresh login on success',async()=>{
 const h=account(),held=defer();try{await h.start();h.choose('currentPassword','synthetic-old-password');h.choose('newPassword','synthetic-new-password');h.choose('confirmPassword','not-matching');h.submit();await h.settle();assert.equal(h.requests.some(row=>row.body),false);assert.match(h.text(),/일치하지 않습니다/);
  h.choose('confirmPassword','synthetic-new-password');h.setPost(()=>held.promise);h.submit();h.submit();await h.settle();assert.equal(h.requests.filter(row=>row.body).length,1);assert.deepEqual(h.requests.find(row=>row.body).body,{action:'change-password',memberId:'admin',currentPassword:'synthetic-old-password',newPassword:'synthetic-new-password'});for(const name of ['currentPassword','newPassword','confirmPassword'])assert.equal(h.input(name).value,'');assert.doesNotMatch(h.text(),/synthetic-old-password|synthetic-new-password/);
  held.resolve(Response.json({ok:true,reauthenticate:true}));await h.settle();assert.deepEqual(h.redirects,['/login']);
 }finally{h.close();}
});

test('a wrong current password is an inline error and does not log out the user',async()=>{
 const h=account({post:async()=>Response.json({error:'현재 비밀번호를 확인해주세요.'},{status:403})});try{await h.start();for(const [name,value]of Object.entries({currentPassword:'synthetic-old-password',newPassword:'synthetic-new-password',confirmPassword:'synthetic-new-password'}))h.choose(name,value);h.submit();await h.settle();assert.match(h.text(),/현재 비밀번호를 확인해주세요/);assert.deepEqual(h.redirects,[]);assert.ok(h.field('currentPassword'));}finally{h.close();}
});

test('leaving account settings cancels reads and ignores late membership and expired-login responses',async()=>{
 for(const response of [Response.json({member:{id:'admin'},members:[]}),Response.json({error:'expired'},{status:401})]){
  const held=defer(),h=account({read:()=>held.promise});await h.start();assert.equal(h.requests[0].signal.aborted,false);h.close();assert.equal(h.requests[0].signal.aborted,true);held.resolve(response);await h.settle();assert.equal(h.lateWrites,0);assert.deepEqual(h.redirects,[]);
 }
});

test('account identity changes invalidate old actions and clear password inputs',async()=>{
 const h=account({pending:[member()]});try{await h.start();const stale=h.button('승인').props.onClick;h.choose('currentPassword','synthetic-private-password');h.identity({...member('approved'),id:'different-member',role:'member'});h.notify();await h.settle();stale();await h.settle();assert.equal(h.requests.some(row=>row.body),false);assert.equal(h.input('currentPassword').value,'');assert.doesNotMatch(h.text(),/fixture-admin/);assert.equal(h.button('승인'),undefined);}finally{h.close();}
});

test('logout/session reset aborts an outstanding mutation and late results cannot write or navigate',async()=>{
 const h=account({pending:[member()]}),held=defer();try{await h.start();h.setPost(()=>held.promise);h.button('승인').props.onClick();await h.settle();const mutation=h.requests.find(row=>row.body);h.notify('membership-session-changed');assert.equal(mutation.signal.aborted,true);held.resolve(Response.json({ok:true}));await h.settle();assert.deepEqual(h.redirects,[]);assert.equal(h.text().includes('new.member'),false);assert.equal(h.lateWrites,0);}finally{h.close();}
});
