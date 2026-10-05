import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies} from './helpers/hub-schema.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';

const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const labels=['종류','소재','치수','취급시 주의사항'];
// The four exact notice names appear in the 69900 Single v188 schema and
// Excel v191 headers; the wires come from Single. This is a contract fixture, not a live
// Excel response or certification about the recorded supplier product.
function snapshot(company){
 const value=hubSchemaSnapshot(company,'69900'),raw=JSON.parse(value.schemaString);
 raw.properties.legalPage.properties.notices.allOf=labels.map(name=>({contains:{type:'object',properties:{noticeItemName:{type:'string',enum:[name],requirement:'필수'},noticeItemValue:{type:'string'}}}}));
 return {...value,schemaString:JSON.stringify(raw)};
}
for(const company of schemaCompanies)test(`saved fashion notices reach all six option rows and XLSX without replacing explicit blanks (${company.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const hubSchema=snapshot(company),profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'패션고시 연결 시험',categoryId:hubSchema.categoryId,categoryPath:hubSchema.categoryPath,hubSchema,template:null,mappings:[]},'cat');
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  let content=(await json(await h.route(base+'/content'))).content;
  const savedValues={productType:'사용자가 확인한 종류',material:'사용자가 확인한 전체 소재',dimensions:'140 × 45 mm',precautions:'사용자가 확인한 취급 주의사항'};
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{label:savedValues}}}));
  let view=await json(await h.route(base+'/quotation-fields'));
  const fields=Object.fromEntries(view.resolved.schema.fields.filter(field=>labels.includes(field.label)&&field.hubWire?.path[0]==='legalPage').map(field=>[field.label,field.id]));
  for(const row of view.resolved.rows.filter(row=>row.optionId))for(const [index,label]of labels.entries()){
   assert.equal(row.fields[fields[label]].value,Object.values(savedValues)[index],label);assert.equal(row.fields[fields[label]].source,'content');
  }
  const optionRows=view.resolved.rows.filter(row=>row.optionId);assert.equal(optionRows.length,6);
  content=(await json(await h.route(base+'/content'))).content;
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{label:{material:'',precautions:''},labelClears:['material','precautions']}}}));
  view=await json(await h.route(base+'/quotation-fields'));
  await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:fields['종류'],optionId:null,value:'견적 공통 수정'},{fieldKey:fields['종류'],optionId:optionRows[1].optionId,value:''}]}}));
  const source=h.load('app/exports/quotation-source.ts'),saved=await source.readQuotationExportSource('owner',product.id,profile.id),resolved=source.resolveQuotationExport(saved),rows=h.load('app/exports/quotation-fields.ts').resolvedQuotationRows(saved,resolved,[]);
  const bytes=quotationWorkbook(labels),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
  const output=await h.load('app/exports/mapped-quotation.ts').createMappedQuotation({originalBytes:bytes.buffer,profile:{...profile,template:{name:'notices.xlsx',format:'xlsx',sheetName:'견적서',headerRow:1,headers:labels,sha256},mappings:labels.map((label,column)=>({column,field:fields[label],required:true}))},rows,dataStartRow:2});
  const reader=h.load('app/xlsx-template.ts'),inspection=reader.inspectXlsxArchive(await reader.readXlsxArchive(output.bytes.buffer));
  for(let index=0;index<6;index++)assert.deepEqual(Array.from(reader.xlsxHeaders(inspection,'견적서',index+2)),[index===1?'':'견적 공통 수정','','140 × 45 mm','']);
  assert.equal(saved.company.code,company.code);assert.equal(saved.hubSchema.schemaString,hubSchema.schemaString);assert.equal(product.supplier_hub_status,'미전송');assert.ok(!h.network.includes('supplier.coupang.com'));
 }finally{h.close();}
});

test('fashion source bindings do not apply to similar labels, certificates, product attributes or scalar controls',()=>{
 const h=mobileIntakeHarness();try{
  const binding=h.load('app/quotation-notice-inputs.ts').quotationNoticeInput;
  for(const label of labels){const field={id:'live_69900_test',label,section:'legal',visibility:'common',type:'text',hubWire:{path:['legalPage','notices'],name:label,nameKey:'noticeItemName',valueKey:'noticeItemValue'}};
   assert.ok(binding(field));
   for(const other of [{...field,label:label+' 설명'},{...field,section:'product'},{...field,hubWire:{...field.hubWire,path:['legalPage','certificates']}},{...field,hubWire:{path:['legalPage','notice']}}])assert.equal(binding(other),undefined);
  }
 }finally{h.close();}
});
