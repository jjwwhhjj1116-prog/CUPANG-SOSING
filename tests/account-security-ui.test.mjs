import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const initialProfile=()=>({name:'합성 회원',phoneNumber:'01012345678',phoneVerifiedAt:null});

function fixture({kind='security',configured=true,search=''}={}){
 const calls=[],events=[],redirects=[],effects=[];let active,tree,closed=false,lateWrites=0,props={ownerId:'member-a'},reply=null;
 const savedProfile=initialProfile();
 const defaultReply=call=>{
  if(call.url==='/api/admin/sms-settings')return Response.json(call.method==='GET'?{ownerId:props.ownerId,configured,sender:configured?'0212345678':null,apiKeyHint:configured?'••••TEST':null}:{ok:true,ownerId:props.ownerId,configured:true,sender:'0212345678',apiKeyHint:'••••-key'});
  if(call.url==='/api/account-security'){
   if(call.method==='GET')return Response.json({ownerId:props.ownerId,profile:savedProfile,smsConfigured:configured});
   if(call.body.action==='update-profile'){savedProfile.name=call.body.name;return Response.json({ok:true,profile:savedProfile});}
   if(call.body.action==='phone-start')return Response.json({challengeId:'synthetic-phone-challenge'});
   if(call.body.action==='phone-verify'){savedProfile.phoneNumber='01099998888';savedProfile.phoneVerifiedAt='2026-10-31T00:00:00.000Z';return Response.json({ok:true,reauthenticate:true,profile:savedProfile});}
  }
  if(call.url==='/api/account-recovery'){
   if(call.body.action==='start')return Response.json({challengeId:'synthetic-recovery-challenge'});
   if(call.body.action==='verify')return Response.json({loginId:'synthetic-user',resetToken:'synthetic-reset-token'});
   if(call.body.action==='reset')return Response.json({ok:true});
  }
  throw Error('Unexpected fixture request');
 };
 const clean=instance=>{if(!instance)return;for(const field of instance.controls.values())if(typeof field.ref==='function')field.ref(null);for(const slot of instance.slots)slot?.cleanup?.();instance.mounted=false;};
 const hooks={
  useState(initial){const owner=active,index=owner.cursor++;if(!(index in owner.slots))owner.slots[index]={value:typeof initial==='function'?initial():initial};return[owner.slots[index].value,value=>{if(!owner.mounted){lateWrites++;return;}owner.slots[index].value=typeof value==='function'?value(owner.slots[index].value):value;}];},
  useRef(initial){const index=active.cursor++;return active.slots[index]??(active.slots[index]={current:initial});},
  useCallback(fn,deps){const index=active.cursor++,old=active.slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))active.slots[index]={deps,fn};return active.slots[index].fn;},
  useEffect(effect,deps){const owner=active,index=owner.cursor++,old=owner.slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i]))){owner.slots[index]={deps,cleanup:old?.cleanup};effects.push(()=>{if(!owner.mounted)return;old?.cleanup?.();owner.slots[index].cleanup=effect();});}},
 };
 const exports={},file=kind==='recovery'?'app/recover/page.tsx':'app/components/account-security-panel.tsx';
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,Error,Date,Event,AbortController,URLSearchParams,fetch:async(url,init={})=>{assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');const call={url,method:init.method??'GET',body:init.body?JSON.parse(init.body):undefined,signal:init.signal};calls.push(call);return reply?reply(call,defaultReply):defaultReply(call);},window:{dispatchEvent:event=>events.push(event.type),location:{search,assign:path=>redirects.push(path)},get localStorage(){assert.fail('credentials must not enter localStorage');},get sessionStorage(){assert.fail('credentials must not enter sessionStorage');}},require:name=>name==='react'?hooks:name.endsWith('.css')?{default:new Proxy({},{get:(_target,key)=>String(key)})}:native(name)});
 const Component=kind==='recovery'?exports.default:kind==='sms'?exports.AdminSmsSettingsPanel:exports.AccountSecurityPanel;
 function render(next=props){
  if(closed)return null;props=next;let wrapper;if(kind!=='recovery')wrapper=Component(props);const key=wrapper?.key??'recovery';
  if(!active||active.key!==key){clean(active);active={key,slots:[],controls:new Map(),cursor:0,mounted:true};}
  active.cursor=0;tree=wrapper?wrapper.type(wrapper.props):Component();
  const fields=nodes(tree).filter(node=>node.type==='input'&&node.props.name),present=new Set(fields.map(node=>node.props.name));
  for(const [name,control]of active.controls)if(!present.has(name)){control.ref?.(null);active.controls.delete(name);}
  for(const node of fields){const {name}=node.props;let control=active.controls.get(name);if(!control){control={value:'',ref:null};active.controls.set(name,control);}if(node.props.value!==undefined)control.value=node.props.value;if(control.ref&&control.ref!==node.props.ref)control.ref(null);control.ref=node.props.ref;if(typeof control.ref==='function')control.ref(control);control.node=node;}
  effects.splice(0).forEach(effect=>effect());return tree;
 }
 const h={calls,events,redirects,render,text:()=>text(render()),profile:savedProfile,get props(){return props;},get lateWrites(){return lateWrites;},setReply(value){reply=value;},
  field(name){render();return active.controls.get(name);},change(name,value){const field=h.field(name);assert.ok(field,name);assert.equal(Boolean(field.node.props.disabled),false,name);if(field.node.props.onChange)field.node.props.onChange({target:{value}});else field.value=value;render();},
  button(label){return nodes(render()).find(node=>node.type==='button'&&text(node)===label);},click(label){const button=h.button(label);assert.ok(button,label);assert.equal(Boolean(button.props.disabled),false,label);button.props.onClick();render();},
  submit(label){const form=nodes(render()).find(node=>node.type==='form'&&node.props['aria-label']===label);assert.ok(form,label);form.props.onSubmit({preventDefault(){}});render();return form.props.onSubmit;},
  async settle(){for(let i=0;i<10;i++){render();await new Promise(resolve=>setImmediate(resolve));}},scopeTo(next){render(next);},close(){if(closed)return;clean(active);closed=true;}};
 return h;
}

