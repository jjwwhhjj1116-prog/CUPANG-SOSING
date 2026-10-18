import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {translationLabelReuseFixture,companies} from './helpers/translation-label-reuse.mjs';

const native=createRequire(import.meta.url),copy=value=>JSON.parse(JSON.stringify(value));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
const settle=async()=>{for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const traces=[],files=['app/components/translation-label-reuse-panel.tsx','app/translation-label-reuse-client.ts','app/components/translation-panel.tsx','app/components/dashboard-client.tsx'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')])),frozen=hashes();
test.after(()=>{assert.deepEqual(hashes(),frozen);fs.writeFileSync(new URL('../outputs/step709-label-reuse-ui-proof.json',import.meta.url),JSON.stringify({sourceHashes:frozen,traces,boundary:'Actual client/component hooks and response validation, synthetic HTTP views and identities. Actual intake/SQLite/source guards are separate backend tests. No model/Google/browser/real product/Hub request.'},null,2)+'\n');});

function harness(company='A01464742',real=null){
 const slots=[],cache=new Map(),effects=[],calls=[],busyChanges=[];let cursor=0,closed=false,late=0,saved=0,mode='normal',wait=null;
 const effect=(fn,deps)=>{const i=cursor++,old=slots[i];if(!old||deps.some((dep,index)=>!Object.is(dep,old.deps[index]))){const next={deps,cleanup:old?.cleanup};slots[i]=next;effects.push(()=>{old?.cleanup?.();next.cleanup=fn();});}};
 const react={useState(initial){const i=cursor++;if(!Object.hasOwn(slots,i))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{if(closed)late++;slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect:effect,useLayoutEffect:effect};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,TextEncoder,structuredClone,fetch:fetcher,require(name){if(name==='react')return react;if(name.startsWith('@/')){const path=name.slice(2);return load(path+(fs.existsSync(new URL('../'+path+'.ts',import.meta.url))?'.ts':'.tsx'));}return native(name);}});return exports;}
 const definitions=load('app/product-content.ts').labelFields;
 let view={format:'translation-label-reuse-v1',productId:'product-'+company,jobId:company==='A01464742'?'11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222',productVersion:'2026-10-18T01:00:00.100Z',contentRevision:3,inputFingerprint:'a'.repeat(64),categoryId:'80719',categoryPath:['생활용품','실상품 분류'],sourceReference:'수집 요청 synthetic-'+company+' / 저장된 원문',
  attributes:[{sourceIndex:0,sourceName:'材质',sourceValue:'棉',name:'재질',value:'면'},{sourceIndex:1,sourceName:'用途',sourceValue:'运动',name:'용도',value:'운동용'}],
  fields:Object.entries(definitions).map(([field,label])=>({field,label,before:field==='material'?'棉':field==='manufacturer'?'직접 저장한 제조사':'',eligible:!['manufacturer','contact'].includes(field),reason:field==='manufacturer'?'제품 라벨에서 직접 저장한 공통 값·공란을 유지합니다.':field==='contact'?'직접 저장한 공통 값·공란을 유지합니다.':null})),suggestions:[{sourceIndex:0,field:'material'}],skipped:[]};
 if(real)view=copy(real.initial);
 const original=copy(view);
 async function fetcher(url,init={}){
  assert.match(url,/\/translation-labels\?jobId=/);calls.push({url,method:init.method??'GET',body:init.body?JSON.parse(init.body):null,signal:init.signal});
  if(wait)await wait;
  if(real){const response=await real.route(url,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})});if(init.method==='POST'&&response.ok)view=(await response.clone().json()).view;return response;}
  if(!init.method){if(mode==='get-error')return Response.json({error:'현재 원문 조회 실패'},{status:503});const next=copy(view);if(mode==='foreign')next.productId='other';if(mode==='old-clock')next.productVersion='2026-10-18T01:00:00.099Z';if(mode==='malformed')next.attributes[0].sourceIndex=99;return Response.json(next);}
  const body=JSON.parse(init.body);assert.equal(body.expectedProductVersion,view.productVersion);assert.equal(body.expectedContentRevision,view.contentRevision);assert.equal(body.expectedInputFingerprint,view.inputFingerprint);
  if(mode==='not-saved')return Response.json({error:'저장 전 일시적인 서버 오류'},{status:503});
  if(mode==='conflict')return Response.json({error:'수집 원문이 바뀌었습니다.'},{status:409});
  const next=copy(view);for(const mapping of body.mappings){const target=next.fields.find(field=>field.field===mapping.field),attribute=next.attributes.find(item=>item.sourceIndex===mapping.sourceIndex);assert.ok(target.eligible);target.before=attribute.value;}
  next.productVersion='2026-10-18T01:00:00.101Z';next.contentRevision++;next.inputFingerprint='b'.repeat(64);view=next;
  if(mode==='ack-loss')throw Error('저장 응답 유실');
  if(mode==='wrong-ack')next.fields.find(field=>field.field==='productName').before='요청하지 않은 제목';
  return Response.json({view:next,applied:body.mappings.length});
 }
 const component=load('app/components/translation-label-reuse-panel.tsx').TranslationLabelReusePanel;
 const base={productId:view.productId,jobId:view.jobId,version:view.productVersion,profileId:real?.profileId,onSaved(){saved++;},onBusyChange(value){busyChanges.push(value);}};
 let props={...base};
 const render=patch=>{props={...props,...patch};cursor=0;const wrapper=component(props),tree=wrapper.type(wrapper.props);while(effects.length)effects.shift()();return tree;};
 const button=name=>nodes(render()).find(node=>node.type==='button'&&text(node)===name);
 const select=index=>nodes(render()).filter(node=>node.type==='select')[index];
 return{load,render,button,select,calls,busyChanges,original,setMode(value){mode=value;},setWait(value){wait=value;},get saved(){return saved;},get late(){return late;},get view(){return copy(view);},close(){closed=true;for(const slot of slots)slot?.cleanup?.();},async read(){button('저장된 상품 속성 번역 불러오기').props.onClick();await settle();return render();}};
}

