import JsBarcode from 'jsbarcode';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';

export type ManagedBarcodeField = string | number | boolean;
export type ManagedBarcodeLabel = {source:'product'|'purchase-info-original'|'purchase-info-manual';index:number|null;fields:Record<string,ManagedBarcodeField>};
export type ManagedProductBarcodeView = {skuId:string;company:SupplierHubCompany;accountContext:string;sourceVersion:string;product:{title:string;barcode:string};labelInfo:ManagedBarcodeLabel[];sourceName:string;sourceRow:number;importedAt:string};
export class ManagedProductBarcodeError extends Error {constructor(message:string,public status=400,public code='MANAGED_PRODUCT_BARCODE_INVALID'){super(message);}}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:readonly string[])=>Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(value);
const timestamp=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const fieldKey=(key:string)=>!!key&&text(key,100)&&!['__proto__','constructor','prototype'].includes(key);
const sourceInvalid=()=>new ManagedProductBarcodeError('저장된 표시사항의 텍스트·숫자 또는 출력 범위를 확인해주세요.',409,'MANAGED_PRODUCT_BARCODE_SOURCE_INVALID');
function flatField(key:string,item:unknown):item is ManagedBarcodeField {
 if(!fieldKey(key)||typeof item==='string'&&!text(item,2000)||typeof item==='number'&&!Number.isFinite(item))throw sourceInvalid();
 return typeof item==='string'||typeof item==='boolean'||typeof item==='number';
}
function barcodeValue(value:unknown):string {
 if(typeof value!=='string'||!value.length||value.length>128||!/[\x21-\x7e]/u.test(value)||/[^\x20-\x7e]/u.test(value))throw new ManagedProductBarcodeError('저장된 바코드는 1~128자의 영문·숫자·기호여야 합니다. 원문 바코드를 확인해주세요.');
 return value;
}
/** Only flat, already saved label facts become printable text. Nested provider
 * extensions and damaged legacy strings cannot invent a label or certification. */
export function projectManagedBarcodeLabel(value:unknown):Record<string,ManagedBarcodeField>|null {
 let saved=value;if(typeof saved==='string'){try{saved=JSON.parse(saved);}catch{return null;}}
 if(!object(saved))return null;
 const entries=Object.entries(saved).filter((entry):entry is [string,ManagedBarcodeField]=>flatField(entry[0],entry[1]));
 if(entries.length>100)throw new ManagedProductBarcodeError('저장된 표시사항의 출력 항목이 너무 많습니다.',409,'MANAGED_PRODUCT_BARCODE_SOURCE_INVALID');
 return entries.length?Object.fromEntries(entries):null;
}
export const managedBarcodeProductLabelFields=['수입원/판매원','제조원','제조국','내용량','원료명및성분명(재질)','상품유형','사용시주의사항','사용기준'] as const;
/** Observed Couplus fields are read only when saved. An explicit flat blank
 * wins over a nested value; no company, origin or certification is inferred. */
