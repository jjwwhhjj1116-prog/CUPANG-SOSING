import test from 'node:test';
import assert from 'node:assert/strict';
import {seoWorkspaceHarness} from './helpers/seo-workspace.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';

const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());assert.equal(response.headers.get('cache-control'),'no-store');return response.json();};
const plain=value=>JSON.parse(JSON.stringify(value));
function schema(company,required=true){const value=hubSchemaSnapshot(company),raw=JSON.parse(value.schemaString);raw.properties.imagePage.properties.images={type:'object',properties:{sizeChartImage:{type:['string','null'],title:'사이즈표'}},required:required?['sizeChartImage']:[]};return{...value,schemaString:JSON.stringify(raw)};}
async function setup(company,{captured=false,required=true}={}){
 const h=seoWorkspaceHarness({companyCode:company.code}),profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'합성 단계 분류',categoryId:'991234',categoryPath:schemaPath,hubSchema:schema(company,required),mappings:[],template:null});
 let jobId;
 if(captured){const offerId=h.load('app/sourcing.ts').parseCollectionRequest({urls:[h.product.source_url]})[0].offerId;
  const jobs=await h.load('db/collection-jobs.ts').enqueueCollection('owner',[{offerId,sourceUrl:h.product.source_url,goal:'work'}],{category:profile,company,settings:h.load('app/workspace-settings.ts').defaultSettings,features:'',keywords:'',capturedAt:h.version});jobId=jobs[0].id;
  h.sqlite.prepare('INSERT INTO collection_products VALUES(?,?,?,?)').run(jobId,'owner',h.id,h.version);
 }
 const api=h.load('app/api/products/[id]/registration-layout/route.ts'),fields=h.load('app/api/products/[id]/quotation-fields/route.ts');
 return{h,profile,jobId,request:(query='',id=h.id)=>api.GET(new Request('https://app.test/api/products/'+id+'/registration-layout'+query),{params:Promise.resolve({id})}),fields:()=>fields.GET(new Request('https://app.test/api/products/'+h.id+'/quotation-fields'+(captured?'':'?profileId='+profile.id)),{params:Promise.resolve({id:h.id})})};
}
const stored=h=>JSON.stringify(Object.fromEntries(['products','product_content','product_options','product_quotation_fields','category_profiles','collection_jobs','collection_context','collection_products'].map(name=>[name,h.sqlite.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()])));

for(const company of schemaCompanies)for(const captured of [false,true])test(`${company.code}: ${captured?'captured':'explicit profile'} exact schema drives layout; GET leaves existing product and quotation values untouched`,async()=>{
 const f=await setup(company,{captured}),{h,profile}=f;
 try{
  const beforeFields=await json(await f.fields()),before=stored(h),result=await json(await f.request(captured?'':'?profileId='+profile.id));
  assert.equal(result.sizeChartRequired,true);assert.equal(result.productId,h.id);assert.equal(result.productVersion,h.version);assert.equal(result.categoryContext.source,captured?'collection':'profile');assert.equal(result.categoryContext.profileId,profile.id);
  const model=h.load('app/registration-layout.ts');assert.deepEqual(plain(model.readRegistrationLayout(result,h.id,h.version,captured?undefined:profile.id)),result);
  assert.equal(result.categoryContext.categoryId,'991234');assert.equal(stored(h),before);assert.deepEqual(await json(await f.fields()),beforeFields);
  const snapshot=await h.load('app/quotation-fields-snapshot.ts').stableQuotationFieldsView('owner',h.id,captured?null:profile.id);
  assert.deepEqual(plain(snapshot.view),beforeFields);assert.deepEqual(plain(snapshot.registrationLayout),result);assert.equal(Object.hasOwn(beforeFields,'registrationLayout'),false,'existing view wire is unchanged');
  assert.ok(!JSON.stringify(result).includes('schemaString'),'the private schema is not returned');
 }finally{h.close();}
});

