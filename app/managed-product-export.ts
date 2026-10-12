import type {ManagedProduct} from '@/app/managed-products';
import {MANAGED_PRODUCT_FILE_LIMIT} from '@/app/managed-products';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
import type {ManagedImportPriceRecord} from '@/app/managed-import-prices';
import {zipFiles,utf8ByteLength} from '@/app/exports/zip';
// Protect literal escape-shaped text first. Encode accepted XML-forbidden code
// units before UTF-8 so controls/lone surrogates survive the importer unchanged.
const xml=(value:string)=>value.replace(/_x[\da-f]{4}_/gi,match=>'_x005F_'+match.slice(1)).replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,value=>`_x${value.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0')}_`).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll('\r','&#13;').replaceAll('\n','&#10;').replaceAll('\t','&#9;');
const column=(index:number)=>{let result='';for(let value=index+1;value;value=Math.floor((value-1)/26))result=String.fromCharCode(65+(value-1)%26)+result;return result;};
/** Owned original fields, literal inline strings and the source import sheet.
 * This file is a data export, not a newly collected supplier database. */
export function managedProductWorkbook(products:readonly ManagedProduct[],company:SupplierHubCompany):Uint8Array<ArrayBuffer>{
 if(!products.length||products.length>5000)throw new RangeError('다운로드할 상품이 없거나 필터 결과가 5000개를 초과합니다.');
 const headers:string[]=[];for(const product of products){if(product.companyCode!==company.code)throw Error('다른 회사의 상품 DB를 내보낼 수 없습니다.');for(const key of Object.keys(product.values)){if(!headers.includes(key))headers.push(key);}}
 if(headers.some(key=>!key||key!==key.trim()||key.length>100||['__proto__','constructor','prototype'].includes(key)))throw Error('저장된 상품 DB의 머리글을 확인해주세요.');
 const companyFields=['회사코드','Company Code','companyCode'].filter(key=>headers.includes(key));if(!companyFields.length)headers.push('회사코드');
 const includeImports=products.some(product=>product.importPrices?.length);if(includeImports){if(['YOOFAM 매입내역','YOOFAM 적용 매입일자','YOOFAM 적용 매입가'].some(key=>headers.includes(key)))throw Error('같은 이름의 매입내역 원문 열이 있습니다. 원본을 확인해주세요.');headers.push('YOOFAM 적용 매입일자','YOOFAM 적용 매입가');}
 if(headers.length>80)throw new RangeError('상품 DB의 원문 열 수가 다운로드 한도를 초과했습니다.');
 const rows=[headers,...products.map(product=>headers.map(key=>{const value=includeImports&&key==='YOOFAM 적용 매입일자'?product.latestImportedPrice?.date??'':includeImports&&key==='YOOFAM 적용 매입가'?product.latestImportedPrice?.price??'':(key==='회사코드'||companyFields.includes(key))&&!Object.hasOwn(product.values,key)?company.code:product.values[key]??'';if(typeof value!=='string'||value.length>20000||value.includes('\u0000'))throw Error('저장된 원문 값을 확인해주세요.');if(companyFields.includes(key)&&value.trim()!==company.code)throw Error('원문 회사코드와 현재 회사가 다릅니다.');return value;}))];
 return literalManagedWorkbook(rows,'로켓배송상품DB');
}
/** Complete current owned ledger, separate from the original supplier DB. */
export function managedImportPricesWorkbook(records:readonly ManagedImportPriceRecord[]):Uint8Array<ArrayBuffer>{
 if(records.length>5000)throw new RangeError('매입내역이 5000개를 초과합니다. 검색 조건을 좁혀주세요.');
 const rows=[['노출ID','SKU ID','상품명','매입일자','매입가'],...records.map(record=>[record.exposureId,record.skuId,record.title,record.date,record.price])];
 if(rows.some(row=>row.some(value=>typeof value!=='string'||value.length>20000||value.includes('\u0000'))))throw Error('저장된 매입내역 값을 확인해주세요.');
 return literalManagedWorkbook(rows,'YOOFAM 매입내역');
}
function literalManagedWorkbook(rows:string[][],sheetName:string):Uint8Array<ArrayBuffer>{
 let size=0;const encoder=new TextEncoder();for(const row of rows){size+=encoder.encode(JSON.stringify(row)).byteLength;if(size>3_000_000)throw new RangeError('원문 내용이 상품 DB 다운로드 한도를 초과했습니다.');}
 const sheet='<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+rows.map((row,index)=>`<row r="${index+1}">`+row.map((value,at)=>`<c r="${column(at)}${index+1}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('')+'</row>').join('')+'</sheetData></worksheet>';
 if(utf8ByteLength(sheet)>MANAGED_PRODUCT_FILE_LIMIT)throw new RangeError('상품 DB 파일은 5MB 이하만 다운로드할 수 있습니다. 필터 조건을 좁혀주세요.');
 const bytes=zipFiles([
  {name:'[Content_Types].xml',data:'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'},
  {name:'_rels/.rels',data:'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
  {name:'xl/workbook.xml',data:`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="one"/></sheets></workbook>`},
  {name:'xl/_rels/workbook.xml.rels',data:'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="one" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'},
  {name:'xl/worksheets/sheet1.xml',data:sheet},
 ]);if(bytes.byteLength>MANAGED_PRODUCT_FILE_LIMIT)throw new RangeError('상품 DB 파일은 5MB 이하만 다운로드할 수 있습니다. 필터 조건을 좁혀주세요.');return bytes;
}