export function projectManagedBarcodeProductLabel(values:Record<string,unknown>):Record<string,ManagedBarcodeField>|null {
 const fields=projectManagedBarcodeLabel(values['한글표시사항'])??{};
 for(const key of managedBarcodeProductLabelFields)if(Object.hasOwn(values,key)){const value=values[key];if(!flatField(key,value))throw sourceInvalid();fields[key]=value;}
 return Object.keys(fields).length?fields:null;
}
export function validateManagedProductBarcodeView(value:unknown,expected:{skuId:string;company:SupplierHubCompany;accountContext:string}):ManagedProductBarcodeView {
 if(!object(value)||!exact(value,['skuId','company','accountContext','sourceVersion','product','labelInfo','sourceName','sourceRow','importedAt'])
  ||value.skuId!==expected.skuId||!/^\d{1,30}$/u.test(expected.skuId)||!object(value.company)||!exact(value.company,['code','name'])||value.company.code!==expected.company.code||value.company.name!==expected.company.name
  ||!digest(value.accountContext)||value.accountContext!==expected.accountContext||!digest(value.sourceVersion)||!object(value.product)||!exact(value.product,['title','barcode'])||!text(value.product.title,2000)||!value.product.title
  ||!text(value.sourceName,512)||!Number.isSafeInteger(value.sourceRow)||(value.sourceRow as number)<2||(value.sourceRow as number)>5001||!timestamp(value.importedAt)
  ||!Array.isArray(value.labelInfo)||value.labelInfo.length>101)throw new ManagedProductBarcodeError('바코드 조회 결과의 SKU·회사·원본 범위를 확인하지 못했습니다.',409,'MANAGED_PRODUCT_BARCODE_CONFLICT');
 barcodeValue(value.product.barcode);
 const labels:ManagedBarcodeLabel[]=[],positions=new Set<string>();
 for(const label of value.labelInfo){
  if(!object(label)||!exact(label,['source','index','fields'])||!['product','purchase-info-original','purchase-info-manual'].includes(String(label.source))||!object(label.fields)||!Object.keys(label.fields).length||Object.keys(label.fields).length>100
   ||(label.source==='product'?label.index!==null:!Number.isSafeInteger(label.index)||(label.index as number)<0||(label.index as number)>99)
   ||Object.entries(label.fields).some(([key,item])=>!fieldKey(key)||!(typeof item==='string'&&text(item,2000)||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))))throw new ManagedProductBarcodeError('저장된 표시사항의 출력 범위를 확인하지 못했습니다.',409,'MANAGED_PRODUCT_BARCODE_CONFLICT');
  const position=String(label.source)+':'+String(label.index);if(positions.has(position))throw new ManagedProductBarcodeError('표시사항의 원본 위치가 중복되어 있습니다.',409,'MANAGED_PRODUCT_BARCODE_CONFLICT');positions.add(position);
  labels.push({source:label.source as ManagedBarcodeLabel['source'],index:label.index as number|null,fields:{...label.fields} as Record<string,ManagedBarcodeField>});
 }
 if(new TextEncoder().encode(JSON.stringify(labels)).length>128*1024)throw new ManagedProductBarcodeError('저장된 표시사항의 출력 내용이 너무 큽니다.',409,'MANAGED_PRODUCT_BARCODE_CONFLICT');
 return {skuId:expected.skuId,company:{...expected.company},accountContext:expected.accountContext,sourceVersion:value.sourceVersion,product:{title:value.product.title,barcode:value.product.barcode as string},labelInfo:labels,sourceName:value.sourceName,sourceRow:value.sourceRow as number,importedAt:value.importedAt};
}
export type ManagedProductBarcodeEncoding={format:'CODE128';value:string;moduleCount:number;viewBoxWidth:number;bars:{x:number;width:number}[]};
/** JsBarcode's object renderer gives only bits; React can render these numeric
 * rectangles without parsing HTML/SVG or changing the saved barcode string. */
export function encodeManagedProductBarcode(value:string):ManagedProductBarcodeEncoding {
 const barcode=barcodeValue(value),data:{encodings?:{data:string;text:string}[]}={};
 try{JsBarcode(data,barcode,{format:'CODE128',displayValue:false,width:1,height:60,margin:0});}catch{throw new ManagedProductBarcodeError('이 저장 바코드를 CODE128로 출력할 수 없습니다. 원문을 확인해주세요.');}
 const parts=data.encodings;if(!Array.isArray(parts)||parts.length!==1||typeof parts[0].data!=='string'||!/^1[01]*1$/u.test(parts[0].data)||parts[0].data.length>1500)throw new ManagedProductBarcodeError('바코드 인코딩 결과를 확인하지 못했습니다.');
 const bits=parts[0].data,bars:{x:number;width:number}[]=[];for(let index=0;index<bits.length;){if(bits[index]==='0'){index++;continue;}const start=index;while(bits[index]==='1')index++;bars.push({x:10+start,width:index-start});}
 return {format:'CODE128',value:barcode,moduleCount:bits.length,viewBoxWidth:bits.length+20,bars};
}
