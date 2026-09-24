'use client';
import { QuotationTranslatedAttributes } from '@/app/components/quotation-translated-attributes';

import { resolveQuotationNavigation, type QuotationNavigationTarget } from '@/app/quotation-navigation';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { duplicateQuotationImageIssue, quotationImageRoleIssues, quotationBarcodeIssues, quotationOptionLimitIssue, quotationPriceIssues, quotationValueIssues, validateQuotationChanges, type QuotationField, type QuotationFieldsView, type QuotationOverrides } from '@/app/quotation-schema';
import './quotation-fields-editor.css';
import { QuotationLabelPanel } from '@/app/components/quotation-label-panel';

export type QuotationEditorChange = { fieldKey: string; optionId: string | null; value: string | null };
type Row = QuotationFieldsView['resolved']['rows'][number];
type Cell = Row['fields'][string];
type Conflict = { key: string; change: QuotationEditorChange; before: string | null; saved: string | null; unavailable: boolean; schemaChanged?: boolean };
type BulkPreview = { mode?: 'restore'; base: string; changes: QuotationEditorChange[]; rows: { optionId: string; optionLabel: string; fieldKey: string; label: string; before: string; after: string; manualBefore: boolean }[] };
type Props = { navigationTarget?: QuotationNavigationTarget; productId: string; profileId?: string; refreshToken?: string; onSaved?: () => void; onDirtyChange?: (dirty: boolean) => void };
const sections = [
  { id: 'start', title: '시작 정보', english: 'Start', description: '상품명과 선택한 카테고리를 확인합니다.' },
  { id: 'product', title: '상품 정보', english: 'Product', description: '기본 정보, 판매 가격과 카테고리 속성을 편집합니다.' },
  { id: 'image', title: '이미지', english: 'Image', description: '이 상품에 저장한 이미지와 상세 설명을 연결합니다.' },
  { id: 'legal', title: '법적 정보', english: 'Legal', description: '인증과 상품정보 제공 고시를 실제 자료와 대조합니다.' },
  { id: 'logistics', title: '물류 정보', english: 'Logistics', description: '입고 수량과 포장 상태의 규격을 입력합니다.' },
] as const;
const sourceLabels: Record<string, string> = { 'couplus-default': '쿠플러스 양식 기본값', 'manual-option': '옵션 직접 수정', 'manual-common': '공통 직접 수정', content: '저장 콘텐츠', settings: '기본 설정', option: '저장 옵션', pricing: '가격 계산', product: '저장 상품', schema: '선택 카테고리', empty: '미입력' };
const has = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
export const quotationEditorKey = (optionId: string | null, fieldKey: string) => JSON.stringify([optionId, fieldKey]);
function manualValue(overrides: QuotationOverrides, optionId: string | null, fieldKey: string): string | null {
  const record = optionId === null ? overrides.common : overrides.options[optionId];
  return record && has(record, fieldKey) ? record[fieldKey] : null;
}
export function updateQuotationEditorDraft(overrides: QuotationOverrides, changes: readonly QuotationEditorChange[], change: QuotationEditorChange): QuotationEditorChange[] {
  const key = quotationEditorKey(change.optionId, change.fieldKey);
  const next = changes.filter(item => quotationEditorKey(item.optionId, item.fieldKey) !== key);
  if (manualValue(overrides, change.optionId, change.fieldKey) !== change.value) next.push({ ...change });
  return next;
}
function draftManual(view: QuotationFieldsView, changes: readonly QuotationEditorChange[], optionId: string | null, fieldKey: string) {
  const staged = changes.find(change => change.optionId === optionId && change.fieldKey === fieldKey);
  return staged ? staged.value : manualValue(view.overrides, optionId, fieldKey);
}
export function resolveQuotationEditorCell(view: QuotationFieldsView, changes: readonly QuotationEditorChange[], optionId: string | null, fieldKey: string): Cell {
  const automatic = view.automatic.rows.find(row => row.optionId === optionId)?.fields[fieldKey];
  const saved = view.resolved.rows.find(row => row.optionId === optionId)?.fields[fieldKey];
  const fallback = automatic ?? saved ?? { value: '', source: 'empty', needsReview: false, issues: [] };
  const definition = view.resolved.schema.fields.find(field => field.id === fieldKey);
  if (definition?.readOnly) return fallback;
  const optionValue = optionId === null ? null : draftManual(view, changes, optionId, fieldKey);
  const commonValue = draftManual(view, changes, null, fieldKey);
  const value = optionValue ?? commonValue;
  const source = optionValue !== null ? 'manual-option' : commonValue !== null ? 'manual-common' : fallback.source;
  const resolvedValue = value ?? fallback.value;
  const inherited = value === null ? fallback : saved?.value === value && saved.source === source ? saved : undefined;
  const dynamicIssues = new Set([
    '판매가는 공급가보다 작을 수 없습니다.', duplicateQuotationImageIssue,
    '실제 바코드 번호를 입력해주세요.', '바코드 생성 요청 방식과 입력된 번호가 충돌합니다.',
    ...quotationBarcodeIssues(view.resolved.schema.categoryId, 'existing', resolvedValue),
  ]);
  const validationIssues = [...new Set([
    ...(inherited?.validationIssues ?? inherited?.issues ?? []).filter(issue => !dynamicIssues.has(issue)),
    ...(definition ? quotationValueIssues(definition, resolvedValue, view.imageKeys) : []),
    ...(fieldKey === 'salePrice' ? quotationPriceIssues(view.resolved.schema, resolveQuotationEditorCell(view, changes, optionId, 'supplyPrice').value, resolvedValue) : []),
  ])];
  if (fieldKey === 'barcode') {
    const mode = resolveQuotationEditorCell(view, changes, optionId, 'barcodeMode').value;
    validationIssues.push(...quotationBarcodeIssues(view.resolved.schema.categoryId, mode, resolvedValue));
    if (mode === 'existing' && !resolvedValue.trim()) validationIssues.push('실제 바코드 번호를 입력해주세요.');
    if (mode === 'request-coupang' && resolvedValue.trim()) validationIssues.push('바코드 생성 요청 방식과 입력된 번호가 충돌합니다.');
  }
  if (definition?.type === 'images' && resolvedValue) validationIssues.push('비공개 이미지 참조입니다. 외부 접수용 공개 주소는 아직 생성되지 않았습니다.');
  const reviewMessages: string[] = [];
  if (source === 'couplus-default') reviewMessages.push('쿠플러스 참조 화면의 양식 기본값입니다. 실제 상품의 해당 여부를 확인해주세요.');
  if (definition?.reviewRequired && resolvedValue.trim()) reviewMessages.push('실제 상품·증빙과 일치하는지 확인해주세요.');
  const errors = [...new Set(validationIssues)];
  const issues = [...new Set([...errors, ...reviewMessages,
    ...(fieldKey === 'detailImages' ? quotationImageRoleIssues(resolveQuotationEditorCell(view, changes, optionId, 'mainImage').value, resolvedValue) : []),
  ])];
  return { ...fallback, value: resolvedValue, source, issues, validationIssues: errors, reviewMessages,
    needsReview: Boolean(definition?.reviewRequired) || issues.length > 0 };
}
export function reconcileQuotationEditorDraft(previous: QuotationFieldsView, next: QuotationFieldsView, changes: readonly QuotationEditorChange[], pending: readonly Conflict[] = []) {
  const conflicts: Conflict[] = [];
  const retained = changes.filter(change => {
    const before = manualValue(previous.overrides, change.optionId, change.fieldKey);
    const saved = manualValue(next.overrides, change.optionId, change.fieldKey);
    const unavailable = !next.resolved.schema.fields.some(field => field.id === change.fieldKey && !field.readOnly) || !next.resolved.rows.some(row => row.optionId === change.optionId);
    const key = quotationEditorKey(change.optionId, change.fieldKey);
    const definition = (view: QuotationFieldsView) => view.resolved.schema.fields.find(field => field.id === change.fieldKey);
    const schemaChanged = previous.resolved.schema.categoryId !== next.resolved.schema.categoryId ||
      JSON.stringify(definition(previous)) !== JSON.stringify(definition(next)) || pending.some(conflict => conflict.key === key && conflict.schemaChanged);
    if (!unavailable && !schemaChanged && saved === change.value) return false;
    if (unavailable || schemaChanged || before !== saved || pending.some(conflict => conflict.key === key)) conflicts.push({ key, change, before, saved, unavailable, ...(schemaChanged ? { schemaChanged: true } : {}) });
    return true;
  });
  return { changes: retained.map(change => ({ ...change })), conflicts };
}
function bulkBase(view: QuotationFieldsView, changes: readonly QuotationEditorChange[]) { return JSON.stringify([view.revision, view.inputFingerprint, changes]); }
export function previewQuotationEditorBulk(view: QuotationFieldsView, changes: readonly QuotationEditorChange[], sourceOptionId: string | null, fieldKeys: readonly string[], includedOnly: boolean): BulkPreview {
  if (!view.resolved.rows.some(row => row.optionId === sourceOptionId)) throw new Error('편집할 옵션을 다시 선택해주세요.');
  const fields = [...new Set(fieldKeys)].map(key => view.resolved.schema.fields.find(field => field.id === key));
  if (!fields.length || fields.some(field => !field || field.readOnly)) throw new Error('적용할 수정 가능 항목을 선택해주세요.');
  const rows: BulkPreview['rows'] = []; const planned: QuotationEditorChange[] = [];
  for (const row of view.resolved.rows) {
    if (row.optionId === null || row.optionId === sourceOptionId || (includedOnly && !row.included)) continue;
    for (const field of fields as QuotationField[]) {
      const before = resolveQuotationEditorCell(view, changes, row.optionId, field.id);
      const after = resolveQuotationEditorCell(view, changes, sourceOptionId, field.id).value;
      if (draftManual(view, changes, row.optionId, field.id) === after) continue;
      rows.push({ optionId: row.optionId, optionLabel: row.optionLabel, fieldKey: field.id, label: field.label, before: before.value, after, manualBefore: before.source.startsWith('manual-') });
      planned.push({ optionId: row.optionId, fieldKey: field.id, value: after });
      if (planned.length > 1000) throw new Error('한 번에 1,000개 값까지 적용할 수 있습니다. 항목 선택 범위를 줄여주세요.');
    }
  }
  return { base: bulkBase(view, changes), changes: planned, rows };
}
/** Remove only selected option overrides. Shared edits remain the inheritance source. */
export function previewQuotationEditorRestore(view: QuotationFieldsView, changes: readonly QuotationEditorChange[], fieldKeys: readonly string[], includedOnly: boolean): BulkPreview {
  const fields = [...new Set(fieldKeys)].map(key => view.resolved.schema.fields.find(field => field.id === key));
  if (!fields.length || fields.some(field => !field || field.readOnly)) throw new Error('복원할 수정 가능 항목을 선택해주세요.');
  const rows: BulkPreview['rows'] = []; const planned: QuotationEditorChange[] = [];
  for (const row of view.resolved.rows) {
    if (row.optionId === null || (includedOnly && !row.included)) continue;
    for (const field of fields as QuotationField[]) {
      if (draftManual(view, changes, row.optionId, field.id) === null) continue;
      const reset = { optionId: row.optionId, fieldKey: field.id, value: null };
      const before = resolveQuotationEditorCell(view, changes, row.optionId, field.id);
      const after = resolveQuotationEditorCell(view, updateQuotationEditorDraft(view.overrides, changes, reset), row.optionId, field.id);
      rows.push({ optionId: row.optionId, optionLabel: row.optionLabel, fieldKey: field.id, label: field.label, before: before.value, after: after.value, manualBefore: true });
      planned.push(reset);
      if (planned.length > 1000) throw new Error('한 번에 1,000개 값까지 복원할 수 있습니다. 항목 선택 범위를 줄여주세요.');
    }
  }
  return { mode: 'restore', base: bulkBase(view, changes), changes: planned, rows };
}
export function applyQuotationEditorBulk(view: QuotationFieldsView, changes: readonly QuotationEditorChange[], preview: BulkPreview) {
  if (preview.base !== bulkBase(view, changes)) throw new Error('미리보기 이후 입력이 바뀌었습니다. 적용 범위를 다시 확인해주세요.');
  const next = preview.changes.reduce((draft, change) => updateQuotationEditorDraft(view.overrides, draft, change), [...changes]);
  if (next.length > 1000) throw new Error('저장할 수정은 한 번에 1,000개까지입니다. 현재 수정부터 저장한 뒤 적용 범위를 줄여주세요.');
  return next;
}
export function quotationEditorIssues(field: QuotationField, cell: Cell, imageKeys: readonly string[]) {
  return [...new Set([...cell.issues, ...quotationValueIssues(field, cell.value, imageKeys)])];
}
function imageValues(value: string) { return [...new Set(value.split('\n').map(key => key.trim()).filter(Boolean))]; }
export function quotationOptionOverview(view: QuotationFieldsView, changes: readonly QuotationEditorChange[]) {
  return view.resolved.rows.filter(row => row.included).map(row => {
    let linked = 0; let defaults = 0; let manual = 0; let missing = 0;
    const problems: { fieldKey: string; label: string; section: QuotationField['section']; issues: string[] }[] = [];
    for (const field of view.resolved.schema.fields) {
      const cell = resolveQuotationEditorCell(view, changes, row.optionId, field.id);
      if (cell.source.startsWith('manual-')) manual++;
      else if (cell.source === 'couplus-default') defaults++;
      else if (cell.source !== 'empty' && cell.value.trim()) linked++;
      if (field.required && !cell.value.trim()) missing++;
      const issues = quotationValueIssues(field, cell.value, view.imageKeys);
      if (field.id === 'salePrice') issues.push(...quotationPriceIssues(view.resolved.schema,
        resolveQuotationEditorCell(view, changes, row.optionId, 'supplyPrice').value, cell.value));
      if (field.id === 'detailImages') issues.push(...quotationImageRoleIssues(resolveQuotationEditorCell(view, changes, row.optionId, 'mainImage').value, cell.value));
      if (field.id === 'barcode') {
        const mode = resolveQuotationEditorCell(view, changes, row.optionId, 'barcodeMode').value;
        issues.push(...quotationBarcodeIssues(view.resolved.schema.categoryId, mode, cell.value));
        if (mode === 'existing' && !cell.value.trim()) issues.push('실제 바코드 번호를 입력해주세요.');
        if (mode === 'request-coupang' && cell.value.trim()) issues.push('바코드 생성 요청 방식과 입력된 번호가 충돌합니다.');
      }
      if (issues.length) problems.push({ fieldKey: field.id, label: field.label, section: field.section, issues });
    }
    return { optionId: row.optionId, optionLabel: row.optionLabel, linked, defaults, manual, missing, problems };
  });
}
export function QuotationOptionOverview({ view, changes, disabled, onOpen }: {
  view: QuotationFieldsView; changes: readonly QuotationEditorChange[]; disabled: boolean;
  onOpen: (optionId: string | null, section: QuotationField['section']) => void;
}) {
  const rows = quotationOptionOverview(view, changes);
  return <details className="quotation-fields-notice" open><summary>전체 견적 작성 현황 · 포함 {rows.length}개 · 필수 미입력 {rows.reduce((sum, row) => sum + row.missing, 0)}개</summary>
    <p>미저장 입력까지 반영한 항목 수입니다. 직접 수정한 공란도 수정으로 집계합니다. 양식 기본값과 입력 형식 확인은 실제 상품 검증·등록 가능 판정과 다릅니다. 제외 옵션은 집계하지 않습니다.</p>
    {rows.length > 0 && <div className="quotation-fields-bulk-table"><table><thead><tr><th>옵션</th><th>저장 자료 연동</th><th>양식 기본값</th><th>직접 수정</th><th>필수 미입력</th><th>입력 확인</th></tr></thead><tbody>{rows.map(row => <tr key={row.optionId ?? 'common'}>
      <td><button type="button" className="quotation-field-text-button" disabled={disabled} onClick={() => onOpen(row.optionId, 'start')}>{row.optionLabel}</button></td>
      <td>{row.linked}</td><td>{row.defaults}</td><td>{row.manual}</td><td>{row.missing}</td>
      <td>{row.problems.length ? row.problems.map(problem => <div key={problem.fieldKey}><button type="button" className="quotation-field-text-button" disabled={disabled} onClick={() => onOpen(row.optionId, problem.section)}>{problem.label} 구역 열기</button><small> · {problem.issues.join(' / ')}</small></div>) : '필수·형식 오류 없음 · 별도 검토 필요'}</td>
    </tr>)}</tbody></table></div>}
  </details>;
}
export function legacyQuotationCandidates(view: QuotationFieldsView, changes: readonly QuotationEditorChange[]) {
  if (!view.categoryContext.categoryId || !view.legacyOverrides) return [];
  const entries: [string | null, Record<string, string>][] = [[null, view.legacyOverrides.common], ...Object.entries(view.legacyOverrides.options)];
  return entries.flatMap(([optionId, values]) => Object.entries(values).map(([fieldKey, value]) => {
    const field = view.resolved.schema.fields.find(item => item.id === fieldKey);
    const row = view.resolved.rows.find(item => item.optionId === optionId);
    const issues = !field || field.readOnly || !row ? ['현재 양식에서 수정할 수 없는 항목 또는 삭제된 옵션입니다.'] : value.trim() ? quotationValueIssues(field, value, view.imageKeys) : [];
    return { key: quotationEditorKey(optionId, fieldKey), change: { optionId, fieldKey, value }, label: field?.label ?? fieldKey,
      optionLabel: row?.optionLabel ?? (optionId === null ? '공통' : optionId),
      before: row && field ? resolveQuotationEditorCell(view, changes, optionId, fieldKey).value : '', issues };
  }));
}
export function importLegacyQuotationDraft(view: QuotationFieldsView, changes: readonly QuotationEditorChange[], keys: readonly string[]) {
  const candidates = legacyQuotationCandidates(view, changes);
  if (!keys.length || new Set(keys).size !== keys.length) throw new Error('가져올 이전 항목을 선택해주세요.');
  const chosen = keys.map(key => candidates.find(item => item.key === key));
  if (chosen.some(item => !item || item.issues.length)) throw new Error('현재 양식에 맞지 않는 이전 입력은 가져올 수 없습니다.');
  const draft = chosen.reduce((current, item) => updateQuotationEditorDraft(view.overrides, current, item!.change), [...changes]);
  validateQuotationChanges(draft, { schema: view.resolved.schema, optionIds: view.resolved.rows.flatMap(row => row.optionId === null ? [] : [row.optionId]), ownedImageKeys: view.imageKeys, overrides: view.overrides });
  return draft;
}
function LegacyQuotationImport({ view, changes, disabled, onApply }: { view: QuotationFieldsView; changes: QuotationEditorChange[]; disabled: boolean; onApply: (keys: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const candidates = legacyQuotationCandidates(view, changes);
  if (!candidates.length) return null;
  return <details className="quotation-fields-notice"><summary>분류 미지정 이전 입력 비교 · {candidates.length}개</summary>
    <p>이전 자료에는 카테고리 기록이 없습니다. 현재 양식과 비교해 선택하세요. 선택한 현재 입력은 교체되며 이전 원본은 보존됩니다. 적용 후 견적 입력 저장을 눌러 확정하세요.</p>
    <div className="table-wrap"><table><thead><tr><th>선택</th><th>옵션 / 항목</th><th>현재 입력</th><th>이전 입력</th><th>확인 사항</th></tr></thead><tbody>{candidates.map(item => <tr key={item.key}>
      <td><input type="checkbox" aria-label={`${item.optionLabel} ${item.label} 가져오기`} checked={selected.includes(item.key)} disabled={disabled || item.issues.length > 0} onChange={event => setSelected(previous => event.target.checked ? [...previous, item.key] : previous.filter(key => key !== item.key))}/></td>
      <td>{item.optionLabel}<br/>{item.label}</td><td style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{item.before || '(공란)'}</td><td style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{item.change.value || '(공란)'}</td><td>{item.issues.join(' / ')}</td>
    </tr>)}</tbody></table></div><button type="button" className="btn primary" disabled={disabled || !selected.length} onClick={() => onApply(selected)}>선택한 {selected.length}개를 편집 초안에 적용</button>
  </details>;
}
async function fetchView(endpoint: string, signal?: AbortSignal): Promise<QuotationFieldsView> {
  const response = await fetch(endpoint, { signal, cache: 'no-store' });
  const body = await response.json() as QuotationFieldsView & { error?: string };
  if (!response.ok || !body.resolved || !body.automatic) throw new Error(body.error || '견적 입력 자료를 불러오지 못했습니다.');
  return body;
}

export function QuotationFieldsEditor(props: Props) { return <QuotationFieldsForm key={`${props.productId}:${props.profileId ?? ''}`} {...props} />; }
function QuotationFieldsForm({ navigationTarget, productId, profileId, refreshToken, onSaved, onDirtyChange }: Props) {
  const endpoint = `/api/products/${encodeURIComponent(productId)}/quotation-fields${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`;
  const [view, setView] = useState<QuotationFieldsView | null>(null);
  const [changes, setChanges] = useState<QuotationEditorChange[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [active, setActive] = useState<(typeof sections)[number]['id']>('start');
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [includedOnly, setIncludedOnly] = useState(true);
  const [bulk, setBulk] = useState<BulkPreview | null>(null);
  const initialTarget = useRef(navigationTarget); const pendingFocus = useRef<string | null>(null);
  const requests = useRef(0); const observedRefresh = useRef(refreshToken); const prefix = useId();
  const invalidateRequests = useCallback(() => { requests.current++; }, []);
  const dirty = changes.length > 0;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    const controller = new AbortController(); const id = ++requests.current;
    fetchView(endpoint, controller.signal).then(saved => { if (!controller.signal.aborted && id === requests.current) {
        setView(saved);
        if (initialTarget.current) {
          const destination = resolveQuotationNavigation(saved.resolved, initialTarget.current);
          if (destination.ok) { setSelectedOption(destination.optionId); setActive(destination.section); pendingFocus.current = destination.fieldId; setMessage(destination.message); }
          else setMessage(destination.message);
        }
      } })
      .catch(cause => { if (!controller.signal.aborted && id === requests.current) setError(cause instanceof Error ? cause.message : '견적 입력 자료 확인 실패'); })
      .finally(() => { if (!controller.signal.aborted && id === requests.current) setLoading(false); });
    return () => { controller.abort(); invalidateRequests(); };
  }, [endpoint, invalidateRequests]);
  useEffect(() => {
    if (loading || !pendingFocus.current) return;
    const element = document.getElementById(`${prefix}-${pendingFocus.current}`);
    if (element) { element.scrollIntoView({ block: 'center' }); element.focus({ preventScroll: true }); pendingFocus.current = null; }
  }, [loading, view, active, selectedOption, prefix]);
  const refresh = useCallback(async (discard = false) => {
    const id = ++requests.current; setLoading(true); setError(''); setBulk(null);
    try {
      const saved = await fetchView(endpoint);
      if (id !== requests.current) return;
      const reconciled = view && !discard ? reconcileQuotationEditorDraft(view, saved, changes, conflicts) : { changes: [], conflicts: [] };
      setView(saved); setChanges(reconciled.changes); setConflicts(reconciled.conflicts);
      if (!saved.resolved.rows.some(row => row.optionId === selectedOption)) setSelectedOption(null);
      setMessage(discard ? '현재 입력을 버리고 저장본을 불러왔습니다.' : reconciled.conflicts.length ? '저장값 또는 카테고리·항목 규격이 바뀌었습니다. 입력을 검토하고 사용할 값을 선택해주세요.' : '최신 상품·옵션·기본값을 반영했습니다. 직접 입력한 내용은 유지했습니다.');
    } catch (cause) { if (id === requests.current) setError(cause instanceof Error ? cause.message : '최신 자료 확인 실패'); }
    finally { if (id === requests.current) setLoading(false); }
  }, [endpoint, view, changes, conflicts, selectedOption]);
  useEffect(() => {
    if (observedRefresh.current === refreshToken || busy || loading) return;
    observedRefresh.current = refreshToken;
    void Promise.resolve().then(() => refresh());
  }, [refreshToken, refresh, busy, loading]);
  useEffect(() => {
    const focus = () => { if (view && !busy && !loading) void refresh(); };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [view, busy, loading, refresh]);

  function edit(fieldKey: string, value: string | null, optionId: string | null = selectedOption) {
    if (!view) return;
    setChanges(previous => updateQuotationEditorDraft(view.overrides, previous, { fieldKey, optionId, value }));
    setConflicts(previous => previous.filter(conflict => conflict.key !== quotationEditorKey(optionId, fieldKey)));
    setBulk(null); setMessage('');
  }
  async function save() {
    if (!view || !changes.length || conflicts.length) return;
    setBusy(true); setError(''); setMessage(''); setBulk(null);
    try {
      validateQuotationChanges(changes, { schema: view.resolved.schema, optionIds: view.resolved.rows.flatMap(item => item.optionId === null ? [] : [item.optionId]), ownedImageKeys: view.imageKeys, overrides: view.overrides });
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes }) });
      const body = await response.json() as QuotationFieldsView & { error?: string };
      if (!response.ok || !body.resolved || !body.automatic) {
        if (response.status === 409) { await refresh(); setError(body.error || '저장 중 원본이 바뀌었습니다. 현재 입력을 보존했습니다. 최신 값을 검토한 뒤 다시 저장해주세요.'); return; }
        throw new Error(body.error || '견적 입력을 저장하지 못했습니다.');
      }
      setView(body); setChanges([]); setConflicts([]); setMessage('견적 입력 저장 완료 · 출력 미리보기에 반영됩니다.'); onSaved?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '견적 입력 저장 실패'); }
    finally { setBusy(false); }
  }
  const schema = view?.resolved.schema;
  const row = view?.resolved.rows.find(item => item.optionId === selectedOption);
  const activeSection = sections.find(section => section.id === active)!;
  const sectionFields = schema?.fields.filter(field => field.section === active) ?? [];
  const counts = sections.map(section => {
    const fields = schema?.fields.filter(field => field.section === section.id) ?? [];
    const required = fields.filter(field => field.required);
    return { ...section, required: required.length, complete: view ? required.filter(field => !quotationValueIssues(field, resolveQuotationEditorCell(view, changes, selectedOption, field.id).value, view.imageKeys).length).length : 0 };
  });
  const allIssues = view && schema ? schema.fields.flatMap(field => quotationEditorIssues(field, resolveQuotationEditorCell(view, changes, selectedOption, field.id), view.imageKeys).map(issue => ({ field, issue }))) : [];
  const missingRequired = view && schema ? schema.fields.filter(field => field.required && !resolveQuotationEditorCell(view, changes, selectedOption, field.id).value.trim()).length : 0;
  const optionCount = view?.resolved.rows.filter(item => item.optionId !== null).length ?? 0;
  const optionLimitIssue = view && schema ? quotationOptionLimitIssue(schema, view.resolved.rows.filter(item => item.optionId !== null && item.included).length) : null;
  let hasInvalidDraft = false; let invalidDraftMessage = '';
  if (view && changes.length) try { validateQuotationChanges(changes, { schema: view.resolved.schema, optionIds: view.resolved.rows.flatMap(item => item.optionId === null ? [] : [item.optionId]), ownedImageKeys: view.imageKeys, overrides: view.overrides }); } catch (cause) { hasInvalidDraft = true; invalidDraftMessage = cause instanceof Error ? cause.message : '수정한 필드의 입력 오류를 확인해주세요.'; }

  return <section className="quotation-fields" aria-busy={loading || busy}>
    <div className="quotation-fields-heading"><div><h3>카테고리별 견적 입력</h3><p>저장 자료를 자동으로 채우고, 필요한 항목만 직접 수정합니다.</p></div><button type="button" className="btn ghost" disabled={loading || busy} onClick={() => void refresh()}>기본값 다시 반영</button></div>
    {loading && <p role="status">최신 견적 입력을 확인하는 중입니다.</p>}
    {error && <p role="alert" className="collection-error">{error}</p>}
    {message && <p role="status" className="quotation-fields-notice">{message}</p>}
    {schema && <div className="quotation-fields-category"><strong>{schema.categoryPath.join(' › ') || '카테고리 미연결'}{schema.categoryId ? ` · ${schema.categoryId}` : ''}</strong><small>{schema.status !== 'observed' && '이 카테고리의 세부 규격은 미확인입니다. '}{schema.evidence}</small></div>}
    {view && <>
      <QuotationOptionOverview view={view} changes={changes} disabled={busy || loading} onOpen={(optionId, section) => { setSelectedOption(optionId); setActive(section); setBulk(null); }}/>
      <LegacyQuotationImport key={JSON.stringify([view.revision, view.inputFingerprint, changes])} view={view} changes={changes} disabled={busy || loading || conflicts.length > 0} onApply={keys => {
        try { setChanges(importLegacyQuotationDraft(view, changes, keys)); setBulk(null); setError(''); setMessage('선택한 이전 입력을 초안에 반영했습니다. 현재 분류에 저장하려면 견적 입력 저장을 눌러주세요.'); }
        catch (cause) { setError(cause instanceof Error ? cause.message : '이전 입력을 확인해주세요.'); }
      }}/>
      {optionLimitIssue && <p className="quotation-fields-notice" role="alert">{optionLimitIssue}</p>}
      {!view.resolved.rows.some(item => item.included) && <p className="quotation-fields-notice" role="alert">견적에 포함된 옵션이 없습니다. 옵션 설정에서 상품 옵션을 추가하거나 포함을 선택해주세요. 공통 입력은 보존되지만 견적서 출력 대상은 아닙니다.</p>}
      <div className="quotation-fields-toolbar"><label className="field"><span>편집할 옵션</span><select value={selectedOption ?? ''} disabled={loading || busy} onChange={event => { setSelectedOption(event.target.value || null); setBulk(null); }}>{view.resolved.rows.map(item => <option key={item.optionId ?? 'common'} value={item.optionId ?? ''}>{item.optionId === null ? '상품 공통값' : `${item.optionLabel}${item.included ? '' : ' · 견적 제외'}`}</option>)}</select></label><small>{selectedOption === null ? '공통 수정은 별도로 수정하지 않은 옵션에도 적용됩니다. 옵션별 입력은 개별 값을 우선 사용합니다.' : '선택한 옵션만 수정합니다. 다른 옵션에도 같은 값을 넣으려면 항목을 선택한 뒤 적용 범위를 확인하세요.'}</small></div>
      <div className="quotation-fields-summary"><span>현재 옵션 필수 미입력 <b>{missingRequired}개</b></span><span>입력 확인 <b>{allIssues.length}건</b></span><span>미저장 수정 <b>{changes.length}개</b></span></div>
      <nav className="quotation-fields-section-nav" aria-label="견적 입력 구역">{counts.map((section, index) => <button key={section.id} type="button" disabled={busy || loading} aria-pressed={active === section.id} onClick={() => setActive(section.id)}><b>{index + 1}</b><span>{section.title}</span><small>{section.complete}/{section.required} 필수 입력</small></button>)}</nav>
      {conflicts.length > 0 && <div className="quotation-fields-notice" role="alert"><strong>다시 검토할 항목 {conflicts.length}개</strong><ul className="quotation-fields-conflicts">{conflicts.map(conflict => <li key={conflict.key}><strong>{schema?.fields.find(field => field.id === conflict.change.fieldKey)?.label ?? conflict.change.fieldKey} · {view.resolved.rows.find(item => item.optionId === conflict.change.optionId)?.optionLabel ?? '삭제된 옵션'}</strong>{conflict.schemaChanged && <p>카테고리 또는 항목 규격이 변경되었습니다. 같은 값이라도 새 양식에 맞는지 확인해주세요.</p>}<p>{conflict.unavailable ? '현재 카테고리 또는 옵션에 없는 입력입니다.' : `현재 저장값: ${conflict.saved === null ? '자동값 사용' : conflict.saved || '(공란)'}`}</p><p>내 입력: {conflict.change.value === null ? '수동 수정 해제' : conflict.change.value || '(공란)'}</p><div className="quote-actions">{!conflict.unavailable && <button type="button" className="btn ghost" disabled={busy || loading} onClick={() => setConflicts(previous => previous.filter(item => item.key !== conflict.key))}>내 입력 유지</button>}<button type="button" className="btn ghost" disabled={busy || loading} onClick={() => { setChanges(previous => previous.filter(change => quotationEditorKey(change.optionId, change.fieldKey) !== conflict.key)); setConflicts(previous => previous.filter(item => item.key !== conflict.key)); setBulk(null); }}>{conflict.unavailable ? '이 입력 제외' : '저장된 값 사용'}</button></div></li>)}</ul></div>}
      {row && <fieldset className="quotation-fields-section" disabled={busy || loading} style={{ padding: 0, margin: 0, minWidth: 0 }}><header><h4>{activeSection.english} · {activeSection.title}</h4><small>* 필수 입력</small><p className="quotation-field-help" style={{ width: '100%' }}>{activeSection.description}</p></header><div className="quotation-fields-grid">{sectionFields.map(field => {
        const cell = resolveQuotationEditorCell(view, changes, selectedOption, field.id);
        const automatic = view.automatic.rows.find(item => item.optionId === selectedOption)?.fields[field.id];
        const issues = quotationEditorIssues(field, cell, view.imageKeys);
        const id = `${prefix}-${field.id}`; const ownManual = draftManual(view, changes, selectedOption, field.id) !== null;
        const inheritedManual = selectedOption !== null && !ownManual && cell.source === 'manual-common';
        const editable = !field.readOnly; const imageKeys = imageValues(cell.value);
        const inputProps = { id, value: cell.value, readOnly: !editable, 'aria-invalid': quotationValueIssues(field, cell.value, view.imageKeys).length > 0, 'aria-describedby': `${id}-notes`, onChange: (event: { target: { value: string } }) => edit(field.id, event.target.value) };
        return <div className={`quotation-field ${field.type === 'textarea' || field.type === 'images' ? 'wide' : ''}`} key={field.id}>
          <div className="quotation-field-heading"><label htmlFor={id}>{field.label}{field.unit ? ` (${field.unit})` : ''}{field.required && <b>*</b>}</label><div className="quotation-field-badges"><span className={`quotation-field-badge ${cell.source.startsWith('manual-') ? 'manual' : ''}`}>{sourceLabels[cell.source] ?? cell.source}</span>{field.visibility === 'exposed' && <span className="quotation-field-badge">노출 속성</span>}{field.visibility === 'hidden' && <span className="quotation-field-badge">비노출 속성</span>}{cell.needsReview && <span className="quotation-field-badge review">검토 필요</span>}</div></div>
          {field.type === 'select' && editable ? <select {...inputProps}>{!field.choices?.some(choice => choice.value === '') && <option value="">선택하지 않음</option>}{cell.value && !field.choices?.some(choice => choice.value === cell.value) && <option value={cell.value}>{cell.value} · 목록 외 저장값</option>}{field.choices?.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select>
            : field.type === 'textarea' || field.type === 'images' ? <textarea {...inputProps} rows={field.type === 'images' ? 2 : 3} placeholder={field.type === 'images' ? '아래에서 이 상품의 이미지 파일을 선택하세요.' : '확인한 내용을 입력하세요.'} />
              : <input {...inputProps} type="text" inputMode={field.type === 'number' ? 'decimal' : 'text'} placeholder={field.readOnly ? '' : '확인한 내용을 입력하세요.'} />}
          {field.type === 'images' && <><div className="quotation-fields-image-list">{view.imageKeys.map((key, index) => <button className="quotation-fields-image-choice" key={key} type="button" disabled={!editable} aria-pressed={imageKeys.includes(key)} aria-label={`이미지 ${index + 1} ${imageKeys.includes(key) ? '연결 해제' : '연결'}`} onClick={() => edit(field.id, (imageKeys.includes(key) ? imageKeys.filter(item => item !== key) : field.maxItems === 1 ? [key] : [...imageKeys, key]).join('\n'))}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files/${key.split('/').map(encodeURIComponent).join('/')}`} alt={`업로드 이미지 ${index + 1}`} loading="lazy" /><span>이미지 {index + 1}</span>{imageKeys.includes(key) && <b>{imageKeys.indexOf(key) + 1}</b>}</button>)}</div>{imageKeys.length > 0 && <div className="quotation-fields-image-selected">{imageKeys.map((key, index) => <div key={key}><span>{index + 1}. {view.imageKeys.includes(key) ? `이미지 ${view.imageKeys.indexOf(key) + 1}` : `연결 확인: ${key}`}</span><button type="button" disabled={!editable || index === 0} aria-label={`${index + 1}번 이미지 앞으로`} onClick={() => { const next = [...imageKeys]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; edit(field.id, next.join('\n')); }}>↑</button><button type="button" disabled={!editable || index === imageKeys.length - 1} aria-label={`${index + 1}번 이미지 뒤로`} onClick={() => { const next = [...imageKeys]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; edit(field.id, next.join('\n')); }}>↓</button><button type="button" disabled={!editable} onClick={() => edit(field.id, imageKeys.filter(item => item !== key).join('\n'))}>제외</button></div>)}</div>}</>}
          <div id={`${id}-notes`}>{'help' in field && field.help ? <p className="quotation-field-help">{String(field.help)}</p> : null}{issues.map(issue => <p key={issue} className="quotation-field-issue">{issue}</p>)}</div>
          {ownManual && <div className="quotation-field-auto">{selectedOption !== null && draftManual(view, changes, null, field.id) !== null ? `수정 해제 후 공통값: ${draftManual(view, changes, null, field.id) || '(공란)'}` : `자동값 (${sourceLabels[automatic?.source ?? 'empty'] ?? '저장 자료'}): ${automatic?.value || '(미입력)'}`}</div>}
          <div className="quotation-field-footer"><div>{editable && ownManual && <button type="button" className="quotation-field-text-button" onClick={() => edit(field.id, null)}>{selectedOption !== null && draftManual(view, changes, null, field.id) !== null ? '수정 해제 · 공통값 사용' : '수정 해제 · 자동값 복원'}</button>}{inheritedManual && <small>공통값을 따릅니다. 여기서 입력하면 이 옵션만 바뀝니다.</small>}{field.maxLength && <small> {cell.value.length}/{field.maxLength}자</small>}</div>{editable && optionCount > 0 && <label className="quotation-field-select-copy"><input type="checkbox" checked={selectedFields.includes(field.id)} onChange={event => { setSelectedFields(previous => event.target.checked ? [...previous, field.id] : previous.filter(key => key !== field.id)); setBulk(null); }} />다른 옵션에 적용</label>}</div>
        </div>;
      })}</div></fieldset>}
      {optionCount > 0 && selectedFields.length > 0 && <div className="quotation-fields-bulk"><strong>선택한 {selectedFields.length}개 항목 · 옵션별 일괄 작업</strong><p>선택한 항목의 현재 값을 복사합니다. 적용 대상의 기존 수동값도 바뀌며, 복사한 값은 이후 기본값 변경을 자동으로 따르지 않습니다.</p><label className="quotation-field-select-copy"><input type="checkbox" checked={includedOnly} disabled={busy || loading} onChange={event => { setIncludedOnly(event.target.checked); setBulk(null); }} />견적에 포함된 옵션만 적용</label><div className="quote-actions"><button type="button" className="btn ghost" disabled={busy || loading} onClick={() => { setSelectedFields([]); setBulk(null); }}>항목 선택 해제</button><button type="button" className="btn ghost" disabled={busy || loading || conflicts.length > 0} onClick={() => { try { setBulk(previewQuotationEditorBulk(view, changes, selectedOption, selectedFields, includedOnly)); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : '적용 범위 확인 실패'); } }}>적용 범위 미리보기</button><button type="button" className="btn ghost" disabled={busy || loading || conflicts.length > 0} onClick={() => { try { setBulk(previewQuotationEditorRestore(view, changes, selectedFields, includedOnly)); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : '복원 범위 확인 실패'); } }}>공통·자동 연동 복원 미리보기</button></div><p>연동 복원은 현재 옵션을 포함한 대상 옵션의 선택 항목에서 수동 수정만 해제합니다. 공통 수정값이 있으면 공통값을, 없으면 저장 자료의 자동값을 따릅니다. 선택하지 않은 항목과 공통 수정값은 유지됩니다.</p>{bulk && <>{bulk.mode === 'restore' && <p role="status">수동 수정 해제 예정입니다. 값이 같아도 이후 공통·자동값 변경을 따라가게 됩니다. 직접 비워둔 값도 복원 대상에 포함됩니다.</p>}<strong>{new Set(bulk.rows.map(item => item.optionId)).size}개 옵션 · {bulk.rows.length}개 값 변경 예정</strong><div className="quotation-fields-bulk-table"><table><thead><tr><th>옵션 / 항목</th><th>현재 값</th><th>적용할 값</th></tr></thead><tbody>{bulk.rows.map(item => <tr key={quotationEditorKey(item.optionId, item.fieldKey)}><td>{item.optionLabel}<br />{item.label}</td><td>{item.before || '(공란)'}{item.manualBefore ? '\n직접 수정한 값' : '\n자동값 사용 중'}</td><td>{item.after || '(공란)'}</td></tr>)}</tbody></table></div>{!bulk.rows.length && <p>현재 선택에서 바뀌는 옵션이 없습니다.</p>}<div className="quote-actions"><button type="button" className="btn ghost" onClick={() => setBulk(null)}>취소</button><button type="button" className="btn primary" disabled={!bulk.rows.length || busy || loading} onClick={() => { try { setChanges(applyQuotationEditorBulk(view, changes, bulk)); setBulk(null); setMessage('옵션별 입력에 반영했습니다. 저장 버튼을 눌러 확정하세요.'); } catch (cause) { setError(cause instanceof Error ? cause.message : '미리보기를 다시 확인해주세요.'); } }}>확인한 범위에 적용</button></div></>}</div>}
      {(view.resolved.issues.length > 0 || allIssues.length > 0) && <details className="quotation-fields-notice"><summary>입력·검토 안내 {view.resolved.issues.length + allIssues.length}건</summary><ul>{view.resolved.issues.map((issue, index) => <li key={`global-${index}`}>{issue}</li>)}{allIssues.map(({ field, issue }, index) => <li key={`${field.id}-${index}`}><button type="button" className="quotation-field-text-button" disabled={busy || loading} onClick={() => setActive(field.section)}>{field.label}</button>: {issue}</li>)}</ul></details>}
      <div className="quotation-fields-actions"><small>입력 v{view.revision} · 작성 중에도 저장할 수 있습니다.<br />수동 수정값은 기본값이 바뀌어도 유지됩니다.</small><div><button type="button" className="btn ghost" disabled={busy || loading || !dirty} onClick={() => void refresh(true)}>입력 버리고 저장본 불러오기</button><button type="button" className="btn primary" disabled={busy || loading || !dirty || conflicts.length > 0 || hasInvalidDraft} onClick={() => void save()}>{busy ? '저장 중…' : `견적 입력 저장${dirty ? ` (${changes.length})` : ''}`}</button></div></div>
      {hasInvalidDraft && <p className="quotation-field-issue" role="status">{invalidDraftMessage} 필수 항목의 공란은 작성 중 상태로 저장할 수 있습니다.</p>}
      <QuotationTranslatedAttributes key={`translation:${view.inputFingerprint}:${view.revision}:${selectedOption??'common'}`} productId={productId} view={view} optionId={selectedOption} disabled={dirty || loading || busy || conflicts.length > 0} onApply={items=>items.forEach(item=>edit(item.fieldKey,item.value,item.optionId))} />
      {(active === 'legal' || active === 'image') && <QuotationLabelPanel key={`${view.inputFingerprint}:${view.revision}:${selectedOption??'common'}`} view={view} productId={productId} endpoint={endpoint} optionId={selectedOption} disabled={dirty || loading || busy || conflicts.length > 0} onBusyChange={setBusy} onAttached={saved=>{setView(saved);setMessage('표시사항 PNG를 처리한 옵션의 라벨 이미지에 추가했습니다. 기존 첨부는 유지했습니다.');onSaved?.();}} />}
    </>}
  </section>;
}
