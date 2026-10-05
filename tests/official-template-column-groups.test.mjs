import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {schemaCompanies} from './helpers/hub-schema.mjs';
import {workbookArchive} from './helpers/quotation-workbook.mjs';

const path=['패션의류잡화','유니섹스/남녀공용 패션','공용 잡화','선글라스','남녀공용패션선글라스'];
const col=index=>{let result='';for(let value=index+1;value;value=Math.floor((value-1)/26))result=String.fromCharCode(65+(value-1)%26)+result;return result;};
const row=(number,values)=>`<row r="${number}">${values.map((value,index)=>`<c r="${col(index)}${number}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`;
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
// The real workbook's Q/AP columns share a label but belong to different
// merged groups. This compact fixture moves them to E/G to reject positional
// assumptions, and models separate Single/Excel contracts without live calls.
function fixture(company,{groups=true,overlap=false,wrongGroup=false,interiorLabel=false}={}){
 const raw={type:'object',required:['startPage','productPage','logisticsPage'],properties:{
  startPage:{type:'object',required:['productName','categoryPath'],properties:{productName:{type:'string',title:'상품명'},categoryPath:{type:'string',title:'카테고리'}}},
  productPage:{type:'object',required:['commonAttributes'],properties:{commonAttributes:{type:'object',required:['purchasePrice'],properties:{purchasePrice:{type:'integer',title:'공급가',minimum:1}}},unexposedAttributes:{type:'array',allOf:[{contains:{type:'object',properties:{attributeName:{type:'string',enum:['출시 연도']},attributeValue:{type:['string','null']}}}}]}}},
  legalPage:{type:'object',properties:{notices:{type:'array',allOf:[]}}},
  logisticsPage:{type:'object',required:['fashionYear','fashionSeason'],properties:{fashionYear:{type:'string',title:'출시 연도',enum:['2026','2025']},fashionSeason:{type:'string',title:'계절',enum:['사계절','봄']}}},
 }};
 const single={format:'supplier-hub-schema-v1',company,categoryId:'69900',categoryPath:path,observedAt:Date.now(),schemaString:JSON.stringify(raw),metadata:{kanCategoryId:2624,scopeType:'Retail_Categorized_Single',noticeNumber:4,version:188},inputBindings:'couplus-paths-v1',draftInitialization:'couplus-required-v1',settingsInitialization:'couplus-options-v1'};
 const excel={...single,metadata:{...single.metadata,scopeType:'Retail_Categorized_Excel',version:191}};
 const headers=['카테고리','상품명','공급가','브랜드','출시 연도','숨김 설명','출시 연도','계절',...Array.from({length:17},(_,i)=>'미연결 선택 '+i)],sheetName='QF_2624_group_test';
 const groupRow=['상품 기본 정보','','','',wrongGroup?'상품 이미지 정보':'비노출 속성',interiorLabel?'별도 그룹':'','시즌 속성',''];
 const sheet=`<worksheet><sheetData>${row(1,['','Retail_Categorized_Excel:Kan:2624:Notice4:Version191'])}${groups?row(4,groupRow):''}${row(5,headers)}${row(6,headers.map((_,i)=>[0,1,2,6,7].includes(i)?'필수':'선택'))}${row(7,headers.map(()=>'작성 안내'))}${row(8,headers.map((_,i)=>i===0?path.join('>')+' (69900)':'예시'))}${row(9,headers.map(()=>''))}</sheetData>${groups?`<mergeCells><mergeCell ref="A4:D4"/><mergeCell ref="E4:F4"/><mergeCell ref="G4:H4"/>${overlap?'<mergeCell ref="D4:G4"/>':''}</mergeCells>`:''}<dataValidations><dataValidation type="list" sqref="A9:A1008"><formula1>"${path.join('>')} (69900)"</formula1></dataValidation><dataValidation type="list" sqref="G9:G1008"><formula1>"2026,2025"</formula1></dataValidation></dataValidations></worksheet>`;
 const bytes=workbookArchive([['[Content_Types].xml','<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],['_rels/.rels','<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],['xl/workbook.xml',`<workbook xmlns:r="relationship"><sheets><sheet name="${sheetName}" r:id="one"/></sheets></workbook>`],['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],['xl/worksheets/sheet1.xml',sheet]]);
 return {single,excel,bytes,headers,sheetName};
}
for(const company of schemaCompanies)test(`official group mapping keeps hidden and logistics year values separate through API and XLSX (${company.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const f=fixture(company),form=new FormData();form.set('file',new File([f.bytes],'groups.xlsx'));form.set('schema',JSON.stringify(f.single));form.set('excelSchema',JSON.stringify(f.excel));
  const connected=await json(await h.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test/api/category-profiles/official-template',{method:'POST',body:form})),201);
  const fields=h.load('app/quotation-schema.ts').getQuotationSchema('69900',path,f.single).fields,hidden=fields.find(field=>field.label==='출시 연도'&&field.visibility==='hidden'),season=fields.find(field=>field.hubWire?.path.join('.')==='logisticsPage.fashionYear');
  assert.equal(connected.mappings.find(mapping=>mapping.column===4)?.field,hidden.id);
  assert.equal(connected.mappings.find(mapping=>mapping.column===6)?.field,season.id);
  assert.equal(connected.mappings.find(mapping=>mapping.column===4).required,false);assert.equal(connected.mappings.find(mapping=>mapping.column===6).required,true);
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'구역 연결',categoryId:'69900',categoryPath:path,hubSchema:f.single,template:connected.template,mappings:connected.mappings},'cat');
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;let view=await json(await h.route(base+'/quotation-fields'));
  const options=view.resolved.rows.filter(row=>row.optionId);assert.equal(options.length,6);
  await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:hidden.id,optionId:null,value:'2024'},{fieldKey:season.id,optionId:null,value:'2025'},{fieldKey:hidden.id,optionId:options[1].optionId,value:''}]}}));
  const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}}));
  assert.ok(!preview.report.missingRequired.some(cell=>cell.column===7));
  const download=await h.route(base+'/quotation',{method:'POST',body:{action:'download',profileId:profile.id,fingerprint:preview.fingerprint}});assert.equal(download.status,200,await download.clone().text());
  const reader=h.load('app/xlsx-template.ts'),output=reader.inspectXlsxArchive(await reader.readXlsxArchive(await download.arrayBuffer()));
  for(let i=0;i<6;i++){const cells=reader.xlsxHeaders(output,f.sheetName,9+i);assert.equal(cells[4],i===1?'':'2024');assert.equal(cells[6],'2025');}
  assert.deepEqual(h.objects.get(connected.template.storageKey),f.bytes);assert.equal(product.supplier_hub_status,'미전송');assert.ok(!h.network.includes('supplier.coupang.com'));
 }finally{h.close();}
});
test('missing, unsupported or ambiguous merged groups never resolve a duplicate label by column order',async()=>{
 const h=mobileIntakeHarness();try{
  for(const config of [{groups:false},{overlap:true},{wrongGroup:true},{interiorLabel:true}]){const f=fixture(schemaCompanies[0],config),result=await h.load('app/official-hub-template.ts').connectOfficialHubTemplate(f.bytes.buffer,f.single,f.excel);assert.equal(result.mappings.some(mapping=>mapping.column===4),false,JSON.stringify(config));}
 }finally{h.close();}
});
