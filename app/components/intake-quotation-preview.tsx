import { categoryFields, quotationStartRow, type CategoryProfile } from '@/app/category-profiles';
import { getQuotationSchema } from '@/app/quotation-schema';
import { CategoryQuotationPreview } from '@/app/components/category-quotation-preview';

export function IntakeQuotationPreview({ profile }: { profile: CategoryProfile }) {
  const schema = getQuotationSchema(profile.categoryId, profile.categoryPath);
  const template = profile.template;
  return <section className="intake-quotation-preview" aria-label="선택 상품 견적서 연결">
    <h3>{profile.name} · 견적서 연결</h3>
    <p>{profile.categoryPath.join(' > ')} · 코드 {profile.categoryId || '미입력'} · 선택 버전 {profile.revision}</p>
    <p>이 행에 연결된 설정입니다. 설정을 바꿨다면 카테고리를 다시 선택해 최신 버전을 반영하세요. URL·특징·키워드는 유지됩니다.</p>
    {template ? <>
      <p><strong>{template.name}</strong> · {template.format.toUpperCase()} · 시트 {template.sheetName || '(없음)'} · 머리글 {template.headerRow}행 · 입력 시작 {quotationStartRow(template)}행</p>
      <p>열 연결 {profile.mappings.length}개 / 양식 열 {template.headers.length}개. 연결 개수는 공식 양식 호환성이나 제출 완료를 뜻하지 않습니다.</p>
      <details><summary>저장한 양식 열 연결 보기</summary><div className="table-wrap"><table><thead><tr><th>열</th><th>양식 항목</th><th>작성 내용</th><th>조건</th></tr></thead><tbody>
        {template.headers.map((header, column) => {
          const mapping = profile.mappings.find(item => item.column === column);
          return <tr key={column}><td>{column + 1}</td><th scope="row">{header || '(제목 없음)'}</th><td>{!mapping ? '연결 없음' : mapping.field === 'constant' ? `고정값: ${mapping.constant || '(공란)'}` : categoryFields[mapping.field]}</td><td>{mapping ? `${mapping.required ? '필수' : '선택'}${mapping.choiceFormat ? ` · 선택지 ${mapping.choiceFormat === 'label' ? '표시 이름' : '저장값'}` : ''}` : '미설정'}</td></tr>;
        })}
      </tbody></table></div></details>
    </> : <p className="panel-note">원본 Excel 양식은 연결되지 않았습니다. 아래 카테고리 견적 항목은 확인할 수 있지만 원본 양식 출력은 별도 연결이 필요합니다.</p>}
    <CategoryQuotationPreview schema={schema}/>
  </section>;
}
