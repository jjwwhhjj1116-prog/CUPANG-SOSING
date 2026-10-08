import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies} from './helpers/hub-schema.mjs';
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
async function fixture(company=schemaCompanies[0]){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const schema=h.load('app/quotation-schema.ts').getQuotationSchema('80719'),profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'최종 라벨 집계 시험',categoryId:'80719',categoryPath:schema.categoryPath,template:null,mappings:[]});
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),endpoint='/api/products/'+product.id+'/quotation-fields',quote=await json(await h.route(endpoint));
  const selected=quote.resolved.rows.find(row=>row.optionId).optionId,other=quote.resolved.rows.filter(row=>row.optionId)[1].optionId;
  const save=async changes=>{const before=await json(await h.route(endpoint));return json(await h.route(endpoint,{method:'PUT',body:{expectedRevision:before.revision,expectedInputFingerprint:before.inputFingerprint,changes}}));};
  const read=async()=>{const current=h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(product.id);return (await h.load('db/product-content.ts').readRegistrationSummaries('owner',[current]))[current.id];};
  return {h,product,endpoint,selected,other,save,read,quote};
 }catch(error){h.close();throw error;}
}
for(const company of schemaCompanies)test(`listing counts the included final quote labels with SKU/common/manual-blank precedence (${company.code})`,async()=>{
 const f=await fixture(company);try{
  const keys=f.quote.imageKeys,content=await f.h.load('db/product-content.ts').readProductContent('owner',f.product.id),basic=f.h.load('app/registration-content-summary.ts').registrationContentSummary(f.product,content);assert.equal(basic.label,0);
  await f.save([{optionId:null,fieldKey:'labelImages',value:keys[0]},{optionId:f.selected,fieldKey:'labelImages',value:keys[1]},{optionId:f.other,fieldKey:'labelImages',value:''}]);
  let summary=await f.read();assert.equal(summary.label,2);for(const key of ['seo','seoTitle','mainImageKey','main','additional','detail'])assert.deepEqual(summary[key],basic[key]);
  const before=f.h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.product.id);assert.equal(before.supplier_hub_status,'미전송');const quote=await json(await f.h.route(f.endpoint));
  const actual=new Set(quote.resolved.rows.filter(row=>row.included).flatMap(row=>row.fields.labelImages.value.split('\n').filter(Boolean)));assert.equal(summary.label,actual.size);
  await f.save([{optionId:f.selected,fieldKey:'labelImages',value:''},{optionId:null,fieldKey:'labelImages',value:''}]);summary=await f.read();assert.equal(summary.label,0);assert.equal(f.h.sqlite.prepare('SELECT supplier_hub_status FROM products WHERE id=?').get(f.product.id).supplier_hub_status,'미전송');
  const stored=JSON.stringify(f.h.sqlite.prepare('SELECT * FROM product_quotation_fields WHERE product_id=?').get(f.product.id)),images=[...f.h.objects.keys()];await f.read();assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM product_quotation_fields WHERE product_id=?').get(f.product.id)),stored);assert.deepEqual([...f.h.objects.keys()],images);
 }finally{f.h.close();}
});

test('scoped label summaries ignore inactive/legacy edits, excluded SKUs and inherited prototype entries',()=>{
 const h=mobileIntakeHarness();try{
  const model=h.load('app/registration-content-summary.ts'),content=h.load('app/product-content.ts').emptyProductContent('p'),product={id:'p',image_keys:JSON.stringify(['owner/auto.png','owner/common.png','owner/own.png','owner/excluded.png'])};content.assets.label.value=['owner/auto.png'];
  const input={ownerId:'owner',categoryId:'80719',categoryPath:h.context.category.categoryPath,options:{revision:1,rows:[{id:'red',included:true},{id:'blue',included:true},{id:'excluded',included:false}]},state:{overrides:{common:{labelImages:'owner/excluded.png'},options:{}},categoryOverrides:{'category:80719':{common:{labelImages:'owner/common.png'},options:{red:{labelImages:'owner/own.png'},blue:{labelImages:''},excluded:{labelImages:'owner/excluded.png'}}},'category:81452':{common:{labelImages:'owner/excluded.png'},options:{}}}}};
  assert.equal(model.registrationContentSummary(product,content,input).label,1);
  delete input.state.categoryOverrides['category:80719'];assert.equal(model.registrationContentSummary(product,content,input).label,1,'inactive unscoped values cannot override the current category automatic label');
  input.state.categoryOverrides['category:80719']={common:{},options:Object.create({red:{labelImages:'foreign-owner/private.png'}})};const inherited=model.registrationContentSummary(product,content,input);assert.equal(inherited.label,1);assert.equal(inherited.missingImages,false);
  input.state.categoryOverrides['category:80719'].options={red:{labelImages:''},blue:{labelImages:''}};content.assets.label.value=['owner/missing-auto.png'];const cleared=model.registrationContentSummary(product,content,input);assert.equal(cleared.label,0);assert.equal(cleared.missingImages,false,'shadowed unused automatic references cannot be counted or flagged as final references');
 }finally{h.close();}
});

