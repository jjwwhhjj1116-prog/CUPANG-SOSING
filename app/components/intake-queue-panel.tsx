'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CategoryPicker } from '@/app/components/category-picker';
import { intakeProductId, intakeRow, submitIntakeQueue, visibleIntakeRows, type IntakeRow } from '@/app/intake-queue';
import { collectionBlock, parseCollectionRequest, type CollectionJob } from '@/app/sourcing';
import { savedRegistrationSettings, type WorkspaceSettings } from '@/app/workspace-settings';
import { parseWorkspaceSettingsScope, type WorkspaceSettingsScope } from '@/app/workspace-settings-scope';
import type { CategoryProfile } from '@/app/category-profiles';
import type { CategoryAdvancedSeed } from '@/app/category-catalog';
import { collectIntakeProduct } from '@/app/intake-collection';
import { capture1688FromChrome } from '@/app/browser-product-bridge';
import { IntakeQuotationPreview } from '@/app/components/intake-quotation-preview';
import {createIntakeNewDraft,recoverIntakeNewDraft,previewIntakeNewDraft,intakeNewDraftInputKey,IntakeNewDraftSettingsChanged,type IntakeNewDraftPreview,type IntakeNewDraftCreated} from '@/app/intake-new-draft';

export type IntakeSourceSeed={id:string;sourceUrl:string};
export function IntakeQueuePanel({ rows, onRows, profiles, onProfile, onAdvanced, onJobs, onBusy, goal, onGoal, settings, workspaceOwnerId, onSettingsReloadStarted, onSettingsReloaded, jobs = [], onOpenProduct,sourceSeed,onSourceConsumed }: {
  sourceSeed?:IntakeSourceSeed;onSourceConsumed?:(id:string)=>void;
  jobs?:CollectionJob[]; onOpenProduct?:(id:string,signal:AbortSignal)=>Promise<void>;
  workspaceOwnerId?:string; onSettingsReloadStarted?:()=>number;
  settings:WorkspaceSettings; onSettingsReloaded:(settings:WorkspaceSettings,scope?:WorkspaceSettingsScope,epoch?:number)=>void;
  rows: IntakeRow[]; onRows: (update: (rows: IntakeRow[]) => IntakeRow[]) => void;
  profiles: CategoryProfile[]; onProfile: (profile: CategoryProfile) => void;
  onAdvanced: (seed?: CategoryAdvancedSeed) => void; onJobs: (jobs: CollectionJob[]) => void; onBusy: (busy: boolean) => void;
  goal: string; onGoal: (goal: string) => void;
}) {
  const [categoryTarget, setCategoryTarget] = useState<string | null>(sourceSeed?'new':null);
  const pendingSeed=useRef(sourceSeed?.id??null);
  const sourceMounted=useRef(true);
  useEffect(()=>{sourceMounted.current=true;return()=>{sourceMounted.current=false;};},[]);
  const reloadOwnerRef=useRef(workspaceOwnerId);
  useEffect(()=>{reloadOwnerRef.current=workspaceOwnerId;},[workspaceOwnerId]);
  const [query, setQuery] = useState('');
  const [pinnedColumn, setPinnedColumn] = useState('none');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [settingsChanged,setSettingsChanged]=useState(false);
  const [settingsMessage,setSettingsMessage]=useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [forkPreview,setForkPreview]=useState<{rowId:string;inputKey:string;ownerId:string|undefined;preview:IntakeNewDraftPreview;requestId:string;pending:boolean;created?:IntakeNewDraftCreated}|null>(null);
  const previewRow = rows.find(row => row.id === previewId);
  const running = useRef<AbortController | null>(null);
  const forkRunning=useRef<AbortController|null>(null),forkOwner=useRef(workspaceOwnerId);
  const navigation = useRef({rows,jobs,onOpenProduct,workspaceOwnerId,goal,settings});
  useLayoutEffect(()=>{navigation.current={rows,jobs,onOpenProduct,workspaceOwnerId,goal,settings};},[rows,jobs,onOpenProduct,workspaceOwnerId,goal,settings]);
  useLayoutEffect(()=>{if(forkOwner.current===workspaceOwnerId)return;forkOwner.current=workspaceOwnerId;setForkPreview(null);const controller=forkRunning.current;if(!controller)return;forkRunning.current=null;controller.abort();if(running.current===controller){running.current=null;setBusy(false);onBusy(false);}},[workspaceOwnerId,onBusy]);
  const focusRow = useRef<string | null>(null);
  const urlInputs = useRef(new Map<string, HTMLInputElement>());
  useEffect(() => {
    if (categoryTarget || busy || !focusRow.current) return;
    const input = urlInputs.current.get(focusRow.current);
    if (input) { input.focus(); input.scrollIntoView({ block: 'nearest', inline: 'nearest' }); focusRow.current = null; }
  }, [rows, categoryTarget, busy]);
  useEffect(() => () => {
    const controller = running.current;
    if (!controller) return;
    running.current = null;
    controller.abort();
    onBusy(false);
  }, []);
  function finish(controller: AbortController) {
    // A closed queue may already have released its parent lock. A late result
    // must not unlock another operation started since then.
    if (running.current !== controller) return;
    if(forkRunning.current===controller)forkRunning.current=null;
    running.current = null;
    onBusy(false);
    if (!controller.signal.aborted) setBusy(false);
  }
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
    if(forkPreview?.rowId===id)setForkPreview(null);
    const update=(previous:IntakeRow[])=>previous.map(row => row.id === id ? { ...row, ...patch, status: 'draft' as const, message: '', productId: undefined,forkJobId:undefined } : row);
    navigation.current.rows=update(navigation.current.rows);
    onRows(update);
  }
  function removeRow(id:string){
    if(running.current)return;
    if(forkPreview?.rowId===id)setForkPreview(null);
    const update=(previous:IntakeRow[])=>previous.filter(row=>row.id!==id);
    navigation.current.rows=update(navigation.current.rows);onRows(update);
  }
  async function openSavedProduct(rowId:string,id:string) {
    const current=navigation.current,row=current.rows.find(value=>value.id===rowId);
    if(!sourceMounted.current||reloadOwnerRef.current!==workspaceOwnerId||running.current||!current.onOpenProduct||!row||intakeProductId(row,current.jobs)!==id)return;
    const controller=new AbortController();running.current=controller;setBusy(true);onBusy(true);setError('');
    try { await current.onOpenProduct(id,controller.signal); }
    catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'저장된 상품을 열지 못했습니다. 다시 시도해주세요.');}
    finally { finish(controller); }
  }
  async function reloadSettings() {
    if(!sourceMounted.current||reloadOwnerRef.current!==workspaceOwnerId||running.current)return;
    const controller=new AbortController();running.current=controller;setBusy(true);onBusy(true);setError('');setSettingsMessage('');
    try {
      const epoch=onSettingsReloadStarted?.();
      if(onSettingsReloadStarted&&(!Number.isSafeInteger(epoch)||(epoch??-1)<0))throw Error('현재 기본설정 조회 작업을 확인하지 못했습니다. 입력은 유지됩니다.');
      const response=await fetch('/api/settings',{cache:'no-store',signal:controller.signal});
      const body:unknown=await response.json();
      if(controller.signal.aborted||!sourceMounted.current||running.current!==controller)return;
      if(reloadOwnerRef.current!==workspaceOwnerId)throw Error('로그인 계정이 변경되었습니다. 상품 대기열을 다시 열어주세요.');
      if(!response.ok||!body||typeof body!=='object'||!Object.hasOwn(body,'settings'))throw Error('최신 기본설정을 불러오지 못했습니다. 입력은 유지됩니다.');
      const scope=parseWorkspaceSettingsScope((body as {scope?:unknown}).scope);
      if(workspaceOwnerId&&scope?.ownerId!==workspaceOwnerId)throw Error('기본설정을 조회한 로그인 계정이 다릅니다. 상품 대기열을 다시 열어주세요.');
      if(Object.hasOwn(body,'scope')&&!scope)throw Error('기본설정의 계정 정보를 확인하지 못했습니다. 입력은 유지됩니다.');
      const settings=savedRegistrationSettings((body as {settings:unknown}).settings);
      onSettingsReloaded(settings,scope??undefined,epoch);setSettingsChanged(false);setSettingsMessage('최신 기본설정을 불러왔습니다. URL·카테고리와 처리할 상품 선택은 유지됩니다. 시작을 누르면 남은 상품을 처리합니다.');
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'기본설정 조회 실패');}
    finally { finish(controller); }
  }
  async function submit() {
    if (running.current || !pending || settingsChanged) return;
    const controller = new AbortController(); running.current = controller; setBusy(true); onBusy(true); setError('');
    const productIds = new Map<string,string>();
    const completed = new Set<string>();
    const active=()=>running.current===controller&&!controller.signal.aborted;
    const publishJobs=(values:CollectionJob[])=>{if(active())onJobs(values);};
    try {
      await submitIntakeQueue(rows, goal, { signal: controller.signal, fetcher: fetch, expectedSettings:settings, onSettingsChanged:()=>{if(active()){setSettingsChanged(true);setSettingsMessage('');}}, selectedIds: new Set(selected.map(row => row.id)),
        collect: (job,onProgress,onProduct) => collectIntakeProduct(job,{signal:controller.signal,fetcher:fetch,captureFromBrowser:capture1688FromChrome,onJob:updated=>{if(!active())return;publishJobs([updated]);if(updated.product_id)onProduct(updated.product_id);},onProgress}),
        onRow: (id, patch) => {if(!active())return;if(patch.productId)productIds.set(id,patch.productId);if(patch.status==='saved')completed.add(id);onRows(previous => previous.map(row => row.id === id ? { ...row, ...patch } : row));}, onJobs:publishJobs });
      // Open a confirmed single source draft after import and draft processing.
      // A saved Google failure may require manual translation; failed imports
      // and uncertain saves remain in the editable queue.
      const single=selected.length===1?selected[0]:undefined;
      const productId=single&&completed.has(single.id)?productIds.get(single.id):undefined;
      if(productId&&onOpenProduct&&active())await onOpenProduct(productId,controller.signal);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '입력 내용을 확인해주세요.'); }
    finally { finish(controller); }
  }
  async function inspectNewDraft(rowId:string){
    const current=navigation.current,row=current.rows.find(value=>value.id===rowId);
    if(!sourceMounted.current||running.current||!row?.forkJobId||current.workspaceOwnerId!==workspaceOwnerId||settingsChanged)return;
    const controller=new AbortController();running.current=controller;forkRunning.current=controller;setBusy(true);onBusy(true);setError('');setForkPreview(null);
    const inputKey=intakeNewDraftInputKey(row,current.goal,current.settings),ownerId=current.workspaceOwnerId;
    try{
      const preview=await previewIntakeNewDraft(row,current.goal,current.settings,controller.signal);
      const latest=navigation.current,updated=latest.rows.find(value=>value.id===rowId);
      if(controller.signal.aborted||!sourceMounted.current||running.current!==controller)return;
      if(latest.workspaceOwnerId!==ownerId||!updated||intakeNewDraftInputKey(updated,latest.goal,latest.settings)!==inputKey)throw Error('확인 중 입력이나 로그인 계정이 변경되었습니다. 새 초안을 다시 확인해주세요.');
      setForkPreview({rowId,inputKey,ownerId,preview,requestId:crypto.randomUUID(),pending:false});
    }catch(cause){if(!controller.signal.aborted){if(cause instanceof IntakeNewDraftSettingsChanged)setSettingsChanged(true);setError(cause instanceof Error?cause.message:'저장된 원문을 확인하지 못했습니다.');}}
    finally{finish(controller);}
  }
  async function makeNewDraft(){
    const confirmed=forkPreview,current=navigation.current,row=confirmed&&current.rows.find(value=>value.id===confirmed.rowId);
    if(!confirmed||running.current||!sourceMounted.current||!row||current.workspaceOwnerId!==confirmed.ownerId)return;
    if(intakeNewDraftInputKey({...row,forkJobId:confirmed.preview.source.jobId},current.goal,current.settings)!==confirmed.inputKey){setForkPreview(null);setError('입력이 변경되었습니다. 새 초안을 다시 확인해주세요.');return;}
    const controller=new AbortController();running.current=controller;forkRunning.current=controller;setBusy(true);onBusy(true);setError('');
    const active=()=>running.current===controller&&!controller.signal.aborted&&sourceMounted.current&&navigation.current.workspaceOwnerId===confirmed.ownerId;
    let created=confirmed.created;
    try{
      if(!created){
        setForkPreview({...confirmed,pending:true});
        created=confirmed.pending?await recoverIntakeNewDraft(confirmed.preview,confirmed.requestId,controller.signal):await createIntakeNewDraft(confirmed.preview,confirmed.requestId,controller.signal);
        if(!active())return;setForkPreview({...confirmed,pending:false,created});
      }
      if(!active())return;
      const createdProduct=created.productId;
      onJobs([created.job]);
      onRows(previous=>previous.map(value=>value.id===confirmed.rowId?{...value,status:'draft',message:'새 초안 저장됨 · 1~7단계 작성 중',productId:createdProduct,forkJobId:undefined}:value));
      const message=await collectIntakeProduct(created.job,{signal:controller.signal,fetcher:fetch,captureFromBrowser:capture1688FromChrome,
        onJob:job=>{if(active())onJobs([job]);},onProgress:message=>{if(active())onRows(previous=>previous.map(value=>value.id===confirmed.rowId?{...value,message}:value));}});
      if(!active())return;if(!message)throw Error('새 초안 작성 결과를 확인하지 못했습니다.');
      onRows(previous=>previous.map(value=>value.id===confirmed.rowId?{...value,status:'saved',message,productId:createdProduct,forkJobId:undefined}:value));setForkPreview(null);
      if(navigation.current.onOpenProduct&&active())await navigation.current.onOpenProduct(createdProduct,controller.signal);
    }catch(cause){
      if(active()){
        const message=cause instanceof Error?cause.message:'새 초안 결과를 확인하지 못했습니다.';
        setError(created?`새 상품 초안은 저장됐습니다. 작성 결과를 확인한 뒤 다시 이어가세요. ${message}`:`새 초안 생성 결과를 확인해주세요. 같은 요청의 결과 조회만 진행합니다. ${message}`);
        if(created)onRows(previous=>previous.map(value=>value.id===confirmed.rowId?{...value,status:'error',message,productId:created!.productId,forkJobId:undefined}:value));
      }
    }finally{finish(controller);}
  }
  function cancelCategory(){
    const id=pendingSeed.current;pendingSeed.current=null;
    if(id)onSourceConsumed?.(id);
    setCategoryTarget(null);
  }
  if (categoryTarget) return <div className="intake-category-dialog" role="dialog" aria-label="카테고리 선택"><header><h3>카테고리 선택</h3><button type="button" className="icon-close" aria-label="카테고리 선택 취소" onClick={cancelCategory}>×</button></header>{error&&<p role="alert">{error}</p>}<CategoryPicker workspaceOwnerId={workspaceOwnerId} profiles={profiles} selectedId={rows.find(row => row.id === categoryTarget)?.profile.id ?? ''} onAdvanced={onAdvanced} onSelected={profile => {
    if(!sourceMounted.current)return;
    if(sourceSeed&&categoryTarget==='new'&&pendingSeed.current!==sourceSeed.id)return;
    if (categoryTarget === 'new') {
      if(rows.length>=50){setError('상품 대기열은 최대 50행입니다. 기존 입력을 정리한 뒤 상품을 추가해주세요.');return;}
      let sourceUrl='';
      if(sourceSeed&&pendingSeed.current===sourceSeed.id){
        try{[sourceUrl]=parseCollectionRequest({urls:[sourceSeed.sourceUrl],goal:'collect'}).map(value=>value.sourceUrl);}
        catch{setError('보관된 1688 URL을 확인해주세요. 기존 입력은 유지했습니다.');return;}
      }
      const id = crypto.randomUUID(); focusRow.current = id;
      onRows(previous => previous.length < 50 ? [...previous,{...intakeRow(profile,id),url:sourceUrl}] : previous);
      const seedId=pendingSeed.current;pendingSeed.current=null;if(seedId)onSourceConsumed?.(seedId);
    } else { focusRow.current = categoryTarget; edit(categoryTarget, { profile }); }
    onProfile(profile);
    setQuery('');
    setCategoryTarget(null);
  }} /><footer><button type="button" className="btn ghost" onClick={cancelCategory}>취소 · 상품 대기열로 돌아가기</button></footer></div>;
  return <div className="modal-form intake-queue">
    <div className="intake-queue-tools"><label>검색<input type="search" aria-label="상품 대기열 검색" placeholder="카테고리 · 1688 URL · 특징 · 키워드" value={query} disabled={busy} onChange={event => setQuery(event.target.value)}/></label><label className="intake-pin-control"><select aria-label="상품 대기열 고정할 열 선택" value={pinnedColumn} onChange={event => setPinnedColumn(event.target.value)}><option value="none">고정할 열 선택</option><option value="category">카테고리</option><option value="url">1688 링크</option><option value="features">특징</option><option value="keywords">키워드</option><option value="status">상태</option></select></label><span>전체 {rows.length}건 · 선택 {pending}건</span>{query && <button type="button" className="btn ghost" disabled={busy} onClick={() => setQuery('')}>검색 해제</button>}</div>
    <div className="intake-queue-table" data-pinned={pinnedColumn} role="region" aria-label="상품 대기열 표" tabIndex={0}><table><thead><tr><th><input type="checkbox" aria-label="검색 결과 전체 선택" disabled={busy || !visiblePending.length} checked={visiblePending.length > 0 && visiblePending.every(row => !excluded.includes(row.id))} onChange={event => toggle(visiblePending.map(row => row.id), event.target.checked)}/></th><th>카테고리</th><th>1688 링크</th><th>특징</th><th>키워드</th><th>상태</th><th>관리</th></tr></thead><tbody>
      {visible.map(row => { const index = rows.findIndex(item => item.id === row.id); const productId=intakeProductId(row,jobs); return <tr key={row.id}>
        <td><input type="checkbox" aria-label={`${index + 1}번째 상품 선택`} disabled={busy || row.status === 'saved'} checked={row.status !== 'saved' && !excluded.includes(row.id)} onChange={event => toggle([row.id], event.target.checked)}/></td>
        <td><button type="button" className="intake-category-button" disabled={busy || row.status === 'saved'} onClick={() => setCategoryTarget(row.id)}>{row.profile.categoryPath.join(' > ')}</button><small className="intake-profile-summary">코드 {row.profile.categoryId || '미입력'} · v{row.profile.revision}<br/>{row.profile.template ? `양식: ${row.profile.template.name}` : 'Excel 양식 미연결'}</small><button type="button" className="btn ghost" aria-expanded={previewId === row.id} onClick={() => setPreviewId(previewId === row.id ? null : row.id)}>견적 항목·양식 확인</button></td>
        <td><input ref={element => { if (element) urlInputs.current.set(row.id, element); else urlInputs.current.delete(row.id); }} aria-label={`${index + 1}번째 1688 링크`} value={row.url} maxLength={2048} disabled={busy || row.status === 'saved'} placeholder="https://detail.1688.com/offer/…" onChange={event => edit(row.id, { url: event.target.value })} />{row.url.trim() && <small className="intake-source-url">{row.url.trim()}</small>}</td>
        <td><textarea aria-label={`${index + 1}번째 특징`} value={row.features} maxLength={2000} disabled={busy || row.status === 'saved'} placeholder="상품 특징" onChange={event => edit(row.id, { features: event.target.value })} /></td>
        <td><textarea aria-label={`${index + 1}번째 키워드`} value={row.keywords} maxLength={2000} disabled={busy || row.status === 'saved'} placeholder="타겟 키워드" onChange={event => edit(row.id, { keywords: event.target.value })} /></td>
        <td role="status" className={row.status === 'error' ? 'collection-error' : ''}>{row.message || '입력 대기'}{productId && onOpenProduct && <button type="button" className="btn ghost" disabled={busy} onClick={()=>void openSavedProduct(row.id,productId)}>1~7단계 확인·수정</button>}{row.status==='error'&&row.forkJobId&&row.profile.template&&<button type="button" className="btn ghost" disabled={busy||settingsChanged} onClick={()=>void inspectNewDraft(row.id)}>저장 원문으로 새 초안</button>}</td>
        <td><button type="button" className="btn ghost" disabled={busy || rows.length >= 50} onClick={() => { const id = crypto.randomUUID(); focusRow.current = id; setQuery(''); onRows(previous => previous.length < 50 ? [...previous, { ...intakeRow(row.profile, id), features: row.features, keywords: row.keywords }] : previous); }}>복제</button><button type="button" className="btn ghost" disabled={busy} onClick={() => removeRow(row.id)}>행 삭제</button></td>
      </tr>; })}
    </tbody></table>{rows.length > 0 && !visible.length && <p className="collection-empty">검색 결과가 없습니다. 검색을 해제하면 입력한 상품을 다시 볼 수 있습니다.</p>}{!rows.length && <p className="collection-empty">대기열이 비어있습니다. [+ 상품 추가] 버튼으로 카테고리를 선택해주세요.</p>}</div>
    {previewRow && <div><button type="button" className="btn ghost" onClick={() => setPreviewId(null)}>견적 연결 미리보기 닫기</button><IntakeQuotationPreview profile={previewRow.profile}/></div>}
    {forkPreview&&<section role="dialog" aria-label="저장 원문으로 새 초안" className="panel-note"><h3>저장 원문으로 새 초안</h3>
      <p>{forkPreview.preview.source.company.name} · {forkPreview.preview.target.categoryPath.join(' > ')} · 코드 {forkPreview.preview.target.categoryId}</p>
      <p>원문 수집 시각: {forkPreview.preview.source.collectedAt}</p><p>선택한 카테고리와 현재 기본설정으로 별도 상품을 작성합니다. 기존 상품의 수정 내용과 전송 기록은 보존합니다.</p>
      {forkPreview.preview.warnings.map((warning,index)=><p key={index}>{warning}</p>)}
      <button type="button" className="btn primary" disabled={busy} onClick={()=>void makeNewDraft()}>{forkPreview.created?'새 초안 작성 이어가기':forkPreview.pending?'새 초안 저장 결과 확인':'새 초안 생성'}</button>
      <button type="button" className="btn ghost" disabled={busy} onClick={()=>setForkPreview(null)}>닫기</button>
    </section>}
    <fieldset className="goal-list" disabled={busy}><legend>상품 초안 작성</legend>{[
      ['price', 'SEO·가격 초안 작성', '상품정보를 가져와 초안을 작성합니다. 저장 후 1~7단계에서 확인·수정하세요.'],
      ['work', 'SEO·가격 + 이미지 초안', '원본을 대표·추가·상세·옵션 이미지에 배치합니다. 번역·편집 후 확인하세요.'],
      ['collect', '상품정보만 가져오기', '원문·옵션·가격을 가져오고 SEO 작성은 나중에 진행합니다.'],
    ].map(([id, title, description]) => <label className="goal-card" key={id}><input type="radio" name="queue-goal" checked={(goal==='collect'?'collect':goal==='work'?'work':'price') === id} onChange={() => onGoal(id)} /><span><strong>{title}</strong><small>{description}</small></span></label>)}</fieldset>
    <p className="collection-notice">{collectionBlock} <a href="/downloads/yoofam-plus-supplier-hub-extension-0.2.64.zip" download>상품 수집·전송 확장 0.2.64 다운로드</a></p><small>복제는 카테고리·특징·키워드를 복사하며 새 URL을 입력해야 합니다. 행 삭제는 이 입력 목록만 지우며 서버에 저장한 요청을 취소하지 않습니다.</small>
    {selected.some(row => !visible.some(item => item.id === row.id)) && <p className="collection-notice">검색으로 숨겨진 선택 상품도 함께 처리합니다. 선택 {pending}건 중 숨겨진 상품 {selected.filter(row => !visible.some(item => item.id === row.id)).length}건</p>}
    {settingsChanged&&<div className="panel-note"><p>기본설정이 변경돼 남은 상품 처리를 멈췄습니다.</p><button type="button" className="btn ghost" disabled={busy} onClick={()=>void reloadSettings()}>최신 기본설정 불러오기</button></div>}
    {settingsMessage&&<p role="status">{settingsMessage}</p>}
    {error && <p role="alert" className="collection-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="btn ghost" disabled={busy || rows.length >= 50} onClick={() => setCategoryTarget('new')}>＋ 상품 추가</button><button type="button" className="btn primary" disabled={busy || !pending || settingsChanged} onClick={() => void submit()}>{busy ? '상품정보 가져오는 중…' : `${pending === pendingRows.length ? '전체' : '선택'} 시작 (${pending}건)`}</button></div>
  </div>;
}
