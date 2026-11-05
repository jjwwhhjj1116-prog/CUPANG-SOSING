import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sizeChartSaveFixture,json,chart,png,plain} from './helpers/size-chart-save.mjs';

async function fixture({required=true,manual=false,asset=false,cleared=false}={}){
 const f=await sizeChartSaveFixture(),initial=await json(await f.get()),content=initial.content;
 if(!asset)content.assets.size={value:[],provenance:cleared?'manual':'unverified',updatedAt:null};
 if(manual)content.manualSizeChart=plain(chart);
 f.h.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(content),f.id);
 const before=await json(await f.get()),view=await json(await f.route(f.base+'/quotation-fields'+f.query)),keys=new Map(),controller=new AbortController(),plans=[],calls=[];
 assert.ok(fs.existsSync(new URL('../app/batch-selected-size-chart-work.ts',import.meta.url)),'selected size runner is missing');
 const model=f.h.load('app/batch-selected-size-chart-work.ts'),source={content:before.content,layout:{format:'yoofam-registration-layout-v1',productId:f.id,productVersion:before.productVersion,categoryContext:view.categoryContext,sizeChartRequired:required}};
 let intercept,guard=async()=>{};
 const fetcher=async(path,init={})=>{calls.push({path,method:init.method??'GET',...(init.body instanceof FormData?{input:JSON.parse(init.body.get('input'))}:{})});const answer=await intercept?.(path,init);if(answer)return answer;return path.includes('/size-chart-save')?f.fetcher(path,init):f.route(path,{method:init.method??'GET'});};
 const controls={expectedOwnerId:'owner',company:f.company,keys,signal:controller.signal,fetcher,source,assertCurrent:()=>guard()},deps={render:async plan=>{plans.push(plain(plan));return{blob:new Blob([png],{type:'image/png'}),width:plan.width,height:400};}};
 return{...f,before,view,keys,controller,plans,calls,model,controls,deps,run:()=>model.runSelectedSizeChartWork(f.id,controls,deps),intercept(value){intercept=value;},guard(value){guard=value;}};
}

