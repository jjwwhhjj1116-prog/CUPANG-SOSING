import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const text=t=>Array.isArray(t)?t.map(text).join(''):t&&typeof t==='object'?text(t.props?.children):t==null?'':String(t);
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const prepare='이미지 요청 검토하기 · 무료',refresh='저장된 설정·실행 이력 새로고침 · 무료';
const execute='승인한 이미지 1장 가공 · 비용 발생',attach='생성된 결과를 현재 상품에 추가 · 무료';
const roles='검토한 결과를 원본의 대표·추가·상세 위치에 적용',options='검토한 결과를 같은 원본의 옵션 대표 이미지에 적용';

/** Actual image panel and role/option adoption functions; only HTTP responses
 * are controlled. No provider call, remote browser, storage or live product. */
function harness(handler,{status='completed',attached=true,initialPending=null}={}){
 const slots=[],effects=[],calls=[],initialCalls=[],cache=new Map();let index=0,closed=false,late=0,changed=0;
 let props={productId:'p',version:'v',imageKeys:['owner/raw','owner/edited','owner/label'],onProductChanged(){changed++;}};
 const job={id:'image-job',productId:'p',productVersion:'v',contentRevision:1,status,createdAt:'2026-10-05T00:00:00Z',
  review:{sourceKey:'owner/raw',source:{width:100,height:100,bytes:100,mime:'image/png',sha256:'mock'},model:'mock',size:'1024x1024',quality:'low',purpose:'translate',prompt:'',effectivePrompt:'원문 보존',settingsFingerprint:'settings',recipeVersion:1,expiresAt:'2099-01-01',paidNotice:'시험 요청',pricingUrl:'https://example.invalid'},
  result:status==='completed'?{attached,storageKey:'owner/edited'}:null,error:null};
 const view={configuration:{configured:true,issues:[]},settings:{translateImages:true,removeBackground:false,addCopyright:false,translationPrompt:''},settingsFingerprint:'settings',jobs:[job]};
 const hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{if(closed)late++;slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=index++;return slots[i]??(slots[i]={current:initial});},useEffect(fn,deps){const i=index++,old=slots[i];if(!old||!deps||deps.some((value,j)=>!Object.is(value,old.deps[j]))){const next={deps,cleanup:null};slots[i]=next;effects.push(()=>{old?.cleanup?.();next.cleanup=fn();});}}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
   {exports,Error,AbortController,DOMException,crypto,structuredClone,fetch:request,require(name){if(name==='react')return hooks;if(name.startsWith('@/'))return load(name.slice(2)+'.ts');return native(name);}});return exports;
 }
 const content=load('app/product-content.ts').emptyProductContent('p');content.revision=1;content.assets.main.value=['owner/raw'];content.assets.label.value=['owner/label'];
 const optionRow={...load('app/product-options.ts').emptyOptionInput('one'),originalName:'原文',translatedName:'수동 옵션명',unitCostCny:12,stock:0,imageKey:'owner/raw',included:true};
 const currentOptions={productVersion:'current',options:{productId:'p',revision:4,rows:[optionRow]}};
 let initial=true;
 async function request(url,init){if(initial){initial=false;initialCalls.push({url,init});return initialPending??Response.json(view);}calls.push({url,init});return handler(url,init,{view,job,content,currentOptions});}
 const Panel=load('app/components/image-generation-panel.tsx').default;
 let identity;
 function render(){index=0;let tree=Panel(props);const nextIdentity=typeof tree.type==='function'?tree.key:props.productId;if(identity!==undefined&&identity!==nextIdentity){slots.forEach(slot=>slot?.cleanup?.());slots.length=0;effects.length=0;}identity=nextIdentity;if(typeof tree.type==='function')tree=tree.type(tree.props);effects.splice(0).forEach(fn=>fn());return tree;}
 render();
 return{calls,initialCalls,view,job,content,currentOptions,render,get late(){return late;},get changed(){return changed;},
  click(label){const button=nodes(render()).find(node=>node.type==='button'&&text(node)===label);assert.ok(button&&!button.props.disabled,label);return button.props.onClick;},
  update(next){props={...props,...next};render();},close(){closed=true;slots.forEach(slot=>slot?.cleanup?.());}};
}

test('image requests lock before rerender and a failed request allows explicit retry',async()=>{
 for(const [label,status,attached]of [[prepare,'completed',true],[execute,'approved',true],[attach,'completed',false],[refresh,'completed',true],[roles,'completed',true],[options,'completed',true]]){
  const pending=deferred();let attempt=0;const h=harness(async(_url,_init,data)=>++attempt===1?pending.promise:Response.json(data.view),{status,attached});
  try{await settle();const click=h.click(label),other=h.click(refresh);click();click();other();assert.equal(h.calls.length,1,label);
   pending.resolve(Response.json({error:'시험 일시 오류'},{status:503}));await settle();assert.match(text(h.render()),/시험 일시 오류/);
   h.click(refresh)();await settle();assert.equal(h.calls.length,2,label);assert.equal(h.changed,0);
  }finally{h.close();}
 }
});