for(const company of schemaCompanies)test(`${company.code}: missing direct requirement stays seven-step even with a size field; capture remains authoritative after profile edit`,async()=>{
 const f=await setup(company,{captured:true}),{h,profile}=f;
 try{
  const changed={...profile,hubSchema:schema(company,false)};
  h.sqlite.prepare('UPDATE category_profiles SET payload=?,revision=revision+1 WHERE id=?').run(JSON.stringify(changed),profile.id);
  assert.equal((await json(await f.request())).sizeChartRequired,true);assert.equal((await json(await f.request('?profileId='+profile.id))).sizeChartRequired,true,'explicit matching profile still uses the captured schema');
  const context=JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get(f.jobId).payload);context.category.hubSchema=schema(company,false);
  h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(context),f.jobId);
  assert.equal((await json(await f.request())).sizeChartRequired,false);
 }finally{h.close();}
});

test('missing schema uses unknown/false; optional query rejects duplicates, unknown keys, empty and malformed profile without mutations',async()=>{
 const h=seoWorkspaceHarness(),api=h.load('app/api/products/[id]/registration-layout/route.ts'),request=query=>api.GET(new Request('https://app.test/api/products/'+h.id+'/registration-layout'+query),{params:Promise.resolve({id:h.id})});
 try{
  const before=stored(h),result=await json(await request(''));assert.equal(result.sizeChartRequired,false);assert.deepEqual(result.categoryContext,{source:'unknown',profileId:null,categoryId:null,categoryPath:[]});
  for(const query of ['?profileId=cat&profileId=cat','?other=value','?profileId=','?profileId=bad%2Fid','?profileId='+('x'.repeat(101))])await json(await request(query),400);
  assert.equal(stored(h),before);
 }finally{h.close();}
});

test('foreign product, foreign profile and company mismatch reject without exposing schema or editing stored rows',async()=>{
 const f=await setup(schemaCompanies[0]),{h}=f;
 try{
  const foreign=await h.load('db/category-profiles.ts').createCategoryProfile('other-owner',{name:'다른 회원',categoryId:'991234',categoryPath:schemaPath,hubSchema:schema(schemaCompanies[0]),mappings:[],template:null});
  const wrongCompany=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'다른 회사',categoryId:'991234',categoryPath:schemaPath,hubSchema:schema(schemaCompanies[1]),mappings:[],template:null});
  const before=stored(h);await json(await f.request('','foreign-product'),404);await json(await f.request('?profileId='+foreign.id),404);
  const denied=await json(await f.request('?profileId='+wrongCompany.id),409);assert.equal(denied.code,'QUOTATION_COMPANY_MISMATCH');assert.equal(stored(h),before);
 }finally{h.close();}
});

test('a changed collection source between snapshot and final SQL fence rejects its layout with the existing conflict code',async()=>{
 const f=await setup(schemaCompanies[0],{captured:true}),{h}=f,prepare=h.db.prepare;let raced=false;
 try{
  const before=h.stored();
  h.db.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('SELECT p.id FROM products p WHERE')){const first=statement.first;statement.first=async()=>{if(!raced){raced=true;const row=h.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get(f.jobId),context=JSON.parse(row.payload);context.category.hubSchema=schema(schemaCompanies[0],false);h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(context),f.jobId);}return first();};}return statement;};
  const result=await json(await f.request(),409);assert.equal(raced,true);assert.equal(result.code,'QUOTATION_FIELDS_CONFLICT');assert.deepEqual(h.stored(),before);
 }finally{h.db.prepare=prepare;h.close();}
});

test('unverified production access is unavailable and does not reach the snapshot',async()=>{
 const h=seoWorkspaceHarness({authenticated:false}),api=h.load('app/api/products/[id]/registration-layout/route.ts');
 try{const before=stored(h);await json(await api.GET(new Request('https://app.test/api/products/'+h.id+'/registration-layout'),{params:Promise.resolve({id:h.id})}),503);assert.equal(stored(h),before);}
 finally{h.close();}
});
