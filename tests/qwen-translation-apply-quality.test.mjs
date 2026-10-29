import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const QWEN='@cf/qwen/qwen3-30b-a3b-fp8',LLAMA='@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const plain=value=>JSON.parse(JSON.stringify(value));
const hash=value=>createHash('sha256').update(value).digest('hex');
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
function businessSnapshot(h){
 const tables=h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);
 return tables.map(table=>{assert.match(table,/^[a-z][a-z0-9_]*$/u);const rows=h.sqlite.prepare('SELECT * FROM '+table).all();return{table,count:rows.length,sha256:hash(JSON.stringify(rows))};});
}

/** Quality checks run against actual local handlers and memory SQLite. Public
 * recorded source/provider fixtures never contact a remote app or AI service. */
test('existing bad completed Qwen title, keywords, indexed option Han or missing option cannot preview or apply, with every business row preserved',async()=>{
 const h=mobileIntakeHarness();try{
  const llama=h.bindings.AI.run;
  h.bindings.AI.run=async(model,input)=>{
   const response=await llama(model,input),source=JSON.parse(input.messages[1].content);
   // The fake provider uses Korean metadata labels as the Qwen schema asks;
   // routing identities and seller values remain bound by sourceIndex.
   for(const attribute of response.response.attributes){const name=source.attributes[attribute.sourceIndex].name,binding=/^option(?:-(color|size))?:/u.exec(name);if(binding)attribute.name=binding[1]==='color'?'색상':binding[1]==='size'?'사이즈':'옵션명';}
   return response;
  };
  h.sqlite.prepare('UPDATE collection_jobs SET goal=? WHERE id=?').run('work','job');
  await json(await h.route('/api/collection-jobs/job/collect',{method:'POST'}));await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get();assert.ok(product);
  const original=h.sqlite.prepare('SELECT * FROM translation_jobs ORDER BY created_at,id').all().find(row=>{
   const review=JSON.parse(row.review);return row.status==='completed'&&review.model===LLAMA&&review.instructionsVersion==='sourceflow-translation-v6'&&!Object.hasOwn(review,'workersRecovery')&&review.source.attributes.some(attribute=>/^option(?:-(?:color|size))?:/u.test(attribute.name));
  });assert.ok(original,'actual Llama intake creates a completed source-indexed option draft');
  const originalReview=JSON.parse(original.review),originalResult=JSON.parse(original.result),sourceIndex=originalReview.source.attributes.findIndex(attribute=>/^option(?:-(?:color|size))?:/u.test(attribute.name));
  const outputIndex=originalResult.draft.attributes.findIndex(attribute=>attribute.sourceIndex===sourceIndex);assert.ok(outputIndex>=0);
  const base='/api/products/'+product.id+'/translation-apply',outboundBefore=[...h.network],aiBefore=h.aiSources.length,bytesBefore=[...h.objects].map(([key,bytes])=>[key,hash(bytes)]);
  assert.ok(aiBefore>0);h.bindings.AI={run:async()=>assert.fail('quality rejection must never request another AI completion')};
  const cases=[
   {name:'title',location:/위치 title\./u,mutate:draft=>{draft.title='선글라스镜';}},
   {name:'keywords[0]',location:/위치 keywords\[0\]\./u,mutate:draft=>{draft.keywords=['선글라스镜'];}},
   {name:'indexed option value',location:new RegExp('위치 attributes\\['+outputIndex+'\\].*sourceIndex '+sourceIndex+'\\.value'),mutate:draft=>{draft.attributes[outputIndex].value='유광 검정黑';}},
   {name:'missing option sourceIndex',location:new RegExp('위치 attributes · sourceIndex '+sourceIndex+'\\.'),mutate:draft=>{draft.attributes=draft.attributes.filter(attribute=>attribute.sourceIndex!==sourceIndex);}},
  ];
  for(const scenario of cases){
   const review=plain(originalReview),result=plain(originalResult);review.model=QWEN;result.model=QWEN;scenario.mutate(result.draft);
   h.sqlite.prepare('UPDATE translation_jobs SET review=?,result=? WHERE id=?').run(JSON.stringify(review),JSON.stringify(result),original.id);
   const before=businessSnapshot(h),badJob=h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(original.id);
   for(const action of ['preview','apply']){
    const body={action,jobId:original.id,expectedVersion:product.updated_at,scope:'all',linkQuotationSeoDefaults:true,...(action==='apply'?{fingerprint:'a'.repeat(64)}:{})};
    const response=await json(await h.route(base,{method:'POST',body}),409);assert.deepEqual(Object.keys(response),['error']);assert.match(response.error,/Qwen 한국어 번역을 확인하지 못했습니다/u,scenario.name);assert.match(response.error,scenario.location,scenario.name);assert.match(response.error,scenario.name==='missing option sourceIndex'?/요청한 번역이 누락/u:/번역되지 않은 중국어/u,scenario.name);
    assert.deepEqual(businessSnapshot(h),before,scenario.name+' '+action+' may not alter any business table');assert.deepEqual(h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(original.id),badJob,'the stored bad job remains available for review');
   }
  }
  assert.deepEqual(h.network,outboundBefore,'preview/apply validation performs no additional provider or supplier HTTP');assert.equal(h.aiSources.length,aiBefore);assert.deepEqual([...h.objects].map(([key,bytes])=>[key,hash(bytes)]),bytesBefore);assert.ok(!h.network.includes('supplier.coupang.com'));
 }finally{h.close();}
});
