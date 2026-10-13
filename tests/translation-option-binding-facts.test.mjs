import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const h=mobileIntakeHarness(),evidence=h.load('app/translation-attribute-evidence.ts'),model=h.load('app/automation/translation.ts');
test.after(()=>h.close());
const plain=value=>JSON.parse(JSON.stringify(value));
const source=attributes=>({title:'收纳篮',description:'收纳篮商品说明',attributes,provenance:'manual',reference:'local synthetic facts'});
const draft=attributes=>({title:'수납 바스켓',description:'수납 바스켓 상품 설명',keywords:['수납'],attributes,warnings:[]});

test('local option binding names never supply numbers, while real attribute names keep their facts',()=>{
 for(const name of ['option:collected-1','option-color:row12','option-size:SKU68']){
  assert.equal(evidence.translationAttributeFactText({name,value:'红色'}),'红色');
  assert.equal(evidence.translationAttributeIssue({name,value:'红色'},{name,value:'빨강'}),null,'returned routing name is also not a product fact');
  const number=name.match(/\d+/)[0];
  assert.equal(evidence.translationAttributeIssue({name,value:'红色'},{name:'옵션',value:`빨강 ${number}cm`}), 'foreign-number');
 }
 for(const [name,value]of [['상품속성: IP68等级','防水'],['상품속성: option-color:collected-1','红色']]){
  assert.equal(evidence.translationAttributeFactText({name,value}),`${name} ${value}`);
 }
});

test('actual option-value numbers and code literals remain valid independently of their local IDs',()=>{
 const pair={name:'option-size:collected-1',value:'12 cm / 型号 005'};
 assert.equal(evidence.translationAttributeIssue(pair,{name:'사이즈',value:'12 cm / 모델 005'}),null);
 for(const value of ['1 cm / 모델 005','12 cm / 모델 5','12 cm / 모델 006'])
  assert.equal(evidence.translationAttributeIssue(pair,{name:'사이즈',value}),'foreign-number');
 assert.equal(evidence.translationAttributeIssue({name:'option:SKU68',value:'IP68'},{name:'옵션',value:'IP68'}),null);
});

test('internal option IDs cannot substantiate extra numbers in SEO title, description or keywords',()=>{
 const input=source([{name:'option:collected-1',value:'红色'}]),base=draft([{sourceIndex:0,name:'옵션',value:'빨강'}]),before=JSON.stringify({input,base});
 for(const key of ['title','description','keywords']){
  const output=structuredClone(base);output[key]=key==='keywords'?['수납','1cm']:`${output[key]} 1cm`;
  assert.throws(()=>model.validateTranslationDraft(output,input,'sourceflow-translation-v6'),/원문에 없는 숫자/);
 }
 assert.equal(JSON.stringify({input,base}),before);
 assert.equal(model.validateTranslationDraft(base,input,'sourceflow-translation-v6').title,base.title);
});

test('one rejected binding number leaves useful SEO and other option values as a partial draft',()=>{
 const input=source([{name:'option:collected-1',value:'红色'},{name:'option-color:collected-1',value:'红色'},{name:'option-size:collected-1',value:'大型'}]);
 const output=draft([{sourceIndex:0,name:'option:collected-1',value:'빨강'},{sourceIndex:1,name:'색상',value:'빨강 1cm'},{sourceIndex:2,name:'사이즈',value:'대형'}]);
 const before=JSON.stringify({input,output}),accepted=model.validateTranslationDraft(output,input,'sourceflow-translation-v6');
 assert.equal(accepted.title,output.title);assert.equal(accepted.description,output.description);assert.deepEqual(plain(accepted.keywords),output.keywords);
 assert.deepEqual(plain(accepted.attributes.map(item=>item.sourceIndex)),[0,2]);
 assert.deepEqual(plain(model.translationAttributeCoverage(input,accepted)),{expected:3,returned:2,missingSourceIndexes:[1]});
 assert.match(accepted.warnings.join(' '),/원문에 없는 숫자.*1개/);assert.match(accepted.warnings.join(' '),/누락 1개/);
 assert.equal(JSON.stringify({input,output}),before);
});

test('namespaced seller facts such as IP68 and real numeric attribute names remain usable',()=>{
 const input=source([{name:'상품속성: IP68等级',value:'防水'},{name:'상품속성: option-color:collected-1',value:'红色'}]);
 const output=draft([{sourceIndex:0,name:'IP68 등급',value:'방수 등급 68'},{sourceIndex:1,name:'판매자 속성 1',value:'빨강 1'}]);
 output.description='수납 바스켓 상품 설명 · 원문 IP68 등급은 판매자 기재값입니다.';
 const accepted=model.validateTranslationDraft(output,input,'sourceflow-translation-v6');
 assert.deepEqual(plain(accepted.attributes),output.attributes);assert.equal(accepted.description,output.description);
});

test('coverage of a previously stored draft does not count routing-ID numbers as translated facts',()=>{
 const input=source([{name:'option-color:collected-1',value:'红色'},{name:'option-size:collected-1',value:'大型'}]);
 const output=draft([{sourceIndex:0,name:'색상',value:'빨강 1cm'},{sourceIndex:1,name:'사이즈',value:'대형'}]),before=JSON.stringify({input,output});
 assert.deepEqual(plain(model.translationAttributeCoverage(input,output)),{expected:2,returned:1,missingSourceIndexes:[0]});
 assert.equal(JSON.stringify({input,output}),before,'coverage only reads the saved result');
});

test('free Google translation omits only the unsupported option value without sending its local IDs',async()=>{
 const input=source([{name:'option-color:collected-1',value:'红色'},{name:'option-size:collected-1',value:'大型'}]),queries=[];
 const translations=new Map([[input.title,'수납 바스켓'],[input.description,'수납 바스켓 상품 설명'],['红色','빨강 1cm'],['大型','대형']]);
 const response=await h.load('app/automation/google-translation-draft.ts').buildGoogleTranslationDraft(input,async target=>{
  const url=new URL(target),q=url.searchParams.get('q');queries.push(q);assert.equal(url.origin,'https://translate.googleapis.com');
  assert.ok(!q.includes('collected-'),'routing identities stay local');
  const translate=text=>{assert.ok(translations.has(text),text);return translations.get(text);};
  const text=q.startsWith('[[YFTR')?q.split('\n').map(line=>{const match=/^(\[\[YFTR\d{6}\]\]) (.+)$/u.exec(line);assert.ok(match);return `${match[1]} ${translate(match[2])}`;}).join('\n'):translate(q);
  return Response.json([[[text,q]],null,'zh-CN']);
 });
 assert.ok(queries.length>0);assert.equal(response.draft.title,'수납 바스켓');assert.equal(response.draft.description,'수납 바스켓 상품 설명');
 assert.deepEqual(plain(response.draft.attributes.map(item=>item.sourceIndex)),[1]);
 const accepted=model.validateTranslationDraft(response.draft,input,'sourceflow-translation-v6');assert.equal(accepted.title,response.draft.title);assert.deepEqual(plain(accepted.attributes.map(item=>item.sourceIndex)),[1]);
});
