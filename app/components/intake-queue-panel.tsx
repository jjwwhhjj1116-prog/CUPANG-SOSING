'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CategoryPicker } from '@/app/components/category-picker';
import { intakeProductId, intakeRow, intakeRowsForCollection, submitIntakeQueue, visibleIntakeRows, type IntakeRow } from '@/app/intake-queue';
import { collectionBlock, parseCollectionRequest, type CollectionJob } from '@/app/sourcing';
import { savedRegistrationSettings, type WorkspaceSettings } from '@/app/workspace-settings';
import { parseWorkspaceSettingsScope, type WorkspaceSettingsScope } from '@/app/workspace-settings-scope';
import type { CategoryProfile } from '@/app/category-profiles';
import type { CategoryAdvancedSeed } from '@/app/category-catalog';
import { collectIntakeProduct } from '@/app/intake-collection';
import { capture1688FromChrome, probe1688FromChrome } from '@/app/browser-product-bridge';
import { IntakeQuotationPreview } from '@/app/components/intake-quotation-preview';
import {createIntakeNewDraft,recoverIntakeNewDraft,previewIntakeNewDraft,intakeNewDraftInputKey,IntakeNewDraftSettingsChanged,IntakeNewDraftSourceUrlsAvailable,type IntakeNewDraftPreview,type IntakeNewDraftCreated} from '@/app/intake-new-draft';
import {sameSourceUrl} from '@/app/source-registration';
import {previewPendingIntakeSource,preparePendingIntakeSource,type PendingIntakeSourcePreview} from '@/app/intake-pending-source';
import {validateSourceCaptureSelection,sourceCaptureAfterUrlEdit,selectedSourceInboxItem,sameSourceCaptureSelection,type SourceCaptureSelection} from '@/app/source-capture-selection';
import { CollectionResultPanel } from '@/app/components/collection-result-panel';

/** Recovery is limited to one newly collected query row and its exact saved link. */
export function intakeQueryImageRecoveryJob(row:IntakeRow,jobs:readonly CollectionJob[]):CollectionJob|null{
  if(row.status!=='error'||!row.productId||row.forkJobId||row.pendingJobId||row.sourceCapture?.format!=='yoofam-saved-query-capture-v1')return null;
  try{
    const capture=validateSourceCaptureSelection(row.sourceCapture,row.url);
    const matches=jobs.filter(job=>!!job.id&&job.status!=='cancelled'&&job.product_id===row.productId&&job.source_url===capture.sourceUrl&&!!job.received_at&&Number.isFinite(Date.parse(job.received_at)));
    return matches.length===1?matches[0]:null;
  }catch{return null;}
}

