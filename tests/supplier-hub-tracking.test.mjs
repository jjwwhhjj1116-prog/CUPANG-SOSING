import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';

const code=ts.transpileModule(fs.readFileSync(new URL('../app/supplier-hub-tracking.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function api(timers={setTimeout,clearTimeout},bridgeWindow){
 const localHistory={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/supplier-hub-local-history.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:localHistory,Error,Date,TextEncoder});
 const handoff={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/supplier-hub-handoff.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:handoff,Error,Date,Set,TextEncoder,crypto:webcrypto,window:bridgeWindow,...timers,
  require(name){assert.equal(name,'@/app/supplier-hub-local-history');return localHistory;}});
 const exports={};vm.runInNewContext(code,{exports,Error,Date,Set,...timers,require(name){return name==='@/app/supplier-hub-handoff'?handoff:{};}});return {...exports,LookupUnavailable:handoff.SupplierHubLookupUnavailable,readHistory:handoff.getSupplierHubProductHistory};
}
const tracking=api();
const source={productId:'p',categoryId:'80719',profileId:'profile',fingerprint:'a'.repeat(64),filename:`YOOFAM-${'a'.repeat(64)}.xlsx`,includedOptions:2,company:{code:'A01464742',name:'와이홉'}};
const row=(skuId,patch={})=>({title:'상품',submittedAt:'date',category:'cat',barcode:'',sourceQuotation:source.filename,skuId,status:'상품 검수중',stage:'가격/정책',...patch});
const record=(state='validation-pending',patch={})=>({state,filename:source.filename,company:source.company,includedOptions:2,quotationId:state==='validation-complete'?'quote-123':undefined,observedAt:Date.now(),registered:false,...patch});
const registered=(rows,patch={})=>record('validation-complete',{registration:{quotationId:'quote-123',scope:'visible-page',includedOptions:2,observedAt:Date.now(),registered:false,rows},...patch});
function historyBridge(records,patch={}){
 const calls=[],listeners=new Set(),origin='http://localhost:3000';
 const win={location:{origin},addEventListener(type,listener){assert.equal(type,'message');listeners.add(listener);},removeEventListener(type,listener){assert.equal(type,'message');listeners.delete(listener);},postMessage(request,target){
  assert.equal(target,origin);assert.equal(request.channel,'YOOFAM_HUB_HANDOFF');calls.push(request);
  assert.ok(['PING','HISTORY'].includes(request.type),'history lookup cannot prepare, transmit or validate a package');
  const result=request.type==='PING'?{ok:true,productTransmissionHistory:true}:{ok:true,productId:source.productId,records:structuredClone(records),...patch};
  queueMicrotask(()=>{for(const listener of [...listeners])listener({source:win,origin,data:{channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId:request.requestId,result}});});
 }};
 return {calls,listeners,win,read:()=>api(undefined,win).readHistory({productId:source.productId,categoryId:source.categoryId,fingerprint:source.fingerprint},new AbortController().signal)};
}
function localRecord(kind,value){return {key:`${kind}:http://localhost:3000:p:${value.categoryId}:${value.fingerprint}`,value};}

test('actual HISTORY exchange validates rejected records and retains older accepted fingerprints for both companies without uploads',async()=>{
 for(const company of [source.company,{code:'A01526306',name:'유앤채'}]){
  const current={origin:'http://localhost:3000',productId:'p',categoryId:source.categoryId,fingerprint:source.fingerprint};
  const rejected={...current,...record('validation-rejected',{company,quotationId:undefined,detail:'합성 파일 오류'})};
  const rows=[localRecord('transmission',{...current,company,state:'started',registered:false}),localRecord('result',rejected)];
  const h=historyBridge(rows),empty=await h.read();assert.equal(empty.blocked,false);assert.equal(empty.records.length,2);
  const old={...current,fingerprint:'b'.repeat(64),...record('validation-complete',{company,filename:`YOOFAM-${'b'.repeat(64)}.xlsx`,quotationId:'old-accepted-quote'})};
  rows.push(localRecord('result',old));const history=await h.read();assert.equal(history.blocked,true);assert.equal(history.records.length,3);
  assert.equal(history.records.find(item=>item.value.fingerprint===old.fingerprint).value.quotationId,'old-accepted-quote');
  assert.deepEqual(h.calls.map(request=>request.type),['PING','HISTORY','PING','HISTORY']);assert.equal(h.listeners.size,0);
  assert.ok(h.calls.filter(request=>request.type==='HISTORY').every(request=>request.payload.productId==='p'&&request.payload.fingerprint===source.fingerprint));
  assert.equal(rows[1].value.state,'validation-rejected');assert.equal(rows[2].value.registered,false);
 }
});