test('both company label panels reuse reviewed stored attributes without another translation or SEO request',async()=>{
 for(const company of ['A01464742','A01526306']){const h=harness(company);try{
  assert.equal(h.calls.length,0);const before=await h.read();assert.match(text(before),/원문: 材质 · 棉/);assert.equal(h.calls.length,1);assert.equal(h.saved,0);
  assert.equal(h.select(0).props.value,'material');h.select(1).props.onChange({target:{value:'usageStandard'}});const oldSave=h.button('검토한 번역값 표시사항에 저장');assert.equal(oldSave.props.disabled,false);
  oldSave.props.onClick();await settle();assert.equal(h.saved,1);assert.equal(h.calls.length,2);assert.equal(h.calls[1].method,'POST');assert.deepEqual(h.calls[1].body.mappings,[{sourceIndex:0,field:'material'},{sourceIndex:1,field:'usageStandard'}]);
  assert.equal(h.view.fields.find(field=>field.field==='material').before,'면');assert.equal(h.view.fields.find(field=>field.field==='usageStandard').before,'운동용');assert.deepEqual(h.view.attributes,h.original.attributes);
  for(const field of h.original.fields.filter(field=>!['material','usageStandard'].includes(field.field)))assert.equal(h.view.fields.find(next=>next.field===field.field).before,field.before);
  oldSave.props.onClick();await settle();assert.equal(h.calls.length,2,'old callback cannot resubmit a completed write');assert.equal(h.busyChanges.at(-1),false);
  traces.push({kind:'company-stored-label-review',company,requests:h.calls.map(call=>call.method),labelChanges:2,translationCalls:0,seoWrites:0,preservedOtherFields:true});
 }finally{h.close();}}
});

test('manual common label values and explicit blanks cannot be replaced even by a forged select callback',async()=>{
 const h=harness();try{await h.read();const options=nodes(h.select(0)).filter(node=>node.type==='option');for(const field of ['manufacturer','contact'])assert.equal(options.find(node=>node.props.value===field).props.disabled,true);
  h.select(0).props.onChange({target:{value:'contact'}});assert.equal(h.button('검토한 번역값 표시사항에 저장').props.disabled,true);h.button('검토한 번역값 표시사항에 저장').props.onClick();await settle();assert.equal(h.calls.length,1);assert.equal(h.saved,0);
 }finally{h.close();}
});

test('two translated attributes cannot silently target the same label',async()=>{
 const h=harness();try{await h.read();h.select(1).props.onChange({target:{value:'material'}});assert.match(text(h.render()),/중복 없이/);assert.equal(h.button('검토한 번역값 표시사항에 저장').props.disabled,true);assert.equal(h.calls.length,1);}finally{h.close();}
});

test('failed source lookup can be explicitly retried without a write or new translation',async()=>{
 const h=harness();try{h.setMode('get-error');await h.read();assert.match(text(h.render()),/현재 원문 조회 실패/);h.setMode('normal');await h.read();assert.equal(h.select(0).props.value,'material');assert.deepEqual(h.calls.map(call=>call.method),['GET','GET']);}finally{h.close();}
});

test('foreign product, stale clock and malformed source index never expose writable mappings',async()=>{
 for(const mode of ['foreign','old-clock','malformed']){const h=harness();try{h.setMode(mode);await h.read();assert.equal(nodes(h.render()).filter(node=>node.type==='select').length,0);assert.equal(h.saved,0);assert.equal(h.calls.length,1);}finally{h.close();}}
});

test('lost save response requires latest product lookup and old callbacks cannot repeat the write',async()=>{
 const h=harness();try{await h.read();h.setMode('ack-loss');const oldSave=h.button('검토한 번역값 표시사항에 저장');oldSave.props.onClick();await settle();assert.match(text(h.render()),/저장 결과를 확인하기 전/);assert.equal(h.saved,0);assert.equal(h.view.contentRevision,4);
  oldSave.props.onClick();await settle();assert.equal(h.calls.length,2);h.button('최신 상품·표시사항 저장 결과 다시 조회').props.onClick();await settle();assert.equal(h.saved,1);assert.equal(h.calls.length,3);assert.equal(h.calls.at(-1).method,'GET');
  traces.push({kind:'lost-save-ack',postCalls:1,automaticRetry:false,explicitLatestLookup:true});
 }finally{h.close();}
});

