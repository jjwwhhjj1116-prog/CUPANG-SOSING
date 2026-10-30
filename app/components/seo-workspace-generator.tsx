'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TranslationJob, TranslationSource, TranslationView } from '@/app/automation/translation';
import {WORKERS_QWEN_MODEL} from '@/app/automation/workers-qwen-contract';
import type { ProductContent } from '@/app/product-content';
import type { ProductOptionsResponse } from '@/app/product-options';
import { collectedTranslationAttributes } from '@/app/collected-translation-attributes';
import { optionTranslationBatch } from '@/app/option-translation';
import { collectionSourceReference } from '@/app/sourcing';
import { createSeoWorkspaceDraftState, parseSeoWorkspaceDraftState, refreshSeoWorkspaceDraft, runSeoWorkspaceDraft,
  readSeoGenerationContext,createSeoGenerationDraftState,parseSeoGenerationDraftState,runSeoGenerationDraft,refreshSeoGenerationDraft,
  type SeoGenerationContext,type SeoGenerationDraftState,type SeoWorkspaceDraftMemo, type SeoWorkspaceDraftState } from '@/app/seo-workspace-draft';
import { TranslationIntegratedPreview } from '@/app/components/translation-integrated-preview';
import TranslationPanel from '@/app/components/translation-panel';
import {google429RecoveryCandidate} from '@/app/workers-translation-recovery';
import {newWorkersSeoRecoveryRequest,prepareWorkersSeoRecovery,workersSeoRecoveryM2mLimit,type WorkersSeoRecoveryRequest} from '@/app/workers-seo-recovery-client';
import { sameSeoAppliedSource, type SeoAppliedReceipt } from '@/app/seo-apply-focus';
import { seoGuidanceTitle, seoGuidanceTags, validateSeoGuidanceComposition, type SeoGuidanceComposition } from '@/app/seo-guidance-composition';
import { commitSeoGuidanceSession, initialSeoGuidanceMemo, openSeoGuidanceSession, readSeoGuidanceSession, releaseSeoGuidanceSession,
  seoGuidanceSessionSourceKey, type SeoGuidanceSession } from '@/app/seo-guidance-session';
import './seo-workspace.css';

type Props = { productId: string; workspaceOwnerId?: string; version: string; brand: string; active: boolean; beforeGenerate: () => boolean; onSaved: () => void;
  onBusyChange?: (busy: boolean) => void; onPendingChange?: (pending: boolean) => void; onApplyUncertainChange?: (uncertain: boolean) => void;
  onProcessingChange?: (busy: boolean, operation: object) => void; onApplied?: (receipt: SeoAppliedReceipt) => void };
type ProcessingLease = { operation: object; callback: Props['onProcessingChange'] };
type Source = { productId: string; productVersion: string; jobId: string; sourceUrl: string; title: string; description: string;
  attributes: {name:string;value:string}[]; requestContext: {categoryId:string;categoryPath:string[];features:string;keywords:string}|null };
type Basis = { source: TranslationSource; productVersion: string; initialMemo: SeoWorkspaceDraftMemo; sourceIdentity: string;
  guidanceKey:string;contentRevision: number; configuration: TranslationView['configuration']; remainingOptions: number; savedSeo: ProductContent['seo'];workersRecovery?:TranslationView['workersRecovery'];workersFailedJobId:string|null };
const supplierSourceIdentity=(source:TranslationSource)=>JSON.stringify([source.title,source.description,
  source.attributes.filter(pair=>pair.name.startsWith('상품속성: ')),source.reference,source.category]);

export function SeoWorkspaceGenerator(props: Props) {
  return <SeoWorkspaceGeneratorContent key={JSON.stringify([props.workspaceOwnerId??null,props.productId])} {...props}/>;
}

type GenerationPanelProps={productId:string;workspaceOwnerId?:string;version:string;memo:SeoWorkspaceDraftMemo;active:boolean;disabled:boolean;beforeGenerate:()=>boolean;onBusyChange:(value:boolean)=>void;onPendingChange:(value:boolean)=>void;onSaved:()=>void;onApplied?:Props['onApplied'];onRestoreMemo:(memo:SeoWorkspaceDraftMemo)=>void};
/** The generation request has its own purpose, saved key and review. Mounting
 * this panel only reads configuration; it cannot authorize an AI execution. */