test('actual HISTORY exchange refuses mismatched product/key, false registration claims and oversized history',async()=>{
 const value={origin:'http://localhost:3000',productId:'p',categoryId:source.categoryId,fingerprint:source.fingerprint,...record('validation-complete')};
 const current=localRecord('result',value);
 for(const [rows,patch]of [
  [[current],{productId:'other'}],
  [[{...current,key:current.key.replace(':p:',':other:')}],{}],
  [[{...current,value:{...value,productId:'other'}}],{}],
  [[{...current,value:{...value,registered:true}}],{}],
  [Array.from({length:201},()=>current),{}],
 ]){
  const h=historyBridge(rows,patch);await assert.rejects(h.read());assert.deepEqual(h.calls.map(request=>request.type),['PING','HISTORY']);assert.equal(h.listeners.size,0);
 }
});
function fixture(replies,{prepared=source,verify,read,wait,maxDurationMs=180000,initialResult}={}){
 let index=0,time=0;const calls=[],progress=[],retries=[],controller=new AbortController();
 const options={signal:controller.signal,maxDurationMs,initialResult,now:()=>time,
  verify:async(...args)=>{calls.push(['verify',...args]);await verify?.(...args);},
  read:async(...args)=>{calls.push(['read',...args]);await read?.(...args);return replies[Math.min(index++,replies.length-1)];},
  wait:async(ms,signal)=>{calls.push(['wait',ms]);time+=ms;await wait?.(ms,signal);},
  onProgress:value=>progress.push(value),onRetry:value=>retries.push(value)};
 return {calls,progress,retries,controller,options,run:()=>tracking.followSupplierHubRegistration(prepared,options)};
}

test('lost validation replies recover into fresh SKU results for both companies without changing request identity',async()=>{
 for(const company of [source.company,{code:'A01526306',name:'유앤채'}]){
  let reads=0;
  const h=fixture([record('validation-complete',{company}),{...registered([row('sku-1'),row('sku-2')]),company}],{
   prepared:{...source,company},read:async()=>{if(++reads<=2)throw new tracking.LookupUnavailable('lookup timeout');}
  });
  const outcome=await h.run();assert.equal(outcome.phase,'sku-issued');assert.equal(outcome.registered,false);
  assert.deepEqual(h.retries.map(({phase,attempt,delayMs})=>[phase,attempt,delayMs]),[['validation-pending',1,3000],['validation-pending',2,10000]]);
  assert.equal(h.progress.length,2,'missing replies must not publish or replace a receipt');
  const requests=h.calls.filter(([kind])=>kind==='read');
  assert.deepEqual(requests.map(([, , ,mode])=>mode),[true,true,true,'registration']);
  assert.ok(requests.every(([,id])=>id.productId===source.productId&&id.categoryId===source.categoryId&&id.fingerprint===source.fingerprint));
  assert.equal(h.calls.filter(([kind])=>kind==='verify').length,8);
 }
});

test('lost SKU replies retain the known quotation anchor without counting restored rows as a new observation',async()=>{
 let reads=0;const initialResult=registered([row('old-1'),row('old-2')]);
 const h=fixture([registered([row('new-1'),row('new-2')])],{initialResult,read:async()=>{
  if(++reads===1){assert.equal(h.progress.length,0);throw new tracking.LookupUnavailable('SKU timeout');}
 }});
 assert.equal((await h.run()).phase,'sku-issued');
 assert.deepEqual(h.retries.map(({phase,attempt})=>[phase,attempt]),[['registration-pending',1]]);
 assert.deepEqual(h.calls.filter(([kind])=>kind==='read').map(([, , ,mode])=>mode),['registration','registration']);
 assert.equal(h.progress[0].result.registration.rows[0].skuId,'new-1');assert.equal(initialResult.registration.rows[0].skuId,'old-1');
});

test('missing replies stop after three retries and never publish an unobserved result',async()=>{
 const h=fixture([],{read:async()=>{throw new tracking.LookupUnavailable('no reply');}});
 await assert.rejects(h.run(),/no reply/);
 assert.equal(h.calls.filter(([kind])=>kind==='read').length,4);
 assert.deepEqual(h.calls.filter(([kind])=>kind==='wait').map(([,ms])=>ms),[3000,10000,30000]);
 assert.equal(h.retries.length,3);assert.ok(h.retries.every(retry=>retry.maxAttempts===3));assert.equal(h.progress.length,0);
});

