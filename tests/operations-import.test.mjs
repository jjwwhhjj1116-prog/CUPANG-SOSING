import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {managedProductHarness,managedFixture} from './helpers/managed-products.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
function imports(){const h=managedProductHarness();return{h,...h.load('app/operations/import-file.ts')};}

test('quoted CSV/TSV preserves embedded delimiters, newlines and doubled quotes',()=>{
 const i=imports();try{
  assert.deepEqual(plain(i.parseDelimited('name,qty,memo\r\n"상품, 묶음",0,"첫줄\n둘째줄 ""인용"""\r\n')),[['name','qty','memo'],['상품, 묶음','0','첫줄\n둘째줄 "인용"']]);
  assert.deepEqual(plain(i.parseDelimited('상품명\t수량\n"탭\t포함"\t2')),[['상품명','수량'],['탭\t포함','2']]);
  assert.deepEqual(plain(i.parseDelimited('"탭\t제목",수량\n상품,1')),[['탭\t제목','수량'],['상품','1']]);
 }finally{i.h.close();}
});

test('malformed or unterminated quoted cells fail instead of silently dropping quote characters',()=>{
 const i=imports();try{
  for(const bad of ['name,qty\na"b"c,1','name,qty\n"abc"x,1','name,qty\n"never closes,1'])assert.throws(()=>i.parseDelimited(bad),/따옴표|인용|셀|CSV|형식/);
 }finally{i.h.close();}
});

test('column mapping keeps identifiers textual, distinguishes observed zero/null and rejects ambiguous indexes',()=>{
 const i=imports();try{
  const headers=['바코드','재고수량','공급가액','세액'],fields=[{key:'barcode',label:'바코드',required:true},{key:'stock',label:'재고',type:'number'},{key:'supply',label:'공급가',type:'number'},{key:'vat',label:'세액',type:'number'}],mapping=i.guessMapping(headers,fields);
  assert.deepEqual(plain(mapping),{barcode:'0',stock:'1',supply:'2',vat:'3'});
  const rows=i.mapImportRows(headers,[['000000012345678901','0','1,000','100'],['000000012345678902','','0','0']],fields,mapping,{});
  assert.equal(rows[0].barcode,'000000012345678901');assert.equal(rows[0].stock,0);assert.equal(rows[1].stock,null);assert.equal(rows[1].supply,0);
  assert.throws(()=>i.mapImportRows(headers,[['','0']],fields,mapping,{}),/바코드/);
  assert.throws(()=>i.mapImportRows(headers,[['0001','1']],fields,{barcode:'0',stock:'0'},{}),/중복/);
  for(const invalid of ['-1','0.5','4','NaN'])assert.throws(()=>i.mapImportRows(headers,[['0001','1']],fields,{barcode:'0',stock:invalid},{}),/열|연결|인덱스|범위/);
  const guessed=i.guessMapping(['합계'],[{key:'price',label:'판매가',type:'number'},{key:'total',label:'합계',type:'number'}]);assert.equal(new Set(Object.values(guessed).filter(Boolean)).size,1);
 }finally{i.h.close();}
});

test('file import handles UTF8 BOM, old XLS rejection and bounded row count',async()=>{
 const i=imports();try{
  const good=await i.readImportFile(new File(['\uFEFF바코드,재고\n0001,0'],'stock.csv',{type:'text/csv'}));assert.deepEqual(plain(good.headers),['바코드','재고']);assert.deepEqual(plain(good.rows),[['0001','0']]);
  await assert.rejects(i.readImportFile(new File(['x'],'legacy.xls')),/xlsx|CSV/);
  await assert.rejects(i.readImportFile(new File(['상품명\n'+Array.from({length:5001},(_,n)=>'SKU'+n).join('\n')],'oversize.csv')),/5,000/);
 }finally{i.h.close();}
});

test('actual OOXML reader preserves long text IDs and zero-valued inventory from an XLSX fixture',async()=>{
 const i=imports();try{
  const bytes=managedFixture(1,rows=>{rows[0].SKUID='000000123456789012345';rows[0]['옵션ID']='90071992547409931';rows[0]['재고']='0';});
  const read=await i.readImportFile(new File([bytes],'managed.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  assert.equal(read.rows.length,1);assert.equal(read.rows[0][read.headers.indexOf('SKUID')],'000000123456789012345');assert.equal(read.rows[0][read.headers.indexOf('옵션ID')],'90071992547409931');assert.equal(read.rows[0][read.headers.indexOf('재고')],'0');
 }finally{i.h.close();}
});

test('CSV export quotes separators and neutralizes formula strings while retaining numeric negative amounts',async()=>{
 const exports={},captures={};class URLStub extends URL{static createObjectURL(blob){captures.blob=blob;return'blob:test';}static revokeObjectURL(value){captures.revoked=value;}}
 const source=fs.readFileSync(new URL('../app/operations/import-file.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL:URLStub,Blob,document:{createElement(){const a={click(){captures.clicked=true;captures.name=a.download;}};return a;}},setTimeout(callback){callback();return 1;},require(){throw Error('No dependency needed for export');}});
 exports.downloadCsv('보고서',['text','amount'],[['=1+1',-1100],['+SUM(A1)',0],['-00123',null],['@command','쉼표,줄\n"인용"']]);
 const content=await captures.blob.text();assert.equal(captures.name,'보고서.csv');assert.equal(captures.clicked,true);assert.equal(captures.revoked,'blob:test');
 assert.match(content,/"'=1\+1","-1100"/);assert.match(content,/"'\+SUM\(A1\)"/);assert.match(content,/"'-00123",""/);assert.match(content,/"'@command","쉼표,줄\n""인용"""/);
});