test('profile loads once and a serialized name update is scoped to the owner without storing credentials',async()=>{
 const h=fixture();try{await h.settle();assert.equal(h.calls.length,1);assert.equal(h.field('profileName').value,'합성 회원');assert.equal(h.field('profileName').node.props.maxLength,80);
  h.change('profileName','새 합성 이름');const callback=h.submit('이름 변경');callback({preventDefault(){}});await h.settle();
  assert.deepEqual(h.calls.filter(call=>call.method==='POST').map(call=>call.body),[{action:'update-profile',name:'새 합성 이름',expectedOwnerId:'member-a'}]);assert.equal(h.profile.name,'새 합성 이름');assert.deepEqual(h.events,['membership-updated']);assert.match(h.text(),/이름을 저장했습니다/);assert.equal(h.calls.filter(call=>call.method==='GET').length,1);
 }finally{h.close();}
});

test('unconfigured SMS disables phone enrollment and a retained submit cannot manufacture a challenge',async()=>{
 const h=fixture({configured:false});try{await h.settle();assert.match(h.text(),/문자 인증 서비스가 아직 설정되지 않았습니다/);assert.equal(h.button('인증번호 받기').props.disabled,true);h.submit('휴대전화 인증 요청');await h.settle();assert.equal(h.calls.length,1);assert.equal(h.field('phoneCode'),undefined);assert.match(h.text(),/관리자 설정 후/);
 }finally{h.close();}
});

