import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
const native=createRequire(import.meta.url),plain=value=>JSON.parse(JSON.stringify(value));
const json=async response=>{assert.equal(response.status<300,true,await response.clone().text());return response.json();};
const product=h=>h.sqlite.prepare('SELECT * FROM products').get();
const content=h=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
const options=h=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const label=t=>Array.isArray(t)?t.map(label).join(''):typeof t==='string'||typeof t==='number'?String(t):'';
const settle=async()=>{for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));};
function panel(h){
 const slots=[],effects=[],cleanup=[];let index=0,first=true;
 const hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=index++;return slots[i]??(slots[i]={current:initial});},useEffect(fn){if(first)effects.push(fn);},useCallback:fn=>fn};
 const exports={},file='app/components/translation-panel.tsx',current=product(h);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,crypto,fetch:(url,init)=>h.route(url,{method:init?.method??'GET',body:init?.body}),require(name){if(name==='react')return hooks;if(name.startsWith('@/app/components/'))return new Proxy({},{get:()=>()=>null});return name.startsWith('@/')?h.load(name.slice(2)+'.ts'):native(name);}});
 const render=()=>{index=0;const wrapper=exports.default({productId:current.id,version:current.updated_at,title:current.title});const tree=wrapper.type(wrapper.props);first=false;return tree;};
 render();effects.forEach(fn=>cleanup.push(fn()));
 return {render,click(text){const node=nodes(render()).find(node=>node.type==='button'&&label(node.props.children)===text);assert.ok(node,text);assert.equal(node.props.disabled,false);return node.props.onClick();},close(){cleanup.forEach(fn=>fn?.());}};
}
async function legacyCopy(h,keepKorean=false){
 h.sqlite.exec("UPDATE collection_jobs SET goal='collect'");await h.intake();const base='/api/products/'+product(h).id;
 const request=body=>h.route(base+'/translation',{method:'POST',body}),prepared=await json(await request({action:'prepare-collected',intake:true}));
 const review={...prepared.job.review,instructionsVersion:'sourceflow-translation-v5'};delete review.fingerprint;review.fingerprint=await h.load('app/automation/model.ts').fingerprint(review);
 h.sqlite.prepare('UPDATE translation_jobs SET review=?,review_fingerprint=? WHERE id=?').run(JSON.stringify(review),review.fingerprint,prepared.job.id);
 const original=h.bindings.AI.run;
 h.bindings.AI.run=async(_model,input)=>{const source=JSON.parse(input.messages[1].content),attributes=source.attributes.map(({sourceIndex,name,value})=>({sourceIndex,name,value}));if(keepKorean)attributes.find(pair=>pair.name.startsWith('option:')).value='기존 한국어 옵션';return {response:{title:source.title,description:'',keywords:[],warnings:[],attributes}};};
 await json(await request({action:'approve',jobId:prepared.job.id,reviewFingerprint:review.fingerprint,confirmPaid:true}));
 const {job}=await json(await request({action:'execute',jobId:prepared.job.id}));assert.equal(job.status,'completed');
 const apply=async(action,fingerprint)=>json(await h.route(base+'/translation-apply',{method:'POST',body:{action,jobId:job.id,expectedVersion:product(h).updated_at,...(fingerprint?{fingerprint}:{})}}));
 const preview=await apply('preview');await apply('apply',preview.fingerprint);h.bindings.AI.run=original;
 return {base,job,request};
}

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`explicit source reload recovers copied v5 option translations through the real panel and API (${company.companyCode})`,async()=>{
 const h=mobileIntakeHarness(company);let ui;try{
  const {base,job,request}=await legacyCopy(h),before=options(h),receipt=h.sqlite.prepare('SELECT payload FROM collection_results').get().payload,legacy=h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(job.id),policy=product(h).pricing_policy;
  assert.equal(h.load('app/option-translation.ts').optionTranslationBatch(before).total,0);
  ui=panel(h);await settle();const area=()=>nodes(ui.render()).find(node=>node.type==='textarea'&&node.props.rows===3);
  assert.equal(area().props.value,'');const version=product(h).updated_at;
  await ui.click('미번역 옵션 불러오기 · 속성 입력 교체');await settle();
  assert.equal(area().props.value.split('\n').filter(Boolean).length,18);assert.equal(product(h).updated_at,version);assert.deepEqual(options(h),before);
  await ui.click('번역 요청 검토하기 · 무료');await settle();
  const next=(await json(await h.route(base+'/translation'))).jobs.find(value=>value.id!==job.id);assert.ok(next);assert.equal(next.review.source.attributes.length,42);
  await json(await request({action:'approve',jobId:next.id,reviewFingerprint:next.review.fingerprint,confirmPaid:true}));const executed=await json(await request({action:'execute',jobId:next.id}));assert.equal(executed.job.status,'completed');
  const send=(action,fingerprint)=>h.route(base+'/translation-apply',{method:'POST',body:{action,scope:'options',jobId:next.id,expectedVersion:version,...(fingerprint?{fingerprint}:{})}});
  const preview=await json(await send('preview'));assert.equal(preview.preview.length,18);await json(await send('apply',preview.fingerprint));
  const after=options(h);assert.ok(after.rows.every(row=>/[가-힣]/u.test(row.translatedName)&&/[가-힣]/u.test(row.color)&&/[가-힣]/u.test(row.size)));
  for(const [index,row]of after.rows.entries())for(const key of ['id','originalName','supplierSku','unitCostCny','unitsPerPack','minimumOrderQuantity','stock','imageKey'])assert.equal(row[key],before.rows[index][key]);
  assert.equal(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload,receipt);assert.deepEqual(h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(job.id),legacy);assert.equal(product(h).pricing_policy,policy);
  assert.equal((await send('apply',preview.fingerprint)).status,409);
 }finally{ui?.close();h.close();}
});

