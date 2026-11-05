import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedWorkflowFixture,companies} from './helpers/step920-selected-workflow.mjs';
import {completeNativeSnapshot,json} from './helpers/step922-native-workflow.mjs';

for(const required of [true,false])test(`actual batch and saved board ${required?'save a reference for required':'skip optional'} empty size charts without changing nullable field rules`,async()=>{
 const snapshot=completeNativeSnapshot(companies[0]),raw=JSON.parse(snapshot.schemaString),images=raw.properties.imagePage.properties.images;
 images.properties.sizeChartImage={type:['string','null'],title:'사이즈표',examples:['']};
 if(required)images.required.push('sizeChartImage');snapshot.schemaString=JSON.stringify(raw);
 const f=await selectedWorkflowFixture(companies[0],{initialSnapshot:snapshot,completeInputs:true,qwenSeo:true});
 try{
  const before=JSON.stringify(f.h.sqlite.prepare('SELECT * FROM products').all()),readsFrom=f.requests.length;
  const layout=await json(await f.request(f.base+'/registration-layout'));assert.equal(layout.sizeChartRequired,required);
  const result=await f.run(['sizeChart']);assert.equal(result.stages[0].status,required?'draft':'skipped',JSON.stringify(result));
  const content=await json(await f.request(f.base+'/content')),product=await f.h.load('db/queries.ts').findProduct('owner',f.productId),summary=(await f.h.load('db/product-content.ts').readRegistrationSummaries('owner',[product]))[f.productId];
  assert.equal(content.registrationStages.sizeChart.state,required?'complete':'unused');assert.equal(summary.stages.sizeChart.state,required?'complete':'unused');
  const fallback=f.h.load('app/registration-content-summary.ts').registrationContentSummary(product,content.content,{ownerId:'owner',categoryId:snapshot.categoryId,categoryPath:snapshot.categoryPath,hubSchema:snapshot,options:{revision:-1,rows:[]},state:{overrides:{common:{},options:{}}}});
  assert.equal(fallback.missingImages,true);assert.equal(fallback.stages.sizeChart.state,required?'complete':'unused','the saved reference image satisfies the size role without weakening other missing-image rules');
  if(!required){assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM products').all()),before);assert.ok(f.requests.slice(readsFrom).every(request=>request.method==='GET'));assert.equal(f.boundaries.length,0);}
  if(required){
   assert.equal(content.content.assets.size.provenance,'generated');assert.deepEqual(content.content.manualSizeChart,JSON.parse(JSON.stringify(f.h.load('app/manual-size-chart.ts').createReferenceSizeChart())));
   const writes=f.requests.slice(readsFrom).filter(request=>request.method!=='GET');assert.equal(writes.length,1);assert.ok(writes[0].url.includes('/size-chart-save'));assert.equal(writes[0].method,'POST');
   assert.ok(f.boundaries.every(boundary=>boundary.type==='synthetic-canvas'));assert.equal(f.immutableSource(),f.sourceBefore);
   const quote=await json(await f.request(f.base+'/quotation-fields')),size=quote.resolved.schema.fields.find(field=>field.hubInput==='sizeImages');assert.ok(size);assert.ok(quote.resolved.rows.filter(row=>row.included&&row.optionId).every(row=>row.fields[size.id].value===content.content.assets.size.value[0]));
  }
 }finally{f.close();}
});