test('unconfirmed or corrupt captured schema marks connection review while a different historical allowed company never becomes registration completion',()=>{
 const h=mobileIntakeHarness();try{
  const model=h.load('app/registration-content-summary.ts'),content=h.load('app/product-content.ts').emptyProductContent('p'),product={id:'p',image_keys:'["owner/label.png"]'},snapshot=hubSchemaSnapshot(schemaCompanies[0]);
  const input={ownerId:'owner',categoryId:snapshot.categoryId,categoryPath:snapshot.categoryPath,hubSchema:snapshot,options:{revision:0,rows:[]},state:{overrides:{common:{},options:{}},categoryOverrides:{['category:'+snapshot.categoryId]:{common:{labelImages:'owner/label.png'},options:{}}}}};
  const known=model.registrationContentSummary(product,content,input);assert.equal(known.label,1);assert.equal(known.registration_status,undefined);assert.equal(known.submissionReady,undefined);
  const missing=model.registrationContentSummary(product,content,{...input,hubSchema:undefined});assert.equal(missing.missingImages,true);
  const corrupt=model.registrationContentSummary(product,content,{...input,hubSchema:{...snapshot,company:{code:'A01464742',name:'유앤채'}}});assert.equal(corrupt.missingImages,true);
  const unknown=model.registrationContentSummary(product,content,null);assert.equal(unknown.label,0);assert.equal(unknown.missingImages,true);
 }finally{h.close();}
});

test('untouched optionless legacy uses common labels, while deliberately deleted or fully excluded options have no included label count',()=>{
 const h=mobileIntakeHarness();try{
  const model=h.load('app/registration-content-summary.ts'),content=h.load('app/product-content.ts').emptyProductContent('p'),product={id:'p',image_keys:'["owner/label.png"]'},input={ownerId:'owner',categoryId:'80719',categoryPath:h.context.category.categoryPath,options:{revision:0,rows:[]},state:{overrides:{common:{},options:{}},categoryOverrides:{'category:80719':{common:{labelImages:'owner/label.png'},options:{}}}}};
  assert.equal(model.registrationContentSummary(product,content,input).label,1);input.options.revision=1;assert.equal(model.registrationContentSummary(product,content,input).label,0);input.options.rows=[{id:'excluded',included:false}];assert.equal(model.registrationContentSummary(product,content,input).label,0);
  input.options.rows=[{id:'red',included:true}];input.state.categoryOverrides['category:80719'].options.red={labelImages:'foreign-owner/private.png\nowner/not-in-pool.png'};const bad=model.registrationContentSummary(product,content,input);assert.equal(bad.label,0);assert.equal(bad.missingImages,true);
 }finally{h.close();}
});

test('81-product listing uses bounded chunk metadata queries, refuses foreign product rows and isolates corrupt exact capture links',async()=>{
 const f=await fixture();try{
  const product=f.h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.product.id),keys=f.quote.imageKeys;await f.save([{optionId:null,fieldKey:'labelImages',value:keys[0]}]);
  const entries=Array.from({length:81},(_,index)=>({...product,id:index===0?product.id:'unowned-'+index})),prepare=f.h.db.prepare,reads=[];
  f.h.db.prepare=function(sql){const query=prepare(sql),bind=query.bind;query.bind=(...args)=>{reads.push({sql,count:args.length});return bind(...args);};return query;};
  const summaries=await f.h.load('db/product-content.ts').readRegistrationSummaries('owner',entries);assert.equal(summaries[product.id].label,1);assert.equal(summaries['unowned-1'],null);assert.equal(reads.filter(read=>read.sql.includes('FROM products p LEFT JOIN product_options')).length,2);assert.equal(reads.filter(read=>read.sql.includes('FROM product_content WHERE')).length,2);assert.ok(reads.every(read=>read.count<=81));
  const source=f.h.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get('job').payload;f.h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run('broken captured JSON','job');const broken=await f.read();assert.equal(broken.missingImages,true);assert.equal(broken.label,0);assert.equal(broken.seo,(await f.h.load('db/product-content.ts').readProductContent('owner',product.id)).seo.title.value.trim()!=='');
  f.h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(source,'job');assert.equal((await f.read()).label,1);
 }finally{f.h.close();}
});