test('a successful file reply resets the missing-reply budget before subsequent SKU lookup',async()=>{
 let reads=0;const h=fixture([record('validation-complete'),registered([row('sku-1'),row('sku-2')])],{read:async()=>{
  if([1,2,4,5].includes(++reads))throw new tracking.LookupUnavailable('late reply');
 }});
 assert.equal((await h.run()).phase,'sku-issued');
 assert.deepEqual(h.retries.map(({phase,attempt,delayMs})=>[phase,attempt,delayMs]),[
  ['validation-pending',1,3000],['validation-pending',2,10000],['registration-pending',1,3000],['registration-pending',2,10000]
 ]);
});

test('a changed source after a missing reply stops before any retry or result publication',async()=>{
 let verifies=0;const h=fixture([],{read:async()=>{throw new tracking.LookupUnavailable('timeout');},verify:async()=>{
  if(++verifies===2)throw Error('company/category/draft changed');
 }});
 await assert.rejects(h.run(),/changed/);assert.equal(h.retries.length,0);assert.equal(h.progress.length,0);
 assert.equal(h.calls.filter(([kind])=>kind==='read').length,1);assert.equal(h.calls.some(([kind])=>kind==='wait'),false);
});

test('aborting the retry callback, retry wait or lookup prevents another request',async()=>{
 for(const point of ['callback','wait','read']){
  const h=fixture([],{read:async()=>{if(point==='read')h.controller.abort();throw new tracking.LookupUnavailable('timeout');},
   wait:async()=>{if(point==='wait')h.controller.abort();}});
  if(point==='callback')h.options.onRetry=()=>h.controller.abort();
  await assert.rejects(h.run(),/중단/);assert.equal(h.calls.filter(([kind])=>kind==='read').length,1);assert.equal(h.progress.length,0);
  if(point!=='wait')assert.equal(h.calls.some(([kind])=>kind==='wait'),false);
 }
});

test('reply retries respect the overall deadline and preserve the last fresh file result',async()=>{
 let reads=0;const h=fixture([record('validation-complete')],{maxDurationMs:2000,read:async()=>{
  if(++reads===2)throw new tracking.LookupUnavailable('SKU timeout');
 }});
 const outcome=await h.run();assert.equal(outcome.timedOut,true);assert.equal(outcome.phase,'registration-pending');assert.equal(outcome.issuedSkus,0);
 assert.equal(outcome.result.state,'validation-complete');assert.equal(outcome.registered,false);
 assert.equal(h.retries[0].delayMs,2000);assert.equal(h.calls.filter(([kind])=>kind==='read').length,2);
 const expired=fixture([],{read:async()=>{throw new tracking.LookupUnavailable('timeout');}});let tick=0;expired.options.now=()=>tick++?180000:0;
 assert.equal((await expired.run()).timedOut,true);assert.equal(expired.retries.length,0);assert.equal(expired.calls.some(([kind])=>kind==='wait'),false);
});

test('a failed retry callback stops tracking instead of scheduling an unseen request',async()=>{
 const h=fixture([],{read:async()=>{throw new tracking.LookupUnavailable('timeout');}});h.options.onRetry=()=>{throw Error('callback failed');};
 await assert.rejects(h.run(),/callback failed/);assert.equal(h.calls.filter(([kind])=>kind==='read').length,1);assert.equal(h.calls.some(([kind])=>kind==='wait'),false);
});

test('continuing an accepted receipt queries its known quotation ID directly and never accepts a replacement',async()=>{
 for(const company of [source.company,{code:'A01526306',name:'유앤채'}]){
  const initialResult={...registered([row('sku-1'),row('sku-2')]),company};
  const h=fixture([{...registered([row('sku-1'),row('sku-2')]),company}],{prepared:{...source,company},initialResult});
  assert.equal((await h.run()).phase,'sku-issued');
  assert.deepEqual(h.calls.filter(([kind])=>kind==='read').map(([, , ,mode])=>mode),['registration']);
  const changed=fixture([{...registered([row('sku-1'),row('sku-2')]),company,quotationId:'other-quote'}],{prepared:{...source,company},initialResult});
  await assert.rejects(changed.run(),/견적서 ID가 변경/);assert.equal(changed.progress.length,0);
 }
});

