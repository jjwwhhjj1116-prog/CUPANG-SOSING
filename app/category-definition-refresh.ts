import {validateQuotationChoiceFormats,type CategoryProfileInput,type ColumnMapping} from '@/app/category-profiles';
import {getQuotationSchema,type QuotationField} from '@/app/quotation-schema';
import type {HubSchemaSnapshot} from '@/app/supplier-hub-schema';

const equal=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);
const wireKey=(field:QuotationField)=>field.hubWire?JSON.stringify([field.hubWire.path,field.hubWire.nameKey??null,field.hubWire.valueKey??null,field.hubWire.name??null]):null;
const inputKind=(field:QuotationField)=>JSON.stringify([field.type,field.unit??null,field.numericValue??false,field.numericText??false,field.integer??false]);
const metadataKey=(schema:HubSchemaSnapshot)=>JSON.stringify(Object.entries(schema.metadata).sort(([left],[right])=>left.localeCompare(right)));

/** Observation time and app draft rules do not change the underlying Hub form. */
export function sameCategoryFormDefinition(saved:HubSchemaSnapshot|undefined,current:HubSchemaSnapshot):boolean{
 return Boolean(saved&&saved.format===current.format&&saved.categoryId===current.categoryId&&equal(saved.categoryPath,current.categoryPath)
  &&saved.company.code===current.company.code&&saved.company.name===current.company.name
  &&saved.schemaString===current.schemaString&&metadataKey(saved)===metadataKey(current));
}

/** Preserve manual connections by exact input identity, never by a similar label.
 * New limits and enum values are validated by the new form when entering values. */
export function carryCategoryDefinitionMappings(source:CategoryProfileInput,target:CategoryProfileInput):ColumnMapping[]{
 if(source.categoryId!==target.categoryId||!equal(source.categoryPath,target.categoryPath)
  ||source.hubSchema&&target.hubSchema&&(source.hubSchema.company.code!==target.hubSchema.company.code||source.hubSchema.company.name!==target.hubSchema.company.name))throw Error('갱신할 회사·카테고리 코드·전체 경로가 다릅니다.');
 const old=source.template,next=target.template;
 if(Boolean(old)!==Boolean(next)||old&&next&&(old.sha256!==next.sha256||old.format!==next.format||old.storageKey!==next.storageKey
  ||old.sheetName!==next.sheetName||old.headerRow!==next.headerRow||old.dataStartRow!==next.dataStartRow||!equal(old.headers,next.headers)))throw Error('기존 견적서 원본·시트·열·작성 위치를 보존하지 못했습니다. 새 원본을 직접 연결해주세요.');
 const before=getQuotationSchema(source.categoryId,source.categoryPath,source.hubSchema,old),after=getQuotationSchema(target.categoryId,target.categoryPath,target.hubSchema,next);
 const result=source.mappings.map(mapping=>{
  if(mapping.field==='constant')return {...mapping};
  const fields=before.fields.filter(field=>field.id===mapping.field);
  if(fields.length!==1)throw Error(`${mapping.column+1}열: 이전 양식의 연결 항목을 하나로 확인하지 못했습니다. 카테고리·양식 설정에서 연결을 확인해주세요.`);
  const field=fields[0],wire=wireKey(field);
  const matches=after.fields.filter(candidate=>wire?wireKey(candidate)===wire:!candidate.hubWire&&candidate.id===field.id);
  if(matches.length!==1||inputKind(field)!==inputKind(matches[0]))throw Error(`${mapping.column+1}열 (${field.label}): 새 양식의 같은 입력 경로·형식을 확인하지 못했습니다. 기존 설정은 보존했습니다. 새 양식을 직접 연결해주세요.`);
  const current=matches[0];
  if(field.workbookWire&&(!current.workbookWire||current.workbookWire.column!==mapping.column||!equal(field.workbookWire,current.workbookWire)))throw Error(`${mapping.column+1}열: 원본 Excel 추가 항목의 연결이 달라졌습니다. 새 원본을 확인해주세요.`);
  if(current.hubWire&&(after.unsupportedFields??[]).some(path=>{const root=path.replace(/(?:^| \/ )required$/u,'');return path==='schema'||!root||root.startsWith(current.hubWire!.path.join(' / '))||current.hubWire!.path.join(' / ').startsWith(root);}))throw Error(`${mapping.column+1}열: 새 상세 양식의 추가 입력 규칙을 확인해야 합니다.`);
  return {...mapping,field:current.id as ColumnMapping['field']};
 });
 validateQuotationChoiceFormats({...target,mappings:result},after.fields);
 return result;
}
