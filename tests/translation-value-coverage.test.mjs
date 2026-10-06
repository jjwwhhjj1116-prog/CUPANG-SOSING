import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const json=async response=>{assert.ok(response.ok,await response.clone().text());return response.json();};
const product=h=>h.sqlite.prepare('SELECT * FROM products').get();
const options=h=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);
const content=h=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);

test('explicit v6 label and quotation mappings reject copied values and numbers from another source index',()=>{
 const h=mobileIntakeHarness();try{
  const current=h.load('app/product-content.ts').emptyProductContent('p'),labels=h.load('app/translation-label-adoption.ts'),quotation=h.load('app/quotation-translation-adoption.ts'),qm=h.load('app/quotation-schema.ts');
  const job={productId:'p',productVersion:'v',contentRevision:0,status:'completed',review:{instructionsVersion:'sourceflow-translation-v6',source:{attributes:[
   {name:'상품속성: 产品尺寸',value:'10 cm'},{name:'상품속성: 材质',value:'棉 검토'},{name:'상품속성: 长度',value:'20 cm'},
  ]}},result:{draft:{title:'검토 상품',description:'',keywords:[],warnings:[],attributes:[
   {sourceIndex:0,name:'크기',value:'20 cm'},{sourceIndex:1,name:'재질',value:'棉 검토'},
  ]}}};
  const view={productVersion:'v',contentRevision:0,imageKeys:[],overrides:qm.emptyQuotationOverrides(),resolved:{schema:qm.getQuotationSchema('80719'),rows:[{optionId:null,included:true,fields:{noticeDimensions:{value:'',source:'empty'},noticeMaterial:{value:'',source:'empty'}}}]}};
  const before=JSON.stringify({current,view,job});
  for(const [sourceIndex,field,fieldId]of [[0,'dimensions','noticeDimensions'],[1,'material','noticeMaterial']]){
   assert.throws(()=>labels.translationLabelAdoption(current,job,'v',[{sourceIndex,field}]),/원문 복사|다른 항목/);
   assert.throws(()=>quotation.quotationTranslationDraft('p',view,job,null,[{sourceIndex,fieldId}]),/원문 복사|다른 항목/);
  }
  assert.equal(JSON.stringify({current,view,job}),before);
  const legacy={...job,review:{...job.review,instructionsVersion:'sourceflow-translation-v5'}};
  assert.equal(labels.translationLabelAdoption(current,legacy,'v',[{sourceIndex:0,field:'dimensions'}]).input.patch.label.dimensions,'20 cm');
  assert.equal(quotation.quotationTranslationDraft('p',view,legacy,null,[{sourceIndex:0,fieldId:'noticeDimensions'}])[0].value,'20 cm');
  job.result.draft.attributes[0].value='10 센티미터';
  assert.equal(labels.translationLabelAdoption(current,job,'v',[{sourceIndex:0,field:'dimensions'}]).input.patch.label.dimensions,'10 센티미터');
  assert.equal(quotation.quotationTranslationDraft('p',view,job,null,[{sourceIndex:0,fieldId:'noticeDimensions'}])[0].value,'10 센티미터');
 }finally{h.close();}
});

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`Google partial copies preserve exact options, manual blanks, excluded rows and quotation inputs (${company.companyCode})`,async()=>{
 let source;const queries=[];
 const h=mobileIntakeHarness({...company,translationFetcher:async url=>{
  const q=new URL(url).searchParams.get('q');queries.push(q);
  const translated=q===source.title?'검토 선글라스':q===source.attributes[0].value?'유광 검정 선글라스':q==='材质'?'재질':q==='尺寸'?'크기':q==='宽度'?'너비':q==='长度'?'길이':q==='宽 10 cm'?'너비 20 cm':q==='长 20 cm'?'길이 10 cm':q===source.attributes[1].value?'유광 검정':q===source.attributes[3].value?'무광 검정':q;
  return Response.json([[[translated,q]],null,'zh-CN']);
 }});
 try{
  h.sqlite.exec("UPDATE collection_jobs SET goal='collect'");await h.intake();h.bindings.SOURCEFLOW_TEXT_PROVIDER='google-free';
  const id=product(h).id,base='/api/products/'+id,om=h.load('app/product-options.ts');
  const saveOptions=async mutate=>{const view=await json(await h.route(base+'/options')),rows=om.optionInputs(view.options);mutate(rows);return json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:view.options.revision,expectedProductVersion:view.productVersion,rows}}));};
  await saveOptions(rows=>{rows[0].translatedName='직접 확인한 이름';rows[1].included=false;});
  await saveOptions(rows=>{rows[0].translatedName='';});
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content(h).revision,patch:{label:{material:'직접 확인한 재질'}}}}));
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content(h).revision,patch:{seo:{description:''},label:{material:''}}}}));
  const initial=options(h),version=product(h).updated_at,rawReceipt=h.sqlite.prepare('SELECT payload FROM collection_results').get().payload,policy=product(h).pricing_policy;
  assert.equal(initial.rows[0].provenance.translatedName,'manual');
  source={title:product(h).title,description:'',provenance:'manual',reference:'Local Google partial coverage fixture',category:{id:h.context.category.categoryId,path:h.context.category.categoryPath},attributes:[
   {name:'option:'+initial.rows[0].id,value:initial.rows[0].originalName},
   {name:'option-color:'+initial.rows[1].id,value:initial.rows[1].color},
   {name:'option:'+initial.rows[2].id,value:initial.rows[2].originalName},
   {name:'option-color:'+initial.rows[2].id,value:initial.rows[2].color},
   {name:'상품속성: 材质',value:'棉 검토'},
   {name:'상품속성: 尺寸',value:'10 cm'},
   {name:'상품속성: 宽度',value:'宽 10 cm'},
   {name:'상품속성: 长度',value:'长 20 cm'},
  ]};
  const request=body=>h.route(base+'/translation',{method:'POST',body}),prepared=await json(await request({action:'prepare',expectedVersion:version,idempotencyKey:crypto.randomUUID(),source}));
  await json(await request({action:'approve',jobId:prepared.job.id,reviewFingerprint:prepared.job.review.fingerprint,confirmPaid:true}));
  const {job}=await json(await request({action:'execute',jobId:prepared.job.id}));assert.equal(job.status,'completed');assert.equal(job.review.destination,'Google 번역');
  assert.deepEqual(job.result.draft.attributes.map(item=>item.sourceIndex),[0,1,3,5]);assert.match(job.result.draft.warnings.join(' '),/8개 중 4개.*누락 4개/);assert.match(job.result.draft.warnings.join(' '),/같은.*원문에 없는 숫자.*2개/);
  assert.deepEqual(job.review.source,source);assert.equal(h.aiSources.length,0);assert.equal(job.result.usage,null);
  const savedJob=h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(job.id),calls=queries.length;
  const preview=await json(await h.route(base+'/translation-apply',{method:'POST',body:{action:'preview',jobId:job.id,expectedVersion:version}}));assert.deepEqual(options(h),initial);
  await json(await h.route(base+'/translation-apply',{method:'POST',body:{action:'apply',jobId:job.id,expectedVersion:version,fingerprint:preview.fingerprint}}));
  const next=options(h),nextContent=content(h);
  assert.equal(next.rows[0].translatedName,'');assert.equal(next.rows[0].provenance.translatedName,'manual');assert.equal(next.rows[1].included,false);assert.equal(next.rows[1].color,initial.rows[1].color);
  assert.equal(next.rows[2].translatedName,'');assert.notEqual(next.rows[2].provenance.translatedName,'translated');assert.equal(next.rows[2].color,'무광 검정');assert.equal(next.rows[2].provenance.color,'translated');
  assert.equal(nextContent.label.material.value,'');assert.equal(nextContent.label.material.provenance,'manual');assert.equal(nextContent.seo.description.value,'');assert.equal(nextContent.seo.description.provenance,'manual');
  for(const [index,row]of next.rows.entries())for(const key of ['id','originalName','supplierSku','unitCostCny','unitsPerPack','imageKey'])assert.equal(row[key],initial.rows[index][key]);
  const quote=await json(await h.route(base+'/quotation-fields')),row=quote.resolved.rows.find(row=>row.optionId===next.rows[2].id);
  assert.equal(row.fields.color.value,'무광 검정');assert.ok(quote.resolved.rows.every(row=>row.fields.title.value===nextContent.seo.title.value));
  assert.equal(queries.length,calls);assert.deepEqual(h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(job.id),savedJob);assert.equal(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload,rawReceipt);assert.equal(product(h).pricing_policy,policy);assert.ok(!h.network.includes('supplier.coupang.com'));
 }finally{h.close();}
});
