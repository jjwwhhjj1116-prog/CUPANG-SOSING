'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranslationJob, TranslationView } from '@/app/automation/translation';
import { optionTranslationBatch } from '@/app/option-translation';
import type { ProductOptionsResponse } from '@/app/product-options';
import type { ProductContent } from '@/app/product-content';
import { translationAdoptionInput, translationSeoFields, type TranslationSeoField } from '@/app/translation-adoption';
import { collectedTranslationAttributes } from '@/app/collected-translation-attributes';
import { translationLabelAdoption, type TranslationLabelMapping } from '@/app/translation-label-adoption';
import { TranslationLabelMappingEditor } from '@/app/components/translation-label-mapping';
import { TranslationBatchPreview } from '@/app/components/translation-batch-preview';
import { TranslationIntegratedPreview } from '@/app/components/translation-integrated-preview';
import { runReviewedTranslation, translationReviewExpired } from '@/app/reviewed-translation';
import { newOptionsRetryState, parseOptionsRetryState, retryOptionsTranslation, type OptionsRetryState } from '@/app/options-translation-retry';
import {newSeoRetryState,parseSeoRetryState,prepareSeoTranslationRetry,executeSeoTranslationRetry,seoRetryReviewProof,type SeoRetryState} from '@/app/seo-translation-retry';

type Props = { productId: string; version: string; title: string; onContentSaved?: () => void };
type RequestContext = { categoryId: string; categoryPath: string[]; features: string; keywords: string; capturedAt: string };
type CollectedSource = { error?:string; title:string; description:string; attributes?:{name:string;value:string}[]; jobId:string; sourceUrl:string; productVersion:string; message:string; requestContext?:RequestContext|null };
function validateCollectedSource(value: CollectedSource, version: string) {
  if(value.productVersion!==version)throw Error('상품이 변경되었습니다. 최신 상품을 다시 열어주세요.');
  if(typeof value.title!=='string'||typeof value.description!=='string'||!value.jobId||typeof value.sourceUrl!=='string')throw Error('수집 원문의 형식을 확인하지 못했습니다.');
  collectedTranslationAttributes(value.attributes??[]);
  if(value.requestContext && (typeof value.requestContext.features!=='string'||typeof value.requestContext.keywords!=='string'||!Array.isArray(value.requestContext.categoryPath)))throw Error('수집 당시 상품 특징·키워드를 확인하지 못했습니다.');
}
function collectedOptionText(source: CollectedSource, options: ProductOptionsResponse, productId: string, version: string,recoveryJobs:readonly TranslationJob[] = []) {
  if(options.productVersion!==version||options.options?.productId!==productId)throw Error('옵션과 현재 상품이 일치하지 않습니다. 최신 상품을 다시 열어주세요.');
  const batch=optionTranslationBatch(options.options,50-(source.attributes?.length??0),recoveryJobs); const pairs=batch.attributes;
  if(pairs.some(pair=>/[\r\n]/.test(pair.value)))throw Error('여러 줄 옵션 원문은 옵션 편집에서 한 줄로 정리해주세요.');

  return {text:pairs.map(pair=>`${pair.name}=${pair.value}`).join('\n'),remaining:batch.remaining};
}
function batchRemainder(count:number){return count?` 남은 옵션 번역 항목 ${count}개는 저장 원문에 유지됩니다. 이번 결과를 저장한 뒤 미번역 옵션 불러오기로 다음 분량을 준비하세요.`:'';}
const statuses: Record<TranslationJob['status'], string> = { prepared: '검토 대기', approved: '승인됨 · 실행 대기', running: '실행 중 · 중복 실행 차단', completed: '초안 생성 완료', failed: '실패 · 재호출 안 함', uncertain: '결과 확인 필요 · 재호출 안 함' };

async function readTranslationState(productId:string,signal:AbortSignal){
  const [view,content]=await Promise.all([
    fetch(`/api/products/${encodeURIComponent(productId)}/translation`,{cache:'no-store',signal}).then(async response=>{
      const value=await response.json() as TranslationView & {error?:string};
      if(!response.ok||!Array.isArray(value.jobs)||!value.configuration)throw Error(value.error??'번역 작업을 불러오지 못했습니다.');return value;
    }),
    fetch(`/api/products/${encodeURIComponent(productId)}/content`,{cache:'no-store',signal}).then(async response=>{
      const value=await response.json() as {content?:ProductContent;error?:string};
      if(!response.ok||!value.content)throw Error(value.error??'현재 콘텐츠를 불러오지 못했습니다.');return value.content;
    }),
  ]);
  return {view,content};
}

