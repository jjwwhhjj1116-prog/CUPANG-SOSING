import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
const model='@cf/qwen/qwen3-30b-a3b-fp8',source={title:'硅胶后跟贴',description:'硅胶后跟保护垫',attributes:[{name:'option:collected-0',value:'黑色'},{name:'option-color:collected-1',value:'粉色'},{name:'option-size:collected-2',value:'均码'}],provenance:'manual',reference:'synthetic-v5'};
const draft={title:'실리콘 뒤꿈치 보호 패드',description:'실리콘 뒤꿈치 보호 패드',keywords:['뒤꿈치 패드'],attributes:[{sourceIndex:0,name:'黑色',value:'검정'},{sourceIndex:1,name:'粉色',value:'분홍'},{sourceIndex:2,name:'均码',value:'공용 크기'}],warnings:[]};
const review=version=>({model,maxOutputTokens:2048,instructionsVersion:'sourceflow-translation-v6',destination:'Cloudflare Workers AI',source,workersRecovery:{version,model,failedJobId:'00000000-0000-4000-8000-000000000005',scope:'collected',optionRevision:1,sourceFingerprint:'a'.repeat(64),company:{code:'A01464742',name:'와이홉'}}});
test('v5 canonicalizes only source-bound option metadata names, preserving originals, values, old contracts and malformed identities',()=>{
 const h=mobileIntakeHarness();try{const q=h.load('app/product-translation-quality.ts'),before=JSON.stringify(draft),result=q.canonicalizeWorkersRecoveryOptionMetadata(review(5),draft);
  assert.deepEqual(Array.from(result.attributes,row=>row.name),['옵션명','색상','사이즈']);assert.deepEqual(Array.from(result.attributes,row=>row.value),['검정','분홍','공용 크기']);assert.equal(JSON.stringify(draft),before);assert.doesNotThrow(()=>q.assertWorkersRecoveryDraftQuality(review(5),result));
  for(const version of [2,3,4]){assert.equal(q.canonicalizeWorkersRecoveryOptionMetadata(review(version),draft),draft);assert.throws(()=>q.assertWorkersRecoveryDraftQuality(review(version),draft),error=>error.code==='RECOVERY_UNTRANSLATED_TEXT'&&/attributes\[0\]\.name/.test(error.message));}
  for(const name of ['상품속성: option:collected-0','option:黑色','option:','option-unknown:x'])assert.equal(q.workersRecoveryOptionMetadataLabel(name),null);
  const real={...review(5),source:{...source,attributes:[{name:'材质',value:'硅胶'}]}},ordinary={...draft,attributes:[{sourceIndex:0,name:'材质',value:'실리콘'}]};assert.equal(q.canonicalizeWorkersRecoveryOptionMetadata(real,ordinary).attributes[0].name,'材质');assert.throws(()=>q.assertWorkersRecoveryDraftQuality(real,ordinary),error=>error.code==='RECOVERY_UNTRANSLATED_TEXT');
  const bad={...draft,attributes:[{sourceIndex:99,name:'黑色',value:'검정'}]};assert.equal(q.canonicalizeWorkersRecoveryOptionMetadata(review(5),bad).attributes[0].name,'黑色');assert.throws(()=>q.assertWorkersRecoveryDraftQuality(review(5),bad),error=>error.code==='RECOVERY_INVALID_SOURCE');
 }finally{h.close();}
});
test('quality diagnostics identify fixed fields and indexes without recording raw source or response text',()=>{
 const h=mobileIntakeHarness();try{const q=h.load('app/product-translation-quality.ts'),good=q.canonicalizeWorkersRecoveryOptionMetadata(review(5),draft);
  for(const [location,change]of [['title',value=>value.title='PRIVATE_RAW_色'],['description',value=>value.description='PRIVATE_RAW_色'],['keywords[0]',value=>value.keywords[0]='PRIVATE_RAW_色'],['attributes[0].value',value=>value.attributes[0].value='PRIVATE_RAW_𠀀']]){const value=structuredClone(good);change(value);assert.throws(()=>q.assertWorkersRecoveryDraftQuality(review(5),value),error=>error.code==='RECOVERY_UNTRANSLATED_TEXT'&&error.message.includes('위치 '+location)&&!error.message.includes('PRIVATE_RAW'));}
 }finally{h.close();}
});
test('v5 JSON schema binds each source index to its metadata label and constrains translated text; v4 remains unchanged',()=>{
 const h=mobileIntakeHarness();try{const api=h.load('app/automation/translation.ts'),request=api.buildTranslationRequest(review(5)),schema=request.text.format.schema,input=JSON.parse(request.input[0].content[0].text);
  for(const field of ['title','description']){assert.equal(new RegExp(schema.properties[field].pattern,'u').test('한국어 제품'),true);assert.equal(new RegExp(schema.properties[field].pattern,'u').test('검정色'),false);}
  assert.equal(new RegExp(schema.properties.keywords.items.pattern,'u').test('黑色'),false);assert.deepEqual(Array.from(schema.properties.attributes.items.anyOf,item=>item.properties.name.enum[0]),['옵션명','색상','사이즈']);assert.deepEqual(Array.from(schema.properties.attributes.items.anyOf,item=>item.properties.sourceIndex.enum[0]),[0,1,2]);assert.deepEqual(input.attributes.map(row=>row.outputName),['옵션명','색상','사이즈']);assert.equal(JSON.stringify(source).includes('outputName'),false);
  const old=api.buildTranslationRequest(review(4));assert.equal(old.text.format.schema.properties.title.pattern,undefined);assert.equal(JSON.parse(old.input[0].content[0].text).attributes[0].outputName,undefined);
 }finally{h.close();}
});
test('actual v5 execution accepts Korean option values despite echoed display names, sends exact labels, and rejects copied values without retry',async()=>{
 const h=mobileIntakeHarness();try{const api=h.load('app/automation/translation.ts');let calls=0,lastInput;
  const config={provider:'workers-ai',apiKey:'',model,maxOutputTokens:2048,ai:{run:async(_model,input)=>{calls++;lastInput=input;return{object:'chat.completion',model,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(draft)}}]};}}};
  const result=await api.executeTranslation(review(5),config);assert.equal(calls,1);assert.deepEqual(Array.from(result.draft.attributes,row=>row.name),['옵션명','색상','사이즈']);assert.equal(result.appliedToContent,false);assert.match(lastInput.messages[0].content,/outputName/);assert.equal(lastInput.response_format.json_schema.properties.attributes.items.anyOf[0].properties.name.enum[0],'옵션명');
  const copied=structuredClone(draft);copied.attributes[0].value='검정色';config.ai.run=async()=>{calls++;return{object:'chat.completion',model,choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(copied)}}]};};await assert.rejects(()=>api.executeTranslation(review(5),config),error=>error.code==='RECOVERY_UNTRANSLATED_TEXT'&&/attributes\[0\]\.value/.test(error.message));assert.equal(calls,2);
 }finally{h.close();}
});
