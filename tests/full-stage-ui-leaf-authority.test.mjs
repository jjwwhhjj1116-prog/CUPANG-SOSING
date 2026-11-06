import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {stageDOM as actualStageDOM} from './helpers/cold-price-main-dom.mjs';
const sourceOverrides=process.env.FULL_STAGE_LEAF_BEFORE?new Map(JSON.parse(fs.readFileSync(path.join(process.env.FULL_STAGE_LEAF_BEFORE,'final-hashes.json'),'utf8')).files.filter(file=>file.kind==='runtime').map(file=>[file.path,fs.readFileSync(path.join(process.env.FULL_STAGE_LEAF_BEFORE,'final',file.path),'utf8')])):undefined;
const stageDOM=fetcher=>actualStageDOM(fetcher,{sourceOverrides});
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const reactProps=node=>node[Object.getOwnPropertyNames(node).find(key=>key.startsWith('__reactProps$'))];
const deferred=()=>{let resolve;return{promise:new Promise(done=>resolve=done),resolve:()=>resolve()};};
const definitions={
 label:{module:'option-label-editor',export:'OptionLabelEditor',value:'원본 저장 요청의 수동 입력',save:'선택 옵션 상품고시 저장',read:'입력 유지·최신 상품고시 조회',input:root=>[...root.querySelectorAll('textarea')].find(node=>!node.disabled)},
 image:{module:'option-image-editor',export:'OptionImageEditor',value:'<p>original manual image draft</p>',save:'선택 옵션 이미지 저장',read:'입력 유지·최신 이미지 조회',input:root=>root.querySelector('[aria-label="선택 옵션 상세 HTML"]')},
 seo:{module:'option-seo-editor',export:'OptionSeoEditor',value:'원본 저장 요청의 수동 상품명',save:'선택 옵션 SEO 저장',read:'입력 유지·최신 SEO 조회',input:root=>root.querySelector('[aria-label="선택 옵션 상품명"]')},
};

async function fixture(){
 const api=mobileIntakeHarness();await api.intake();
 const product=await api.load('db/queries.ts').findProduct('owner',api.latest.product_id),options=await api.load('db/product-options.ts').readProductOptions('owner',product.id),optionId=options.rows.find(row=>row.included).id,base='/api/products/'+product.id;
 const scope={ownerId:'owner',company:{code:'A01464742',name:'와이홉'},productId:product.id,productVersion:product.updated_at,sourceUrl:product.source_url,settingsEpoch:0,profileEpoch:0,profileId:null,refresh:0};
 return{api,product,optionId,base,endpoint:base+'/quotation-fields',scope};
}
const button=(h,text)=>[...h.container.querySelectorAll('button')].find(node=>node.textContent===text);
async function until(h,condition,message){for(let i=0;i<30;i++){if(condition())return;await h.settle();}assert.ok(condition(),message);}
async function mount(h,f,kind,reads,onSaved=()=>{}){
 const definition=definitions[kind],Component=h.load('app/components/'+definition.module+'.tsx')[definition.export],props={productId:f.product.id,version:f.product.updated_at,optionId:f.optionId,stage:'detail',active:true,uiReads:reads,onBeginSourceWrite:()=>reads.beginMutation(),onSaved};
 await h.render(Component,props);await until(h,()=>definition.input(h.container)&&!definition.input(h.container).disabled,'actual '+kind+' input ready');return{definition,Component,props,input:()=>definition.input(h.container)};
}
async function editAndSave(h,leaf){await h.React.act(async()=>reactProps(leaf.input()).onChange({target:{value:leaf.definition.value}}));const save=button(h,leaf.definition.save);assert.ok(save&&!save.disabled,'actual save admitted');await h.React.act(async()=>save.click());await until(h,()=>h.container.querySelector('[data-workspace-saving]')?.getAttribute('data-workspace-saving')==='false','actual save has completed before recovery can be clicked');}

for(const kind of ['label','image'])test(kind+': an unchanged native GET cannot release an unknown PUT, even when its original commit arrives later',async()=>{
 const f=await fixture(),native=[],shared=[];let h,reads,saved=0,queued;
 try{
  h=await stageDOM(async(url,init={})=>{native.push({url:String(url),method:init.method??'GET',cache:init.cache});if(init.method==='PUT'){queued={url:String(url),method:'PUT',body:init.body};throw Error('unknown original transport outcome');}return f.api.route(String(url),init);});
  reads=h.load('app/registration-ui-reads.tsx').createRegistrationUiReads(f.scope,new Set(),(url,init)=>{shared.push({url,signal:init.signal});return f.api.route(url);});
  const leaf=await mount(h,f,kind,reads,()=>saved++);await editAndSave(h,leaf);assert.ok(queued);assert.equal(reads.canRead(),false);
  const before=native.length;await h.React.act(async()=>button(h,leaf.definition.read).click());for(let i=0;i<7;i++)await h.settle();assert.equal(saved,0);assert.equal(leaf.input().value,leaf.definition.value);assert.deepEqual(native.slice(before),[{url:f.endpoint,method:'GET',cache:'no-store'}]);
  const cachedBefore=reads.canRead()?await reads.quotation(f.endpoint):null;
  const response=await f.api.route(queued.url,{method:queued.method,body:queued.body});assert.equal(response.status,200);const committed=await response.json(),cachedAfter=reads.canRead()?await reads.quotation(f.endpoint):null;
  assert.equal(native.filter(call=>call.method==='PUT').length,1);assert.equal(saved,0);assert.equal(leaf.input().value,leaf.definition.value);
  assert.deepEqual({canRead:reads.canRead(),staleReuse:!!cachedBefore&&cachedAfter?.revision===cachedBefore.revision&&cachedAfter?.revision!==committed.revision},{canRead:false,staleReuse:false},'unchanged read is not the original committed-write proof');
  await assert.rejects(reads.quotation(f.endpoint),/저장 상태/);assert.equal(shared.length,1,'neither unchanged native recovery nor delayed commit refills shared memory');
 }finally{if(h)await h.close();f.api.close();}
});

