import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';

const {sizeChartRequiredFromSchemaString:required,readRegistrationLayout:read}=providedOptionModule('app/registration-layout.ts');
const clock='2026-10-20T00:00:00.000Z';
const layout=(context={source:'collection',profileId:'captured-profile',categoryId:'991234',categoryPath:['시험','분류']})=>({format:'yoofam-registration-layout-v1',productId:'p',productVersion:clock,categoryContext:context,sizeChartRequired:true});
const raw=required=>JSON.stringify({properties:{imagePage:{properties:{images:{properties:{sizeChartImage:{type:['string','null']}},...(required===undefined?{}:{required})}}}}});

test('the direct original image-page required array alone selects the size-chart step',()=>{
 assert.equal(required(raw(['sizeChartImage'])),true);
 assert.equal(required(raw(['mainImage','sizeChartImage','detailImages'])),true);
 for(const list of [undefined,[],['mainImage'],['SizeChartImage'],['sizeImages'],['sizeChartImage-extra']])assert.equal(required(raw(list)),false);
 assert.equal(required(JSON.stringify({properties:{imagePage:{properties:{images:{properties:{},required:['sizeChartImage']}}}}})),true,'the original checks the images.properties container, not a guessed property definition');
 assert.equal(required(JSON.stringify({properties:{imagePage:{properties:{images:{required:['sizeChartImage']}}}}})),false,'the original also requires the properties container');
});

test('malformed or differently nested schema never guesses requirement from category, image, defaults, allOf or nullable type',()=>{
 for(const value of [undefined,null,0,{},'', '{', 'null','[]',raw('sizeChartImage'),raw([1,'sizeChartImage']),raw({includes:true}),JSON.stringify({category:'의류 사이즈표 필수',sizeChartImage:'saved.png',required:['sizeChartImage']}),JSON.stringify({allOf:[JSON.parse(raw(['sizeChartImage']))]}),JSON.stringify({properties:{imagePage:{properties:{images:{properties:{sizeChartImage:{default:'required'}}}}}}})])assert.equal(required(value),false,JSON.stringify(value));
});

test('response validation binds product and exact clock, explicit profile and implicit captured category without changing input',()=>{
 const implicit=layout(),before=JSON.stringify(implicit),result=read(implicit,'p',clock);
 assert.equal(result.sizeChartRequired,true);assert.equal(result.categoryContext.profileId,'captured-profile');assert.equal(JSON.stringify(implicit),before);
 result.categoryContext.categoryPath.push('local');assert.equal(implicit.categoryContext.categoryPath.length,2,'response arrays are copied');
 const explicit=layout({...implicit.categoryContext,source:'profile'});assert.equal(read(explicit,'p',clock,'captured-profile').categoryContext.source,'profile');
 const unknown={...layout({source:'unknown',profileId:null,categoryId:null,categoryPath:[]}),sizeChartRequired:false};assert.equal(read(unknown,'p',clock).sizeChartRequired,false);
});

test('foreign, stale, unscoped, malformed and unknown response fields reject instead of silently changing stages',()=>{
 const cases=[value=>{value.productId='other';},value=>{value.productVersion='2026-10-20T00:00:00.001Z';},value=>{value.format='other';},value=>{value.sizeChartRequired='true';},value=>{value.extra=true;},value=>{value.categoryContext.source='profile';},value=>{value.categoryContext.profileId='bad/id';},value=>{value.categoryContext.categoryId='0';},value=>{value.categoryContext.categoryPath=[];},value=>{value.categoryContext.categoryPath=[' bad'];},value=>{value.categoryContext.extra='ignored';},value=>{delete value.categoryContext.source;}];
 for(const change of cases){const value=layout();change(value);assert.throws(()=>read(value,'p',clock));}
 assert.throws(()=>read(layout(),'p',clock,'captured-profile'));
 assert.throws(()=>read(layout({...layout().categoryContext,source:'profile'}),'p',clock,'foreign-profile'));
 assert.throws(()=>read(layout(),'p','bad-clock'));assert.throws(()=>read(layout(),'p',clock,''));
 assert.throws(()=>read({...layout({source:'unknown',profileId:null,categoryId:null,categoryPath:[]})},'p',clock));
});

test('response property getters are rejected without executing them',()=>{
 const value=layout();let calls=0;Object.defineProperty(value,'sizeChartRequired',{enumerable:true,get(){calls++;return true;}});
 assert.throws(()=>read(value,'p',clock));assert.equal(calls,0);
 const context=layout();Object.defineProperty(context.categoryContext,'categoryPath',{enumerable:true,get(){calls++;return ['foreign'];}});
 assert.throws(()=>read(context,'p',clock));assert.equal(calls,0);
});
