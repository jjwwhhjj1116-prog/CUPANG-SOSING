export type OfficialWorkbookField={
 id:`workbook_${string}`;column:number;label:string;requirement:'required'|'conditional'|'optional';
 help:string;type:'text'|'select';choices?:string[];
};
export type OfficialWorkbookFieldContext={categoryId:string;sha256:string;sheetName:string;headerRow:number;dataStartRow:number;headers:readonly string[]};
export const OFFICIAL_WORKBOOK_FIELD_LIMIT=200;
const MAX_CHOICES=500,MAX_DESCRIPTOR_BYTES=100_000;
export const officialWorkbookSafeText=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value);
export function failOfficialWorkbookFields():never{throw Error('공식 Excel 추가 항목의 원본·열·입력 규칙을 확인해주세요.');}
export function validateOfficialWorkbookFieldContext(context:OfficialWorkbookFieldContext):void{
 if(!context||typeof context!=='object'||!officialWorkbookSafeText(context.categoryId,100)||!/^[a-zA-Z0-9_-]{1,100}$/.test(context.categoryId)
  ||typeof context.sha256!=='string'||!/^[a-f0-9]{64}$/.test(context.sha256)||!officialWorkbookSafeText(context.sheetName,120)||!context.sheetName.trim()
  ||!Number.isSafeInteger(context.headerRow)||context.headerRow<1||context.headerRow>1000
  ||!Number.isSafeInteger(context.dataStartRow)||context.dataStartRow<=context.headerRow||context.dataStartRow>10000
  ||!Array.isArray(context.headers)||!context.headers.length||context.headers.length>OFFICIAL_WORKBOOK_FIELD_LIMIT||context.headers.some(header=>!officialWorkbookSafeText(header,4000)))failOfficialWorkbookFields();
}
export const officialWorkbookFieldId=(context:OfficialWorkbookFieldContext,column:number):OfficialWorkbookField['id']=>`workbook_${context.categoryId}_${context.sha256}_${column}`;
export const officialWorkbookHeaderKey=(header:string)=>header.normalize('NFKC').replace(/[＊*]/gu,'').replace(/\s+/gu,'').trim();
export const validOfficialWorkbookFieldChoices=(choices:unknown):choices is string[]=>Array.isArray(choices)&&choices.length>0&&choices.length<=MAX_CHOICES
 &&choices.every(choice=>officialWorkbookSafeText(choice,4000))&&new Set(choices.map(choice=>choice.toLowerCase())).size===choices.length;

/** Structural validation is not original-file proof; callers must also rederive
 * these descriptors from their fully verified original workbook. */
export function validateOfficialWorkbookFields(raw:unknown,context:OfficialWorkbookFieldContext):OfficialWorkbookField[]{
 validateOfficialWorkbookFieldContext(context);if(!Array.isArray(raw)||raw.length>OFFICIAL_WORKBOOK_FIELD_LIMIT)failOfficialWorkbookFields();
 const used=new Set<number>();
 const fields=raw.map((value):OfficialWorkbookField=>{
  const keys=['id','column','label','requirement','help','type'];
  if(!value||typeof value!=='object'||Array.isArray(value)||keys.some(key=>!Object.hasOwn(value,key))
   ||Object.keys(value).some(key=>![...keys,'choices'].includes(key)))failOfficialWorkbookFields();
  const {id,column,label,requirement,help,type}=value;
  if(!Number.isSafeInteger(column)||column<0||column>=context.headers.length||used.has(column)||id!==officialWorkbookFieldId(context,column)
   ||!officialWorkbookSafeText(label,4000)||!label.trim()||label!==context.headers[column].trim()||context.headers.filter(header=>officialWorkbookHeaderKey(header)===officialWorkbookHeaderKey(label)).length!==1
   ||!['required','conditional','optional'].includes(requirement)||!officialWorkbookSafeText(help,8000)
   ||type!=='text'&&type!=='select'||type==='text'&&Object.hasOwn(value,'choices')||type==='select'&&!validOfficialWorkbookFieldChoices(value.choices))failOfficialWorkbookFields();
  used.add(column);
  return {id,column,label,requirement,help,type,...(type==='select'?{choices:[...value.choices]}:{})};
 });
 if(new TextEncoder().encode(JSON.stringify(fields)).length>MAX_DESCRIPTOR_BYTES)failOfficialWorkbookFields();
 return fields;
}
