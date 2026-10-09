'use client';
import { getQuotationSchema } from '@/app/quotation-schema';
import { useEffect, useRef, useState } from 'react';
import { CATEGORY_PROFILE_BODY_LIMIT, CATEGORY_TEMPLATE_FILE_LIMIT, categoryFields, categoryFieldScope, categoryProfileIssues, quotationStartRow, parseTemplateText, validateCategoryCodeForSave, validateCategoryProfile, validateQuotationChoiceFormats, type CategoryField, type CategoryProfile, type CategoryProfileInput, type ColumnMapping } from '@/app/category-profiles';
import { inspectXlsxArchive, readXlsxArchive, supplierHubEntryLayout, supplierHubRequirementRow, supplierHubSheetSignature, xlsxHeaders, type XlsxInspection } from '@/app/xlsx-template';
import { suggestQuotationChoiceFormats } from '@/app/quotation-choice-format';
import { refreshCategoryMappings, relocateQuotationMappings, suggestQuotationMappings, suggestQuotationHeader } from '@/app/quotation-mapping';
import { supplierTemplateObservation } from '@/app/supplier-template-observation';
import { assertOfficialWorkbookCategory } from '@/app/official-workbook-category';
import { prepareOfficialHubProfileTemplate } from '@/app/supplier-hub-catalog';

type Props = { value?: CategoryProfile | null; initialDraft?: CategoryProfileInput; onSave: (profile: CategoryProfile) => void; onClose: () => void };
const empty: CategoryProfileInput = { name: '', categoryId: '', categoryPath: [], template: null, mappings: [] };

