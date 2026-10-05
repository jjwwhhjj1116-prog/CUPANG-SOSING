import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url),storageKey='yoofam.login.preferences.v1';
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);

/** Actual page/panel, preference helper and submit handlers. This small DOM
 * model preserves uncontrolled values and checkbox FormData semantics. */
function ui({panel=false,storage=new Map(),reply=async()=>Response.json({ok:true}),storageBlocked=false,autofill}={}){
 const states=[],effects=[],modules=new Map(),controls=new Map(),calls=[],redirects=[],storageWrites=[];let cursor=0,tree;
 const hooks={useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>states[i]=typeof value==='function'?value(states[i]):value];},useRef(initial){const i=cursor++;return states[i]??(states[i]={current:initial});},useEffect(fn,deps){const i=cursor++,old=states[i];if(!old||deps.some((value,j)=>!Object.is(value,old.deps[j]))){const next={deps};states[i]=next;effects.push(()=>{old?.cleanup?.();next.cleanup=fn();});}}};
 class FormValues{constructor(form){this.values=new Map([...form.controls.values()].filter(control=>!control.disabled&&(control.type!=='checkbox'||control.checked)).map(control=>[control.name,control.type==='checkbox'?'on':control.value]));}get(name){return this.values.get(name)??null;}}
 const window={location:{assign:url=>redirects.push(url)},localStorage:{getItem(key){if(storageBlocked)throw Error('Storage disabled');return storage.get(key)??null;},setItem(key,value){if(storageBlocked)throw Error('Storage disabled');storageWrites.push({key,value});storage.set(key,value);}}};
 function load(file){if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,FormData:FormValues,window,fetch:async(url,init)=>{const call={url,method:init.method,body:JSON.parse(init.body)};calls.push(call);return reply(call);},require(name){if(name==='react')return hooks;if(name.endsWith('.css'))return{default:new Proxy({},{get:(_target,key)=>String(key)})};if(name.startsWith('@/'))return load(name.slice(2)+'.ts');return native(name);}});return exports;
 }
 const component=panel?load('app/components/login-preferences-panel.tsx').LoginPreferencesPanel:load('app/login/page.tsx').default;
 let initial=true;
 function render(){cursor=0;tree=component(panel?{email:'member@example.test'}:undefined);const inputs=nodes(tree).filter(node=>node.type==='input'&&node.props.name),present=new Set(inputs.map(node=>node.props.name));
  for(const key of controls.keys())if(!present.has(key))controls.delete(key);
  for(const node of inputs){const {name,type}=node.props;let control=controls.get(name);if(!control){control={name,type,value:node.props.defaultValue??'',checked:Boolean(node.props.defaultChecked)};controls.set(name,control);}Object.assign(control,{type,disabled:Boolean(node.props.disabled),node});if(node.props.value!==undefined)control.value=node.props.value;if(node.props.checked!==undefined)control.checked=node.props.checked;}
  if(initial&&autofill){for(const [name,value]of Object.entries(autofill))controls.get(name).value=value;}initial=false;
  const form=nodes(tree).find(node=>node.type==='form'),dom={controls,elements:{namedItem:name=>controls.get(name)??null}};form.props.ref.current=dom;
  effects.splice(0).forEach(effect=>effect());return tree;
 }
 const form=()=>nodes(render()).find(node=>node.type==='form');render();
 return{calls,redirects,storage,storageWrites,render,load,
  input(name){render();return controls.get(name);},
  choose(name,value){const control=this.input(name);assert.ok(control&&!control.disabled,name);if(control.type==='checkbox')control.checked=value;else control.value=value;control.node.props.onChange?.({target:control});render();},
  button(label){return nodes(render()).find(node=>node.type==='button'&&(node.props['aria-label']===label||text(node)===label));},
  click(label){const button=this.button(label);assert.ok(button&&!button.props.disabled,label);button.props.onClick();render();},
  submit(){const node=form();const promise=node.props.onSubmit({preventDefault(){},currentTarget:node.props.ref.current});render();return promise;},
  close(){states.forEach(state=>state?.cleanup?.());},
 };
}

