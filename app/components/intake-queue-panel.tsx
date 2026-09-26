'use client';
import { useEffect, useRef, useState } from 'react';
import { CategoryPicker } from '@/app/components/category-picker';
import { intakeProductId, intakeRow, submitIntakeQueue, visibleIntakeRows, type IntakeRow } from '@/app/intake-queue';
import { collectionBlock, type CollectionJob } from '@/app/sourcing';
import { savedRegistrationSettings, type WorkspaceSettings } from '@/app/workspace-settings';
import type { CategoryProfile } from '@/app/category-profiles';
import type { CategoryAdvancedSeed } from '@/app/category-catalog';
import { collectIntakeProduct } from '@/app/intake-collection';
import { IntakeQuotationPreview } from '@/app/components/intake-quotation-preview';

export function IntakeQueuePanel({ rows, onRows, profiles, onProfile, onAdvanced, onJobs, onBusy, goal, onGoal, settings, onSettingsReloaded, jobs = [], onOpenProduct }: {
  jobs?:CollectionJob[]; onOpenProduct?:(id:string,signal:AbortSignal)=>Promise<void>;
  settings:WorkspaceSettings; onSettingsReloaded:(settings:WorkspaceSettings)=>void;
  rows: IntakeRow[]; onRows: (update: (rows: IntakeRow[]) => IntakeRow[]) => void;
  profiles: CategoryProfile[]; onProfile: (profile: CategoryProfile) => void;
  onAdvanced: (seed?: CategoryAdvancedSeed) => void; onJobs: (jobs: CollectionJob[]) => void; onBusy: (busy: boolean) => void;
  goal: string; onGoal: (goal: string) => void;
}) {
  const [categoryTarget, setCategoryTarget] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [settingsChanged,setSettingsChanged]=useState(false);
  const [settingsMessage,setSettingsMessage]=useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewRow = rows.find(row => row.id === previewId);
  const running = useRef<AbortController | null>(null);
  const focusRow = useRef<string | null>(null);
  const urlInputs = useRef(new Map<string, HTMLInputElement>());
  useEffect(() => {
    if (categoryTarget || busy || !focusRow.current) return;
    const input = urlInputs.current.get(focusRow.current);
    if (input) { input.focus(); input.scrollIntoView({ block: 'nearest', inline: 'nearest' }); focusRow.current = null; }
  }, [rows, categoryTarget, busy]);
  useEffect(() => () => running.current?.abort(), []);
  const visible = visibleIntakeRows(rows, query);
  const pendingRows = rows.filter(row => row.status !== 'saved');
  const selected = pendingRows.filter(row => !excluded.includes(row.id));
  const pending = selected.length;
  const visiblePending = visible.filter(row => row.status !== 'saved');
  function toggle(ids: string[], checked: boolean) {
    if (running.current) return;
    setExcluded(previous => checked ? previous.filter(id => !ids.includes(id)) : [...new Set([...previous, ...ids])]);
  }
  function edit(id: string, patch: Partial<IntakeRow>) {
    if (running.current) return;
    onRows(previous => previous.map(row => row.id === id ? { ...row, ...patch, status: 'draft', message: '' } : row));
  }
  async function openSavedProduct(id:string) {
    if(running.current || !onOpenProduct)return;
    const controller=new AbortController();running.current=controller;setBusy(true);setError('');
    try { await onOpenProduct(id,controller.signal); }
    catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'저장된 상품을 열지 못했습니다. 다시 시도해주세요.');}
    finally{if(running.current===controller)running.current=null;if(!controller.signal.aborted){setBusy(false);}}
  }
  async function reloadSettings() {
    if(running.current)return;
    const controller=new AbortController();running.current=controller;setBusy(true);onBusy(true);setError('');setSettingsMessage('');
    try {
      const response=await fetch('/api/settings',{cache:'no-store',signal:controller.signal});
      const body:unknown=await response.json();
      if(controller.signal.aborted)return;
      if(!response.ok||!body||typeof body!=='object'||!Object.hasOwn(body,'settings'))throw Error('최신 기본설정을 불러오지 못했습니다. 입력은 유지됩니다.');
      const settings=savedRegistrationSettings((body as {settings:unknown}).settings);
      onSettingsReloaded(settings);setSettingsChanged(false);setSettingsMessage('최신 기본설정을 불러왔습니다. URL·카테고리와 처리할 상품 선택은 유지됩니다. 시작을 누르면 남은 상품을 처리합니다.');
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'기본설정 조회 실패');}
    finally{if(running.current===controller)running.current=null;if(!controller.signal.aborted){setBusy(false);onBusy(false);}}
  }
  async function submit() {
    if (running.current || !pending || settingsChanged) return;
    const controller = new AbortController(); running.current = controller; setBusy(true); onBusy(true); setError('');
    try {
      await submitIntakeQueue(rows, goal, { signal: controller.signal, fetcher: fetch, expectedSettings:settings, onSettingsChanged:()=>{setSettingsChanged(true);setSettingsMessage('');}, selectedIds: new Set(selected.map(row => row.id)),
        collect: (job,onProgress) => collectIntakeProduct(job,{signal:controller.signal,fetcher:fetch,onJob:updated=>onJobs([updated]),onProgress}),
        onRow: (id, patch) => onRows(previous => previous.map(row => row.id === id ? { ...row, ...patch } : row)), onJobs });
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '입력 내용을 확인해주세요.'); }
    finally { running.current = null; if (!controller.signal.aborted) { setBusy(false); onBusy(false); } }
  }
  if (categoryTarget) return <div><button type="button" className="btn ghost" onClick={() => setCategoryTarget(null)}>← 상품 대기열</button><CategoryPicker profiles={profiles} selectedId={rows.find(row => row.id === categoryTarget)?.profile.id ?? ''} onAdvanced={onAdvanced} onSelected={profile => {
    onProfile(profile);
    if (categoryTarget === 'new') {
      if (rows.length < 50) { const id = crypto.randomUUID(); focusRow.current = id; onRows(previous => previous.length < 50 ? [...previous, intakeRow(profile, id)] : previous); }
    } else { focusRow.current = categoryTarget; edit(categoryTarget, { profile }); }
    setQuery('');
    setCategoryTarget(null);
  }} /></div>;
  return <div className="modal-form intake-queue">
    <div className="intake-queue-tools"><label>검색<input type="search" aria-label="상품 대기열 검색" placeholder="카테고리 · 1688 URL · 특징 · 키워드" value={query} disabled={busy} onChange={event => setQuery(event.target.value)}/></label><span>전체 {rows.length}건 · 선택 {pending}건</span>{query && <button type="button" className="btn ghost" disabled={busy} onClick={() => setQuery('')}>검색 해제</button>}</div>
    <div className="intake-queue-table"><table><thead><tr><th><input type="checkbox" aria-label="검색 결과 전체 선택" disabled={busy || !visiblePending.length} checked={visiblePending.length > 0 && visiblePending.every(row => !excluded.includes(row.id))} onChange={event => toggle(visiblePending.map(row => row.id), event.target.checked)}/></th><th>카테고리</th><th>1688 링크</th><th>특징</th><th>키워드</th><th>상태</th><th>관리</th></tr></thead><tbody>
      {visible.map(row => { const index = rows.findIndex(item => item.id === row.id); const productId=intakeProductId(row,jobs); return <tr key={row.id}>
        <td><input type="checkbox" aria-label={`${index + 1}번째 상품 선택`} disabled={busy || row.status === 'saved'} checked={row.status !== 'saved' && !excluded.includes(row.id)} onChange={event => toggle([row.id], event.target.checked)}/></td>
        <td><button type="button" className="intake-category-button" disabled={busy || row.status === 'saved'} onClick={() => setCategoryTarget(row.id)}>{row.profile.categoryPath.join(' > ')}</button><small className="intake-profile-summary">코드 {row.profile.categoryId || '미입력'} · v{row.profile.revision}<br/>{row.profile.template ? `양식: ${row.profile.template.name}` : 'Excel 양식 미연결'}</small><button type="button" className="btn ghost" aria-expanded={previewId === row.id} onClick={() => setPreviewId(previewId === row.id ? null : row.id)}>견적 항목·양식 확인</button></td>
        <td><input ref={element => { if (element) urlInputs.current.set(row.id, element); else urlInputs.current.delete(row.id); }} aria-label={`${index + 1}번째 1688 링크`} value={row.url} maxLength={2048} disabled={busy || row.status === 'saved'} placeholder="https://detail.1688.com/offer/…" onChange={event => edit(row.id, { url: event.target.value })} />{row.url.trim() && <small className="intake-source-url">{row.url.trim()}</small>}</td>
        <td><textarea aria-label={`${index + 1}번째 특징`} value={row.features} maxLength={2000} disabled={busy || row.status === 'saved'} placeholder="상품 특징" onChange={event => edit(row.id, { features: event.target.value })} /></td>
        <td><textarea aria-label={`${index + 1}번째 키워드`} value={row.keywords} maxLength={2000} disabled={busy || row.status === 'saved'} placeholder="타겟 키워드" onChange={event => edit(row.id, { keywords: event.target.value })} /></td>
        <td role="status" className={row.status === 'error' ? 'collection-error' : ''}>{row.message || '입력 대기'}{productId && onOpenProduct && <button type="button" className="btn ghost" disabled={busy} onClick={()=>void openSavedProduct(productId)}>1~7단계 확인·수정</button>}</td>
        <td><button type="button" className="btn ghost" disabled={busy || rows.length >= 50} onClick={() => { const id = crypto.randomUUID(); focusRow.current = id; setQuery(''); onRows(previous => previous.length < 50 ? [...previous, { ...intakeRow(row.profile, id), features: row.features, keywords: row.keywords }] : previous); }}>복제</button><button type="button" className="btn ghost" disabled={busy} onClick={() => onRows(previous => previous.filter(item => item.id !== row.id))}>행 삭제</button></td>
      </tr>; })}
    </tbody></table>{rows.length > 0 && !visible.length && <p className="collection-empty">검색 결과가 없습니다. 검색을 해제하면 입력한 상품을 다시 볼 수 있습니다.</p>}{!rows.length && <p className="collection-empty">대기열이 비어있습니다. [+ 상품 추가] 버튼으로 카테고리를 선택해주세요.</p>}</div>
    {previewRow && <div><button type="button" className="btn ghost" onClick={() => setPreviewId(null)}>견적 연결 미리보기 닫기</button><IntakeQuotationPreview profile={previewRow.profile}/></div>}
    <fieldset className="goal-list" disabled={busy}><legend>어디까지 진행할까요?</legend>{[
      ['collect', '상품추가', '원문·옵션·가격 수집을 요청합니다.'], ['price', 'SEO+가격', '수집 후 번역·가격 단계까지의 작업 목표를 저장합니다.'],
      ['work', '작업개시', '이미지·한글표시사항·견적서까지의 작업 목표를 저장합니다.'], ['transmit', '등록전송', '최종 등록 목표를 저장합니다. 현재 실제 전송은 연결되지 않았습니다.'],
    ].map(([id, title, description]) => <label className="goal-card" key={id}><input type="radio" name="queue-goal" checked={goal === id} onChange={() => onGoal(id)} /><span><strong>{title}</strong><small>{description}</small></span></label>)}</fieldset>
    <p className="collection-notice">{collectionBlock}</p><small>복제는 카테고리·특징·키워드를 복사하며 새 URL을 입력해야 합니다. 행 삭제는 이 입력 목록만 지우며 서버에 저장한 요청을 취소하지 않습니다.</small>
    {selected.some(row => !visible.some(item => item.id === row.id)) && <p className="collection-notice">검색으로 숨겨진 선택 상품도 함께 처리합니다. 선택 {pending}건 중 숨겨진 상품 {selected.filter(row => !visible.some(item => item.id === row.id)).length}건</p>}
    {settingsChanged&&<div className="panel-note"><p>기본설정이 변경돼 남은 상품 처리를 멈췄습니다.</p><button type="button" className="btn ghost" disabled={busy} onClick={()=>void reloadSettings()}>최신 기본설정 불러오기</button></div>}
    {settingsMessage&&<p role="status">{settingsMessage}</p>}
    {error && <p role="alert" className="collection-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="btn ghost" disabled={busy || rows.length >= 50} onClick={() => setCategoryTarget('new')}>＋ 상품 추가</button><button type="button" className="btn primary" disabled={busy || !pending || settingsChanged} onClick={() => void submit()}>{busy ? '요청 저장 중…' : `${pending === pendingRows.length ? '전체' : '선택'} 요청 저장 (${pending}건)`}</button></div>
  </div>;
}
