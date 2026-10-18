import type {TemplateDefinition} from '@/app/category-profiles';
import type {QuotationOverrides,QuotationSchema} from '@/app/quotation-schema';
import type {HubSchemaSnapshot} from '@/app/supplier-hub-schema';
import {validateOfficialWorkbookEvidence} from '@/app/official-workbook-evidence';
import {validateOfficialWorkbookFields,type OfficialWorkbookField} from '@/app/official-workbook-field-descriptors';

export type RetainedQuotationWorkbook={name:string;sha256:string;fields:OfficialWorkbookField[]};

/** Display-only descriptions of manual values retained under an older file SHA.
 * The caller supplies a validated, linked collection template and current IDs.
 * No old field is mapped or copied into the current workbook. */
export function retainedQuotationWorkbook(captured:TemplateDefinition|null|undefined,current:TemplateDefinition|null|undefined,
 schema:QuotationSchema,overrides:QuotationOverrides,optionIds:readonly string[],snapshot?:HubSchemaSnapshot):RetainedQuotationWorkbook|undefined{
 if(!captured?.workbookFields?.length||!current||captured.sha256===current.sha256)return undefined;
 validateOfficialWorkbookEvidence(captured.workbookEvidence,captured.sha256,snapshot);
 const descriptors=validateOfficialWorkbookFields(captured.workbookFields,{...captured,categoryId:schema.categoryId??'',dataStartRow:captured.dataStartRow??captured.headerRow+1});
 const active=new Set(schema.fields.map(field=>field.id)),layers=[overrides.common,...optionIds.flatMap(id=>Object.hasOwn(overrides.options,id)?[overrides.options[id]]:[])];
 const fields=descriptors.filter(field=>!active.has(field.id)&&layers.some(values=>Object.hasOwn(values,field.id)&&typeof values[field.id]==='string'));
 return fields.length?{name:captured.name,sha256:captured.sha256,fields}:undefined;
}
