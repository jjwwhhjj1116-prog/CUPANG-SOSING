'use client';
import { useState } from 'react';
import type { SubmissionIssue } from '@/app/submission-review';
import type { QuotationNavigationTarget } from '@/app/quotation-navigation';

export function QuotationReviewIssues({ issues, omittedIssueCount, disabled, onInspect }: {
  issues: readonly SubmissionIssue[]; omittedIssueCount: number; disabled: boolean;
  onInspect: (target: QuotationNavigationTarget) => void;
}) {
  const [kind, setKind] = useState('all');
  const [option, setOption] = useState('all');
  const [query, setQuery] = useState('');
  const optionKey = (id: string | null) => id === null ? 'common' : `option:${id}`;
  const options = new Map(issues.map(issue => [optionKey(issue.optionId), { id: issue.optionId, label: issue.optionLabel }]));
  const search = query.trim().toLocaleLowerCase();
  const shown = issues.filter(issue => (kind === 'all' || issue.kind === kind)
    && (option === 'all' || optionKey(issue.optionId) === option)
    && (!search || [issue.message, issue.optionLabel, issue.optionId ?? '', issue.fieldId ?? '', issue.code ?? ''].some(text => text.toLocaleLowerCase().includes(search))));
  return <div className="panel-stack">
    <div className="workspace-actions">
      <label>검사 구분<select value={kind} onChange={event => setKind(event.target.value)}><option value="all">전체</option><option value="error">수정 필요</option><option value="review">증빙 확인</option></select></label>
      <label>검사 옵션<select value={option} onChange={event => setOption(event.target.value)}><option value="all">전체 옵션</option>{[...options].map(([key, value]) => <option key={key} value={key}>{value.label} · {value.id ?? '공통'}</option>)}</select></label>
      <label>검사 항목 검색<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="옵션명·항목·내용 검색"/></label>
      <button type="button" className="btn ghost" onClick={() => { setKind('all'); setOption('all'); setQuery(''); }}>검사 필터 초기화</button>
    </div>
    <p role="status">표시 {shown.length}개 / 받은 검사 항목 {issues.length}개 · 필터는 검사 결과를 변경하지 않습니다.</p>
    {shown.length ? <ul>{shown.map((issue, index) => <li key={index}>
      <strong>{issue.kind === 'error' ? '수정' : '확인'} · {issue.optionLabel}</strong> — {issue.message}
      {issue.fieldId && <button type="button" className="btn ghost" disabled={disabled} onClick={() => { if (!disabled) onInspect({ optionId: issue.optionId, fieldId: issue.fieldId! }); }}>이 항목 확인하기</button>}
    </li>)}</ul> : <p>{issues.length ? '조건에 맞는 항목이 없습니다. 필터를 초기화해 전체 결과를 확인해주세요.' : '검사 범위 내에서 표시할 항목이 없습니다. 실제 접수 검증은 별도입니다.'}</p>}
    {omittedIssueCount > 0 && <p>추가 {omittedIssueCount}개 항목이 있습니다. 검색과 필터는 받은 항목에만 적용됩니다. 표시된 오류를 수정한 후 다시 검사해주세요.</p>}
  </div>;
}
