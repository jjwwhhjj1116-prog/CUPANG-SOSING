import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {deflateRawSync} from 'node:zlib';
import {quotationWorkbook,workbookArchive} from './helpers/quotation-workbook.mjs';

const reader={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/xlsx-template.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:reader,Error,TextDecoder,Blob,DecompressionStream,Uint8Array,ArrayBuffer,DataView});
const original=quotationWorkbook(['상품명','공급가']);
const unwrap=bytes=>reader.unwrapOfficialXlsxDownload(bytes.buffer);

test('official download preserves exact direct and single wrapped workbook bytes, never selecting sidecars',async()=>{
 assert.deepEqual(new Uint8Array(await unwrap(original)),original);
 const wrapped=workbookArchive([['private/path/official.XLSX',original],['private/readme.txt','not workbook data']]);
 assert.deepEqual(new Uint8Array(await unwrap(wrapped)),original);
 assert.equal((await reader.inspectXlsx(await unwrap(wrapped))).sheets[0].name,'견적서');
});

test('official download rejects ambiguity, nesting, unsafe names and corrupt outer or inner bytes',async()=>{
 const nested=workbookArchive([['inner.xlsx',original]]);
 for(const entries of [[['readme.txt','no workbook']],[['one.xlsx',original],['two.XLSX',original]],[['nested.xlsx',nested]],[['../private.xlsx',original]]])await assert.rejects(unwrap(workbookArchive(entries)));
 const corruptOuter=workbookArchive([['one.xlsx',original]]);corruptOuter[38]^=1;
 await assert.rejects(unwrap(corruptOuter),/검증/);
 const corruptInner=original.slice();corruptInner[49]^=1;
 await assert.rejects(unwrap(workbookArchive([['one.xlsx',corruptInner]])),/검증/);
});

// Deflated fixture bytes are independently framed with real sizes and CRCs.
const crcTable=Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);return value>>>0;});
function deflatedArchive(entries){
 let offset=0;const locals=[],directory=[];
 for(const [path,value] of entries){
  const name=Buffer.from(path),content=Buffer.from(value),packed=deflateRawSync(content);let crc=0xffffffff;
  for(const byte of content)crc=(crc>>>8)^crcTable[(crc^byte)&255];crc=(crc^0xffffffff)>>>0;
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(content.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(content.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
  locals.push(local,name,packed);directory.push(central,name);offset+=local.length+name.length+packed.length;
 }
 const catalog=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(catalog.length,12);end.writeUInt32LE(offset,16);
 return new Uint8Array(Buffer.concat([...locals,catalog,end]));
}

test('outer and inner downloads share the 25MB expanded budget and each retains the 5MB file limit',async()=>{
 const entries=[...await reader.readXlsxArchive(original.buffer)],inner=deflatedArchive([...entries,['padding.bin',Buffer.alloc(9_000_000)]]);
 assert.deepEqual(new Uint8Array(await unwrap(inner)),inner);
 const wrapped=deflatedArchive([['one.xlsx',inner],['first.txt',Buffer.alloc(8_000_000)],['second.txt',Buffer.alloc(8_000_000)]]);
 assert.ok(wrapped.length<5_000_000);
 assert.equal((await reader.readXlsxArchive(wrapped.buffer)).size,3);
 await assert.rejects(unwrap(wrapped),/너무 큰 Excel/);
 const oversized=workbookArchive([...entries,['padding.bin',Buffer.alloc(5_000_000)]]);
 const smallWrapper=deflatedArchive([['one.xlsx',oversized]]);assert.ok(smallWrapper.length<5_000_000);
 await assert.rejects(unwrap(smallWrapper),/5MB/);
});