test('copy recovery preserves real manual option edits, blanks, excluded rows and rejects a stale apply',async()=>{
 const h=mobileIntakeHarness();try{
  const {base,job,request}=await legacyCopy(h),initial=options(h),model=h.load('app/option-translation.ts'),rows=h.load('app/product-options.ts').optionInputs(initial);
  rows[0].translatedName='직접 확인한 한국어';rows[0].color='';rows[0].size='직접 사이즈';rows[1].included=false;rows[2].originalName='직접 확인한 옵션 원문';rows[3].size='직접 사이즈';rows[4].translatedName='手动中文';
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:initial.revision,expectedProductVersion:product(h).updated_at,rows}}));
  const current=options(h),before=plain(current),batch=model.optionTranslationBatch(current,50,[job]);assert.equal(batch.total,7);assert.equal(model.optionTranslationBatch(current).total,0);
  for(const index of [0,1,2])assert.ok(batch.attributes.every(pair=>!pair.name.endsWith(':'+rows[index].id)));
  assert.ok(batch.attributes.every(pair=>pair.name!==`option-size:${rows[3].id}`&&pair.name!==`option:${rows[4].id}`));
  assert.equal(model.optionTranslationBatch(current,50,[{...job,productId:'other'}]).total,0);
  const changedEvidence=plain(job);for(const pair of changedEvidence.result.draft.attributes)pair.value='다른 번역';assert.equal(model.optionTranslationBatch(current,50,[changedEvidence]).total,0);
  const prepared=await json(await request({action:'prepare',expectedVersion:product(h).updated_at,idempotencyKey:crypto.randomUUID(),source:{...job.review.source,attributes:plain(batch.attributes)}}));
  await json(await request({action:'approve',jobId:prepared.job.id,reviewFingerprint:prepared.job.review.fingerprint,confirmPaid:true}));const executed=await json(await request({action:'execute',jobId:prepared.job.id}));assert.equal(executed.job.status,'completed');
  const version=product(h).updated_at,send=(action,fingerprint)=>h.route(base+'/translation-apply',{method:'POST',body:{action,scope:'options',jobId:prepared.job.id,expectedVersion:version,...(fingerprint?{fingerprint}:{})}});
  const preview=await json(await send('preview'));assert.equal(preview.preview.length,7);assert.deepEqual(options(h),before);
  const changedRows=h.load('app/product-options.ts').optionInputs(current);changedRows[5].color='늦게 직접 수정한 색상';await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:current.revision,expectedProductVersion:version,rows:changedRows}}));
  const saved=options(h);assert.equal((await send('apply',preview.fingerprint)).status,409);assert.deepEqual(options(h),saved);
  assert.equal(saved.rows[0].color,'');assert.equal(saved.rows[1].included,false);assert.equal(saved.rows[4].translatedName,'手动中文');assert.equal(content(h).seo.title.value,job.result.draft.title.startsWith('검토 브랜드')?job.result.draft.title:'검토 브랜드 '+job.result.draft.title);
 }finally{h.close();}
});

test('genuine translated Korean stays excluded and a copied recovery value remains pending in a partial v6 draft',async()=>{
 const h=mobileIntakeHarness();try{
  const {base,job,request}=await legacyCopy(h,true),current=options(h),model=h.load('app/option-translation.ts');assert.equal(current.rows[0].provenance.translatedName,'translated');
  const batch=model.optionTranslationBatch(current,50,[job]);assert.equal(batch.total,17);assert.ok(batch.attributes.every(pair=>pair.name!==`option:${current.rows[0].id}`));
  const prepared=await json(await request({action:'prepare',expectedVersion:product(h).updated_at,idempotencyKey:crypto.randomUUID(),source:{...job.review.source,attributes:plain(batch.attributes)}}));
  const original=h.bindings.AI.run;h.bindings.AI.run=async(...args)=>{const response=await original(...args);response.response.attributes[0].value=prepared.job.review.source.attributes[0].value;return response;};
  await json(await request({action:'approve',jobId:prepared.job.id,reviewFingerprint:prepared.job.review.fingerprint,confirmPaid:true}));const executed=await json(await request({action:'execute',jobId:prepared.job.id}));assert.equal(executed.job.status,'completed');
  assert.equal(executed.job.result.draft.attributes.length,16);assert.ok(executed.job.result.draft.attributes.every(item=>item.sourceIndex!==0));assert.match(executed.job.result.draft.warnings.join(' '),/17개 중 16개.*누락 1개/);
  const version=product(h).updated_at,response=await h.route(base+'/translation-apply',{method:'POST',body:{action:'preview',scope:'options',jobId:prepared.job.id,expectedVersion:version}}),preview=await json(response);assert.equal(preview.preview.length,16);assert.deepEqual(options(h),current);
  await json(await h.route(base+'/translation-apply',{method:'POST',body:{action:'apply',scope:'options',jobId:prepared.job.id,expectedVersion:version,fingerprint:preview.fingerprint}}));
  assert.equal(options(h).rows[0].translatedName,'기존 한국어 옵션');assert.equal(model.optionTranslationBatch(options(h),50,[job]).total,1);assert.equal(model.optionTranslationBatch(options(h),50,[job]).attributes[0].name,batch.attributes[0].name);
 }finally{h.close();}
});