test('closing image panel during role or option read prevents the follow-up save',async()=>{
 for(const label of [roles,options]){const pending=deferred();const h=harness(()=>pending.promise);await settle();h.click(label)();h.close();
  pending.resolve(Response.json(label===roles?{content:h.content}:h.currentOptions));await settle();
  assert.equal(h.calls.length,1,label);assert.equal(h.calls.some(call=>call.init?.method==='PATCH'),false);assert.equal(h.changed,0);assert.equal(h.late,0);
 }
});

test('closing during image action, refresh or committed role save ignores late UI changes',async()=>{
 for(const label of [prepare,execute,attach,refresh,roles,options]){const pending=deferred();
  const status=label===execute?'approved':'completed',attached=label!==attach;
  const h=harness(async(_url,init,data)=>[roles,options].includes(label)&&!init?.method?Response.json(label===roles?{content:data.content}:data.currentOptions):pending.promise,{status,attached});
  await settle();h.click(label)();await settle();h.close();
  pending.resolve(Response.json({job:{...h.job,status:'completed',result:{attached:true,storageKey:'owner/edited'}},...h.view,content:h.content,...h.currentOptions}));await settle();
  assert.equal(h.changed,0,label);assert.equal(h.late,0,label);
  assert.ok(h.calls.every(call=>call.init?.signal?.aborted),label);
 }
});

test('initial image history read is cancelled when its panel closes',async()=>{
 const pending=deferred();const h=harness(()=>{throw Error('Unexpected action');},{initialPending:pending.promise});h.close();pending.resolve(Response.json(h.view));await settle();assert.equal(h.late,0);assert.equal(h.changed,0);assert.equal(h.calls.length,0);assert.equal(h.initialCalls[0].init?.signal?.aborted,true);
});

test('failed initial image history can be explicitly reread without a model call',async()=>{
 const h=harness(async(_url,_init,data)=>Response.json(data.view),{initialPending:Promise.resolve(Response.json({error:'초기 이미지 조회 실패'},{status:503}))});
 try{await settle();assert.match(text(h.render()),/초기 이미지 조회 실패/);h.click(refresh)();await settle();assert.equal(h.calls.length,1);assert.equal(h.calls[0].init.cache,'no-store');assert.equal(h.calls[0].init.method,undefined);assert.match(text(h.render()),/생성 결과 검토/);assert.doesNotMatch(text(h.render()),/초기 이미지 조회 실패/);assert.equal(h.changed,0);}
 finally{h.close();}
});

test('reviewed image adoption preserves manual names, prices, stock and label roles',async()=>{
 for(const label of [roles,options]){const h=harness(async(url,init,data)=>Response.json(url.endsWith('/content')?{content:data.content}:data.currentOptions));
  try{await settle();h.click(label)();await settle();assert.equal(h.calls.length,2);assert.equal(h.calls[0].init.cache,'no-store');assert.equal(h.calls[1].init.method,'PATCH');assert.equal(h.changed,1);
   const body=JSON.parse(h.calls[1].init.body);
   if(label===roles){assert.equal(body.expectedRevision,1);assert.deepEqual(body.patch.assets,{main:['owner/edited']});assert.equal(h.content.assets.label.value[0],'owner/label');}
   else{assert.equal(body.expectedRevision,4);assert.equal(body.expectedProductVersion,'current');assert.equal(body.rows[0].imageKey,'owner/edited');assert.equal(body.rows[0].translatedName,'수동 옵션명');assert.equal(body.rows[0].unitCostCny,12);assert.equal(body.rows[0].stock,0);}
  }finally{h.close();}
 }
});

test('same-product version refresh retains image request inputs and aborts the older action',async()=>{
 const pending=deferred();let postCount=0;const h=harness(async(_url,init,data)=>init?.method==='POST'?(++postCount===1?pending.promise:Response.json({job:{...data.job,productVersion:'new-version',status:'prepared',result:null}})):Response.json({...data.view,jobs:[{...data.job,productVersion:'new-version'}]}));
 try{await settle();const tree=h.render();nodes(tree).find(node=>node.type==='textarea'&&node.props.maxLength===4000).props.onChange({target:{value:'직접 작성한 이미지 요청'}});nodes(h.render()).find(node=>node.type==='select'&&node.props.value==='translate').props.onChange({target:{value:'thumbnail'}});
  h.click(prepare)();h.update({version:'new-version'});await settle();
  assert.equal(nodes(h.render()).find(node=>node.type==='textarea'&&node.props.maxLength===4000).props.value,'직접 작성한 이미지 요청');
  assert.ok(nodes(h.render()).some(node=>node.type==='select'&&node.props.value==='thumbnail'));
  assert.equal(h.calls[0].init.signal.aborted,true);assert.equal(h.calls.length,2);assert.equal(h.calls[1].init.method,undefined);
  pending.resolve(Response.json({job:{...h.job,result:{attached:true,storageKey:'owner/edited'}}}));await settle();assert.equal(h.changed,0);assert.equal(h.late,0);
  h.click(prepare)();await settle();const next=JSON.parse(h.calls[2].init.body);assert.equal(next.expectedVersion,'new-version');assert.equal(next.prompt,'직접 작성한 이미지 요청');assert.equal(next.purpose,'thumbnail');assert.equal(h.changed,0);
 }finally{h.close();}
});
