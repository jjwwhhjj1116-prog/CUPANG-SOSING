import type { QuotationNavigationTarget } from '@/app/quotation-navigation';

type OptionReference = { optionId: string | null; optionLabel: string };
export type QuotationMappingFinding = {
  fieldId: string; label: string; required: boolean;
  manualOptions: OptionReference[]; automaticOptions?: OptionReference[];
  workbookOnlyAutomatic?: true;
};

export function QuotationMappingReview({ findings, disabled, onInspect, onManage }: {
  findings: QuotationMappingFinding[]; disabled: boolean;
  onInspect: (target: QuotationNavigationTarget) => void; onManage: () => void;
}) {
  if (!findings.length) return null;
  const needsMapping=findings.some(field=>!field.workbookOnlyAutomatic);
  return <div className="panel-note"><div>
    <strong>{needsMapping?'Excel 열 연결 확인':'공식 파일에 없는 선택 항목'} {findings.length}개</strong>
    {needsMapping&&<p>입력값을 확인한 뒤 카테고리·양식 관리에서 출력할 열을 연결하세요. 항목을 여는 것만으로 값이나 열 연결이 변경되지는 않습니다.</p>}
    <ul>{findings.map(field => {
      const options = new Map<string | null, OptionReference>();
      for (const option of [...field.manualOptions, ...(field.automaticOptions ?? [])]) options.set(option.optionId, option);
      return <li key={field.fieldId}>
        <strong>{field.label}</strong> · {field.workbookOnlyAutomatic?'공식 파일에 없는 선택 항목':field.required ? '카테고리 필수' : field.manualOptions.length ? '수동 수정' : '자동 작성'}
        {field.manualOptions.length > 0 && ` · 직접 수정한 옵션 ${field.manualOptions.length}개`}
        {!!field.automaticOptions?.length && ` · 자동 작성 옵션 ${field.automaticOptions.length}개`}
        {field.workbookOnlyAutomatic&&<p>이 자동값은 검토 자료에 보존되며 제출할 Excel에는 포함되지 않습니다. 직접 입력한 금액을 제출하려면 해당 항목을 담을 수 있는 양식을 연결해야 합니다.</p>}
        <details><summary>{field.workbookOnlyAutomatic?'보존된 입력 확인':'누락된 입력 확인'}</summary>
          {options.size ? <ul>{[...options.values()].map(option => <li key={option.optionId ?? 'common'}>
            <button type="button" className="btn ghost" disabled={disabled} onClick={() => { if (!disabled) onInspect({ optionId: option.optionId, fieldId: field.fieldId }); }}>
              {option.optionLabel} · {field.label} 확인
            </button>
          </li>)}</ul> : <button type="button" className="btn ghost" disabled={disabled} onClick={() => { if (!disabled) onInspect({ optionId: null, fieldId: field.fieldId }); }}>공통 입력에서 {field.label} 확인</button>}
        </details>
      </li>;
    })}</ul>
    {needsMapping&&<button type="button" className="btn ghost" disabled={disabled} onClick={() => { if (!disabled) onManage(); }}>카테고리·양식 연결 수정</button>}
  </div></div>;
}