test('foreign-owner metadata never binds a profile editor',async()=>{
 const h=fixture();try{h.setReply(()=>Response.json({ownerId:'other-member',profile:initialProfile(),smsConfigured:true}));await h.settle();assert.equal(h.field('profileName'),undefined);assert.equal(h.field('enrollmentPassword'),undefined);assert.equal(h.calls.length,1);assert.match(h.text(),/로그인 계정이 변경/);
 }finally{h.close();}
});

test('an uncertain profile write blocks retained callbacks until an explicit read confirms the latest profile',async()=>{
 const h=fixture();try{await h.settle();h.change('profileName','확인할 합성 이름');h.setReply((call,fallback)=>{if(call.method==='GET')return fallback(call);h.profile.name=call.body.name;throw Error('synthetic lost acknowledgement');});const submit=h.submit('이름 변경');await h.settle();assert.equal(h.button('이름 저장').props.disabled,true);submit({preventDefault(){}});await h.settle();assert.equal(h.calls.filter(call=>call.method==='POST').length,1);h.click('계정 정보 새로고침');await h.settle();assert.equal(h.field('profileName').value,'확인할 합성 이름');assert.equal(h.button('이름 저장').props.disabled,false);assert.equal(h.calls.filter(call=>call.method==='POST').length,1);
 }finally{h.close();}
});

test('phone enrollment clears the password before its response and sends one purpose-bound challenge verification',async()=>{
 const h=fixture(),held=deferred();try{await h.settle();h.change('enrollmentPhone','010-9999-8888');h.change('enrollmentPassword','SYNTHETIC-password-only');h.setReply((call,fallback)=>call.body?.action==='phone-start'?held.promise:fallback(call));
  const submit=h.submit('휴대전화 인증 요청');submit({preventDefault(){}});await h.settle();assert.equal(h.calls.filter(call=>call.method==='POST').length,1);assert.equal(h.field('enrollmentPassword').value,'');assert.deepEqual(h.calls.at(-1).body,{action:'phone-start',phone:'010-9999-8888',currentPassword:'SYNTHETIC-password-only',expectedOwnerId:'member-a'});
  held.resolve(Response.json({challengeId:'synthetic-phone-challenge'}));await h.settle();h.change('phoneCode','123456');h.submit('휴대전화 인증번호 확인');await h.settle();assert.deepEqual(h.calls.at(-1).body,{action:'phone-verify',challengeId:'synthetic-phone-challenge',code:'123456',expectedOwnerId:'member-a'});assert.equal(h.field('phoneCode'),undefined);assert.match(h.text(),/인증 완료/);assert.doesNotMatch(h.text(),/SYNTHETIC-password-only|123456/);assert.deepEqual(h.events,['membership-session-changed']);assert.deepEqual(h.redirects,['/login']);
 }finally{held.resolve();h.close();}
});

test('owner A→B→A aborts the old phone request, clears private fields and ignores its late result and callback',async()=>{
 const h=fixture(),held=deferred();try{await h.settle();h.change('enrollmentPassword','SYNTHETIC-old-password');const old=h.field('enrollmentPassword');h.setReply((call,fallback)=>call.method==='POST'?held.promise:fallback(call));const submit=h.submit('휴대전화 인증 요청');await h.settle();const pending=h.calls.at(-1);
  h.scopeTo({ownerId:'member-b'});await h.settle();h.scopeTo({ownerId:'member-a'});await h.settle();const count=h.calls.length;held.resolve(Response.json({challengeId:'stale-challenge'}));await h.settle();submit({preventDefault(){}});await h.settle();
  assert.equal(pending.signal.aborted,true);assert.equal(old.value,'');assert.equal(h.field('enrollmentPassword').value,'');assert.equal(h.calls.length,count);assert.equal(h.field('phoneCode'),undefined);assert.equal(h.lateWrites,0);
 }finally{held.resolve();h.close();}
});

