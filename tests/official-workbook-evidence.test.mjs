import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {schemaCompanies} from './helpers/hub-schema.mjs';

const originalPath=new URL('../outputs/step573-official-sunglasses.zip',import.meta.url),schemaPath=new URL('../outputs/step573-live-69900-schema.json',import.meta.url);
const available=fs.existsSync(originalPath)&&fs.existsSync(schemaPath);
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const sha=async bytes=>Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
const path=['패션의류잡화','유니섹스/남녀공용 패션','공용 잡화','선글라스','남녀공용패션선글라스'];
// This local evidence test never commits the captured workbook/schema, queries
// a live company, or treats a Single response as an Excel response. The second
// company uses the same file contract with fixture authentication only.
for(const company of schemaCompanies)test(`actual official XLSX file evidence preserves Single, manual edits and unmapped OSRP (${company.code})`,{skip:!available},async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const reader=h.load('app/xlsx-template.ts'),zip=fs.readFileSync(originalPath),bytes=await reader.unwrapOfficialXlsxDownload(zip.buffer.slice(zip.byteOffset,zip.byteOffset+zip.byteLength));
  const hubSchema={format:'supplier-hub-schema-v1',categoryId:'69900',categoryPath:path,company,observedAt:Date.now(),schemaString:fs.readFileSync(schemaPath,'utf8'),metadata:{displayCategoryCode:'69900',kanCategoryId:2624,scopeType:'Retail_Categorized_Single',noticeNumber:4,version:188},draftInitialization:'couplus-required-v1',settingsInitialization:'couplus-options-v1',inputBindings:'couplus-paths-v1'};
  const official=h.load('app/api/category-profiles/official-template/route.ts'),categories=h.load('app/api/category-profiles/route.ts');
  const upload=async(action,snapshot=hubSchema)=>{const form=new FormData();form.set('file',new File([bytes],'official.xlsx'));form.set('schema',JSON.stringify(snapshot));if(action)form.set('action',action);return official.POST(new Request('https://app.test/api/category-profiles/official-template',{method:'POST',body:form}));};
  await json(await upload(),400);assert.equal(h.objects.size,0,'ordinary Single import still requires real Excel response');
  const connected=await json(await upload('workbook'),201),evidence=connected.template.workbookEvidence;
  assert.equal(evidence.excelSchemaVerified,false);assert.equal(evidence.kind,'official-workbook-v1');assert.equal(evidence.templateSha256,await sha(bytes));assert.equal(evidence.sourceSchemaSha256,await sha(new TextEncoder().encode(hubSchema.schemaString)));
  assert.equal(evidence.kanCategoryId,'2624');assert.equal(evidence.noticeNumber,'4');assert.equal(evidence.version,'191');assert.equal(evidence.companyCode,company.code);assert.equal(connected.report.ambiguousColumns.length,0);
  const input={name:'실제 공식 파일 검토',categoryId:'69900',categoryPath:path,hubSchema,template:connected.template,mappings:connected.mappings};
  const post=profile=>categories.POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(profile)}));
  for(const patch of [{version:'190'},{sourceSchemaSha256:'0'.repeat(64)},{companyCode:'A00000000'},{excelSchemaVerified:true}])await json(await post({...input,template:{...input.template,workbookEvidence:{...evidence,...patch}}}),400);
  const profile=(await json(await post(input),201)).profile;
  assert.equal(profile.hubSchema.metadata.version,188);assert.equal(profile.hubSchema.metadata.scopeType,'Retail_Categorized_Single');
  h.context.category=profile;h.context.settings.brand=company.name;h.sqlite.prepare("UPDATE collection_jobs SET goal='work' WHERE id='job'").run();h.sqlite.prepare("UPDATE collection_context SET payload=? WHERE job_id='job'").run(JSON.stringify(h.context));await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  let content=(await json(await h.route(base+'/content'))).content;
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'공식 파일로 검토한 수동 제목',description:''},label:{productType:'사용자 종류',material:'사용자 전체 소재',dimensions:'사용자 확인 치수',precautions:'사용자 확인 주의'}}}}));
  let fields=await json(await h.route(base+'/quotation-fields'));const material=fields.resolved.schema.fields.find(field=>field.label==='소재'&&field.hubWire?.path[0]==='legalPage');assert.ok(material);
  assert.equal((await json(await h.route(base+'/content'))).content.label.material.value,'사용자 전체 소재');
  for(const row of fields.resolved.rows)assert.equal(row.fields[material.id].value,'해당사항없음','initial legal-notice material remains independent of the edited label material');
  fields=await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:fields.revision,expectedInputFingerprint:fields.inputFingerprint,changes:[
   {fieldKey:material.id,optionId:null,value:'사용자 전체 소재'},{fieldKey:material.id,optionId:'collected-2',value:''},{fieldKey:'title',optionId:'collected-2',value:''},{fieldKey:'title',optionId:'collected-3',value:'사람이 별도로 지정한 견적 제목'},
  ]}}));
  for(const row of fields.resolved.rows){assert.equal(row.fields[material.id].value,row.optionId==='collected-2'?'':'사용자 전체 소재');assert.equal(row.fields[material.id].source,row.optionId==='collected-2'?'manual-option':'manual-common');}
  const expectedTitles=['공식 파일로 검토한 수동 제목, 유광 검정 / 선글라스','','사람이 별도로 지정한 견적 제목',
   '공식 파일로 검토한 수동 제목, 무광 검정 / 선글라스 + 005 케이스','공식 파일로 검토한 수동 제목, 무광 회색 / 선글라스','공식 파일로 검토한 수동 제목, 무광 회색 / 선글라스 + 005 케이스'];
  assert.deepEqual(Array.from((await h.load('db/product-options.ts').readProductOptions('owner',product.id)).rows,row=>row.translatedName),[
   '유광 검정 / 선글라스','유광 검정 / 선글라스 + 005 케이스','무광 검정 / 선글라스','무광 검정 / 선글라스 + 005 케이스','무광 회색 / 선글라스','무광 회색 / 선글라스 + 005 케이스']);
  assert.equal(fields.resolved.rows.find(row=>row.optionId==='collected-1').fields.title.source,'content');
  assert.equal(fields.resolved.rows.find(row=>row.optionId==='collected-2').fields.title.source,'manual-option');assert.equal(fields.resolved.rows.find(row=>row.optionId==='collected-3').fields.title.source,'manual-option');
  assert.equal((await json(await h.route(base+'/content'))).content.seo.title.value,'공식 파일로 검토한 수동 제목','quotation overrides preserve the exact common SEO base');
  const retained=()=>JSON.stringify(['products','product_options','product_content','product_quotation_fields','collection_context'].map(table=>h.sqlite.prepare('SELECT * FROM '+table).all())),before=retained();
  const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}}));
  assert.equal(preview.rows.length,6);assert.equal(preview.report.workbookEvidence.excelSchemaVerified,false);assert.equal(preview.report.submissionReady,false);
  const brand=fields.resolved.schema.fields.find(field=>field.hubWire?.path.join('.')==='productPage.brand'),brandColumn=profile.mappings.find(mapping=>mapping.field===brand.id).column;
  assert.equal(brand.type,'text');assert.equal(brand.choices,undefined);
  for(const row of preview.rows)assert.equal(row[brandColumn],company.name,'captured company brand remains the exact output');
  assert.equal(preview.report.warnings.filter(message=>/!F(?:9|10|11|12|13|14) \(브랜드\)/.test(message)&&message.includes('드롭다운')).length,6,'the original advisory list mismatch stays visible');
  assert.equal(preview.submissionReview.issues.filter(issue=>issue.code==='EXCEL_VALUE_INVALID'&&issue.fieldId===brand.id).length,0,'free text brand with disabled original error alert is advisory, not a transmission error');
  const materialColumn=profile.mappings.find(mapping=>mapping.field===material.id).column,titleColumn=profile.mappings.find(mapping=>mapping.field==='title').column;
  for(const [index,row]of preview.rows.entries()){assert.equal(row[titleColumn],expectedTitles[index]);assert.match(row[1],/\(69900\)$/);assert.equal(row[materialColumn],index===1?'':'사용자 전체 소재');}
  assert.ok(preview.report.missingRequired.some(item=>item.row===10&&item.column===titleColumn+1),'an explicit blank title remains an original required-cell warning');
  assert.ok(preview.report.mappingCoverage.some(field=>field.label==='공식 판매처 가격'&&field.workbookOnlyAutomatic===true));assert.ok(preview.submissionReview.issues.some(issue=>issue.code==='EXCEL_OPTIONAL_SINGLE_OMITTED'&&issue.kind==='review'));
  assert.ok(preview.report.missingRequired.length>0,'file-only download does not hide missing factual measurements/label images');
  const download=await h.route(base+'/quotation',{method:'POST',body:{action:'download',profileId:profile.id,fingerprint:preview.fingerprint}});assert.equal(download.status,200,await download.clone().text());
  const inspection=reader.inspectXlsxArchive(await reader.readXlsxArchive(await download.arrayBuffer()));
  for(const [index,title]of expectedTitles.entries())assert.equal(reader.xlsxHeaders(inspection,profile.template.sheetName,9+index)[titleColumn],title,'literal saved-option/quotation titles reach the original XLSX cells');
  assert.equal(reader.xlsxHeaders(inspection,profile.template.sheetName,10)[materialColumn],'');assert.match(reader.xlsxHeaders(inspection,profile.template.sheetName,9)[1],/\(69900\)$/);
  assert.deepEqual(h.objects.get(profile.template.storageKey),new Uint8Array(bytes));assert.equal(retained(),before);assert.equal(product.supplier_hub_status,'미전송');assert.ok(!h.network.includes('supplier.coupang.com'));
 }finally{h.close();}
});
