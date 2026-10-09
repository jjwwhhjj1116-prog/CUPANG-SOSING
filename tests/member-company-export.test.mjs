import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const categoryPath=['패션의류잡화','유니섹스/남녀공용 패션','공용 잡화','선글라스','남녀공용패션선글라스'];
const plain=value=>JSON.parse(JSON.stringify(value));
// Minimal synthetic schema. No downloaded Single or private workbook is
// relabeled to build these independently captured company fixtures.
const schema=company=>({format:'supplier-hub-schema-v1',categoryId:'69900',categoryPath:[...categoryPath],company:{...company},observedAt:Date.now(),schemaString:JSON.stringify({type:'object',properties:{startPage:{type:'object',properties:{productName:{type:'string',title:'상품명'}}},productPage:{type:'object',properties:{}},legalPage:{type:'object',properties:{}}}}),metadata:{kanCategoryId:2624,noticeNumber:4,scopeType:'Retail_Categorized_Single',version:188},inputBindings:'couplus-paths-v1'});
async function captured(company){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
 try{
  const sha='a'.repeat(64),profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'독립 합성 회사 양식',categoryId:'69900',categoryPath,hubSchema:schema(company),mappings:[{column:0,field:'title',required:true}],template:{name:'company.csv',format:'csv',sha256:sha,sheetName:'',headerRow:1,headers:['상품명'],storageKey:`owner/category-templates/${sha}.csv`}},'cat');
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
  assert.deepEqual(plain(h.context.company),company);assert.deepEqual(plain(profile.hubSchema.company),company);
  assert.match(await h.intake(),/상품 초안 저장됨/);
  const product=h.sqlite.prepare('SELECT * FROM products').get();
  const request=()=>h.route(`/api/products/${product.id}/quotation`,{method:'POST',body:{action:'source',profileId:profile.id}});
  const retained=()=>JSON.stringify({tables:['products','product_content','product_options','product_price_policy','collection_results','collection_context','collection_images'].map(table=>h.sqlite.prepare('SELECT * FROM '+table).all()),objects:[...h.objects].map(([key,bytes])=>[key,[...bytes]])});
  return{h,profile,request,retained};
 }catch(cause){h.close();throw cause;}
}
for(const current of companies)test(`an account company change cannot relabel a frozen proposal (${current.code})`,async()=>{
 const original=companies.find(value=>value.code!==current.code),frozen=await captured(original);
 try{
  const before=frozen.retained();frozen.h.setCompany(current);
  const blocked=await frozen.request();assert.equal(blocked.status,409,await blocked.clone().text());assert.match((await blocked.json()).error,/회사/);
  assert.equal(frozen.retained(),before);
  // Relabeling just the mutable profile cannot override the original product snapshot.
  const raw=frozen.h.sqlite.prepare('SELECT payload FROM category_profiles WHERE id=?').get(frozen.profile.id);
  const updated=JSON.parse(raw.payload);updated.hubSchema.company={...current};frozen.h.sqlite.prepare('UPDATE category_profiles SET payload=? WHERE id=?').run(JSON.stringify(updated),frozen.profile.id);
  assert.equal((await frozen.request()).status,409);assert.equal(frozen.retained(),before);
 }finally{frozen.h.close();}
 // A separate product is collected in the current company from the outset.
 // Its success must never be simulated by rewriting the older frozen capture.
 const matching=await captured(current);
 try{
  const before=matching.retained(),allowed=await matching.request();assert.equal(allowed.status,200,await allowed.clone().text());assert.deepEqual((await allowed.json()).report.company,current);
  const raw=matching.h.sqlite.prepare('SELECT payload FROM category_profiles WHERE id=?').get(matching.profile.id),changed=JSON.parse(raw.payload);
  changed.hubSchema.company={...original};matching.h.sqlite.prepare('UPDATE category_profiles SET payload=? WHERE id=?').run(JSON.stringify(changed),matching.profile.id);
  assert.equal((await matching.request()).status,409);assert.equal(matching.retained(),before);
 }finally{matching.h.close();}
});
