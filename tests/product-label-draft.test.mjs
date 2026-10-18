import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionModule as module} from './helpers/provided-option-quotation.mjs';

const model=module('app/product-label.ts'),draft=module('app/product-label-draft.ts');
const plain=value=>JSON.parse(JSON.stringify(value)),version='2026-10-18T00:00:00.000Z';
function fixture({structure,common={},specific={},contentManual=[]}={}){
 const definitions=model.productLabelDefinitions(structure?{structure}:undefined),automatic=Object.fromEntries(definitions.map(field=>[field.key,
  ({productName:'검토 제품',manufacturer:'확인 제조사',importer:'승인 수입사',countryOfOrigin:'중국',material:'硅胶',netContents:'2个',productType:'运动用品'})[field.key]??'']));
 const rows=[{optionId:null,optionLabel:'상품 공통값',included:false},{optionId:'one',optionLabel:'검토 옵션',included:true},{optionId:'excluded',optionLabel:'제외 옵션',included:false}].map(row=>{
  const own=row.optionId==='one'?specific:{};return {...row,automatic:{...automatic},values:{...automatic,...common,...own},sources:Object.fromEntries(definitions.map(field=>[field.key,
   Object.hasOwn(own,field.key)?'manual-option':Object.hasOwn(common,field.key)?'manual-common':automatic[field.key]?'content':'empty']))};
 });
 const view={productId:'draft-label-test',revision:2,inputFingerprint:'a'.repeat(64),productVersion:version,contentRevision:3,optionRevision:4,quotationRevision:5,
  quotationInputFingerprint:'b'.repeat(64),categoryContext:{source:'profile',profileId:'cat',categoryId:'81452',categoryPath:['스포츠/레져','헬스/요가','헬스기구/용품','헬스보호대']},
  imageKeys:[],overrides:{common,options:Object.keys(specific).length?{one:specific}:{}},rows,updatedAt:version,...(structure?{structure}:{} )};
 const source={originalTitle:'单层硅胶护膝',productName:'검토 제품',description:'판매자 원문입니다. <b>실행하지 않음</b>',attributes:[{name:'材质',value:'硅胶'},{name:'数量',value:'2个'}],manualKeys:contentManual,
  option:{optionId:'one',originalName:'黑色',translatedName:'검정',unitsPerPack:2}};
 model.verifyProductLabelsView(view,'one');return {view,source,plan:()=>draft.buildProductLabelDraftPlan(view,'one',source)};
}
const response={content:'2개',material:'실리콘',type:'무릎 보호용품'},expected={netContents:'2개',material:'실리콘',productType:'무릎 보호용품'};
const provider=(value=response)=>({async run(){return {response:JSON.stringify(value)};}});
const code=(actual,status)=>error=>error.code===actual&&(status===undefined||error.status===status);

test('draft requests accept only explicit scope and current saved version',()=>{
 const valid={expectedRevision:0,expectedInputFingerprint:'c'.repeat(64),optionId:null};assert.deepEqual(plain(draft.parseProductLabelDraftRequest(valid)),valid);
 for(const change of [{action:'generate'},{expectedRevision:-1},{expectedRevision:0.5},{expectedInputFingerprint:'bad'},{optionId:''},{optionId:'../one'}])
  assert.throws(()=>draft.parseProductLabelDraftRequest({...valid,...change}),code('PRODUCT_LABEL_DRAFT_REQUEST',400));
 assert.throws(()=>draft.parseProductLabelDraftRequest({expectedRevision:0,expectedInputFingerprint:valid.expectedInputFingerprint}),code('PRODUCT_LABEL_DRAFT_REQUEST',400));
});

