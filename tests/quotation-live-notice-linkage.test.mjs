import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies} from './helpers/hub-schema.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';

const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
// Exact notice names recorded in the sports forms, carried by a synthetic new
// category schema. This is no assertion about a sunglasses sales category.
function snapshot(company){
 const value=hubSchemaSnapshot(company),raw=JSON.parse(value.schemaString);
 const notice=name=>({contains:{type:'object',properties:{name:{type:'string',enum:[name]},value:{type:'string'}}}});
 raw.properties.legalPage.properties.notices.allOf=['품명 및 모델명','제품 구성','색상','크기, 중량','상품별 세부 사양','KC 인증정보'].map(notice);
 return {...value,schemaString:JSON.stringify(raw)};
}

for(const company of schemaCompanies)test(`saved stage-six notices and option colors reach a newly captured quotation and export (${company.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const hubSchema=snapshot(company),api=h.load('app/api/category-profiles/route.ts');
  const response=await api.POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({name:'시험 최종분류',categoryId:hubSchema.categoryId,categoryPath:hubSchema.categoryPath,template:null,mappings:[],hubSchema})}));
  assert.equal(response.status,201,await response.clone().text());const {profile}=await response.json();
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
  assert.match(await h.intake(),/상품 초안 저장됨/);
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  const read=suffix=>h.route(base+'/'+suffix).then(json);
  const content=(await read('content')).content;
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{label:{components:'검토한 구성 설명',dimensions:'검토한 크기·중량 설명',specifications:'검토한 세부 사양',kcInformation:''},labelClears:['kcInformation']}}}));
  const view=await read('quotation-fields'),fields=Object.fromEntries(view.resolved.schema.fields.filter(field=>field.section==='legal').map(field=>[field.label,field.id]));
  const options=(await read('options')).options;
  assert.equal(options.rows.length,6);
  for(const row of view.resolved.rows){
   for(const [label,value] of [['제품 구성','검토한 구성 설명'],['크기, 중량','검토한 크기·중량 설명'],['상품별 세부 사양','검토한 세부 사양'],['KC 인증정보','']]){
    assert.equal(row.fields[fields[label]].value,value,label);assert.equal(row.fields[fields[label]].source,'content',label);
   }
   if(row.optionId)assert.equal(row.fields[fields['색상']].value,options.rows.find(option=>option.id===row.optionId).color);
  }
  const sourceModule=h.load('app/exports/quotation-source.ts'),saved=await sourceModule.readQuotationExportSource('owner',product.id,profile.id);
  const resolved=sourceModule.resolveQuotationExport(saved),keys=h.load('app/exports/quotation-fields.ts').quotationAttachmentKeys(saved,resolved,'quotation');
  const assets=keys.map((key,index)=>({key,name:`image-${index}.png`,bytes:h.objects.get(key)}));
  const rows=h.load('app/exports/quotation-fields.ts').resolvedQuotationRows(saved,resolved,assets);
  assert.equal(rows.length,6);assert.equal(saved.company.code,company.code);assert.equal(saved.company.name,company.name);
  assert.equal(saved.hubSchema.schemaString,hubSchema.schemaString);
  const labels=['제품 구성','색상','크기, 중량','상품별 세부 사양','KC 인증정보'];
  const bytes=new TextEncoder().encode(h.load('app/pricing.ts').quotationCsv([labels])).buffer,sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
  const output=await h.load('app/exports/mapped-quotation.ts').createMappedQuotation({originalBytes:bytes,profile:{...profile,template:{name:'synthetic-notices.csv',format:'csv',sheetName:'',headerRow:1,headers:labels,sha256},mappings:labels.map((label,column)=>({field:fields[label],column,required:false}))},rows,dataStartRow:2});
  for(const [index,row]of output.values.entries())assert.deepEqual(Array.from(row),['검토한 구성 설명',options.rows[index].color,'검토한 크기·중량 설명','검토한 세부 사양','']);
  // A later stage-six explicit clear and stage-seven common/option corrections
  // remain authoritative; export must read the same final cells as the preview.
  const current=(await read('content')).content;
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:current.revision,patch:{label:{components:'',dimensions:''},labelClears:['components','dimensions']}}}));
  const next=await read('quotation-fields');
  const amended=await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:next.revision,expectedInputFingerprint:next.inputFingerprint,changes:[{fieldKey:fields['제품 구성'],optionId:null,value:'최종 견적 전용 구성'},{fieldKey:fields['제품 구성'],optionId:options.rows[1].id,value:''}]}}));
  const finalSaved=await sourceModule.readQuotationExportSource('owner',product.id,profile.id),finalResolved=sourceModule.resolveQuotationExport(finalSaved);
  const finalRows=h.load('app/exports/quotation-fields.ts').resolvedQuotationRows(finalSaved,finalResolved,assets);
  const workbook=quotationWorkbook(labels),workbookHash=Buffer.from(await crypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const xlsx=await h.load('app/exports/mapped-quotation.ts').createMappedQuotation({originalBytes:workbook.buffer,profile:{...profile,template:{name:'synthetic-notices.xlsx',format:'xlsx',sheetName:'견적서',headerRow:1,headers:labels,sha256:workbookHash},mappings:labels.map((label,column)=>({field:fields[label],column,required:false}))},rows:finalRows,dataStartRow:2});
  const reader=h.load('app/xlsx-template.ts'),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(xlsx.bytes.buffer));
  for(let index=0;index<6;index++){
   const expected=[index===1?'':'최종 견적 전용 구성',options.rows[index].color,'','검토한 세부 사양',''];
   assert.deepEqual(Array.from(xlsx.values[index]),expected);
   assert.deepEqual(Array.from(reader.xlsxHeaders(sheet,'견적서',index+2)),expected);
   const row=amended.resolved.rows.find(row=>row.optionId===options.rows[index].id);
   for(const [column,label]of labels.entries())assert.equal(row.fields[fields[label]].value,expected[column]);
  }
  assert.equal((await read('content')).content.label.components.value,'');
  assert.ok(!h.network.includes('supplier.coupang.com'));
 }finally{h.close();}
});

test('notice source hints use only complete named legal notices and leave similar or non-notice fields unchanged',()=>{
 const h=mobileIntakeHarness();try{
  const {quotationInputLink}=h.load('app/quotation-input-links.ts');
  const binding=h.load('app/quotation-notice-inputs.ts').quotationNoticeInput;
  const field={id:'live_991234_test',label:'제품 구성',section:'legal',visibility:'common',type:'text',hubWire:{path:['legalPage','notices'],nameKey:'name',valueKey:'value',name:'제품 구성'}};
  assert.equal(binding(field),'noticeComponents');assert.equal(quotationInputLink(field),'6단계 구성품');
  for(const other of [{...field,label:'제품 구성 안내',hubWire:{...field.hubWire,name:'제품 구성 안내'}},{...field,section:'product',visibility:'hidden'},{...field,hubWire:{path:['legalPage','labelContactAgreed']}},{...field,hubWire:{...field.hubWire,name:'별도 구성'}}]){
   assert.equal(binding(other),undefined);assert.equal(quotationInputLink(other),null);
  }
 }finally{h.close();}
});