test('automatic tracking rejects a different filename or false registration claim before publishing it',async()=>{
 for(const patch of [{filename:'other.xlsx'},{registered:true},{state:'unknown'},{observedAt:0}]){
  const h=fixture([record('validation-complete',patch)]);
  await assert.rejects(h.run());assert.equal(h.progress.length,0);
 }
 const wrong=fixture([],{initialResult:record('validation-complete',{filename:'other.xlsx'})});
 await assert.rejects(wrong.run());assert.equal(wrong.calls.length,0);
});

test('both companies follow pending file validation into fresh per-SKU lookup without another upload',async()=>{
 for(const company of [source.company,{code:'A01526306',name:'유앤채'}]){
  const replies=[null,record('not-found'),record(),registered([row('old-1'),row('old-2')]),registered([]),registered([row('sku-1'),row('')]),registered([row('sku-1'),row('sku-2')])]
   .map(value=>value?{...value,company}:value);
  const h=fixture(replies,{prepared:{...source,company}}),outcome=await h.run();
  assert.equal(outcome.phase,'sku-issued');assert.equal(outcome.issuedSkus,2);assert.equal(outcome.registered,false);assert.equal(outcome.timedOut,false);
  assert.deepEqual(h.calls.filter(([kind])=>kind==='read').map(([,identity,,mode])=>[JSON.parse(JSON.stringify(identity)),mode]),Array.from({length:7},(_,i)=>[{productId:'p',categoryId:'80719',fingerprint:source.fingerprint},i<4?true:'registration']));
  assert.equal(h.calls.filter(([kind])=>kind==='verify').length,14);
  assert.deepEqual(h.progress.map(value=>value.phase),['validation-pending','validation-pending','validation-pending','registration-pending','registration-pending','registration-pending','sku-issued']);
  assert.equal(h.progress[3].issuedSkus,0,'stored old SKU rows cannot complete a new lookup');
  assert.ok(h.calls.every(([kind])=>['read','verify','wait'].includes(kind)));
 }
});

test('file and individual-product rejection stop follow-up and keep Hub detail without retrying files',async()=>{
 const file=fixture([record('validation-rejected',{detail:'가격 오류'})]);
 const fileOutcome=await file.run();assert.equal(fileOutcome.phase,'validation-rejected');assert.equal(fileOutcome.result.detail,'가격 오류');assert.equal(file.calls.filter(([kind])=>kind==='read').length,1);
 const sku=fixture([record('validation-complete'),registered([row('sku-1'),row('sku-2',{status:'반려'})])]);
 assert.equal((await sku.run()).phase,'registration-rejected');assert.equal(sku.calls.some(([kind])=>kind==='wait'),false);
});

test('changing company, name, option count or quotation ID cannot publish evidence for the reviewed package',async()=>{
 for(const patch of [{company:{code:'A01526306',name:'유앤채'}},{company:{code:'A01464742',name:'other'}},{company:undefined},{includedOptions:1},{includedOptions:undefined}]){
  const h=fixture([record('validation-complete',patch)]);await assert.rejects(h.run(),/회사 또는 옵션 수/);assert.equal(h.progress.length,0);
 }
 const changed=fixture([record('validation-complete'),registered([row('a'),row('b')],{quotationId:'other'})]);
 await assert.rejects(changed.run(),/견적서 ID가 변경/);assert.equal(changed.progress.length,1);
 for(const quotationId of [undefined,'',' quote-123','x'.repeat(201)])await assert.rejects(fixture([record('validation-complete',{quotationId})]).run(),/견적서 ID/);
 await assert.rejects(fixture([record('validation-complete'),record()]).run(),/검증 상태가 변경/);
});

test('same-count duplicate SKU IDs, placeholders and excess rows never become SKU issuance',async()=>{
 const duplicates=fixture([record('validation-complete'),registered([row('sku'),row(' sku ')])]);
 await assert.rejects(duplicates.run(),/중복/);assert.equal(duplicates.progress.some(value=>value.phase==='sku-issued'),false);
 await assert.rejects(fixture([record('validation-complete'),registered([row('1'),row('2'),row('3')])]).run(),/옵션 수보다 많/);
 for(const placeholder of ['',' ','—','-','미표시','N/A','해당사항없음','12345678...','12345678…']){
  const h=fixture([record('validation-complete'),registered([row('sku-1'),row(placeholder)])],{maxDurationMs:3000});
  const outcome=await h.run();assert.equal(outcome.phase,'registration-pending');assert.equal(outcome.issuedSkus,1);assert.equal(outcome.timedOut,true);assert.equal(outcome.registered,false);
 }
});

