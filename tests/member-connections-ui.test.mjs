import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
const native=createRequire(import.meta.url),plain=value=>JSON.parse(JSON.stringify(value));
const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const profile=(id='11111111-1111-4111-8111-111111111111',service='supplier-hub')=>({id,service,alias:'기존 별칭',loginId:'synthetic-login',hasPassword:true,enabled:true,revision:1,createdAt:'2026-10-29T00:00:00.000Z',updatedAt:'2026-10-29T00:00:00.000Z'});

function fixture(company=companies[0],rows=[profile()]){
 const calls=[],instances=[],effects=[];let active,tree,closed=false,lateWrites=0,scope={ownerId:'member-a',company:plain(company)},reply=null;
 const profiles=plain(rows);
 const view=()=>({ownerId:scope.ownerId,company:plain(scope.company),profiles:plain(profiles)});
 const clean=instance=>{if(!instance)return;instance.ref?.(null);for(const slot of instance.slots)slot?.cleanup?.();instance.mounted=false;};
 const hooks={
  useState(initial){const owner=active,index=owner.cursor++;if(!(index in owner.slots))owner.slots[index]={value:typeof initial==='function'?initial():initial};return[owner.slots[index].value,value=>{if(!owner.mounted){lateWrites++;return;}owner.slots[index].value=typeof value==='function'?value(owner.slots[index].value):value;}];},
  useRef(initial){const index=active.cursor++;return active.slots[index]??(active.slots[index]={current:initial});},
  useCallback(fn,deps){const index=active.cursor++,previous=active.slots[index];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i])))active.slots[index]={deps,fn};return active.slots[index].fn;},
  useEffect(effect,deps){const owner=active,index=owner.cursor++,old=owner.slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i]))){owner.slots[index]={deps,cleanup:old?.cleanup};effects.push(()=>{if(!owner.mounted)return;old?.cleanup?.();owner.slots[index].cleanup=effect();});}},
 };
 const fetcher=async(url,init={})=>{
  assert.equal(url,'/api/member-connections');assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');
  const call={url,method:init.method??'GET',body:init.body?JSON.parse(init.body):undefined,signal:init.signal};calls.push(call);if(reply)return reply(call,view);
  if(call.method==='GET')return Response.json(view());const body=call.body;assert.equal(body.expectedOwnerId,scope.ownerId);assert.deepEqual(body.expectedCompany,scope.company);
  let row=profiles.find(item=>item.id===body.id);
  if(body.action==='save'){
   if(!row){row={...profile(body.id,body.service),revision:0};profiles.push(row);}
   Object.assign(row,{alias:body.alias,loginId:body.loginId,revision:row.revision+1});
  }else{assert.equal(body.action,'set-enabled');row.enabled=body.enabled;row.revision++;}
  return Response.json(view());
 };
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/member-connections-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,Error,Date,Set,AbortController,crypto:webcrypto,fetch:fetcher,window:{get localStorage(){assert.fail('credentials may never enter localStorage');},get sessionStorage(){assert.fail('credentials may never enter sessionStorage');}},require:name=>name==='react'?hooks:name.endsWith('.css')?{}:native(name)});
 const Component=exports.MemberConnectionsPanel;
 function render(next=scope){
  if(closed)return null;scope=next;const wrapper=Component(scope),key=wrapper.key;
  if(!active||active.key!==key){clean(active);active={key,slots:[],cursor:0,mounted:true,password:{value:''}};instances.push(active);}
  active.cursor=0;tree=wrapper.type(wrapper.props);const ref=nodes(tree).find(node=>node.type==='input'&&node.props.type==='password')?.props.ref;
  if(ref){ref(active.password);active.ref=ref;}else{active.ref?.(null);active.ref=null;}effects.splice(0).forEach(effect=>effect());return tree;
 }
 const h={calls,profiles,view,render,text:()=>text(render()),setReply(value){reply=value;},get lateWrites(){return lateWrites;},get scope(){return scope;},get password(){render();return active.password;},
  button(label){return nodes(render()).find(node=>node.type==='button'&&text(node)===label);},field(label){const node=nodes(render()).find(node=>node.type==='label'&&node.props.children[0]===label);return nodes(node).find(item=>['input','select'].includes(item.type));},
  change(label,value){h.field(label).props.onChange({target:{value}});render();},
  async settle(){for(let count=0;count<12;count++){render();await new Promise(resolve=>setImmediate(resolve));}},
  async click(label){const button=h.button(label);assert.ok(button,label);assert.equal(Boolean(button.props.disabled),false,label);button.props.onClick();await h.settle();},
  submit(){const form=nodes(render()).find(node=>node.type==='form');assert.ok(form);form.props.onSubmit({preventDefault(){}});},
  scopeTo(next){render(next);},close(){if(closed)return;clean(active);closed=true;}};
 return h;
}

