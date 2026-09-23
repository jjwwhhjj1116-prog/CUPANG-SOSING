'use client';
import { useEffect, useRef, useState } from 'react';
import { CATEGORY_PROFILE_BODY_LIMIT, CATEGORY_TEMPLATE_FILE_LIMIT, categoryFields, categoryFieldScope, categoryProfileIssues, parseTemplateText, validateCategoryProfile, type CategoryField, type CategoryProfile, type CategoryProfileInput, type ColumnMapping } from '@/app/category-profiles';
import { inspectXlsx, xlsxHeaders, type XlsxInspection } from '@/app/xlsx-template';
import { suggestQuotationMappings } from '@/app/quotation-mapping';

type Props = { value?: CategoryProfile | null; initialDraft?: CategoryProfileInput; onSave: (profile: CategoryProfile) => void; onClose: () => void };
const empty: CategoryProfileInput = { name: '', categoryId: '', categoryPath: [], template: null, mappings: [] };

export function CategoryProfileEditor({ value, initialDraft, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<CategoryProfileInput>(value ?? initialDraft ?? empty);
  const [path, setPath] = useState((value??initialDraft)?.categoryPath.join(' > ') ?? '');
  const [headerRow, setHeaderRow] = useState((value ?? initialDraft)?.template?.headerRow ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [workbook, setWorkbook] = useState<XlsxInspection | null>(null);
  const [textTemplate, setTextTemplate] = useState<{ text: string; format: 'csv' | 'tsv' } | null>(null);
  const templateGeneration = useRef(0);
  useEffect(() => {
    const template = (value ?? initialDraft)?.template;
    if (!template?.storageKey) return;
    const generation = ++templateGeneration.current;
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/category-profiles/template?key=${encodeURIComponent(template.storageKey!)}`);
        if (!response.ok) throw new Error('저장된 견적서 원본을 읽지 못했습니다.');
        const bytes = await response.arrayBuffer();
        if (!active || generation !== templateGeneration.current) return;
        if (template.format === 'xlsx') {
          const inspection = await inspectXlsx(bytes);
          if (active && generation === templateGeneration.current) { setWorkbook(inspection); setTextTemplate(null); }
        } else {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          if (active && generation === templateGeneration.current) { setTextTemplate({ text, format: template.format }); setWorkbook(null); }
        }
      } catch (error) { if (active && generation === templateGeneration.current) setError(error instanceof Error ? error.message : '저장된 원본을 확인해주세요.'); }
    })();
    return () => { active = false; };
  }, [value, initialDraft]);

  const importTemplate = async (file: File) => {
    setBusy(true); setError(''); setMessage('');
    const generation = templateGeneration.current;
    try {
      if (file.size > CATEGORY_TEMPLATE_FILE_LIMIT) throw new Error('견적서 파일은 5MB 이하로 선택해주세요.');
      const extension = file.name.split('.').at(-1)?.toLowerCase();
      if (extension !== 'csv' && extension !== 'tsv' && extension !== 'xlsx') throw new Error('XLSX·UTF-8 CSV·TSV 파일을 선택해주세요.');
      const bytes = await file.arrayBuffer();
      let headers: string[]; let inspection: XlsxInspection | null = null; let textSource: { text: string; format: 'csv' | 'tsv' } | null = null; let sheetName = ''; let selectedRow = headerRow;
      if (extension === 'xlsx') {
        inspection = await inspectXlsx(bytes); sheetName = inspection.sheets[0].name;
        selectedRow = inspection.sheets[0].rows.find(row => row.rowNumber === headerRow)?.rowNumber ?? inspection.sheets[0].rows[0]?.rowNumber ?? headerRow;
        headers = xlsxHeaders(inspection, sheetName, selectedRow);
      } else {
        let text: string;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { throw new Error('UTF-8 형식으로 저장한 CSV·TSV 파일을 선택해주세요.'); }
        headers = parseTemplateText(text, extension === 'tsv' ? '\t' : ',', headerRow);
        textSource = { text, format: extension };
      }
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
      const form = new FormData(); form.set('file', file);
      const response = await fetch('/api/category-profiles/template', { method: 'POST', body: form });
      const result = await response.json() as { template?: { storageKey: string; sha256: string }; error?: string };
      if (!response.ok || !result.template?.storageKey || result.template.sha256 !== hash) throw new Error(result.error ?? '견적서 원본 저장 결과를 확인하지 못했습니다.');
      if (generation !== templateGeneration.current) return;
      templateGeneration.current++;
      const template = { name: file.name, format: extension, sha256: hash, sheetName, headerRow: selectedRow, headers, storageKey: result.template.storageKey } as const;
      // Discard old column positions, then suggest exact labels in this category.
      const suggested = suggestQuotationMappings(headers, draft.categoryId);
      setDraft(current => ({ ...current, template, mappings: suggested.mappings }));
      setWorkbook(inspection); setTextTemplate(textSource); setHeaderRow(selectedRow);
      setMessage(`${headers.length}개 열 중 ${suggested.mappings.length}개를 이름으로 자동 연결했습니다. 미연결 ${suggested.unmatchedColumns.length}개 · 중복/모호 ${suggested.ambiguousColumns.length}개. 시트·머리글 행과 연결 결과를 확인한 뒤 설정을 저장해주세요. ${inspection?.warnings.join(' ') ?? ''}`);
    } catch (error) { setError(error instanceof Error ? error.message : '양식을 읽지 못했습니다.'); }
    finally { setBusy(false); }
  };
  const selectHeaders = (sheetName: string, rowNumber: number) => {
    if (!draft.template) { setHeaderRow(rowNumber); return; }
    try {
      if (draft.template.sheetName === sheetName && draft.template.headerRow === rowNumber) return;
      const headers = workbook ? xlsxHeaders(workbook, sheetName, rowNumber)
        : textTemplate ? parseTemplateText(textTemplate.text, textTemplate.format === 'tsv' ? '\t' : ',', rowNumber)
          : (() => { throw new Error('저장된 원본을 불러온 뒤 머리글 행을 변경해주세요.'); })();
      const suggested = suggestQuotationMappings(headers, draft.categoryId);
      setDraft(current => ({ ...current, template: current.template ? { ...current.template, sheetName, headerRow: rowNumber, headers } : null, mappings: suggested.mappings }));
      setHeaderRow(rowNumber); setError('');
      setMessage(`${suggested.mappings.length}개 열 자동 연결 · 미연결 ${suggested.unmatchedColumns.length}개 · 중복/모호 ${suggested.ambiguousColumns.length}개. 바뀐 시트와 행의 연결을 확인해주세요.`);
    } catch (error) { setError(error instanceof Error ? error.message : '머리글을 확인해주세요.'); }
  };
  const setMapping = (column: number, change: Partial<ColumnMapping> | null) => {
    setDraft(current => {
      const existing = current.mappings.find(mapping => mapping.column === column);
      const mappings = current.mappings.filter(mapping => mapping.column !== column);
      if (change) mappings.push({ column, field: 'title', required: false, ...existing, ...change });
      return { ...current, mappings: mappings.sort((a, b) => a.column - b.column) };
    });
    setError('');
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      const profile = validateCategoryProfile({ ...draft, categoryPath: path.split(/\s*>\s*/).filter(Boolean) });
      const body = JSON.stringify(value ? { id: value.id, expectedRevision: value.revision, profile } : profile);
      if (new TextEncoder().encode(body).byteLength > CATEGORY_PROFILE_BODY_LIMIT) throw new Error('카테고리 설정 전체는 UTF-8 JSON 기준 300,000바이트 이하로 저장할 수 있습니다. 열 이름이나 고정값을 줄여주세요.');
      const response = await fetch('/api/category-profiles', { method: value ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body });
      const result = await response.json() as { profile?: CategoryProfile; error?: string };
      if (!response.ok || !result.profile) throw new Error(result.error ?? '저장 결과를 확인하지 못했습니다.');
      onSave(result.profile);
    } catch (error) { setError(error instanceof Error ? error.message : '카테고리 설정을 저장하지 못했습니다.'); }
    finally { setBusy(false); }
  };
  const issues = categoryProfileIssues(draft);
  return <form className="settings-form" onSubmit={save}>
    <section>
      <h3>카테고리별 견적서 설정</h3>
      <p>URL을 추가하기 전에 상품의 카테고리와 견적서 열 연결을 선택합니다. 저장한 설정은 다음 상품에도 재사용됩니다.</p>
      <div className="form-grid">
        <label className="field"><span>설정 이름</span><input required maxLength={120} value={draft.name} disabled={busy} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder="카테고리와 양식을 구분할 이름" /></label>
        <label className="field"><span>Supplier Hub 카테고리 번호</span><input maxLength={120} value={draft.categoryId} disabled={busy} onChange={event => setDraft(current => ({ ...current, categoryId: event.target.value }))} placeholder="실제 확인한 번호 · 미확인 시 비워두기" /></label>
        <label className="field full"><span>카테고리 경로</span><input required maxLength={1210} value={path} disabled={busy} onChange={event => setPath(event.target.value)} placeholder="상위 카테고리 > 하위 카테고리" /></label>
      </div>
      <p>선택한 카테고리의 원본 양식을 연결합니다. 분류 코드 확인과 실제 견적서 제출 검증은 별도로 기록합니다.</p>
    </section>
    <section>
      <h3>견적서 열 연결</h3>
      <div className="form-grid">
        <label className="field"><span>파일의 머리글 행</span><input type="number" min={1} max={1000} value={headerRow} disabled={busy} onChange={event => selectHeaders(draft.template?.sheetName ?? '', Number(event.target.value))} /></label>
        <label className="field"><span>Excel·CSV·TSV 견적서 원본</span><input type="file" accept=".xlsx,.csv,.tsv" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void importTemplate(file); event.target.value = ''; }} /></label>
        {workbook && draft.template && <label className="field"><span>Excel 시트</span><select value={draft.template.sheetName} disabled={busy} onChange={event => { const sheet = workbook.sheets.find(sheet => sheet.name === event.target.value); selectHeaders(event.target.value, sheet?.rows.find(row => row.rowNumber === headerRow)?.rowNumber ?? sheet?.rows[0]?.rowNumber ?? 1); }}>{workbook.sheets.map(sheet => <option value={sheet.name} key={sheet.name}>{sheet.name}</option>)}</select></label>}
      </div>
      <p>원본 파일을 그대로 보존하고 실제 열 이름·시트·지문을 연결합니다. 수식은 실행하지 않습니다. 열 연결 후에도 카테고리별 필수 정보와 Supplier Hub 제출 검증이 필요합니다.</p>
      <p>견적서 파일은 5MB 이하 한 개, 카테고리 설정 전체는 UTF-8 JSON 기준 300KB 이하입니다. 한글 등 다중 바이트 문자는 바이트 수로 계산됩니다.</p>
      {draft.template && <>
        <p><strong>{draft.template.name}</strong> · {draft.template.sheetName && `${draft.template.sheetName} · `}{draft.template.headers.length}열 · 머리글 {draft.template.headerRow}행 {draft.template.storageKey && <a href={`/api/category-profiles/template?key=${encodeURIComponent(draft.template.storageKey)}`}>원본 다운로드</a>}</p>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => {
          const suggested = suggestQuotationMappings(draft.template!.headers, draft.categoryId);
          const occupied = new Set(draft.mappings.map(mapping => mapping.column));
          const additions = suggested.mappings.filter(mapping => !occupied.has(mapping.column));
          setDraft(current => ({ ...current, mappings: [...current.mappings, ...additions].sort((a, b) => a.column - b.column) }));
          setMessage(`기존 연결을 유지하고 ${additions.length}개 열을 자동 연결했습니다. 저장 전에 결과를 확인해주세요.`);
        }}>미연결 열 자동 연결</button>
        <div style={{ overflowX: 'auto', maxHeight: 340, overflowY: 'auto' }}>
          <table style={{ width: '100%', textAlign: 'left' }}><thead><tr><th>견적서 열</th><th>상품 자료</th><th>필수</th><th>고정값</th></tr></thead><tbody>
            {draft.template.headers.map((header, column) => {
              const mapping = draft.mappings.find(value => value.column === column);
              return <tr key={column}><td>{column + 1}. {header || '(이름 없는 열)'}</td><td><select aria-label={`${column + 1}열 연결`} value={mapping?.field ?? ''} disabled={busy} onChange={event => setMapping(column, event.target.value ? { field: event.target.value as CategoryField } : null)}><option value="">연결 안 함</option>{Object.entries(categoryFields).filter(([field]) => categoryFieldScope(field) === null || categoryFieldScope(field) === draft.categoryId || mapping?.field === field).map(([field, label]) => <option key={field} value={field}>{label}</option>)}</select></td><td><input aria-label={`${column + 1}열 필수`} type="checkbox" checked={mapping?.required ?? false} disabled={busy || !mapping} onChange={event => setMapping(column, { required: event.target.checked })} /></td><td>{mapping?.field === 'constant' && <input aria-label={`${column + 1}열 고정값`} maxLength={4000} disabled={busy} value={mapping.constant ?? ''} onChange={event => setMapping(column, { constant: event.target.value })} />}</td></tr>;
            })}
          </tbody></table>
        </div>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => { templateGeneration.current++; setDraft(current => ({ ...current, template: null, mappings: [] })); setWorkbook(null); setTextTemplate(null); setMessage(''); }}>양식 연결 해제</button>
      </>}
    </section>
    <section><h3>초안 상태</h3><p>실제 Supplier Hub 업로드 검증 전까지는 제출 검증 완료로 표시하지 않습니다.</p>{issues.length > 0 && <ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}</section>
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="collection-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="btn ghost" onClick={onClose} disabled={busy}>취소</button><button type="submit" className="btn primary" disabled={busy}>{busy ? '처리 중…' : value ? '변경 저장' : '설정 저장'}</button></div>
  </form>;
}