for(const kind of ['label','image','seo'])test(kind+': aborting one actual initial reader leaves another subscriber and the shared transport intact',async()=>{
 const f=await fixture(),gate=deferred(),shared=[];let h,reads;
 try{
  h=await stageDOM((url,init)=>f.api.route(String(url),init));
  reads=h.load('app/registration-ui-reads.tsx').createRegistrationUiReads(f.scope,new Set(),async(url,init)=>{shared.push({url,signal:init.signal});const response=await f.api.route(url);await gate.promise;return response;});
  const remaining=reads.quotation(f.endpoint).then(value=>({value}),error=>({error})),definition=definitions[kind],Component=h.load('app/components/'+definition.module+'.tsx')[definition.export],props={productId:f.product.id,version:f.product.updated_at,optionId:f.optionId,stage:'detail',active:true,uiReads:reads};
  await h.render(Component,props);assert.equal(shared.length,1);await h.render(Component,{...props,active:false});await h.settle();assert.equal(shared[0].signal.aborted,false);gate.resolve();const outcome=await remaining;
  assert.ok(outcome.value,'sibling initial reader abort must not invalidate the common episode: '+outcome.error?.message);assert.equal(outcome.value.productVersion,f.product.updated_at);assert.equal(shared.length,1);assert.equal(reads.canRead(),true);
 }finally{gate.resolve();if(h)await h.close();f.api.close();}
});

for(const kind of ['label','image','seo'])for(const lostAck of [true,false])test(kind+': '+(lostAck?'original committed recovery':'normal validated ACK')+' confirms only its own write lease once',async()=>{
 const f=await fixture(),native=[];let h,reads,saved=0;
 try{
  h=await stageDOM(async(url,init={})=>{native.push({url:String(url),method:init.method??'GET',cache:init.cache});const response=await f.api.route(String(url),init);if(init.method==='PUT'){assert.equal(response.status,200);if(lostAck)throw Error('lost ACK after original actual API commit');}return response;});
  reads=h.load('app/registration-ui-reads.tsx').createRegistrationUiReads(f.scope,new Set(),url=>f.api.route(url));const leaf=await mount(h,f,kind,reads,()=>saved++),otherWriter=reads.beginMutation();await editAndSave(h,leaf);
  if(lostAck){assert.equal(saved,0);assert.equal(reads.canRead(),false);const before=native.length;await h.React.act(async()=>button(h,leaf.definition.read).click());await until(h,()=>saved===1,'original exact native recovery confirmed');assert.deepEqual(native.slice(before),[{url:f.endpoint,method:'GET',cache:'no-store'}]);}
  await until(h,()=>saved===1,'validated original save reported');assert.equal(leaf.input().value,leaf.definition.value);assert.equal(native.filter(call=>call.method==='PUT').length,1);assert.equal(saved,1);assert.equal(reads.canRead(),false,'another unresolved writer remains held');otherWriter.confirm();assert.equal(reads.canRead(),true,'the leaf released its own successfully proven lease');
  await h.settle();assert.equal(saved,1,'no duplicate success callback');
 }finally{if(h)await h.close();f.api.close();}
});

for(const kind of ['label','image','seo'])test(kind+': a genuine current invalid response still evicts the initial shared entry',async()=>{
 const f=await fixture();let h,reads,calls=0;
 try{
  h=await stageDOM((url,init)=>f.api.route(String(url),init));
  reads=h.load('app/registration-ui-reads.tsx').createRegistrationUiReads(f.scope,new Set(),async url=>{const response=await f.api.route(url);calls++;if(calls!==1)return response;const body=await response.json();body.resolved.rows=body.resolved.rows.filter(row=>row.optionId!==f.optionId);return Response.json(body);});
  const definition=definitions[kind],Component=h.load('app/components/'+definition.module+'.tsx')[definition.export];await h.render(Component,{productId:f.product.id,version:f.product.updated_at,optionId:f.optionId,stage:'detail',active:true,uiReads:reads});await until(h,()=>h.container.querySelector('[role="alert"]'),'original leaf validator rejects the malformed current option row');
  const valid=await reads.quotation(f.endpoint);assert.equal(calls,2,'invalid current payload was evicted, not accepted or kept cached');assert.equal(valid.resolved.rows.filter(row=>row.optionId===f.optionId).length,1);assert.equal(valid.productVersion,f.product.updated_at);
 }finally{if(h)await h.close();f.api.close();}
});
