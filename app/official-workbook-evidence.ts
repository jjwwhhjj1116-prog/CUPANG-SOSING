import type {HubSchemaSnapshot} from '@/app/supplier-hub-schema';

export type OfficialWorkbookEvidence={
 kind:'official-workbook-v1';excelSchemaVerified:false;templateSha256:string;sourceSchemaSha256:string;
 companyCode:string;companyName:string;categoryId:string;categoryPath:string[];
 kanCategoryId:string;noticeNumber:string;version:string;
};
/** File evidence never changes the captured Single schema into an Excel schema. */
export function validateOfficialWorkbookEvidence(value:unknown,templateSha256:string,snapshot?:HubSchemaSnapshot):OfficialWorkbookEvidence{
 const evidence=value as OfficialWorkbookEvidence;
 const keys=['kind','excelSchemaVerified','templateSha256','sourceSchemaSha256','companyCode','companyName','categoryId','categoryPath','kanCategoryId','noticeNumber','version'];
 if(!evidence||typeof evidence!=='object'||Array.isArray(evidence)||Object.keys(evidence).length!==keys.length||keys.some(key=>!Object.hasOwn(evidence,key))
  ||evidence.kind!=='official-workbook-v1'||evidence.excelSchemaVerified!==false||evidence.templateSha256!==templateSha256
  ||typeof evidence.sourceSchemaSha256!=='string'||!/^[a-f0-9]{64}$/.test(evidence.sourceSchemaSha256)
  ||!snapshot||(snapshot.metadata.scopeType??snapshot.metadata.scope)!=='Retail_Categorized_Single'
  ||evidence.companyCode!==snapshot.company.code||evidence.companyName!==snapshot.company.name||evidence.categoryId!==snapshot.categoryId
  ||!Array.isArray(evidence.categoryPath)||JSON.stringify(evidence.categoryPath)!==JSON.stringify(snapshot.categoryPath)
  ||evidence.kanCategoryId!==String(snapshot.metadata.kanCategoryId??snapshot.metadata.categoryId??'')
  ||[evidence.kanCategoryId,evidence.noticeNumber,evidence.version].some(item=>typeof item!=='string'||!/^\d{1,20}$/.test(item)))throw Error('공식 파일 연결의 회사·분류·원본 근거가 다릅니다. 원본을 다시 확인해주세요.');
 return {...evidence,categoryPath:[...evidence.categoryPath]};
}