export type IntakeSourceSeed={id:string;sourceUrl:string;title?:string;sourceCapture?:Readonly<SourceCaptureSelection>;forkJobId?:string};
const freshCaptureFork=(row:IntakeRow)=>Boolean(row.forkJobId&&row.sourceCapture);
const freshCaptureMessage='선택한 새 수집본을 별도 상품으로 작성합니다. 기존 작업 상품은 유지됩니다. 새 초안을 확인해주세요.';
type IntakeCategorySelection={target:string;ownerId:string|undefined;epoch:number;completed:boolean;seed?:IntakeSourceSeed};
export function IntakeQueuePanel({ rows, onRows, profiles, onProfile, onAdvanced, onJobs, onBusy, goal, onGoal, settings, workspaceOwnerId, onSettingsReloadStarted, onSettingsReloaded, jobs = [], onOpenProduct,sourceSeed,onSourceConsumed,sourceItems=[],onReviewSource }: {
  sourceItems?:import('@/app/source-inbox').SourceInboxItem[];onReviewSource?:(item:import('@/app/source-inbox').SourceInboxItem,rowId:string)=>void;
  sourceSeed?:IntakeSourceSeed;onSourceConsumed?:(id:string)=>void;
  jobs?:CollectionJob[]; onOpenProduct?:(id:string,signal:AbortSignal)=>Promise<void>;
  workspaceOwnerId?:string; onSettingsReloadStarted?:()=>number;
  settings:WorkspaceSettings; onSettingsReloaded:(settings:WorkspaceSettings,scope?:WorkspaceSettingsScope,epoch?:number)=>void;
  rows: IntakeRow[]; onRows: (update: (rows: IntakeRow[]) => IntakeRow[]) => void;
  profiles: CategoryProfile[]; onProfile: (profile: CategoryProfile) => void;
  onAdvanced: (seed?: CategoryAdvancedSeed) => void; onJobs: (jobs: CollectionJob[]) => void; onBusy: (busy: boolean) => void;
  goal: string; onGoal: (goal: string) => void;
}) {
  const categoryEpoch=useRef(0),categoryMounted=useRef(true),categoryOwner=useRef(workspaceOwnerId),categorySource=useRef(sourceSeed);
  const [categorySelection,setCategorySelection]=useState<IntakeCategorySelection|null>(sourceSeed?{target:'new',ownerId:workspaceOwnerId,epoch:0,completed:false,seed:sourceSeed}:null);
  const categorySelectionRef=useRef(categorySelection),categoryTarget=categorySelection?.target??null;
  const pendingSeed=useRef(sourceSeed?.id??null);
  const focusRow = useRef<string | null>(null),busyNotice=useRef(onBusy);
  useLayoutEffect(()=>{
    categoryMounted.current=true;
    const selection=categorySelectionRef.current;
    if(selection&&selection.epoch!==categoryEpoch.current){const resumed={...selection,epoch:categoryEpoch.current};categorySelectionRef.current=resumed;if(!resumed.completed)setCategorySelection(resumed);}
    // Cleanup invalidates sessions opened after setup; the current epoch is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return()=>{categoryMounted.current=false;categoryEpoch.current++;};
  },[]);
  useLayoutEffect(()=>{
    categorySource.current=sourceSeed;
    if(categoryOwner.current===workspaceOwnerId)return;
    categoryOwner.current=workspaceOwnerId;categoryEpoch.current++;categorySelectionRef.current=null;pendingSeed.current=null;focusRow.current=null;setCategorySelection(null);
  },[workspaceOwnerId,sourceSeed]);
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
  const [imageRecovery,setImageRecovery]=useState<{row:IntakeRow;job:CollectionJob;ownerId:string|undefined;epoch:number}|null>(null);
  const [forkPreview,setForkPreviewState]=useState<{rowId:string;inputKey:string;ownerId:string|undefined;preview:IntakeNewDraftPreview;requestId:string;pending:boolean;created?:IntakeNewDraftCreated}|null>(null);
  const [pendingPreview,setPendingPreviewState]=useState<{rowId:string;inputKey:string;ownerId:string|undefined;preview:PendingIntakeSourcePreview;pending:boolean}|null>(null);
  const [sourceUrlsCandidate,setSourceUrlsCandidateState]=useState<{rowId:string;inputKey:string;ownerId:string|undefined;candidate:IntakeNewDraftSourceUrlsAvailable['candidate']}|null>(null);
  const [ownerGeneration,setOwnerGeneration]=useState(0),ownerEpoch=useRef(0);
  const forkPreviewRef=useRef<typeof forkPreview>(null),pendingPreviewRef=useRef<typeof pendingPreview>(null),sourceUrlsCandidateRef=useRef<typeof sourceUrlsCandidate>(null);
  function setForkPreview(value:typeof forkPreview){forkPreviewRef.current=value;setForkPreviewState(value);}
  function setPendingPreview(value:typeof pendingPreview|((previous:typeof pendingPreview)=>typeof pendingPreview)){const next=typeof value==='function'?value(pendingPreviewRef.current):value;pendingPreviewRef.current=next;setPendingPreviewState(next);}
  function setSourceUrlsCandidate(value:typeof sourceUrlsCandidate){sourceUrlsCandidateRef.current=value;setSourceUrlsCandidateState(value);}
  const previewRow = rows.find(row => row.id === previewId);
  const running = useRef<AbortController | null>(null);
  const forkRunning=useRef<AbortController|null>(null),forkOwner=useRef(workspaceOwnerId);
  const navigation = useRef({rows,jobs,onOpenProduct,workspaceOwnerId,goal,settings,sourceItems});
  useLayoutEffect(()=>{navigation.current={rows,jobs,onOpenProduct,workspaceOwnerId,goal,settings,sourceItems};},[rows,jobs,onOpenProduct,workspaceOwnerId,goal,settings,sourceItems]);
  useLayoutEffect(()=>{if(forkOwner.current===workspaceOwnerId)return;forkOwner.current=workspaceOwnerId;ownerEpoch.current++;setOwnerGeneration(ownerEpoch.current);forkPreviewRef.current=null;pendingPreviewRef.current=null;sourceUrlsCandidateRef.current=null;setForkPreviewState(null);setPendingPreviewState(null);setSourceUrlsCandidateState(null);const controller=running.current;forkRunning.current=null;if(!controller)return;running.current=null;controller.abort();setBusy(false);onBusy(false);},[workspaceOwnerId,onBusy]);
  const sameOwner=()=>forkOwner.current===workspaceOwnerId&&navigation.current.workspaceOwnerId===workspaceOwnerId&&ownerEpoch.current===ownerGeneration;
  const ownerCurrent=()=>sourceMounted.current&&sameOwner();
  function imageRecoveryCurrent(value:NonNullable<typeof imageRecovery>){
    if(!ownerCurrent()||value.ownerId!==navigation.current.workspaceOwnerId||value.epoch!==ownerEpoch.current)return false;
    const row=navigation.current.rows.find(candidate=>candidate.id===value.row.id);
    if(row!==value.row)return false;
    const job=intakeQueryImageRecoveryJob(row,navigation.current.jobs);
    return job===value.job&&job.id===value.job.id&&job.product_id===value.row.productId&&job.source_url===value.job.source_url;
  }
  function openImageRecovery(row:IntakeRow){
    if(!ownerCurrent()||running.current||navigation.current.rows.find(value=>value.id===row.id)!==row)return;
    const job=intakeQueryImageRecoveryJob(row,navigation.current.jobs);
    if(job)setImageRecovery({row,job,ownerId:workspaceOwnerId,epoch:ownerEpoch.current});
  }
  useLayoutEffect(()=>{busyNotice.current=onBusy;},[onBusy]);
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
    busyNotice.current(false);
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
  const pendingRows = intakeRowsForCollection(rows).filter(row=>!freshCaptureFork(row)),pendingRowIds=new Set(pendingRows.map(row=>row.id));
  const selected = pendingRows.filter(row => !excluded.includes(row.id));
  const pending = selected.length;
  const visiblePending = intakeRowsForCollection(visible).filter(row=>!freshCaptureFork(row)),unfilledRows=rows.filter(row=>row.status!=='saved'&&!freshCaptureFork(row)&&!pendingRowIds.has(row.id));
  function sourceItemForRow(row:IntakeRow|undefined){
    if(!row)return undefined;
    if(row.sourceCapture){try{return selectedSourceInboxItem(sourceItems,row.sourceCapture);}catch{return undefined;}}
    return sourceItems.find(item=>sameSourceUrl(item.snapshot.sourceUrl,row.url));
  }
  function reviewItemForRow(row:IntakeRow){
    const exact=sourceItemForRow(row);
    if(exact)return exact;
    if(!row.sourceCapture)return undefined;
    try{
      const selected=validateSourceCaptureSelection(row.sourceCapture,row.url);
      // Keep the saved selection pinned. A newer review of this same capture
      // can be opened explicitly, but another capture of its URL cannot.
      return sourceItems.find(item=>item.id===selected.captureId&&item.fingerprint===selected.fingerprint&&item.snapshot.sourceUrl===selected.sourceUrl&&item.revision>selected.revision&&!item.archivedAt&&(!workspaceOwnerId||item.ownerId===workspaceOwnerId));
    }catch{return undefined;}
  }
  function reviewSource(row:IntakeRow,item:import('@/app/source-inbox').SourceInboxItem){
    if(!ownerCurrent()||running.current||navigation.current.rows.find(value=>value.id===row.id)!==row||row.status==='saved'||row.productId||row.forkJobId||row.pendingJobId)return;
    onReviewSource?.(item,row.id);
  }
  function toggle(ids: string[], checked: boolean) {
    if (!ownerCurrent()||running.current) return;
    setExcluded(previous => checked ? previous.filter(id => !ids.includes(id)) : [...new Set([...previous, ...ids])]);
  }
  function edit(id: string, patch: Partial<IntakeRow>) {
    if (!ownerCurrent()||running.current) return;
    if(forkPreview?.rowId===id)setForkPreview(null);
    if(pendingPreview?.rowId===id)setPendingPreview(null);
    if(sourceUrlsCandidate?.rowId===id)setSourceUrlsCandidate(null);
    const update=(previous:IntakeRow[])=>sameOwner()?previous.map(row => {
      if(row.id!==id)return row;
      const next:IntakeRow={ ...row, ...patch, status: 'draft', message: '', productId: undefined,forkJobId:undefined,pendingJobId:undefined,pendingSourceMode:undefined,pendingSourceHash:undefined };
      if(Object.hasOwn(patch,'url')){const selected=sourceCaptureAfterUrlEdit(row.sourceCapture,next.url);if(selected)next.sourceCapture=selected;else delete next.sourceCapture;}
      if(freshCaptureFork(row)&&next.sourceCapture){next.forkJobId=row.forkJobId;next.status='error';next.message=freshCaptureMessage;}
      return next;
    }):previous;
    navigation.current.rows=update(navigation.current.rows);
    onRows(update);
  }
  function removeRow(id:string){
    if(!ownerCurrent()||running.current)return;
    if(categorySelectionRef.current?.target===id){categoryEpoch.current++;categorySelectionRef.current=null;setCategorySelection(null);}
    if(forkPreview?.rowId===id)setForkPreview(null);
    if(pendingPreview?.rowId===id)setPendingPreview(null);
    if(sourceUrlsCandidate?.rowId===id)setSourceUrlsCandidate(null);
    const update=(previous:IntakeRow[])=>sameOwner()?previous.filter(row=>row.id!==id):previous;
    navigation.current.rows=update(navigation.current.rows);onRows(update);
  }
  async function openSavedProduct(rowId:string,id:string) {
    const current=navigation.current,row=current.rows.find(value=>value.id===rowId);
    if(!ownerCurrent()||reloadOwnerRef.current!==workspaceOwnerId||running.current||!current.onOpenProduct||!row||intakeProductId(row,current.jobs)!==id)return;
    const controller=new AbortController();running.current=controller;setBusy(true);onBusy(true);setError('');
    try { await current.onOpenProduct(id,controller.signal); }
    catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'저장된 상품을 열지 못했습니다. 다시 시도해주세요.');}
    finally { finish(controller); }
  }
  async function reloadSettings() {
    if(!ownerCurrent()||reloadOwnerRef.current!==workspaceOwnerId||running.current)return;
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
  async function submit(target?:IntakeRow) {
    const current=navigation.current;
    if (!ownerCurrent()||current.rows!==rows||current.settings!==settings||current.goal!==goal||running.current || settingsChanged) return;
    // A collected item's explicit start does not inherit the batch selection.
    // Retained callbacks must still refer to the current, unlinked input row.
    if(target&&(!target.sourceCapture||current.rows.find(row=>row.id===target.id)!==target||!pendingRowIds.has(target.id)||intakeProductId(target,current.jobs)||target.forkJobId||target.pendingJobId))return;
    const processing=(target?[target]:selected).filter(row=>!freshCaptureFork(row));
    if(!processing.length)return;
    const controller = new AbortController(); running.current = controller; setBusy(true); onBusy(true); setError('');
    const productIds = new Map<string,string>();
    const completed = new Set<string>();
    const reusedProductIds = new Set<string>();
    const active=()=>ownerCurrent()&&running.current===controller&&!controller.signal.aborted;
    const publishJobs=(values:CollectionJob[])=>{if(active())onJobs(values);};
    try {
      const incomplete=processing.map(row=>{
        if(!row.sourceCapture)return sourceItems.find(item=>sameSourceUrl(item.snapshot.sourceUrl,row.url));
        // Server-query captures have their own immutable full-source store.
        // Their exact owner/company/version is resolved on the server; the
        // browser PageSource review list cannot represent this source format.
        if(row.sourceCapture.format==='yoofam-saved-query-capture-v1'){validateSourceCaptureSelection(row.sourceCapture,row.url);return undefined;}
        const item=selectedSourceInboxItem(target?current.sourceItems:sourceItems,row.sourceCapture);
        if(!item||target&&item.archivedAt||workspaceOwnerId&&item.ownerId!==workspaceOwnerId)throw Error('선택한 수집본을 다시 확인해주세요. 같은 URL의 다른 수집본으로 바꾸지 않았습니다.');
        return item;
      }).find(item=>item?.issues.length);
      if(incomplete)throw Error('수집정보 확인·수정에서 '+incomplete.issues.join(' · ')+'을 확인한 뒤 초안을 작성해주세요.');
      await submitIntakeQueue(rows, goal, { signal: controller.signal, fetcher: fetch, expectedSettings:settings, onSettingsChanged:()=>{if(active()){setSettingsChanged(true);setSettingsMessage('');}}, selectedIds: new Set(processing.map(row => row.id)),
        collect: (job,onProgress,onProduct,selectedCapture) => {if(job.product_id)reusedProductIds.add(job.product_id);return collectIntakeProduct(job,{signal:controller.signal,fetcher:fetch,...(selectedCapture?{selectedCapture}:{}),captureFromBrowser:capture1688FromChrome,probeExistingFromBrowser:probe1688FromChrome,onProductReused:id=>{if(active())reusedProductIds.add(id);},onJob:updated=>{if(!active())return;publishJobs([updated]);if(updated.product_id)onProduct(updated.product_id);},onProgress});},
        onRow: (id, patch) => {if(!active())return;if(patch.productId)productIds.set(id,patch.productId);if(patch.status==='saved')completed.add(id);onRows(previous => sameOwner()?previous.map(row => row.id === id ? { ...row, ...patch } : row):previous);}, onJobs:publishJobs });
      // Open a confirmed single source draft after import and draft processing.
      // A saved Google failure may require manual translation; failed imports
      // and uncertain saves remain in the editable queue.
      const single=processing.length===1?processing[0]:undefined;
      const productId=single&&completed.has(single.id)?productIds.get(single.id):undefined;
      if(productId&&onOpenProduct&&active()&&(!target||!reusedProductIds.has(productId)))await onOpenProduct(productId,controller.signal);
    } catch (cause) { if (active()) setError(cause instanceof Error ? cause.message : '입력 내용을 확인해주세요.'); }
    finally { finish(controller); }
  }
  async function inspectNewDraft(rowId:string){
    const current=navigation.current,row=current.rows.find(value=>value.id===rowId);
    if(!ownerCurrent()||running.current||!row?.forkJobId||current.workspaceOwnerId!==workspaceOwnerId||settingsChanged)return;
    const controller=new AbortController();running.current=controller;forkRunning.current=controller;setBusy(true);onBusy(true);setError('');setForkPreview(null);setSourceUrlsCandidate(null);
    const inputKey=intakeNewDraftInputKey(row,current.goal,current.settings),ownerId=current.workspaceOwnerId;
    try{
      const preview=await previewIntakeNewDraft(row,current.goal,current.settings,controller.signal);
      const latest=navigation.current,updated=latest.rows.find(value=>value.id===rowId);
      if(controller.signal.aborted||!sourceMounted.current||running.current!==controller)return;
      if(latest.workspaceOwnerId!==ownerId||!updated||intakeNewDraftInputKey(updated,latest.goal,latest.settings)!==inputKey)throw Error('확인 중 입력이나 로그인 계정이 변경되었습니다. 새 초안을 다시 확인해주세요.');
      setForkPreview({rowId,inputKey,ownerId,preview,requestId:crypto.randomUUID(),pending:false});
    }catch(cause){if(!controller.signal.aborted&&sourceMounted.current&&navigation.current.workspaceOwnerId===ownerId){
      const updated=navigation.current.rows.find(value=>value.id===rowId);
      if(cause instanceof IntakeNewDraftSourceUrlsAvailable&&cause.candidate.jobId===row.forkJobId&&updated&&intakeNewDraftInputKey(updated,navigation.current.goal,navigation.current.settings)===inputKey)setSourceUrlsCandidate({rowId,inputKey,ownerId,candidate:cause.candidate});
      if(cause instanceof IntakeNewDraftSettingsChanged)setSettingsChanged(true);setError(cause instanceof Error?cause.message:'저장된 원문을 확인하지 못했습니다.');}}
    finally{finish(controller);}
  }
  async function inspectSourceUrls(){
    const confirmed=sourceUrlsCandidate,current=navigation.current,row=confirmed&&current.rows.find(value=>value.id===confirmed.rowId);
    if(!confirmed||sourceUrlsCandidateRef.current!==confirmed||running.current||!sourceMounted.current||!row||row.forkJobId!==confirmed.candidate.jobId||current.workspaceOwnerId!==confirmed.ownerId)return;
    if(intakeNewDraftInputKey(row,current.goal,current.settings)!==confirmed.inputKey){setSourceUrlsCandidate(null);setError('입력이 변경되었습니다. 새 초안을 다시 확인해주세요.');return;}
    const controller=new AbortController();running.current=controller;forkRunning.current=controller;setBusy(true);onBusy(true);setError('');
    try{
      const prepared={...row,pendingSourceMode:'pending-source-urls-v1' as const,pendingSourceHash:confirmed.candidate.sourceReceiptHash};
      const preview=await previewIntakeNewDraft(prepared,current.goal,current.settings,controller.signal);
      if(controller.signal.aborted||!sourceMounted.current||running.current!==controller||navigation.current.workspaceOwnerId!==confirmed.ownerId)return;
      const latest=navigation.current,fresh=latest.rows.find(value=>value.id===confirmed.rowId);
      if(!fresh||intakeNewDraftInputKey(fresh,latest.goal,latest.settings)!==confirmed.inputKey||preview.source.productId!==confirmed.candidate.productId||preview.source.productVersion!==confirmed.candidate.productVersion)throw Error('원문 상품이나 현재 입력이 변경되었습니다. 새 초안을 다시 확인해주세요.');
      const update=(rows:IntakeRow[])=>rows.map(value=>value.id===confirmed.rowId?prepared:value);navigation.current.rows=update(navigation.current.rows);onRows(update);setSourceUrlsCandidate(null);
      setForkPreview({rowId:confirmed.rowId,inputKey:intakeNewDraftInputKey(prepared,latest.goal,latest.settings),ownerId:confirmed.ownerId,preview,requestId:crypto.randomUUID(),pending:false});
    }catch(cause){if(!controller.signal.aborted&&sourceMounted.current){setSourceUrlsCandidate(null);setError(cause instanceof Error?cause.message:'원문 URL 연결을 확인하지 못했습니다.');}}
    finally{finish(controller);}
  }
  async function inspectPendingSource(rowId:string){
    const current=navigation.current,row=current.rows.find(value=>value.id===rowId);
    if(!ownerCurrent()||running.current||!row?.pendingJobId||current.workspaceOwnerId!==workspaceOwnerId||settingsChanged)return;
    const controller=new AbortController();running.current=controller;forkRunning.current=controller;setBusy(true);onBusy(true);setError('');setForkPreview(null);setPendingPreview(null);
    try{
      const inputKey=intakeNewDraftInputKey({...row,forkJobId:row.pendingJobId},current.goal,current.settings),ownerId=current.workspaceOwnerId;
      const preview=await previewPendingIntakeSource(row,ownerId,controller.signal);
      const latest=navigation.current,updated=latest.rows.find(value=>value.id===rowId);
      if(controller.signal.aborted||!sourceMounted.current||running.current!==controller)return;
      if(latest.workspaceOwnerId!==ownerId||!updated||updated.pendingJobId!==row.pendingJobId||intakeNewDraftInputKey({...updated,forkJobId:updated.pendingJobId},latest.goal,latest.settings)!==inputKey)throw Error('확인 중 입력이나 로그인 계정이 변경되었습니다. 기존 요청을 다시 확인해주세요.');
      setPendingPreview({rowId,inputKey,ownerId,preview,pending:false});
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'기존 대기 요청을 확인하지 못했습니다.');}
    finally{finish(controller);}
  }
  async function preparePendingSource(){
    const confirmed=pendingPreview,current=navigation.current,row=confirmed&&current.rows.find(value=>value.id===confirmed.rowId);
    if(!confirmed||pendingPreviewRef.current!==confirmed||running.current||!sourceMounted.current||!row||row.pendingJobId!==confirmed.preview.job.id||current.workspaceOwnerId!==confirmed.ownerId)return;
    if(intakeNewDraftInputKey({...row,forkJobId:row.pendingJobId},current.goal,current.settings)!==confirmed.inputKey){setPendingPreview(null);setError('입력이 변경되었습니다. 기존 요청을 다시 확인해주세요.');return;}
    const controller=new AbortController();running.current=controller;forkRunning.current=controller;setBusy(true);onBusy(true);setError('');setPendingPreview({...confirmed,pending:true});
    const active=()=>running.current===controller&&!controller.signal.aborted&&sourceMounted.current&&navigation.current.workspaceOwnerId===confirmed.ownerId;
    try{
      const prepared=await preparePendingIntakeSource(confirmed.preview,row,confirmed.ownerId,controller.signal,{captureFromBrowser:capture1688FromChrome});
      if(!active())return;
      const latest=navigation.current,updated=latest.rows.find(value=>value.id===confirmed.rowId);
      if(!updated||updated.pendingJobId!==confirmed.preview.job.id||intakeNewDraftInputKey({...updated,forkJobId:updated.pendingJobId},latest.goal,latest.settings)!==confirmed.inputKey)throw Error('원문 준비 중 입력이 변경되었습니다. 현재 입력을 유지하고 기존 요청을 다시 확인해주세요.');
      const nextRow={...updated,pendingJobId:undefined,forkJobId:prepared.job.id,pendingSourceMode:'pending-source-urls-v1' as const,pendingSourceHash:prepared.receiptHash??undefined,status:'error' as const,message:'기존 요청과 원문은 보존했습니다. 현재 입력을 적용할 새 초안을 확인해주세요.'};
      const update=(rows:IntakeRow[])=>rows.map(value=>value.id===confirmed.rowId?nextRow:value);
      navigation.current.rows=update(navigation.current.rows);onRows(update);onJobs([prepared.job]);setPendingPreview(null);
      const inputKey=intakeNewDraftInputKey(nextRow,latest.goal,latest.settings);
      const preview=await previewIntakeNewDraft(nextRow,latest.goal,latest.settings,controller.signal);
      if(!active())return;
      const newest=navigation.current,fresh=newest.rows.find(value=>value.id===confirmed.rowId);
      if(!fresh||intakeNewDraftInputKey(fresh,newest.goal,newest.settings)!==inputKey)throw Error('입력이 변경되었습니다. 새 초안을 다시 확인해주세요.');
      setForkPreview({rowId:confirmed.rowId,inputKey,ownerId:confirmed.ownerId,preview,requestId:crypto.randomUUID(),pending:false});
    }catch(cause){if(active()){if(cause instanceof IntakeNewDraftSettingsChanged)setSettingsChanged(true);setPendingPreview(previous=>previous?{...previous,pending:false}:null);setError(cause instanceof Error?cause.message:'원문 준비를 확인하지 못했습니다. 기존 요청과 현재 입력은 유지됩니다.');}}
    finally{finish(controller);}
  }
  async function makeNewDraft(){
    const confirmed=forkPreview,current=navigation.current,row=confirmed&&current.rows.find(value=>value.id===confirmed.rowId);
    if(!confirmed||forkPreviewRef.current!==confirmed||running.current||!sourceMounted.current||!row||current.workspaceOwnerId!==confirmed.ownerId)return;
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
      onRows(previous=>previous.map(value=>value.id===confirmed.rowId?{...value,status:'draft',message:'새 초안 저장됨 · 등록 단계 작성 중',productId:createdProduct,forkJobId:undefined}:value));
      const message=await collectIntakeProduct(created.job,{signal:controller.signal,fetcher:fetch,captureFromBrowser:capture1688FromChrome,probeExistingFromBrowser:probe1688FromChrome,
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
  function categoryCurrent(selection:IntakeCategorySelection|null,completed=false){
    return !!selection&&categoryMounted.current&&ownerCurrent()&&categoryOwner.current===selection.ownerId
      &&categorySelectionRef.current===selection&&categoryEpoch.current===selection.epoch&&(completed||!selection.completed);
  }
  function openCategory(target:string){
    if(!ownerCurrent()||!categoryMounted.current||running.current)return;
    if(target!=='new'&&!navigation.current.rows.some(row=>row.id===target&&row.status!=='saved'))return;
    const seed=target==='new'&&categorySource.current?.id===pendingSeed.current?categorySource.current:undefined;
    const selection={target,ownerId:workspaceOwnerId,epoch:++categoryEpoch.current,completed:false,seed};
    categorySelectionRef.current=selection;setCategorySelection(selection);
  }
  function cancelCategory(selection:IntakeCategorySelection|null){
    if(!categoryCurrent(selection))return;
    categoryEpoch.current++;categorySelectionRef.current=null;setCategorySelection(null);
    const id=pendingSeed.current;pendingSeed.current=null;
    if(id)onSourceConsumed?.(id);
  }
  function selectCategory(selection:IntakeCategorySelection,profile:CategoryProfile){
    if(!categoryCurrent(selection)||running.current)return;
    if(selection.seed&&(pendingSeed.current!==selection.seed.id||categorySource.current?.id!==selection.seed.id||categorySource.current.sourceUrl!==selection.seed.sourceUrl))return;
    if(selection.seed&&(selection.seed.sourceCapture!==undefined||categorySource.current?.sourceCapture!==undefined)
      &&!sameSourceCaptureSelection(selection.seed.sourceCapture,categorySource.current?.sourceCapture))return;
    if(selection.seed&&selection.seed.forkJobId!==categorySource.current?.forkJobId)return;
    const target=selection.target,currentRows=navigation.current.rows;
    if(target==='new'&&currentRows.length>=50){setError('상품 대기열은 최대 50행입니다. 기존 입력을 정리한 뒤 상품을 추가해주세요.');return;}
    if(target!=='new'&&!currentRows.some(row=>row.id===target&&row.status!=='saved'))return;
    let sourceUrl='';let sourceCapture:Readonly<SourceCaptureSelection>|undefined;let forkJobId:string|undefined;
    if(selection.seed){
      try{[sourceUrl]=parseCollectionRequest({urls:[selection.seed.sourceUrl],goal:'collect'}).map(value=>value.sourceUrl);if(selection.seed.sourceCapture!==undefined)sourceCapture=validateSourceCaptureSelection(selection.seed.sourceCapture,sourceUrl);
        if(selection.seed.forkJobId!==undefined){if(!/^[a-f0-9-]{36}$/u.test(selection.seed.forkJobId)||sourceCapture?.format!=='yoofam-saved-page-capture-v1')throw Error();forkJobId=selection.seed.forkJobId;}}
      catch{setError('보관된 1688 URL을 확인해주세요. 기존 입력은 유지했습니다.');return;}
    }
    const id=target==='new'?crypto.randomUUID():target;
    selection.completed=true;
    // The real draft wrapper applies synchronously. A delayed updater still
    // belongs to this completed selection until another session or owner wins.
    const update=(previous:IntakeRow[])=>{
      if(!categoryCurrent(selection,true))return previous;
      if(target==='new')return previous.length<50&&!previous.some(row=>row.id===id)?[...previous,{...intakeRow(profile,id),url:sourceUrl,...(sourceCapture?{sourceCapture}:{}),...(forkJobId?{forkJobId,status:'error' as const,message:freshCaptureMessage}:{})}]:previous;
      return previous.map(row=>row.id===target&&row.status!=='saved'?{...row,profile,status:freshCaptureFork(row)?'error' as const:'draft' as const,message:freshCaptureFork(row)?freshCaptureMessage:'',productId:undefined,forkJobId:freshCaptureFork(row)?row.forkJobId:undefined,pendingJobId:undefined,pendingSourceMode:undefined,pendingSourceHash:undefined}:row);
    };
    if(forkPreviewRef.current?.rowId===target)setForkPreview(null);
    if(pendingPreviewRef.current?.rowId===target)setPendingPreview(null);
    if(sourceUrlsCandidateRef.current?.rowId===target)setSourceUrlsCandidate(null);
    navigation.current.rows=update(currentRows);focusRow.current=id;onRows(update);
    if(!categoryCurrent(selection,true))return;
    const seedId=selection.seed?.id;if(seedId){pendingSeed.current=null;onSourceConsumed?.(seedId);}
    if(!categoryCurrent(selection,true))return;
    onProfile(profile);
    if(!categoryCurrent(selection,true))return;
    setQuery('');setCategorySelection(null);
  }
  if (categorySelection) return <div className="intake-category-dialog" role="dialog" aria-label="카테고리 선택"><header><h3>카테고리 선택</h3><button type="button" className="icon-close" aria-label="카테고리 선택 취소" onClick={()=>cancelCategory(categorySelection)}>×</button></header>{error&&<p role="alert">{error}</p>}<CategoryPicker key={categorySelection.seed?.id} sourceTitle={categorySelection.seed?.title??sourceItemForRow(rows.find(row=>row.id===categorySelection.target))?.reviewed?.title??sourceItemForRow(rows.find(row=>row.id===categorySelection.target))?.snapshot.title} workspaceOwnerId={workspaceOwnerId} profiles={profiles} selectedId={rows.find(row => row.id === categorySelection.target)?.profile.id ?? ''} onAdvanced={seed=>{if(!categoryCurrent(categorySelection))return;categoryEpoch.current++;categorySelectionRef.current=null;setCategorySelection(null);onAdvanced(seed);}} onSelected={profile=>selectCategory(categorySelection,profile)}/><footer><button type="button" className="btn ghost" onClick={()=>cancelCategory(categorySelection)}>취소 · 상품 대기열로 돌아가기</button></footer></div>;
  if(imageRecovery&&imageRecovery.ownerId===workspaceOwnerId&&imageRecovery.epoch===ownerGeneration&&rows.includes(imageRecovery.row)&&intakeQueryImageRecoveryJob(imageRecovery.row,jobs)===imageRecovery.job)return <section role="dialog" aria-label="누락 원본 이미지 이어받기" className="panel-note"><h3>누락 원본 이미지 이어받기</h3><p>이 초안에서 저장하지 못한 원본만 이어서 가져옵니다. 직접 수정한 SEO·대표·상세 이미지 배치는 유지됩니다.</p><CollectionResultPanel jobId={imageRecovery.job.id} offerId={imageRecovery.job.offer_id} productId={imageRecovery.row.productId} expectedProductId={imageRecovery.row.productId} assignToStage={false} isCurrent={()=>imageRecoveryCurrent(imageRecovery)} onSaved={outcome=>{
    if(!outcome||outcome.status!=='completed'||outcome.productId!==imageRecovery.row.productId||!imageRecoveryCurrent(imageRecovery))return;
    const rowId=imageRecovery.row.id;
    onRows(previous=>imageRecoveryCurrent(imageRecovery)?previous.map(row=>row.id===rowId?{...row,message:'누락 원본 이미지를 저장했습니다. 다른 미완료 단계는 초안 확인·수정에서 이어가세요.'}:row):previous);
    setImageRecovery(null);
  }}/><button type="button" className="btn ghost" onClick={()=>setImageRecovery(null)}>닫기 · 상품 대기열로 돌아가기</button></section>;
  return <div className="modal-form intake-queue">
    <div className="intake-queue-tools"><label>검색<input type="search" aria-label="상품 대기열 검색" placeholder="카테고리 · 1688 URL · 특징 · 키워드" value={query} disabled={busy} onChange={event => setQuery(event.target.value)}/></label><label className="intake-pin-control"><select aria-label="상품 대기열 고정할 열 선택" value={pinnedColumn} onChange={event => setPinnedColumn(event.target.value)}><option value="none">고정할 열 선택</option><option value="category">카테고리</option><option value="url">1688 링크</option><option value="features">특징</option><option value="keywords">키워드</option><option value="status">상태</option></select></label><span>전체 {rows.length}건 · 선택 {pending}건</span>{query && <button type="button" className="btn ghost" disabled={busy} onClick={() => setQuery('')}>검색 해제</button>}</div>
    <div className="intake-queue-table" data-pinned={pinnedColumn} role="region" aria-label="상품 대기열 표" tabIndex={0}><table><thead><tr><th><input type="checkbox" aria-label="검색 결과 전체 선택" disabled={busy || !visiblePending.length} checked={visiblePending.length > 0 && visiblePending.every(row => !excluded.includes(row.id))} onChange={event => toggle(visiblePending.map(row => row.id), event.target.checked)}/></th><th>카테고리</th><th>1688 링크</th><th>특징</th><th>키워드</th><th>상태</th><th>관리</th></tr></thead><tbody>
      {visible.map(row => { const index = rows.findIndex(item => item.id === row.id); const productId=intakeProductId(row,jobs);const captured=reviewItemForRow(row); return <tr key={row.id}>
        <td><input type="checkbox" aria-label={`${index + 1}번째 상품 선택`} disabled={busy || !pendingRowIds.has(row.id)} checked={pendingRowIds.has(row.id) && !excluded.includes(row.id)} onChange={event => toggle([row.id], event.target.checked)}/></td>
        <td><button type="button" className="intake-category-button" disabled={busy || row.status === 'saved'} onClick={() => openCategory(row.id)}>{row.profile.categoryPath.join(' > ')}</button><small className="intake-profile-summary">코드 {row.profile.categoryId || '미입력'} · v{row.profile.revision}<br/>{row.profile.template ? `양식: ${row.profile.template.name}` : (row.profile.hubSchema?.metadata.scopeType??row.profile.hubSchema?.metadata.scope)==='Retail_Categorized_Single' ? '개별 견적 양식 연결' : 'Excel 양식 미연결'}</small><button type="button" className="btn ghost" aria-expanded={previewId === row.id} onClick={() => setPreviewId(previewId === row.id ? null : row.id)}>견적 항목·양식 확인</button></td>
        <td><input ref={element => { if (element) urlInputs.current.set(row.id, element); else urlInputs.current.delete(row.id); }} aria-label={`${index + 1}번째 1688 링크`} value={row.url} maxLength={2048} disabled={busy || row.status === 'saved'} placeholder="https://detail.1688.com/offer/…" onChange={event => edit(row.id, { url: event.target.value })} />{row.url.trim() && <small className="intake-source-url">{row.url.trim()}</small>}{captured&&onReviewSource&&<><button type="button" className="btn ghost" disabled={busy||row.status==='saved'||!!row.productId||!!row.forkJobId||!!row.pendingJobId} onClick={()=>reviewSource(row,captured)}>수집정보 확인·수정</button><small>{captured.issues.length?`확인 필요: ${captured.issues.join(' · ')}`:'수집정보 준비됨'}</small>{row.sourceCapture&&captured.revision!==row.sourceCapture.revision&&<small>검토 버전이 변경되었습니다. 수집정보 확인·수정에서 저장한 뒤 시작하세요.</small>}</>}</td>
        <td><textarea aria-label={`${index + 1}번째 특징`} value={row.features} maxLength={2000} disabled={busy || row.status === 'saved'} placeholder="상품 특징" onChange={event => edit(row.id, { features: event.target.value })} /></td>
        <td><textarea aria-label={`${index + 1}번째 키워드`} value={row.keywords} maxLength={2000} disabled={busy || row.status === 'saved'} placeholder="타겟 키워드" onChange={event => edit(row.id, { keywords: event.target.value })} /></td>
        <td role="status" className={row.status === 'error' ? 'collection-error' : ''}>{row.message || '입력 대기'}{row.sourceCapture&&pendingRowIds.has(row.id)&&!productId&&!row.forkJobId&&!row.pendingJobId&&<button type="button" className="btn primary" disabled={busy||settingsChanged} onClick={()=>void submit(row)}>이 상품 초안 작성</button>}{productId && onOpenProduct && <button type="button" className="btn ghost" disabled={busy} onClick={()=>void openSavedProduct(row.id,productId)}>초안 확인·수정</button>}{intakeQueryImageRecoveryJob(row,jobs)&&<button type="button" className="btn ghost" disabled={busy} onClick={()=>openImageRecovery(row)}>누락 원본 이미지 이어받기</button>}{row.status==='error'&&row.pendingJobId&&(row.profile.template||(row.profile.hubSchema?.metadata.scopeType??row.profile.hubSchema?.metadata.scope)==='Retail_Categorized_Single')&&<button type="button" className="btn ghost" disabled={busy||settingsChanged} onClick={()=>void inspectPendingSource(row.id)}>기존 대기 요청 확인</button>}{row.status==='error'&&row.forkJobId&&(row.profile.template||(row.profile.hubSchema?.metadata.scopeType??row.profile.hubSchema?.metadata.scope)==='Retail_Categorized_Single')&&<button type="button" className="btn ghost" disabled={busy||settingsChanged} onClick={()=>void inspectNewDraft(row.id)}>{row.sourceCapture?'새 수집본으로 별도 초안 작성':'저장 원문으로 새 초안'}</button>}</td>
        <td><button type="button" className="btn ghost" disabled={busy || rows.length >= 50} onClick={() => { const id = crypto.randomUUID(); focusRow.current = id; setQuery(''); onRows(previous => previous.length < 50 ? [...previous, { ...intakeRow(row.profile, id), features: row.features, keywords: row.keywords }] : previous); }}>복제</button><button type="button" className="btn ghost" disabled={busy} onClick={() => removeRow(row.id)}>행 삭제</button></td>
      </tr>; })}
    </tbody></table>{rows.length > 0 && !visible.length && <p className="collection-empty">검색 결과가 없습니다. 검색을 해제하면 입력한 상품을 다시 볼 수 있습니다.</p>}{!rows.length && <p className="collection-empty">대기열이 비어있습니다. [+ 상품 추가] 버튼으로 카테고리를 선택해주세요.</p>}</div>
    {previewRow && <div><button type="button" className="btn ghost" onClick={() => setPreviewId(null)}>견적 연결 미리보기 닫기</button><IntakeQuotationPreview profile={previewRow.profile}/></div>}
    {pendingPreview&&<section role="dialog" aria-label="기존 대기 요청 확인" className="panel-note"><h3>기존 대기 요청 확인</h3>
      <p>{pendingPreview.preview.scope.company?.name} · {pendingPreview.preview.job.context?.category.categoryPath.join(' > ')} · 코드 {pendingPreview.preview.job.context?.category.categoryId}</p>
      <p>{pendingPreview.preview.job.source_url}</p><p>기존 목표: {pendingPreview.preview.job.goal} · 브랜드 {pendingPreview.preview.job.context?.settings.brand} · 환율 {pendingPreview.preview.job.context?.settings.exchangeRate}</p>
      <p>기존 요청의 카테고리·기본설정·원문은 보존합니다. 아직 상품이 없으면 원문과 최초 상품·옵션만 준비합니다. 번역·이미지 다운로드·등록전송은 실행하지 않으며, 현재 입력을 적용할 새 초안은 다음 화면에서 확인합니다.</p>
      <button type="button" className="btn primary" disabled={busy} onClick={()=>void preparePendingSource()}>{pendingPreview.pending?'원문 준비 중…':'원문 준비 후 새 초안 검토'}</button>
      <button type="button" className="btn ghost" disabled={busy} onClick={()=>setPendingPreview(null)}>닫기 · 현재 입력 유지</button>
    </section>}
    {sourceUrlsCandidate&&<section role="dialog" aria-label="원문 URL 새 초안 확인" className="panel-note"><h3>원문 URL로 새 초안</h3><p>서버에서 수정하지 않은 최초 원문 상품을 확인했습니다. 저장 안 된 사진은 새 초안에서 가져옵니다. 기존 상품의 입력과 원본은 보존하며, 지금은 새 초안을 검토하는 조회만 실행합니다.</p><button type="button" className="btn primary" disabled={busy} onClick={()=>void inspectSourceUrls()}>원문 URL로 새 초안 검토</button><button type="button" className="btn ghost" disabled={busy} onClick={()=>setSourceUrlsCandidate(null)}>닫기 · 현재 입력 유지</button></section>}
    {forkPreview&&<section role="dialog" aria-label={forkPreview.preview.target.sourceCapture?'새 수집본으로 별도 초안 작성':'저장 원문으로 새 초안'} className="panel-note"><h3>{forkPreview.preview.target.sourceCapture?'새 수집본으로 별도 초안 작성':'저장 원문으로 새 초안'}</h3>
      <p>{forkPreview.preview.source.company.name} · {forkPreview.preview.target.categoryPath.join(' > ')} · 코드 {forkPreview.preview.target.categoryId}</p>
      <p>원문 수집 시각: {forkPreview.preview.source.collectedAt}</p>{forkPreview.preview.target.sourceCapture&&<p>직접 선택한 새 수집본 · 검토 v{forkPreview.preview.target.sourceCapture.revision} · 사진 {forkPreview.preview.source.imageCount}개를 별도 초안으로 가져옵니다.</p>}<p>선택한 카테고리와 현재 기본설정으로 별도 상품을 작성합니다. 기존 상품의 수정 내용과 전송 기록은 보존합니다.</p>
      {forkPreview.preview.warnings.map((warning,index)=><p key={index}>{warning}</p>)}
      <button type="button" className="btn primary" disabled={busy} onClick={()=>void makeNewDraft()}>{forkPreview.created?'새 초안 작성 이어가기':forkPreview.pending?'새 초안 저장 결과 확인':'새 초안 생성'}</button>
      <button type="button" className="btn ghost" disabled={busy} onClick={()=>setForkPreview(null)}>닫기</button>
    </section>}
    <fieldset className="goal-list" disabled={busy}><legend>상품 초안 작성</legend>{[
      ['price', 'SEO·가격 초안 작성', '상품정보를 가져와 초안을 작성합니다. 저장 후 각 단계에서 확인·수정하세요.'],
      ['work', 'SEO·가격 + 이미지 초안', '원본을 대표·추가·상세·옵션 이미지에 배치합니다. 번역·편집 후 확인하세요.'],
      ['collect', '상품정보만 가져오기', '원문·옵션·가격을 가져오고 SEO 작성은 나중에 진행합니다.'],
    ].map(([id, title, description]) => <label className="goal-card" key={id}><input type="radio" name="queue-goal" checked={(goal==='collect'?'collect':goal==='work'?'work':'price') === id} onChange={() => onGoal(id)} /><span><strong>{title}</strong><small>{description}</small></span></label>)}</fieldset>
    <p className="collection-notice">{collectionBlock} <a href="/downloads/yoofam-plus-supplier-hub-extension-2.1.43.zip" download>상품 수집·전송 확장 2.1.43 다운로드</a></p><small>복제는 카테고리·특징·키워드를 복사하며 새 URL을 입력해야 합니다. 행 삭제는 이 입력 목록만 지우며 서버에 저장한 요청을 취소하지 않습니다.</small>
    {selected.some(row => !visible.some(item => item.id === row.id)) && <p className="collection-notice">검색으로 숨겨진 선택 상품도 함께 처리합니다. 선택 {pending}건 중 숨겨진 상품 {selected.filter(row => !visible.some(item => item.id === row.id)).length}건</p>}
    {!!unfilledRows.length&&<p className="collection-notice">URL을 입력하지 않은 {unfilledRows.length}개 행은 시작 대상에서 제외됩니다.</p>}
    {settingsChanged&&<div className="panel-note"><p>기본설정이 변경돼 남은 상품 처리를 멈췄습니다.</p><button type="button" className="btn ghost" disabled={busy} onClick={()=>void reloadSettings()}>최신 기본설정 불러오기</button></div>}
    {settingsMessage&&<p role="status">{settingsMessage}</p>}
    {error && <p role="alert" className="collection-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="btn ghost" disabled={busy || rows.length >= 50} onClick={() => openCategory('new')}>＋ 상품 추가</button><button type="button" className="btn primary" disabled={busy || !pending || settingsChanged} onClick={() => void submit()}>{busy ? '상품정보 가져오는 중…' : `${pending === pendingRows.length ? '전체' : '선택'} 시작 (${pending}건)`}</button></div>
  </div>;
}
