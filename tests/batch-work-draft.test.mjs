import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const product=h=>h.sqlite.prepare('SELECT * FROM products').get();
const content=h=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
const options=h=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
function runner(h,intercept){
 const calls=[],keys=new Map();let sequence=0;
 const fetcher=async(path,init={})=>{
  calls.push({path,method:init.method??'GET',body:init.body?JSON.parse(init.body):undefined});
  const response=path==='/api/products/'+product(h).id
   ? await h.load('app/api/products/[id]/route.ts')[init.method??'GET'](new Request('https://app.test'+path,{...init}),{params:Promise.resolve({id:product(h).id})})
   : await h.route(path,{method:init.method??'GET',body:init.body});
  return intercept?intercept(path,init,response):response;
 };
 return {calls,keys,run:(signal=new AbortController().signal)=>h.load('app/batch-work.ts').runBatchProduct(product(h).id,{fetcher,signal,keys,newKey:()=>`batch-work-${++sequence}`,prepareDrafts:true}),fetcher};
}

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`explicit work continues a stored SEO-price draft into image and quotation drafts (${company.companyCode})`,async()=>{
 const h=mobileIntakeHarness(company);try{
  await h.intake();
  const before={product:product(h),content:content(h),options:options(h),downloads:h.stats.downloads,ai:h.aiSources.length};
  assert.deepEqual(before.content.assets.main.value,[]);assert.deepEqual(before.content.assets.additional.value,[]);assert.deepEqual(before.content.assets.detail.value,[]);
  const run=runner(h),workflow=await run.run(),source=JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload);
  const links=new Map(h.sqlite.prepare('SELECT image_index,object_key FROM collection_images ORDER BY image_index').all().map(row=>[row.image_index,row.object_key]));
  for(const role of ['main','additional','detail'])assert.deepEqual(content(h).assets[role].value,source.images.flatMap((image,index)=>image.role===role?[links.get(index)]:[]),role);
  for(const row of options(h).rows){const original=source.options.find(item=>item.sku===row.supplierSku);assert.equal(row.imageKey,links.get(original.imageIndex));}
  assert.ok(Date.parse(product(h).updated_at)>Date.parse(before.product.updated_at));
  assert.equal(workflow.productVersion,product(h).updated_at);
  assert.equal(run.calls.find(call=>call.path.endsWith('/automation')).body.expectedVersion,product(h).updated_at);
  for(const stage of ['mainImage','additionalImages','detailImage'])assert.equal(workflow.stages.find(item=>item.id===stage).status,'draft');
  assert.equal(workflow.stages.find(item=>item.id==='pricing').status,'complete');
  assert.equal(h.sqlite.prepare('SELECT goal FROM collection_jobs').get().goal,'price');assert.equal(product(h).goal_stage,'price');
  assert.equal(product(h).image_status,before.product.image_status);assert.equal(product(h).supplier_hub_status,'미전송');
  assert.deepEqual(content(h).label,before.content.label);assert.deepEqual(content(h).seo,before.content.seo);
  for(const [index,row]of options(h).rows.entries())for(const key of ['id','supplierSku','unitCostCny','unitsPerPack','stock','minimumOrderQuantity','packagedWeightG'])assert.equal(row[key],before.options.rows[index][key],key);
  const quote=await json(await h.route('/api/products/'+product(h).id+'/quotation-fields'));
  for(const row of quote.resolved.rows.filter(row=>row.optionId)){
   assert.equal(row.fields.mainImage.value,options(h).rows.find(option=>option.id===row.optionId).imageKey);
   assert.equal(row.fields.additionalImages.value,content(h).assets.additional.value.join('\n'));assert.equal(row.fields.detailImages.value,content(h).assets.detail.value.join('\n'));
  }
  assert.equal(h.stats.downloads,before.downloads);assert.equal(h.aiSources.length,before.ai);
  const stable=JSON.stringify({product:product(h),content:content(h),options:options(h)});await run.run();
  assert.equal(JSON.stringify({product:product(h),content:content(h),options:options(h)}),stable,'repeating explicit work does not rewrite image drafts');
 }finally{h.close();}
});