test('required empty size work saves one generated reference PNG and chart while preserving option overrides and old files',async()=>{
 const f=await fixture();try{
  const beforeOptions=plain(f.before.options),quotes=f.h.sqlite.prepare('SELECT payload FROM product_quotation_fields WHERE product_id=?').get(f.id).payload,files=new Map(f.h.objects);
  const result=await f.run();assert.equal(result.status,'draft');assert.equal(result.uncertain,undefined);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.equal(f.plans.length,1);assert.equal(f.plans[0].width,1200);
  const saved=await json(await f.get()),view=await json(await f.route(f.base+'/quotation-fields'+f.query)),key=saved.content.assets.size.value[0];
  assert.equal(saved.content.assets.size.provenance,'generated');assert.deepEqual(saved.content.manualSizeChart,plain(f.h.load('app/manual-size-chart.ts').createReferenceSizeChart()));assert.deepEqual(saved.options,beforeOptions);assert.equal(saved.content.label.dimensions.value,f.before.content.label.dimensions.value);
  assert.equal(view.resolved.rows.find(row=>row.optionId==='synthetic-one').fields[f.sizeField].value,key);assert.equal(f.h.sqlite.prepare('SELECT payload FROM product_quotation_fields WHERE product_id=?').get(f.id).payload,quotes);for(const[key,bytes]of files)assert.deepEqual(f.h.objects.get(key),bytes);
  assert.equal(f.model.hasSelectedSizeChartAttempt(f.keys,'owner',f.id),false);assert.deepEqual([...f.keys],[]);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

for(const kind of ['saved asset','manual chart','optional empty','manual clear'])test(`size work preserves ${kind} priority`,async()=>{
 const f=await fixture({asset:kind==='saved asset',manual:kind==='manual chart',required:kind!=='optional empty',cleared:kind==='manual clear'});try{
  const result=await f.run();assert.equal(result.status,kind==='optional empty'?'skipped':kind==='manual clear'?'blocked':'draft');
  assert.equal(f.calls.filter(call=>call.method==='POST').length,kind==='manual chart'?1:0);assert.equal(f.plans.length,kind==='manual chart'?1:0);
  if(kind==='manual chart'){const saved=await json(await f.get());assert.deepEqual(saved.content.manualSizeChart,chart);assert.equal(saved.content.assets.size.provenance,'manual');}
 }finally{f.close();}
});

test('lost ACK retains the same immutable attempt and a same-request remount recovers by GET only',async()=>{
 const f=await fixture();try{
  let blockRecovery=true;f.intercept(async(path,init)=>{if(path.includes('uploadId=')&&blockRecovery)return Response.json({error:'GET unavailable'},{status:503});if(init.method==='POST'){await f.fetcher(path,init);throw Error('lost ACK');}});
  const first=await f.run();assert.equal(first.uncertain,true);assert.equal(f.model.hasSelectedSizeChartAttempt(f.keys,'owner',f.id),true);const posted=f.calls.find(call=>call.method==='POST').input;
  blockRecovery=false;const from=f.calls.length,resumed=await f.model.runSelectedSizeChartWork(f.id,{...f.controls},f.deps);assert.equal(resumed.status,'draft');assert.equal(resumed.stop,true);assert.ok(f.calls.slice(from).every(call=>call.method==='GET'));assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.equal(f.plans.length,1);
  assert.equal((await json(await f.get(posted.uploadId))).upload.uploadId,posted.uploadId);assert.equal(f.model.hasSelectedSizeChartAttempt(f.keys,'owner',f.id),false);
 }finally{f.close();}
});

test('confirmed uncommitted recovery never reposts its retained PNG or starts a fresh rendering',async()=>{
 const f=await fixture();try{
  f.fault(1);assert.equal((await f.run()).uncertain,true);f.fault(undefined);const from=f.calls.length,result=await f.run();assert.equal(result.uncertain,true);assert.equal(result.status,'blocked');assert.ok(f.calls.slice(from).every(call=>call.method==='GET'));assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.equal(f.plans.length,1);assert.equal(f.model.hasSelectedSizeChartAttempt(f.keys,'owner',f.id),true);
 }finally{f.close();}
});

test('a committed lost POST acknowledgement recovered inside the same invocation stops later work safely',async()=>{
 const f=await fixture();try{f.intercept(async(path,init)=>{if(init.method==='POST'){await f.fetcher(path,init);throw Error('lost committed acknowledgement');}});const result=await f.run();assert.equal(result.status,'draft');assert.equal(result.stop,true);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.equal(f.plans.length,1);}finally{f.close();}
});

for(const change of ['source','scope','abort'])test(`size preparation rejects ${change} changes before POST`,async()=>{
 const f=await fixture();try{
  const render=f.deps.render;f.deps.render=async(...args)=>{const output=await render(...args);if(change==='source')f.h.sqlite.prepare('UPDATE products SET title=? WHERE id=?').run('외부 수정',f.id);if(change==='scope'){let once=false;f.guard(async()=>{if(!once){once=true;throw Error('account changed once');}});}if(change==='abort')f.controller.abort();return output;};
  await assert.rejects(f.run());assert.equal(f.calls.filter(call=>call.method==='POST').length,0);assert.equal(f.model.hasSelectedSizeChartAttempt(f.keys,'owner',f.id),false);
 }finally{f.close();}
});

test('concurrent same-request size starts reserve one render and one POST',async()=>{
 const f=await fixture();try{let release;const render=f.deps.render;f.deps.render=async(...args)=>{await new Promise(resolve=>release=resolve);return render(...args);};const first=f.run();while(!release)await new Promise(resolve=>setImmediate(resolve));const second=await f.run();assert.equal(second.uncertain,true);release();assert.equal((await first).status,'draft');assert.equal(f.plans.length,1);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);}finally{f.close();}
});

for(const code of [409,503])test(`initial atomic size GET ${code} ${code===409?'is a typed source conflict':'remains an ordinary read failure'} without rendering or POST`,async()=>{
 const f=await fixture();try{
  f.intercept(path=>path.includes('/size-chart-save')?Response.json({error:'snapshot unavailable'},{status:code}):undefined);
  await assert.rejects(f.run(),cause=>code===409?cause instanceof f.model.SelectedSizeChartSourceChanged:!(cause instanceof f.model.SelectedSizeChartSourceChanged));
  assert.equal(f.plans.length,0);assert.equal(f.calls.filter(call=>call.method==='POST').length,0);assert.equal(f.model.hasSelectedSizeChartAttempt(f.keys,'owner',f.id),false);assert.deepEqual([...f.keys],[]);
 }finally{f.close();}
});
