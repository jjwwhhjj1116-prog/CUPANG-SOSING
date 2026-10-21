import test from 'node:test';
import assert from 'node:assert/strict';
import {quotationTitleUI,titleText} from './helpers/quotation-seo-title-ui.mjs';
import {nativeReviewFixture,companies,plain,json} from './helpers/native-source-review.mjs';

const field=(id,type='text',extra={})=>({id,type,section:'product',visibility:'common',label:id,required:false,...extra});
function fixture(fields=[field('model','text',{maxLength:50}),field('searchTags','textarea',{maxLength:150}),field('manufacturer','text',{maxLength:500})],values={}){
 const schema={version:1,categoryId:'81452',categoryPath:['합성','입력 검수'],status:'observed',evidence:'synthetic',fields,submissionReady:false};
 const rows=[null,'red','blue'].map(optionId=>({optionId,optionLabel:optionId??'상품 공통',included:optionId!==null,fields:Object.fromEntries(fields.map(item=>[item.id,{value:values[item.id]??'',source:'content',issues:[],validationIssues:[],needsReview:false}]))}));
 return {revision:1,inputFingerprint:'a'.repeat(64),overrides:{common:{},options:{}},resolved:{schema,rows,issues:[]},automatic:{schema:plain(schema),rows:plain(rows),issues:[]},imageKeys:[],submissionReady:false,
  categoryContext:{source:'collection',profileId:null,categoryId:'81452',categoryPath:schema.categoryPath},productVersion:'2026-10-21T00:00:00.000Z',contentRevision:1,optionRevision:1,updatedAt:null};
}
const counter=(ui,id)=>ui.nodes().find(node=>node.props?.id==='seo-title-test-'+id+'-length');
const closedAncestors=(node,id,closed=[])=>Array.isArray(node)?node.flatMap(child=>closedAncestors(child,id,closed)):node&&typeof node==='object'
 ?node.props?.id===id?[closed]:closedAncestors(node.props?.children,id,node.type==='details'&&!node.props.open?[...closed,node]:closed):[];
const tags=length=>('가,'.repeat(Math.ceil(length/2))).slice(0,length);
const ready=async(ui,predicate,description)=>{const deadline=Date.now()+15000;while(!predicate()){assert.ok(Date.now()<deadline,description);await ui.idle();await new Promise(resolve=>setTimeout(resolve,2));}};

test('model and search tag controls expose the observed bounds and visible raw-length thresholds without a write or truncation',async()=>{
 const view=fixture(),before=JSON.stringify(view),ui=quotationTitleUI({view});
 try{
  await ui.idle();assert.equal(ui.field('model').props.maxLength,50);assert.equal(ui.field('searchTags').props.maxLength,150);assert.equal(ui.field('searchTags').type,'textarea');assert.equal(ui.field('searchTags').props.rows,3);
  assert.equal(ui.field('searchTags').props.placeholder,'검색 태그를 쉼표(,)로 구분하여 입력하세요');
  for(const [id,boundaries,limit]of [['model',[[0,'normal'],[40,'normal'],[41,'warning'],[45,'warning'],[46,'danger'],[50,'danger'],[51,'danger']],50],['searchTags',[[120,'normal'],[121,'warning'],[140,'warning'],[141,'danger'],[150,'danger'],[151,'danger']],150]]){
   for(const [length,state]of boundaries){const raw='가'.repeat(length);ui.field(id).props.onChange({target:{value:raw}});ui.render();
    assert.equal(ui.field(id).props.value,raw);assert.equal(counter(ui,id).props['data-quotation-length-state'],state);assert.equal(counter(ui,id).props['data-quotation-length-role'],id);assert.equal(titleText(counter(ui,id)),`${length}/${limit}자`);
    assert.match(ui.field(id).props['aria-describedby'],new RegExp('seo-title-test-'+id+'-length'));assert.deepEqual(plain(closedAncestors(ui.render(),'seo-title-test-'+id+'-length')),[[]]);
   }
  }
  ui.field('model').props.onChange({target:{value:'🙂'.repeat(26)}});ui.render();assert.equal(titleText(counter(ui,'model')),'52/50자');assert.equal(ui.field('model').props.value,'🙂'.repeat(26));
  assert.equal(ui.field('manufacturer').props.maxLength,undefined);assert.equal(counter(ui,'manufacturer'),undefined);assert.equal(ui.calls.some(call=>call.init?.method),false);assert.equal(JSON.stringify(view),before);
 }finally{ui.close();}
});

