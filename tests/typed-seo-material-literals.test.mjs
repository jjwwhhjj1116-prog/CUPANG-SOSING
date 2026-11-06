import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
const api=providedOptionModule('app/automation/translation.ts'),plain=value=>JSON.parse(JSON.stringify(value));
const source=raw=>({title:'커튼',description:'',attributes:[{name:'상품속성: 材质',value:raw},{name:'상품속성: 用途',value:'실내용'}],provenance:'manual',reference:'local material contract',category:{id:'synthetic',path:['커튼']}});
const composition={version:'couplus-current-composition-v1',memo:{brand:'',features:'',keywords:'커튼'},related:{source:'none',query:'커튼',keywords:[],warnings:[]}};
const context={optionRevision:1,bundleQuantity:null,selectedOptions:[{id:'owned-1',name:'흰색',nameTrans:'흰색',color:'흰색',size:'',bundleQuantity:1,manualName:false,manualColor:false,manualSize:false}]};
const output=value=>({title:'커튼',description:'',keywords:['커튼'],attributes:[{sourceIndex:0,name:'재질',value},{sourceIndex:1,name:'용도',value:'실내용'}],warnings:[]});
async function fixture(raw='涤纶（聚酯纤维）',reply=output('테리폼（폴리에스테르）')){
 const calls=[],config={provider:'workers-ai',apiKey:'',model:api.WORKERS_QWEN_MODEL,maxOutputTokens:4096,ai:{run:async(_model,input)=>{
  calls.push(plain(input));const data=JSON.parse(input.messages[1].content.split('\n\nPRODUCT_SOURCE_JSON:\n')[1].slice(0,-'\n/no_think'.length));
  const result=data.validationDraft?{...data.validationDraft,attributes:reply.attributes}:{...plain(reply),seoOptions:[{optionId:'owned-1',name:'흰색'}]};
  return {choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(result)}}]};
 }}};
 const review=await api.prepareTranslationReview(source(raw),config,new Date(),plain(composition),plain(context));
 return{calls,config,review,reply,result:()=>api.executeTranslation(review,config,()=>assert.fail('No network'))};
}
const strict=(draft,original,revision='couplus-typed-seo-v3')=>api.validateQwenTranslationDraft(draft,original,'commerce-exact-option-colors-v6','couplus-generated-v1',composition,context,'all',revision);