test('admin SOLAPI metadata never preloads keys and saving clears all secrets while forwarding the exact owner',async()=>{
 const h=fixture({kind:'sms'}),held=deferred();try{await h.settle();assert.equal(h.field('smsApiKey').value,'');assert.equal(h.field('smsApiSecret').value,'');assert.equal(h.field('smsApiKey').node.props.type,'password');assert.equal(h.field('smsApiSecret').node.props.type,'password');assert.match(h.text(),/SOLAPI/);
  h.change('smsCurrentPassword','SYNTHETIC-current-password');h.change('smsApiKey','SYNTHETIC-key');h.change('smsApiSecret','SYNTHETIC-secret');h.change('smsSender','0212345678');h.setReply((call,fallback)=>call.method==='POST'?held.promise:fallback(call));const callback=h.submit('SOLAPI 설정 저장');callback({preventDefault(){}});await h.settle();
  assert.equal(h.calls.filter(call=>call.method==='POST').length,1);assert.deepEqual(h.calls.at(-1).body,{expectedOwnerId:'member-a',currentPassword:'SYNTHETIC-current-password',apiKey:'SYNTHETIC-key',apiSecret:'SYNTHETIC-secret',sender:'0212345678'});for(const name of ['smsCurrentPassword','smsApiKey','smsApiSecret'])assert.equal(h.field(name).value,'');
  held.resolve(Response.json({ok:true,ownerId:'member-a',configured:true,sender:'0212345678',apiKeyHint:'••••-key'}));await h.settle();assert.match(h.text(),/문자 인증 설정을 저장했습니다/);assert.doesNotMatch(h.text(),/SYNTHETIC-current-password|SYNTHETIC-key|SYNTHETIC-secret/);
 }finally{held.resolve();h.close();}
});

test('find ID never sends a login ID and only exposes the verified result',async()=>{
 const h=fixture({kind:'recovery'});try{await h.settle();assert.equal(h.calls.length,0);h.change('recoveryName','합성 회원');h.change('recoveryPhone','+82 10-1234-5678');const start=h.submit('계정 인증 요청');start({preventDefault(){}});await h.settle();assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].body,{action:'start',purpose:'find-id',name:'합성 회원',phone:'+82 10-1234-5678'});assert.doesNotMatch(h.text(),/synthetic-user/);
  h.change('recoveryCode','123456');h.submit('계정 인증번호 확인');await h.settle();assert.deepEqual(h.calls.at(-1).body,{action:'verify',challengeId:'synthetic-recovery-challenge',code:'123456'});assert.match(h.text(),/synthetic-user/);assert.equal(h.field('recoveryCode'),undefined);assert.doesNotMatch(h.text(),/synthetic-reset-token/);
 }finally{h.close();}
});

test('a password-reset link initializes after hydration and requires the login ID in its first request',async()=>{
 const h=fixture({kind:'recovery',search:'?purpose=reset-password'});try{
  const initial=h.render();assert.equal(nodes(initial).some(node=>node.type==='input'&&node.props.name==='recoveryLoginId'),false,'The initial render must match the default server render.');
  await h.settle();assert.ok(h.field('recoveryLoginId'));assert.equal(h.button('비밀번호 재설정').props['aria-pressed'],true);assert.equal(h.button('아이디 찾기').props['aria-pressed'],false);
  h.change('recoveryName','합성 회원');h.change('recoveryPhone','01012345678');h.submit('계정 인증 요청');await h.settle();assert.equal(h.calls.length,0,'Reset requests require a login ID even without native form validation.');
  h.change('recoveryLoginId','synthetic-user');h.submit('계정 인증 요청');await h.settle();assert.deepEqual(h.calls.map(call=>call.body),[{action:'start',purpose:'reset-password',name:'합성 회원',phone:'01012345678',loginId:'synthetic-user'}]);
 }finally{h.close();}
});

