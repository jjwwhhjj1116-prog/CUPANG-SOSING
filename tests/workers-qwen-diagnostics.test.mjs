import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const source=fs.readFileSync(new URL('../app/automation/workers-qwen-contract.ts',import.meta.url),'utf8'),exports={};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const {parseWorkersQwenJson,WORKERS_QWEN_MODEL}=exports;
const draft={title:'검토 브랜드 우드 패턴 다리 선글라스',keywords:[],description:'',attributes:[],warnings:[]};
const envelope=content=>({object:'chat.completion',model:WORKERS_QWEN_MODEL,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content}}]});
const good=()=>envelope(JSON.stringify(draft));

test('documented no_think empty prefix is accepted once without extracting reasoning or repairing JSON',()=>{
 for(const prefix of ['<think></think>','<think>\n\n</think>\n\n',' \n<think>\t \r\n</think>\n']){
  const result=parseWorkersQwenJson(envelope(prefix+JSON.stringify(draft)));assert.deepEqual(JSON.parse(JSON.stringify(result.value)),draft);
  assert.equal(JSON.stringify(result).includes('think'),false);
 }
 for(const content of ['<think>private reasoning</think>'+JSON.stringify(draft),'<think>\n</think><think></think>'+JSON.stringify(draft),'<think></think>```json\n'+JSON.stringify(draft)+'\n```','<think></think>{"title":'])assert.throws(()=>parseWorkersQwenJson(envelope(content)));
});
test('chat choices stay authoritative when JSON mode returns an absent, undefined or exactly equal supplemental object',()=>{
 const nested={...draft,attributes:[{name:'재질',value:'스펀지'}],extra:{empty:null,enabled:true,list:[1,'둘',false]}},reordered={extra:{list:[1,'둘',false],enabled:true,empty:null},warnings:[],attributes:[{value:'스펀지',name:'재질'}],description:'',keywords:[],title:draft.title};
 for(const supplemental of [undefined,reordered]){const payload=envelope(JSON.stringify(nested));payload.response=supplemental;assert.deepEqual(JSON.parse(JSON.stringify(parseWorkersQwenJson(payload).value)),nested);}
 const only=good();assert.deepEqual(JSON.parse(JSON.stringify(parseWorkersQwenJson(only).value)),draft);
 const emptyThink={...envelope('<think>\n</think>\n'+JSON.stringify(draft)),response:{...draft}};assert.deepEqual(JSON.parse(JSON.stringify(parseWorkersQwenJson(emptyThink).value)),draft);
});
test('a supplemental response cannot change, repair, extract or replace any choice JSON',()=>{
 for(const supplemental of [null,'',JSON.stringify(draft),[],5,false,new Date(),Object.assign(new (class Supplemental {})(),draft)]){
  assert.throws(()=>parseWorkersQwenJson({...good(),response:supplemental}),error=>error.reason==='SUPPLEMENTAL_RESPONSE');
 }
 for(const supplemental of [{...draft,title:'PRIVATE_DIFFERENT_TITLE'},{...draft,extra:1},{...draft,keywords:['둘','하나']}])assert.throws(()=>parseWorkersQwenJson({...good(),response:supplemental}),error=>error.reason==='RESPONSE_MISMATCH');
 const order=envelope(JSON.stringify({...draft,keywords:['하나','둘']}));order.response={...draft,keywords:['둘','하나']};assert.throws(()=>parseWorkersQwenJson(order),error=>error.reason==='RESPONSE_MISMATCH');
 for(const content of ['<think>PRIVATE_REASONING</think>'+JSON.stringify(draft),'```json\n'+JSON.stringify(draft)+'\n```','{"title":',JSON.stringify([draft])])assert.throws(()=>parseWorkersQwenJson({...envelope(content),response:draft}));
 for(const object of ['text_completion','chat.completion.chunk','PRIVATE_DISCRIMINATOR',null])assert.throws(()=>parseWorkersQwenJson({...good(),object,response:draft}),error=>error.reason==='COMPLETION_TYPE');
 const truncated={...good(),response:draft};truncated.choices[0].finish_reason='length';assert.throws(()=>parseWorkersQwenJson(truncated),error=>error.reason==='OUTPUT_TRUNCATED');
});