for(const bad of ['테리폼（폴리에스터섬유）','테리폼（폴리에스테르）'])test('v3 source canonicalization replaces bad material '+bad+' after generation and bounded validation',async()=>{
 const f=await fixture(undefined,output(bad)),before=JSON.stringify(f.review),raw=JSON.stringify(f.reply),result=await f.result();
 assert.deepEqual(plain(result.draft.attributes),[{sourceIndex:0,name:'재질',value:'폴리에스테르'},{sourceIndex:1,name:'용도',value:'실내용'}]);assert.equal(f.review.typedSeoPromptRevision,'couplus-typed-seo-v3');
 assert.equal(result.draft.title,'커튼');assert.deepEqual(Array.from(result.draft.keywords),['커튼']);assert.deepEqual(plain(result.seoOptions),[{optionId:'owned-1',name:'흰색'}]);assert.equal(f.calls.length,2);assert.equal(JSON.stringify(f.review),before);assert.equal(JSON.stringify(f.reply),raw);
 assert.doesNotThrow(()=>strict(result.draft,f.review.source));
});
test('v3 fills only a fully known omitted material row and preserves exact original composition tokens',async()=>{
 const reply=output('unused');reply.attributes=reply.attributes.slice(1);
 const f=await fixture('棉85.0%,氨纶10%,锦纶5%',reply),result=await f.result();
 assert.equal(result.draft.attributes.find(value=>value.sourceIndex===0).value,'면 85.0%, 스판덱스 10%, 나일론 5%');assert.equal(result.draft.attributes.find(value=>value.sourceIndex===1).value,'실내용');
});
test('unknown source material and model-created material headings stay withheld with original source and indexed warning',async()=>{
 const reply=output('실내용');reply.attributes[1].name='재질';
 const f=await fixture('미확인 원료',reply),before=JSON.stringify(f.review.source),result=await f.result();
 assert.deepEqual(plain(result.draft.attributes),[]);assert.match(result.draft.warnings.join(' '),/sourceIndex 0/);assert.match(result.draft.warnings.join(' '),/sourceIndex 1/);assert.equal(JSON.stringify(f.review.source),before);
});
test('strict v3 apply validation rejects changed material, missing canonical row, redirected identity and unsupported additions without repairing them',()=>{
 const original=source('涤纶（聚酯纤维）'),good=output('폴리에스테르');assert.doesNotThrow(()=>strict(good,original));
 for(const change of [value=>{value.attributes[0].value='테리폼（폴리에스테르）';},value=>{value.attributes[0].value='나일론';},value=>{value.attributes.shift();},value=>{value.attributes[0].sourceIndex=99;},value=>{value.attributes[1].name='재질';},value=>{value.attributes[1].sourceIndex=0;}]){
  const draft=plain(good);change(draft);const before=JSON.stringify(draft);assert.throws(()=>strict(draft,original));assert.equal(JSON.stringify(draft),before);
 }
 assert.throws(()=>strict(output('폴리에스테르'),source('미확인 원료')));
});
test('legacy material validators retain their former result behavior while v3 adoption preserves manual values and blanks',async()=>{
 const bad=output('테리폼（폴리에스테르）'),original=source('涤纶（聚酯纤维）');for(const revision of [undefined,'couplus-typed-seo-v1','couplus-typed-seo-v2'])assert.doesNotThrow(()=>api.validateQwenTranslationDraft(bad,original,'commerce-exact-option-colors-v6','couplus-generated-v1',composition,context,'all',revision));
 const f=await fixture(),result=await f.result(),model=providedOptionModule('app/product-content.ts'),adoption=providedOptionModule('app/translation-batch-adoption.ts');
 const content=model.applyContentPatch(model.emptyProductContent('p'),{seo:{title:'',keywords:[]},label:{material:''},labelClears:['material']},'v');
 const job={id:'00000000-0000-4000-8000-000000000001',productId:'p',productVersion:'v',status:'completed',review:f.review,result};
 const before=JSON.stringify(content),plan=adoption.translationBatchAdoption(content,job,'v');assert.equal(plan.input?.patch?.seo?.title,undefined);assert.equal(plan.input?.patch?.label?.material,undefined);assert.equal(JSON.stringify(content),before);
 const changed=plain(job);changed.result.draft.attributes[0].value='테리폼（폴리에스테르）';assert.throws(()=>adoption.translationBatchAdoption(content,changed,'v'));
});

