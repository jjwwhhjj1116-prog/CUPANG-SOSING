'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DocumentImagePanel } from '@/app/components/document-image-panel';
import { SizeChartExtractionPanel } from '@/app/components/size-chart-extraction-panel';
import { MANUAL_SIZE_CHART_COLUMNS, MANUAL_SIZE_CHART_ROWS, manualSizeUnits, validateManualSizeChart, type ManualSizeChart } from '@/app/manual-size-chart';
import type { ProductContent } from '@/app/product-content';
import { isOwnedImageKey } from '@/app/image-files';
import {prepareSizeChartSaveAttempt,readSizeChartSaveSnapshot,recoverSizeChartSaveAttempt,sendSizeChartSaveAttempt,type SizeChartSaveAttempt} from '@/app/size-chart-save-client';
import type {SizeChartSaveSnapshot} from '@/app/size-chart-save';

type Props = { productId: string; version: string; profileId?:string|null; active?:boolean; disabled?:boolean; beforeSave?:()=>boolean; onBusyChange?:(busy:boolean)=>void; sourceStep?: '옵션' | '사이즈표'; onSaved?: () => void };
type Draft = { chart: ManualSizeChart; sizesInput: string } | null;
type Saved = { content: ProductContent; version: string; resultKey: string | null; resultIssue: string | null };
type ProductSource = { id: string; owner: string; version: string; keys: string[] };
const seed = (): ManualSizeChart => ({ sizeType: '일반 사이즈', sizeUnits: 'cm', sizes: ['사이즈'], measurements: [{ name: '', values: [''] }] });
const draftOf = (chart: ManualSizeChart): NonNullable<Draft> => ({ chart: structuredClone(chart), sizesInput: chart.sizes.join(', ') });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function readContent(value: unknown, productId: string): ProductContent {
  const content = (value as { content?: ProductContent })?.content;
  if (!content || content.schemaVersion !== 1 || content.productId !== productId || !Number.isSafeInteger(content.revision) || content.revision < 0
    || !Array.isArray(content.assets?.size?.value)) throw Error('저장한 사이즈표 응답을 확인하지 못했습니다.');
  if (content.manualSizeChart !== undefined) validateManualSizeChart(content.manualSizeChart);
  return content;
}
function readProductSource(value: unknown, productId: string): ProductSource {
  const product = (value as { product?: { id?: unknown; owner_id?: unknown; updated_at?: unknown; image_keys?: unknown } })?.product;
  if (!product || product.id !== productId || typeof product.owner_id !== 'string' || !product.owner_id || typeof product.updated_at !== 'string'
    || !Number.isFinite(Date.parse(product.updated_at)) || typeof product.image_keys !== 'string') throw Error('사이즈표를 확인할 상품 저장 상태를 읽지 못했습니다.');
  let keys: unknown; try { keys = JSON.parse(product.image_keys); } catch { throw Error('상품의 저장 이미지 목록을 확인하지 못했습니다.'); }
  if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string') || new Set(keys).size !== keys.length) throw Error('상품의 저장 이미지 목록을 확인하지 못했습니다.');
  return { id: productId, owner: product.owner_id, version: product.updated_at, keys };
}
/** A lost acknowledgement is recovered only from the exact next content state.
 * Other saved content and role assignments cannot be silently acknowledged. */
function acknowledges(content: ProductContent, before: ProductContent, chart: ManualSizeChart | null) {
  if (content.revision !== before.revision + 1 || !same(content.manualSizeChart, chart ?? undefined)) return false;
  const changed = !same(before.manualSizeChart, chart ?? undefined);
  const rest = (value: ProductContent) => {
    const { revision: _revision, updatedAt: _updatedAt, manualSizeChart: _chart, assets, ...other } = value;
    void _revision; void _updatedAt; void _chart;
    const { size: _size, ...roles } = assets; void _size;
    return { ...other, assets: roles };
  };
  return same(rest(content), rest(before)) && (changed ? content.assets.size.value.length === 0 : same(content.assets.size, before.assets.size));
}