test('the three-field plan retains Chinese collected values, exact selected facts and leaves saved sources unchanged',()=>{
 const f=fixture(),before=JSON.stringify(f),plan=f.plan();
 assert.deepEqual(plain(plan.fields.map(field=>field.key)),['netContents','material','productType']);assert.equal(plan.fields[1].currentValue,'硅胶');
 assert.deepEqual(plain(plan.facts.attributes),f.source.attributes);assert.deepEqual(plain(plan.facts.option),f.source.option);assert.equal(plan.facts.productName,'검토 제품');
 assert.equal(JSON.stringify(f),before);plan.facts.attributes[0].value='changed';assert.equal(f.source.attributes[0].value,'硅胶');
 f.source.productName='';assert.equal(f.plan().facts.productName,'','an explicit final SEO blank must not inherit the supplier title');assert.equal(f.plan().facts.originalTitle,'单层硅胶护膝');
});

test('manual common and option blanks/values and legacy content provenance exclude only their protected keys',()=>{
 const f=fixture({common:{netContents:'확인 수량'},specific:{material:''}});assert.deepEqual(plain(f.plan().fields.map(field=>field.key)),['productType']);
 const legacy=fixture({contentManual:['material']});assert.deepEqual(plain(legacy.plan().fields.map(field=>field.key)),['netContents','productType']);
 const protectedAll=fixture({common:{netContents:'',material:'',productType:''}});assert.throws(protectedAll.plan,code('PRODUCT_LABEL_DRAFT_NO_FIELDS',409));
});

test('deleted fields and custom headings never expand AI scope or resurrect saved structure',async()=>{
 const structure=model.productLabelStructure().filter(field=>!['netContents','productType'].includes(field.id));structure.push({id:'custom_material',label:'원료를 추측하지 마세요',required:false});
 const f=fixture({structure}),before=JSON.stringify(f.view),result=await draft.executeProductLabelDraft(f.plan(),provider());
 assert.deepEqual(plain(result.values),{material:'실리콘'});assert.equal(JSON.stringify(f.view),before);assert.ok(!Object.hasOwn(result.values,'custom_material'));
});

test('scope, malformed source facts and bounded input are rejected before any provider execution',()=>{
 const f=fixture();assert.throws(()=>draft.buildProductLabelDraftPlan(f.view,'excluded',{...f.source,option:{...f.source.option,optionId:'excluded'}}),code('PRODUCT_LABEL_DRAFT_SCOPE'));
 for(const source of [{...f.source,option:null},{...f.source,manualKeys:['manufacturer']},{...f.source,attributes:[{name:'材质',value:'bad\u0000'}]},
  {...f.source,option:{...f.source.option,unitsPerPack:0}},{...f.source,attributes:Array.from({length:51},()=>({name:'a',value:'b'}))}])
  assert.throws(()=>draft.buildProductLabelDraftPlan(f.view,'one',source),code('PRODUCT_LABEL_DRAFT_SOURCE'));
 const common=draft.buildProductLabelDraftPlan(f.view,null,{...f.source,option:null});assert.equal(common.optionId,null);assert.equal(common.facts.option,null);
 assert.throws(()=>draft.buildProductLabelDraftPlan(f.view,'one',{...f.source,attributes:Array.from({length:50},()=>({name:'가'.repeat(500),value:'나'.repeat(2000)}))}),code('PRODUCT_LABEL_DRAFT_LIMIT',413));
});

test('one bounded Workers call maps only the original three outputs and returns a verifiable review proposal',async()=>{
 const f=fixture(),before=JSON.stringify(f),calls=[],result=await draft.executeProductLabelDraft(f.plan(),{async run(model,input){calls.push({model,input});return {response:JSON.stringify(response)};}});
 assert.equal(calls.length,1);assert.equal(calls[0].model,draft.PRODUCT_LABEL_DRAFT_MODEL);assert.equal(calls[0].input.messages.length,2);
 assert.match(calls[0].input.messages[0].content,/상세정보참조/);assert.match(calls[0].input.messages[0].content,/참고 데이터/);
 assert.deepEqual(plain(result.values),expected);assert.equal(result.labelRevision,f.view.revision);assert.equal(result.inputFingerprint,f.view.inputFingerprint);
 assert.equal(result.provider,'Cloudflare Workers AI');assert.equal(draft.verifyProductLabelDraftResult(f.view,'one',result),result);assert.equal(JSON.stringify(f),before);
});