test('a save that failed before commit recovers at the same version and allows only a new explicit reviewed save',async()=>{
 const h=harness();try{await h.read();h.setMode('not-saved');h.button('검토한 번역값 표시사항에 저장').props.onClick();await settle();assert.deepEqual(h.view,h.original);assert.equal(h.saved,0);
  const recover=h.button('최신 상품·표시사항 저장 결과 다시 조회');recover.props.onClick();await settle();assert.match(text(h.render()),/현재 저장본에 변경이 없습니다/);assert.equal(h.saved,0);assert.deepEqual(h.calls.map(call=>call.method),['GET','POST','GET']);
  assert.equal(h.button('검토한 번역값 표시사항에 저장').props.disabled,false);h.setMode('normal');h.button('검토한 번역값 표시사항에 저장').props.onClick();await settle();assert.equal(h.saved,1);assert.deepEqual(h.calls.map(call=>call.method),['GET','POST','GET','POST']);
  traces.push({kind:'same-version-uncommitted-recovery',automaticRetry:false,sourceReread:true,explicitSaveAfterReview:true});
 }finally{h.close();}
});

test('invalid save acknowledgement is not accepted as completion',async()=>{
 const h=harness();try{await h.read();h.setMode('wrong-ack');h.button('검토한 번역값 표시사항에 저장').props.onClick();await settle();assert.match(text(h.render()),/요청한 변경과 일치하지/);assert.equal(h.saved,0);assert.equal(h.button('검토한 번역값 표시사항에 저장').props.disabled,true);}finally{h.close();}
});

test('busy, disabled, and closed panels reject old callbacks and late results',async()=>{
 const h=harness();try{await h.read();const oldSave=h.button('검토한 번역값 표시사항에 저장'),wait=deferred();h.setWait(wait.promise);oldSave.props.onClick();oldSave.props.onClick();assert.equal(h.calls.length,2);h.close();assert.equal(h.calls.at(-1).signal.aborted,true);wait.resolve();await settle();assert.equal(h.saved,0);assert.equal(h.late,0);assert.equal(h.busyChanges.at(-1),false);
 }finally{h.close();}
 const blocked=harness();try{await blocked.read();const oldSave=blocked.button('검토한 번역값 표시사항에 저장');blocked.render({disabled:true});oldSave.props.onClick();await settle();assert.equal(blocked.calls.length,1);assert.equal(blocked.saved,0);}finally{blocked.close();}
});

test('a server source conflict preserves the draft and permits lookup rather than automatic resubmission',async()=>{
 const h=harness();try{await h.read();h.setMode('conflict');h.button('검토한 번역값 표시사항에 저장').props.onClick();await settle();assert.match(text(h.render()),/수집 원문이 바뀌었습니다/);assert.equal(h.saved,0);assert.equal(h.calls.length,2);assert.equal(h.button('저장된 번역·현재 표시사항 다시 조회').props.disabled,false);assert.deepEqual(h.view,h.original);}finally{h.close();}
});

test('actual intake API and SQLite feed both company panels and preserve saved sources through label plan generation',async()=>{
 for(const company of companies){const f=await translationLabelReuseFixture(company);let h;try{
  const initial=await f.read(),providerCalls=f.aiCalls,original=f.originalSnapshot();h=harness(company.code,{initial,route:f.route,profileId:f.target.id});await h.read();
  const index=initial.attributes.findIndex(item=>item.sourceName==='用途');assert.ok(index>=0);h.select(index).props.onChange({target:{value:'usageStandard'}});
  const before=f.h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(f.id).payload;
  const save=h.button('검토한 번역값 표시사항에 저장');assert.equal(save.props.disabled,false);save.props.onClick();await settle();
  assert.ok(h.calls.every(call=>new URL(call.url,'https://local.invalid').searchParams.get('profileId')===f.target.id));assert.equal(h.saved,1);assert.notEqual(f.h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(f.id).payload,before);assert.equal(f.aiCalls,providerCalls);assert.equal(f.originalSnapshot(),original);assert.deepEqual(f.h.network,[]);
  const labels=await(await f.h.route(f.base+'/product-labels?profileId='+f.target.id)).json();const common=labels.rows.find(row=>row.optionId===null);assert.equal(common.values.usageStandard,'운동용');
  const plan=f.h.load('app/product-label.ts').productLabelPlan(labels,null);assert.ok(plan.rows.some(row=>row[0]==='사용 기준'&&row[1]==='운동용'));
  traces.push({kind:'actual-intake-panel-label-plan',company:company.code,historicalVersion:f.job.productVersion,currentVersion:initial.productVersion,uiRequests:h.calls.map(call=>call.method),providerCallsDuringReuse:0,unrelatedProductPreserved:true,labelUsageStandard:common.values.usageStandard,externalRequests:0});
 }finally{h?.close();f.close();}}
});