test('collect-only work preserves manual blanks, image order, excluded files and options, packaging and quotation overrides',async()=>{
 const h=mobileIntakeHarness();try{
  h.sqlite.prepare("UPDATE collection_jobs SET goal='collect'").run();await h.intake();
  const base='/api/products/'+product(h).id,links=h.sqlite.prepare('SELECT image_index,object_key FROM collection_images ORDER BY image_index').all();
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content(h).revision,patch:{assets:{main:[],additional:[links[5].object_key,links[4].object_key]},label:{material:'직접 확인한 재질'},seo:{description:''}}}}));
  const editOptions=async edit=>{const view=await json(await h.route(base+'/options')),rows=h.load('app/product-options.ts').optionInputs(view.options);edit(rows);return json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:view.options.revision,expectedProductVersion:view.productVersion,rows}}));};
  await editOptions(rows=>{rows[0].imageKey=links[1].object_key;rows[1].included=false;rows[2].unitsPerPack=3;rows[2].packagedWeightG=500;rows[2].packagedWidthMm=300;rows[2].packagedLengthMm=200;rows[2].packagedHeightMm=100;rows[2].packagingConfirmed=true;});
  await editOptions(rows=>{rows[0].imageKey=null;});
  const removed=links[10].object_key,keys=JSON.parse(product(h).image_keys).filter(key=>key!==removed);
  const run=runner(h);await json(await run.fetcher(base,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedVersion:product(h).updated_at,image_keys:JSON.stringify(keys)})}));
  const quote=await json(await h.route(base+'/quotation-fields'));
  await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:quote.revision,expectedInputFingerprint:quote.inputFingerprint,changes:[{fieldKey:'mainImage',optionId:options(h).rows[0].id,value:''},{fieldKey:'noticeMaterial',optionId:null,value:'견적에서 직접 확인한 재질'}]}}));
  const before={content:content(h),options:options(h),policy:h.sqlite.prepare('SELECT payload FROM product_price_policy').get().payload};
  await run.run();
  assert.deepEqual(content(h).assets.main,before.content.assets.main);assert.deepEqual(content(h).assets.additional,before.content.assets.additional);
  assert.ok(!content(h).assets.detail.value.includes(removed));assert.deepEqual(JSON.parse(product(h).image_keys),keys);
  assert.deepEqual(options(h).rows[0],before.options.rows[0]);assert.deepEqual(options(h).rows[1],before.options.rows[1]);
  for(const key of ['unitsPerPack','packagingUnitsPerPack','packagedWeightG','packagedWidthMm','packagedLengthMm','packagedHeightMm'])assert.equal(options(h).rows[2][key],before.options.rows[2][key]);
  assert.deepEqual(content(h).label,before.content.label);assert.deepEqual(content(h).seo,before.content.seo);
  assert.equal(h.sqlite.prepare('SELECT payload FROM product_price_policy').get().payload,before.policy);
  const final=await json(await h.route(base+'/quotation-fields')),row=final.resolved.rows.find(row=>row.optionId===before.options.rows[0].id);
  assert.equal(row.fields.mainImage.value,'');assert.equal(row.fields.noticeMaterial.value,'견적에서 직접 확인한 재질');
  assert.equal(h.sqlite.prepare('SELECT goal FROM collection_jobs').get().goal,'collect');
 }finally{h.close();}
});

test('missing original link or no remaining source files explains unavailable drafts while preserving existing price work',async()=>{
 for(const missing of ['link','files']){
  const h=mobileIntakeHarness();try{
   await h.intake();
   if(missing==='link')h.sqlite.prepare('DELETE FROM collection_products').run();
   else h.sqlite.prepare("UPDATE products SET image_keys='[]'").run();
   const before=JSON.stringify({product:product(h),content:content(h),options:options(h)}),messages=[];
   const run=runner(h,async(path,init,response)=>{if(path.endsWith('/work-draft'))messages.push(await response.clone().json());return response;});
   const workflow=await run.run();assert.equal(messages[0].prepared,false);assert.match(messages[0].message,/없어 이미지 초안을 만들지 않았/);
   assert.equal(workflow.stages.find(stage=>stage.id==='pricing').status,'complete');
   assert.equal(JSON.stringify({product:product(h),content:content(h),options:options(h)}),before);
  }finally{h.close();}
 }
});

