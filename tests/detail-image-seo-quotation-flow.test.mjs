import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {downloadUI,companies,nodes,unzip} from './helpers/image-download-ui.mjs';

const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const plain=value=>JSON.parse(JSON.stringify(value));

/** Recorded source facts and local image bytes; actual editor handlers, API,
 * SQLite, XLSX and ZIP export. No live supplier request, upload or consent. */
async function fixture(company){
 const api=mobileIntakeHarness(company);
 try{
  const fields=api.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field=>field.id);
  const workbook=quotationWorkbook(fields),sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const storageKey=api.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');api.objects.set(storageKey,workbook);
  const profile=await api.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'합성 상세·SEO·견적 연동 검수',categoryId:'80719',categoryPath:api.context.category.categoryPath,
   template:{name:'synthetic-detail-seo.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  api.context.category=profile;api.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(api.context),'job');
  api.bindings.YOOFAM_DETAIL_IMAGE_SECRET='cd'.repeat(32);api.bindings.YOOFAM_DETAIL_IMAGE_ORIGIN='https://local-detail-seo-fixture.example';
  const put=api.bindings.FILES.put;api.bindings.FILES.put=async(key,bytes,options)=>{const result=await put(key,bytes,options);return result===null?null:api.bindings.FILES.head(key);};
  await api.intake();
  const original=api.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+original.id,keys=JSON.parse(original.image_keys);
  let content=(await json(await api.route(base+'/content'))).content;
  assert.equal(content.detailDescriptionLinked,true,'URL draft initially follows its SEO description');
  content=(await json(await api.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{description:'처음 검토한 설명'},assets:{main:[keys[0]],additional:[keys[1]],detailTop:[keys[2]],detail:[keys[3],keys[4],keys[5]],detailBottom:[keys[6]],label:[keys[7]],size:[keys[8]]}}}}))).content;
  const product={...original,updated_at:api.sqlite.prepare('SELECT updated_at FROM products').get().updated_at};
  const calls=[],request=async(url,init={})=>{calls.push({url,method:init.method??'GET',body:init.body?JSON.parse(init.body):null});assert.ok(url.startsWith(base+'/'),'editor uses only this local owned product');return api.route(url,{method:init.method??'GET',body:init.body});};
  const sources=()=>JSON.stringify(['collection_jobs','collection_context','collection_results','collection_source_supplements','collection_products','collection_images','product_options','category_profiles'].map(table=>api.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()));
  const sourceSnapshot=sources(),objects=new Map([...api.objects].map(([key,bytes])=>[key,Buffer.from(bytes)]));
  const networkStart=api.network.length,downloads=api.stats.downloads,aiRequests=api.aiSources.length;
  return{api,profile,product,base,keys,fields,content,calls,request,sources,sourceSnapshot,objects,networkStart,downloads,aiRequests};
 }catch(cause){api.close();throw cause;}
}

