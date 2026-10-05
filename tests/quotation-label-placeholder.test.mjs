import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies} from './helpers/hub-schema.mjs';

const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
for(const company of schemaCompanies)test(`unattached named label images remain reviewable blanks instead of a foreign file key (${company.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const snapshot=hubSchemaSnapshot(company),raw=JSON.parse(snapshot.schemaString);
  // Exact named label-image shape from the captured Single 69900 schema.
  raw.properties.imagePage={type:'object',properties:{images:{type:'object',required:['labelImages'],properties:{labelImages:{type:'array',allOf:[{contains:{type:'object',properties:{labelImageType:{type:'string',enum:['제품 한글 표시사항 라벨 또는 도안 이미지'],requirement:'필수'},labelImageFiles:{type:['string','null']}}}}]}}}}};
  snapshot.schemaString=JSON.stringify(raw);
  const bytes=new TextEncoder().encode('상품명,표시사항 이미지\n'),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),storageKey=`owner/category-templates/${sha256}.csv`;
  await h.bindings.FILES.put(storageKey,bytes);
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'라벨 미첨부 검사',categoryId:snapshot.categoryId,categoryPath:snapshot.categoryPath,hubSchema:snapshot,template:{name:'labels.csv',format:'csv',sheetName:'',headerRow:1,headers:['상품명','표시사항 이미지'],sha256,storageKey},mappings:[{column:0,field:'title',required:true},{column:1,field:'labelImages',required:true}]},'cat');
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,preview=()=>h.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}}).then(json);
  const first=await preview();assert.equal(first.rows.length,6);assert.ok(first.rows.every(row=>row[1]===''));
  assert.equal(first.report.missingRequired.filter(cell=>cell.column===2).length,6);
  assert.ok(first.submissionReview.issues.some(issue=>issue.kind==='error'&&issue.fieldId==='labelImages'));
  const view=await json(await h.route(base+'/quotation-fields'));assert.ok(view.resolved.rows.every(row=>row.fields.labelImages.value===''));
  const rawBefore=JSON.stringify(h.sqlite.prepare('SELECT * FROM collection_context').all());
  let content=(await json(await h.route(base+'/content'))).content;
  const key=JSON.parse(product.image_keys)[0];assert.ok(key.startsWith('owner/'));
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{assets:{label:[key]}}}}));
  const attached=await preview();assert.ok(attached.rows.every(row=>row[1].endsWith('.png')));assert.ok(!attached.report.missingRequired.some(cell=>cell.column===2));
  content=(await json(await h.route(base+'/content'))).content;
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{assets:{label:[]}}}}));
  assert.ok((await preview()).rows.every(row=>row[1]===''));
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM collection_context').all()),rawBefore);assert.deepEqual(h.objects.get(storageKey),bytes);assert.ok(!h.network.includes('supplier.coupang.com'));
 }finally{h.close();}
});
