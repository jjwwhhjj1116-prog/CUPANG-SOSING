import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {categoryPickerUI} from './helpers/category-picker.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';

const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
async function template(h,company){
 const bytes=new TextEncoder().encode('상품명,회사별 검토값 '+company.code+'\n');
 const sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),storageKey=`owner/category-templates/${sha256}.csv`;
 await h.bindings.FILES.put(storageKey,bytes,{customMetadata:{sha256,format:'csv'}});
 const {template,mappings}=h.load('app/category-profiles.ts').validateCategoryProfile({name:'회사 연결 시험',categoryId:'991234',categoryPath:schemaPath,
  template:{name:'synthetic-'+company.code+'.csv',format:'csv',sheetName:'',headerRow:1,headers:['상품명','회사별 검토값 '+company.code],sha256,storageKey},
  mappings:[{column:0,field:'title',required:false},{column:1,field:'constant',constant:company.name+' 수동 검토값',required:false}]});
 return JSON.parse(JSON.stringify({template,mappings}));
}

for(const company of schemaCompanies)test(`live category intake never repurposes another company's saved profile (${company.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
 try{
  const other=schemaCompanies.find(item=>item.code!==company.code),oldSchema=hubSchemaSnapshot(other),currentSchema={...hubSchemaSnapshot(company),draftInitialization:'couplus-required-v1',inputBindings:'couplus-paths-v1',settingsInitialization:'couplus-options-v1'};
  const previous=await template(h,other),current=await template(h,company);
  // A prior approved-company profile can remain in the same owner's workspace
  // after a membership reassignment. Templates here are synthetic CSV fixtures.
  const old=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'기존 회사 검토 설정',categoryId:oldSchema.categoryId,categoryPath:schemaPath,hubSchema:oldSchema,...previous});
  h.context.category=old;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
  await h.intake();
  const oldProduct=h.sqlite.prepare('SELECT * FROM products').get();
  const oldContent=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(oldProduct.id).payload);
  await json(await h.route(`/api/products/${oldProduct.id}/content`,{method:'PATCH',body:{expectedRevision:oldContent.revision,patch:{seo:{keywords:[]},label:{material:''}}}}));
  const existingWork=()=>JSON.stringify({product:h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(oldProduct.id),content:h.sqlite.prepare('SELECT * FROM product_content WHERE product_id=?').get(oldProduct.id),options:h.sqlite.prepare('SELECT * FROM product_options WHERE product_id=?').get(oldProduct.id),context:h.sqlite.prepare('SELECT * FROM collection_context WHERE job_id=?').get('job')});
  const originalWork=existingWork();
  const before=h.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(old.id);
  const api=h.load('app/api/category-profiles/route.ts');let downloads=0;
  const picker=categoryPickerUI((path,init)=>api[init?.method??'GET'](new Request('https://app.test'+path,init)),{catalog:{
   loadLiveHubCategorySchema:async()=>currentSchema,
   loadLiveHubCategoryTemplate:async()=>{downloads++;return current;},
  }});
  const choice={key:'current-live',categoryId:currentSchema.categoryId,path:schemaPath,isLeaf:true,supplierHub:{trail:[],ownerId:'owner',company}};
  await picker.chooseLive(choice);
  assert.equal(picker.selected.length,1,JSON.stringify(picker.alerts()));
  const selected=picker.selected[0];
  assert.notEqual(selected.id,old.id,'a live choice cannot relabel the previous company profile and retain its workbook');
  assert.equal(downloads,1);assert.deepEqual(selected.hubSchema.company,company);
  assert.deepEqual(selected.template,current.template);assert.deepEqual(selected.mappings,current.mappings);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(old.id),before);
  assert.ok(picker.calls.every(call=>call.method!=='PUT'));
  // With both company profiles present, another live selection reuses only the
  // current company's profile instead of becoming an ambiguous saved match.
  await picker.chooseLive(choice);assert.equal(picker.selected.length,2);
  assert.equal(picker.selected[1].id,selected.id);assert.equal(downloads,1);
  const nextUrl='https://detail.1688.com/offer/813724060929.html';
  const queued=await json(await h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({urls:[nextUrl],goal:'price',profileId:selected.id,expectedProfileRevision:selected.revision})})));
  const next=queued.jobs[0];assert.equal(next.context.category.id,selected.id);assert.deepEqual(next.context.category.hubSchema.company,company);assert.deepEqual(next.context.category.template,current.template);
  // Synthetic second identity of the recorded source, never a live second URL.
  const receipts=h.load('db/collection-results.ts'),receipt=await receipts.readCollectionResult('owner','job');
  await receipts.storeCollectionResult('owner',next.id,{...receipt.result,offerId:'813724060929',sourceUrl:nextUrl});
  const created=await json(await h.load('app/api/collection-jobs/[id]/product/route.ts').POST(new Request(`https://app.test/api/collection-jobs/${next.id}/product`,{method:'POST'}),{params:Promise.resolve({id:next.id})}));
  const draft=await h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(created.productId,(path,init)=>h.route(path,{method:init?.method??'GET',body:init?.body}),new AbortController().signal);
  assert.equal(draft.completed,true,draft.message);
  const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(created.productId).payload);
  const view=await json(await h.route(`/api/products/${created.productId}/quotation-fields`));
  assert.equal(view.categoryContext.profileId,selected.id);assert.ok(view.resolved.rows.every(row=>row.fields.title.value===content.seo.title.value));
  const source=await h.load('app/exports/quotation-source.ts').readMappedQuotationSource('owner',created.productId,null);
  assert.equal(source.profile.id,selected.id);assert.deepEqual(JSON.parse(JSON.stringify(source.profile.template)),current.template);
  assert.equal(source.profile.mappings.find(mapping=>mapping.field==='constant').constant,company.name+' 수동 검토값');
  assert.equal(existingWork(),originalWork);assert.deepEqual(h.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(old.id),before);
 }finally{h.close();}
});

test('a legacy profile without a recorded company retains its manually connected workbook during live selection',async()=>{
 const company=schemaCompanies[0],h=mobileIntakeHarness();
 try{
  const connection=await template(h,company),snapshot=hubSchemaSnapshot(company);
  const old=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'회사 미기록 수동 설정',categoryId:snapshot.categoryId,categoryPath:schemaPath,...connection});
  const api=h.load('app/api/category-profiles/route.ts');
  const picker=categoryPickerUI((path,init)=>api[init?.method??'GET'](new Request('https://app.test'+path,init)),{catalog:{
   loadLiveHubCategorySchema:async()=>snapshot,loadLiveHubCategoryTemplate:async()=>{throw Error('Legacy manual workbook must remain connected');},
  }});
  await picker.chooseLive({key:'live',categoryId:snapshot.categoryId,path:schemaPath,isLeaf:true,supplierHub:{trail:[],ownerId:'owner',company}});
  assert.equal(picker.selected.length,1,JSON.stringify(picker.alerts()));
  assert.equal(picker.selected[0].id,old.id);assert.equal(picker.selected[0].revision,old.revision+1);
  assert.deepEqual(picker.selected[0].template,connection.template);assert.deepEqual(picker.selected[0].mappings,connection.mappings);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM category_profiles').get().n,1);
 }finally{h.close();}
});
