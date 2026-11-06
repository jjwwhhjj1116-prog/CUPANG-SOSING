import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
const api=providedOptionModule('app/seo-current-validation.ts'),plain=value=>JSON.parse(JSON.stringify(value));
const original=()=>({draft:{title:'양말',description:'',keywords:['양말'],attributes:[{sourceIndex:7,name:'소재',value:'면'}],warnings:[]},seoOptions:[{optionId:'nonleading-z',name:'흰색 양말'}],model:'inert',responseId:'one',usage:null,generatedAt:'now',provenance:'generated',appliedToContent:false});
const review={seoComposition:{version:'couplus-current-composition-v1'}};
test('known-response validation restores mismatched attribute/option multisets while accepting valid title',async()=>{
 const before=original(),result=await api.validateKnownSeoResponse(review,before,async draft=>({...draft,title:'면 양말',attributes:[{sourceIndex:8,name:'소재',value:'면'}],seoOptions:[{optionId:'foreign',name:'양말'}]}),raw=>({...before,draft:{title:raw.title,description:raw.description,keywords:raw.keywords,attributes:raw.attributes,warnings:raw.warnings},seoOptions:raw.seoOptions}));
 assert.equal(result.draft.title,'면 양말');assert.deepEqual(plain(result.draft.attributes),before.draft.attributes);assert.deepEqual(plain(result.seoOptions),before.seoOptions);assert.equal(result.draft.warnings.length,2);
});
test('one additional Han pass is bounded, and validation transport failure never retries or discards known draft',async()=>{
 const before=original();let calls=0;const result=await api.validateKnownSeoResponse(review,before,async draft=>({...draft,title:++calls===1?'白色 양말':'흰색 양말'}),raw=>({...before,draft:{...before.draft,title:String(raw.title).replace('白色','흰색')}}));assert.equal(calls,2);assert.equal(result.draft.title,'흰색 양말');
 calls=0;const fallback=await api.validateKnownSeoResponse(review,before,async()=>{calls++;throw Error('unknown validation provider outcome');},raw=>({...before,draft:{...before.draft,warnings:raw.warnings}}));assert.equal(calls,1);assert.equal(fallback.draft.title,before.draft.title);assert.equal(fallback.draft.warnings.length,1);
 calls=0;assert.equal(await api.validateKnownSeoResponse({},before,async()=>{calls++;},()=>{}),before);assert.equal(calls,0);
});