test('only canonical identities or exact unnamed Hub wires receive these control limits; same-label, named, workbook and conflicting wires keep their existing inputs',async()=>{
 const fields=[
  field('native-model','text',{label:'다른 표시 이름',hubInput:'model',hubWire:{path:['productPage','modelNumber']},maxLength:80}),
  field('native-tags','text',{label:'다른 표시 이름',hubInput:'searchTags',hubWire:{path:['productPage','searchTags']},maxLength:200}),
  field('same-model','text',{label:'모델명',maxLength:12}),field('same-tags','text',{label:'검색태그',maxLength:12}),
  field('named-model','text',{hubInput:'model',hubWire:{path:['productPage','modelNumber'],name:'별도 값'},maxLength:12}),
  field('workbook-tags','text',{hubInput:'searchTags',hubWire:{path:['productPage','searchTags']},workbookWire:{sha256:'b'.repeat(64),sheetName:'견적',column:4,requirement:'optional'},maxLength:12}),
  field('conflicting-model','text',{hubInput:'brand',hubWire:{path:['productPage','modelNumber']},maxLength:12}),
  field('foreign-tags','text',{hubInput:'searchTags',hubWire:{path:['productPage','otherTags']},maxLength:12}),
  field('model','text',{hubWire:{path:['productPage','otherModel']},maxLength:12}),
  field('select-tags','select',{hubInput:'searchTags',hubWire:{path:['productPage','searchTags']},choices:[{value:'선택',label:'선택'}],maxLength:12}),
 ];
 const view=fixture(fields),before=JSON.stringify(view),ui=quotationTitleUI({view});try{
  await ui.idle();assert.equal(ui.field('native-model').props.maxLength,50);assert.equal(ui.field('native-tags').props.maxLength,150);assert.equal(ui.field('native-tags').type,'textarea');assert.equal(ui.field('native-tags').props.rows,3);
  for(const item of fields.slice(2).filter(item=>item.type!=='select')){const control=ui.nodes().find(node=>node.props?.id==='seo-title-test-'+item.id);assert.ok(control,item.id);assert.equal(control.props.maxLength,undefined,item.id);assert.equal(counter(ui,item.id),undefined,item.id);assert.equal(typeof control.type==='function'?control.type.name:control.type,item.id==='conflicting-model'?'QuotationBrandInput':'input');}
  assert.equal(counter(ui,'select-tags'),undefined);assert.equal(ui.calls.some(call=>call.init?.method),false);assert.equal(JSON.stringify(view),before);
 }finally{ui.close();}
});

test('stricter live schema limits and read-only inputs retain their exact value and existing edit protection',async()=>{
 const fields=[field('model','text',{maxLength:30,readOnly:true,hubInput:'model',hubWire:{path:['productPage','modelNumber']}}),field('searchTags','textarea',{maxLength:90,readOnly:true,hubInput:'searchTags',hubWire:{path:['productPage','searchTags']}})];
 const values={model:'역'.repeat(31),searchTags:tags(91)},view=fixture(fields,values),before=JSON.stringify(view),ui=quotationTitleUI({view});try{
  await ui.idle();for(const [id,limit]of [['model',30],['searchTags',90]]){assert.equal(ui.field(id).props.readOnly,true);assert.equal(ui.field(id).props.maxLength,limit);assert.equal(ui.field(id).props.value,values[id]);assert.equal(counter(ui,id).props['data-quotation-length-state'],'danger');ui.field(id).props.onChange({target:{value:'우회 수정'}});}
  assert.equal(ui.changes.length,0);assert.equal(JSON.stringify(view),before);assert.equal(ui.calls.some(call=>call.init?.method),false);
 }finally{ui.close();}
});

