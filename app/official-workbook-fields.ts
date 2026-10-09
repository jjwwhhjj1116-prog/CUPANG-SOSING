import {supplierHubEntryLayout,xlsxChoiceLists,xlsxHeaders,xlsxWorksheetPath,type XlsxInspection} from '@/app/xlsx-template';
import {OFFICIAL_WORKBOOK_FIELD_LIMIT as MAX_FIELDS,officialWorkbookSafeText as safeText,failOfficialWorkbookFields as fail,
 validateOfficialWorkbookFieldContext as validateContext,officialWorkbookFieldId as fieldId,officialWorkbookHeaderKey as headerKey,
 validOfficialWorkbookFieldChoices as validChoices,validateOfficialWorkbookFields,type OfficialWorkbookField,type OfficialWorkbookFieldContext} from '@/app/official-workbook-field-descriptors';
export {validateOfficialWorkbookFields,type OfficialWorkbookField,type OfficialWorkbookFieldContext} from '@/app/official-workbook-field-descriptors';

type ValidationRule={attributes:Record<string,string>;children:string[]};
const decodeAttribute=(value:string)=>value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/giu,entity=>{
 const named:Record<string,string>={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"};
 return named[entity]??String.fromCodePoint(entity[2].toLowerCase()==='x'?parseInt(entity.slice(3,-1),16):Number(entity.slice(2,-1)));
});
/** The shared inspector has already validated XML. This conservative tag scan
 * only distinguishes a missing validation rule from unsupported/ambiguous rules;
 * the shared xlsxChoiceLists parser resolves every accepted list and name. */
function worksheetValidationRules(source:string):ValidationRule[]|undefined{
 const stack:string[]=[],rules:ValidationRule[]=[];let containers=0,rootCount=0;
 if(/<!DOCTYPE|<!ENTITY/iu.test(source))return;
 const tokens=/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>/gu;
 for(const match of source.matchAll(tokens)){
  const token=match[0];if(token.startsWith('<!--')||token.startsWith('<?')||token.startsWith('<![CDATA['))continue;
  if(token.startsWith('</')){if(stack.pop()!==token.slice(2,-1).trim())return;continue;}
  const opening=/^<([a-zA-Z_][\w.:-]*)([\s\S]*?)(\/?)>$/u.exec(token);if(!opening||stack.length>64)return;
  const local=opening[1].split(':').at(-1)!,parent=stack.map(name=>name.split(':').at(-1)).join('/');
  if(!stack.length&&(local!=='worksheet'||++rootCount!==1))return;
  if(parent==='worksheet'&&local==='extLst')return;
  if(parent==='worksheet'&&local==='dataValidations'&&++containers>1)return;
  if(parent==='worksheet/dataValidations'){
   if(local!=='dataValidation')return;
   const attributes:Record<string,string>=Object.create(null);let cursor=0;
   const matcher=/\s+([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu;
   for(const attribute of opening[2].matchAll(matcher)){
    if(attribute.index!==cursor||Object.hasOwn(attributes,attribute[1]))return;
    attributes[attribute[1]]=decodeAttribute(attribute[2]??attribute[3]);cursor=attribute.index!+attribute[0].length;
   }
   if(opening[2].slice(cursor).trim())return;
   rules.push({attributes,children:[]});
  }else if(parent==='worksheet/dataValidations/dataValidation')rules.at(-1)!.children.push(local);
  if(!opening[3])stack.push(opening[1]);
 }
 return stack.length||rootCount!==1?undefined:rules;
}
function coversColumn(rule:ValidationRule,column:number,row:number):boolean|undefined{
 const position=(reference:string)=>{
  const match=/^\$?([A-Z]{1,3})\$?([1-9]\d*)$/u.exec(reference);if(!match)return;
  let column=0;for(const letter of match[1])column=column*26+letter.charCodeAt(0)-64;
  const row=Number(match[2]);if(column>16384||!Number.isSafeInteger(row)||row>1048576)return;
  return {column:column-1,row};
 };
 const references=rule.attributes.sqref?.trim().split(/\s+/u);if(!references?.length||!references[0])return;
 let covered=false;
 for(const reference of references){
  const parts=reference.split(':'),start=position(parts[0]),end=position(parts[1]??parts[0]);
  if(parts.length>2||!start||!end||start.column>end.column||start.row>end.row)return;
  covered||=column>=start.column&&column<=end.column&&row>=start.row&&row<=end.row;
 }
 return covered;
}

/** Explicit manual inputs present only in the original Excel. Examples never
 * supply defaults and these descriptors never fabricate a Single Hub wire. */
export function deriveOfficialWorkbookFields(files:Map<string,Uint8Array>,inspection:XlsxInspection,context:OfficialWorkbookFieldContext,unmatchedColumns:readonly number[]):OfficialWorkbookField[]{
 validateContext(context);
 if(!Array.isArray(unmatchedColumns)||unmatchedColumns.length>MAX_FIELDS||new Set(unmatchedColumns).size!==unmatchedColumns.length
  ||unmatchedColumns.some(column=>!Number.isSafeInteger(column)||column<0||column>=context.headers.length))fail();
 const sheet=inspection.sheets.find(sheet=>sheet.name===context.sheetName),layout=supplierHubEntryLayout(inspection,context.sheetName,context.headerRow);
 if(!sheet||!layout||layout.dataStartRow!==context.dataStartRow
  ||JSON.stringify(xlsxHeaders(inspection,context.sheetName,context.headerRow).map(header=>header.trim()))!==JSON.stringify(context.headers.map(header=>header.trim())))fail();
 const worksheet=files.get(xlsxWorksheetPath(files,context.sheetName));if(!worksheet)fail();
 const rules=worksheetValidationRules(new TextDecoder('utf-8',{fatal:true}).decode(worksheet));if(!rules)return [];
 const markers=sheet.rows.find(row=>row.rowNumber===context.headerRow+1)?.values??[],guides=sheet.rows.find(row=>row.rowNumber===context.headerRow+2)?.values??[];
 const requirements:Record<string,OfficialWorkbookField['requirement']>={'필수':'required','조건부 필수':'conditional','선택':'optional'};
 const fields:OfficialWorkbookField[]=[];
 for(const column of [...unmatchedColumns].sort((a,b)=>a-b)){
  const label=context.headers[column].trim(),marker=(markers[column]??'').trim(),help=guides[column]??'';
  if(!label||context.headers.filter(header=>headerKey(header)===headerKey(label)).length!==1||!Object.hasOwn(requirements,marker)||!safeText(help,8000))continue;
  const coverage=rules.map(rule=>coversColumn(rule,column,context.dataStartRow));if(coverage.some(value=>value===undefined))continue;
  const matches=rules.filter((_rule,index)=>coverage[index]);if(matches.length>1)continue;
  let choices:string[]|undefined;
  if(matches.length){
   const rule=matches[0];
   const attributes=['type','sqref','allowBlank','errorStyle','imeMode','showErrorMessage','showInputMessage','errorTitle','error','promptTitle','prompt'];
   if(rule.attributes.type!=='list'||rule.children.length!==1||rule.children[0]!=='formula1'
    ||Object.keys(rule.attributes).some(key=>!attributes.includes(key)))continue;
   choices=xlsxChoiceLists(files,inspection,context.sheetName,[column],context.dataStartRow).get(column)??undefined;
   if(!validChoices(choices))continue;
  }
  fields.push({id:fieldId(context,column),column,label,requirement:requirements[marker],help,type:choices?'select':'text',...(choices?{choices}: {})});
 }
 return validateOfficialWorkbookFields(fields,context);
}