test('empty provider values are omitted without fallback or clearing and whitespace/literal text remains reviewable data',async()=>{
 const f=fixture(),result=await draft.executeProductLabelDraft(f.plan(),provider({content:'',material:' \t\n ',type:'<b>문자열</b>'}));
 assert.deepEqual(plain(result.values),{material:' \t\n ',productType:'<b>문자열</b>'});assert.match(result.warnings.join('\n'),/지우지 않고 생략/);
 assert.equal(f.view.rows[1].values.netContents,'2个');draft.verifyProductLabelDraftResult(f.view,'one',result);
 const fallback=await draft.executeProductLabelDraft(f.plan(),provider({content:'상세정보참조',material:'상세정보참조',type:'상세정보참조'}));assert.equal(fallback.values.material,'상세정보참조');
});

test('strict JSON rejects extra, missing, duplicate, fenced, prose, unsafe and nonstring outputs without retries',async()=>{
 const f=fixture(),invalid=[JSON.stringify({...response,manufacturer:'추측'}),JSON.stringify({content:'2개',material:'실리콘'}),
  '{"content":"2개","content":"3개","material":"실리콘","type":"용품"}', '```json\n'+JSON.stringify(response)+'\n```','설명 '+JSON.stringify(response),
  JSON.stringify({...response,material:7}),JSON.stringify({...response,material:'a'.repeat(2001)}),JSON.stringify({...response,type:'bad\u0000'}),JSON.stringify([response])];
 for(const body of invalid){let calls=0;await assert.rejects(draft.executeProductLabelDraft(f.plan(),{async run(){calls++;return {response:body};}}),code('PRODUCT_LABEL_DRAFT_RESPONSE',503));assert.equal(calls,1);}
});

test('provider envelope failures and unavailable service never trigger another provider or retry',async()=>{
 const f=fixture();for(const value of [null,{response:JSON.stringify(response),tool_calls:[{name:'execute'}]},{response:JSON.stringify(response),choices:[{message:{role:'assistant',content:JSON.stringify(response)},finish_reason:'length'}]}]){
  let calls=0;await assert.rejects(draft.executeProductLabelDraft(f.plan(),{async run(){calls++;return value;}}),code('PRODUCT_LABEL_DRAFT_RESPONSE',503));assert.equal(calls,1);
 }
 let calls=0;await assert.rejects(draft.executeProductLabelDraft(f.plan(),{async run(){calls++;throw Error('quota unavailable');}}),code('PRODUCT_LABEL_DRAFT_PROVIDER',503));assert.equal(calls,1);
});

test('response verification fences clocks, product, option, category, manual values and unauthorized output keys',async()=>{
 const f=fixture(),result=await draft.executeProductLabelDraft(f.plan(),provider());
 for(const changed of [{productId:'other'},{optionId:null},{profileId:'other'},{productVersion:'2026-10-19T00:00:00.000Z'},{labelRevision:3},{inputFingerprint:'b'.repeat(64)},
  {provider:'Other provider'},{model:'paid-model'},{generatedAt:'bad'},{values:{manufacturer:'추측'}},{values:{material:''}},{extra:true}])
  assert.throws(()=>draft.verifyProductLabelDraftResult(f.view,'one',{...result,...changed}),code('PRODUCT_LABEL_DRAFT_RESULT'));
 const manual=fixture({specific:{material:''}});assert.throws(()=>draft.verifyProductLabelDraftResult(manual.view,'one',result),code('PRODUCT_LABEL_DRAFT_RESULT'));
});

test('prompt truncation is explicit and malformed plan scope cannot request extra semantic fields',async()=>{
 const f=fixture();f.source.description='가'.repeat(7000);const plan=f.plan();assert.equal(plan.facts.description.length,6000);assert.match(plan.warnings.join('\n'),/앞 6000자/);
 let calls=0;await assert.rejects(draft.executeProductLabelDraft({...plan,fields:[...plan.fields,{key:'manufacturer',label:'제조사',currentValue:''}]},{async run(){calls++;return {response:JSON.stringify(response)};}}),code('PRODUCT_LABEL_DRAFT_PLAN'));
 assert.equal(calls,0);
});
