import { supplierHubEntryLayout, supplierHubRequirementRow, supplierHubSheetSignature, xlsxChoiceLists, xlsxHeaders, xlsxMergedHeaderLabels, type XlsxInspection } from '@/app/xlsx-template';
import { hasQuotationInputMappings, suggestQuotationMappings } from '@/app/quotation-mapping';
import { validateHubSchemaSnapshot, type HubSchemaSnapshot } from '@/app/supplier-hub-schema';

/** Row eight illustrates one leaf. The original input dropdown is the binding
 * for a selected code and full path; it never proves Excel JSON equivalence. */
export function assertOfficialWorkbookCategory(files: Map<string, Uint8Array> | null, inspection: XlsxInspection, sheetName: string, headerRow: number,
  categoryId: string, categoryPath: readonly string[], hubSchema?: HubSchemaSnapshot): void {
  const first = inspection.sheets.find(sheet => sheet.name === sheetName)?.rows.find(row => row.rowNumber === 1)?.values ?? [];
  if (!/^QF_\d+_/u.test(sheetName) && !first.some(value => /^Retail_Categorized_/u.test(value.trim()))) return;
  const layout = supplierHubEntryLayout(inspection, sheetName, headerRow);
  if (!files || !supplierHubSheetSignature(inspection, sheetName) || !layout) throw Error('공식 견적서의 원본 scope·입력 행 구성을 확인하지 못했습니다.');
  const signatures = first.map(value => /^Retail_Categorized_Excel:Kan:(\d+):Notice(\d+):Version(\d+)$/u.exec(value.trim())).filter(value => value !== null);
  if (signatures.length !== 1) throw Error('공식 견적서의 칸 카테고리·scope 식별값을 하나로 확인하지 못했습니다.');
  const snapshot = hubSchema ? validateHubSchemaSnapshot(hubSchema, categoryId, [...categoryPath]) : undefined;
  if (snapshot) {
    const meta = snapshot.metadata, kan = String(meta.kanCategoryId ?? meta.categoryId ?? ''), scope = meta.scopeType ?? meta.scope;
    if (!/^[1-9]\d{0,19}$/u.test(kan) || kan !== signatures[0][1]
      || meta.kanCategoryId !== undefined && meta.categoryId !== undefined && String(meta.kanCategoryId) !== String(meta.categoryId)
      || meta.scopeType !== undefined && meta.scope !== undefined && meta.scopeType !== meta.scope
      || !['Retail_Categorized_Single', 'Retail_Categorized_Excel'].includes(String(scope))) throw Error('저장한 상세 양식과 공식 견적서의 칸 카테고리·scope가 다릅니다.');
  }
  const headers = xlsxHeaders(inspection, sheetName, headerRow), groups = xlsxMergedHeaderLabels(files, inspection, sheetName, 4, headers.length);
  const suggestion = suggestQuotationMappings(headers, categoryId, supplierHubRequirementRow(inspection, sheetName, headerRow), snapshot, groups);
  const categories = suggestion.mappings.filter(mapping => mapping.field === 'category');
  if (categories.length !== 1 || !hasQuotationInputMappings(suggestion.mappings, ['title', 'supplyPrice', 'category'], categoryId, snapshot))
    throw Error('공식 견적서의 상품명·공급가·카테고리 열을 정확히 확인하지 못했습니다.');
  const allowed = xlsxChoiceLists(files, inspection, sheetName, [categories[0].column], layout.dataStartRow).get(categories[0].column);
  const matching = (allowed ?? []).filter(value => /\((\d+)\)\s*$/u.exec(value)?.[1] === categoryId);
  if (matching.length !== 1) throw Error(`공식 견적서 카테고리 드롭다운에서 선택한 코드 ${categoryId || '(미입력)'}를 하나로 확인하지 못했습니다.`);
  const pathKey = (parts: readonly string[]) => JSON.stringify(parts.map(part => part.normalize('NFKC').replace(/\s+/gu, '')));
  const selectedPath = matching[0].replace(/\s*\(\d+\)\s*$/u, '').split('>').map(part => part.trim());
  if (pathKey(selectedPath) !== pathKey(categoryPath)) throw Error('공식 견적서 카테고리 드롭다운의 전체 경로와 선택한 상품 경로가 다릅니다.');
}