test('actual API rejects tampered v3 stored material while normal manual content edits remain allowed and retire the old source clock',async()=>{
 let code=fs.readFileSync('tests/batch-selected-qwen-integration.test.mjs','utf8');code=code.slice(0,code.indexOf('\nfor(const manual')).replace("'./helpers/mobile-intake.mjs'",JSON.stringify(new URL('./helpers/mobile-intake.mjs',import.meta.url).href));code+='\nexport {fixture,translated};';
 const {fixture:create,translated}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64')),f=await create(),{h}=f;
 const json=async(response,status)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
 try{
  const receipt=JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload);receipt.attributes.push({name:'材质',value:'涤纶（聚酯纤维）'});h.sqlite.prepare('UPDATE collection_results SET payload=?').run(JSON.stringify(receipt));
  let calls=0;h.bindings.AI={run:async(_model,input)=>{calls++;const encoded=input.messages[1].content;const part=encoded.split('\n\nPRODUCT_SOURCE_JSON:\n')[1];if(!part)throw Error('fixture missing source delimiter');const data=JSON.parse(part.slice(0,-'\n/no_think'.length));const material=data.attributes.find(value=>value.name==='상품속성: 材质');return {choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(data.validationDraft??{title:f.good.title,description:'',keywords:['선글라스'],warnings:[],attributes:material?[{sourceIndex:material.sourceIndex,name:'재질',value:'테리폼（폴리에스테르）'}]:[],seoOptions:data.seoOptionTargets.map(value=>({optionId:value.id,name:translated(value.name)}))})}}]};}};
  const route=h.route;h.route=async(path,options={})=>{const body=typeof options.body==='string'?JSON.parse(options.body):options.body;return path.endsWith('/translation-apply')&&body?.action==='apply'?Response.json({error:'fixture leaves completed job unapplied'},{status:409}):route(path,options);};
  const batch=await f.run();h.route=route;
  const stored=h.sqlite.prepare("SELECT * FROM translation_jobs WHERE status='completed' ORDER BY created_at DESC").all().find(value=>JSON.parse(value.review).typedSeoPromptRevision==='couplus-typed-seo-v3');assert.ok(stored,JSON.stringify({stages:batch.stages.map(value=>({status:value.status,message:value.message})),jobs:h.sqlite.prepare('SELECT status,error FROM translation_jobs').all()}));
  const review=JSON.parse(stored.review),result=JSON.parse(stored.result),index=review.source.attributes.findIndex(value=>value.name==='상품속성: 材质');assert.ok(index>=0);assert.equal(result.draft.attributes.find(value=>value.sourceIndex===index).value,'폴리에스테르');
  const base='/api/products/'+f.id,version=()=>h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(f.id).updated_at;
  await json(await h.route(base+'/translation-apply',{method:'POST',body:{action:'preview',jobId:stored.id,expectedVersion:version(),scope:'all'}}),200);
  for(const change of [value=>{value.draft.attributes.find(row=>row.sourceIndex===index).value='테리폼（폴리에스테르）';},value=>{const row=value.draft.attributes.find(row=>row.sourceIndex===index);row.sourceIndex=review.source.attributes.findIndex(pair=>pair.name!==review.source.attributes[index].name&&!pair.name.startsWith('option'));}]){
   const bad=plain(result);change(bad);h.sqlite.prepare('UPDATE translation_jobs SET result=? WHERE id=?').run(JSON.stringify(bad),stored.id);
   const before=h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(f.id).payload;
   for(const action of ['preview','apply']){const response=await json(await h.route(base+'/translation-apply',{method:'POST',body:{action,jobId:stored.id,expectedVersion:version(),scope:'all',...(action==='apply'?{fingerprint:'a'.repeat(64)}:{})}}),409);assert.match(response.error,/원문에 연결된 재질/);assert.equal(h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(f.id).payload,before);}
  }
  h.sqlite.prepare('UPDATE translation_jobs SET result=? WHERE id=?').run(stored.result,stored.id);
  const current=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(f.id).payload);
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:current.revision,patch:{seo:{title:'직접 검토한 상품명',keywords:['직접검토']},label:{material:'직접 확인한 재질'}}}}),200);
  const manual=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(f.id).payload);assert.equal(manual.seo.title.value,'직접 검토한 상품명');assert.equal(manual.label.material.value,'직접 확인한 재질');assert.equal(manual.label.material.provenance,'manual');
  const quote=await json(await h.route(base+'/quotation-fields?profileId=cat'),200);assert.ok(quote.resolved.rows.length);assert.ok(quote.resolved.rows.every(row=>row.fields.title.value==='직접 검토한 상품명'));
  await json(await h.route(base+'/translation-apply',{method:'POST',body:{action:'preview',jobId:stored.id,expectedVersion:version(),scope:'all'}}),409);
  assert.equal(h.sqlite.prepare('SELECT result FROM translation_jobs WHERE id=?').get(stored.id).result,stored.result);assert.equal(calls,2,'no extra provider request for apply checks or manual edit');
 }finally{h.close();}
});