export function SizeChartWorkspace(props: Props) { return <Editor key={props.productId} {...props} />; }
function Editor({ productId, version, profileId=null, active=true, disabled=false, beforeSave, onBusyChange, sourceStep = '옵션', onSaved }: Props) {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [draft, setDraft] = useState<Draft | undefined>(undefined);
  const [busy, setBusy] = useState(false), [imageBusy, setImageBusy] = useState(false);
  const [extractionBusy, setExtractionBusy] = useState(false);
  const [extractionOpen, setExtractionOpen] = useState(false);
  const [editingResult, setEditingResult] = useState(false), [readClock, setReadClock] = useState(0), [reading, setReading] = useState(false);
  const [sourceAvailable, setSourceAvailable] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const alive = useRef(true), operation = useRef(false), sequence = useRef(0);
  const currentVersion = useRef(version), pending = useRef<Draft | undefined>(undefined);
  const latestSaved = useRef<Saved | null>(null), liveImageBusy = useRef(false), liveExtractionBusy = useRef(false), liveReading = useRef(false);
  const liveSourceAvailable = useRef(false), liveExtractionOpen = useRef(false);
  const [saveAttempt,setSaveAttempt]=useState<SizeChartSaveAttempt|null>(null),attemptRef=useRef<SizeChartSaveAttempt|null>(null),atomicRequest=useRef<AbortController|null>(null);
  const contextRef=useRef({profileId,active,disabled}),callbacks=useRef({beforeSave,onBusyChange,onSaved});
  useLayoutEffect(()=>{callbacks.current={beforeSave,onBusyChange,onSaved};},[beforeSave,onBusyChange,onSaved]);
  useLayoutEffect(() => {const previous=contextRef.current;if(currentVersion.current!==version||previous.profileId!==profileId||previous.active!==active||previous.disabled!==disabled){sequence.current++;atomicRequest.current?.abort();}currentVersion.current = version;contextRef.current={profileId,active,disabled}; }, [version,profileId,active,disabled]);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const imageBusyChanged = useCallback((value: boolean) => { if (!alive.current || currentVersion.current !== version) return; liveImageBusy.current = value; setImageBusy(value); }, [version]);
  const extractionBusyChanged = useCallback((value: boolean) => { if (!alive.current || currentVersion.current !== version) return; liveExtractionBusy.current = value; setExtractionBusy(value); }, [version]);
  const dirty = draft !== undefined, fresh = sourceAvailable && saved?.version === version;
  const chart = draft === null ? null : draft?.chart ?? saved?.content.manualSizeChart ?? null;
  const locked = busy || imageBusy || extractionBusy || reading || !active || disabled;
  useEffect(()=>{callbacks.current.onBusyChange?.(busy||imageBusy||extractionBusy||reading);return()=>callbacks.current.onBusyChange?.(false);},[busy,imageBusy,extractionBusy,reading]);
  useEffect(()=>()=>atomicRequest.current?.abort(),[]);
  const result = saved && fresh && !dirty && !editingResult && !locked && !error ? saved.resultKey : null;
  const resultUrl = result ? `/api/files/${result.split('/').map(encodeURIComponent).join('/')}` : null;
  function store(value: Saved) { latestSaved.current = value; setSaved(value); liveSourceAvailable.current = true; setSourceAvailable(true); }
  function canEdit(requireFresh = false) { return alive.current && currentVersion.current === version && latestSaved.current === saved && !!saved
    && contextRef.current.active&&!contextRef.current.disabled&&!attemptRef.current&&!operation.current && !liveImageBusy.current && !liveExtractionBusy.current && !liveReading.current && (!requireFresh || liveSourceAvailable.current && saved.version === version); }
  function closeExtraction() { liveExtractionOpen.current = false; setExtractionOpen(false); }
  function edit(value: Draft | undefined) { pending.current = value; setDraft(value); setNotice(''); }
  async function getContent() {
    const response = await fetch(`/api/products/${encodeURIComponent(productId)}/content`, { cache: 'no-store' });
    const body = await response.json() as { error?: string; content?: unknown };
    if (!response.ok) throw Error(body?.error || '사이즈표를 불러오지 못했습니다.');
    return readContent(body, productId);
  }
  async function snapshot(requestedVersion: string): Promise<Saved> {
    const getProduct = async () => {
      const response = await fetch(`/api/products/${encodeURIComponent(productId)}`, { cache: 'no-store' }), body: unknown = await response.json();
      if (!response.ok) throw Error('사이즈표를 확인할 상품을 읽지 못했습니다.');
      return readProductSource(body, productId);
    };
    const before = await getProduct(), content = await getContent(), after = await getProduct();
    if (!same(before, after) || after.version !== requestedVersion) throw Error('상품 저장 상태가 변경되었습니다. 최신 상품에서 사이즈표를 다시 확인해주세요.');
    const keys = content.assets.size.value;
    const resultKey = keys.length === 1 && isOwnedImageKey(after.owner, keys[0]) && after.keys.includes(keys[0]) ? keys[0] : null;
    return { content, version: requestedVersion, resultKey, resultIssue: keys.length && !resultKey ? '저장된 사이즈표 한 장을 현재 상품의 이미지 목록에서 확인하지 못했습니다. 저장 자료를 확인한 뒤 다시 연결해주세요.' : null };
  }
  // A refresh must never overwrite edits made while its response is in flight.
  useEffect(() => {
    const ticket = ++sequence.current, requestedVersion = version;
    if(!active||disabled){liveReading.current=false;void Promise.resolve().then(()=>{if(alive.current&&ticket===sequence.current)setReading(false);});return;}
    liveReading.current = true;
    void Promise.resolve().then(() => {
      if (!alive.current || ticket !== sequence.current || currentVersion.current !== requestedVersion) return null;
      setReading(true); return snapshot(requestedVersion);
    }).then(value => {
      if (!value) return;
      if (alive.current && ticket === sequence.current && currentVersion.current === requestedVersion && pending.current === undefined) { store(value); setError(''); }
    }).catch(cause => { if (alive.current && ticket === sequence.current && currentVersion.current === requestedVersion) { liveSourceAvailable.current = false; setSourceAvailable(false); setError(cause instanceof Error ? cause.message : '사이즈표 조회 실패'); } })
      .finally(() => { if (alive.current && ticket === sequence.current && currentVersion.current === requestedVersion) { liveReading.current = false; setReading(false); } });
    // Only product identity/version starts an automatic read. Explicit refresh
    // below controls whether unsaved input is kept or discarded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, version, profileId, active, disabled, readClock]);
  async function reload(keep: boolean) {
    if (!alive.current || currentVersion.current !== version || operation.current || liveImageBusy.current || liveExtractionBusy.current || liveReading.current) return;
    operation.current = true; setBusy(true); setError('');
    const ticket = ++sequence.current, requestedVersion = currentVersion.current;
    try {
      const value = await snapshot(requestedVersion);
      if (!alive.current || ticket !== sequence.current || currentVersion.current !== requestedVersion) return;
      store(value);
      if (!keep) { edit(undefined); setEditingResult(false); closeExtraction(); }
      setNotice(keep ? '입력은 유지하고 최신 저장본을 확인했습니다.' : '저장한 사이즈표를 다시 불러왔습니다.');
    } catch (cause) { if (alive.current && ticket === sequence.current) { liveSourceAvailable.current = false; setSourceAvailable(false); setError(cause instanceof Error ? cause.message : '사이즈표 조회 실패'); } }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  function change(transform: (value: NonNullable<Draft>) => NonNullable<Draft>) {
    if (!canEdit()) return;
    const current = pending.current;
    edit(transform(current && current !== null ? current : draftOf(saved!.content.manualSizeChart ?? seed())));
  }
  function rewrite() {
    if (!canEdit(true) || pending.current !== undefined || !saved?.resultKey) return;
    if (!window.confirm('사이즈표를 재작성하시겠습니까? 입력한 표와 기존 이미지는 보관하며, 새 PNG를 첨부하면 견적에 사용할 이미지가 교체됩니다.')) return;
    if (!canEdit(true) || pending.current !== undefined) return;
    setEditingResult(true); setNotice('저장된 표를 수정하거나 이미지에서 새 초안을 가져오세요. 기존 사이즈표는 새 PNG를 첨부하기 전까지 보관합니다.');
  }
  function imageSaved() {
    if (!alive.current || currentVersion.current !== version || pending.current !== undefined) return;
    liveReading.current = true; setReading(true); setEditingResult(false); closeExtraction(); setReadClock(value => value + 1); onSaved?.();
  }
  function sizesChanged(input: string) {
    change(value => {
      // Column positions, including deliberately repeated names, are preserved.
      // Removing then adding a column never resurrects its former measurements.
      const sizes = input.split(',').map(item => item.trim()).filter(Boolean);
      return { sizesInput: input, chart: { ...value.chart, sizes, measurements: value.chart.measurements.map(row => ({ ...row, values: sizes.map((_, index) => row.values[index] ?? '') })) } };
    });
  }
  async function save() {
    if (!canEdit(true) || !saved || pending.current === undefined || callbacks.current.beforeSave?.()===false) return;
    const candidate = pending.current;
    let normalized: ManualSizeChart | null;
    try { normalized = candidate === null ? null : validateManualSizeChart(candidate.chart); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '사이즈표 입력을 확인해주세요.'); return; }
    const before = saved.content, requestedVersion = version, ticket = ++sequence.current;
    operation.current = true; setBusy(true); setError(''); setNotice('');
    const current = () => alive.current && ticket === sequence.current && currentVersion.current === requestedVersion;
    try {
      let acknowledged: ProductContent;
      try {
        const response = await fetch(`/api/products/${encodeURIComponent(productId)}/content`, { method: 'PATCH', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expectedRevision: before.revision, patch: { manualSizeChart: normalized } }) });
        const body = await response.json() as { error?: string; content?: unknown };
        if (!response.ok) throw Error(body?.error || '사이즈표를 저장하지 못했습니다.');
        acknowledged = readContent(body, productId);
        if (!acknowledges(acknowledged, before, normalized)) throw Error('사이즈표 저장 결과가 요청과 다릅니다. 입력을 유지했습니다.');
      } catch (cause) {
        if (!current()) return;
        const recovered = await getContent().catch(() => null);
        if (!recovered || !acknowledges(recovered, before, normalized)) throw cause;
        acknowledged = recovered;
      }
      if (!current()) return;
      store({ content: acknowledged, version: requestedVersion, resultKey: null, resultIssue: null }); edit(undefined);
      setNotice('사이즈표를 저장했습니다. 변경된 표는 PNG를 새로 만들어 견적서에 연결하세요.'); onSaved?.();
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : '사이즈표 저장 실패'); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  function retainAttempt(value:SizeChartSaveAttempt|null){attemptRef.current=value;setSaveAttempt(value);}
  function acceptAtomic(value:SizeChartSaveSnapshot){
    if(value.productId!==productId||value.profileId!==contextRef.current.profileId){setError('저장 시도의 상품·카테고리가 현재 화면과 다릅니다. 원래 카테고리로 돌아와 결과를 확인해주세요.');return;}
    store({content:value.content,version:value.productVersion,resultKey:value.content.assets.size.value[0]??null,resultIssue:null});
    retainAttempt(null);edit(undefined);setEditingResult(false);closeExtraction();setNotice('사이즈표 정보와 PNG를 저장하고 견적서에 연결했습니다. 개별 옵션에 직접 지정한 사이즈표는 보존합니다.');callbacks.current.onSaved?.();
  }
  async function saveTogether(retry=false){
    if(retry?(!attemptRef.current?.uncommitted||operation.current||locked):(!canEdit(true)||!saved)||callbacks.current.beforeSave?.()===false)return;
    if(retry&&(attemptRef.current?.profileId!==profileId||attemptRef.current.before.productId!==productId)){setError('보관한 저장 시도의 원래 상품·카테고리로 돌아와 결과를 확인해주세요.');return;}
    let normalized:ManualSizeChart|null=null;
    if(!retry)try{normalized=pending.current===null?null:validateManualSizeChart(pending.current?.chart??saved!.content.manualSizeChart??seed());}catch(cause){setError(cause instanceof Error?cause.message:'사이즈표 입력을 확인해주세요.');return;}
    const ticket=++sequence.current,requestedVersion=version,requestedProfile=profileId,controller=new AbortController();atomicRequest.current=controller;operation.current=true;setBusy(true);setError('');setNotice('');
    const current=()=>alive.current&&ticket===sequence.current&&currentVersion.current===requestedVersion&&contextRef.current.profileId===requestedProfile&&contextRef.current.active&&!contextRef.current.disabled&&!controller.signal.aborted;
    const controls={current,signal:controller.signal};
    try{
      let attempt=attemptRef.current;
      if(!retry){const basis=await readSizeChartSaveSnapshot(productId,profileId,controls);if(basis.productVersion!==requestedVersion||!same(basis.content,saved!.content))throw Error('표를 작성하는 동안 저장본이 변경되었습니다. 입력을 유지하고 최신 저장본을 조회해주세요.');attempt=await prepareSizeChartSaveAttempt(basis,normalized,profileId,controls);if(!current())return;retainAttempt(attempt);}
      if(!attempt)throw Error('보관한 사이즈표 저장 시도를 확인해주세요.');
      const receipt=await sendSizeChartSaveAttempt(attempt,controls,retry);if(current())acceptAtomic(receipt);
    }catch(cause){if(current())setError(cause instanceof Error?cause.message:'사이즈표 저장 결과를 확인하지 못했습니다. 입력과 PNG는 유지됩니다.');}
    finally{if(atomicRequest.current===controller)atomicRequest.current=null;operation.current=false;if(alive.current)setBusy(false);}
  }
  async function recoverTogether(){
    const attempt=attemptRef.current;if(!attempt||operation.current||locked||callbacks.current.beforeSave?.()===false)return;
    if(attempt.profileId!==profileId||attempt.before.productId!==productId){setError('보관한 저장 시도의 원래 상품·카테고리로 돌아와 결과를 확인해주세요.');return;}
    const ticket=++sequence.current,requestedVersion=version,requestedProfile=profileId,controller=new AbortController();atomicRequest.current=controller;operation.current=true;setBusy(true);setError('');
    const current=()=>alive.current&&ticket===sequence.current&&currentVersion.current===requestedVersion&&contextRef.current.profileId===requestedProfile&&contextRef.current.active&&!contextRef.current.disabled&&!controller.signal.aborted;
    try{const result=await recoverSizeChartSaveAttempt(attempt,{current,signal:controller.signal});if(!current())return;if(result.state==='committed')acceptAtomic(result.snapshot);else{setSaveAttempt({...attempt});setNotice('현재 상품에는 이 저장 시도가 반영되지 않았습니다. 확인한 시도로 다시 저장하면 보관된 동일 PNG를 재사용합니다. 자동 재전송하지 않았습니다.');}}
    catch(cause){if(current())setError(cause instanceof Error?cause.message:'결과를 확인하지 못했습니다. 입력을 유지했습니다.');}finally{if(atomicRequest.current===controller)atomicRequest.current=null;operation.current=false;if(alive.current)setBusy(false);}
  }
  const working = draft && draft !== null ? draft : chart ? draftOf(chart) : null;
  const inputLocked=locked||Boolean(saveAttempt);
  return <section className="panel-stack" aria-label="사이즈표 편집" data-size-chart-workspace data-quotation-source-step={sourceStep} data-workspace-dirty={dirty||Boolean(saveAttempt)} data-workspace-saving={busy||imageBusy||extractionBusy||reading} aria-busy={busy||reading}>
    <h3>사이즈표 작업</h3>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {reading && <p role="status">현재 상품의 저장된 사이즈표를 확인하는 중…</p>}
    {result && resultUrl ? <section className="panel-stack" aria-label="저장된 사이즈표 결과">
      <h4>저장된 사이즈표</h4><div className="quote-actions"><a className="btn ghost" aria-label="저장된 사이즈표 이미지 다운로드" href={resultUrl} download="size_chart.png">이미지 다운로드</a>
        <button type="button" className="btn ghost" aria-label="저장된 사이즈표 재작성" disabled={locked||!fresh} onClick={rewrite}>재작성</button></div>
      <div style={{maxHeight:600,overflow:'auto'}}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Show the verified saved private image, not newly rendered measurements. */}
        <img src={resultUrl} alt="저장된 사이즈표" data-saved-size-chart style={{display:'block',width:'100%',height:'auto'}}/>
      </div><small>수정하려면 재작성을 눌러주세요. 기존 파일은 새 사이즈표로 교체한 뒤에도 보관합니다.</small>
    </section> : <>
    <p>측정 항목과 사이즈별 값을 입력하고 아래 표를 확인한 뒤 ‘사이즈표 저장’을 누르세요. 정보·PNG·견적서 연결을 함께 저장하며 원본 파일과 개별 옵션의 직접 지정 이미지는 보관합니다.</p>
    {saved?.resultIssue && <p role="status">{saved.resultIssue}</p>}
    <button type="button" className="btn blue" aria-expanded={extractionOpen} disabled={!saved || locked || !fresh || !extractionOpen && dirty} onClick={() => { if (!canEdit(true)) return; liveExtractionOpen.current=!liveExtractionOpen.current;setExtractionOpen(liveExtractionOpen.current); }}>{extractionOpen ? '이미지 추출 영역 닫기' : '이미지에서 사이즈표 초안 만들기'}</button>
    {saved && extractionOpen && <SizeChartExtractionPanel productId={productId} version={version} contentRevision={saved.content.revision} disabled={dirty || busy || imageBusy || !active || disabled || Boolean(saveAttempt) || !fresh} onBusyChange={extractionBusyChanged} onDraft={value => {
      if (!alive.current || !liveExtractionOpen.current || latestSaved.current !== saved || operation.current || liveImageBusy.current || liveReading.current || pending.current !== undefined || currentVersion.current !== version || currentVersion.current !== saved.version || !liveSourceAvailable.current) return;
      edit(draftOf(validateManualSizeChart(value))); setNotice('이미지에서 추출한 표를 가져왔습니다. 원본과 비교해 수정한 뒤 정보를 저장해주세요.');
    }}/>}
    {!saved && !error && <p role="status">저장한 사이즈표를 불러오는 중…</p>}
    {dirty && !fresh && <p role="status">상품 저장 상태가 변경되었습니다. 입력은 유지했습니다. 최신 저장본을 조회한 뒤 저장해주세요.</p>}
    {!working ? <button type="button" className="btn blue" disabled={!saved || locked} onClick={() => { if(canEdit()&&!pending.current)edit(draftOf(seed())); }}>사이즈표 직접 작성</button> : <>
      <div className="modal-form"><label>사이즈 유형<input aria-label="사이즈 유형" maxLength={80} value={working.chart.sizeType} disabled={inputLocked} onChange={event => change(value => ({ ...value, chart: { ...value.chart, sizeType: event.target.value } }))}/></label>
        <label>단위<select aria-label="사이즈표 단위" value={working.chart.sizeUnits} disabled={inputLocked} onChange={event => change(value => ({ ...value, chart: { ...value.chart, sizeUnits: event.target.value as ManualSizeChart['sizeUnits'] } }))}>{manualSizeUnits.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select></label>
        <label>사이즈 목록<input aria-label="사이즈 목록" maxLength={MANUAL_SIZE_CHART_COLUMNS * 82} placeholder="예: S, M, L, XL" value={working.sizesInput} disabled={inputLocked} onChange={event => sizesChanged(event.target.value)}/><small>쉼표로 구분 · 최대 {MANUAL_SIZE_CHART_COLUMNS}열</small></label></div>
      <div className="panel-stack" aria-label="사이즈표 측정 항목 카드">{working.chart.measurements.map((row,index)=><fieldset key={index} style={{border:'1px solid #dfe4ec',borderRadius:8,padding:16,margin:0}}><legend>측정 항목 {index+1}</legend>
        <label>측정 부위<input aria-label={`측정 항목 ${index + 1} 이름`} maxLength={80} value={row.name} disabled={inputLocked} placeholder="예: 총장" onChange={event => change(value => ({ ...value, chart: { ...value.chart, measurements: value.chart.measurements.map((item, at) => at === index ? { ...item, name: event.target.value } : item) } }))}/></label>
        <div className="modal-form">{row.values.map((cell,column)=><label key={column}>{working.chart.sizes[column]} ({working.chart.sizeUnits})<input aria-label={`측정 항목 ${index + 1} 사이즈 ${column + 1} 값`} maxLength={200} value={cell} disabled={inputLocked} onChange={event => change(value => ({ ...value, chart: { ...value.chart, measurements: value.chart.measurements.map((item, at) => at === index ? { ...item, values: item.values.map((old, col) => col === column ? event.target.value : old) } : item) } }))}/></label>)}</div>
        <button type="button" className="btn ghost" aria-label={`측정 항목 ${index+1} 삭제`} disabled={inputLocked} onClick={()=>change(value=>({...value,chart:{...value.chart,measurements:value.chart.measurements.filter((_,at)=>at!==index)}}))}>삭제</button>
      </fieldset>)}</div>
      <button type="button" className="btn ghost" disabled={inputLocked || working.chart.measurements.length >= MANUAL_SIZE_CHART_ROWS} onClick={() => change(value => ({ ...value, chart: { ...value.chart, measurements: [...value.chart.measurements, { name: '', values: value.chart.sizes.map(() => '') }] } }))}>＋ 측정 항목 추가</button>
      <section aria-label="사이즈표 미리보기"><h4>{working.chart.sizeType||'사이즈표'} · 단위 {working.chart.sizeUnits}</h4><div className="table-wrap"><table><thead><tr><th>측정 부위</th>{working.chart.sizes.map((size,index)=><th key={index}>{size}</th>)}</tr></thead><tbody>{working.chart.measurements.map((row,index)=><tr key={index}><th>{row.name||'-'}</th>{row.values.map((value,column)=><td key={column}>{value||'-'}</td>)}</tr>)}</tbody></table></div></section>
      <p>공란은 이미지에서 ‘-’로 표시합니다. 치수·무게·법적 고시나 옵션 값에는 자동으로 반영하지 않습니다.</p>
    </>}
    {saved&&<div className="quote-actions"><button type="button" className="btn primary" disabled={inputLocked||!fresh||!working&&draft!==null} onClick={()=>void saveTogether()}>사이즈표 저장</button>
      {saveAttempt&&<button type="button" className="btn ghost" disabled={locked} onClick={()=>void recoverTogether()}>저장 결과 확인</button>}
      {saveAttempt?.uncommitted&&<button type="button" className="btn primary" disabled={locked} onClick={()=>void saveTogether(true)}>확인한 시도로 다시 저장</button>}
    </div>}
    <details><summary>정보·PNG 개별 작업</summary>
    {saved && <div className="quote-actions"><button type="button" className="btn ghost" disabled={!dirty || inputLocked || !fresh} onClick={() => void save()}>사이즈표 정보 저장</button>
      {saved.content.manualSizeChart && <button type="button" className="btn ghost" disabled={locked} onClick={() => { if(canEdit())edit(null); }}>옵션 치수 표로 전환</button>}
      {saved.resultKey&&!dirty&&fresh&&<button type="button" className="btn ghost" disabled={locked} onClick={()=>{if(canEdit(true)&&pending.current===undefined){setEditingResult(false);closeExtraction();}}}>저장된 사이즈표 보기</button>}
      {dirty && <button type="button" className="btn ghost" disabled={inputLocked} onClick={() => void reload(true)}>입력 유지·최신 사이즈표 조회</button>}
      <button type="button" className="btn ghost" disabled={inputLocked} onClick={() => void reload(false)}>{dirty ? '입력 취소·저장 사이즈표 조회' : '저장 사이즈표 다시 조회'}</button></div>}
    {draft === null && <p role="status">정보를 저장하면 직접 작성한 표 대신 저장된 옵션 치수·무게로 표를 만듭니다.</p>}
    {dirty && <p role="status">사이즈표 정보를 먼저 저장하거나 입력을 취소한 뒤 PNG를 만들어주세요.</p>}
    <DocumentImagePanel key={`${productId}:${saved?.content.revision ?? 'loading'}`} productId={productId} version={version} section="size" disabled={!saved || dirty || busy || reading || extractionBusy || !active || disabled || Boolean(saveAttempt) || !fresh} onBusyChange={imageBusyChanged} onSaved={imageSaved}/>
    </details>
    </>}
  </section>;
}
