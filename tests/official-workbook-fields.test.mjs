import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {workbookArchive} from './helpers/quotation-workbook.mjs';

const cache=new Map();
function load(file){
 if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,Blob,Response,TextEncoder,TextDecoder,Uint8Array,DataView,DecompressionStream,require(name){
  if(name.startsWith('@/'))return load(name.slice(2)+'.ts');
  if(name.startsWith('./'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');
  throw Error('Unexpected dependency: '+name);
 }});return exports;
}
const fields=load('app/official-workbook-fields.ts'),reader=load('app/xlsx-template.ts'),plain=value=>JSON.parse(JSON.stringify(value));
const column=index=>{let out='';for(let n=index+1;n;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;};
const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const row=(number,values)=>`<row r="${number}">${values.map((value,index)=>`<c r="${column(index)}${number}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join('')}</row>`;
const installationGuide='* 로켓설치 상품일 경우에는 설치지원방식을 선택하세요.(항목 중 택1)\n방문설치(출장장착) : 설치기사가 설치해주는 경우\n고객직접설치 : 고객이 직접 설치하는 경우';
const channelIdGuide='기존 채널 (3p)로 같은 상품이 등록되어 있는 경우 해당 상품의 벤더아이템 아이디를 입력합니다.';
// Synthetic public OOXML contract for the original three workbook-only columns.
// No captured workbook, schema, company session or production data is a fixture.
async function fixture({validationType='list',formula='_install',duplicateRule=false,duplicateName=false,list=['방문설치(출장장착)','고객직접설치'],sourceFormula=false,invalidReference=false,extra='',marker='조건부 필수',extraRule='',extraRuleChild='',extraRuleAttribute='',namespace=false,duplicateHeader=false}={}){
 const headers=Array.from({length:58},(_,index)=>index?'시험 연결 '+index:'');headers[1]='카테고리';headers[43]='설치지원방식';headers[56]='소싱 채널';headers[57]='소싱 채널 ID';
 if(duplicateHeader)headers[57]=typeof duplicateHeader==='string'?duplicateHeader:headers[56];
 const markers=headers.map((_header,index)=>index?'선택':'');markers[43]=marker;
 const guides=headers.map((_header,index)=>index?'작성 안내':'');guides[43]=installationGuide;guides[56]='해당 상품을 소싱한 채널을 나타냅니다.';guides[57]=channelIdGuide;
 const examples=headers.map((_header,index)=>index===1?'시험 대분류>시험 최종분류 (64455)':'예시');examples[43]='방문설치(출장장착)';examples[56]='Naver';examples[57]='N123';
 const sheetName='QF_1836_시험분류',rule=`<dataValidation type="${validationType}" sqref="${invalidReference?'broken': 'AR8:AR1008'}" allowBlank="true" showErrorMessage="false" ${extraRuleAttribute}><formula1>${escape(formula)}</formula1>${extraRuleChild}</dataValidation>`;
 let worksheet=`<worksheet><sheetData>${row(1,['','Retail_Categorized_Excel:Kan:1836:Notice38:Version193'])}${row(5,headers)}${row(6,markers)}${row(7,guides)}${row(8,examples)}${row(9,headers.map(()=>''))}</sheetData><dataValidations>${rule}${duplicateRule?rule:''}${extraRule}</dataValidations>${extra}</worksheet>`;
 if(namespace)worksheet=worksheet.replace(/(<\/?)(worksheet|sheetData|row|c|is|t|dataValidations|dataValidation|formula1)(?=[\s>])/g,'$1x:$2');
 const names=`<definedName name="_install">'HQF_list'!$A$2:$A$${list.length+1}</definedName>`;
 const entries=[
  ['[Content_Types].xml','<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
  ['_rels/.rels','<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml',`<workbook xmlns:r="relationship"><sheets><sheet name="${sheetName}" r:id="one"/><sheet name="HQF_list" r:id="two"/></sheets><definedNames>${names}${duplicateName?names:''}</definedNames></workbook>`],
  ['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="two" Type="x/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'],
  ['xl/worksheets/sheet1.xml',worksheet],
  ['xl/worksheets/sheet2.xml',`<worksheet><sheetData>${list.map((value,index)=>sourceFormula&&index===0?'<row r="2"><c r="A2"><f>"fabricated"</f><v>0</v></c></row>':row(index+2,[value])).join('')}</sheetData></worksheet>`],
 ];
 const bytes=workbookArchive(entries),files=await reader.readXlsxArchive(bytes.buffer),inspection=reader.inspectXlsxArchive(files),context={categoryId:'64455',sha256:createHash('sha256').update(bytes).digest('hex'),sheetName,headerRow:5,dataStartRow:9,headers};
 return {bytes,files,inspection,context,derive:(columns=[0,43,56,57])=>fields.deriveOfficialWorkbookFields(files,inspection,context,columns)};
}

test('original named list, guides and requirement markers derive exact manual fields with no example defaults',async()=>{
 const f=await fixture(),before=JSON.stringify(f.inspection),actual=plain(f.derive());
 assert.deepEqual(actual,[
  {id:`workbook_64455_${f.context.sha256}_43`,column:43,label:'설치지원방식',requirement:'conditional',help:installationGuide,type:'select',choices:['방문설치(출장장착)','고객직접설치']},
  {id:`workbook_64455_${f.context.sha256}_56`,column:56,label:'소싱 채널',requirement:'optional',help:'해당 상품을 소싱한 채널을 나타냅니다.',type:'text'},
  {id:`workbook_64455_${f.context.sha256}_57`,column:57,label:'소싱 채널 ID',requirement:'optional',help:channelIdGuide,type:'text'},
 ]);
 assert.equal(JSON.stringify(f.inspection),before);assert.ok(!actual.some(field=>'default' in field||'hubWire' in field));assert.ok(!actual[0].choices.includes(''));assert.ok(!actual[0].choices.includes('해당사항없음'));
 assert.deepEqual(plain(fields.validateOfficialWorkbookFields(actual,f.context)),actual);
 actual[0].choices[0]='client mutation';assert.equal(f.derive()[0].choices[0],'방문설치(출장장착)');
});

test('required and optional markers are exact; unknown markers do not become optional guesses',async()=>{
 for(const [marker,requirement] of [['필수','required'],['선택','optional'],['조건부 필수','conditional']]){const f=await fixture({marker});assert.equal(f.derive()[0].requirement,requirement);}
 const f=await fixture({marker:'선택으로 추정'});assert.deepEqual(Array.from(f.derive(),field=>field.column),[56,57]);
});

test('unsupported, ambiguous and formula-based list rules skip the affected field without text fallback',async()=>{
 for(const config of [
  {validationType:'whole',formula:'1'},{validationType:'textLength',formula:'5'},{validationType:'custom',formula:'TRUE'},
  {formula:'OFFSET(HQF_list!$A$2,0,0,2,1)'},{duplicateRule:true},{duplicateName:true},{sourceFormula:true},
  {list:['same','same']},{list:['same','SAME']},{extraRuleChild:'<formula2>4</formula2>'},{extraRuleAttribute:'unknownRule="yes"'},
 ]){const f=await fixture(config);assert.deepEqual(Array.from(f.derive(),field=>field.column),[56,57],JSON.stringify(config));}
 const f=await fixture({extraRule:'<dataValidation type="custom" sqref="BE9:BE1008"><formula1>TRUE</formula1></dataValidation>'});assert.deepEqual(Array.from(f.derive(),field=>field.column),[43,57]);
});

test('namespace tags, comments and inline lists keep exact choices while malformed ranges and extension rules stay unsupported',async()=>{
 const namespaced=await fixture({namespace:true,extra:'<!-- <dataValidation type="custom" sqref="BE9"/> -->'});assert.deepEqual(Array.from(namespaced.derive(),field=>field.column),[43,56,57]);
 const inline=await fixture({formula:'"방문설치(출장장착),고객직접설치"'});assert.deepEqual(Array.from(inline.derive()[0].choices),['방문설치(출장장착)','고객직접설치']);
 for(const config of [{invalidReference:true},{extra:'<extLst/>'},{extra:'<dataValidations/>'}]){const f=await fixture(config);assert.deepEqual(Array.from(f.derive()),[],JSON.stringify(config));}
});

test('descriptor validation rejects extra keys, wrong types, duplicates and SHA/category/column/header tampering',async()=>{
 const f=await fixture(),actual=plain(f.derive()),validate=value=>fields.validateOfficialWorkbookFields(value,f.context);
 for(const patch of [
  {id:'workbook_64455_'+f.context.sha256+'_44'},{id:'workbook_64455_'+f.context.sha256.slice(0,12)+'_43'},
  {id:'workbook_64456_'+f.context.sha256+'_43'},{column:'43'},{column:200},{column:-1},{column:43.5},
  {label:'설치 지원 방식'},{label:''},{requirement:'maybe'},{help:3},{type:'number'},
  {choices:[]},{choices:['a','a']},{choices:[3]},{default:'방문설치(출장장착)'},{hubWire:{path:['productPage','rocketInstallMethod']}},
 ])assert.throws(()=>validate([{...actual[0],...patch}]),undefined,JSON.stringify(patch));
 for(const key of ['id','column','label','requirement','help','type']){const changed={...actual[0]};delete changed[key];assert.throws(()=>validate([changed]),undefined,key);}
 assert.throws(()=>validate([actual[0],actual[0]]));assert.throws(()=>validate([{...actual[1],choices:['Naver']}]),undefined,'text cannot invent choices');
 for(const raw of [undefined,null,{},[null],[[]]])assert.throws(()=>validate(raw));
 for(const context of [{...f.context,sha256:'a'.repeat(63)},{...f.context,sha256:'A'.repeat(64)},{...f.context,categoryId:'64456'},{...f.context,headers:f.context.headers.map((value,index)=>index===43?'different':value)}])assert.throws(()=>fields.validateOfficialWorkbookFields(actual,context));
});

test('descriptor inputs and aggregate JSON are bounded and validated output owns its arrays',async()=>{
 const f=await fixture(),actual=plain(f.derive());
 for(const patch of [{help:'x'.repeat(8001)},{label:'x'.repeat(4001)},{choices:Array.from({length:501},(_,index)=>String(index))},{choices:['x'.repeat(4001)]}])assert.throws(()=>fields.validateOfficialWorkbookFields([{...actual[0],...patch}],f.context));
 assert.throws(()=>fields.validateOfficialWorkbookFields(Array.from({length:201},()=>actual[0]),f.context));
 const headers=Array.from({length:200},(_,index)=>'column '+index),context={...f.context,headers};
 const oversized=headers.map((label,column)=>({id:`workbook_64455_${context.sha256}_${column}`,column,label,requirement:'optional',help:'한'.repeat(1000),type:'text'}));assert.throws(()=>fields.validateOfficialWorkbookFields(oversized,context));
 const copied=fields.validateOfficialWorkbookFields(actual,f.context);actual[0].choices[0]='mutation';assert.equal(copied[0].choices[0],'방문설치(출장장착)');
 for(const columns of [[43,43],[-1],[58],[43.5]])assert.throws(()=>f.derive(columns));
 assert.deepEqual(Array.from(f.derive([])),[]);
});

test('derivation rejects changed headers, sheet and original entry rows instead of silently rebinding',async()=>{
 const f=await fixture();
 for(const patch of [{sheetName:'different'},{headerRow:4},{dataStartRow:10},{headers:f.context.headers.map((value,index)=>index===43?'different':value)}])assert.throws(()=>fields.deriveOfficialWorkbookFields(f.files,f.inspection,{...f.context,...patch},[43,56,57]));
});

test('duplicate normalized original headers remain unresolved rather than choosing a column by position',async()=>{
 for(const duplicateHeader of [true,'＊ 소싱　채널','소싱채널 *']){
  const f=await fixture({duplicateHeader});assert.deepEqual(Array.from(f.derive(),field=>field.column),[43]);
  const forged={id:`workbook_64455_${f.context.sha256}_56`,column:56,label:'소싱 채널',requirement:'optional',help:'guide',type:'text'};
  assert.throws(()=>fields.validateOfficialWorkbookFields([forged],f.context));
 }
});

test('descriptor validation loads independently without XLSX dependencies or TextDecoder',async()=>{
 const exports={},f=await fixture();
 const source=fs.readFileSync(new URL('../app/official-workbook-field-descriptors.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,TextEncoder,require(name){assert.fail('Descriptor validator must not import '+name);}});
 assert.deepEqual(plain(exports.validateOfficialWorkbookFields(plain(f.derive()),f.context)),plain(f.derive()));
});
