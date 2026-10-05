import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const categoryPath=['패션의류잡화','유니섹스/남녀공용 패션','공용 잡화','선글라스','남녀공용패션선글라스'];
const schema=company=>({format:'supplier-hub-schema-v1',categoryId:'69900',categoryPath,company,observedAt:Date.now(),schemaString:JSON.stringify({type:'object',properties:{startPage:{type:'object',properties:{productName:{type:'string',title:'상품명'}}},productPage:{type:'object',properties:{}},legalPage:{type:'object',properties:{}}}}),metadata:{kanCategoryId:2624,noticeNumber:4,scopeType:'Retail_Categorized_Single',version:188},inputBindings:'couplus-paths-v1'});
for(const current of companies)test(`an account company change cannot relabel a frozen proposal (${current.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:current.code,companyName:current.name});try{
  const original=companies.find(value=>value.code!==current.code),sha='a'.repeat(64),profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'동결된 회사 양식',categoryId:'69900',categoryPath,hubSchema:schema(original),mappings:[{column:0,field:'title',required:true}],template:{name:'company.csv',format:'csv',sha256:sha,sheetName:'',headerRow:1,headers:['상품명'],storageKey:`owner/category-templates/${sha}.csv`}},'cat');
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),context=h.sqlite.prepare('SELECT payload FROM collection_context').get().payload,objects=[...h.objects.keys()];
  const request=()=>h.route(`/api/products/${product.id}/quotation`,{method:'POST',body:{action:'source',profileId:profile.id}});
  const blocked=await request();assert.equal(blocked.status,409,await blocked.clone().text());assert.match((await blocked.json()).error,/회사/);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM products').get(),product);assert.equal(h.sqlite.prepare('SELECT payload FROM collection_context').get().payload,context);assert.deepEqual([...h.objects.keys()],objects);
  // Relabeling just the mutable profile cannot override the original product snapshot.
  const raw=h.sqlite.prepare('SELECT payload FROM category_profiles WHERE id=?').get(profile.id);
  const updated=JSON.parse(raw.payload);updated.hubSchema.company=current;h.sqlite.prepare('UPDATE category_profiles SET payload=? WHERE id=?').run(JSON.stringify(updated),profile.id);
  assert.equal((await request()).status,409);
  // A separate same-company saved product remains usable; a mismatched latest template does not.
  const matching=JSON.parse(context);matching.category.hubSchema.company=current;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(matching),'job');
  const allowed=await request();assert.equal(allowed.status,200,await allowed.clone().text());assert.deepEqual((await allowed.json()).report.company,current);
  h.sqlite.prepare('UPDATE category_profiles SET payload=? WHERE id=?').run(raw.payload,profile.id);assert.equal((await request()).status,409);
 }finally{h.close();}
});