const scenarios=[
 ['ENVELOPE',()=>null],
 ['RESPONSE_SIZE',()=>({...good(),unused:'x'.repeat(512*1024)})],
 ['COMPLETION_TYPE',()=>({response:{private:'PRIVATE_RAW_SOURCE'}})],
 ['MODEL',()=>({...good(),model:'PRIVATE_MODEL_NAME'})],
 ['CHOICES',()=>({...good(),choices:[]})],
 ['CHOICE',()=>({...good(),choices:[{index:7,message:{role:'assistant',content:'PRIVATE_RAW_SOURCE'}}]})],
 ['OUTPUT_TRUNCATED',()=>{const value=good();value.choices[0].finish_reason='length';return value;}],
 ['FINISH_REASON',()=>{const value=good();value.choices[0].finish_reason='PRIVATE_FINISH';return value;}],
 ['MESSAGE',()=>envelope(null)],
 ['CONTENT_SIZE',()=>envelope('x'.repeat(256*1024+1))],
 ['TOOL_OR_REFUSAL',()=>{const value=good();value.choices[0].message.refusal='PRIVATE_REFUSAL';return value;}],
 ['REASONING_PREFIX',()=>envelope('<think>PRIVATE_REASONING</think>{"private":"PRIVATE_RAW_SOURCE"}')],
 ['CODE_FENCE',()=>envelope('```json\n{"private":"PRIVATE_RAW_SOURCE"}\n```')],
 ['JSON_SYNTAX',()=>envelope('{"private":"PRIVATE_RAW_SOURCE"')],
 ['JSON_OBJECT',()=>envelope('[]')],
 ['SUPPLEMENTAL_RESPONSE',()=>({...good(),response:'PRIVATE_RAW_SOURCE'})],
 ['RESPONSE_MISMATCH',()=>({...good(),response:{private:'PRIVATE_RAW_SOURCE'}})],
];
for(const [reason,make] of scenarios)test(`Qwen diagnostic ${reason} exposes bounded classifications only`,()=>{
 assert.throws(()=>parseWorkersQwenJson(make()),error=>{
  assert.equal(error.reason,reason);const diagnostic=JSON.parse(JSON.stringify(error.diagnostic));
  assert.deepEqual(Object.keys(diagnostic).sort(),['contentLength','contentType','finish','model','objectKind','responseKind']);
  assert.ok(['stop','length','other','missing'].includes(diagnostic.finish));assert.ok(['string','null','other','missing'].includes(diagnostic.contentType));
  assert.ok(['qwen','llama','other','missing'].includes(diagnostic.model));assert.ok(diagnostic.contentLength===null||Number.isSafeInteger(diagnostic.contentLength)&&diagnostic.contentLength>=0&&diagnostic.contentLength<=512*1024+1);
  assert.ok(['chat','text','other','missing'].includes(diagnostic.objectKind));assert.ok(['missing','undefined','null','string','object','array','other'].includes(diagnostic.responseKind));
  assert.equal(JSON.stringify({message:error.message,diagnostic}).includes('PRIVATE_'),false);return true;
 });
});