for(const company of companies)test(company.code+': multiple own profiles expose only password presence and blank replacement preserves the existing password',async()=>{
 const h=fixture(company,[profile(),{...profile('22222222-2222-4222-8222-222222222222','1688'),alias:'1688 별칭'}]);try{
  await h.settle();assert.match(h.text(),/멀티 계정 설정/);assert.match(h.text(),/Supplier Hub/);assert.match(h.text(),/1688 별칭/);assert.equal(h.password.value,'');assert.equal(h.field('비밀번호').props.value,undefined);assert.equal(h.field('비밀번호').props.autoComplete,'new-password');
  const edit=nodes(h.render()).find(node=>node.type==='button'&&text(node)==='수정');edit.props.onClick();await h.settle();assert.equal(h.field('서비스').props.disabled,true);assert.equal(h.password.value,'');assert.match(h.text(),/비밀번호 공란은 기존 값 유지/);
  h.change('별칭','새 별칭');h.submit();h.submit();await h.settle();const posts=h.calls.filter(call=>call.method==='POST');assert.equal(posts.length,1);assert.equal(posts[0].body.password,'');assert.equal(posts[0].body.expectedRevision,1);assert.equal(posts[0].body.id,profile().id);assert.equal(h.profiles[0].hasPassword,true);assert.equal(h.profiles[0].revision,2);assert.equal(h.password.value,'');
  assert.equal(h.calls.some(call=>call.method==='DELETE'),false);assert.doesNotMatch(h.text(),/연결 완료|자동 로그인|MCP 연결/);
 }finally{h.close();}
});

test('a newly entered synthetic password is sent once, cleared before response, and never rendered as text or saved in browser storage',async()=>{
 const h=fixture(companies[0],[]),held=deferred();try{
  await h.settle();h.change('서비스','1688');h.change('별칭','새 계정');h.change('로그인 ID','new-synthetic-login');h.password.value='fake-test-password-only';
  h.setReply(call=>call.method==='POST'?held.promise:Response.json(h.view()));const submit=nodes(h.render()).find(node=>node.type==='form').props.onSubmit;submit({preventDefault(){}});submit({preventDefault(){}});await h.settle();
  const post=h.calls.find(call=>call.method==='POST');assert.equal(post.body.password,'fake-test-password-only');assert.equal(post.body.expectedRevision,0);assert.equal(h.calls.filter(call=>call.method==='POST').length,1);assert.equal(h.password.value,'');assert.doesNotMatch(h.text(),/fake-test-password-only/);
  held.resolve(Response.json({...h.view(),profiles:[{...profile(post.body.id,'1688'),alias:'새 계정',loginId:'new-synthetic-login'}]}));await h.settle();assert.match(h.text(),/저장했습니다/);assert.equal(h.password.value,'');
 }finally{held.resolve();h.close();}
});

test('disable and restore retain the same profile and use its exact revision without a delete or credential read',async()=>{
 const h=fixture();try{await h.settle();await h.click('비활성화');assert.equal(h.profiles[0].enabled,false);assert.equal(h.profiles[0].id,profile().id);await h.click('다시 사용');assert.equal(h.profiles[0].enabled,true);
  const posts=h.calls.filter(call=>call.method==='POST');assert.deepEqual(posts.map(call=>({action:call.body.action,id:call.body.id,revision:call.body.expectedRevision,enabled:call.body.enabled})),[{action:'set-enabled',id:profile().id,revision:1,enabled:false},{action:'set-enabled',id:profile().id,revision:2,enabled:true}]);assert.ok(posts.every(call=>!Object.hasOwn(call.body,'password')));assert.equal(h.profiles.length,1);
 }finally{h.close();}
});

test('API-aligned limits accept 201–254 character login IDs and 60 character aliases while rejecting either overflow before a write',async()=>{
 for(const length of [201,254]){const alias='a'.repeat(60),loginId='x'.repeat(length),h=fixture(companies[0],[{...profile(),alias,loginId}]);try{
  await h.settle();assert.ok(h.text().includes(loginId));await h.click('수정');assert.equal(h.field('별칭').props.maxLength,60);assert.equal(h.field('로그인 ID').props.maxLength,254);assert.equal(h.field('로그인 ID').props.value,loginId);
  h.submit();await h.settle();assert.match(h.text(),/저장했습니다/);const post=h.calls.find(call=>call.method==='POST');assert.equal(post.body.alias,alias);assert.equal(post.body.loginId,loginId);
  h.change('별칭','a'.repeat(61));h.submit();await h.settle();assert.equal(h.calls.filter(call=>call.method==='POST').length,1);assert.match(h.text(),/별칭·로그인 ID와 비밀번호를 확인/);
  h.change('별칭',alias);h.change('로그인 ID','x'.repeat(255));h.submit();await h.settle();assert.equal(h.calls.filter(call=>call.method==='POST').length,1);
 }finally{h.close();}}
});