for(const company of companies)test(`image-only stage-five save keeps stage-one description linked through the exact XLSX for ${company.companyCode}`,async()=>{
 const f=await fixture(company);let ui;
 try{
  ui=downloadUI('app/components/product-content-editor.tsx','ProductContentEditor',{product:f.product,section:'이미지',focusedAssetRole:'detail'},f.request);await ui.idle();
  const initial=plain((await json(await f.api.route(f.base+'/content'))).content);
  await ui.click('이미지 5 상세에서 제외');
  assert.equal(f.calls.filter(call=>call.method==='PATCH').length,0,'removing an image stays a draft until save');
  await ui.click('상세 설명·이미지 저장');
  const photoWrites=f.calls.filter(call=>call.method==='PATCH');assert.equal(photoWrites.length,1);
  let content=(await json(await f.api.route(f.base+'/content'))).content;
  const afterPhoto=plain(content);
  assert.deepEqual(content.seo,initial.seo);assert.deepEqual(content.label,initial.label);
  for(const role of ['main','additional','detailTop','detailBottom','label','size'])assert.deepEqual(content.assets[role],initial.assets[role]);
  ui.close();ui=null;

  const updatedProduct={...f.product,updated_at:f.api.sqlite.prepare('SELECT updated_at FROM products').get().updated_at};
  ui=downloadUI('app/components/product-content-editor.tsx','ProductContentEditor',{product:updatedProduct,section:'SEO'},f.request);await ui.idle();
  const description=nodes(ui.render()).find(node=>node.type==='textarea'&&node.props.maxLength===20000);assert.ok(description,'actual stage-one SEO description control');
  const translated='한국어로 검토한 최종 설명 — 삭제한 사진을 다시 붙이지 않습니다.';
  description.props.onChange({target:{value:translated}});await ui.idle();await ui.click('SEO 저장');
  content=(await json(await f.api.route(f.base+'/content'))).content;
  assert.equal(content.seo.description.value,translated);
  assert.deepEqual(content.assets.detail.value,[f.keys[3],f.keys[5]]);

  const preview=await json(await f.api.route(f.base+'/quotation',{method:'POST',body:{action:'preview',profileId:f.profile.id}}));
  const descriptionColumn=f.fields.indexOf('detailHtml');assert.ok(descriptionColumn>=0);
  assert.equal(preview.report.company.code,company.companyCode);assert.equal(preview.report.company.name,company.companyName);
  assert.equal(preview.report.rowCount,6);assert.ok(preview.rows.every(row=>String(row[descriptionColumn]).includes(translated)),'every included option uses the reviewed Korean description');
  assert.deepEqual(photoWrites[0].body.patch,{assets:{detail:[f.keys[3],f.keys[5]]}},'an unchanged description is not a manual text instruction');
  assert.equal(afterPhoto.detailDescriptionLinked,true);assert.deepEqual(afterPhoto.detail,initial.detail);
  assert.equal(content.detailDescriptionLinked,true);assert.equal(f.api.load('app/product-content.ts').currentDetailContent(content).description.value,translated);
  const response=await f.api.route(f.base+'/quotation',{method:'POST',body:{action:'export',profileId:f.profile.id,fingerprint:preview.fingerprint}});
  assert.equal(response.status,200,await response.clone().text());const archive=unzip(await response.arrayBuffer());
  const document=JSON.parse(archive.get('quotation-fields.json')),plan=JSON.parse(archive.get('supplier-hub-upload-plan.json'));
  const reader=f.api.load('app/xlsx-template.ts'),xlsx=reader.inspectXlsxArchive(await reader.readXlsxArchive(archive.get(plan.quotation.file.filename)));
  for(let index=0;index<6;index++)assert.ok(String(reader.xlsxHeaders(xlsx,'견적서',index+2)[descriptionColumn]).includes(translated),'actual XLSX cell matches the preview');
  const references=plan.productImages.flatMap(item=>item.references);assert.ok(references.some(item=>item.fieldId==='detailImages'));
  assert.equal(plan.productImages.some(item=>item.key===f.keys[4]),false,'excluded source photo is absent from Hub attachments');
  assert.ok(document.rows.every(row=>row.fields.detailHtml.value.includes(translated)));
  assert.equal(f.sources(),f.sourceSnapshot,'collected source, captured category, original options and image rows stay unchanged');
  for(const [key,bytes]of f.objects)assert.deepEqual(Buffer.from(f.api.objects.get(key)),bytes,'original R2 bytes retained: '+key);
  assert.equal(f.api.sqlite.prepare('SELECT image_keys FROM products').get().image_keys,f.product.image_keys,'image exclusion does not delete source files');
  assert.equal(f.api.network.length,f.networkStart);assert.equal(f.api.stats.downloads,f.downloads);assert.equal(f.api.aiSources.length,f.aiRequests);
  assert.equal(f.api.sqlite.prepare('SELECT COUNT(*) AS n FROM supplier_hub_receipts').get().n,0);
  assert.equal(f.calls.some(call=>/supplier-hub|automation|translation|image-generation/.test(call.url)),false);
 }finally{ui?.close();f.api.close();}
});
