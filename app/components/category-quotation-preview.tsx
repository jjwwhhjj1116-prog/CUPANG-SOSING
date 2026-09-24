import { couplusQuotationDefault } from '@/app/couplus-quotation-defaults';
import { quotationSections, type QuotationSchema } from '@/app/quotation-schema';

/** Reads the same schema/default functions as quotation generation; does not write a draft. */
export function CategoryQuotationPreview({ schema }: { schema: QuotationSchema }) {
  const observedDefaults = schema.fields.filter(field => couplusQuotationDefault(schema.categoryId, field) !== undefined).length;
  return <details className="category-quotation-preview">
    <summary>이 카테고리 견적 항목·기본값 미리보기 · {schema.fields.length}개</summary>
    <p>카테고리 {schema.categoryId ?? '미확인'} · 필수 {schema.fields.filter(field => field.required).length}개 · 쿠플러스 기본값 확인 {observedDefaults}개</p>
    <p>아래는 양식 기준입니다. 상품 수집·편집 후에는 상품명, 옵션, 가격, 이미지와 기본설정이 연결되고 직접 수정한 값이 우선합니다. 기본값은 실제 상품 정보의 확인을 뜻하지 않습니다.</p>
    <p>{schema.evidence}</p>
    {Object.entries(quotationSections).map(([section, title]) => {
      const fields = schema.fields.filter(field => field.section === section);
      if (!fields.length) return null;
      return <details key={section}><summary>{title} · {fields.length}개</summary>
        <div className="category-quotation-table"><table><caption>{title} 견적 항목</caption><thead><tr><th scope="col">항목</th><th scope="col">입력 기준</th><th scope="col">쿠플러스에서 확인한 기본값</th></tr></thead>
          <tbody>{fields.map(field => {
            const value = couplusQuotationDefault(schema.categoryId, field);
            const choice = field.choices?.find(item => item.value === value);
            return <tr key={field.id}><th scope="row">{field.label}{field.required ? ' *' : ''}</th>
              <td>{field.required ? '필수' : '선택'} · {field.readOnly ? '연동값' : field.type === 'select' ? '선택형' : field.type === 'images' ? '이미지' : field.type === 'number' ? '숫자' : '직접 입력'}{field.unit ? ` · ${field.unit}` : ''}
                {field.choices && <details><summary>허용 선택지 {field.choices.length}개</summary><ul>{field.choices.map((item,index) => <li key={index}>{item.label}{item.value === '' ? ' (저장값: 공란)' : item.label !== item.value ? ` (저장값: ${item.value})` : ''}</li>)}</ul></details>}
                {field.help && <small>{field.help}</small>}</td>
              <td>{value === undefined ? '미확인 · 임의 기본값 없음' : <><strong>{choice?.label ?? (value || '(공란)')}</strong>{value === '' ? ' (저장값: 공란)' : choice && choice.label !== value ? ` (저장값: ${value})` : ''}<small>쿠플러스 화면 관찰값</small></>}</td>
            </tr>;
          })}</tbody></table></div>
      </details>;
    })}
  </details>;
}
