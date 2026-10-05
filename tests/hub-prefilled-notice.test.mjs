import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {workbookArchive} from './helpers/quotation-workbook.mjs';

// Sanitized schema/OOXML structure observed in the 69900 official v191 file.
// Its instruction mentions a formula, but AW9:AW1008 contain this static value.
const notice='패션잡화(모자/벨트/액세서리 등)',path=['패션의류잡화','유니섹스/남녀공용 패션','공용 잡화','선글라스','남녀공용패션선글라스'];
const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
function snapshot(company,scope='Retail_Categorized_Single',version=188){
 const raw={type:'object',metadata:`scope:${scope};categoryId:2624;version:${version};leafCategoryName:선글라스;parentCategoryName:안경/선글라스;productNoticeName:${notice};productNoticeCategoryId:4`,properties:{
  startPage:{type:'object',required:['productName','categoryPath'],properties:{productName:{type:'string',title:'상품명'},categoryPath:{type:'string',title:'카테고리'}}},
  productPage:{type:'object',properties:{commonAttributes:{type:'object',required:['purchasePrice'],properties:{purchasePrice:{type:'string',title:'공급가'}}}}},
  legalPage:{type:'object',properties:{productNoticeName:{type:'string',title:'고시명',prefilled:true,minLength:1,requirement:'필수',examples:['해당 필드에 수식이 설정되어 있으므로 아무것도 입력하지 말아주세요.']}}},
 }};
 return {format:'supplier-hub-schema-v1',categoryId:'69900',categoryPath:path,company,observedAt:Date.now(),metadata:{kanCategoryId:2624,noticeNumber:4,scopeType:scope,version},schemaString:JSON.stringify(raw),inputBindings:'couplus-paths-v1',draftInitialization:'couplus-required-v1'};
}
const field=schema=>schema.fields.find(f=>JSON.stringify(f.hubWire?.path)===JSON.stringify(['legalPage','productNoticeName']));
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const column=index=>{let value='';for(let n=index+1;n;n=Math.floor((n-1)/26))value=String.fromCharCode(65+(n-1)%26)+value;return value;};
function workbook(formula=false,exampleCode='69900'){
 const headers=Array.from({length:59},(_,i)=>`시험 선택 항목 ${i}`);headers[1]='카테고리';headers[2]='상품명';headers[29]='공급가';headers[48]='고시명';
 const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;'),row=(number,values)=>`<row r="${number}">${values.map((value,index)=>`<c r="${column(index)}${number}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join('')}</row>`,category=path.join('>')+' (69900)',sheetName='QF_2624_시험분류';
 const rows=Array.from({length:7},(_,i)=>row(i+9,headers.map((_,column)=>column===48?notice:''))).join('');
 const example=exampleCode==='69900'?category:path.slice(0,-1).join('>')+`>남녀공용스포츠선글라스 (${exampleCode})`;
 const sheet=`<worksheet><sheetData>${row(1,['','Retail_Categorized_Excel:Kan:2624:Notice4:Version191'])}${row(5,headers)}${row(6,headers.map((_,i)=>[1,2,29,48].includes(i)?'필수':'선택'))}${row(7,headers.map(()=> '작성 안내'))}${row(8,headers.map((_,i)=>i===1?example:i===48?'수식이 설정되어 있으므로 입력하지 마세요.':'예시'))}${formula?rows.replace('<c r="AW9" t="inlineStr"><is><t>'+notice+'</t></is></c>','<c r="AW9"><f>1+1</f><v>2</v></c>'):rows}</sheetData><dataValidations count="1"><dataValidation type="list" allowBlank="true" sqref="B9:B1008"><formula1>"${category}"</formula1></dataValidation></dataValidations></worksheet>`;
 return {headers,sheetName,bytes:workbookArchive([['[Content_Types].xml','<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],['_rels/.rels','<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],['xl/workbook.xml',`<workbook xmlns:r="relationship"><sheets><sheet name="${sheetName}" r:id="one"/></sheets></workbook>`],['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],['xl/worksheets/sheet1.xml',sheet]])};
}

test('official example 69901 stays intact while export verifies the selected 69900 dropdown and full path',async()=>{
 const h=mobileIntakeHarness();try{
  const single=snapshot(companies[0]),original=workbook(false,'69901'),connected=await h.load('app/official-hub-template.ts').connectOfficialHubTemplate(original.bytes.buffer,single,snapshot(companies[0],'Retail_Categorized_Excel',191)),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',original.bytes)).toString('hex');
  const profile={name:'공식 예시 분리',categoryId:'69900',categoryPath:path,hubSchema:single,...connected,template:{...connected.template,name:'notice.xlsx',sha256}},schema=h.load('app/quotation-schema.ts').getQuotationSchema('69900',path,single),supply=schema.fields.find(f=>f.hubInput==='supplyPrice');
  const input={originalBytes:original.bytes,profile,dataStartRow:9,rows:[{title:'검토 상품',category:path.join(' > ')+' (69900)',[supply.id]:'12345',[field(schema).id]:notice}]},writer=h.load('app/exports/mapped-quotation.ts'),reader=h.load('app/xlsx-template.ts'),output=await writer.createMappedQuotation(input),inspection=reader.inspectXlsxArchive(await reader.readXlsxArchive(output.bytes));
  assert.match(reader.xlsxHeaders(inspection,original.sheetName,8)[1],/69901/);assert.equal(reader.xlsxHeaders(inspection,original.sheetName,9)[1],path.join('>')+' (69900)');assert.equal(reader.xlsxHeaders(inspection,original.sheetName,9)[48],notice);
  const {hubSchema:_hub,...legacy}=profile;void _hub;
  legacy.mappings=profile.mappings.map(mapping=>mapping.field===supply.id?{...mapping,field:'supplyPrice'}:mapping.field===field(schema).id?{...mapping,field:'constant',constant:notice}:mapping);
  await assert.rejects(writer.createMappedQuotation({...input,profile:{...legacy,categoryId:'69901'}}),/카테고리.*드롭다운/);
  await assert.rejects(writer.createMappedQuotation({...input,profile:{...legacy,categoryPath:[...path.slice(0,-1),'다른 분류']}}),/카테고리.*경로/);
 }finally{h.close();}
});

for(const company of companies)test(`prefilled notice metadata reaches actual draft API and XLSX while manual values/blanks win (${company.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const single=snapshot(company),excel=snapshot(company,'Retail_Categorized_Excel',191),original=workbook(),q=h.load('app/quotation-schema.ts'),definition=field(q.getQuotationSchema('69900',path,single));
  assert.equal(definition.schemaDefault,notice);assert.equal(definition.minLength,1);assert.equal(definition.readOnly,undefined);
  const connected=await h.load('app/official-hub-template.ts').connectOfficialHubTemplate(original.bytes.buffer,single,excel),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',original.bytes)).toString('hex'),storageKey=`owner/category-templates/${sha256}.xlsx`;
  assert.equal(connected.mappings.find(m=>m.column===48).field,definition.id);await h.bindings.FILES.put(storageKey,original.bytes,{customMetadata:{sha256,format:'xlsx'}});
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'공식 고시명',categoryId:'69900',categoryPath:path,hubSchema:single,...connected,template:{...connected.template,name:'notice.xlsx',sha256,storageKey}},'cat');h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;let view=await json(await h.route(base+'/quotation-fields'));
  for(const row of view.resolved.rows){assert.equal(row.fields[definition.id].value,notice);assert.equal(row.fields[definition.id].source,'schema');assert.deepEqual(row.fields[definition.id].validationIssues,[]);}
  const rows=view.resolved.rows.filter(r=>r.optionId),before=h.sqlite.prepare('SELECT payload FROM product_options').get().payload;
  view=await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:definition.id,optionId:rows[0].optionId,value:''},{fieldKey:definition.id,optionId:rows[1].optionId,value:'수동 확인 고시명'}]}}));
  assert.equal(view.resolved.rows.find(r=>r.optionId===rows[0].optionId).fields[definition.id].value,'');assert.equal(view.resolved.rows.find(r=>r.optionId===rows[0].optionId).fields[definition.id].source,'manual-option');assert.ok(view.resolved.rows.find(r=>r.optionId===rows[0].optionId).fields[definition.id].validationIssues.some(v=>v.includes('최소 1자')));
  const saved=await h.load('app/exports/quotation-source.ts').readQuotationExportSource('owner',product.id,profile.id),resolved=h.load('app/exports/quotation-source.ts').resolveQuotationExport(saved),data=h.load('app/exports/quotation-fields.ts').resolvedQuotationRows(saved,resolved,[]);
  const output=await h.load('app/exports/mapped-quotation.ts').createMappedQuotation({originalBytes:original.bytes,profile,rows:data,dataStartRow:9}),reader=h.load('app/xlsx-template.ts'),files=await reader.readXlsxArchive(output.bytes),inspection=reader.inspectXlsxArchive(files);
  assert.equal(reader.xlsxHeaders(inspection,original.sheetName,9)[48],'');assert.equal(reader.xlsxHeaders(inspection,original.sheetName,10)[48],'수동 확인 고시명');assert.equal(reader.xlsxHeaders(inspection,original.sheetName,11)[48],notice);assert.equal(reader.xlsxHeaders(inspection,original.sheetName,15)[48],notice);
  assert.equal(saved.hubSchema.schemaString,single.schemaString);assert.equal(h.sqlite.prepare('SELECT payload FROM product_options').get().payload,before);assert.equal(Buffer.from(await crypto.subtle.digest('SHA-256',original.bytes)).toString('hex'),sha256);
  const protectedFile=workbook(true),protectedSha=Buffer.from(await crypto.subtle.digest('SHA-256',protectedFile.bytes)).toString('hex');await assert.rejects(h.load('app/exports/mapped-quotation.ts').createMappedQuotation({originalBytes:protectedFile.bytes,profile:{...profile,template:{...profile.template,sha256:protectedSha}},rows:data,dataStartRow:9}),/수식 영역은 덮어쓸 수 없습니다/);
 }finally{h.close();}
});

test('notice metadata applies only to the exact prefilled wire and matching scope, kan, notice and version',()=>{
 const h=mobileIntakeHarness();try{
  const q=h.load('app/quotation-schema.ts'),valid=snapshot(companies[0]),get=(change)=>{const snap=structuredClone(valid),raw=JSON.parse(snap.schemaString);change?.(raw,snap);snap.schemaString=JSON.stringify(raw);return field(q.getQuotationSchema('69900',path,snap));};
  assert.equal(get().schemaDefault,notice);
  for(const change of [raw=>delete raw.metadata,raw=>raw.metadata={},raw=>raw.metadata+=';productNoticeName:중복',raw=>raw.metadata=raw.metadata.replace(';productNoticeCategoryId:4',';productNoticeCategoryId:5'),raw=>raw.metadata=raw.metadata.replace('categoryId:2624','categoryId:2625'),raw=>raw.metadata=raw.metadata.replace('version:188','version:191'),raw=>raw.metadata=raw.metadata.replace('Retail_Categorized_Single','Retail_Categorized_Excel'),raw=>raw.metadata=raw.metadata.replace(notice,''),raw=>raw.properties.legalPage.properties.productNoticeName.prefilled=false,raw=>raw.properties.legalPage.properties.productNoticeName.type=['string','null'],(_raw,snap)=>snap.metadata.productNoticeNumber=5]){
   const value=get(change);assert.equal(value.schemaDefault,undefined);assert.equal(value.minLength,1);assert.ok(q.quotationValueIssues(value,'').length);
  }
  assert.equal(get(raw=>raw.properties.legalPage.properties.productNoticeName.default='기존 명시 기본값').schemaDefault,'기존 명시 기본값');
  const sibling=structuredClone(valid),siblingRaw=JSON.parse(sibling.schemaString);siblingRaw.properties.legalPage.properties.other={...siblingRaw.properties.legalPage.properties.productNoticeName};sibling.schemaString=JSON.stringify(siblingRaw);
  const siblingField=q.getQuotationSchema('69900',path,sibling).fields.find(f=>f.hubWire?.path.at(-1)==='other');assert.equal(siblingField.schemaDefault,undefined);assert.ok(q.quotationValueIssues(siblingField,'').length);
 }finally{h.close();}
});