test('lost committed image or automation acknowledgement resumes without duplicate draft writes and reuses the automation key',async()=>{
 for(const lost of ['work-draft','automation']){
  const h=mobileIntakeHarness();try{
   await h.intake();let failed=false;
   const run=runner(h,(path,init,response)=>{if(!failed&&path.endsWith('/'+lost)&&response.ok){failed=true;throw Error('lost committed response');}return response;});
   await assert.rejects(run.run(),/lost committed/);
   const before=JSON.stringify({product:product(h),content:content(h),options:options(h)}),workflows=h.sqlite.prepare('SELECT count(*) n FROM product_automation').get().n;
   const workflow=await run.run();assert.equal(workflow.productVersion,product(h).updated_at);assert.equal(JSON.stringify({product:product(h),content:content(h),options:options(h)}),before);
   assert.equal(h.sqlite.prepare('SELECT count(*) n FROM product_automation').get().n,1);assert.equal(workflows,lost==='automation'?1:0);
   const sent=run.calls.filter(call=>call.path.endsWith('/automation')).map(call=>call.body.idempotencyKey);
   assert.equal(new Set(sent).size,1);assert.equal(run.keys.size,0);assert.equal(h.stats.downloads,19);
  }finally{h.close();}
 }
});

test('explicit draft atomic guard rejects concurrent goal and independent revision/source changes without running pricing',async()=>{
 for(const change of ['goal','content','options','receipt']){
  const h=mobileIntakeHarness();try{
   await h.intake();const original=h.db.batch;let expected,raced=false;
   h.db.batch=async statements=>{
    if(!raced&&statements.length===3){
     raced=true;
     if(change==='goal')h.sqlite.prepare("UPDATE collection_jobs SET goal='collect'").run();
     else if(change==='receipt'){const row=h.sqlite.prepare('SELECT payload FROM collection_results').get(),value=JSON.parse(row.payload);value.images.reverse();h.sqlite.prepare('UPDATE collection_results SET payload=?').run(JSON.stringify(value));}
     else{const value=change==='content'?content(h):options(h);value.revision++;if(change==='content')value.label.material={value:'동시 수동 수정',provenance:'manual',updatedAt:product(h).updated_at};else value.rows[0].imageKey=null;h.sqlite.prepare(`UPDATE product_${change} SET revision=?,payload=?`).run(value.revision,JSON.stringify(value));}
     expected=JSON.stringify({product:product(h),content:content(h),options:options(h)});
    }
    return original(statements);
   };
   const run=runner(h);await assert.rejects(run.run(),/변경되었습니다/);assert.equal(raced,true);assert.equal(JSON.stringify({product:product(h),content:content(h),options:options(h)}),expected);
   assert.equal(run.calls.some(call=>call.path.endsWith('/automation')),false);
  }finally{h.close();}
 }
});

test('stale or fabricated explicit requests cannot change drafts and a post-commit close cannot continue automation',async()=>{
 const h=mobileIntakeHarness();try{
  await h.intake();const path='/api/products/'+product(h).id+'/work-draft',before=JSON.stringify({product:product(h),content:content(h),options:options(h)});
  assert.equal((await h.route(path,{method:'POST',body:{expectedVersion:'2020-01-01T00:00:00.000Z'}})).status,409);
  for(const body of [{},{expectedVersion:product(h).updated_at,jobId:'other'},{expectedVersion:product(h).updated_at,goal:'work'},{expectedVersion:'invalid'}])assert.equal((await h.route(path,{method:'POST',body})).status,400);
  assert.equal(JSON.stringify({product:product(h),content:content(h),options:options(h)}),before);
  const controller=new AbortController(),run=runner(h,(path,init,response)=>{if(path.endsWith('/work-draft'))controller.abort();return response;});
  assert.equal(await run.run(controller.signal),null);assert.equal(run.calls.some(call=>call.path.endsWith('/automation')),false);
  const preserved=JSON.stringify({product:product(h),content:content(h),options:options(h)});await run.run();assert.equal(JSON.stringify({product:product(h),content:content(h),options:options(h)}),preserved);
 }finally{h.close();}
});
