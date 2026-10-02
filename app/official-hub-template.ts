import {type CategoryProfileInput} from '@/app/category-profiles';
import {validateHubSchemaSnapshot,type HubSchemaSnapshot} from '@/app/supplier-hub-schema';
import {readXlsxArchive,inspectXlsxArchive,supplierHubSheetSignature,supplierHubEntryLayout,supplierHubRequirementRow,xlsxHeaders,xlsxChoiceLists} from '@/app/xlsx-template';
import {suggestQuotationMappings} from '@/app/quotation-mapping';
import {suggestQuotationChoiceFormats} from '@/app/quotation-choice-format';

export function hubTemplateKanId(snapshot:HubSchemaSnapshot):string{
 const meta=snapshot.metadata,kan=String(meta.kanCategoryId??meta.categoryId??'');
 if(!/^[1-9]\d{0,19}$/.test(kan)||meta.kanCategoryId!==undefined&&meta.categoryId!==undefined&&String(meta.kanCategoryId)!==String(meta.categoryId))throw Error('상세 양식의 칸 카테고리 코드를 확인하지 못했습니다.');
 return kan;
}
const pathKey=(path:readonly string[])=>JSON.stringify(path.map(part=>part.normalize('NFKC').replace(/\s+/gu,'')));
/** Verify the selected display code in the original dropdown, not a leaf name or a download ID guess. */
export async function connectOfficialHubTemplate(bytes:ArrayBuffer,raw:HubSchemaSnapshot){
 const snapshot=validateHubSchemaSnapshot(raw,raw.categoryId,raw.categoryPath),kan=hubTemplateKanId(snapshot);
 const files=await readXlsxArchive(bytes),inspection=inspectXlsxArchive(files);
 const candidates=inspection.sheets.flatMap(sheet=>{
  if(!supplierHubSheetSignature(inspection,sheet.name))return [];
  const signature=sheet.rows.find(row=>row.rowNumber===1)?.values.map(value=>/^Retail_Categorized_Excel:Kan:(\d+):Notice(\d+):Version(\d+)$/.exec(value.trim())).filter(value=>value!==null)??[];
  if(signature.length!==1||signature[0][1]!==kan)return [];
  const metadata=signature[0],layout=supplierHubEntryLayout(inspection,sheet.name,5);if(!layout)return [];
  const headers=xlsxHeaders(inspection,sheet.name,5),suggested=suggestQuotationMappings(headers,snapshot.categoryId,supplierHubRequirementRow(inspection,sheet.name,5),snapshot);
  const categoryColumns=suggested.mappings.filter(mapping=>mapping.field==='category');if(categoryColumns.length!==1)return [];
  const allowed=xlsxChoiceLists(files,inspection,sheet.name,[categoryColumns[0].column],layout.dataStartRow).get(categoryColumns[0].column);
  const matching=(allowed??[]).filter(value=>new RegExp(`\\(${snapshot.categoryId}\\)\\s*$`).test(value));
  if(matching.length!==1||pathKey(matching[0].replace(/\s*\(\d+\)\s*$/,'').split('>').map(part=>part.trim()))!==pathKey(snapshot.categoryPath))return [];
  if(!['title','supplyPrice','category'].every(field=>suggested.mappings.some(mapping=>mapping.field===field)))return [];
  return [{sheetName:sheet.name,headers,layout,suggested,noticeNumber:metadata[2],version:metadata[3],categoryValue:matching[0]}];
 });
 if(candidates.length!==1)throw Error('선택한 등록 코드·전체 경로와 일치하는 공식 Excel 작성 시트를 하나로 확인하지 못했습니다.');
 const selected=candidates[0],meta=snapshot.metadata,notice=meta.productNoticeNumber??meta.noticeNumber;
 if(meta.version!==undefined&&String(meta.version)!==selected.version||notice!==undefined&&String(notice)!==selected.noticeNumber
  ||meta.scope!==undefined&&meta.scope!=='Retail_Categorized_Excel'||meta.scopeType!==undefined&&meta.scopeType!=='Retail_Categorized_Excel')throw Error('상세 양식과 공식 Excel의 고시·버전이 다릅니다. 카테고리를 다시 선택해주세요.');
 const formats=suggestQuotationChoiceFormats(files,inspection,selected.sheetName,selected.layout.dataStartRow,snapshot.categoryId,selected.suggested.mappings,snapshot);
 const mappings=selected.suggested.mappings.map(mapping=>({...mapping,...(formats.find(format=>format.column===mapping.column)??{})}));
 return {template:{format:'xlsx',sheetName:selected.sheetName,headerRow:5,dataStartRow:selected.layout.dataStartRow,headers:selected.headers} as Omit<NonNullable<CategoryProfileInput['template']>,'name'|'sha256'|'storageKey'>,
  mappings,report:{categoryId:snapshot.categoryId,categoryPath:snapshot.categoryPath,company:snapshot.company,kanCategoryId:kan,noticeNumber:selected.noticeNumber,version:selected.version,categoryValue:selected.categoryValue,
   matchedColumns:mappings.length,unmatchedColumns:selected.suggested.unmatchedColumns,ambiguousColumns:selected.suggested.ambiguousColumns,registered:false as const}};
}
