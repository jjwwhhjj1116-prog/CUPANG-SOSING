import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {createHash,webcrypto} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import ts from 'typescript';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const sha=bytes=>createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
const encode=value=>new TextEncoder().encode(value).buffer;
const column=index=>{let out='';for(let n=index+1;n;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;};
const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;');
const row=(number,values)=>`<row r="${number}">${values.map((value,index)=>`<c r="${column(index)}${number}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join('')}</row>`;

// Synthetic minimum QF layout, not a captured workbook or a commercial category.
// Every archive member is deflated so the save guard's decompressions are observable.
function officialWorkbook({kan='3000',category='991234',categoryPath=schemaPath,duplicateCategory=false,brokenMarkers=false,duplicateSheet=false,guidance='작성 안내'}={}){
 const headers=['상품명','카테고리','공급가',...Array.from({length:17},(_,index)=>'시험 선택 항목 '+index)];
 const categoryValue=categoryPath.join('>')+` (${category})`,sheetName=`QF_${kan}_시험분류`;
 const worksheet=`<worksheet><sheetData>${row(1,['',`Retail_Categorized_Excel:Kan:${kan}:Notice17:Version190`])}${row(5,headers)}${row(6,headers.map((_value,index)=>brokenMarkers?'unknown':index<3?'필수':'선택'))}${row(7,headers.map(()=>guidance))}${row(8,headers.map((_value,index)=>index===1?categoryValue:'예시'))}</sheetData><dataValidations count="1"><dataValidation type="list" allowBlank="true" sqref="B9:B1008"><formula1>"${categoryValue}${duplicateCategory?`,다른 경로 (${category})`:''}"</formula1></dataValidation></dataValidations></worksheet>`;
 const entries=[
  ['[Content_Types].xml','<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
  ['_rels/.rels','<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml',`<workbook xmlns:r="relationship"><sheets><sheet name="${sheetName}" r:id="one"/>${duplicateSheet?`<sheet name="${sheetName}_두번째" r:id="two"/>`:''}</sheets></workbook>`],
  ['xl/_rels/workbook.xml.rels',`<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/>${duplicateSheet?'<Relationship Id="two" Type="x/worksheet" Target="worksheets/sheet2.xml"/>':''}</Relationships>`],
  ['xl/worksheets/sheet1.xml',worksheet],...(duplicateSheet?[['xl/worksheets/sheet2.xml',worksheet]]:[]),
 ];
 const pieces=[],directory=[];let offset=0;
 for(const [name,text] of entries){
  const nameBytes=Buffer.from(name),bytes=Buffer.from(text),packed=deflateRawSync(bytes);let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(nameBytes.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(nameBytes.length,28);central.writeUInt32LE(offset,42);
  pieces.push(local,nameBytes,packed);directory.push(central,nameBytes);offset+=local.length+nameBytes.length+packed.length;
 }
 const catalog=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(catalog.length,12);end.writeUInt32LE(offset,16);
 const output=Buffer.concat([...pieces,catalog,end]);
 return {bytes:output.buffer.slice(output.byteOffset,output.byteOffset+output.byteLength),entryCount:entries.length,headers,sheetName};
}

function harness(){
 const cache=new Map(),stats={gets:0,byteReads:0,decompressions:0,inspections:0,genericInspections:0};let stored;
 class CountingDecompressionStream extends DecompressionStream {constructor(format){super(format);stats.decompressions++;}}
 const env={FILES:{async get(key){stats.gets++;if(!stored||stored.key!==key)return null;return {customMetadata:stored.metadata,async arrayBuffer(){stats.byteReads++;return stored.bytes.slice(0);}};}}};
 function load(file){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  const output=ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(output,{exports,Error,Date,Blob,Response,TextEncoder,TextDecoder,Uint8Array,DataView,structuredClone,crypto:webcrypto,DecompressionStream:CountingDecompressionStream,require(name){
   if(name==='cloudflare:workers')return {env};
   if(name.startsWith('@/'))return load(name.slice(2)+'.ts');
   if(name.startsWith('./')||name.startsWith('../'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');
   throw Error('Unexpected dependency: '+name);
  }});
  if(file==='app/xlsx-template.ts')for(const [name,stat] of [['inspectXlsxArchive','inspections'],['inspectXlsx','genericInspections']]){const original=exports[name];exports[name]=(...args)=>{stats[stat]++;return original(...args);};}
  return exports;
 }
 return {load,stats,reset(){for(const key of Object.keys(stats))stats[key]=0;},store(template,bytes,metadata={sha256:template.sha256,format:template.format}){stored={key:template.storageKey,bytes,metadata};}};
}

async function setup(company=schemaCompanies[0]){
 const h=harness(),original=officialWorkbook(),hubSchema={...hubSchemaSnapshot(company),metadata:{displayCategoryCode:'991234',kanCategoryId:3000,scopeType:'Retail_Categorized_Single',noticeNumber:17,version:189}};
 const official=h.load('app/official-hub-template.ts'),connected=await official.connectOfficialWorkbookTemplate(original.bytes,hubSchema),storage=h.load('db/category-templates.ts'),sha256=sha(original.bytes);
 const template={...plain(connected.template),name:'synthetic-official.xlsx',sha256,storageKey:storage.templateKey('owner',sha256,'xlsx')};
 h.store(template,original.bytes);h.reset();
 return {h,original,hubSchema,official,storage,template,profile:{name:'시험 연결',categoryId:hubSchema.categoryId,categoryPath:hubSchema.categoryPath,hubSchema,template,mappings:plain(connected.mappings)}};
}

for(const company of schemaCompanies)test(`official evidence save fully verifies one archive per request (${company.code})`,async()=>{
 const f=await setup(company),before=JSON.stringify(f.profile);
 for(let attempt=0;attempt<2;attempt++){
  f.h.reset();await f.storage.validateStoredTemplate('owner',f.template,f.hubSchema);
  assert.deepEqual(f.h.stats,{gets:1,byteReads:1,decompressions:f.original.entryCount,inspections:1,genericInspections:0},'each save checks the entire original archive exactly once; repeated saves do not trust a cache');
 }
 f.h.reset();const checked=await f.official.verifyOfficialWorkbookTemplate(f.original.bytes,f.profile);
 assert.deepEqual(plain(checked.evidence),f.template.workbookEvidence);assert.equal(f.h.stats.decompressions,f.original.entryCount);assert.equal(f.h.stats.inspections,1);
 assert.equal(f.profile.hubSchema.metadata.scopeType,'Retail_Categorized_Single');assert.equal(f.profile.hubSchema.metadata.version,189);assert.equal(checked.evidence.version,'190');assert.equal(checked.evidence.excelSchemaVerified,false);assert.equal(JSON.stringify(f.profile),before);
});

test('evidence saves reject every stale header, row and original evidence identity',async()=>{
 const f=await setup(),reject=async(template,label)=>assert.rejects(f.storage.validateStoredTemplate('owner',template,f.hubSchema),f.storage.TemplateValidationError,label);
 for(const patch of [{sheetName:'another sheet'},{headerRow:4},{dataStartRow:8},{headers:['변경된 상품명',...f.template.headers.slice(1)]},{format:'csv'}]){
  const template={...f.template,...patch};if(patch.format){template.storageKey=f.storage.templateKey('owner',template.sha256,template.format);f.h.store(template,f.original.bytes);}
  await reject(template,JSON.stringify(patch));f.h.store(f.template,f.original.bytes);
 }
 const stale={kind:'different-kind',excelSchemaVerified:true,templateSha256:'0'.repeat(64),sourceSchemaSha256:'0'.repeat(64),companyCode:schemaCompanies[1].code,companyName:schemaCompanies[1].name,categoryId:'991235',categoryPath:['다른 경로'],kanCategoryId:'3001',noticeNumber:'18',version:'189'};
 for(const [key,value] of Object.entries(stale))await reject({...f.template,workbookEvidence:{...f.template.workbookEvidence,[key]:value}},key);
 await reject({...f.template,workbookEvidence:{...f.template.workbookEvidence,extra:'forged proof'}},'extra evidence key');
 const missing={...f.template.workbookEvidence};delete missing.sourceSchemaSha256;await reject({...f.template,workbookEvidence:missing},'missing evidence key');
});

test('evidence saves retain Single, schema fingerprint, category, company and Kan checks',async()=>{
 const f=await setup(),snapshots=[
  undefined,{...f.hubSchema,schemaString:f.hubSchema.schemaString+' '},{...f.hubSchema,company:schemaCompanies[1]},
  {...f.hubSchema,categoryId:'991235',metadata:{...f.hubSchema.metadata,displayCategoryCode:'991235'}},
  {...f.hubSchema,categoryPath:['다른 대분류','시험 최종분류']},
  {...f.hubSchema,metadata:{...f.hubSchema.metadata,kanCategoryId:3001}},
  {...f.hubSchema,metadata:{...f.hubSchema.metadata,categoryId:3001}},
  {...f.hubSchema,metadata:{...f.hubSchema.metadata,scopeType:'Retail_Categorized_Excel'}},
  {...f.hubSchema,metadata:{...f.hubSchema.metadata,scope:'Retail_Categorized_Excel'}},
 ];
 for(const snapshot of snapshots)await assert.rejects(f.storage.validateStoredTemplate('owner',f.template,snapshot),f.storage.TemplateValidationError);
});

test('R2 ownership, exact storage key and metadata guards run before archive verification',async()=>{
 const f=await setup();
 for(const [owner,template,metadata] of [
  ['other',f.template],['owner',{...f.template,storageKey:undefined}],['owner',{...f.template,storageKey:f.template.storageKey.replace(/\.xlsx$/,'.csv')}],
  ['owner',f.template,{sha256:'0'.repeat(64),format:'xlsx'}],['owner',f.template,{sha256:f.template.sha256,format:'csv'}],
 ]){
  f.h.store(f.template,f.original.bytes,metadata);f.h.reset();await assert.rejects(f.storage.validateStoredTemplate(owner,template,f.hubSchema),f.storage.TemplateValidationError);assert.equal(f.h.stats.byteReads,0);assert.equal(f.h.stats.decompressions,0);
 }
 f.h.store({...f.template,storageKey:'missing'},f.original.bytes);f.h.reset();await assert.rejects(f.storage.validateStoredTemplate('owner',f.template,f.hubSchema),f.storage.TemplateValidationError);assert.equal(f.h.stats.byteReads,0);
});

test('matching R2 metadata and client evidence cannot approve changed bytes or invalid official layouts',async()=>{
 const f=await setup(),changed=officialWorkbook({guidance:'다른 원본 안내'});
 f.h.store(f.template,changed.bytes);await assert.rejects(f.storage.validateStoredTemplate('owner',f.template,f.hubSchema),f.storage.TemplateValidationError,'metadata SHA does not replace the original byte digest');
 for(const patch of [{category:'991235'},{categoryPath:['다른 경로']},{kan:'3001'},{duplicateCategory:true},{brokenMarkers:true},{duplicateSheet:true}]){
  const original=officialWorkbook(patch),sha256=sha(original.bytes),template={...f.template,sha256,storageKey:f.storage.templateKey('owner',sha256,'xlsx'),workbookEvidence:{...f.template.workbookEvidence,templateSha256:sha256}};
  f.h.store(template,original.bytes);await assert.rejects(f.storage.validateStoredTemplate('owner',template,f.hubSchema),f.storage.TemplateValidationError,JSON.stringify(patch));
 }
});

test('non-evidence XLSX, CSV and TSV saves retain their selected-row header checks',async()=>{
 const h=harness(),storage=h.load('db/category-templates.ts');
 for(const [format,bytes,sheetName] of [['xlsx',quotationWorkbook([' 상품명 ','공급가']).buffer,'견적서'],['csv',encode(' 상품명 ,공급가\n'), ''],['tsv',encode(' 상품명 \t공급가\n'),'']]){
  const sha256=sha(bytes),template={name:'plain.'+format,format,sha256,storageKey:storage.templateKey('owner',sha256,format),sheetName,headerRow:1,headers:['상품명','공급가']};
  h.store(template,bytes);h.reset();await storage.validateStoredTemplate('owner',template);assert.equal(h.stats.genericInspections,format==='xlsx'?1:0);
  await assert.rejects(storage.validateStoredTemplate('owner',{...template,headers:['다른 상품명','공급가']}),storage.TemplateValidationError);
 }
});