export function CategoryProfileEditor({ value, initialDraft, onSave, onClose }: Props) {
  const [draft, setDraftValue] = useState<CategoryProfileInput>(value ?? initialDraft ?? empty);
  const [path, setPathValue] = useState((value??initialDraft)?.categoryPath.join(' > ') ?? '');
  const [headerRow, setHeaderRowValue] = useState((value ?? initialDraft)?.template?.headerRow ?? 1);
  const [inputGeneration, setInputGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [workbook, setWorkbook] = useState<XlsxInspection | null>(null);
  const [textTemplate, setTextTemplate] = useState<{ text: string; format: 'csv' | 'tsv' } | null>(null);
  const templateGeneration = useRef(0);
  const automaticMappings = useRef<ColumnMapping[]>([]);
  const workbookFiles = useRef<Map<string, Uint8Array> | null>(null);
  const protectedColumns = useRef(new Set<number>());
  const saving = useRef(false);
  const inputGenerationRef = useRef(0);
  const activeSave = useRef<AbortController | null>(null);
  useEffect(() => () => { activeSave.current?.abort(); }, []);
  const createRequest = useRef<{ body: string; id: string } | null>(null);
  const edited = () => { inputGenerationRef.current++; setInputGeneration(inputGenerationRef.current); };
  const setDraft: typeof setDraftValue = update => { edited(); setDraftValue(update); };
  const setPath = (next: string) => { edited(); setPathValue(next); };
  const setHeaderRow = (next: number) => { edited(); setHeaderRowValue(next); };
  const cleanSavedProfile = Boolean(value && draft.name === value.name && draft.categoryId === value.categoryId
    && path === value.categoryPath.join(' > ') && headerRow === (value.template?.headerRow ?? 1)
    && JSON.stringify(draft.categoryPath) === JSON.stringify(value.categoryPath) && JSON.stringify(draft.hubSchema) === JSON.stringify(value.hubSchema)
    && JSON.stringify(draft.template) === JSON.stringify(value.template) && JSON.stringify(draft.mappings) === JSON.stringify(value.mappings));
  const schemaFields=getQuotationSchema(draft.categoryId,draft.categoryPath,draft.hubSchema).fields;
  const changeCategory = (categoryId: string) => {
    const requirementRow = workbook && draft.template ? supplierHubRequirementRow(workbook, draft.template.sheetName, draft.template.headerRow) : null;
    const next = refreshCategoryMappings(draft.template?.headers ?? [], categoryId, draft.mappings, automaticMappings.current, protectedColumns.current, requirementRow,categoryId===draft.categoryId?draft.hubSchema:undefined);
    automaticMappings.current = next.automatic;
    setDraft({ ...draft, categoryId, mappings: next.mappings, hubSchema:categoryId===draft.categoryId?draft.hubSchema:undefined });
    if (draft.template) setMessage('카테고리에 맞춰 자동 연결을 갱신했습니다. 저장된 연결·직접 수정한 연결·고정값은 보존합니다. 원본 양식이 새 카테고리에 맞는지 확인해주세요.');
  };
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
          const files = await readXlsxArchive(bytes); const inspection = inspectXlsxArchive(files);
          if (active && generation === templateGeneration.current) { workbookFiles.current = files; setWorkbook(inspection); setTextTemplate(null); }
        } else {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          if (active && generation === templateGeneration.current) { workbookFiles.current = null; setTextTemplate({ text, format: template.format }); setWorkbook(null); }
        }
      } catch (error) { if (active && generation === templateGeneration.current) setError(error instanceof Error ? error.message : '저장된 원본을 확인해주세요.'); }
    })();
    return () => { active = false; };
  }, [value, initialDraft]);

  const importTemplate = async (file: File) => {
    if (busy || saving.current) return;
    saving.current = true;
    setBusy(true); setError(''); setMessage('');
    const generation = templateGeneration.current;
    try {
      if (file.size > CATEGORY_TEMPLATE_FILE_LIMIT) throw new Error('견적서 파일은 5MB 이하로 선택해주세요.');
      const extension = file.name.split('.').at(-1)?.toLowerCase();
      if (extension !== 'csv' && extension !== 'tsv' && extension !== 'xlsx') throw new Error('XLSX·UTF-8 CSV·TSV 파일을 선택해주세요.');
      const bytes = await file.arrayBuffer();
      let headers: string[]; let inspection: XlsxInspection | null = null; let textSource: { text: string; format: 'csv' | 'tsv' } | null = null; let sheetName = ''; let selectedRow = headerRow; let headerNotice = ''; let dataStartRow: number;
      let files: Map<string, Uint8Array> | null = null;
      if (extension === 'xlsx') {
        files = await readXlsxArchive(bytes); inspection = inspectXlsxArchive(files);
        const candidate = suggestQuotationHeader(inspection, draft.categoryId,draft.hubSchema);
        const officialSheets = inspection.sheets.filter(sheet => supplierHubSheetSignature(inspection!, sheet.name));
        if (officialSheets.length && (!candidate || !officialSheets.some(sheet => sheet.name === candidate.sheetName))) throw new Error('공식 견적서의 상품 작성 시트와 머리글을 확정하지 못했습니다. 파일의 카테고리와 버전을 확인해주세요.');
        headerNotice = candidate ? '열 이름을 기준으로 작성 시트·머리글 행을 추천했습니다. 공식 분류 일치 여부는 별도 확인이 필요합니다. ' : '작성 시트를 확정할 근거가 부족하거나 후보가 여러 개입니다. 시트·머리글 행을 직접 선택해주세요. ';
        sheetName = candidate?.sheetName ?? inspection.sheets[0].name;
        selectedRow = candidate?.rowNumber ?? inspection.sheets[0].rows.find(row => row.rowNumber === headerRow)?.rowNumber ?? inspection.sheets[0].rows[0]?.rowNumber ?? headerRow;
        headers = xlsxHeaders(inspection, sheetName, selectedRow);
        const layout = supplierHubEntryLayout(inspection, sheetName, selectedRow);
        if (supplierHubSheetSignature(inspection, sheetName) && !layout) throw new Error('공식 견적서의 머리글·필수·안내·예시 행 구성을 확인하지 못했습니다. 해당 양식을 검증한 뒤 연결해주세요.');
        assertOfficialWorkbookCategory(files, inspection, sheetName, selectedRow, draft.categoryId, path.split(/\s*>\s*/).filter(Boolean), draft.hubSchema);
        dataStartRow = layout?.dataStartRow ?? selectedRow + 1;
        if (layout) headerNotice += `공식 양식의 안내·예시 행을 확인해 상품 입력 ${dataStartRow}행을 추천했습니다. `;
      } else {
        let text: string;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { throw new Error('UTF-8 형식으로 저장한 CSV·TSV 파일을 선택해주세요.'); }
        headers = parseTemplateText(text, extension === 'tsv' ? '\t' : ',', headerRow);
        textSource = { text, format: extension };
        dataStartRow = selectedRow + 1;
      }
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
      const form = new FormData(); form.set('file', file);
      const response = await fetch('/api/category-profiles/template', { method: 'POST', body: form });
      const result = await response.json() as { template?: { storageKey: string; sha256: string }; error?: string };
      if (!response.ok || !result.template?.storageKey || result.template.sha256 !== hash) throw new Error(result.error ?? '견적서 원본 저장 결과를 확인하지 못했습니다.');
      if (generation !== templateGeneration.current) return;
      templateGeneration.current++;
      const template = { name: file.name, format: extension, sha256: hash, sheetName, headerRow: selectedRow, dataStartRow, headers, storageKey: result.template.storageKey } as const;
      // Discard old column positions, then suggest exact labels in this category.
      const requirementRow = inspection ? supplierHubRequirementRow(inspection, sheetName, selectedRow) : null;
      const suggested = suggestQuotationMappings(headers, draft.categoryId, requirementRow,draft.hubSchema);
      automaticMappings.current = suggested.mappings; protectedColumns.current.clear();
      workbookFiles.current = files;
      setDraft(current => ({ ...current, template, mappings: suggested.mappings }));
      setWorkbook(inspection); setTextTemplate(textSource); setHeaderRow(selectedRow);
      setMessage(`${headerNotice}${headers.length}개 열 중 ${suggested.mappings.length}개를 이름으로 자동 연결했습니다. 미연결 ${suggested.unmatchedColumns.length}개 · 중복/모호 ${suggested.ambiguousColumns.length}개. 시트·머리글 행과 연결 결과를 확인한 뒤 설정을 저장해주세요. ${inspection?.warnings.join(' ') ?? ''}`);
    } catch (error) { setError(error instanceof Error ? error.message : '양식을 읽지 못했습니다.'); }
    finally { saving.current = false; setBusy(false); }
  };
  const selectHeaders = (sheetName: string, rowNumber: number) => {
    if (!draft.template) { setHeaderRow(rowNumber); return; }
    try {
      if (draft.template.sheetName === sheetName && draft.template.headerRow === rowNumber) return;
      const headers = workbook ? xlsxHeaders(workbook, sheetName, rowNumber)
        : textTemplate ? parseTemplateText(textTemplate.text, textTemplate.format === 'tsv' ? '\t' : ',', rowNumber)
          : (() => { throw new Error('저장된 원본을 불러온 뒤 머리글 행을 변경해주세요.'); })();
      const requirementRow = workbook ? supplierHubRequirementRow(workbook, sheetName, rowNumber) : null;
      const relocated = relocateQuotationMappings(draft.template.headers, headers, draft.categoryId, draft.mappings, automaticMappings.current, protectedColumns.current, requirementRow,draft.hubSchema);
      const layout = workbook ? supplierHubEntryLayout(workbook, sheetName, rowNumber) : null;
      if (workbook && supplierHubSheetSignature(workbook, sheetName) && !layout) throw new Error('공식 견적서의 입력 행 구성을 확인하지 못했습니다. 머리글과 원본 양식을 확인해주세요.');
      if (workbook) assertOfficialWorkbookCategory(workbookFiles.current, workbook, sheetName, rowNumber, draft.categoryId, path.split(/\s*>\s*/).filter(Boolean), draft.hubSchema);
      const dataStartRow = layout?.dataStartRow ?? rowNumber + 1;
      automaticMappings.current = relocated.automatic; protectedColumns.current = relocated.protectedColumns;
      setDraft(current => ({ ...current, template: current.template ? { ...current.template, sheetName, headerRow: rowNumber, dataStartRow, headers } : null, mappings: relocated.mappings }));
      setHeaderRow(rowNumber); setError('');
      setMessage(`동일한 열 이름의 연결 ${relocated.retainedCount}개 보존 · 새 자동 연결 ${relocated.addedCount}개. 직접 해제한 동일 항목도 유지합니다. ${relocated.lostColumns.length ? `이전 설정 중 이름이 없거나 중복·누락되어 옮기지 못한 열: ${relocated.lostColumns.map(column => `${column + 1}. ${draft.template!.headers[column] || '(이름 없는 열)'}`).join(', ')}. ` : ''}입력 시작 행을 ${dataStartRow}행으로 설정했습니다. 바뀐 시트와 실제 입력 시작 행을 확인해주세요.`);
    } catch (error) { setError(error instanceof Error ? error.message : '머리글을 확인해주세요.'); }
  };
  const setMapping = (column: number, change: Partial<ColumnMapping> | null) => {
    protectedColumns.current.add(column);
    automaticMappings.current = automaticMappings.current.filter(mapping => mapping.column !== column);
    setDraft(current => {
      const existing = current.mappings.find(mapping => mapping.column === column);
      const mappings = current.mappings.filter(mapping => mapping.column !== column);
      if (change) mappings.push({ column, field: 'title', required: false, ...existing, ...change, ...(change.field && change.field !== existing?.field ? { choiceFormat: undefined } : {}) });
      return { ...current, mappings: mappings.sort((a, b) => a.column - b.column) };
    });
    setError('');
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy || saving.current) return;
    saving.current = true;
    const controller = new AbortController(); activeSave.current = controller;
    setBusy(true); setError('');
    try {
      const profile = validateCategoryProfile({ ...draft, categoryPath: path.split(/\s*>\s*/).filter(Boolean) });
      validateCategoryCodeForSave(profile.categoryId);
      const layout = workbook && profile.template?.format === 'xlsx' ? supplierHubEntryLayout(workbook, profile.template.sheetName, profile.template.headerRow) : null;
      if (workbook && profile.template?.format === 'xlsx' && supplierHubSheetSignature(workbook, profile.template.sheetName) && !layout) throw new Error('공식 견적서의 입력 행 구성을 확인하지 못했습니다. 저장 전에 원본을 확인해주세요.');
      if (workbook && profile.template?.format === 'xlsx') assertOfficialWorkbookCategory(workbookFiles.current, workbook, profile.template.sheetName, profile.template.headerRow, profile.categoryId, profile.categoryPath, profile.hubSchema);
      validateQuotationChoiceFormats(profile, getQuotationSchema(profile.categoryId,profile.categoryPath,profile.hubSchema).fields);
      const body = JSON.stringify(value ? { id: value.id, expectedRevision: value.revision, profile } : profile);
      if (new TextEncoder().encode(body).byteLength > CATEGORY_PROFILE_BODY_LIMIT) throw new Error('카테고리 설정 전체는 UTF-8 JSON 기준 300,000바이트 이하로 저장할 수 있습니다. 열 이름이나 고정값을 줄여주세요.');
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (!value) {
        if (createRequest.current?.body !== body) createRequest.current = { body, id: crypto.randomUUID() };
        headers['Idempotency-Key'] = createRequest.current.id;
      }
      const response = await fetch('/api/category-profiles', { method: value ? 'PUT' : 'POST', headers, body, signal: controller.signal });
      const result = await response.json() as { profile?: CategoryProfile; error?: string };
      // A closed editor must not navigate away from a newly opened draft, even
      // if the earlier request has already reached the server.
      if (controller.signal.aborted) return;
      if (!response.ok || !result.profile) throw new Error(result.error ?? '저장 결과를 확인하지 못했습니다.');
      onSave(result.profile);
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '카테고리 설정을 저장하지 못했습니다.'); }
    finally { if (activeSave.current === controller) activeSave.current = null; saving.current = false; if (!controller.signal.aborted) setBusy(false); }
  };
  const prepareOfficial = async (mode: 'schema' | 'workbook' = 'schema') => {
    if (busy || saving.current || inputGenerationRef.current !== inputGeneration || !cleanSavedProfile || !value || !value.hubSchema || value.template || draft.template) return;
    saving.current = true;
    const controller = new AbortController(); activeSave.current = controller;
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await prepareOfficialHubProfileTemplate(value, controller.signal, mode);
      if (!controller.signal.aborted) onSave(saved);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '공식 양식 연결을 확인하지 못했습니다. 입력은 유지됩니다.'); }
    finally { if (activeSave.current === controller) activeSave.current = null; saving.current = false; if (!controller.signal.aborted) setBusy(false); }
  };
  const issues = categoryProfileIssues(draft);
  const templateObservation = supplierTemplateObservation(draft.categoryId);
  const confirmedLayout = workbook && draft.template?.format === 'xlsx' ? supplierHubEntryLayout(workbook, draft.template.sheetName, draft.template.headerRow) : null;
  return <form className="settings-form" onSubmit={save}>
    <section>
      <h3>카테고리별 견적서 설정</h3>
      <p>URL을 추가하기 전에 상품의 카테고리와 견적서 열 연결을 선택합니다. 저장한 설정은 다음 상품에도 재사용됩니다.</p>
      <div className="form-grid">
        <label className="field"><span>설정 이름</span><input required maxLength={120} value={draft.name} disabled={busy} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder="카테고리와 양식을 구분할 이름" /></label>
        <label className="field"><span>상품 등록 카테고리 번호</span><input maxLength={120} value={draft.categoryId} disabled={busy} onChange={event => changeCategory(event.target.value)} placeholder="실제 확인한 번호 · 미확인 시 비워두기" /></label>
        <label className="field full"><span>카테고리 경로</span><input required maxLength={1210} value={path} disabled={busy} onChange={event => setPath(event.target.value)} placeholder="상위 카테고리 > 하위 카테고리" /></label>
      </div>
      <p>선택한 카테고리의 원본 양식을 연결합니다. 분류 코드 확인과 실제 견적서 제출 검증은 별도로 기록합니다.</p>
      {!draft.template && <div className="panel-note"><p>저장한 회사·전체 카테고리 경로·상세 양식을 다시 확인하고 공식 Excel 원본을 연결합니다.</p>
        <button type="button" className="btn primary" disabled={busy || !cleanSavedProfile || !value?.hubSchema || !!value.template} onClick={() => prepareOfficial()}>공식 견적 양식 준비</button>
        {(draft.hubSchema?.metadata.scopeType ?? draft.hubSchema?.metadata.scope) === 'Retail_Categorized_Single' && <button type="button" className="btn ghost" disabled={busy || !cleanSavedProfile || !value?.hubSchema || !!value.template} onClick={() => prepareOfficial('workbook')}>공식 파일 기준으로 연결</button>}
        {(!value || !cleanSavedProfile) && <small>입력한 설정을 저장한 뒤 공식 양식을 준비해주세요.</small>}
        {!draft.hubSchema && <small>Supplier Hub에서 확인한 상세 양식이 필요합니다.</small>}
      </div>}
      <details><summary>공식 견적서 가져오는 순서 · 분류 확인</summary>
        <p><a href="https://supplier.coupang.com/qvt/registration" target="_blank" rel="noopener noreferrer">Supplier Hub 견적서 다운로드 열기</a> → 최신 견적서 파일 다운로드 → 카테고리 탐색 → 선택한 카테고리의 견적서 다운로드 순서로 진행합니다.</p>
        {templateObservation ? <>
          <p>상품 등록 분류: {templateObservation.registrationPath.join(' → ')}</p>
          <p>공식 다운로드 화면에서 확인한 경로: <strong>{templateObservation.downloadPath.join(' → ')}</strong></p>
          <small>{templateObservation.observedAt} 확인. {templateObservation.excelVerified ? `공식 Excel에서 등록 카테고리 ${draft.categoryId}와 칸 카테고리 ${templateObservation.downloadCategoryId}의 대응을 확인했습니다. 실제 제출 검증은 별도입니다.` : '말단 이름은 같지만 상위 경로가 다릅니다. 다운로드 화면의 칸 카테고리 ID와 상품 등록 번호의 동일성은 미확인입니다.'}</small>
        </> : <p>이 카테고리의 공식 다운로드 경로는 아직 대조하지 않았습니다. 등록 화면의 번호나 이름만으로 양식을 확정하지 마세요.</p>}
        <p>내려받은 파일을 아래 원본 입력에 연결하고 시트·머리글·열 연결을 확인하세요. {draft.template ? '현재 원본 양식은 연결되어 있습니다.' : '현재 원본 양식이 연결되지 않았습니다.'} 파일 연결이나 열 자동 추천은 공식 카테고리 일치·제출 성공 검증을 뜻하지 않습니다.</p>
      </details>
    </section>
    <section>
      <h3>견적서 열 연결</h3>
      <div className="form-grid">
        <label className="field"><span>파일의 머리글 행</span><input type="number" min={1} max={1000} value={headerRow} disabled={busy} onChange={event => selectHeaders(draft.template?.sheetName ?? '', Number(event.target.value))} /></label>
        {draft.template && <label className="field"><span>상품 입력 시작 행 · 같은 카테고리에 재사용</span><input aria-label="저장할 상품 입력 시작 행" type="number" min={draft.template.headerRow + 1} max={10000} value={quotationStartRow(draft.template)} disabled={busy} onChange={event => { const row = Number(event.target.value); setDraft(current => ({ ...current, template: current.template ? { ...current.template, dataStartRow: row } : null })); }} /><small>안내·예시 행을 제외한 실제 입력 행을 지정하세요. 새 파일·시트·머리글을 선택하면 다시 확인해야 합니다.</small></label>}
        <label className="field"><span>Excel·CSV·TSV 견적서 원본</span><input type="file" accept=".xlsx,.csv,.tsv" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void importTemplate(file); event.target.value = ''; }} /></label>
        {workbook && draft.template && <label className="field"><span>Excel 시트</span><select value={draft.template.sheetName} disabled={busy} onChange={event => { const sheet = workbook.sheets.find(sheet => sheet.name === event.target.value); selectHeaders(event.target.value, sheet?.rows.find(row => row.rowNumber === headerRow)?.rowNumber ?? sheet?.rows[0]?.rowNumber ?? 1); }}>{workbook.sheets.map(sheet => <option value={sheet.name} key={sheet.name}>{sheet.name}</option>)}</select></label>}
      </div>
      <p>원본 파일을 그대로 보존하고 실제 열 이름·시트·지문을 연결합니다. 수식은 실행하지 않습니다. 열 연결 후에도 카테고리별 필수 정보와 Supplier Hub 제출 검증이 필요합니다.</p>
      {confirmedLayout && quotationStartRow(draft.template!) < confirmedLayout.dataStartRow && <p role="alert">이 공식 양식의 {draft.template!.headerRow + 1}~{confirmedLayout.dataStartRow - 1}행은 작성 안내·예시입니다. 상품 입력 시작 행을 {confirmedLayout.dataStartRow}행 이상으로 바꿔주세요. 기존 설정으로 견적서 출력을 시도하면 중단됩니다.</p>}
      <p>견적서 파일은 5MB 이하 한 개, 카테고리 설정 전체는 UTF-8 JSON 기준 300KB 이하입니다. 한글 등 다중 바이트 문자는 바이트 수로 계산됩니다.</p>
      {draft.template && <>
        <p><strong>{draft.template.name}</strong> · {draft.template.sheetName && `${draft.template.sheetName} · `}{draft.template.headers.length}열 · 머리글 {draft.template.headerRow}행 {draft.template.storageKey && <a href={`/api/category-profiles/template?key=${encodeURIComponent(draft.template.storageKey)}`}>원본 다운로드</a>}</p>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => {
          const requirementRow = workbook ? supplierHubRequirementRow(workbook, draft.template!.sheetName, draft.template!.headerRow) : null;
          const suggested = suggestQuotationMappings(draft.template!.headers, draft.categoryId, requirementRow,draft.hubSchema);
          const occupied = new Set(draft.mappings.map(mapping => mapping.column));
          const additions = suggested.mappings.filter(mapping => !occupied.has(mapping.column));
          automaticMappings.current = [...automaticMappings.current, ...additions];
          for (const mapping of additions) protectedColumns.current.delete(mapping.column);
          setDraft(current => ({ ...current, mappings: [...current.mappings, ...additions].sort((a, b) => a.column - b.column) }));
          setMessage(`기존 연결을 유지하고 ${additions.length}개 열을 자동 연결했습니다. 저장 전에 결과를 확인해주세요.`);
        }}>미연결 열 자동 연결</button>
        {workbook && <button type="button" className="btn ghost" disabled={busy} onClick={() => {
          try {
            if (!workbookFiles.current) throw new Error('견적서 원본을 먼저 불러와주세요.');
            const changes = suggestQuotationChoiceFormats(workbookFiles.current, workbook, draft.template!.sheetName, quotationStartRow(draft.template!), draft.categoryId, draft.mappings,draft.hubSchema);
            for (const change of changes) protectedColumns.current.add(change.column);
            automaticMappings.current = automaticMappings.current.filter(mapping => !changes.some(change => change.column === mapping.column));
            setDraft(current => ({ ...current, mappings: current.mappings.map(mapping => ({ ...mapping, ...changes.find(change => change.column === mapping.column) })) }));
            setError(''); setMessage(`${changes.length}개 열의 출력 형식을 원본 드롭다운에 맞췄습니다. 전체 선택지가 한 가지 형식으로 일치하는 열만 적용했습니다. 입력 시작 행과 최종 미리보기를 확인해주세요.`);
          } catch (error) { setError(error instanceof Error ? error.message : '원본 선택 목록을 확인해주세요.'); }
        }}>원본 드롭다운에 맞춰 출력 형식 적용</button>}
        <p>선택형 열은 원본 양식에 맞춰 저장 코드 또는 표시 문구로 출력할 수 있습니다. 공란은 그대로 유지하며, 공식 양식과의 일치는 미리보기에서 확인해주세요.</p>
        <div style={{ overflowX: 'auto', maxHeight: 340, overflowY: 'auto' }}>
          <table style={{ width: '100%', textAlign: 'left' }}><thead><tr><th>견적서 열</th><th>상품 자료</th><th>필수</th><th>출력 형식 / 고정값</th></tr></thead><tbody>
            {draft.template.headers.map((header, column) => {
              const mapping = draft.mappings.find(value => value.column === column);
              return <tr key={column}><td>{column + 1}. {header || '(이름 없는 열)'}</td><td><select aria-label={`${column + 1}열 연결`} value={mapping?.field ?? ''} disabled={busy} onChange={event => setMapping(column, event.target.value ? { field: event.target.value as CategoryField } : null)}><option value="">연결 안 함</option>{Object.entries({...categoryFields,...Object.fromEntries(schemaFields.filter(field=>field.id.startsWith('live_')).map(field=>[field.id,field.label]))}).filter(([field]) => categoryFieldScope(field) === null || categoryFieldScope(field) === draft.categoryId || mapping?.field === field).map(([field, label]) => <option key={field} value={field}>{label}</option>)}</select></td><td><input aria-label={`${column + 1}열 필수`} type="checkbox" checked={mapping?.required ?? false} disabled={busy || !mapping} onChange={event => setMapping(column, { required: event.target.checked })} /></td><td>{mapping && (mapping.choiceFormat==='label'||schemaFields.find(field=>field.id===mapping.field)?.type==='select') && <label>선택값 출력<select aria-label={`${column + 1}열 선택값 출력`} disabled={busy} value={mapping.choiceFormat??'value'} onChange={event=>setMapping(column,{choiceFormat:event.target.value as 'value'|'label'})}><option value="value">저장 코드 그대로</option><option value="label" disabled={schemaFields.find(field=>field.id===mapping.field)?.type!=='select'}>표시 문구 · 공란 유지</option></select>{schemaFields.find(field=>field.id===mapping.field)?.type!=='select'&&<small role="alert">현재 분류의 선택형 항목이 아닙니다. 저장 코드로 바꾸거나 연결을 수정해주세요.</small>}</label>}{mapping?.field === 'constant' && <input aria-label={`${column + 1}열 고정값`} maxLength={4000} disabled={busy} value={mapping.constant ?? ''} onChange={event => setMapping(column, { constant: event.target.value })} />}</td></tr>;
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
