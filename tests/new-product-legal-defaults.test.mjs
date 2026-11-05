import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {collectionNewDraftFixture,forkCompanies} from './helpers/collection-new-draft.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const contentRow=(h,id)=>h.sqlite.prepare('SELECT * FROM product_content WHERE product_id=?').get(id);
const manual=h=>h.load('app/api/products/route.ts').POST(new Request('https://app.test/api/products',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sourceUrl:h.sourceUrl,sourcePriceCny:5.25,title:'새 URL 초안'})}));
function assertDefault(h,id){
 const product=h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(id),row=contentRow(h,id);
 assert.ok(row,'new products persist their own document choice instead of changing the legacy read fallback');
 const content=JSON.parse(row.payload);
 assert.deepEqual(content.legalDocuments,{applicability:'not-applicable',files:[]});
 assert.equal(row.owner_id,product.owner_id);assert.equal(row.revision,1);assert.equal(content.revision,1);
 assert.equal(content.updatedAt,product.created_at);assert.equal(row.updated_at,product.created_at);assert.equal(product.updated_at,product.created_at);
 return content;
}

for(const company of forkCompanies)test(`new URL and collected drafts persist the same editable document default (${company.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
 try{
  const {product}=await json(await manual(h),201);assertDefault(h,product.id);
  await json(await h.route('/api/collection-jobs/job/result',{method:'POST',body:{schemaVersion:1,sourceUrl:h.sourceUrl,provider:'synthetic-document-default',collectedAt:new Date().toISOString(),title:'새 수집 초안',description:'수집 설명',attributes:[],options:[{sku:'first',name:'첫 옵션',unitPriceCny:5,minimumOrder:1,stock:3}],images:[]}}));
  const created=await json(await h.route('/api/collection-jobs/job/product',{method:'POST'})),collected=h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(created.productId);assert.ok(collected);assertDefault(h,collected.id);
  const endpoint='/api/products/'+collected.id+'/legal-documents',api=h.load('app/api/products/[id]/legal-documents/route.ts'),context={params:Promise.resolve({id:collected.id})};
  const saved=await json(await api.PATCH(new Request('https://app.test'+endpoint,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:1,applicability:'required'})}),context));
  assert.equal(saved.documents.applicability,'required');assert.deepEqual(saved.documents.files,[]);
  const issues=h.load('app/legal-documents.ts').legalDocumentSubmissionIssues(saved.documents.applicability,saved.documents.files.length);assert.equal(issues[0].code,'LEGAL_DOCUMENT_MISSING');
  assert.equal(JSON.parse(contentRow(h,product.id).payload).legalDocuments.applicability,'not-applicable');
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n,0);assert.deepEqual(h.network,[]);
 }finally{h.close();}
});

test('creating a fresh product and retrying collection preserve explicit and missing legacy document states',async()=>{
 const h=mobileIntakeHarness();
 try{
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get(),initial=JSON.parse(contentRow(h,product.id).payload),reader=h.load('db/product-content.ts'),legal=h.load('app/legal-documents.ts');
  for(const value of [{applicability:'required',files:[]},{applicability:'unconfirmed',files:[]},{applicability:'not-applicable',files:[]},undefined,null]){
   const content=plain(initial);if(value===undefined)delete content.legalDocuments;else content.legalDocuments=value;
   h.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(content),product.id);
   const before=JSON.stringify(contentRow(h,product.id)),clock=h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(product.id).updated_at;
   const {product:fresh}=await json(await manual(h),201);assertDefault(h,fresh.id);
   const retry=await json(await h.route('/api/collection-jobs/job/product',{method:'POST'}));assert.equal(retry.reused,true);
   const current=await reader.readProductContent('owner',product.id);assert.deepEqual(plain(current.legalDocuments??null),value??null);
   if(value===undefined)assert.equal(legal.readLegalDocuments(current.legalDocuments,'owner',product.id).applicability,'unconfirmed');
   else if(value===null)assert.throws(()=>legal.readLegalDocuments(current.legalDocuments,'owner',product.id),/서류 목록/);
   else assert.equal(legal.readLegalDocuments(current.legalDocuments,'owner',product.id).applicability,value.applicability);
   assert.equal(JSON.stringify(contentRow(h,product.id)),before);assert.equal(h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(product.id).updated_at,clock);
  }
  h.sqlite.prepare('DELETE FROM product_content WHERE product_id=?').run(product.id);
  const before=await reader.readProductContent('owner',product.id);assert.equal(Object.hasOwn(before,'legalDocuments'),false);
  assert.equal(legal.readLegalDocuments(before.legalDocuments,'owner',product.id).applicability,'unconfirmed');
  const {product:fresh}=await json(await manual(h),201);assertDefault(h,fresh.id);
  await json(await h.route('/api/collection-jobs/job/product',{method:'POST'}));assert.equal(contentRow(h,product.id),undefined);
  assert.equal(Object.hasOwn(h.load('app/product-content.ts').emptyProductContent('legacy'),'legalDocuments'),false);
 }finally{h.close();}
});

for(const company of forkCompanies)test(`a fresh retained-source draft gets N/A without copying the source's required choice (${company.code})`,async()=>{
 const f=await collectionNewDraftFixture(company,{images:false});
 try{
  const source=JSON.parse(contentRow(f.api,f.sourceProductId).payload);source.legalDocuments={applicability:'required',files:[]};
  f.api.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(source),f.sourceProductId);
  const original=f.originalSnapshot(),preview=await f.preview(),requestId=crypto.randomUUID(),created=await f.create(preview,f.input,requestId);
  assertDefault(f.api,created.productId);assert.equal(f.originalSnapshot(),original);
  const before=JSON.stringify(contentRow(f.api,created.productId)),retry=await f.create(preview,f.input,requestId);assert.equal(retry.reused,true);assert.equal(JSON.stringify(contentRow(f.api,created.productId)),before);
 }finally{f.close();}
});

test('an ignored historical product insert cannot backfill its missing document choice',async()=>{
 const h=mobileIntakeHarness();
 try{
  const {product}=await json(await manual(h),201);h.sqlite.prepare('DELETE FROM product_content WHERE product_id=?').run(product.id);
  h.sqlite.exec('CREATE TRIGGER ignore_product_collision BEFORE INSERT ON products BEGIN SELECT RAISE(IGNORE); END');
  const before=JSON.stringify(h.sqlite.prepare('SELECT * FROM products').all());
  await assert.rejects(()=>h.load('db/queries.ts').insertProduct(product));
  assert.equal(contentRow(h,product.id),undefined);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM products').all()),before);
 }finally{h.close();}
});

for(const failure of ['IGNORE','ABORT'])test(`new URL content initialization ${failure} rolls back the entire product creation`,async()=>{
 const h=mobileIntakeHarness();
 try{
  const action=failure==='ABORT'?"ABORT,'synthetic content failure'":'IGNORE';
  h.sqlite.exec(`CREATE TRIGGER fail_new_content BEFORE INSERT ON product_content BEGIN SELECT RAISE(${action}); END`);
  await json(await manual(h),503);
  for(const table of ['products','product_content','product_labels','product_price_policy','product_registration_numbers'])assert.equal(h.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,0,table);
 }finally{h.close();}
});