test('unknown, malformed and ambiguous recovery-purpose queries safely default to ID lookup',async()=>{
 for(const search of ['', '?purpose=find-id', '?purpose=unknown', '?purpose=%E0%A4%A', '?purpose=%2Freset-password', '?purpose=reset-password&purpose=find-id']){
  const h=fixture({kind:'recovery',search});try{await h.settle();assert.equal(h.field('recoveryLoginId'),undefined,search);assert.equal(h.button('아이디 찾기').props['aria-pressed'],true,search);h.change('recoveryName','합성 회원');h.change('recoveryPhone','01012345678');h.submit('계정 인증 요청');await h.settle();assert.deepEqual(h.calls[0].body,{action:'start',purpose:'find-id',name:'합성 회원',phone:'01012345678'},search);
  }finally{h.close();}
 }
});

test('password recovery keeps the reset token in memory and clears passwords before a single reset write',async()=>{
 const h=fixture({kind:'recovery'}),held=deferred();try{await h.settle();h.click('비밀번호 재설정');h.change('recoveryLoginId','synthetic-user');h.change('recoveryName','합성 회원');h.change('recoveryPhone','01012345678');h.submit('계정 인증 요청');await h.settle();assert.equal(h.calls[0].body.purpose,'reset-password');assert.equal(h.calls[0].body.loginId,'synthetic-user');
  h.change('recoveryCode','123456');h.submit('계정 인증번호 확인');await h.settle();assert.equal(h.field('recoveryPassword').value,'');assert.doesNotMatch(h.text(),/synthetic-reset-token/);
  h.change('recoveryPassword','SYNTHETIC-next-password');h.change('recoveryConfirmation','wrong-confirmation');h.submit('새 비밀번호 설정');await h.settle();assert.equal(h.calls.length,2);
  h.change('recoveryConfirmation','SYNTHETIC-next-password');h.setReply((call,fallback)=>call.body?.action==='reset'?held.promise:fallback(call));const callback=h.submit('새 비밀번호 설정');callback({preventDefault(){}});await h.settle();assert.equal(h.calls.length,3);assert.deepEqual(h.calls.at(-1).body,{action:'reset',resetToken:'synthetic-reset-token',newPassword:'SYNTHETIC-next-password'});assert.equal(h.field('recoveryPassword').value,'');assert.equal(h.field('recoveryConfirmation').value,'');
  held.resolve(Response.json({ok:true}));await h.settle();assert.match(h.text(),/비밀번호를 변경했습니다/);assert.equal(h.field('recoveryPassword'),undefined);
 }finally{held.resolve();h.close();}
});

test('changing recovery purpose aborts the previous request and rejects late challenges and unmounted writes',async()=>{
 const h=fixture({kind:'recovery'}),held=deferred();try{await h.settle();h.change('recoveryName','합성 회원');h.change('recoveryPhone','01012345678');h.setReply(()=>held.promise);h.submit('계정 인증 요청');const pending=h.calls.at(-1);h.click('비밀번호 재설정');assert.equal(pending.signal.aborted,true);held.resolve(Response.json({challengeId:'old-challenge'}));await h.settle();assert.ok(h.field('recoveryLoginId'));assert.equal(h.field('recoveryCode'),undefined);assert.equal(h.lateWrites,0);h.close();assert.equal(h.lateWrites,0);
 }finally{held.resolve();h.close();}
});

test('SMS unavailable is displayed honestly without echoing provider errors or claiming a message was sent',async()=>{
 const h=fixture({kind:'recovery'});try{await h.settle();h.change('recoveryName','합성 회원');h.change('recoveryPhone','01012345678');h.setReply(()=>Response.json({error:'SYNTHETIC-private-provider-detail'},{status:503}));h.submit('계정 인증 요청');await h.settle();assert.match(h.text(),/문자 인증 서비스가 아직 준비되지 않았습니다/);assert.doesNotMatch(h.text(),/SYNTHETIC-private-provider-detail|인증번호를 보냅니다/);assert.equal(h.field('recoveryCode'),undefined);assert.equal(h.calls.length,1);
 }finally{h.close();}
});