test('source changes before or during a Chrome read prevent stale result publication',async()=>{
 const before=fixture([record()],{verify:async()=>{throw Error('saved source changed');}});
 await assert.rejects(before.run(),/saved source changed/);assert.equal(before.calls.some(([kind])=>kind==='read'),false);
 let changed=false;
 const during=fixture([record('validation-complete')],{read:async()=>{changed=true;},verify:async()=>{if(changed)throw Error('changed while reading');}});
 await assert.rejects(during.run(),/changed while reading/);assert.equal(during.progress.length,0);
 let checks=0;
 const next=fixture([record(),record('validation-complete')],{verify:async()=>{if(++checks===3)throw Error('edited while waiting');}});
 await assert.rejects(next.run(),/edited while waiting/);assert.equal(next.calls.filter(([kind])=>kind==='read').length,1);
});

test('abort before start, during a read or during wait releases follow-up without resubmission',async()=>{
 const before=fixture([record()]);before.controller.abort();await assert.rejects(before.run(),/중단/);assert.equal(before.calls.length,0);
 const during=fixture([record()],{read:async()=>during.controller.abort()});await assert.rejects(during.run(),/중단/);assert.equal(during.progress.length,0);
 const waiting=fixture([record()],{wait:async()=>waiting.controller.abort()});await assert.rejects(waiting.run(),/중단/);assert.equal(waiting.calls.filter(([kind])=>kind==='read').length,1);
});

test('timeouts and transient errors do not claim registration or replay an upload; request count is bounded',async()=>{
 const expired=fixture([record()],{maxDurationMs:1000}),outcome=await expired.run();assert.equal(outcome.timedOut,true);assert.equal(outcome.registered,false);
 assert.deepEqual(expired.calls.filter(([kind])=>kind==='wait'),[['wait',1000]]);
 const failing=fixture([record()],{read:async()=>{throw Error('response lost');}});await assert.rejects(failing.run(),/response lost/);assert.equal(failing.calls.filter(([kind])=>kind==='read').length,1);
 const bounded=fixture([record()]);bounded.options.now=()=>0;bounded.options.wait=async()=>{};
 assert.equal((await bounded.run()).timedOut,true);assert.equal(bounded.calls.filter(([kind])=>kind==='read').length,300);
 for(const patch of [{includedOptions:0},{includedOptions:201},{company:{code:'other',name:'other'}},{fingerprint:'bad'},{filename:'old.xlsx'}]){
  const h=fixture([],{prepared:{...source,...patch}});await assert.rejects(h.run());assert.equal(h.calls.length,0);
 }
});

test('real wait removes its timer and abort listener on completion and cancellation',async()=>{
 const timers=new Map();const clock=api({setTimeout:(callback,ms)=>{timers.set(callback,ms);return callback;},clearTimeout:callback=>timers.delete(callback)});
 const controller=new AbortController(),waiting=clock.waitForNextLookup(3000,controller.signal);
 assert.equal(timers.size,1);controller.abort();await assert.rejects(waiting,/중단/);assert.equal(timers.size,0);
 const next=new AbortController(),done=clock.waitForNextLookup(5000,next.signal);
 for(const callback of [...timers.keys()]){timers.delete(callback);callback();}await done;next.abort();assert.equal(timers.size,0);
 const aborted=new AbortController();aborted.abort();await assert.rejects(clock.waitForNextLookup(3000,aborted.signal));assert.equal(timers.size,0);
});

test('multi-page results reach SKU issuance only after any known remaining page is checked',async()=>{
 const paged=hasMore=>registered([row('sku-1'),row('sku-2')],{registration:{...registered([]).registration,scope:'queried-pages',pagesRead:2,hasMore,rows:[row('sku-1'),row('sku-2')]}});
 const h=fixture([record('validation-complete'),paged(true),paged(false)]),outcome=await h.run();
 assert.equal(outcome.phase,'sku-issued');assert.equal(outcome.result.registration.pagesRead,2);assert.equal(outcome.registered,false);
 assert.equal(h.progress[1].phase,'registration-pending');assert.equal(h.progress[1].issuedSkus,2);
 const partial=fixture([record('validation-complete'),paged(true)],{maxDurationMs:3000});assert.equal((await partial.run()).timedOut,true);
});
