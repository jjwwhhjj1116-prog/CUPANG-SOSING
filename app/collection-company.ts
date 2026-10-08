import { supplierHubCompany, type SupplierHubCompany } from '@/app/supplier-hub-company';

export class CollectionCompanyError extends Error {
  constructor(message: string, public code: 'COLLECTION_COMPANY_INVALID' | 'COLLECTION_COMPANY_MISMATCH') { super(message); }
}

/** New captures record the approved company independently of optional form
 * evidence. Legacy captures can use their recorded schema, never today's login. */
export function capturedCollectionCompany(context: unknown): SupplierHubCompany | null {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return null;
  const value = context as { company?: SupplierHubCompany; category?: { hubSchema?: { company?: SupplierHubCompany } } };
  const recorded = Object.hasOwn(context, 'company');
  const company = recorded ? supplierHubCompany(value.company?.code, value.company?.name) : null;
  const schemaCompany = value.category?.hubSchema?.company;
  const schema = schemaCompany ? supplierHubCompany(schemaCompany.code, schemaCompany.name) : null;
  if ((recorded && !company) || (schemaCompany && !schema)
    || (company && schema && (company.code !== schema.code || company.name !== schema.name))) {
    throw new CollectionCompanyError('수집 당시 회사 코드·이름과 상세 양식 회사가 일치하지 않습니다. 저장 원문을 확인해주세요.', 'COLLECTION_COMPANY_INVALID');
  }
  return company ?? schema;
}

/** Check before captured defaults or derived product values are applied. */
export function verifyCapturedCollectionCompany(context: unknown, current: SupplierHubCompany | null): SupplierHubCompany | null {
  const captured = capturedCollectionCompany(context);
  if (captured && (!current || captured.code !== current.code || captured.name !== current.name)) {
    throw new CollectionCompanyError('이 상품의 수집 당시 회사가 현재 로그인 회사와 다릅니다. 원래 회사의 상품과 양식을 사용해주세요.', 'COLLECTION_COMPANY_MISMATCH');
  }
  return captured;
}
