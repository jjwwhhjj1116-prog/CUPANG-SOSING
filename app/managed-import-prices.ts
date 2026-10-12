import {readXlsxArchive,inspectXlsxArchive} from '@/app/xlsx-template';
import {normalizedManagedImportDates,validManagedImportDate} from '@/app/managed-import-price-dates';
export {validManagedImportDate} from '@/app/managed-import-price-dates';
export const MANAGED_IMPORT_PRICE_FILE_LIMIT=5_000_000;
export type ManagedImportMatching='sku'|'barcode';
export type ManagedImportPriceInput={identifier:string;date:string;price:string;sourceRow:number};
export type ManagedImportPriceFile={matching:ManagedImportMatching;sha256:string;rows:ManagedImportPriceInput[]};
export type ManagedImportPriceRecord={skuId:string;title:string;exposureId:string;date:string;price:string};
export type ManagedImportPriceCounts={total:number;added:number;replaced:number;unchanged:number};
export class ManagedImportPriceConflict extends Error {}
export class ManagedImportPriceInputError extends Error {}
export const managedImportPriceHeaders={sku:['SKUID','매입일자(2025-01-01)','매입가'],barcode:['바코드','매입일자(2025-01-01)','매입가']} as const;
export const managedImportPriceTemplates={
 sku:{path:'/downloads/yoofam-plus-import-prices-skuid.xlsx',bytes:15964,sha256:'80cc291919572a2fc4dd81ee3a262c2f7da3196bc2ac1d24037b99a8eb8e433c'},
 barcode:{path:'/downloads/yoofam-plus-import-prices-barcode.xlsx',bytes:15968,sha256:'9b1394588cd1eb15ba304d9763455fcb659bf43a9eec594aa09858547243c4a5'},
} as const;
export async function managedImportPriceSha(bytes:ArrayBuffer|Uint8Array){const input=bytes instanceof Uint8Array?new Uint8Array(bytes).buffer:bytes;return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',input)),value=>value.toString(16).padStart(2,'0')).join('');}
/** Exact observed upload headers; no formula execution, guessed currency or raw purchase JSON. */
export async function parseManagedImportPrices(bytes:ArrayBuffer):Promise<ManagedImportPriceFile>{
 if(bytes.byteLength>MANAGED_IMPORT_PRICE_FILE_LIMIT)throw new RangeError('매입정보 파일은 5MB 이하만 지원합니다.');
 const files=await readXlsxArchive(bytes),view=inspectXlsxArchive(files,{rowLimit:5001});
 if(view.sheets.length!==1||view.sheets[0].name!=='매입가업로드양식'||view.warnings.some(value=>/수식|오류 셀|200열|병합/.test(value)))throw Error('수식·오류 셀 없이 원본 매입가업로드양식 시트에 값을 입력해주세요.');
 const sheet=view.sheets[0],header=sheet.rows.find(row=>row.rowNumber===1)?.values,matching=header?.[0]==='SKUID'?'sku':header?.[0]==='바코드'?'barcode':null;
 if(!matching||header?.length!==3||!managedImportPriceHeaders[matching].every((value,index)=>header[index]===value))throw Error('SKUID 또는 바코드 매입정보 양식의 원본 세 머리글을 유지해주세요.');
 const dates=normalizedManagedImportDates(files),seen=new Set<string>(),rows:ManagedImportPriceInput[]=[];
 for(const row of sheet.rows.filter(row=>row.rowNumber>1)){
  const [identifier='',rawDate='',price='']=row.values,date=dates.get(row.rowNumber)??rawDate;
  if(row.values.length>3||!identifier||identifier!==identifier.trim()||identifier.length>200||/[\u0000-\u001f\u007f]/.test(identifier)||matching==='sku'&&!/^\d{1,30}$/.test(identifier))throw Error(`${row.rowNumber}행의 ${matching==='sku'?'SKUID':'바코드'}를 원문 그대로 입력해주세요.`);
  if(!validManagedImportDate(date))throw Error(`${row.rowNumber}행의 매입일자를 YYYY-MM-DD 형식의 실제 날짜로 입력해주세요.`);
  if(price.length>64||!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(price)||!Number.isFinite(Number(price)))throw Error(`${row.rowNumber}행의 매입가를 0 이상 숫자로 입력해주세요. 0과 소수 금액을 지원합니다.`);
  const key=JSON.stringify([identifier,date]);if(seen.has(key))throw Error(`${row.rowNumber}행의 상품·매입일자가 파일 안에서 중복되었습니다.`);seen.add(key);rows.push({identifier,date,price,sourceRow:row.rowNumber});
 }
 if(!rows.length||rows.length>5000)throw Error('매입정보는 1~5000행의 값을 입력한 후 업로드해주세요.');
 return {matching,sha256:await managedImportPriceSha(bytes),rows};
}