test('login submits selected duration, remembers only email and choices, and restores them on return',async()=>{
 const storage=new Map(),h=ui({storage});try{
  assert.equal(h.input('rememberEmail').checked,true);assert.equal(h.input('rememberMe').checked,true);
  assert.equal(h.input('email').node.props.autoComplete,'username');assert.equal(h.input('password').node.props.autoComplete,'current-password');
  h.choose('email','Member@Example.Test');h.choose('password','TEST-ONLY-password-123');await h.submit();
  assert.deepEqual(h.calls,[{url:'/api/membership',method:'POST',body:{action:'login',email:'Member@Example.Test',password:'TEST-ONLY-password-123',rememberMe:true,companyCode:null,companyName:null}}]);
  assert.deepEqual(JSON.parse(storage.get(storageKey)),{email:'member@example.test',rememberEmail:true,rememberMe:true});assert.deepEqual(h.redirects,['/']);
  assert.ok(h.storageWrites.every(write=>!write.value.includes('password')&&!write.value.includes('TEST-ONLY')));
  const returned=ui({storage});try{assert.equal(returned.input('email').value,'member@example.test');assert.equal(returned.input('password').value,'');assert.equal(returned.input('rememberMe').checked,true);}finally{returned.close();}
 }finally{h.close();}
});

test('unchecked email is removed immediately and short login survives a revisit without saving the password',async()=>{
 const storage=new Map([[storageKey,JSON.stringify({email:'old@example.test',rememberEmail:true,rememberMe:true})]]),h=ui({storage});try{
  h.choose('rememberEmail',false);assert.equal(JSON.parse(storage.get(storageKey)).email,'');
  h.choose('email','new@example.test');h.choose('password','TEST-ONLY-password-456');h.choose('rememberMe',false);await h.submit();
  assert.equal(h.calls[0].body.rememberMe,false);assert.deepEqual(JSON.parse(storage.get(storageKey)),{email:'',rememberEmail:false,rememberMe:false});
  const returned=ui({storage});try{assert.equal(returned.input('email').value,'');assert.equal(returned.input('password').value,'');assert.equal(returned.input('rememberEmail').checked,false);assert.equal(returned.input('rememberMe').checked,false);}finally{returned.close();}
 }finally{h.close();}
});

test('failed login preserves form entries, does not persist credentials, and prevents duplicate submits while pending',async()=>{
 let resolve;const pending=new Promise(done=>{resolve=done;});let attempts=0;const h=ui({reply:()=>++attempts===1?pending:Response.json({ok:true})});try{
  h.choose('email','member@example.test');h.choose('password','TEST-ONLY-password-789');
  const first=h.submit(),second=h.submit();assert.equal(h.calls.length,1);assert.equal(h.input('password').disabled,true);
  resolve(Response.json({error:'승인 상태를 확인해주세요.'},{status:401}));await Promise.all([first,second]);
  assert.equal(h.input('email').value,'member@example.test');assert.equal(h.input('password').value,'TEST-ONLY-password-789');
  assert.match(text(h.render()),/승인 상태를 확인해주세요/);assert.equal(h.storage.size,0);assert.deepEqual(h.redirects,[]);
  await h.submit();assert.equal(h.calls.length,2);assert.deepEqual(h.redirects,['/']);
 }finally{h.close();}
});

