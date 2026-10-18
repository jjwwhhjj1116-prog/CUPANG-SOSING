'use client';
/* eslint-disable @next/next/no-img-element -- Authenticated stored product image only. */
import { useEffect, useRef, useState } from 'react';
import { manualSizeUnits, validateManualSizeChart, type ManualSizeChart } from '@/app/manual-size-chart';
import { recognizeFreeImage, type FreeImageLoaded } from '@/app/free-image-translation-client';
import { loadSizeChartImage, readSizeChartImages, requestSizeChartExtraction, sizeChartSourceStillCurrent, type SizeChartImageInventory } from '@/app/size-chart-extraction-client';
import type { SizeChartOcrLine, SizeChartExtractionResult } from '@/app/size-chart-extraction';

type Props = { productId: string; version: string; contentRevision: number; disabled?: boolean; onDraft: (chart: ManualSizeChart) => void; onBusyChange?: (busy: boolean) => void };
type Reading = { key: string; image: FreeImageLoaded; lines: SizeChartOcrLine[]; language: 'zh' | 'en' };
type Work = { controller: AbortController; sequence: number };
export function SizeChartExtractionPanel(props: Props) { return <Panel key={`${props.productId}:${props.version}:${props.contentRevision}`} {...props} />; }
function Panel({ productId, version, contentRevision, disabled = false, onDraft, onBusyChange }: Props) {
  const [inventory, setInventory] = useState<SizeChartImageInventory | null>(null), [key, setKey] = useState('');
  const [language, setLanguage] = useState<'zh' | 'en'>('zh'), [reading, setReading] = useState<Reading | null>(null);
  const [selected, setSelected] = useState<string[]>([]), [result, setResult] = useState<SizeChartExtractionResult | null>(null);
  const [unit, setUnit] = useState<ManualSizeChart['sizeUnits'] | ''>(''), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true), work = useRef<Work | null>(null), generation = useRef(0), pixels = useRef<FreeImageLoaded | null>(null), blocked = useRef(disabled);
  useEffect(() => { blocked.current = disabled; if (disabled) work.current?.controller.abort(); }, [disabled]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    alive.current = true; const controller = new AbortController();
    readSizeChartImages(productId, version, controller.signal).then(value => {
      if (!alive.current || controller.signal.aborted) return;
      if (value.contentRevision !== contentRevision) throw Error('사이즈표 저장 상태가 변경되었습니다. 최신 상품 자료를 다시 불러와주세요.');
      setInventory(value); setKey(value.images[0]?.key ?? '');
    }).catch(cause => { if (alive.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : '이미지 조회 실패'); });
    return () => {
      alive.current = false; controller.abort(); work.current?.controller.abort();
      if (pixels.current) { pixels.current.canvas.width = 0; pixels.current.canvas.height = 0; pixels.current = null; }
    };
    // This panel is keyed to all three source identity values by its wrapper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  function start(): Work | null {
    if (disabled || blocked.current || work.current) return null;
    const value = { controller: new AbortController(), sequence: ++generation.current }; work.current = value;
    setBusy(true); setError(''); setMessage(''); return value;
  }
  function current(value: Work) { return alive.current && work.current === value && value.sequence === generation.current && !value.controller.signal.aborted && !blocked.current; }
  function finish(value: Work) { if (work.current === value) { work.current = null; if (alive.current) setBusy(false); } }
  function clearReading() {
    if (pixels.current) { pixels.current.canvas.width = 0; pixels.current.canvas.height = 0; pixels.current = null; }
    setReading(null); setSelected([]); setResult(null); setUnit(''); setError(''); setMessage('');
  }
  async function recognize() {
    if (!inventory || !key) return;
    const task = start(); if (!task) return;
    clearReading();
    let image: FreeImageLoaded | null = null;
    const timeout = setTimeout(() => task.controller.abort(Error('문구 인식 시간이 초과됐습니다. 사진을 확인하고 다시 시도해주세요.')), 60_000);
    try {
      image = await loadSizeChartImage(productId, inventory, key, task.controller.signal);
      const recognized = await recognizeFreeImage(image, language, task.controller.signal, notice => { if (current(task)) setMessage(notice); });
      if (!current(task)) return;
      const lines = recognized.map(row => ({ id: row.id, text: row.text, box: row.box, confidence: row.confidence }));
      pixels.current = image; setReading({ key, image, lines, language }); setSelected(recognized.filter(row => row.selected).map(row => row.id)); image = null;
      setMessage('원문을 읽었습니다. 표에 해당하는 줄을 확인하고 초안을 작성하세요. 낮은 신뢰도의 줄은 직접 선택할 수 있습니다.');
    } catch (cause) { if (alive.current && work.current === task && !blocked.current) setError(cause instanceof Error ? cause.message : '이미지 문구를 읽지 못했습니다.'); }
    finally { clearTimeout(timeout); if (image) { image.canvas.width = 0; image.canvas.height = 0; } finish(task); }
  }
  async function extract() {
    if (!reading || reading.key !== key || reading.language !== language) return;
    const lines = reading.lines.filter(row => selected.includes(row.id));
    if (!lines.length) { setError('표에 해당하는 원문 줄을 한 개 이상 선택해주세요.'); return; }
    const task = start(); if (!task) return;
    setResult(null); setUnit(''); setMessage('원문 숫자를 유지하며 사이즈표 초안을 작성하는 중…');
    try {
      const reply = await requestSizeChartExtraction(reading.image.source, language, lines, { width: reading.image.width, height: reading.image.height }, task.controller.signal);
      if (!current(task)) return;
      setResult(reply); setUnit(reply.chart?.sizeUnits ?? '');
      setMessage(reply.chart ? '사이즈표 초안입니다. 원본 사진과 각 행·열·수치를 비교한 뒤 편집기로 가져오세요.' : '선택한 원문에서 사이즈표를 확인하지 못했습니다. 다른 사진이나 원문 줄을 선택하거나 직접 작성해주세요.');
    } catch (cause) { if (alive.current && work.current === task && !blocked.current) setError(cause instanceof Error ? cause.message : '사이즈표 초안을 만들지 못했습니다.'); }
    finally { finish(task); }
  }
  async function adopt() {
    if (!result?.chart || !reading || !unit) return;
    const task = start(); if (!task) return;
    try {
      const chart = validateManualSizeChart({ ...result.chart, sizeUnits: unit });
      await sizeChartSourceStillCurrent(result.source, task.controller.signal);
      if (!current(task)) return;
      onDraft(chart); setResult(null); setMessage('편집기에 가져왔습니다. 수정·저장한 뒤 PNG를 만들어 연결하세요.');
    } catch (cause) { if (alive.current && work.current === task && !blocked.current) setError(cause instanceof Error ? cause.message : '추출한 표를 가져오지 못했습니다.'); }
    finally { finish(task); }
  }
  const locked = disabled || busy;
  return <section className="panel-stack" aria-label="이미지 사이즈표 추출" data-workspace-saving={busy} aria-busy={busy}>
    <h4>원본 이미지에서 사이즈표 추출</h4>
    <p>저장된 사진의 문구를 읽어 편집 가능한 표 초안을 만듭니다. 인식한 숫자는 변환하지 않습니다. 초안 검토 후 가져오기·정보 저장·PNG 첨부는 각각 직접 진행합니다.</p>
    {disabled && <p role="status">현재 사이즈표 수정을 저장하거나 취소한 뒤 이미지를 읽어주세요.</p>}
    <div className="modal-form"><label>원본 사진<select aria-label="사이즈표 원본 사진" disabled={locked || !inventory} value={key} onChange={event => { if (!disabled && !work.current) { setKey(event.target.value); clearReading(); } }}>
      {!inventory?.images.length && <option value="">저장된 사진 없음</option>}{inventory?.images.map((item, index) => <option key={item.key} value={item.key}>{index + 1}. {item.role === 'detail' ? '상세 이미지' : '상품 이미지'}</option>)}
    </select></label><label>원문 언어<select aria-label="사이즈표 원문 언어" disabled={locked} value={language} onChange={event => { if (!disabled && !work.current) { setLanguage(event.target.value as 'zh' | 'en'); clearReading(); } }}><option value="zh">중국어</option><option value="en">영어</option></select></label></div>
    {key && <img src={`/api/files/${key.split('/').map(encodeURIComponent).join('/')}`} alt="추출할 사이즈표 원본 사진" style={{ maxWidth: '100%', maxHeight: 500, objectFit: 'contain' }} loading="lazy"/>}
    <div className="quote-actions"><button type="button" className="btn ghost" disabled={locked} onClick={() => { if (!disabled && !work.current) { clearReading(); setInventory(null); setAttempt(value => value + 1); } }}>이미지 목록 다시 조회</button>
      <button type="button" className="btn blue" disabled={locked || !key || !inventory} onClick={() => void recognize()}>이미지 문구 읽기</button>
      <button type="button" className="btn primary" disabled={locked || !reading || selected.length === 0} onClick={() => void extract()}>선택한 원문으로 사이즈표 초안 작성</button>
      {busy && <button type="button" className="btn ghost" onClick={() => { work.current?.controller.abort(Error('작업을 취소했습니다. 저장한 자료는 변경하지 않았습니다.')); setMessage('취소를 요청했습니다. 저장한 자료는 유지됩니다.'); }}>추출 취소</button>}</div>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {reading && <details><summary>인식한 원문 확인 · {selected.length}/{reading.lines.length}줄 선택</summary><p>사진을 자동으로 실측한 결과가 아닙니다. 잘못 읽은 문자·숫자와 행·열 배치를 원본에서 확인해주세요.</p>
      {reading.lines.map(row => <label key={row.id} style={{ display: 'flex', gap: 8, marginBlock: 8 }}><input type="checkbox" aria-label={`사이즈표 원문 ${row.id} 선택`} checked={selected.includes(row.id)} disabled={locked} onChange={event => { if (disabled || work.current) return; setSelected(values => event.target.checked ? [...new Set([...values, row.id])] : values.filter(id => id !== row.id)); setResult(null); setUnit(''); }}/><span style={{ whiteSpace: 'pre-wrap' }}>{row.text} <small>({Math.round(row.confidence)}%)</small></span></label>)}
    </details>}
    {result && <section className="panel-stack" aria-label="추출한 사이즈표 검토">{result.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
      {result.chart && <><label>표 단위 확인<select aria-label="추출한 사이즈표 단위" value={unit} disabled={locked} onChange={event => setUnit(event.target.value as ManualSizeChart['sizeUnits'] | '')}><option value="">원본에서 단위 확인 필요</option>{manualSizeUnits.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <div className="table-wrap"><table><thead><tr><th>측정 부위</th>{result.chart.sizes.map((size, index) => <th key={index}>{size}</th>)}</tr></thead><tbody>{result.chart.measurements.map((row, index) => <tr key={index}><th>{row.name}</th>{row.values.map((value, column) => <td key={column} style={{ whiteSpace: 'pre-wrap' }}>{value || '-'}</td>)}</tr>)}</tbody></table></div>
        <button type="button" className="btn primary" disabled={locked || !unit} onClick={() => void adopt()}>검토한 표를 편집기에 가져오기</button></>}
    </section>}
  </section>;
}
