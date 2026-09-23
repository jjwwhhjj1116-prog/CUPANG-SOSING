'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { calculateOptionPrices, emptyOptionInput, optionInputs, optionFieldNames, OPTION_LIMIT, type OptionField, type OptionInput, type ProductOptionsResponse } from '@/app/product-options';
import { productImageKeys } from '@/app/product-content';
import { applyOptionBulk, duplicateOption, moveOption, previewOptionBulk, type BulkOptionAction, type BulkOptionPreview } from '@/app/option-editor-tools';
import type { PricePolicy } from '@/app/pricing';
import { refreshOptionPriceBase } from '@/app/option-price-refresh';

type Props = { product: { id: string; title: string; image_keys: string; updated_at?: string }; onSaved?: () => void; pricingView?: boolean };
const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`;
const originNames = { manual: '직접 입력', collected: '수집 원문', translated: '번역 결과', unverified: '미확인' };
async function fetchOptions(endpoint: string, signal?: AbortSignal): Promise<ProductOptionsResponse> {
  const response = await fetch(endpoint, { signal, cache: 'no-store' });
  const body = await response.json() as ProductOptionsResponse & { error?: string };
  if (!response.ok || !body.options) throw new Error(body.error || '옵션을 불러오지 못했습니다.');
  return body;
}
export function ProductOptionsEditor(props: Props) { return <OptionsEditor key={props.product.id} {...props} />; }
function OptionsEditor({ product, onSaved, pricingView = false }: Props) {
  const [saved, setSaved] = useState<ProductOptionsResponse | null>(null);
  const [rows, setRows] = useState<OptionInput[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [conflict, setConflict] = useState(false);
  const [snapshotVersion, setSnapshotVersion] = useState(product.updated_at);
  const [refreshNotice, setRefreshNotice] = useState('');
  const endpoint = `/api/products/${encodeURIComponent(product.id)}/options`;
  const applyLoaded = useCallback((body: ProductOptionsResponse) => { setSaved(body); setRows(optionInputs(body.options)); setSelected(new Set()); setError(''); setMessage(''); setConflict(false); }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetchOptions(endpoint, controller.signal).then(body => { if (!controller.signal.aborted) applyLoaded(body); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '옵션을 불러오지 못했습니다.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, applyLoaded]);
  const calculations = useMemo(() => saved ? calculateOptionPrices(rows, saved.pricing.policy) : [], [rows, saved]);
  const dirty = saved !== null && JSON.stringify(rows) !== JSON.stringify(optionInputs(saved.options));
  const changedElsewhere = Boolean(product.updated_at && (!snapshotVersion || Date.parse(product.updated_at) > Date.parse(snapshotVersion)));
  useEffect(() => {
    if (!changedElsewhere) return;
    const controller = new AbortController();
    if (dirty) {
      Promise.resolve().then(() => { if (!controller.signal.aborted) setRefreshNotice('다른 탭에서 상품 또는 가격이 변경되었습니다. 옵션 입력은 유지했습니다. 입력 내용을 보관한 뒤 최신 가격·저장본을 확인해주세요.'); });
    } else {
      fetchOptions(endpoint, controller.signal).then(body => {
        if (!controller.signal.aborted) { applyLoaded(body); setSnapshotVersion(body.productVersion); setRefreshNotice(''); }
      }).catch(cause => { if (!controller.signal.aborted) setRefreshNotice(cause instanceof Error ? cause.message : '최신 옵션을 불러오지 못했습니다.'); });
    }
    return () => controller.abort();
  }, [changedElsewhere, dirty, endpoint, applyLoaded, product.updated_at]);
  let images: string[] = []; try { images = productImageKeys(product.image_keys); } catch { /* Server checks invalid references on save. */ }
  const included = rows.filter(row => row.included).length;
  async function reload() {
    setLoading(true); try { const body = await fetchOptions(endpoint); applyLoaded(body); setSnapshotVersion(body.productVersion); setRefreshNotice(''); } catch (cause) { setError(cause instanceof Error ? cause.message : '저장본을 불러오지 못했습니다.'); } finally { setLoading(false); }
  }
  async function refreshPricesKeepingDraft() {
    if (!saved || busy || loading) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const latest = await fetchOptions(endpoint);
      const refreshed = refreshOptionPriceBase(saved, latest, rows);
      setSaved(refreshed.saved); setRows(refreshed.rows); setSnapshotVersion(latest.productVersion);
      setConflict(false); setRefreshNotice('');
      setMessage('옵션 입력을 유지하고 최신 가격 정책을 적용했습니다. 계산 결과를 확인한 뒤 옵션을 저장하세요.');
      onSaved?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '최신 가격 확인 실패'); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!saved) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(endpoint, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: saved.options.revision, expectedProductVersion: saved.productVersion, rows }) });
      const body = await response.json() as ProductOptionsResponse & { error?: string };
      if (!response.ok || !body.options) { if (response.status === 409) setConflict(true); throw new Error(body.error || '옵션을 저장하지 못했습니다.'); }
      applyLoaded(body); setMessage(`옵션 ${body.options.rows.length}개 저장 완료 · 견적 포함 ${body.options.rows.filter(row => row.included).length}개`); onSaved?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '옵션을 저장하지 못했습니다.'); } finally { setBusy(false); }
  }
  function update<K extends OptionField>(id: string, key: K, value: OptionInput[K]) { setRows(previous => previous.map(row => row.id === id ? { ...row, [key]: value } : row)); }
  function origin(row: OptionInput, key: OptionField) {
    const previous = saved?.options.rows.find(item => item.id === row.id);
    return previous && previous[key] === row[key] ? originNames[previous.provenance[key]] : '미저장 수정';
  }
  const numberKeys = ['unitCostCny', 'unitsPerPack', 'minimumOrderQuantity', 'widthCm', 'lengthCm', 'heightCm', 'weightKg'] as const;

  return <div className="panel-stack" aria-busy={busy || loading}>
    <div className="panel-note"><div><strong>옵션·SKU별 견적 구성</strong><p>옵션 원가와 판매 단위당 구성 수량으로 각각 계산합니다. 상품의 대표 원가는 별도로 유지됩니다. 원문·한국어 이름을 수정해 저장할 수 있으며 자동 수집·번역이 실행되는 화면은 아닙니다.</p></div></div>
    {loading && <p role="status">저장한 옵션과 가격 설정을 불러오는 중입니다.</p>}
    {error && <div role="alert" className="panel-note"><div><strong>{error}</strong>{conflict && <p>입력 내용을 보관한 후 최신 상품·가격·옵션을 확인해주세요.</p>}<button type="button" className="btn ghost" disabled={busy || loading} onClick={() => void reload()}>{saved ? '입력 버리고 저장본 불러오기' : '다시 불러오기'}</button></div></div>}
    {message && <p role="status">{message}</p>}
    {(refreshNotice || conflict) && <div role="status" className="panel-note"><div><p>{refreshNotice || '저장 중 상품 버전이 바뀌었습니다. 옵션 입력을 유지한 채 최신 가격을 확인할 수 있습니다.'}</p><button type="button" className="btn primary" disabled={busy || loading || !saved} onClick={() => void refreshPricesKeepingDraft()}>입력 유지 · 최신 가격 적용</button><button type="button" className="btn ghost" disabled={busy || loading} onClick={() => void reload()}>입력 버리고 최신 저장본 불러오기</button></div></div>}
    {saved && <>
      <p style={{ color: '#64748b', fontSize: 13 }}>계산 기준: {saved.pricing.policySource === 'saved-product' ? '상품에 저장한 가격 설정' : '상품의 기존 환율·마진 + 현재 기본설정'} · 환율 {saved.pricing.policy.exchangeRate}원 · 공급 마진 {saved.pricing.policy.supplyMargin}% · 쿠팡 마진 {saved.pricing.policy.coupangMargin}% · 최소 마진 {won(saved.pricing.policy.minimumMargin)} · {saved.pricing.policy.roundingUnit}원 단위 올림</p>
      <fieldset disabled={busy || loading} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}><strong>전체 {rows.length}개 · 견적 포함 {included}개</strong><button type="button" className="btn ghost" disabled={rows.length >= OPTION_LIMIT} onClick={() => setRows(previous => [...previous, emptyOptionInput(crypto.randomUUID())])}>＋ 옵션 추가</button></div>
        {rows.length > 0 && <OptionBulkTools key={JSON.stringify(saved.pricing.policy)} rows={rows} selected={[...selected].filter(id => rows.some(row => row.id === id))} onSelect={ids => setSelected(new Set(ids))} policy={saved.pricing.policy} onApply={next => { setRows(next); setSelected(previous => new Set([...previous].filter(id => next.some(row => row.id === id)))); }} />}
        {!rows.length && <div className="empty"><strong>저장한 옵션이 없습니다.</strong><small>수집된 옵션이 연결되면 여기에 표시됩니다. 확인한 옵션을 추가해 수정할 수도 있습니다.</small></div>}
        {pricingView && <div className="option-price-table-wrap"><table className="option-price-table"><caption>옵션별 가격 정보 · 저장된 가격 정책 기준</caption><thead><tr><th>선택</th><th>견적 포함</th><th>옵션명 / SKU</th><th>개당 원가(CNY)</th><th>구성 수량</th><th>공급가</th><th>판매가</th><th>공급 마진</th></tr></thead><tbody>{rows.map((row,index)=>{
          const result=calculations.find(item=>item.optionId===row.id);
          return <tr key={row.id}><td><input type="checkbox" aria-label={`가격 옵션 ${index+1} 선택`} checked={selected.has(row.id)} onChange={event=>setSelected(previous=>{const next=new Set(previous);if(event.target.checked)next.add(row.id);else next.delete(row.id);return next;})}/></td><td><input type="checkbox" aria-label={`가격 옵션 ${index+1} 견적 포함`} checked={row.included} onChange={event=>update(row.id,'included',event.target.checked)}/></td><td><strong>{row.translatedName||row.originalName||`옵션 ${index+1}`}</strong><small>{row.supplierSku||'SKU 미입력'}</small></td><td><input aria-label={`가격 옵션 ${index+1} 개당 원가`} type="number" min="0" step="any" value={row.unitCostCny===null||!Number.isFinite(row.unitCostCny)?'':row.unitCostCny} onChange={event=>update(row.id,'unitCostCny',event.target.value===''?null:event.target.valueAsNumber)}/></td><td><input aria-label={`가격 옵션 ${index+1} 구성 수량`} type="number" min="1" step="1" value={Number.isFinite(row.unitsPerPack)?row.unitsPerPack:''} onChange={event=>update(row.id,'unitsPerPack',event.target.valueAsNumber)}/></td>{!row.included?<td colSpan={3}>견적 제외</td>:result?.calculation?<><td>{won(result.calculation.supplyPrice)}</td><td>{won(result.calculation.salePrice)}</td><td>{won(result.calculation.marginKrw)}<small>{result.calculation.actualMargin.toFixed(1)}%</small></td></>:<td colSpan={3} role="status">{result?.error||'원가를 확인해주세요.'}</td>}</tr>;
        })}</tbody></table><p>옵션명·이미지·치수·복제는 상단 옵션·사이즈표에서 수정합니다. 왼쪽 가격 정책은 저장한 뒤 이 표에 반영됩니다.</p></div>}
        <div className="panel-stack" hidden={pricingView}>{rows.map((row, index) => {
          const calculated = calculations.find(value => value.optionId === row.id);
          return <article key={row.id} style={{ border: '1px solid #dfe4ec', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}><label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" aria-label={`옵션 ${index + 1} 일괄 편집 선택`} checked={selected.has(row.id)} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(row.id); else next.delete(row.id); return next; })} /><strong>옵션 {index + 1}</strong></label><label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={row.included} onChange={event => update(row.id, 'included', event.target.checked)} />견적 포함</label><div style={{ display: 'flex', gap: 6 }}><button type="button" className="btn ghost" aria-label={`옵션 ${index + 1} 위로`} disabled={index === 0} onClick={() => setRows(previous => moveOption(previous, row.id, -1))}>↑</button><button type="button" className="btn ghost" aria-label={`옵션 ${index + 1} 아래로`} disabled={index === rows.length - 1} onClick={() => setRows(previous => moveOption(previous, row.id, 1))}>↓</button><button type="button" className="btn ghost" disabled={rows.length >= OPTION_LIMIT} title="이름·원가·치수·이미지를 유지하고 공급자 SKU는 비운 미포함 옵션을 만듭니다." onClick={() => setRows(previous => duplicateOption(previous, row.id, crypto.randomUUID()))}>복제</button><button type="button" className="btn ghost" aria-label={`옵션 ${index + 1} 삭제`} onClick={() => setRows(previous => previous.filter(value => value.id !== row.id))}>삭제</button></div></div>
            <div className="form-grid">{(['originalName', 'translatedName', 'supplierSku'] as const).map(key => <label className={`field ${key === 'supplierSku' ? 'full' : ''}`} key={key}><span>{optionFieldNames[key]} <small style={{ color: '#64748b', fontWeight: 400 }}>{origin(row, key)}</small></span><input aria-label={`옵션 ${index + 1} ${optionFieldNames[key]}`} value={row[key]} maxLength={key === 'supplierSku' ? 200 : 500} onChange={event => update(row.id, key, event.target.value)} /></label>)}</div>
            <div className="form-grid">{numberKeys.map(key => <label className="field" key={key}><span>{optionFieldNames[key]}{key === 'unitCostCny' && row.included ? ' · 필수' : ''}</span><input aria-label={`옵션 ${index + 1} ${optionFieldNames[key]}`} type="number" min={0} step={key === 'unitsPerPack' || key === 'minimumOrderQuantity' ? 1 : 'any'} value={row[key] === null || !Number.isFinite(row[key]) ? '' : row[key]} onChange={event => { const value = event.target.value === '' ? null : event.target.valueAsNumber; if (key === 'unitsPerPack') update(row.id, key, value ?? NaN); else update(row.id, key, value); }} /></label>)}</div>
            <label className="field" style={{ marginTop: 14 }}><span>옵션 이미지</span><select aria-label={`옵션 ${index + 1} 이미지`} value={row.imageKey ?? ''} onChange={event => update(row.id, 'imageKey', event.target.value || null)} style={{ padding: 10, border: '1px solid #dfe4ec', borderRadius: 8 }}><option value="">지정 안 함</option>{images.map((key, imageIndex) => <option value={key} key={key}>업로드 이미지 {imageIndex + 1}</option>)}</select></label>
            {row.imageKey && <div style={{ marginTop: 10 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/files/${row.imageKey.split('/').map(encodeURIComponent).join('/')}`} alt={`옵션 ${index + 1} 연결 이미지`} width={100} height={100} style={{ objectFit: 'contain' }} />
            </div>}
            {row.included && (calculated?.error ? <p role="status" style={{ color: '#a34410', marginTop: 14 }}>{calculated.error}</p> : calculated?.calculation && <div style={{ background: '#f5f8ff', padding: 12, borderRadius: 8, marginTop: 14 }}><p style={{ margin: 0 }}>판매 단위 원가 ¥{calculated.sourceCostCny?.toLocaleString('ko-KR')} = 개당 ¥{row.unitCostCny} × {row.unitsPerPack}개</p><p style={{ margin: '6px 0 0' }}><strong>공급가 {won(calculated.calculation.supplyPrice)} · 판매가 {won(calculated.calculation.salePrice)}</strong><br />MSRP {won(calculated.calculation.msrp)} · 공급 마진 {won(calculated.calculation.marginKrw)}</p></div>)}
            {!row.included && <p style={{ color: '#64748b', marginTop: 12, marginBottom: 0 }}>견적에서 제외 · 입력한 자료는 저장됩니다.</p>}
          </article>;
        })}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 18 }}><small style={{ color: '#64748b' }}>{dirty ? '저장하지 않은 변경' : `저장 버전 ${saved.options.revision}`}</small><button type="button" className="btn primary" disabled={!dirty || conflict || busy || changedElsewhere} onClick={() => void save()}>{busy ? '저장 중…' : '옵션 저장·가격 계산'}</button></div>
      </fieldset>
    </>}
  </div>;
}