test('missing encryption key is shown accurately and malformed secret-bearing or foreign-scope responses never populate the form',async()=>{
 for(const mode of ['unconfigured','password','ciphertext','owner','company','overcap']){const h=fixture();try{
  h.setReply(()=>{const body=h.view();if(mode==='unconfigured')return Response.json({code:'MEMBER_CONNECTIONS_NOT_CONFIGURED',error:'never-display-raw-secret'},{status:503});if(mode==='password')body.profiles[0].password='never-display-raw-secret';if(mode==='ciphertext')body.profiles[0].ciphertext='never-display-raw-secret';if(mode==='owner')body.ownerId='other-member';if(mode==='company')body.company=companies[1];if(mode==='overcap')body.profiles=Array.from({length:21},(_,i)=>profile('11111111-1111-4111-8111-'+String(i).padStart(12,'0')));return Response.json(body);});
  await h.settle();assert.equal(h.field('비밀번호'),undefined,mode);assert.equal(h.button('계정 등록'),undefined,mode);assert.doesNotMatch(h.text(),/never-display-raw-secret/,mode);if(mode==='unconfigured')assert.match(h.text(),/서버 암호화 키가 설정되지 않아/,mode);assert.equal(h.calls.length,1);
 }finally{h.close();}}
});

test('a confirmed CAS conflict preserves edits and public metadata while suppressing raw server errors',async()=>{
 const h=fixture();try{await h.settle();await h.click('수정');h.change('별칭','현재 입력 보존');h.password.value='fake-replacement';h.setReply(call=>call.method==='POST'?Response.json({error:'fake-replacement'},{status:409}):Response.json(h.view()));h.submit();await h.settle();
  assert.equal(h.field('별칭').props.value,'현재 입력 보존');assert.match(h.text(),/기존 별칭/);assert.match(h.text(),/저장값이 변경/);assert.doesNotMatch(h.text(),/fake-replacement/);assert.equal(h.password.value,'');assert.equal(h.profiles[0].revision,1);assert.equal(h.button('변경 저장').props.disabled,false);
 }finally{h.close();}
});

test('an unknown create response blocks retained save callbacks and explicit refresh discovers the same ID without another write',async()=>{
 const h=fixture(companies[0],[]);try{await h.settle();h.change('별칭','새 프로필');h.change('로그인 ID','synthetic');h.password.value='fake-password';
  h.setReply(call=>{if(call.method==='GET')return Response.json(h.view());h.profiles.push({...profile(call.body.id),alias:call.body.alias,loginId:call.body.loginId});throw Error('uncertain synthetic acknowledgement');});
  const submit=nodes(h.render()).find(node=>node.type==='form').props.onSubmit;submit({preventDefault(){}});await h.settle();assert.equal(h.button('계정 등록').props.disabled,true);assert.match(h.text(),/이전 저장 결과/);submit({preventDefault(){}});await h.settle();assert.equal(h.calls.filter(call=>call.method==='POST').length,1);
  const id=h.calls.find(call=>call.method==='POST').body.id;await h.click('목록 새로고침');assert.equal(h.profiles[0].id,id);assert.equal(h.button('변경 저장').props.disabled,false);assert.equal(h.calls.filter(call=>call.method==='POST').length,1);assert.equal(h.password.value,'');
 }finally{h.close();}
});

test('owner/company A→B→A unmounts the old write, clears its password and rejects late response and retained callbacks',async()=>{
 const h=fixture(),held=deferred();try{await h.settle();await h.click('수정');h.change('별칭','옛 입력');const oldPassword=h.password;oldPassword.value='fake-old-secret';h.setReply(call=>call.method==='POST'?held.promise:Response.json(h.view()));const submit=nodes(h.render()).find(node=>node.type==='form').props.onSubmit;submit({preventDefault(){}});await h.settle();
  const original=plain(h.scope);h.scopeTo({ownerId:'member-b',company:companies[1]});await h.settle();h.scopeTo(original);await h.settle();const before=h.calls.length;
  held.resolve(Response.json({...h.view(),profiles:[{...profile(),alias:'옛 입력',revision:2}]}));await h.settle();submit({preventDefault(){}});await h.settle();
  assert.equal(h.calls.length,before);assert.equal(oldPassword.value,'');assert.equal(h.password.value,'');assert.equal(h.lateWrites,0);assert.doesNotMatch(h.text(),/옛 입력|fake-old-secret/);assert.match(h.text(),/기존 별칭/);
 }finally{held.resolve();h.close();}
});