for(const company of companies)test(company.code+': actual quotation API preserves over-control legacy values, accepts warning-only edits and stores explicit blanks without truncating other options',async()=>{
 const f=await nativeReviewFixture(company);let ui;
 try{
  // A synthetic category intentionally permits longer values than the retained
  // Couplus control. That valid stored history must not be silently shortened.
  const stored=JSON.parse(f.h.sqlite.prepare('SELECT payload FROM category_profiles WHERE id=?').get(f.profile.id).payload),raw=JSON.parse(stored.hubSchema.schemaString);
  raw.properties.productPage.properties.modelNumber.maxLength=80;raw.properties.productPage.properties.searchTags={type:'string',title:'검색태그',maxLength:200};stored.hubSchema.schemaString=JSON.stringify(raw);
  f.h.sqlite.prepare('UPDATE category_profiles SET payload=? WHERE id=?').run(JSON.stringify(stored),f.profile.id);
  let view=await f.fields();const byPath=path=>view.resolved.schema.fields.find(item=>JSON.stringify(item.hubWire?.path)===JSON.stringify(path)&&item.hubWire.name===undefined)?.id;
  const modelId=byPath(['productPage','modelNumber']),tagsId=byPath(['productPage','searchTags']),manufacturerId=byPath(['productPage','manufacturer']);assert.ok(modelId);assert.ok(tagsId);assert.ok(manufacturerId);
  const legacy={model:'역'.repeat(61),tags:tags(171)};
  view=await json(await f.h.route(f.fieldsPath,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:modelId,optionId:'synthetic-one',value:legacy.model},{fieldKey:tagsId,optionId:'synthetic-one',value:legacy.tags}]}}));
  const optionsBefore=JSON.stringify(f.h.sqlite.prepare('SELECT * FROM product_options').all()),contentBefore=JSON.stringify(f.h.sqlite.prepare('SELECT * FROM product_content').all()),objectsBefore=f.objectState(),puts=[],responses=[];
  ui=quotationTitleUI({view,props:{productId:f.id,profileId:f.profile.id},request:async(url,init)=>{if(init?.method==='PUT')puts.push(JSON.parse(init.body));const response=await f.h.route(url,{method:init?.method??'GET',body:init?.body});if(init?.method==='PUT')responses.push(response.status);return response;}});
  const settled=async count=>{const deadline=Date.now()+15000;while(responses.length<count){assert.ok(Date.now()<deadline,'actual quotation save must finish');await ui.idle();await new Promise(resolve=>setTimeout(resolve,2));}await ui.idle();assert.equal(responses.at(-1),200);};
  await ready(ui,()=>Boolean(ui.field(modelId)),'actual quotation GET must finish before option selection');ui.select('synthetic-one');assert.equal(ui.field(modelId).props.value,legacy.model);assert.equal(ui.field(tagsId).props.value,legacy.tags);assert.equal(ui.field(modelId).props.maxLength,50);assert.equal(ui.field(tagsId).props.maxLength,150);assert.equal(puts.length,0);
  ui.field(manufacturerId).props.onChange({target:{value:'검수한 제조사'}});ui.render();ui.button('견적 입력 저장').props.onClick();await settled(1);
  assert.deepEqual(puts[0].changes,[{fieldKey:manufacturerId,optionId:'synthetic-one',value:'검수한 제조사'}]);assert.equal(ui.field(modelId).props.value,legacy.model);assert.equal(ui.field(tagsId).props.value,legacy.tags);
  ui.field(modelId).props.onChange({target:{value:'모'.repeat(46)}});ui.field(tagsId).props.onChange({target:{value:tags(141)}});ui.render();assert.equal(counter(ui,modelId).props['data-quotation-length-state'],'danger');assert.equal(counter(ui,tagsId).props['data-quotation-length-state'],'danger');
  ui.button('견적 입력 저장').props.onClick();await settled(2);assert.deepEqual(puts[1].changes,[{fieldKey:modelId,optionId:'synthetic-one',value:'모'.repeat(46)},{fieldKey:tagsId,optionId:'synthetic-one',value:tags(141)}]);
  ui.field(modelId).props.onChange({target:{value:''}});ui.field(tagsId).props.onChange({target:{value:''}});ui.render();ui.button('견적 입력 저장').props.onClick();await settled(3);
  const saved=await f.fields();assert.equal(saved.overrides.options['synthetic-one'][modelId],'');assert.equal(saved.overrides.options['synthetic-one'][tagsId],'');assert.equal(saved.overrides.options['synthetic-one'][manufacturerId],'검수한 제조사');assert.equal(saved.overrides.options['synthetic-two']?.[modelId],undefined);assert.equal(saved.overrides.options['synthetic-two']?.[tagsId],undefined);
  assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM product_options').all()),optionsBefore);assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM product_content').all()),contentBefore);assert.equal(f.objectState(),objectsBefore);assert.deepEqual(f.h.network,[]);
 }finally{ui?.close();f.close();}
});