function OptionBulkTools({ rows, selected, onSelect, policy, onApply }: { rows: OptionInput[]; selected: string[]; onSelect: (ids: string[]) => void; policy: PricePolicy; onApply: (rows: OptionInput[]) => void }) {
  const [operation, setOperation] = useState<BulkOptionAction['type']>('unitsPerPack');
  const [value, setValue] = useState(''); const [preview, setPreview] = useState<BulkOptionPreview | null>(null);
  const [error, setError] = useState(''); const [undo, setUndo] = useState<{ before: OptionInput[]; after: string } | null>(null);
  const [settings, setSettings] = useState<{ boxSkuQuantity: number; bundleEnabled: boolean } | null>(null); const [settingsMessage, setSettingsMessage] = useState('');
  const actionNames = { unitsPerPack: '판매 단위당 구성 수량', unitCostCny: '개당 원가 CNY', include: '견적에 포함', exclude: '견적에서 제외', remove: '옵션 삭제' };
  const current = Boolean(preview && preview.base === JSON.stringify(rows) && [...preview.selectedIds].sort().join('\n') === [...selected].sort().join('\n'));
  async function showDefaults() {
    try {
      const response = await fetch('/api/settings', { cache: 'no-store' }); const body = await response.json() as { settings?: { boxSkuQuantity: number; bundleEnabled: boolean } | null; error?: string };
      if (!response.ok) throw new Error(body.error || '기본설정을 불러오지 못했습니다.');
      setSettings(body.settings ?? null); setSettingsMessage(body.settings ? '' : '저장한 기본설정이 없습니다.');
    } catch (cause) { setSettingsMessage(cause instanceof Error ? cause.message : '기본설정을 불러오지 못했습니다.'); }
  }
  function makePreview() {
    setError('');
    try {
      const action: BulkOptionAction = operation === 'unitCostCny' || operation === 'unitsPerPack' ? { type: operation, value: value.trim() ? Number(value) : NaN } : { type: operation };
      setPreview(previewOptionBulk(rows, selected, action, policy));
    } catch (cause) { setPreview(null); setError(cause instanceof Error ? cause.message : '변경값을 확인해주세요.'); }
  }
  function applyPreview() {
    if (!preview) return;
    try { const next = applyOptionBulk(rows, preview); setUndo({ before: rows.map(row => ({ ...row })), after: JSON.stringify(next) }); onApply(next); setPreview(null); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '미리보기를 다시 실행해주세요.'); }
  }
  const describe = (row: OptionInput | null) => !row ? '삭제' : operation === 'unitCostCny' ? `¥ ${row.unitCostCny ?? '미입력'}` : operation === 'unitsPerPack' ? `${row.unitsPerPack}개` : row.included ? '견적 포함' : '견적 제외';
  return <details style={{ border: '1px solid #dfe4ec', borderRadius: 10, padding: 14, marginBottom: 16 }}>
    <summary style={{ cursor: 'pointer', fontWeight: 700 }}>선택 옵션 일괄 편집 · {selected.length}개 선택</summary>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 12 }}><button type="button" className="btn ghost" onClick={() => onSelect(rows.map(row => row.id))}>전체 선택</button><button type="button" className="btn ghost" onClick={() => onSelect(rows.filter(row => row.included).map(row => row.id))}>견적 포함 옵션 선택</button><button type="button" className="btn ghost" onClick={() => onSelect([])}>선택 해제</button><button type="button" className="btn ghost" onClick={() => void showDefaults()}>저장한 기본설정 확인</button></div>
    {settings && <p style={{ fontSize: 13, color: '#64748b' }}>기본설정: 묶음판매 {settings.bundleEnabled ? '켜짐' : '꺼짐'} · 박스 내 SKU {settings.boxSkuQuantity}개(물류 입수)</p>}
    {settingsMessage && <p role="status">{settingsMessage}</p>}
    <p style={{ fontSize: 13, color: '#64748b' }}>판매 구성 수량은 직접 확인한 값으로 지정합니다. 박스 내 SKU 수량은 물류용 기본설정이며 옵션 구성 수량으로 자동 적용하지 않습니다.</p>
    <div className="form-grid"><label className="field"><span>선택 옵션에 적용할 작업</span><select value={operation} onChange={event => { setOperation(event.target.value as BulkOptionAction['type']); setPreview(null); }} style={{ padding: 10, border: '1px solid #dfe4ec', borderRadius: 8 }}>{Object.entries(actionNames).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>{(operation === 'unitsPerPack' || operation === 'unitCostCny') && <label className="field"><span>변경값 · {operation === 'unitsPerPack' ? '개' : 'CNY'}</span><input aria-label="일괄 편집 변경값" type="number" min={0} step={operation === 'unitsPerPack' ? 1 : 'any'} value={value} onChange={event => { setValue(event.target.value); setPreview(null); }} /></label>}</div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}><button type="button" className="btn ghost" disabled={!selected.length} onClick={makePreview}>변경 미리보기</button>{undo && <button type="button" className="btn ghost" disabled={undo.after !== JSON.stringify(rows)} onClick={() => { onApply(undo.before.map(row => ({ ...row }))); setUndo(null); setPreview(null); }}>최근 일괄 변경 되돌리기</button>}</div>
    {error && <p role="alert" style={{ color: '#a34410' }}>{error}</p>}
    {preview && <div style={{ marginTop: 14 }}><strong>{actionNames[preview.action.type]} · {preview.changes.length}개 옵션 미리보기</strong><div style={{ maxHeight: 260, overflow: 'auto', marginTop: 8 }}><table style={{ width: '100%', fontSize: 13 }}><thead><tr><th>옵션</th><th>현재 → 변경</th><th>공급가 변경</th></tr></thead><tbody>{preview.changes.map(change => <tr key={change.id}><td>{change.name}</td><td>{describe(change.before)} → {describe(change.after)}</td><td>{change.beforePrice === null ? '—' : won(change.beforePrice)} → {change.error ? change.error : change.afterPrice === null ? '—' : won(change.afterPrice)}</td></tr>)}</tbody></table></div>{!current && <p role="status">선택 또는 편집 내용이 바뀌었습니다. 미리보기를 다시 실행해주세요.</p>}<p style={{ fontSize: 13, color: '#64748b' }}>적용 후에도 아직 저장되지 않습니다. 아래 옵션 저장 버튼으로 서버에 저장하세요.</p><div style={{ display: 'flex', gap: 8 }}><button type="button" className="btn ghost" onClick={() => setPreview(null)}>미리보기 취소</button><button type="button" className="btn primary" disabled={!current} onClick={applyPreview}>편집 내용에 적용</button></div></div>}
  </details>;
}
