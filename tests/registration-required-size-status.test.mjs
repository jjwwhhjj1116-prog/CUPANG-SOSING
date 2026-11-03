import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedWorkflowFixture,companies} from './helpers/step920-selected-workflow.mjs';
import {completeNativeSnapshot,json} from './helpers/step922-native-workflow.mjs';

for(const required of [true,false])test(`actual batch and saved board agree on an empty ${required?'required':'optional'} size chart without changing nullable field rules`,async()=>{
 const snapshot=completeNativeSnapshot(companies[0]),raw=JSON.parse(snapshot.schemaString),images=raw.properties.imagePage.properties.images;
 images.properties.sizeChartImage={type:['string','null'],title:'사이즈표',examples:['']};
 if(required)images.required.push('sizeChartImage');snapshot.schemaString=JSON.stringify(raw);
 const f=await selectedWorkflowFixture(companies[0],{initialSnapshot:snapshot,completeInputs:true,qwenSeo:true});
 try{
  const before=JSON.stringify(f.h.sqlite.prepare('SELECT * FROM products').all()),readsFrom=f.requests.length;
  const layout=await json(await f.request(f.base+'/registration-layout'));assert.equal(layout.sizeChartRequired,required);
  const result=await f.run(['sizeChart']);assert.equal(result.stages[0].status,required?'blocked':'skipped');
  const content=await json(await f.request(f.base+'/content')),product=await f.h.load('db/queries.ts').findProduct('owner',f.productId),summary=(await f.h.load('db/product-content.ts').readRegistrationSummaries('owner',[product]))[f.productId];
  assert.equal(content.registrationStages.sizeChart.state,required?'pending':'unused');assert.equal(summary.stages.sizeChart.state,required?'pending':'unused');
  const fallback=f.h.load('app/registration-content-summary.ts').registrationContentSummary(product,content.content,{ownerId:'owner',categoryId:snapshot.categoryId,categoryPath:snapshot.categoryPath,hubSchema:snapshot,options:{revision:-1,rows:[]},state:{overrides:{common:{},options:{}}}});
  assert.equal(fallback.missingImages,true);assert.equal(fallback.stages.sizeChart.state,required?'pending':'unused','a known category requirement survives an unconfirmed final quotation scope');
  assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM products').all()),before);assert.ok(f.requests.slice(readsFrom).every(request=>request.method==='GET'));assert.equal(f.boundaries.length,0);
  if(required){
   const key=[...f.originals.keys()][0];
   await json(await f.request(f.base+'/content',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:content.content.revision,patch:{assets:{size:[key]}}})}));
   assert.equal((await json(await f.request(f.base+'/content'))).registrationStages.sizeChart.state,'complete','an explicitly saved owned size image remains complete');
  }
 }finally{f.close();}
});