export default function TranslationPanel(props: Props) { return <TranslationContent key={`${props.productId}:${props.version}`} {...props} />; }
function TranslationContent({ productId, version, title, onContentSaved }: Props) {
  const [view, setView] = useState<TranslationView | null>(null);
  const [content, setContent] = useState<ProductContent | null>(null);
  const [sourceTitle, setSourceTitle] = useState(title);
  const [description, setDescription] = useState('');
  const [sourceReference,setSourceReference]=useState('저장 상품명과 사용자가 검토한 직접 입력 원문');
  const [requestContext,setRequestContext]=useState<RequestContext|null>(null);
  const [guidance,setGuidance]=useState({features:'',keywords:''});
  const [includeGuidance,setIncludeGuidance]=useState(true);
  const [attributes, setAttributes] = useState('');
  const [collectedAttributes, setCollectedAttributes] = useState<{name:string;value:string}[]>([]);
  const [includeCollectedAttributes, setIncludeCollectedAttributes] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedFields, setSelectedFields] = useState<TranslationSeoField[]>([]);
  const retryState = useRef<OptionsRetryState | null>(null);
  const [hasOptionsRetry,setHasOptionsRetry] = useState(false);
  const seoRetryState=useRef<SeoRetryState|null>(null);
  const [hasSeoRetry,setHasSeoRetry]=useState(false);
  const activeRequest=useRef<AbortController|null>(null);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;activeRequest.current?.abort();};},[]);
  useEffect(()=>{
    let current=true;
    void Promise.resolve().then(()=>{
      if(!current||!mounted.current)return;
      try {
        const raw=sessionStorage.getItem(`yoofam-options-retry:${productId}`);
        const saved=raw && raw.length<=4096 ? parseOptionsRetryState(JSON.parse(raw),productId) : null;
        if(!current||!mounted.current)return;
        retryState.current=saved||null;setHasOptionsRetry(!!saved);
      } catch { if(current&&mounted.current){retryState.current=null;setHasOptionsRetry(false);} }
    });
    return()=>{current=false;};
  },[productId]);
  useEffect(()=>{
    let current=true;
    void Promise.resolve().then(()=>{
      if(!current||!mounted.current)return;
      try{const raw=sessionStorage.getItem(`yoofam-seo-retry:${productId}`),saved=raw&&raw.length<=4096?parseSeoRetryState(JSON.parse(raw),productId):null;
        if(!current||!mounted.current)return;seoRetryState.current=saved||null;setHasSeoRetry(!!saved);
      }catch{if(current&&mounted.current){seoRetryState.current=null;setHasSeoRetry(false);}}
    });return()=>{current=false;};
  },[productId]);
  function beginRequest(allowMissing=false){
    if(!mounted.current||activeRequest.current||(!allowMissing&&(!view||!content)))return null;
    const controller=new AbortController();activeRequest.current=controller;return controller;
  }
  function finishRequest(controller:AbortController){
    if(activeRequest.current===controller){activeRequest.current=null;if(mounted.current)setBusy(false);}
  }
  const job = view?.jobs.find(item => item.id === selectedId) ?? view?.jobs[0] ?? null;
  const intakeOptionsJob = Boolean(job && Object.hasOwn(job.review,'intakeOptions'));
  const optionsOnlyJob = Boolean(job && (Object.hasOwn(job.review,'optionsRetry') || intakeOptionsJob));
  const seoRetryJob=Boolean(job&&Object.hasOwn(job.review,'seoRetry'));
  const googleSource = view?.configuration.model === 'google-translate-gtx';
  const stale = Boolean(job && (job.productVersion !== version || (content && job.contentRevision !== content.revision)));
  const expired = Boolean(job && translationReviewExpired(job));
  const applyCollectedSource = useCallback((value: CollectedSource) => {
    setRequestContext(value.requestContext??null);setGuidance({features:value.requestContext?.features??'',keywords:value.requestContext?.keywords??''});setIncludeGuidance(true);
    setSourceTitle(value.title);setDescription(value.description);setCollectedAttributes(value.attributes??[]);setIncludeCollectedAttributes(true);
    setSourceReference(`수집 요청 ${value.jobId} (${value.sourceUrl})에서 가져와 사용자가 검토·편집한 원문`);
  }, []);
  useEffect(() => {
    const controller=new AbortController();activeRequest.current=controller;
    readTranslationState(productId,controller.signal)
      .then(async next=>{
        if(controller.signal.aborted)return;
        setView(next.view);setContent(next.content);
        // Saving a batch changes the product/content version. Historical jobs
        // must not disable source prefill for the next batch of pending options.
        // A current job still keeps its existing workflow untouched.
        if(next.view.jobs.some(item=>item.productVersion===version&&item.contentRevision===next.content.revision))return;
        try {
          const response=await fetch(`/api/products/${encodeURIComponent(productId)}/translation-source`,{cache:'no-store',signal:controller.signal});
          if(controller.signal.aborted||response.status===404)return;
          const value=await response.json() as CollectedSource;
          if(controller.signal.aborted)return;
          if(!response.ok)throw Error(value.error??'수집 원문 조회 실패');
          validateCollectedSource(value,version);
          const optionResponse=await fetch(`/api/products/${encodeURIComponent(productId)}/options`,{cache:'no-store',signal:controller.signal});
          if(controller.signal.aborted)return;
          const options=await optionResponse.json() as ProductOptionsResponse & {error?:string};
          if(controller.signal.aborted)return;
          if(!optionResponse.ok)throw Error(options.error??'옵션 조회 실패');
          const optionText=collectedOptionText(value,options,productId,version);
          applyCollectedSource(value);setAttributes(optionText.text);
          setNotice('수집 원문·상품 속성·특징·키워드와 미번역 옵션명·수집 색상·사이즈를 자동으로 불러왔습니다. 검토 후 번역 요청을 준비하세요. AI 호출과 상품 저장은 실행하지 않았습니다.'+batchRemainder(optionText.remaining));
        }catch(reason){if(!controller.signal.aborted)setNotice(`${reason instanceof Error?reason.message:'수집 원문 조회 실패'} 원문 불러오기로 다시 시도하거나 직접 입력할 수 있습니다.`);}
      })
      .catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'조회 실패');})
      .finally(()=>finishRequest(controller));
    return () => controller.abort();
  }, [productId, version, applyCollectedSource]);

  async function refreshState(){
    const controller=beginRequest(true);if(!controller)return;
    setBusy(true);setError('');setNotice('');
    try{
      const next=await readTranslationState(productId,controller.signal);if(controller.signal.aborted)return;
      setView(next.view);setContent(next.content);
      setSelectedId(previous=>next.view.jobs.some(item=>item.id===previous)?previous:next.view.jobs[0]?.id??null);
      setConfirmed(false);setSelectedFields([]);
      setNotice('서버에 저장된 작업 상태와 콘텐츠를 다시 읽었습니다. 작성 중인 원문·참고 메모는 유지했으며 AI 호출이나 상품 저장은 하지 않았습니다.');
    }catch(reason){if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'작업 상태 조회 실패');}
    finally{finishRequest(controller);}
  }

  async function action(body: Record<string, unknown>) {
    const controller=beginRequest();if(!controller)return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/products/${productId}/translation`, { signal:controller.signal, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const value = await response.json() as { job?: TranslationJob; configuration?: TranslationView['configuration']; error?: string; message?: string };if(controller.signal.aborted)return;
      if (!response.ok || !value.job) throw Error(value.error ?? '번역 요청을 처리하지 못했습니다.');
      const saved = value.job;
      setView(previous => ({ configuration: value.configuration ?? previous!.configuration, jobs: [saved, ...(previous?.jobs ?? []).filter(item => item.id !== saved.id)] }));
      setSelectedId(saved.id); setConfirmed(false); setSelectedFields([]);
      if (value.message) setNotice(value.message);
    } catch (reason) { if(!controller.signal.aborted)setError(reason instanceof Error ? reason.message : '요청 실패'); }
    finally { finishRequest(controller); }
  }
  async function writeReviewedDraft() {
    if (!job || optionsOnlyJob || stale || expired || (job.status === 'prepared' && !confirmed)) return;
    const controller=beginRequest();if(!controller)return;
    setBusy(true);setError('');setNotice('SEO 초안 작성 중…');
    try {
      if(seoRetryJob){
        const proof=seoRetryReviewProof(job.review);if(!proof)throw Error('SEO 재시도 범위를 확인해주세요.');
        const state=seoRetryState.current??{productId,productVersion:job.productVersion,retryKey:proof.retryKey,jobId:job.id,executeSubmitted:job.status!=='prepared'};
        if(state.jobId!==null&&state.jobId!==job.id||state.retryKey!==proof.retryKey)throw Error('다른 SEO 재시도가 진행 중입니다. 먼저 저장 상태를 확인해주세요.');
        persistSeoRetry(state,controller);
        const result=await executeSeoTranslationRetry(state,{signal:controller.signal,fetcher:(input,init)=>fetch(input,init),onState:saved=>persistSeoRetry(saved,controller),onJob:saved=>showSeoRetryJob(saved,controller)});
        if(controller.signal.aborted)return;if(result.closed)clearSeoRetry();setNotice(result.message);return;
      }
      const result=await runReviewedTranslation(productId,job,{signal:controller.signal,fetcher:(input,init)=>fetch(input,init),onJob:saved=>{
        if(controller.signal.aborted)return;
        setView(previous=>previous?{...previous,jobs:[saved,...previous.jobs.filter(item=>item.id!==saved.id)]}:previous);
        setSelectedId(saved.id);setConfirmed(false);setSelectedFields([]);
      }});
      if(controller.signal.aborted)return;
      setNotice(result?.message??(result?.job.status==='completed'?'SEO 초안이 작성되었습니다. 아래 결과를 확인하고 적용해주세요.':result?.job.status==='running'?'SEO 초안을 작성하고 있습니다. 잠시 후 작업 상태를 조회해주세요.':''));
    }catch(reason){if(!controller.signal.aborted){setNotice('');setError(reason instanceof Error?reason.message:'SEO 초안 작성 상태를 확인하지 못했습니다.');}}
    finally{finishRequest(controller);}
  }
  function persistSeoRetry(state:SeoRetryState,controller:AbortController){
    seoRetryState.current=state;try{sessionStorage.setItem(`yoofam-seo-retry:${productId}`,JSON.stringify(state));}catch{}
    if(mounted.current&&!controller.signal.aborted)setHasSeoRetry(true);
  }
  function clearSeoRetry(){seoRetryState.current=null;setHasSeoRetry(false);try{sessionStorage.removeItem(`yoofam-seo-retry:${productId}`);}catch{}}
  function showSeoRetryJob(saved:TranslationJob,controller:AbortController){
    if(!mounted.current||controller.signal.aborted)return;
    setView(previous=>previous?{...previous,jobs:[saved,...previous.jobs.filter(item=>item.id!==saved.id)]}:previous);
    setSelectedId(saved.id);setConfirmed(false);setSelectedFields([]);
  }
  async function prepareFreshSeo(){
    if(!googleSource||!view?.configuration.configured)return;
    const controller=beginRequest();if(!controller)return;setBusy(true);setError('');setNotice('현재 원문으로 SEO 요청을 준비하고 있습니다…');
    const state=seoRetryState.current??newSeoRetryState(productId,version);persistSeoRetry(state,controller);
    try{const result=await prepareSeoTranslationRetry(state,{signal:controller.signal,fetcher:(input,init)=>fetch(input,init),onState:saved=>persistSeoRetry(saved,controller),onJob:saved=>showSeoRetryJob(saved,controller)});
      if(controller.signal.aborted)return;if(result.closed)clearSeoRetry();setNotice(result.message);
    }catch(reason){if(!controller.signal.aborted){setNotice('');setError(reason instanceof Error?reason.message:'SEO 준비 상태를 확인하지 못했습니다.');}}
    finally{finishRequest(controller);}
  }
  async function retryFreeOptions() {
    if(!googleSource||!view?.configuration.configured)return;
    const controller=beginRequest();if(!controller)return;
    setBusy(true);setError('');setNotice(hasOptionsRetry?'같은 옵션 번역의 저장 상태를 확인하고 있습니다…':'미번역 옵션을 한국어로 채우고 있습니다…');
    const persist=(state:OptionsRetryState)=>{
      retryState.current=state;
      try {sessionStorage.setItem(`yoofam-options-retry:${productId}`,JSON.stringify(state));} catch { /* The in-memory nonce still prevents duplicate requests. */ }
      if(mounted.current&&!controller.signal.aborted)setHasOptionsRetry(true);
    };
    const state=retryState.current??newOptionsRetryState(productId,version);persist(state);
    try {
      const outcome=await retryOptionsTranslation(state,{signal:controller.signal,fetcher:(input,init)=>fetch(input,init),onState:persist,onJob:saved=>{
        if(!mounted.current||controller.signal.aborted)return;
        setView(previous=>previous?{...previous,jobs:[saved,...previous.jobs.filter(item=>item.id!==saved.id)]}:previous);
        setSelectedId(saved.id);setConfirmed(false);setSelectedFields([]);
      }});
      if(controller.signal.aborted)return;
      if(outcome.done){retryState.current=null;setHasOptionsRetry(false);try{sessionStorage.removeItem(`yoofam-options-retry:${productId}`);}catch{}}
      setNotice(outcome.message);
      if(outcome.saved)onContentSaved?.();
    }catch(reason){if(!controller.signal.aborted){setNotice('');setError(reason instanceof Error?reason.message:'옵션 번역 저장 상태를 확인하지 못했습니다.');}}
    finally{finishRequest(controller);}
  }
  async function loadCollectedSource(includeOptions = false) {
    const controller=beginRequest();if(!controller)return;
    setBusy(true);setError('');setNotice('');
    try {
      const [response, optionResponse]=await Promise.all([
        fetch(`/api/products/${encodeURIComponent(productId)}/translation-source`,{cache:'no-store',signal:controller.signal}),
        includeOptions ? fetch(`/api/products/${encodeURIComponent(productId)}/options`,{cache:'no-store',signal:controller.signal}) : Promise.resolve(null),
      ]);
      const value=await response.json() as CollectedSource;if(controller.signal.aborted)return;
      if(!response.ok)throw Error(value.error??'원문 조회 실패');
      validateCollectedSource(value,version);
      let optionText: ReturnType<typeof collectedOptionText> | null = null;
      if(optionResponse) {
        const optionSource=await optionResponse.json() as ProductOptionsResponse & {error?:string};
        if(controller.signal.aborted)return;
        if(!optionResponse.ok)throw Error(optionSource.error??'옵션 조회 실패');
        optionText=collectedOptionText(value,optionSource,productId,version,view?.jobs);
      }
      if(optionText!==null)setAttributes(optionText.text);
      applyCollectedSource(value);
      setNotice(value.message+(includeOptions?' 미번역 옵션명·수집 색상·사이즈도 함께 불러왔습니다.':'')+' 입력란만 채웠으며 번역 호출이나 상품 저장은 하지 않았습니다.'+batchRemainder(optionText?.remaining??0));
    }catch(reason){if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'원문 조회 실패');}
    finally{finishRequest(controller);}
  }
  async function loadOptionSource() {
    const controller=beginRequest();if(!controller)return;
    setBusy(true);setError('');setNotice('');
    try {
      const response=await fetch(`/api/products/${encodeURIComponent(productId)}/options`,{cache:'no-store',signal:controller.signal});
      const value=await response.json() as ProductOptionsResponse & {error?:string};if(controller.signal.aborted)return;
      if(!response.ok)throw Error(value.error??'옵션 조회 실패');
      if(value.productVersion!==version)throw Error('상품이 변경되었습니다. 최신 상품을 다시 열어주세요.');
      if(value.options?.productId!==productId)throw Error('다른 상품의 옵션입니다.');
      const batch=optionTranslationBatch(value.options,50-(includeCollectedAttributes?collectedAttributes.length:0),view?.jobs); const pairs=batch.attributes;
      if(!pairs.length)throw Error(batch.remaining?'상품 속성이 요청 한도 50개를 사용합니다. 상품 속성의 번역 포함을 해제한 뒤 옵션을 불러와주세요.':'번역할 미번역 옵션이 없습니다.');
      if(pairs.some(pair=>/[\r\n]/.test(pair.value)))throw Error('여러 줄 옵션 원문은 옵션 편집에서 한 줄로 정리해주세요.');
      setAttributes(pairs.map(pair=>`${pair.name}=${pair.value}`).join('\n'));
      setNotice(`미번역 옵션명·수집 색상·사이즈 ${pairs.length}개 항목을 번역 검토에 넣었습니다. 이전 결과에 원문 그대로 남은 중국어 옵션도 포함합니다. 아직 생성 요청하지 않았습니다.`+batchRemainder(batch.remaining));
    }catch(reason){if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'옵션 조회 실패');}
    finally{finishRequest(controller);}
  }
  function prepare() {
    if(activeRequest.current||!mounted.current)return;
    let pairs: { name: string; value: string }[];
    try { pairs = includeCollectedAttributes ? collectedTranslationAttributes(collectedAttributes) : []; }
    catch (cause) { setError(cause instanceof Error ? cause.message : '상품 속성을 확인해주세요.'); return; }
    for (const line of attributes.split('\n').map(value => value.trim()).filter(Boolean)) {
      const index = line.indexOf('=');
      if (index <= 0 || index === line.length - 1) { setError('속성은 한 줄에 속성명=원문 값 형식으로 입력해주세요.'); return; }
      pairs.push({ name: line.slice(0, index).trim(), value: line.slice(index + 1).trim() });
    }
    if (pairs.length > 50) { setError('상품 속성·옵션·직접 입력 속성은 합계 50개까지입니다. 상품 속성 포함을 해제하거나 입력을 나누어주세요.'); return; }
    void action({ action: 'prepare', expectedVersion: version, idempotencyKey: crypto.randomUUID(),
      source: { title: sourceTitle, description, attributes: pairs, provenance: 'manual', reference: sourceReference, ...(requestContext?.categoryId && requestContext.categoryPath.length ? {category:{id:requestContext.categoryId,path:requestContext.categoryPath}} : {}), ...(includeGuidance&&(guidance.features.trim()||guidance.keywords.trim())?{guidance}:{}) } });
  }
  async function adopt(fields: readonly TranslationSeoField[], labels?: readonly TranslationLabelMapping[], batch?: ReturnType<typeof translationAdoptionInput>) {
    if (!content || !job?.result || optionsOnlyJob) return;
    const controller=beginRequest();if(!controller)return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/products/${productId}/content`, { signal:controller.signal, method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(batch ?? (labels ? translationLabelAdoption(content, job, version, labels).input : translationAdoptionInput(content, job, version, fields))) });
      const value = await response.json() as { content?: ProductContent; error?: string };if(controller.signal.aborted)return;
      if (!response.ok || !value.content) throw Error(value.error ?? '초안을 적용하지 못했습니다.');
      setContent(value.content); setSelectedFields([]); setNotice('선택한 항목을 함께 저장했습니다. 선택하지 않은 편집 항목은 보존했습니다.'); onContentSaved?.();
    } catch (reason) { if(!controller.signal.aborted)setError(reason instanceof Error ? reason.message : '적용 실패'); }
    finally { finishRequest(controller); }
  }
  return <section className="translation-panel" aria-label="원문 번역과 SEO 초안" data-workspace-saving={busy} data-quotation-source-step="SEO">
    <h4>원문 번역 · SEO 초안</h4>
    <button type="button" className="btn" disabled={busy} onClick={()=>void refreshState()}>작업 상태 다시 조회 · 무료</button>
    <p>저장된 원문으로 한국어 초안을 생성합니다. 아래 직접 입력 내용은 자동 수집 증빙으로 기록되지 않습니다.</p>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {requestContext&&<aside className="panel-note" aria-label="상품 추가 당시 요청"><strong>상품 추가 당시 요청</strong><p>{requestContext.categoryPath.join(' › ')} · {requestContext.categoryId}</p><dl><dt>상품 특징</dt><dd style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{requestContext.features||'입력 없음'}</dd><dt>타겟 키워드</dt><dd style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{requestContext.keywords||'입력 없음'}</dd></dl><small>{googleSource?'카테고리와 상품 특징·키워드는 검토 자료로 보관합니다. Google에는 카테고리·참고 메모를 전송하지 않습니다.':'선택한 카테고리 코드·경로를 번역 요청에 참고 정보로 포함합니다. 상품 특징·키워드는 아래 SEO 참고 메모에서 편집하거나 제외할 수 있습니다.'}</small></aside>}
    {!view && !error && <p>번역 설정을 확인하고 있습니다.</p>}
    {view && <>
      {!view.configuration.configured && <div className="connection-note"><strong>서버 연결 설정이 필요합니다</strong><ul>{view.configuration.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
      {googleSource&&<div className="panel-note"><button className="btn blue" type="button" disabled={busy||!view.configuration.configured} onClick={()=>void prepareFreshSeo()}>{hasSeoRetry?'SEO 재시도 상태 확인 · 무료':'현재 상품 원문으로 SEO 요청 다시 준비'}</button><p>상품명·설명만 새 번역 요청으로 준비합니다. 실패·부분 결과는 유지하며, 원문 검토와 승인을 거쳐 받은 새 초안에서 원하는 항목만 적용합니다. 직접 수정한 값과 다른 단계는 자동으로 저장하지 않습니다.</p></div>}
      {googleSource&&<div className="panel-note"><button className="btn blue" type="button" disabled={busy||!view.configuration.configured} onClick={()=>void retryFreeOptions()}>{hasOptionsRetry?'옵션 번역 재시도 상태 확인 · 무료':'미번역 옵션 한국어로 채우기 · 무료'}</button><p>저장된 1688 원문에서 아직 번역하지 않은 포함 옵션만 한 묶음씩 번역해 저장합니다. 직접 입력하거나 비운 값, 제외 옵션, SEO·표시사항·가격은 유지합니다. 429 또는 일부 번역 실패 후에도 자동 재호출하지 않습니다.</p></div>}
      <button className="btn blue" type="button" disabled={busy} onClick={()=>void loadCollectedSource(true)}>수집 원문·미번역 옵션 함께 불러오기 · 입력 교체</button><button className="btn" type="button" disabled={busy} onClick={()=>void loadCollectedSource()}>수집 원문 불러오기 · 상품명·설명·상품 속성 입력 교체</button><small>{googleSource?'함께 불러온 옵션 텍스트도 한국어로 번역합니다. 이미지 번역은 별도입니다. 불러온 원문은 전송 전에 수정하고 검토할 수 있습니다.':'옵션·이미지 번역은 별도입니다. 불러온 원문도 전송 전에 수정하고 검토할 수 있습니다.'}</small><label>상품명 원문<input value={sourceTitle} maxLength={1000} onChange={event => setSourceTitle(event.target.value)} disabled={busy} /></label>
      <fieldset disabled={busy}><legend>SEO 참고 메모</legend><label><input type="checkbox" checked={includeGuidance} onChange={event=>setIncludeGuidance(event.target.checked)}/>{googleSource?'검토 요청에 참고 메모 보관':'초안 생성에 참고 메모 포함'}</label><label>강조할 상품 특징<textarea maxLength={2000} value={guidance.features} onChange={event=>setGuidance(previous=>({...previous,features:event.target.value}))}/></label><label>타겟 키워드<textarea maxLength={2000} value={guidance.keywords} onChange={event=>setGuidance(previous=>({...previous,keywords:event.target.value}))}/></label><small>{googleSource?'참고 메모는 Google 번역에 사용하지 않습니다. 저장한 메모를 참고해 번역 결과를 직접 검토하고 수정해주세요.':'원문에서 확인되는 특징과 관련 키워드만 반영하도록 요청합니다. 상품 사실을 추가하는 근거로 사용하지 않으며, 생성 결과는 검토 후 적용합니다.'}</small></fieldset>
      <label>상품 설명 원문<textarea rows={5} value={description} maxLength={20000} onChange={event => setDescription(event.target.value)} disabled={busy} /></label>
      {collectedAttributes.length > 0 && <fieldset disabled={busy}><legend>수집 상품 속성 원문 · {collectedAttributes.length}개</legend><label><input type="checkbox" checked={includeCollectedAttributes} onChange={event=>setIncludeCollectedAttributes(event.target.checked)}/>번역에 포함</label><p>판매자가 기재한 원문입니다. 옵션·직접 입력 속성은 별도로 유지합니다.</p>{collectedAttributes.map((pair,index)=><div key={index}><label>속성명<input maxLength={190} value={pair.name} onChange={event=>setCollectedAttributes(previous=>previous.map((item,i)=>i===index?{...item,name:event.target.value}:item))}/></label><label>속성값<textarea maxLength={1000} value={pair.value} onChange={event=>setCollectedAttributes(previous=>previous.map((item,i)=>i===index?{...item,value:event.target.value}:item))}/></label></div>)}</fieldset>}
      <button className="btn" type="button" disabled={busy} onClick={()=>void loadOptionSource()}>미번역 옵션 불러오기 · 속성 입력 교체</button><label>속성 원문 · 한 줄에 속성명=값<textarea rows={3} value={attributes} onChange={event => setAttributes(event.target.value)} disabled={busy} placeholder={'材质=棉\n颜色=白色'} /></label>
      <button className="btn" type="button" onClick={prepare} disabled={busy || !view.configuration.configured || (!sourceTitle.trim() && !description.trim())}>번역 요청 검토하기 · 무료</button>
      {view.jobs.length > 1 && <label>이전 번역 요청<select value={job?.id ?? ''} onChange={event => { setSelectedId(event.target.value); setConfirmed(false); setSelectedFields([]); }} disabled={busy}>{view.jobs.map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} · {statuses[item.status]}</option>)}</select></label>}
      {job && <div className="translation-review">
        <h4>{statuses[job.status]}</h4>
        {job.review.destination==='Google 번역'?<p>번역 서비스 <strong>Google 번역</strong> · 요청당 최대 5,000자</p>:<p>모델 <strong>{job.review.model}</strong> · 원문 {job.review.inputCharacters.toLocaleString()}자 · 최대 출력 {job.review.maxOutputTokens.toLocaleString()}토큰</p>}
        <p>{job.review.paidNotice} {job.review.destination!=='Google 번역'&&job.review.pricingUrl&&<a href={job.review.pricingUrl} target="_blank" rel="noreferrer">공식 요금표</a>}</p>
        <p>전송 범위: {seoRetryJob?'현재 수집 상품명·설명만 전송합니다. 옵션값·카테고리·참고 메모는 보내지 않습니다.':optionsOnlyJob?'저장 원문에 연결된 미번역 옵션값만 전송합니다. 상품명·설명은 검토 자료로 보관하며 전송하지 않습니다.':job.review.destination==='Google 번역'?'상품명·설명·속성명·속성값·옵션값의 텍스트. 카테고리·참고 메모·옵션 ID는 전송하지 않습니다.':'아래 상품명·설명·속성 원문 및 포함한 SEO 참고 메모.'} 수신 서비스: {job.review.destination}. 승인 유효 기한: {new Date(job.review.expiresAt).toLocaleString()}</p>
        <details><summary>{job.review.destination==='Google 번역'?'번역 입력 검토':'실제로 전송할 원문 확인'}</summary><pre>{JSON.stringify(job.review.source, null, 2)}</pre></details>
        {stale && <p className="form-error">이 요청 이후 상품 또는 콘텐츠가 변경되었습니다. 새 실행에는 새 검토 요청이 필요합니다. 기존 결과는 확인할 수 있습니다.</p>}
        {expired&&!stale&&!optionsOnlyJob&&!seoRetryJob&&<><p>검토 기한이 지났습니다. 같은 원문·옵션으로 검토 기한을 갱신할 수 있습니다.</p><button type="button" className="btn" disabled={busy||!view.configuration.configured} onClick={()=>void action({action:'prepare',expectedVersion:version,idempotencyKey:crypto.randomUUID(),source:job.review.source})}>같은 원문으로 검토 기한 갱신</button></>}
        {stale&&!optionsOnlyJob&&!googleSource&&<button type="button" className="btn" disabled={busy||!view.configuration.configured} onClick={()=>void action({action:'prepare-collected'})}>현재 상품 원문으로 SEO 요청 다시 준비</button>}
        {optionsOnlyJob&&<p>{intakeOptionsJob?'자동 옵션 번역의 이어서 처리한 작업입니다. 저장한 상품명·설명은 유지하며 남은 옵션은 위 옵션 번역 버튼에서 확인해주세요.':'미번역 옵션 전용 재시도입니다. 위 옵션 번역 버튼에서 같은 작업을 확인하며 SEO·표시사항에는 적용하지 않습니다.'}</p>}
        {job.status === 'prepared' && !optionsOnlyJob && <><label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy || stale || expired} />{job.review.destination==='Google 번역'?'위 원문·Google 번역 서비스의 사용 조건과 번역 요청 묶음을 검토하고 승인합니다.':'위 모델·원문·위 서비스의 사용 조건과 생성 요청 1회를 검토하고 승인합니다.'}</label><button type="button" className="btn blue" disabled={busy || stale || expired || !confirmed} onClick={() => void writeReviewedDraft()}>SEO 초안 작성</button></>}
        {job.status === 'approved' && !optionsOnlyJob && <button type="button" className="btn blue" disabled={busy || stale || expired} onClick={() => void writeReviewedDraft()}>승인한 SEO 초안 작성 계속</button>}
        {job.status === 'running' && <p>이미 시작된 요청을 다시 호출하지 않습니다. 장시간 상태가 유지되면 생성 서비스 사용량과 서버 실행 이력을 확인해주세요.</p>}
        {job.error && <p role="alert">{job.error.message}{job.error.mayHaveBeenCharged ? ' 비용이 발생했을 수 있습니다.' : ''}</p>}
        {job.result && <>
          <p>{job.review.destination==='Google 번역'?'Google 번역 초안':'AI 생성 초안'} · 출처 검토 필요 · 기존 콘텐츠에 자동 적용하지 않았습니다.</p>
          {!optionsOnlyJob&&<TranslationIntegratedPreview key={`integrated:${job.id}:${content?.revision}`} productId={productId} version={version} jobId={job.id} disabled={busy || stale} onSaved={onContentSaved} />}
          {content && !optionsOnlyJob && <TranslationBatchPreview content={content} job={job} version={version} disabled={busy || job.productVersion !== version} onApply={input => void adopt([], undefined, input)} />}
          {job.review.destination!=='Google 번역'&&job.result.usage && <p>입력 {job.result.usage.inputTokens.toLocaleString()}토큰 · 출력 {job.result.usage.outputTokens.toLocaleString()}토큰</p>}
          {job.result.draft.warnings.length > 0 && <ul>{job.result.draft.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
          {!optionsOnlyJob&&translationSeoFields.map(field => <div key={field} className="translation-field"><label><input type="checkbox" checked={selectedFields.includes(field)} disabled={busy || !content || job.productVersion !== version} onChange={event => setSelectedFields(previous => event.target.checked ? [...previous, field] : previous.filter(item => item !== field))} />함께 저장할 항목 선택</label><strong>{field === 'title' ? '한국어 상품명' : field === 'keywords' ? 'SEO 검색어' : '한국어 설명'}</strong><pre>{Array.isArray(job.result!.draft[field]) ? (job.result!.draft[field] as string[]).join(', ') : job.result!.draft[field]}</pre><details><summary>현재 저장된 내용과 비교</summary><pre>{content ? JSON.stringify(content.seo[field].value, null, 2) : '불러오지 못함'}</pre></details><button className="btn" type="button" disabled={busy || !content || job.productVersion !== version} onClick={() => void adopt([field])}>검토한 초안을 이 항목에 적용 · 기존 내용 교체</button></div>)}
          {!optionsOnlyJob&&<button className="btn blue" type="button" disabled={busy || !content || !selectedFields.length || job.productVersion !== version} onClick={() => void adopt(selectedFields)}>검토한 {selectedFields.length}개 항목 함께 저장 · 선택한 기존 내용 교체</button>}
          {content && !optionsOnlyJob && <TranslationLabelMappingEditor key={`${job.id}:${content.revision}`} content={content} job={job} version={version} disabled={busy || job.productVersion !== version} onApply={mappings => void adopt([], mappings)} />}
          {job.result.draft.attributes.length > 0 && <details><summary>번역된 속성·옵션 확인</summary><ul>{job.result.draft.attributes.map(attribute => <li key={attribute.sourceIndex}>{attribute.name}: {attribute.value}</li>)}</ul><TranslationIntegratedPreview scope="options" productId={productId} version={version} jobId={job.id} disabled={busy || stale} onSaved={onContentSaved} /></details>}
        </>}
      </div>}
    </>}
  </section>;
}
