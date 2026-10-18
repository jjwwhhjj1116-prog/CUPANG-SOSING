'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { importQuotationWorkbookDraft, quotationWorkbookReviewBasis, quotationWorkbookReviewBefore, quotationWorkbookReviewCandidates, quotationWorkbookReviewIssues, quotationWorkbookReviewTargets, type WorkbookReviewSelection } from '@/app/quotation-workbook-review';
import { quotationValueIssues, type QuotationChange, type QuotationFieldsView } from '@/app/quotation-schema';

const PAGE_SIZE = 25;
type Mapping = { targetFieldKey: string; checked: boolean };
type Props = { view: QuotationFieldsView; changes: readonly QuotationChange[]; disabled: boolean; onApply: (selections: WorkbookReviewSelection[], basis: string) => boolean };
const literal = (value: string, manual = false) => value === '' ? (manual ? '(직접 입력한 공란)' : '(공란)') : value.trim() === '' ? `(공백 ${value.length}자) ${value}` : value;
const requirementLabels: Record<string, string> = { required: '필수', conditional: '조건부', optional: '선택' };
const requirement = (value: string) => requirementLabels[value] ?? value;

export function QuotationWorkbookReview({ view, changes, disabled, onApply }: Props) {
  const [mapping, setMapping] = useState<Record<string, Mapping>>({}), [page, setPage] = useState(0), [error, setError] = useState('');
  const token = useMemo(() => ({ view, changes, disabled, onApply }), [view, changes, disabled, onApply]);
  const live = useRef({ token, mapping, disabled, alive: false });
  useLayoutEffect(() => {
    live.current = { token, mapping, disabled, alive: true };
    return () => { live.current.alive = false; };
  }, [token, mapping, disabled]);
  const current = () => live.current.alive && live.current.token === token && live.current.mapping === mapping && !live.current.disabled;
  let candidates, targets;
  try { candidates = quotationWorkbookReviewCandidates(view); targets = quotationWorkbookReviewTargets(view); }
  catch (cause) { return <p role="alert" className="quotation-fields-notice">{cause instanceof Error ? cause.message : '이전 Excel 입력을 확인해주세요.'}</p>; }
  if (!candidates.length) return null;
  const basis = quotationWorkbookReviewBasis(view, changes);
  const mapped = (sourceKey: string, suggestedTarget: string): Mapping => mapping[sourceKey] ?? { targetFieldKey: suggestedTarget, checked: false };
  const selected = candidates.flatMap(item => {
    const choice = mapped(item.sourceKey, item.suggestedTarget);
    return choice.checked ? [{ sourceKey: item.sourceKey, targetFieldKey: choice.targetFieldKey }] : [];
  });
  const sources = new Map(candidates.map(item => [item.sourceKey, item]));
  const targetCounts = new Map<string, number>();
  for (const selection of selected) {
    const source = sources.get(selection.sourceKey)!;
    const targetKey = JSON.stringify([source.optionId, selection.targetFieldKey]);
    targetCounts.set(targetKey, (targetCounts.get(targetKey) ?? 0) + 1);
  }
  function change(sourceKey: string, suggestedTarget: string, patch: Partial<Mapping>) {
    if (!current()) return;
    const next = { ...mapping, [sourceKey]: { ...mapped(sourceKey, suggestedTarget), ...patch } };
    live.current.mapping = next; setMapping(next); setError('');
  }
  const pages = Math.ceil(candidates.length / PAGE_SIZE), shownPage = Math.min(page, pages - 1);
  return <details className="quotation-fields-notice"><summary>이전 Excel 양식의 직접 입력 비교 · {candidates.length}개</summary>
    <p>이전 양식: {view.retainedWorkbook!.name} · SHA {view.retainedWorkbook!.sha256}. 저장된 원본에서 확인되는 이전 입력만 표시합니다. 원본을 보관하지 않은 중간 양식의 값은 여기서 복구하지 않습니다.</p>
    <p>현재 항목과 값을 대조하고 직접 선택하세요. 같은 열·항목명은 대상만 제안하며 선택하지 않습니다. 기존 입력과 미저장 입력은 선택한 대상만 교체됩니다. 공통값은 별도 옵션 입력이 없는 옵션에 상속되고, 옵션별 입력이 우선합니다. 옵션의 포함 여부와 이전 원본은 유지합니다.</p>
    <p>가져오기는 편집 초안에만 반영하며 ‘모든 옵션에 적용’을 끕니다. 각 행에 표시된 공통 또는 해당 옵션에만 반영합니다. 확인·수정 후 ‘견적 입력 저장’을 눌러 확정하세요.</p>
    {error && <p role="alert">{error}</p>}
    {!targets.length && <p role="alert">현재 양식에 수정 가능한 Excel 추가 항목이 없습니다.</p>}
    <p>전체 {candidates.length}개 · {shownPage + 1}/{pages}페이지 · 페이지당 {PAGE_SIZE}개 · 선택 {selected.length}개 (다른 페이지 선택 포함, 한 번에 최대 1,000개)</p>
    <div className="table-wrap"><table><thead><tr><th>선택</th><th>이전 옵션 / 항목</th><th>이전 입력</th><th>현재 대상 항목</th><th>현재 입력 · 미저장 포함</th><th>입력 규칙 확인</th></tr></thead><tbody>{candidates.slice(shownPage * PAGE_SIZE, (shownPage + 1) * PAGE_SIZE).map(item => {
      const choice = mapped(item.sourceKey, item.suggestedTarget), issues = quotationWorkbookReviewIssues(view, item, choice.targetFieldKey);
      const target = targets.find(field => field.id === choice.targetFieldKey);
      const duplicate = choice.checked && (targetCounts.get(JSON.stringify([item.optionId, choice.targetFieldKey])) ?? 0) > 1;
      const warnings = target && !issues.length ? quotationValueIssues(target, item.value, view.imageKeys, item.optionId === null ? 'manual-common' : 'manual-option') : [];
      return <tr key={item.sourceKey}>
        <td><input type="checkbox" aria-label={`${item.optionLabel} ${item.source.label} 이전 입력 가져오기`} checked={choice.checked} disabled={disabled || issues.length > 0} onChange={event => change(item.sourceKey, item.suggestedTarget, { checked: event.target.checked })}/></td>
        <td>{item.optionLabel}<br/>{item.source.label}<small> · {item.source.column + 1}열</small></td>
        <td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{literal(item.value, true)}</td>
        <td><select aria-label={`${item.optionLabel} ${item.source.label} 현재 대상 항목`} value={choice.targetFieldKey} disabled={disabled} onChange={event => change(item.sourceKey, item.suggestedTarget, { targetFieldKey: event.target.value, checked: false })}><option value="">현재 항목 선택</option>{targets.map(field => <option key={field.id} value={field.id}>{field.label} · {field.workbookWire!.column + 1}열</option>)}</select></td>
        <td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{choice.targetFieldKey ? literal(quotationWorkbookReviewBefore(view, changes, item.optionId, choice.targetFieldKey)) : '대상 미선택'}</td>
        <td>{[...issues, ...(duplicate ? ['같은 옵션의 현재 대상 항목이 중복됩니다.'] : [])].join(' / ') || `초안에 반영 가능 · ${warnings.length ? warnings.join(' / ') + ' 저장 후 검토 필요' : '의미와 조건은 직접 검토 필요'}`}
          <details><summary>이전 / 현재 입력 규칙 비교</summary>
            <p><strong>이전:</strong> {requirement(item.source.requirement)} · {item.source.type === 'select' ? '선택형' : '문자 입력'}<br/>선택값: {item.source.choices?.map(value => literal(value)).join(' / ') ?? '제한 없음'}<br/>도움말: <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.source.help || '(없음)'}</span></p>
            {target ? <p><strong>현재:</strong> {requirement(target.workbookWire!.requirement)} · {target.type === 'select' ? '선택형' : '문자 입력'}<br/>선택값: {target.choices?.map(choice => `${choice.label} [${literal(choice.value)}]`).join(' / ') ?? '제한 없음'}<br/>길이: {target.minLength ?? 0}~{target.maxLength ?? '제한 없음'}자<br/>도움말: <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{target.help || '(없음)'}</span></p> : <p>현재 대상을 선택하면 입력 규칙을 비교할 수 있습니다.</p>}
          </details>
        </td>
      </tr>;
    })}</tbody></table></div>
    <button type="button" className="btn ghost" disabled={disabled || shownPage === 0} onClick={() => { if (current()) setPage(shownPage - 1); }}>이전 비교 페이지</button>
    <button type="button" className="btn ghost" disabled={disabled || shownPage + 1 >= pages} onClick={() => { if (current()) setPage(shownPage + 1); }}>다음 비교 페이지</button>
    <button type="button" className="btn primary" disabled={disabled || !selected.length || selected.length > 1000} onClick={() => {
      if (!current()) return;
      try { importQuotationWorkbookDraft(view, changes, selected, basis); onApply(selected, basis); }
      catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : '이전 Excel 입력을 확인해주세요.'); }
    }}>선택한 이전 Excel 입력 {selected.length}개를 편집 초안에 가져오기</button>
  </details>;
}
