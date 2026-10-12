import { usableCategoryCode, type CategoryProfile } from '@/app/category-profiles';
import type { CategoryChoice } from '@/app/category-catalog';
import { getQuotationSchema } from '@/app/quotation-schema';
import { validateHubSchemaSnapshot, type HubSchemaSnapshot } from '@/app/supplier-hub-schema';
import { validateOfficialWorkbookEvidence } from '@/app/official-workbook-evidence';
import { sameCategoryHubDefinition } from '@/app/category-definition-refresh-client';
import type { SupplierHubCompany } from '@/app/supplier-hub-company';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(item => JSON.parse(canonical(item))));
  if (value && typeof value === 'object') return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical((value as Record<string, unknown>)[key]))])));
  return JSON.stringify(value ?? null);
}
const invalid = () => new Error('선택한 카테고리의 회사·코드·전체 경로와 상세 견적 양식을 확인하지 못했습니다. 기존 설정은 유지하며 URL 입력을 중단했습니다.');
const validPath = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.length <= 10
  && value.every(part => typeof part === 'string' && Boolean(part) && part === part.trim() && part.length <= 120 && !/[\u0000-\u001f\u007f]/u.test(part));
/** Publish only a list whose identities can be traversed. Unconfirmed manual
 * codes remain readable; a malformed list is not proof that a form is absent. */
export function confirmCategorySelectionList(profiles: readonly CategoryProfile[]): void {
  if (profiles.some(profile => !profile || typeof profile.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(profile.id)
    || !Number.isSafeInteger(profile.revision) || profile.revision < 1 || typeof profile.categoryId !== 'string' || !validPath(profile.categoryPath))) throw invalid();
}

/** A live leaf must retain its observed form; an absent result is not a manual
 * category choice and cannot become a generic code-only fallback. */
export function confirmLiveCategorySelectionSchema(choice: CategoryChoice, value: unknown, approvedCompany?: SupplierHubCompany | null): HubSchemaSnapshot {
  if (!choice.supplierHub || !choice.isLeaf) throw invalid();
  try {
    const schema = validateHubSchemaSnapshot(value, choice.categoryId, choice.path);
    if (schema.company.code !== choice.supplierHub.company.code || schema.company.name !== choice.supplierHub.company.name) throw invalid();
    if (approvedCompany !== undefined && (!approvedCompany || schema.company.code !== approvedCompany.code || schema.company.name !== approvedCompany.name)) throw invalid();
    return schema;
  } catch { throw invalid(); }
}

/** Generic manually saved drafts remain usable without Hub evidence. When
 * detailed or official evidence is present, never discard it to pass selection. */
export function confirmCategorySelectionProfile(choice: CategoryChoice, profile: CategoryProfile, liveSchema?: HubSchemaSnapshot, approvedCompany?: SupplierHubCompany | null): CategoryProfile {
  try {
    if (!profile || typeof profile.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(profile.id)
      || !Number.isSafeInteger(profile.revision) || profile.revision < 1 || !usableCategoryCode(profile.categoryId)
      || profile.categoryId !== choice.categoryId || !validPath(profile.categoryPath)
      || canonical(profile.categoryPath) !== canonical(choice.path)) throw invalid();
    if (profile.hubSchema !== undefined) validateHubSchemaSnapshot(profile.hubSchema, profile.categoryId, profile.categoryPath);
    if (profile.hubSchema && approvedCompany !== undefined && (!approvedCompany || profile.hubSchema.company.code !== approvedCompany.code || profile.hubSchema.company.name !== approvedCompany.name)) throw invalid();
    const evidence=profile.template?.workbookEvidence;
    if (evidence && approvedCompany !== undefined && (!approvedCompany || evidence.companyCode !== approvedCompany.code || evidence.companyName !== approvedCompany.name)) throw invalid();
    if (choice.supplierHub && (!liveSchema || !profile.hubSchema || !sameCategoryHubDefinition(profile.hubSchema, liveSchema))) throw invalid();
    getQuotationSchema(profile.categoryId, profile.categoryPath, profile.hubSchema, profile.template);
    if (profile.template?.workbookEvidence) validateOfficialWorkbookEvidence(profile.template.workbookEvidence, profile.template.sha256, profile.hubSchema);
    return profile;
  } catch { throw invalid(); }
}

/** An unchanged revision cannot acknowledge a changed company, initialization
 * rule, workbook or manually reviewed column connection. Observation time and
 * object key order alone are not a form change. */
export function sameCategorySelectionDefinition(previous: CategoryProfile, current: CategoryProfile): boolean {
  return (!previous.hubSchema && !current.hubSchema || Boolean(current.hubSchema && sameCategoryHubDefinition(previous.hubSchema, current.hubSchema)))
    && canonical(previous.template ?? null) === canonical(current.template ?? null)
    && canonical(previous.mappings ?? []) === canonical(current.mappings ?? []);
}
