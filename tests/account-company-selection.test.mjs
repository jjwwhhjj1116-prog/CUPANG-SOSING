import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const settle=async()=>{for(let index=0;index<10;index++)await new Promise(resolve=>setImmediate(resolve));};
function account({code='',name='',pending=[],read}={}){
 const slots=[],effects=[],cleanups=[],requests=[],redirects=[],cache=new Map();let cursor=0,started=false,writes=0;
 const self={id:'admin',email:'fixture-admin@example.test',role:'admin',status:'approved',companyCode:code,companyName:name};
 const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return[slots[index],value=>{writes++;slots[index]=typeof value==='function'?value(slots[index]):value;}];},useEffect(fn){if(!started)effects.push(fn);}};
 class FormValues{constructor(form){this.values=new Map(nodes(form).filter(node=>node.props?.name).map(node=>[node.props.name,node.props.value??node.props.defaultValue??'']));}get(name){return this.values.get(name)??null;}}
 function load(file){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,FormData:FormValues,window:{location:{assign:path=>redirects.push(path),replace:path=>redirects.push(path)}},fetch:async(url,init)=>{
   const body=init?.body?JSON.parse(init.body):null;requests.push({url,body,signal:init?.signal});return !body&&read?read():Response.json(body?{ok:true,reauthenticate:body.memberId===self.id}:{member:self,members:[self,...pending]});
  },require(name){if(name==='react')return hooks;if(name.startsWith('@/'))return load(name.slice(2)+(name.includes('/components/')?'.tsx':'.ts'));return native(name);}});return exports;
 }
 const Page=load('app/account/page.tsx').default;
 function render(){cursor=0;const tree=Page();started=true;effects.splice(0).forEach(effect=>{const cleanup=effect();if(typeof cleanup==='function')cleanups.push(cleanup);});return tree;}
 return {render,requests,redirects,writes:()=>writes,close:()=>cleanups.splice(0).forEach(cleanup=>cleanup()),async start(){render();await settle();},button(label){return nodes(render()).find(node=>node.type==='button'&&node.props.children===label);},field(name){return nodes(render()).find(node=>node.props?.name===name);},async submit(){const form=nodes(render()).find(node=>node.type==='form');form.props.onSubmit({preventDefault(){},currentTarget:form});await settle();}};
}

test('assigned company is read-only and the account screen exposes no reassignment form',async()=>{
 const h=account({code:'A01526306',name:'유앤채'});await h.start();
 assert.equal(h.button('회사정보 수정'),undefined);assert.equal(h.field('companyCode'),undefined);assert.equal(h.field('companyName'),undefined);
 assert.equal(h.requests.some(request=>request.body),false);
});

test('administrator can suspend and resume the second fixed account without sending company or password data',async()=>{
 for(const status of ['approved','suspended']){
  const h=account({code:'A01526306',name:'유앤채',pending:[{id:'member',email:'unari8484@gmail.com',role:'member',status,companyCode:'A01464742',companyName:'와이홉'}]});await h.start();
  h.button(status==='approved'?'이용 정지':'이용 재개').props.onClick();await settle();
  assert.deepEqual(h.requests.find(request=>request.body).body,{action:status==='approved'?'suspend':'approve',memberId:'member'});
 }
});

test('leaving account settings cancels the read and ignores late membership or expired-login responses',async()=>{
 for(const response of [Response.json({member:{id:'admin'},members:[]}),Response.json({error:'expired'},{status:401})]){
  let resolve;const pending=new Promise(done=>resolve=done),h=account({read:()=>pending});h.render();
  assert.equal(h.requests[0].signal.aborted,false);h.close();assert.equal(h.requests[0].signal.aborted,true);
  resolve(response);await settle();assert.equal(h.writes(),0);assert.deepEqual(h.redirects,[]);
 }
});