export function SeoGenerationPanel(props:GenerationPanelProps){
 return <SeoGenerationPanelContent key={JSON.stringify([props.workspaceOwnerId??null,props.productId,props.version])} {...props}/>;
}
function SeoGenerationPanelContent(props:GenerationPanelProps){
 const [view,setView]=useState<SeoGenerationContext|null>(null),[state,setState]=useState<SeoGenerationDraftState|null>(null),[job,setJob]=useState<TranslationJob|null>(null);
 const [busy,setBusy]=useState(true),[message,setMessage]=useState(''),[error,setError]=useState(''),[confirmedToken,setConfirmedToken]=useState<object|null>(null),[closed,setClosed]=useState(false),[uncertain,setUncertain]=useState(false),[invalid,setInvalid]=useState(false);
 const pending=useRef<AbortController|null>(null),mounted=useRef(true),live=useRef(props),saved=useRef<SeoGenerationDraftState|null>(null);
 const scope=useMemo(()=>({owner:props.workspaceOwnerId,productId:props.productId,version:props.version}),[props.workspaceOwnerId,props.productId,props.version]),currentScope=useRef<typeof scope|null>(scope);
 const memoKey=JSON.stringify(props.memo),memoScope=useMemo(()=>({value:memoKey}),[memoKey]),memoEpoch=useRef<typeof memoScope|null>(memoScope),confirmed=confirmedToken===memoScope;
 const {onBusyChange,onPendingChange}=props;
 const storageKey='yoofam-seo-generation:'+JSON.stringify([props.workspaceOwnerId??null,props.productId]);
 useLayoutEffect(()=>{live.current=props;currentScope.current=scope;return()=>{if(currentScope.current===scope)currentScope.current=null;};},[props,scope]);
 useLayoutEffect(()=>{memoEpoch.current=memoScope;return()=>{if(memoEpoch.current===memoScope)memoEpoch.current=null;};},[memoScope]);
 useLayoutEffect(()=>{onBusyChange(busy);onPendingChange(Boolean(state)||uncertain);},[busy,state,uncertain,onBusyChange,onPendingChange]);
 useEffect(()=>{
  const controller=new AbortController();pending.current=controller;mounted.current=true;
  void readSeoGenerationContext(props.productId,controller.signal,fetch).then(value=>{
   if(!mounted.current||controller.signal.aborted||currentScope.current!==scope)return;
   if(value.productVersion!==props.version)throw Error('현재 상품 버전의 AI SEO 원문을 다시 열어주세요.');setView(value);
   const raw=sessionStorage.getItem(storageKey);if(raw){const retained=parseSeoGenerationDraftState(raw,props.productId);if(!retained){setInvalid(true);throw Error('원래 AI SEO 생성 요청의 복구 정보를 확인하지 못했습니다. 새 요청을 만들지 않았습니다.');}saved.current=retained;setState(retained);live.current.onRestoreMemo(retained.memo);setMessage('이전 AI SEO 요청이 있습니다. 같은 요청의 상태를 먼저 확인해주세요.');}
  }).catch(cause=>{if(!controller.signal.aborted&&mounted.current&&currentScope.current===scope)setError(cause instanceof Error?cause.message:'AI SEO 생성 연결을 확인하지 못했습니다.');}).finally(()=>{if(pending.current===controller){pending.current=null;if(mounted.current&&!controller.signal.aborted&&currentScope.current===scope)setBusy(false);}});
  return()=>{controller.abort();if(pending.current===controller)pending.current=null;};
 },[props.productId,props.version,scope,storageKey]);
 useEffect(()=>()=>{mounted.current=false;pending.current?.abort();live.current.onBusyChange(false);},[]);
 const current=()=>mounted.current&&currentScope.current===scope&&memoEpoch.current===memoScope&&live.current.active&&!live.current.disabled;
 const persist=(value:SeoGenerationDraftState)=>{saved.current=value;sessionStorage.setItem(storageKey,JSON.stringify(value));if(current())setState(value);};
 async function run(readOnly=false){
  if(!current()||pending.current||invalid||uncertain||!view||readOnly&&!saved.current)return;
  if(!readOnly&&(!view.configuration.configured||!live.current.beforeGenerate()))return;
  const controller=new AbortController();pending.current=controller;setBusy(true);setError('');setMessage('');
  const input=JSON.stringify(live.current.memo),active=()=>current()&&!controller.signal.aborted&&pending.current===controller&&JSON.stringify(live.current.memo)===input;
  try{
   const request=saved.current??createSeoGenerationDraftState(view,live.current.memo);
   if(!readOnly&&(request.productVersion!==props.version||JSON.stringify(request.memo)!==input))throw Error('원래 AI SEO 요청의 상품·참고 입력이 다릅니다. 상태만 조회해주세요.');persist(request);
   const controls={signal:controller.signal,fetcher:fetch,confirmAi:confirmed,isContextCurrent:active,onState:persist,onJob:(value:TranslationJob)=>{if(active())setJob(value);}};
   const result=await(readOnly?refreshSeoGenerationDraft(request,controls):runSeoGenerationDraft(request,controls));if(!active())return;setJob(result.job);setClosed(result.closed);setMessage(result.message);
  }catch(cause){if(active())setError(cause instanceof Error?cause.message:'AI SEO 생성 상태를 확인하지 못했습니다.');}
  finally{if(pending.current===controller){pending.current=null;if(mounted.current&&currentScope.current===scope)setBusy(false);}}
 }
 const currentJob=job?.productId===props.productId&&job.productVersion===props.version&&job.status==='completed'&&job.result;
 return <section aria-label="무료 AI SEO 생성" data-workspace-saving={busy} data-workspace-dirty={Boolean(state)||uncertain}>
  <h4>AI SEO 상품명·검색태그·설명 생성</h4>
  {view&&<><p>{view.configuration.destination} · {view.configuration.notice}</p><small>모델 {view.configuration.model} · 최대 출력 {view.configuration.maxOutputTokens}토큰 · 무료 사용만 허용 · 유료 전환 없음</small></>}
  {view&&!view.configuration.configured&&<p role="alert">{view.configuration.issues.join(' ')} Google 번역을 AI 최적화 완료로 표시하지 않습니다.</p>}
  {view?.configuration.configured&&<label className="seo-ai-consent"><input type="checkbox" aria-label="무료 AI SEO 생성 확인" checked={confirmed} disabled={busy||props.disabled||Boolean(state?.executeSubmitted)} onChange={event=>{if(current()&&!pending.current){setConfirmedToken(event.target.checked?memoScope:null);}}}/>위 전송 대상과 공유 무료 한도를 확인했습니다.</label>}
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  <button type="button" className="btn blue" disabled={busy||props.disabled||!props.active||invalid||uncertain||!view?.configuration.configured} onClick={()=>void run()}>{state?'같은 AI SEO 생성 계속':'무료 AI SEO 초안 생성'}</button>
  {state&&<button type="button" className="btn ghost" disabled={busy||props.disabled||!props.active||uncertain} onClick={()=>void run(true)}>AI SEO 상태 조회 · 새 호출 안 함</button>}
  {state&&closed&&<button type="button" className="btn ghost" disabled={busy||props.disabled||uncertain} onClick={()=>{if(!current()||pending.current)return;saved.current=null;setState(null);setJob(null);setClosed(false);setConfirmedToken(null);sessionStorage.removeItem(storageKey);}}>새 AI SEO 입력 준비</button>}
  {currentJob&&<><dl><dt>상품명</dt><dd>{job!.result!.draft.title}</dd><dt>검색태그</dt><dd>{job!.result!.draft.keywords.join(', ')}</dd><dt>설명</dt><dd>{job!.result!.draft.description}</dd></dl>
   <TranslationIntegratedPreview purpose="seo-generation" productId={props.productId} version={props.version} jobId={job!.id} disabled={busy||props.disabled||!props.active||uncertain} beforeApply={()=>current()&&!uncertain&&live.current.beforeGenerate()}
    onBusyChange={setBusy} onUncertainChange={setUncertain} onApplied={props.onApplied} onSaved={()=>{if(!current())return;saved.current=null;sessionStorage.removeItem(storageKey);setState(null);live.current.onSaved();}}/>
  </>}
 </section>;
}
function SeoWorkspaceGeneratorContent({ productId, workspaceOwnerId, version, brand, active, beforeGenerate, onSaved, onProcessingChange, onBusyChange, onPendingChange, onApplyUncertainChange, onApplied }: Props) {
  const [basis,setBasis]=useState<Basis|null>(null),[memo,setMemo]=useState<SeoWorkspaceDraftMemo>({brand,features:'',keywords:''});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [job,setJob]=useState<TranslationJob|null>(null),[hasRequest,setHasRequest]=useState(false),[closed,setClosed]=useState(false);
  const [confirmAi,setConfirmAi]=useState(false);
  const [generationBusy,setGenerationBusy]=useState(false),[generationPending,setGenerationPending]=useState(false);
  const generationLocked=useRef(false);useLayoutEffect(()=>{generationLocked.current=generationBusy||generationPending;},[generationBusy,generationPending]);
  const [workersReview,setWorkersReview]=useState<{productVersion:string;jobId:string;fingerprint:string;ownerId?:string}|null>(null);
  const workersRequest=useRef<WorkersSeoRecoveryRequest|null>(null);
  const [recoveryInvalid,setRecoveryInvalid]=useState(false);
  const [attempt,setAttempt]=useState(0);
  const [compositionTitle,setCompositionTitle]=useState<string|null>(null),[compositionKeywords,setCompositionKeywords]=useState<string|null>(null),[compositionEnabled,setCompositionEnabled]=useState(true);
  const [replaceTitle,setReplaceTitle]=useState(false),[replaceKeywords,setReplaceKeywords]=useState(false);
  const [compositionBusy,setCompositionBusy]=useState(false),compositionBusyRef=useRef(false);
  const [applyUncertain,setApplyUncertain]=useState(false),applyUncertainRef=useRef(false);
  const statusCallbacks=useRef({onBusyChange,onPendingChange,onApplyUncertainChange,onSaved,onApplied});
  const statusLease=useRef<{busy?:boolean;pending?:boolean;uncertain?:boolean;callbacks:typeof statusCallbacks.current}|null>(null);
  useLayoutEffect(()=>{statusCallbacks.current={onBusyChange,onPendingChange,onApplyUncertainChange,onSaved,onApplied};});
  useLayoutEffect(()=>{const lease={callbacks:statusCallbacks.current};statusLease.current=lease;return()=>{if(statusLease.current!==lease)return;statusLease.current=null;lease.callbacks.onBusyChange?.(false);lease.callbacks.onPendingChange?.(false);};},[productId,workspaceOwnerId]);
  const [processing,setProcessing]=useState(false),processingLease=useRef<ProcessingLease|null>(null),processingCallback=useRef(onProcessingChange);
  const operationContext=useRef<object>({});
  const compositionCallback=useRef<((value:boolean)=>void)|null>(null);
  const processingActions=useRef<{start:(operation:object)=>void;finish:(operation?:object)=>void}|null>(null);
  const [guidanceError,setGuidanceError]=useState('');
  const request=useRef<AbortController|null>(null), draftState=useRef<SeoWorkspaceDraftState|null>(null);
  const guidanceSession=useRef<SeoGuidanceSession|null>(null),memoBaseline=useRef<SeoWorkspaceDraftMemo|null>(null);
  const current=useRef({active,version,memo,workspaceOwnerId,confirmAi}),mounted=useRef(true),loaded=useRef<{version:string;sourceIdentity:string;guidanceKey:string}|null>(null);
  const settledLoad=useRef<string|null>(null),loadScope=JSON.stringify([workspaceOwnerId??null,productId,version,brand,attempt]);
  const storageKey=`yoofam-seo-workspace:${productId}`;
  function finishProcessing(operation?:object){
    const lease=processingLease.current;if(!lease||(operation&&lease.operation!==operation))return;
    processingLease.current=null;if(mounted.current)setProcessing(false);lease.callback?.(false,lease.operation);
  }
  function startProcessing(operation:object){
    if(processingLease.current?.operation===operation)return;
    finishProcessing();const lease={operation,callback:processingCallback.current};processingLease.current=lease;
    setProcessing(true);lease.callback?.(true,operation);
  }
  useLayoutEffect(()=>{processingActions.current={start:startProcessing,finish:finishProcessing};});
  useLayoutEffect(()=>{
    const sourceChanged=current.current.version!==version||current.current.workspaceOwnerId!==workspaceOwnerId;
    if(sourceChanged||current.current.active!==active){
      request.current?.abort();request.current=null;operationContext.current={};
      if(sourceChanged||!compositionBusyRef.current){finishProcessing();compositionBusyRef.current=false;setCompositionBusy(false);}
      setBusy(false);
    }
    current.current={active,version,memo,workspaceOwnerId,confirmAi};
  },[active,version,memo,workspaceOwnerId,confirmAi]);
  useLayoutEffect(()=>{
    const lease=processingLease.current;
    if(processingCallback.current===onProcessingChange)return;
    processingCallback.current=onProcessingChange;
    if(lease){lease.callback?.(false,lease.operation);if(processingLease.current===lease){lease.callback=onProcessingChange;lease.callback?.(true,lease.operation);}}
  },[onProcessingChange]);
  useLayoutEffect(()=>{
    mounted.current=true;
    if(loaded.current&&workspaceOwnerId){guidanceSession.current=openSeoGuidanceSession(workspaceOwnerId,productId,loaded.current.guidanceKey);setBasis(previous=>previous?{...previous}:previous);}
    return()=>{mounted.current=false;request.current?.abort();operationContext.current={};finishProcessing();releaseSeoGuidanceSession(guidanceSession.current);guidanceSession.current=null;};
  },[workspaceOwnerId,productId]);
  useEffect(()=>{
    if(!active||loaded.current?.version===version)return;
    const controller=new AbortController();request.current=controller;
    const base=`/api/products/${encodeURIComponent(productId)}`;
    const read=async(path:string)=>{const response=await fetch(base+path,{signal:controller.signal,cache:'no-store'}),value:unknown=await response.json();
      if(!response.ok)throw Error(value&&typeof value==='object'&&'error' in value&&typeof value.error==='string'?value.error:'SEO 자료를 불러오지 못했습니다.');return value;};
    void Promise.resolve().then(async()=>{
      if(controller.signal.aborted)return;setBusy(true);setError('');
      try{
        const [view,content,source,options,registration]=await Promise.all([read('/translation'),read('/content'),read('/translation-source'),read('/options'),read('/registration-settings')]) as [TranslationView,{content:ProductContent},Source,ProductOptionsResponse,{productId:string;settings:{brand:string}}];
        if(controller.signal.aborted||!mounted.current)return;
        if(!view.configuration||!Array.isArray(view.jobs)||content.content?.productId!==productId||!Number.isSafeInteger(content.content.revision)
          ||source.productId!==productId||source.productVersion!==version||options.productVersion!==version||options.options?.productId!==productId
          ||typeof source.title!=='string'||typeof source.description!=='string'||!source.jobId||typeof source.sourceUrl!=='string'
          ||!source.requestContext||typeof source.requestContext.features!=='string'||typeof source.requestContext.keywords!=='string'
          ||!source.requestContext.categoryId||!Array.isArray(source.requestContext.categoryPath)||!source.requestContext.categoryPath.length
          ||registration.productId!==productId||typeof registration.settings?.brand!=='string')
          throw Error('현재 상품의 원문·카테고리·옵션을 확인하지 못했습니다. 최신 상품을 다시 열어주세요.');
        const attributes=collectedTranslationAttributes(source.attributes??[]),batch=optionTranslationBatch(options.options,50-attributes.length,view.jobs);
        const value={brand:registration.settings.brand,features:source.requestContext.features,keywords:source.requestContext.keywords};
        const translationSource:TranslationSource={title:source.title,description:source.description,attributes:[...attributes,...batch.attributes],provenance:'manual',
          reference:collectionSourceReference(source.jobId,source.sourceUrl),category:{id:source.requestContext.categoryId,path:source.requestContext.categoryPath},
          guidance:{features:source.requestContext.features,keywords:source.requestContext.keywords}};
        const sourceIdentity=supplierSourceIdentity(translationSource);
        const guidanceKey=seoGuidanceSessionSourceKey(sourceIdentity,value);
        const previous=loaded.current;
        const guidanceChanged=previous?.guidanceKey!==guidanceKey;
        if(guidanceChanged){releaseSeoGuidanceSession(guidanceSession.current);guidanceSession.current=openSeoGuidanceSession(workspaceOwnerId,productId,guidanceKey);memoBaseline.current=initialSeoGuidanceMemo(value,readSeoGuidanceSession(guidanceSession.current));}
        const initialMemo=memoBaseline.current??initialSeoGuidanceMemo(value,null);
        setConfirmAi(false);
        if(!draftState.current&&guidanceChanged){setMemo(initialMemo);current.current.memo=initialMemo;setGuidanceError('');
          if(previous)setMessage('수집 원문이 변경되어 새 원문의 참고 입력을 불러왔습니다. 생성 전에 내용을 확인해주세요.');}
        if(draftState.current&&supplierSourceIdentity(draftState.current.source)!==sourceIdentity)
          setMessage('수집 원문이 변경되었습니다. 이전 초안은 상태 조회로 확인하고 새 초안 입력을 준비해주세요. 이전 요청을 새 원문으로 실행하지 않습니다.');
        setBasis({source:translationSource,
          productVersion:version,initialMemo,guidanceKey,sourceIdentity,configuration:view.configuration,contentRevision:content.content.revision,remainingOptions:batch.remaining,savedSeo:content.content.seo,
          workersRecovery:view.workersRecovery,workersFailedJobId:view.jobs.find(item=>item.productId===productId&&google429RecoveryCandidate(item))?.id??null});
        try{const raw=!previous?sessionStorage.getItem(storageKey):null,saved=raw?parseSeoWorkspaceDraftState(raw,productId):null;
          if(raw&&!saved)throw Error('이전 초안의 복구 정보를 확인하지 못했습니다. 아래 생성 이력을 확인해주세요. 새 실행은 만들지 않았습니다.');
          if(saved){draftState.current=saved;setMemo(saved.memo);current.current.memo=saved.memo;setHasRequest(true);setMessage('이전에 요청한 초안이 있습니다. 같은 요청의 상태를 먼저 확인해주세요.');}}
        catch(cause){setRecoveryInvalid(true);setError(cause instanceof Error?cause.message:'이전 초안의 복구 정보를 읽지 못했습니다. 생성 이력을 확인해주세요.');}
        loaded.current={version,sourceIdentity,guidanceKey};
      }catch(cause){if(!controller.signal.aborted&&mounted.current)setError(cause instanceof Error?cause.message:'SEO 자료 조회 실패');}
      finally{if(request.current===controller){request.current=null;if(!controller.signal.aborted&&mounted.current){settledLoad.current=loadScope;setBusy(false);}}}
    });
    return()=>{controller.abort();if(request.current===controller){request.current=null;void Promise.resolve().then(()=>{if(mounted.current&&!request.current)setBusy(false);});}};
  },[active,productId,workspaceOwnerId,version,brand,storageKey,attempt,loadScope]);
  function edit(key:keyof SeoWorkspaceDraftMemo,value:string){if(generationLocked.current||!mounted.current||current.current.version!==version||current.current.workspaceOwnerId!==workspaceOwnerId||!current.current.active||request.current||draftState.current)return;setMemo(previous=>{const next={...previous,[key]:value};current.current.memo=next;return next;});setConfirmAi(false);setGuidanceError('');}
  function blur(key:keyof SeoWorkspaceDraftMemo,value:string,session:SeoGuidanceSession|null){
    if(!basis||!mounted.current||current.current.workspaceOwnerId!==workspaceOwnerId||current.current.version!==version||!current.current.active
      ||request.current||draftState.current||compositionBusyRef.current||basis.productVersion!==version||loaded.current?.guidanceKey!==basis.guidanceKey
      ||guidanceSession.current!==session||current.current.memo[key]!==value)return;
    try{
      if(!commitSeoGuidanceSession(session,key,value))return;
      const baseline={...(memoBaseline.current??basis.initialMemo),[key]:value};memoBaseline.current=baseline;
      setBasis(previous=>previous?.guidanceKey===basis.guidanceKey?{...previous,initialMemo:baseline}:previous);setGuidanceError('');
    }catch(cause){setGuidanceError(cause instanceof Error?cause.message:'SEO 참고 입력을 확인해주세요. 입력 원문은 유지됩니다.');}
  }
  async function generate(readOnly=false){
    if(generationLocked.current)return;
    if(!readOnly&&applyUncertainRef.current)return;
    if(!basis||basis.productVersion!==version||!mounted.current||current.current.version!==version||current.current.workspaceOwnerId!==workspaceOwnerId||recoveryInvalid||request.current||compositionBusyRef.current||!current.current.active)return;
    if(readOnly&&!draftState.current)return;
    if(!readOnly&&!draftState.current&&!current.current.memo.keywords.trim())return;
    if(!beforeGenerate())return;
    const operation={},context=operationContext.current;
    const controller=new AbortController();request.current=controller;setBusy(true);setError('');setMessage('');
    if(!readOnly)startProcessing(operation);
    const input=structuredClone(current.current.memo),inputKey=JSON.stringify(input);
    const same=()=>mounted.current&&current.current.active&&operationContext.current===context&&current.current.version===version&&current.current.workspaceOwnerId===workspaceOwnerId&&JSON.stringify(current.current.memo)===inputKey;
    try{
      let state=draftState.current??createSeoWorkspaceDraftState({productId,productVersion:version,contentRevision:basis.contentRevision,
        source:basis.source,memo:input,configuration:basis.configuration});
      const sourceIdentity=(source:TranslationSource)=>JSON.stringify([source.title,source.description,source.attributes,source.reference,source.category]);
      if(!readOnly&&(state.productVersion!==version||state.contentRevision!==basis.contentRevision||sourceIdentity(state.source)!==sourceIdentity(basis.source)))
        throw Error('이전 요청 이후 상품 원문이 변경되었습니다. 초안 상태를 조회한 뒤 새 입력을 준비해주세요. 이전 요청을 다시 실행하지 않았습니다.');
      const persist=(saved:SeoWorkspaceDraftState)=>{draftState.current=saved;try{sessionStorage.setItem(storageKey,JSON.stringify(saved));}catch{}
        if(!controller.signal.aborted&&same())setHasRequest(true);};
      const controls={signal:controller.signal,fetcher:fetch,isContextCurrent:same,confirmAi,onState:persist,
        onJob:(value:TranslationJob)=>{if(!controller.signal.aborted&&same())setJob(value);}};
      const retryFailedQwen=!readOnly&&closed&&job?.status==='failed'&&job.productId===productId&&job.productVersion===version
        &&job.review?.model===WORKERS_QWEN_MODEL&&!Object.hasOwn(job.review,'workersRecovery')
        &&state.jobId===job.id&&state.reviewFingerprint===job.review.fingerprint&&state.configuration.model===WORKERS_QWEN_MODEL;
      if(retryFailedQwen){
        if(!confirmAi||!current.current.confirmAi)return;
        let latestConfiguration:TranslationView['configuration']|undefined;
        const previous=state,verified=await refreshSeoWorkspaceDraft(structuredClone(previous),{...controls,fetcher:async(target,init)=>{
          const response=await fetch(target,init),value=await response.clone().json() as Partial<TranslationView>;latestConfiguration=value.configuration;return response;
        },onState:()=>{},onJob:()=>{}});
        if(controller.signal.aborted||!same()||draftState.current!==previous||!current.current.confirmAi||!beforeGenerate())return;
        if(!verified.closed||verified.job?.status!=='failed'||verified.job.id!==previous.jobId||verified.job.review.fingerprint!==previous.reviewFingerprint
          ||verified.job.review.model!==WORKERS_QWEN_MODEL||Object.hasOwn(verified.job.review,'workersRecovery')
          ||latestConfiguration?.configured!==true||latestConfiguration.model!==basis.configuration.model||latestConfiguration.maxOutputTokens!==basis.configuration.maxOutputTokens){
          setMessage('원래 Qwen 작업의 실패 상태를 확인하지 못했습니다. 기존 요청을 유지했습니다. 초안 상태를 다시 조회해주세요.');return;
        }
        state=createSeoWorkspaceDraftState({productId,productVersion:version,contentRevision:basis.contentRevision,source:basis.source,memo:input,configuration:basis.configuration});
        setClosed(false);
      }
      persist(state);
      const result=await (readOnly?refreshSeoWorkspaceDraft(state,controls):runSeoWorkspaceDraft(state,controls));
      if(controller.signal.aborted||!same())return;
      const preparedOnly=!!result.job&&['prepared','approved'].includes(result.job.status)&&!state.executeSubmitted
        &&!result.job.startedAt&&!result.job.result&&!result.job.error;
      setJob(result.job);setClosed(result.closed||preparedOnly);setMessage(result.message);
    }catch(cause){if(!controller.signal.aborted&&same())setError(cause instanceof Error?cause.message:'초안 작성 상태를 확인하지 못했습니다.');}
    finally{finishProcessing(operation);if(request.current===controller){request.current=null;if(mounted.current)setBusy(false);}}
  }
  async function prepareWorkers(){
    const workersLimit=workersSeoRecoveryM2mLimit(basis?.workersRecovery);
    if(workersLimit===null||!basis?.workersFailedJobId||basis.productVersion!==version||!mounted.current||!current.current.active
      ||current.current.version!==version||current.current.workspaceOwnerId!==workspaceOwnerId||request.current||compositionBusyRef.current||applyUncertainRef.current||!beforeGenerate())return;
    const context=operationContext.current,controller=new AbortController();request.current=controller;setBusy(true);setError('');setMessage('중국어→한국어 번역 검토를 준비하고 있습니다…');
    const previous=workersRequest.current,input=previous&&previous.productVersion===version&&previous.failedJobId===basis.workersFailedJobId
      ?previous:newWorkersSeoRecoveryRequest(productId,version,basis.workersFailedJobId);
    workersRequest.current=input;
    const same=()=>mounted.current&&current.current.active&&operationContext.current===context&&current.current.version===version&&current.current.workspaceOwnerId===workspaceOwnerId;
    try{
      const saved=await prepareWorkersSeoRecovery(input,{signal:controller.signal,contentRevision:basis.contentRevision,expectedMaxCalls:workersLimit,fetcher:fetch});
      if(controller.signal.aborted||!same())return;
      setWorkersReview({productVersion:version,jobId:saved.id,fingerprint:saved.review.fingerprint,ownerId:workspaceOwnerId});
      setMessage('Cloudflare Workers AI의 중국어→한국어 번역 요청을 준비했습니다. 아래 전송 원문과 호출 횟수를 확인하고 승인·실행해주세요. Google 이력과 작성 중인 입력은 유지했습니다.');
    }catch(cause){if(!controller.signal.aborted&&same())setError(cause instanceof Error?cause.message:'서버 AI 요청 상태를 확인하지 못했습니다. 같은 요청을 다시 확인해주세요.');}
    finally{if(request.current===controller){request.current=null;if(mounted.current)setBusy(false);}}
  }
  const google=basis?.configuration.model==='google-translate-gtx';
  const titleExample=[memo.brand.trim(),memo.features.trim()||'상품 특징',memo.keywords.trim()||'타겟 키워드'].filter(Boolean).join(' ');
  const currentJob=job?.productVersion===version&&job.productId===productId;
  const failedQwenRetry=hasRequest&&closed&&currentJob&&job.status==='failed'&&job.review?.model===WORKERS_QWEN_MODEL
    &&!Object.hasOwn(job.review,'workersRecovery')&&basis?.configuration.model===WORKERS_QWEN_MODEL;
  const hasResult=currentJob&&job.status==='completed'&&!!job.result;
  const memoDirty=!hasRequest&&!!basis&&JSON.stringify(memo)!==JSON.stringify(basis.initialMemo);
  let composition: SeoGuidanceComposition|undefined, compositionError='', compositionTags:string[]=[], omittedTags:string[]=[];
  const compositionInput=google&&hasResult?{...memo,keywords:compositionKeywords??memo.keywords,title:compositionTitle??seoGuidanceTitle(job!.result!.draft,memo),replaceTitle,replaceKeywords}:null;
  if(compositionInput)try{composition=validateSeoGuidanceComposition(compositionInput);const result=seoGuidanceTags(job!.result!.draft,composition);compositionTags=result.tags;omittedTags=result.omitted;}
  catch(cause){compositionError=cause instanceof Error?cause.message:'SEO 구성안을 확인해주세요.';}
  const compositionDirty=!!compositionInput&&(compositionTitle!==null||compositionKeywords!==null||!compositionEnabled||replaceTitle||replaceKeywords);
  useLayoutEffect(()=>{
    const lease=statusLease.current;if(!lease||!mounted.current)return;
    const nextBusy=busy||compositionBusy||generationBusy||active&&loaded.current?.version!==version&&settledLoad.current!==loadScope,nextPending=memoDirty||compositionDirty||hasRequest||applyUncertain||generationPending,callbacks=statusCallbacks.current;
    if(lease.busy!==nextBusy||lease.callbacks.onBusyChange!==callbacks.onBusyChange)callbacks.onBusyChange?.(nextBusy);
    if(lease.pending!==nextPending||lease.callbacks.onPendingChange!==callbacks.onPendingChange)callbacks.onPendingChange?.(nextPending);
    if(lease.uncertain!==applyUncertain||lease.callbacks.onApplyUncertainChange!==callbacks.onApplyUncertainChange)callbacks.onApplyUncertainChange?.(applyUncertain);
    lease.busy=nextBusy;lease.pending=nextPending;lease.uncertain=applyUncertain;lease.callbacks=callbacks;
  });
  const editComposition=(edit:()=>void)=>{if(mounted.current&&current.current.active&&current.current.version===version&&!request.current&&!busy&&!compositionBusyRef.current&&!applyUncertainRef.current)edit();};
  const compositionKey=JSON.stringify([workspaceOwnerId??null,productId,version,job?.id??null,compositionEnabled?composition??null:null]);
  const compositionPublisher=useMemo(()=>{
    const operation={source:compositionKey},callback=(value:boolean)=>{
      if(value){
        if(!mounted.current||!current.current.active||current.current.version!==version||current.current.workspaceOwnerId!==workspaceOwnerId
          ||compositionCallback.current!==callback||request.current)return;
        compositionBusyRef.current=true;setCompositionBusy(true);processingActions.current?.start(operation);
      }else if(processingLease.current?.operation===operation){
        compositionBusyRef.current=false;if(mounted.current)setCompositionBusy(false);processingActions.current?.finish(operation);
      }
    };
    return callback;
    // Stage A/B/A must retire callbacks even when the composition is unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[compositionKey,version,workspaceOwnerId,active]);
  useLayoutEffect(()=>{compositionCallback.current=compositionPublisher;},[compositionPublisher]);
  const currentComposition=()=>mounted.current&&current.current.active&&current.current.version===version&&current.current.workspaceOwnerId===workspaceOwnerId&&compositionCallback.current===compositionPublisher;
  const renderGuidanceSession=guidanceSession.current;
  return <section className="seo-generation-card" aria-label="SEO 자동 작성" data-workspace-saving={busy||compositionBusy||generationBusy} data-workspace-dirty={memoDirty||compositionDirty||generationPending} data-seo-generation-input data-quotation-source-step="SEO">
    <h3>AI 자동 생성</h3>
    {processing&&<p role="status" data-seo-processing>상품정보로 SEO 초안을 처리하고 있습니다…</p>}
    <div className="seo-generation-body" hidden={processing} inert={processing}>
      <p>{google?'수집한 상품정보를 한국어로 번역하고 SEO 설정 초안을 작성합니다.':'AI가 상품 정보를 분석하여 최적의 SEO 설정을 자동으로 생성합니다.'}</p>
      <div className="seo-generation-inputs">
        <label>브랜드<input aria-label="SEO 브랜드" value={memo.brand} maxLength={100} disabled={busy||hasRequest||generationBusy||generationPending} onChange={event=>edit('brand',event.target.value)} onBlur={event=>blur('brand',event.target.value,renderGuidanceSession)}/><small>기본설정의 브랜드가 자동으로 입력됩니다.</small></label>
        <label>상품 특징<input aria-label="SEO 상품 특징" value={memo.features} maxLength={2000} disabled={busy||hasRequest||generationBusy||generationPending} placeholder="상품 특징을 입력하세요 (예: 인조가죽 등)" onChange={event=>edit('features',event.target.value)} onBlur={event=>blur('features',event.target.value,renderGuidanceSession)}/><small>상품명에 포함할 주요 특징을 입력하세요.</small></label>
        <label>타겟 키워드 *<input aria-label="SEO 타겟 키워드" aria-required="true" value={memo.keywords} maxLength={2000} disabled={busy||hasRequest||generationBusy||generationPending} placeholder="핵심 타겟 키워드를 입력하세요" onChange={event=>edit('keywords',event.target.value)} onBlur={event=>blur('keywords',event.target.value,renderGuidanceSession)}/><small>이 키워드를 중심으로 상품명을 구성합니다.</small></label>
      </div>
      <div className="seo-title-example"><strong>생성될 상품명 예시:</strong> {titleExample}</div>
      {!google&&basis?.configuration.configured&&<details className="seo-generation-provider" aria-label="SEO 번역 모델·사용료"><summary>번역 모델·사용료</summary><small>{basis.configuration.model?.startsWith('@cf/')?'Cloudflare Workers AI':'설정된 AI 서비스'} · {basis.configuration.model} · 최대 출력 {basis.configuration.maxOutputTokens}토큰 · 사용량에 따라 비용이 발생할 수 있습니다.</small></details>}
      {!google&&basis?.configuration.configured&&<label className="seo-ai-consent"><input type="checkbox" checked={confirmAi} disabled={busy} onChange={event=>{if(mounted.current&&current.current.version===version&&current.current.active&&!request.current)setConfirmAi(event.target.checked);}}/> AI 초안 생성 요청 1회를 실행합니다. 서비스 사용량에 따라 비용이 발생할 수 있습니다.</label>}
      {!!basis?.remainingOptions&&<small>이번 요청 한도를 넘는 옵션 번역 항목 {basis.remainingOptions}개는 원문에 유지됩니다. 추가 번역은 아래 생성 이력에서 이어갈 수 있습니다.</small>}
      {busy&&<p role="status">{basis?'초안 요청 상태를 확인하고 있습니다…':'수집 원문을 불러오는 중입니다…'}</p>}
      {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
      {guidanceError&&<p role="alert">{guidanceError}</p>}
      {error&&(!basis||basis.productVersion!==version)&&<button className="btn ghost" type="button" disabled={busy} onClick={()=>setAttempt(value=>value+1)}>수집 원문 다시 조회</button>}
      {basis&&!basis.configuration.configured&&<p role="alert">{basis.configuration.issues.join(' ')}</p>}
      <div className="seo-generation-actions"><button className="btn ghost" type="button" disabled={busy||compositionBusy||generationBusy||generationPending||recoveryInvalid||!basis?.configuration.configured||basis.productVersion!==version||(!hasRequest&&!memo.keywords.trim())||failedQwenRetry&&!confirmAi} onClick={()=>void generate()}>{failedQwenRetry?'실패한 Qwen 새 초안':hasRequest&&!job?'같은 초안 요청 확인':!basis?'초안 작성':google?'한국어 초안 자동 작성':'AI로 자동 생성'}</button>
        {hasRequest&&<button className="btn ghost" type="button" disabled={busy||compositionBusy} onClick={()=>void generate(true)}>초안 상태 조회</button>}
        {hasRequest&&closed&&<button className="btn ghost" type="button" disabled={busy||compositionBusy||applyUncertain} onClick={()=>{if(!mounted.current||current.current.version!==version||!current.current.active||request.current||compositionBusyRef.current||applyUncertain)return;if(basis&&draftState.current&&supplierSourceIdentity(draftState.current.source)!==basis.sourceIdentity)setMemo(basis.initialMemo);draftState.current=null;setHasRequest(false);setClosed(false);setJob(null);setConfirmAi(false);setCompositionTitle(null);setCompositionKeywords(null);setCompositionEnabled(true);setReplaceTitle(false);setReplaceKeywords(false);setMessage('새 요청의 입력을 준비했습니다. 작성 버튼을 누르면 새 초안을 요청합니다.');try{sessionStorage.removeItem(storageKey);}catch{}}}>새 초안 입력</button>}
      </div>
      <details className="seo-generation-provider seo-generation-provider-tools"><summary>생성 방식·이전 AI 요청 확인</summary><SeoGenerationPanel productId={productId} workspaceOwnerId={workspaceOwnerId} version={version} memo={memo} active={active} disabled={busy||hasRequest||compositionBusy||!basis}
        beforeGenerate={beforeGenerate} onBusyChange={setGenerationBusy} onPendingChange={setGenerationPending} onSaved={onSaved} onApplied={onApplied}
        onRestoreMemo={value=>{setMemo(value);current.current.memo=value;}}/></details>
      {google&&<details className="seo-generation-provider"><summary>초안 작성 방법</summary><small>무료 Google 번역으로 원문을 한국어로 옮긴 뒤 브랜드·짧은 특징·타겟을 반영한 상품명과 검색태그 구성안을 확인하고 수정합니다.</small></details>}
      {google&&basis?.workersFailedJobId&&<div className="panel-note" aria-label="중국어→한국어 번역 초안"><button type="button" className="btn blue" disabled={busy||compositionBusy||applyUncertain||!active||workersSeoRecoveryM2mLimit(basis.workersRecovery)===null} onClick={()=>void prepareWorkers()}>중국어→한국어 번역 초안</button><p>Google 번역 제한으로 완료되지 않은 저장 원문을 전용 번역 모델로 준비합니다. 먼저 전송 원문과 호출 횟수를 검토·승인하며, 번역 후 원하는 항목만 직접 적용합니다. 작성 중인 입력은 그대로 유지됩니다.</p>{workersSeoRecoveryM2mLimit(basis.workersRecovery)===null&&<small>무료 전용 번역 연결 설정을 확인해야 사용할 수 있습니다.</small>}</div>}
      {active&&workersReview?.productVersion===version&&workersReview.ownerId===workspaceOwnerId&&<TranslationPanel productId={productId} version={version} title={basis?.source.title??''} initialJobId={workersReview.jobId} initialReviewFingerprint={workersReview.fingerprint} reviewOnly onContentSaved={()=>{if(mounted.current&&current.current.active&&current.current.version===version&&current.current.workspaceOwnerId===workspaceOwnerId)statusCallbacks.current.onSaved();}}/>}
      {hasResult&&<div className="seo-generated-result"><h4>작성된 초안</h4><dl><dt>상품명</dt><dd>{job.result!.draft.title}</dd><dt>검색태그</dt><dd>{job.result!.draft.keywords.join(', ')}</dd></dl>
        {compositionInput&&<fieldset disabled={busy||compositionBusy||!active} aria-label="사용자 SEO 구성안"><legend>브랜드 · 특징 · 타겟 반영</legend>
          <label className="seo-ai-consent"><input type="checkbox" aria-label="사용자 SEO 구성안 적용" checked={compositionEnabled} onChange={event=>editComposition(()=>setCompositionEnabled(event.target.checked))}/> 아래 구성안을 함께 저장</label>
          <p>입력한 특징과 검색어를 바탕으로 만든 편집 가능한 구성안입니다. 상품명에 사용할 짧은 표현을 확인해주세요.</p>
          <label className="field">구성 상품명<input aria-label="SEO 구성 상품명" value={compositionInput.title} onChange={event=>editComposition(()=>setCompositionTitle(event.target.value))}/><small>{compositionInput.title.length}/100자 · 초과값은 자르지 않습니다.</small></label>
          <label className="field">타겟 검색태그<input aria-label="SEO 구성 타겟 검색태그" value={compositionInput.keywords} maxLength={2000} onChange={event=>editComposition(()=>setCompositionKeywords(event.target.value))}/><small>쉼표로 구분 · 태그별 20자, 전체 150자</small></label>
          {basis?.savedSeo?.title.provenance==='manual'&&<label className="seo-ai-consent"><input type="checkbox" aria-label="저장된 상품명 교체" checked={replaceTitle} onChange={event=>editComposition(()=>setReplaceTitle(event.target.checked))}/> 저장된 상품명도 구성안으로 교체 · 현재: {basis.savedSeo.title.value||'(직접 저장한 공란)'}</label>}
          {basis?.savedSeo?.keywords.provenance==='manual'&&<label className="seo-ai-consent"><input type="checkbox" aria-label="저장된 검색태그 교체" checked={replaceKeywords} onChange={event=>editComposition(()=>setReplaceKeywords(event.target.checked))}/> 저장된 검색태그도 구성안으로 교체 · 현재: {basis.savedSeo.keywords.value.join(', ')||'(직접 저장한 공란)'}</label>}
          {compositionError&&<p role="alert">{compositionError} 구성안을 해제하면 원문 번역·옵션은 그대로 검토하여 저장할 수 있습니다.</p>}
          {!compositionError&&<p>저장할 검색태그: {compositionTags.join(', ')||'(공란)'}</p>}
          {!!omittedTags.length&&<small>타겟을 우선 반영하여 전체 한도에 들어가지 않는 번역 상품명 검색어는 제외합니다: {omittedTags.join(', ')}</small>}
        </fieldset>}
        {!!job.result!.draft.warnings.length&&<ul>{job.result!.draft.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}
        <TranslationIntegratedPreview productId={productId} version={version} jobId={job.id} disabled={busy||!active||applyUncertain||(compositionEnabled&&!!compositionError)} seoComposition={compositionEnabled?composition:undefined} onBusyChange={compositionPublisher} beforeApply={()=>currentComposition()&&!applyUncertainRef.current&&beforeGenerate()}
          onApplied={receipt=>{if(currentComposition()&&sameSeoAppliedSource(receipt,productId,version)&&receipt.jobId===job.id)statusCallbacks.current.onApplied?.(receipt);}}
          onUncertainChange={value=>{if(currentComposition()){applyUncertainRef.current=value;setApplyUncertain(value);}}} onSaved={()=>{if(currentComposition()){applyUncertainRef.current=false;setApplyUncertain(false);statusCallbacks.current.onSaved();}}}/>
      </div>}
    </div>
  </section>;
}
