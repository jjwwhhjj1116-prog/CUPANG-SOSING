'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranslationJob, TranslationView } from '@/app/automation/translation';
import { optionTranslationAttributes, adoptOptionTranslations, confirmOptionTranslationSave } from '@/app/option-translation';
import type { ProductOptionsResponse } from '@/app/product-options';
import type { ProductContent } from '@/app/product-content';
import { translationAdoptionInput, translationSeoFields, type TranslationSeoField } from '@/app/translation-adoption';
import { collectedTranslationAttributes } from '@/app/collected-translation-attributes';
import { translationLabelAdoption, type TranslationLabelMapping } from '@/app/translation-label-adoption';
import { TranslationLabelMappingEditor } from '@/app/components/translation-label-mapping';
import { TranslationBatchPreview } from '@/app/components/translation-batch-preview';
import { TranslationIntegratedPreview } from '@/app/components/translation-integrated-preview';

type Props = { productId: string; version: string; title: string; onContentSaved?: () => void };
type RequestContext = { categoryId: string; categoryPath: string[]; features: string; keywords: string; capturedAt: string };
type CollectedSource = { error?:string; title:string; description:string; attributes?:{name:string;value:string}[]; jobId:string; sourceUrl:string; productVersion:string; message:string; requestContext?:RequestContext|null };
function validateCollectedSource(value: CollectedSource, version: string) {
  if(value.productVersion!==version)throw Error('상품이 변경되었습니다. 최신 상품을 다시 열어주세요.');
  if(typeof value.title!=='string'||typeof value.description!=='string'||!value.jobId||typeof value.sourceUrl!=='string')throw Error('수집 원문의 형식을 확인하지 못했습니다.');
  collectedTranslationAttributes(value.attributes??[]);
  if(value.requestContext && (typeof value.requestContext.features!=='string'||typeof value.requestContext.keywords!=='string'||!Array.isArray(value.requestContext.categoryPath)))throw Error('수집 당시 상품 특징·키워드를 확인하지 못했습니다.');
}
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
  const activeRequest=useRef<AbortController|null>(null);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;activeRequest.current?.abort();};},[]);
  function beginRequest(allowMissing=false){
    if(!mounted.current||activeRequest.current||(!allowMissing&&(!view||!content)))return null;
    const controller=new AbortController();activeRequest.current=controller;return controller;
  }
  function finishRequest(controller:AbortController){
    if(activeRequest.current===controller){activeRequest.current=null;if(mounted.current)setBusy(false);}
  }
  const job = view?.jobs.find(item => item.id === selectedId) ?? view?.jobs[0] ?? null;
  const stale = Boolean(job && (job.productVersion !== version || (content && job.contentRevision !== content.revision)));
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
        if(next.view.jobs.length)return;
        try {
          const response=await fetch(`/api/products/${encodeURIComponent(productId)}/translation-source`,{cache:'no-store',signal:controller.signal});
          if(controller.signal.aborted||response.status===404)return;
          const value=await response.json() as CollectedSource;
          if(controller.signal.aborted)return;
          if(!response.ok)throw Error(value.error??'수집 원문 조회 실패');
          validateCollectedSource(value,version);applyCollectedSource(value);
          setNotice('연결된 수집 원문·상품 속성·상품 특징·타깃 키워드를 자동으로 불러왔습니다. 검토 후 번역 요청을 준비하세요. AI 호출과 상품 저장은 실행하지 않았습니다.');
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
      let optionText: string | null = null;
      if(optionResponse) {
        const optionSource=await optionResponse.json() as ProductOptionsResponse & {error?:string};
        if(controller.signal.aborted)return;
        if(!optionResponse.ok)throw Error(optionSource.error??'옵션 조회 실패');
        if(optionSource.productVersion!==version||optionSource.options?.productId!==productId)throw Error('옵션과 현재 상품이 일치하지 않습니다. 최신 상품을 다시 열어주세요.');
        const pairs=optionTranslationAttributes(optionSource.options,true);
        if(pairs.some(pair=>/[\r\n]/.test(pair.value)))throw Error('여러 줄 옵션 원문은 옵션 편집에서 한 줄로 정리해주세요.');
        if((value.attributes?.length??0)+pairs.length>50)throw Error('상품 속성과 옵션 원문이 합계 50개를 초과합니다. 기존 입력은 유지했습니다. 각각 불러와 번역 범위를 나누어주세요.');
        optionText=pairs.map(pair=>`${pair.name}=${pair.value}`).join('\n');
      }
      if(optionText!==null)setAttributes(optionText);
      applyCollectedSource(value);
      setNotice(value.message+(includeOptions?' 미번역 옵션명·수집 색상·사이즈도 함께 불러왔습니다.':'')+' 입력란만 채웠으며 번역 호출이나 상품 저장은 하지 않았습니다.');
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
      const pairs=optionTranslationAttributes(value.options);
      if(pairs.some(pair=>/[\r\n]/.test(pair.value)))throw Error('여러 줄 옵션 원문은 옵션 편집에서 한 줄로 정리해주세요.');
      setAttributes(pairs.map(pair=>`${pair.name}=${pair.value}`).join('\n'));
      setNotice(`미번역 옵션명·수집 색상·사이즈 ${pairs.length}개 항목을 번역 검토에 넣었습니다. 아직 유료 호출하지 않았습니다.`);
    }catch(reason){if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'옵션 조회 실패');}
    finally{finishRequest(controller);}
  }
  async function adoptOptions() {
    if(!job)return;const controller=beginRequest();if(!controller)return;setBusy(true);setError('');setNotice('');
    try {
      const response=await fetch(`/api/products/${encodeURIComponent(productId)}/options`,{cache:'no-store',signal:controller.signal});
      const current=await response.json() as ProductOptionsResponse & {error?:string};if(controller.signal.aborted)return;
      if(!response.ok)throw Error(current.error??'옵션 조회 실패');
      if(current.productVersion!==version||current.options?.productId!==productId)throw Error('현재 상품과 옵션 조회 결과가 다릅니다. 최신 상품을 다시 열어주세요.');
      const next=adoptOptionTranslations(current.options,job,current.productVersion);
      const saved=await fetch(`/api/products/${encodeURIComponent(productId)}/options`,{signal:controller.signal,method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:current.options.revision,expectedProductVersion:current.productVersion,rows:next.rows})});
      const value=await saved.json() as {error?:string};if(controller.signal.aborted)return;if(!saved.ok)throw Error(value.error??'옵션 저장 실패');
      confirmOptionTranslationSave(value,current.options,current.productVersion,next.rows);
      setNotice(`옵션명·색상·사이즈 ${next.changed}개 항목에 검토한 초안을 적용했습니다. 직접 수정한 값·가격·수량은 보존했습니다.`);onContentSaved?.();
    }catch(reason){if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'옵션 적용 실패');}
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
      source: { title: sourceTitle, description, attributes: pairs, provenance: 'manual', reference: sourceReference, ...(includeGuidance&&(guidance.features.trim()||guidance.keywords.trim())?{guidance}:{}) } });
  }
  async function adopt(fields: readonly TranslationSeoField[], labels?: readonly TranslationLabelMapping[], batch?: ReturnType<typeof translationAdoptionInput>) {
    if (!content || !job?.result) return;
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
  return <section className="translation-panel" aria-label="원문 번역과 SEO 초안">
    <h4>원문 번역 · SEO 초안</h4>
    <button type="button" className="btn" disabled={busy} onClick={()=>void refreshState()}>작업 상태 다시 조회 · 무료</button>
    <p>저장된 원문으로 한국어 초안을 생성합니다. 아래 직접 입력 내용은 자동 수집 증빙으로 기록되지 않습니다.</p>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {requestContext&&<aside className="panel-note" aria-label="상품 추가 당시 요청"><strong>상품 추가 당시 요청</strong><p>{requestContext.categoryPath.join(' › ')} · {requestContext.categoryId}</p><dl><dt>상품 특징</dt><dd style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{requestContext.features||'입력 없음'}</dd><dt>타겟 키워드</dt><dd style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{requestContext.keywords||'입력 없음'}</dd></dl><small>요청 당시 입력한 참고 정보입니다. 아래 SEO 참고 메모에서 편집하거나 전송에서 제외할 수 있습니다.</small></aside>}
    {!view && !error && <p>번역 설정을 확인하고 있습니다.</p>}
    {view && <>
      {!view.configuration.configured && <div className="connection-note"><strong>서버 연결 설정이 필요합니다</strong><ul>{view.configuration.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
      <button className="btn blue" type="button" disabled={busy} onClick={()=>void loadCollectedSource(true)}>수집 원문·미번역 옵션 함께 불러오기 · 입력 교체</button><button className="btn" type="button" disabled={busy} onClick={()=>void loadCollectedSource()}>수집 원문 불러오기 · 상품명·설명·상품 속성 입력 교체</button><small>옵션·이미지 번역은 별도입니다. 불러온 원문도 전송 전에 수정하고 검토할 수 있습니다.</small><label>상품명 원문<input value={sourceTitle} maxLength={1000} onChange={event => setSourceTitle(event.target.value)} disabled={busy} /></label>
      <fieldset disabled={busy}><legend>SEO 참고 메모</legend><label><input type="checkbox" checked={includeGuidance} onChange={event=>setIncludeGuidance(event.target.checked)}/>초안 생성에 참고 메모 포함</label><label>강조할 상품 특징<textarea maxLength={2000} value={guidance.features} onChange={event=>setGuidance(previous=>({...previous,features:event.target.value}))}/></label><label>타겟 키워드<textarea maxLength={2000} value={guidance.keywords} onChange={event=>setGuidance(previous=>({...previous,keywords:event.target.value}))}/></label><small>원문에서 확인되는 특징과 관련 키워드만 반영하도록 요청합니다. 상품 사실을 추가하는 근거로 사용하지 않으며, 생성 결과는 검토 후 적용합니다.</small></fieldset>
      <label>상품 설명 원문<textarea rows={5} value={description} maxLength={20000} onChange={event => setDescription(event.target.value)} disabled={busy} /></label>
      {collectedAttributes.length > 0 && <fieldset disabled={busy}><legend>수집 상품 속성 원문 · {collectedAttributes.length}개</legend><label><input type="checkbox" checked={includeCollectedAttributes} onChange={event=>setIncludeCollectedAttributes(event.target.checked)}/>번역에 포함</label><p>판매자가 기재한 원문입니다. 옵션·직접 입력 속성은 별도로 유지합니다.</p>{collectedAttributes.map((pair,index)=><div key={index}><label>속성명<input maxLength={190} value={pair.name} onChange={event=>setCollectedAttributes(previous=>previous.map((item,i)=>i===index?{...item,name:event.target.value}:item))}/></label><label>속성값<textarea maxLength={1000} value={pair.value} onChange={event=>setCollectedAttributes(previous=>previous.map((item,i)=>i===index?{...item,value:event.target.value}:item))}/></label></div>)}</fieldset>}
      <button className="btn" type="button" disabled={busy} onClick={()=>void loadOptionSource()}>미번역 옵션 불러오기 · 속성 입력 교체</button><label>속성 원문 · 한 줄에 속성명=값<textarea rows={3} value={attributes} onChange={event => setAttributes(event.target.value)} disabled={busy} placeholder={'材质=棉\n颜色=白色'} /></label>
      <button className="btn" type="button" onClick={prepare} disabled={busy || !view.configuration.configured || (!sourceTitle.trim() && !description.trim())}>번역 요청 검토하기 · 무료</button>
      {view.jobs.length > 1 && <label>이전 번역 요청<select value={job?.id ?? ''} onChange={event => { setSelectedId(event.target.value); setConfirmed(false); setSelectedFields([]); }} disabled={busy}>{view.jobs.map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} · {statuses[item.status]}</option>)}</select></label>}
      {job && <div className="translation-review">
        <h4>{statuses[job.status]}</h4>
        <p>모델 <strong>{job.review.model}</strong> · 원문 {job.review.inputCharacters.toLocaleString()}자 · 최대 출력 {job.review.maxOutputTokens.toLocaleString()}토큰</p>
        <p>{job.review.paidNotice} <a href={job.review.pricingUrl} target="_blank" rel="noreferrer">공식 요금표</a></p>
        <p>전송 범위: 아래 상품명·설명·속성 원문 및 포함한 SEO 참고 메모. 수신 서비스: {job.review.destination}. 승인 유효 기한: {new Date(job.review.expiresAt).toLocaleString()}</p>
        <details><summary>실제로 전송할 원문 확인</summary><pre>{JSON.stringify(job.review.source, null, 2)}</pre></details>
        {stale && <p className="form-error">이 요청 이후 상품 또는 콘텐츠가 변경되었습니다. 새 유료 실행에는 새 검토 요청이 필요합니다. 기존 결과는 확인할 수 있습니다.</p>}
        {job.status === 'prepared' && <><label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy || stale} />위 모델·원문·유료 API 요청 1회를 검토하고 승인합니다.</label><button type="button" className="btn" disabled={busy || stale || !confirmed} onClick={() => void action({ action: 'approve', jobId: job.id, reviewFingerprint: job.review.fingerprint, confirmPaid: true })}>유료 요청 승인 · 아직 호출하지 않음</button></>}
        {job.status === 'approved' && <button type="button" className="btn blue" disabled={busy || stale} onClick={() => void action({ action: 'execute', jobId: job.id })}>승인한 번역 1회 실행 · 비용 발생</button>}
        {job.status === 'running' && <p>이미 시작된 요청을 다시 호출하지 않습니다. 장시간 상태가 유지되면 OpenAI 사용량과 서버 실행 이력을 확인해주세요.</p>}
        {job.error && <p role="alert">{job.error.message}{job.error.mayHaveBeenCharged ? ' 비용이 발생했을 수 있습니다.' : ''}</p>}
        {job.result && <>
          <p>AI 생성 초안 · 출처 검토 필요 · 기존 콘텐츠에 자동 적용하지 않았습니다.</p>
          <TranslationIntegratedPreview key={`integrated:${job.id}:${content?.revision}`} productId={productId} version={version} jobId={job.id} disabled={busy || stale} onSaved={onContentSaved} />
          {content && <TranslationBatchPreview content={content} job={job} version={version} disabled={busy || job.productVersion !== version} onApply={input => void adopt([], undefined, input)} />}
          {job.result.usage && <p>입력 {job.result.usage.inputTokens.toLocaleString()}토큰 · 출력 {job.result.usage.outputTokens.toLocaleString()}토큰</p>}
          {job.result.draft.warnings.length > 0 && <ul>{job.result.draft.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
          {translationSeoFields.map(field => <div key={field} className="translation-field"><label><input type="checkbox" checked={selectedFields.includes(field)} disabled={busy || !content || job.productVersion !== version} onChange={event => setSelectedFields(previous => event.target.checked ? [...previous, field] : previous.filter(item => item !== field))} />함께 저장할 항목 선택</label><strong>{field === 'title' ? '한국어 상품명' : field === 'keywords' ? 'SEO 검색어' : '한국어 설명'}</strong><pre>{Array.isArray(job.result!.draft[field]) ? (job.result!.draft[field] as string[]).join(', ') : job.result!.draft[field]}</pre><details><summary>현재 저장된 내용과 비교</summary><pre>{content ? JSON.stringify(content.seo[field].value, null, 2) : '불러오지 못함'}</pre></details><button className="btn" type="button" disabled={busy || !content || job.productVersion !== version} onClick={() => void adopt([field])}>검토한 초안을 이 항목에 적용 · 기존 내용 교체</button></div>)}
          <button className="btn blue" type="button" disabled={busy || !content || !selectedFields.length || job.productVersion !== version} onClick={() => void adopt(selectedFields)}>검토한 {selectedFields.length}개 항목 함께 저장 · 선택한 기존 내용 교체</button>
          {content && <TranslationLabelMappingEditor key={`${job.id}:${content.revision}`} content={content} job={job} version={version} disabled={busy || job.productVersion !== version} onApply={mappings => void adopt([], mappings)} />}
          {job.result.draft.attributes.length > 0 && <details><summary>번역된 속성·옵션 확인</summary><ul>{job.result.draft.attributes.map(attribute => <li key={attribute.sourceIndex}>{attribute.name}: {attribute.value}</li>)}</ul><button className="btn" type="button" disabled={busy || job.productVersion !== version} onClick={()=>void adoptOptions()}>검토한 옵션 번역 적용 · 미번역 이름·수집 속성</button></details>}
        </>}
      </div>}
    </>}
  </section>;
}