const json=async(response,status=200)=>{const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));return body;};
async function fixture(make){
 const h=mobileIntakeHarness({translationFetcher:async()=>new Response('synthetic rate limit',{status:429})});
 try{
  h.bindings.SOURCEFLOW_TEXT_PROVIDER='google-free';h.bindings.SOURCEFLOW_QUOTATION_AI_PROVIDER='workers-ai';h.bindings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY='true';
  let calls=0;h.bindings.AI.run=async model=>{assert.equal(model,WORKERS_QWEN_MODEL);calls++;return make();};
  await json(await h.route('/api/collection-jobs/job/collect',{method:'POST'}));const {productId:id}=await json(await h.route('/api/collection-jobs/job/product',{method:'POST'}));
  const post=body=>h.route('/api/products/'+id+'/translation',{method:'POST',body});
  const {job}=await json(await post({action:'prepare-collected',intake:true}),201);
  await json(await post({action:'approve',jobId:job.id,reviewFingerprint:job.review.fingerprint,confirmPaid:true}));
  const failed=(await json(await post({action:'execute',jobId:job.id}))).job;assert.equal(failed.status,'failed');
  const version=h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(id).updated_at;
  const {job:recovery}=await json(await post({action:'prepare-collected-workers',expectedVersion:version,idempotencyKey:crypto.randomUUID(),failedJobId:failed.id}),201);
  await json(await post({action:'approve',jobId:recovery.id,reviewFingerprint:recovery.review.fingerprint,confirmPaid:true}));
  const state=()=>JSON.stringify(['products','product_content','product_options','collection_context','collection_results'].map(table=>h.sqlite.prepare('SELECT * FROM '+table).all()));
  return{h,post,recovery,state,calls:()=>calls};
 }catch(error){h.close();throw error;}
}

for(const reason of ['MODEL','OUTPUT_TRUNCATED','MESSAGE','REASONING_PREFIX','JSON_SYNTAX'])test(`actual saved Qwen ${reason} failure retains a safe diagnosis and cannot automatically repeat`,async()=>{
 const f=await fixture(scenarios.find(item=>item[0]===reason)[1]);try{
  const before=f.state(),result=(await json(await f.post({action:'execute',jobId:f.recovery.id}))).job;
  assert.equal(result.status,'failed');assert.equal(result.result,null);assert.equal(result.error.code,'INVALID_MODEL_OUTPUT_QWEN_'+reason);assert.equal(f.calls(),1);
  assert.match(result.error.message,/완료 (?:stop|length|other|missing) · 본문 (?:string|null|other|missing)\/\d+자 · 모델 (?:qwen|llama|other|missing)/);
  assert.equal(JSON.stringify(result.error).includes('PRIVATE_'),false);assert.equal(f.state(),before);
  const stored=JSON.parse(f.h.sqlite.prepare('SELECT error FROM translation_jobs WHERE id=?').get(f.recovery.id).error);assert.deepEqual(stored,result.error);
  await json(await f.post({action:'execute',jobId:f.recovery.id}));assert.equal(f.calls(),1);assert.equal(f.h.bindings.SOURCEFLOW_TEXT_PROVIDER,'google-free');
 }finally{f.h.close();}
});

test('the actual Qwen route accepts a documented empty think prefix with one call and no automatic application',async()=>{
 const f=await fixture(()=>envelope('<think>\n\n</think>\n\n'+JSON.stringify(draft)));try{
  const before=f.state(),result=(await json(await f.post({action:'execute',jobId:f.recovery.id}))).job;
  assert.equal(result.status,'completed');assert.equal(result.result.draft.title,draft.title);assert.equal(f.calls(),1);assert.equal(f.state(),before);
  assert.equal(JSON.stringify(result.result).includes('<think>'),false);assert.equal(result.result.appliedToContent,false);
 }finally{f.h.close();}
});
test('the actual Qwen route accepts an equal dual JSON envelope exactly once without retaining supplemental output',async()=>{
 const f=await fixture(()=>({...envelope(JSON.stringify(draft)),response:{warnings:[],attributes:[],description:'',keywords:[],title:draft.title}}));try{
  const before=f.state(),result=(await json(await f.post({action:'execute',jobId:f.recovery.id}))).job;assert.equal(result.status,'completed');assert.equal(result.result.draft.title,draft.title);assert.equal(f.calls(),1);assert.equal(f.state(),before);assert.equal(Object.hasOwn(result.result,'response'),false);
  await json(await f.post({action:'execute',jobId:f.recovery.id}));assert.equal(f.calls(),1);
 }finally{f.h.close();}
});