test('signup submits typed company facts and keeps approval success separate from login and remembered values',async()=>{
 const storage=new Map([[storageKey,JSON.stringify({email:'remembered@example.test',rememberEmail:true,rememberMe:false})]]),h=ui({storage,reply:async()=>Response.json({message:'승인 후 로그인해주세요.'})});try{
  const before=storage.get(storageKey);h.click('회원가입 요청');assert.equal(h.input('password').node.props.autoComplete,'new-password');
  assert.equal(h.input('companyCode').value,'');assert.equal(h.input('companyName').value,'');assert.equal(h.input('rememberMe'),undefined);
  h.choose('email','request@example.test');h.choose('password','TEST-ONLY-signup-password');h.choose('companyCode','A01526306');h.choose('companyName','유앤채');
  h.click('비밀번호 보기');assert.equal(h.input('password').type,'text');h.click('비밀번호 숨기기');assert.equal(h.input('password').type,'password');
  await h.submit();assert.deepEqual(h.calls[0].body,{action:'signup',email:'request@example.test',password:'TEST-ONLY-signup-password',rememberMe:false,companyCode:'A01526306',companyName:'유앤채'});
  assert.ok(nodes(h.render()).some(node=>node.props?.role==='status'&&text(node).includes('승인 후 로그인')));assert.equal(nodes(h.render()).find(node=>node.type==='button'&&node.props.type==='submit').props.disabled,true);
  assert.deepEqual(h.redirects,[]);assert.equal(storage.get(storageKey),before);
  h.click('로그인');assert.equal(h.input('password').node.props.autoComplete,'current-password');assert.equal(h.input('rememberMe').checked,false);assert.equal(h.input('companyCode'),undefined);
 }finally{h.close();}
});

test('password manager entries and storage-disabled browsers remain usable without persisting secrets',async()=>{
 const saved=JSON.stringify({email:'saved@example.test',rememberEmail:true,rememberMe:true});
 const autofilled=ui({storage:new Map([[storageKey,saved]]),autofill:{email:'browser-filled@example.test',password:'TEST-ONLY-browser-password'}});
 try{assert.equal(autofilled.input('email').value,'browser-filled@example.test');assert.equal(autofilled.input('password').value,'TEST-ONLY-browser-password');}finally{autofilled.close();}
 const h=ui({storageBlocked:true});try{
  h.choose('email','member@example.test');h.choose('password','TEST-ONLY-private-password');await h.submit();assert.deepEqual(h.redirects,['/']);assert.equal(h.storageWrites.length,0);
  assert.equal(h.calls[0].body.rememberMe,true);
 }finally{h.close();}
});

test('account preferences change only the current session with true or false duration and no password or member ID',async()=>{
 const h=ui({panel:true});try{
  for(const rememberMe of [true,false]){
   h.choose('rememberMe',rememberMe);h.choose('rememberEmail',rememberMe);await h.submit();
   assert.deepEqual(h.calls.at(-1),{url:'/api/membership',method:'POST',body:{action:'remember-session',rememberMe}});
   assert.deepEqual(JSON.parse(h.storage.get(storageKey)),{email:rememberMe?'member@example.test':'',rememberEmail:rememberMe,rememberMe});
   assert.match(text(h.render()),rememberMe?/30일 동안/:/8시간 동안/);
  }
  assert.deepEqual(h.redirects,[]);assert.ok(h.storageWrites.every(write=>!write.value.includes('password')));
 }finally{h.close();}
});

test('account preference failures preserve choices and stored data, and an expired session goes to login',async()=>{
 for(const status of [503,401]){
  const storage=new Map([[storageKey,JSON.stringify({email:'member@example.test',rememberEmail:true,rememberMe:true})]]),before=storage.get(storageKey);
  let resolve;const h=ui({panel:true,storage,reply:()=>new Promise(done=>{resolve=done;})});try{
   h.choose('rememberEmail',false);h.choose('rememberMe',false);const first=h.submit(),second=h.submit();assert.equal(h.calls.length,1);
   resolve(Response.json({error:'시험 저장 실패'},{status}));await Promise.all([first,second]);
   assert.equal(h.input('rememberMe').checked,false);assert.equal(h.input('rememberEmail').checked,false);assert.equal(storage.get(storageKey),before);
   assert.deepEqual(h.redirects,status===401?['/login']:[]);if(status===503)assert.ok(nodes(h.render()).some(node=>node.props?.role==='alert'&&text(node).includes('시험 저장 실패')));
  }finally{h.close();}
 }
});
