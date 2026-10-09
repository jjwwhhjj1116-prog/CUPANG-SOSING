import {type CategoryProfileInput} from '@/app/category-profiles';
import {validateHubSchemaSnapshot,type HubSchemaSnapshot} from '@/app/supplier-hub-schema';
import {readXlsxArchive,inspectXlsxArchive,supplierHubSheetSignature,supplierHubEntryLayout,supplierHubRequirementRow,xlsxHeaders,xlsxChoiceLists,xlsxMergedHeaderLabels} from '@/app/xlsx-template';
import {suggestQuotationMappings,hasQuotationInputMappings} from '@/app/quotation-mapping';
import {suggestQuotationChoiceFormats} from '@/app/quotation-choice-format';
import {getQuotationSchema,type QuotationField} from '@/app/quotation-schema';
import type {OfficialWorkbookEvidence} from '@/app/official-workbook-evidence';
import {deriveOfficialWorkbookFields} from '@/app/official-workbook-fields';

export function hubTemplateKanId(snapshot:HubSchemaSnapshot):string{
 const meta=snapshot.metadata,kan=String(meta.kanCategoryId??meta.categoryId??'');
 if(!/^[1-9]\d{0,19}$/.test(kan)||meta.kanCategoryId!==undefined&&meta.categoryId!==undefined&&String(meta.kanCategoryId)!==String(meta.categoryId))throw Error('상세 양식의 칸 카테고리 코드를 확인하지 못했습니다.');
 return kan;
}
const pathKey=(path:readonly string[])=>JSON.stringify(path.map(part=>part.normalize('NFKC').replace(/\s+/gu,'')));
export type OfficialHubTemplateIdentity={scopeType:'Retail_Categorized_Excel';kanCategoryId:string;noticeNumber:string;version:string};
const scope=(snapshot:HubSchemaSnapshot)=>{
 const {scope,scopeType}=snapshot.metadata;
 if(scope!==undefined&&scopeType!==undefined&&scope!==scopeType)throw Error('상세 양식의 scope 정보가 서로 다릅니다.');
 return scopeType??scope;
};
/** Verify the selected display code in the original dropdown, not a leaf name or a download ID guess. */
async function inspectOfficialHubTemplate(bytes:ArrayBuffer,raw:HubSchemaSnapshot){
 const snapshot=validateHubSchemaSnapshot(raw,raw.categoryId,raw.categoryPath),kan=hubTemplateKanId(snapshot);
 const files=await readXlsxArchive(bytes),inspection=inspectXlsxArchive(files);
 const candidates=inspection.sheets.flatMap(sheet=>{
  if(!supplierHubSheetSignature(inspection,sheet.name))return [];
  const signature=sheet.rows.find(row=>row.rowNumber===1)?.values.map(value=>/^Retail_Categorized_Excel:Kan:(\d+):Notice(\d+):Version(\d+)$/.exec(value.trim())).filter(value=>value!==null)??[];
  if(signature.length!==1||signature[0][1]!==kan)return [];
  const metadata=signature[0],layout=supplierHubEntryLayout(inspection,sheet.name,5);if(!layout)return [];
  const headers=xlsxHeaders(inspection,sheet.name,5),groups=xlsxMergedHeaderLabels(files,inspection,sheet.name,4,headers.length),suggested=suggestQuotationMappings(headers,snapshot.categoryId,supplierHubRequirementRow(inspection,sheet.name,5),snapshot,groups);
  const categoryColumns=suggested.mappings.filter(mapping=>mapping.field==='category');if(categoryColumns.length!==1)return [];
  const allowed=xlsxChoiceLists(files,inspection,sheet.name,[categoryColumns[0].column],layout.dataStartRow).get(categoryColumns[0].column);
  const matching=(allowed??[]).filter(value=>new RegExp(`\\(${snapshot.categoryId}\\)\\s*$`).test(value));
  if(matching.length!==1||pathKey(matching[0].replace(/\s*\(\d+\)\s*$/,'').split('>').map(part=>part.trim()))!==pathKey(snapshot.categoryPath))return [];
  if(!hasQuotationInputMappings(suggested.mappings,['title','supplyPrice','category'],snapshot.categoryId,snapshot))return [];
  return [{sheetName:sheet.name,headers,groups,layout,suggested,noticeNumber:metadata[2],version:metadata[3],categoryValue:matching[0]}];
 });
 if(candidates.length!==1)throw Error('선택한 등록 코드·전체 경로와 일치하는 공식 Excel 작성 시트를 하나로 확인하지 못했습니다.');
 return {snapshot,kan,files,inspection,selected:candidates[0]};
}
/** A read-only inspection does not approve the Single schema for Excel or store a file. */
export async function inspectOfficialHubTemplateIdentity(bytes:ArrayBuffer,raw:HubSchemaSnapshot):Promise<OfficialHubTemplateIdentity>{
 const inspected=await inspectOfficialHubTemplate(bytes,raw),sourceScope=scope(inspected.snapshot);
 if(sourceScope!=='Retail_Categorized_Single')throw Error('별도 Excel 상세 양식 조회는 확인된 Single 양식에만 사용합니다.');
 return {scopeType:'Retail_Categorized_Excel',kanCategoryId:inspected.kan,noticeNumber:inspected.selected.noticeNumber,version:inspected.selected.version};
}
/** Explicit file-based mapping. No Excel response is fabricated or inferred. */
export async function connectOfficialWorkbookTemplate(bytes:ArrayBuffer,raw:HubSchemaSnapshot){
 const {snapshot,kan,files,inspection,selected}=await inspectOfficialHubTemplate(bytes,raw);
 if(scope(snapshot)!=='Retail_Categorized_Single')throw Error('공식 파일 기준 연결에는 확인된 Single 양식이 필요합니다.');
 const sha=async(value:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),byte=>byte.toString(16).padStart(2,'0')).join('');
 const workbookEvidence:OfficialWorkbookEvidence={kind:'official-workbook-v1',excelSchemaVerified:false,
  templateSha256:await sha(bytes),sourceSchemaSha256:await sha(new TextEncoder().encode(snapshot.schemaString).buffer as ArrayBuffer),
  companyCode:snapshot.company.code,companyName:snapshot.company.name,categoryId:snapshot.categoryId,categoryPath:[...snapshot.categoryPath],
  kanCategoryId:kan,noticeNumber:selected.noticeNumber,version:selected.version};
 const formats=suggestQuotationChoiceFormats(files,inspection,selected.sheetName,selected.layout.dataStartRow,snapshot.categoryId,selected.suggested.mappings,snapshot);
 const workbookFields=deriveOfficialWorkbookFields(files,inspection,{categoryId:snapshot.categoryId,sha256:workbookEvidence.templateSha256,sheetName:selected.sheetName,headerRow:5,dataStartRow:selected.layout.dataStartRow,headers:selected.headers},selected.suggested.unmatchedColumns);
 const mappings=[...selected.suggested.mappings.map(mapping=>({...mapping,...(formats.find(format=>format.column===mapping.column)??{})})),...workbookFields.map(field=>({column:field.column,field:field.id,required:field.requirement==='required'}))].sort((a,b)=>a.column-b.column);
 const remaining=selected.suggested.unmatchedColumns.filter(column=>!workbookFields.some(field=>field.column===column));
 return {template:{format:'xlsx',sheetName:selected.sheetName,headerRow:5,dataStartRow:selected.layout.dataStartRow,headers:selected.headers,workbookEvidence,workbookFields} as Omit<NonNullable<CategoryProfileInput['template']>,'name'|'sha256'|'storageKey'>,
  mappings,
  report:{categoryId:snapshot.categoryId,categoryPath:snapshot.categoryPath,company:snapshot.company,kanCategoryId:kan,noticeNumber:selected.noticeNumber,version:selected.version,categoryValue:selected.categoryValue,
   matchedColumns:mappings.length,unmatchedColumns:remaining,ambiguousColumns:selected.suggested.ambiguousColumns,registered:false as const}};
}
/** Recheck original bytes, headers and saved evidence with one archive inspection. */
export async function verifyOfficialWorkbookTemplateEvidence(bytes:ArrayBuffer,template:CategoryProfileInput['template'],hubSchema?:HubSchemaSnapshot){
 const saved=template?.workbookEvidence;if(!saved)return undefined;
 if(!hubSchema)throw Error('공식 파일 연결의 원본 Single 양식이 없습니다.');
 const checked=await connectOfficialWorkbookTemplate(bytes,hubSchema),actual=checked.template.workbookEvidence!;
 if(template.format!=='xlsx'||template.sha256!==actual.templateSha256||template.sheetName!==checked.template.sheetName
  ||template.headerRow!==checked.template.headerRow||template.dataStartRow!==checked.template.dataStartRow
  ||JSON.stringify(template.headers)!==JSON.stringify(checked.template.headers.map(header=>header.trim()))
  ||Object.keys(saved).length!==Object.keys(actual).length
  ||Object.entries(actual).some(([key,value])=>JSON.stringify(value)!==JSON.stringify(saved[key as keyof typeof actual])))throw Error('공식 파일 연결의 원본·Single 지문·식별값이 다릅니다. 다시 준비해주세요.');
 // Older mappings remain readable. New descriptors must be identical to the
 // independently re-derived original; client-supplied options are not proof.
 if(template.workbookFields!==undefined&&JSON.stringify(template.workbookFields)!==JSON.stringify(checked.template.workbookFields))throw Error('원본 Excel 추가 항목의 안내·선택값·열 연결이 실제 원본과 다릅니다. 다시 연결해주세요.');
 return checked;
}
export type VerifiedOfficialWorkbook={evidence:OfficialWorkbookEvidence;optionalUnmappedOsrpFieldId:string|null};
/** Recheck saved evidence against the exact original bytes used for this export. */
export async function verifyOfficialWorkbookTemplate(bytes:ArrayBuffer,profile:CategoryProfileInput):Promise<VerifiedOfficialWorkbook|undefined>{
 const checked=await verifyOfficialWorkbookTemplateEvidence(bytes,profile.template,profile.hubSchema);if(!checked)return undefined;
 const actual=checked.template.workbookEvidence!;
 const fields=getQuotationSchema(profile.categoryId,profile.categoryPath,profile.hubSchema).fields;
 const osrp=fields.find(field=>!field.required&&!field.hubWire?.name&&JSON.stringify(field.hubWire?.path)===JSON.stringify(['productPage','commonAttributes','osrp']));
 // An absent column is not an alias for MSRP. Ambiguous or explicitly named
 // OSRP columns must still be mapped; no file/schema equivalence is inferred.
 const hasOsrpColumn=osrp&&(checked.mappings.some(mapping=>mapping.field===osrp.id)
  ||checked.template.headers.some(header=>/osrp|공식판매처/iu.test(header.normalize('NFKC').replace(/\s+/gu,''))));
 return {evidence:actual,optionalUnmappedOsrpFieldId:osrp&&!hasOsrpColumn&&!checked.report.ambiguousColumns.length?osrp.id:null};
}
const wireKey=(field:QuotationField)=>field.hubWire?JSON.stringify([field.hubWire.path,field.hubWire.nameKey??null,field.hubWire.valueKey??null,field.hubWire.name??null]):null;
const constraints=(field:QuotationField)=>JSON.stringify([field.type,field.choices??null,field.unit??null,field.minLength??null,field.maxLength??null,field.integer??false,field.numericValue??false,field.numericText??false,field.min??null,field.max??null,field.maxItems??null,field.exclusiveMinimum??null,field.exclusiveMaximum??null,field.multipleOf??null]);
export async function connectOfficialHubTemplate(bytes:ArrayBuffer,raw:HubSchemaSnapshot,rawExcel?:HubSchemaSnapshot){
 const {snapshot,kan,files,inspection,selected}=await inspectOfficialHubTemplate(bytes,raw);
 let mappingSnapshot=snapshot;
 if(scope(snapshot)==='Retail_Categorized_Single'){
  if(!rawExcel)throw Error('화면용 Single 양식과 공식 Excel 양식은 다릅니다. 원본 Excel의 scope·고시·버전으로 별도 상세 양식을 확인해주세요.');
  const excel=validateHubSchemaSnapshot(rawExcel,snapshot.categoryId,snapshot.categoryPath);
  if(excel.company.code!==snapshot.company.code||excel.company.name!==snapshot.company.name||hubTemplateKanId(excel)!==kan||scope(excel)!=='Retail_Categorized_Excel')throw Error('별도 Excel 상세 양식의 회사·분류·scope가 다릅니다.');
  const meta=excel.metadata,notice=meta.productNoticeNumber??meta.noticeNumber;
  if(meta.version===undefined||notice===undefined||String(meta.version)!==selected.version||String(notice)!==selected.noticeNumber
   ||meta.productNoticeNumber!==undefined&&meta.noticeNumber!==undefined&&String(meta.productNoticeNumber)!==String(meta.noticeNumber))throw Error('별도 Excel 상세 양식과 원본 파일의 고시·버전이 다릅니다.');
  mappingSnapshot=excel;
 }else if(rawExcel)throw Error('별도 Excel 상세 양식은 Single 양식 연결에만 사용합니다.');
 const meta=mappingSnapshot.metadata,notice=meta.productNoticeNumber??meta.noticeNumber;
 if(meta.version!==undefined&&String(meta.version)!==selected.version||notice!==undefined&&String(notice)!==selected.noticeNumber
  ||meta.scope!==undefined&&meta.scope!=='Retail_Categorized_Excel'||meta.scopeType!==undefined&&meta.scopeType!=='Retail_Categorized_Excel')throw Error('상세 양식과 공식 Excel의 고시·버전이 다릅니다. 카테고리를 다시 선택해주세요.');
 const suggestion=mappingSnapshot===snapshot?selected.suggested:suggestQuotationMappings(selected.headers,snapshot.categoryId,supplierHubRequirementRow(inspection,selected.sheetName,5),mappingSnapshot,selected.groups);
 let connected=suggestion.mappings;
 if(mappingSnapshot!==snapshot){
  const from=getQuotationSchema(snapshot.categoryId,snapshot.categoryPath,mappingSnapshot),to=getQuotationSchema(snapshot.categoryId,snapshot.categoryPath,snapshot);
  const unsupported=(schema:typeof from,field:QuotationField)=>field.hubWire&&(schema.unsupportedFields??[]).some(path=>{
   const parent=path.replace(/(?:^| \/ )required$/u,'');
   return path==='schema'||!parent||parent.startsWith(field.hubWire!.path.join(' / '))||field.hubWire!.path.join(' / ').startsWith(parent);
  });
  connected=suggestion.mappings.flatMap(mapping=>{
   const sources=from.fields.filter(field=>field.id===mapping.field);if(sources.length!==1)return [];
   const source=sources[0],wire=wireKey(source),targets=to.fields.filter(field=>wire?wireKey(field)===wire:!field.hubWire&&field.id===source.id);
   if(targets.length!==1||constraints(source)!==constraints(targets[0])||unsupported(from,source)||unsupported(to,targets[0]))return [];
   return [{...mapping,field:targets[0].id as typeof mapping.field}];
  });
 }
 const omitted=suggestion.mappings.filter(mapping=>!connected.some(item=>item.column===mapping.column)).map(mapping=>mapping.column);
 if(!hasQuotationInputMappings(connected,['title','supplyPrice','category'],snapshot.categoryId,snapshot))throw Error('Single·Excel 양식에서 상품명·공급가·카테고리 연결을 정확히 확인하지 못했습니다.');
 const formats=suggestQuotationChoiceFormats(files,inspection,selected.sheetName,selected.layout.dataStartRow,snapshot.categoryId,connected,snapshot);
 const mappings=connected.map(mapping=>({...mapping,...(formats.find(format=>format.column===mapping.column)??{})}));
 return {template:{format:'xlsx',sheetName:selected.sheetName,headerRow:5,dataStartRow:selected.layout.dataStartRow,headers:selected.headers} as Omit<NonNullable<CategoryProfileInput['template']>,'name'|'sha256'|'storageKey'>,
  mappings,report:{categoryId:snapshot.categoryId,categoryPath:snapshot.categoryPath,company:snapshot.company,kanCategoryId:kan,noticeNumber:selected.noticeNumber,version:selected.version,categoryValue:selected.categoryValue,
   matchedColumns:mappings.length,unmatchedColumns:[...suggestion.unmatchedColumns,...omitted].sort((a,b)=>a-b),ambiguousColumns:suggestion.ambiguousColumns,registered:false as const}};
}
