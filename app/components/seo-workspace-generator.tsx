'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TranslationJob, TranslationSource, TranslationView } from '@/app/automation/translation';
import type { ProductContent } from '@/app/product-content';
import type { ProductOptionsResponse } from '@/app/product-options';
import { collectedTranslationAttributes } from '@/app/collected-translation-attributes';
import { optionTranslationBatch } from '@/app/option-translation';
import { collectionSourceReference } from '@/app/sourcing';
import { createSeoWorkspaceDraftState, parseSeoWorkspaceDraftState, refreshSeoWorkspaceDraft, runSeoWorkspaceDraft,
  type SeoWorkspaceDraftMemo, type SeoWorkspaceDraftState } from '@/app/seo-workspace-draft';
import { TranslationIntegratedPreview } from '@/app/components/translation-integrated-preview';
import './seo-workspace.css';

type Props = { productId: string; version: string; brand: string; active: boolean; beforeGenerate: () => boolean; onSaved: () => void };
type Source = { productId: string; productVersion: string; jobId: string; sourceUrl: string; title: string; description: string;
  attributes: {name:string;value:string}[]; requestContext: {categoryId:string;categoryPath:string[];features:string;keywords:string}|null };
type Basis = { source: TranslationSource; contentRevision: number; configuration: TranslationView['configuration']; remainingOptions: number };

export function SeoWorkspaceGenerator(props: Props) {
  return <SeoWorkspaceGeneratorContent key={`${props.productId}:${props.version}`} {...props}/>;
}
function SeoWorkspaceGeneratorContent({ productId, version, brand, active, beforeGenerate, onSaved }: Props) {
  const [basis,setBasis]=useState<Basis|null>(null),[memo,setMemo]=useState<SeoWorkspaceDraftMemo>({brand,features:'',keywords:''});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [job,setJob]=useState<TranslationJob|null>(null),[hasRequest,setHasRequest]=useState(false),[closed,setClosed]=useState(false);
  const [confirmAi,setConfirmAi]=useState(false);
  const [recoveryInvalid,setRecoveryInvalid]=useState(false);
  const [attempt,setAttempt]=useState(0);
  const request=useRef<AbortController|null>(null), draftState=useRef<SeoWorkspaceDraftState|null>(null);
  const current=useRef({active,version,memo}),mounted=useRef(true),loaded=useRef(false);
  const storageKey=`yoofam-seo-workspace:${productId}`;
  useLayoutEffect(()=>{current.current={active,version,memo};},[active,version,memo]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current?.abort();};},[]);
  useEffect(()=>{
    if(!active||loaded.current)return;
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
        setMemo(value);current.current.memo=value;
        setBasis({source:{title:source.title,description:source.description,attributes:[...attributes,...batch.attributes],provenance:'manual',
          reference:collectionSourceReference(source.jobId,source.sourceUrl),category:{id:source.requestContext.categoryId,path:source.requestContext.categoryPath},
          guidance:{features:source.requestContext.features,keywords:source.requestContext.keywords}},
          configuration:view.configuration,contentRevision:content.content.revision,remainingOptions:batch.remaining});
        try{const raw=sessionStorage.getItem(storageKey),saved=raw?parseSeoWorkspaceDraftState(raw,productId):null;
          if(raw&&!saved)throw Error('이전 초안의 복구 정보를 확인하지 못했습니다. 아래 생성 이력을 확인해주세요. 새 실행은 만들지 않았습니다.');
          if(saved){draftState.current=saved;setMemo(saved.memo);current.current.memo=saved.memo;setHasRequest(true);setMessage('이전에 요청한 초안이 있습니다. 같은 요청의 상태를 먼저 확인해주세요.');}}
        catch(cause){setRecoveryInvalid(true);setError(cause instanceof Error?cause.message:'이전 초안의 복구 정보를 읽지 못했습니다. 생성 이력을 확인해주세요.');}
        loaded.current=true;
      }catch(cause){if(!controller.signal.aborted&&mounted.current)setError(cause instanceof Error?cause.message:'SEO 자료 조회 실패');}
      finally{if(request.current===controller){request.current=null;if(!controller.signal.aborted&&mounted.current)setBusy(false);}}
    });
    return()=>{controller.abort();if(request.current===controller)request.current=null;};
  },[active,productId,version,brand,storageKey,attempt]);
  function edit(key:keyof SeoWorkspaceDraftMemo,value:string){setMemo(previous=>{const next={...previous,[key]:value};current.current.memo=next;return next;});setConfirmAi(false);}
  async function generate(readOnly=false){
    if(!basis||recoveryInvalid||request.current||!current.current.active||!beforeGenerate())return;
    const controller=new AbortController();request.current=controller;setBusy(true);setError('');setMessage('');
    const input=structuredClone(current.current.memo),inputKey=JSON.stringify(input);
    const same=()=>mounted.current&&current.current.active&&current.current.version===version&&JSON.stringify(current.current.memo)===inputKey;
    try{
      const state=draftState.current??createSeoWorkspaceDraftState({productId,productVersion:version,contentRevision:basis.contentRevision,
        source:basis.source,memo:input,configuration:basis.configuration});
      const sourceIdentity=(source:TranslationSource)=>JSON.stringify([source.title,source.description,source.attributes,source.reference,source.category]);
      if(!readOnly&&(state.productVersion!==version||state.contentRevision!==basis.contentRevision||sourceIdentity(state.source)!==sourceIdentity(basis.source)))
        throw Error('이전 요청 이후 상품 원문이 변경되었습니다. 초안 상태를 조회한 뒤 새 입력을 준비해주세요. 이전 요청을 다시 실행하지 않았습니다.');
      const persist=(saved:SeoWorkspaceDraftState)=>{draftState.current=saved;try{sessionStorage.setItem(storageKey,JSON.stringify(saved));}catch{}
        if(!controller.signal.aborted&&same())setHasRequest(true);};
      persist(state);
      const controls={signal:controller.signal,fetcher:fetch,isContextCurrent:same,confirmAi,onState:persist,
        onJob:(value:TranslationJob)=>{if(!controller.signal.aborted&&same())setJob(value);}};
      const result=await (readOnly?refreshSeoWorkspaceDraft(state,controls):runSeoWorkspaceDraft(state,controls));
      if(controller.signal.aborted||!same())return;
      const preparedOnly=!!result.job&&['prepared','approved'].includes(result.job.status)&&!state.executeSubmitted
        &&!result.job.startedAt&&!result.job.result&&!result.job.error;
      setJob(result.job);setClosed(result.closed||preparedOnly);setMessage(result.message);
    }catch(cause){if(!controller.signal.aborted&&same())setError(cause instanceof Error?cause.message:'초안 작성 상태를 확인하지 못했습니다.');}
    finally{if(request.current===controller){request.current=null;if(!controller.signal.aborted&&mounted.current)setBusy(false);}}
  }
  const google=basis?.configuration.model==='google-translate-gtx';
  const titleExample=[memo.brand.trim(),memo.features.trim()||'상품 특징',memo.keywords.trim()||'타겟 키워드'].filter(Boolean).join(' ');
  const currentJob=job?.productVersion===version&&job.productId===productId;
  const hasResult=currentJob&&job.status==='completed'&&!!job.result;
  return <section className="seo-generation-card" aria-label="SEO 자동 작성" data-workspace-saving={busy} data-quotation-source-step="SEO">
    <h3>{!basis?'초안 자동 작성':google?'한국어 초안 자동 작성':'AI 자동 생성'}</h3>
    <div className="seo-generation-body">
      <p>수집한 상품정보로 초안을 작성합니다. 결과를 확인한 뒤 적용하고 수정해주세요.</p>
      <div className="seo-generation-inputs">
        <label>브랜드<input aria-label="SEO 브랜드" value={memo.brand} maxLength={100} disabled={busy||hasRequest} onChange={event=>edit('brand',event.target.value)}/><small>기본설정 브랜드를 불러옵니다. 상품명 예시의 접두사입니다.</small></label>
        <label>상품 특징<input aria-label="SEO 상품 특징" value={memo.features} maxLength={2000} disabled={busy||hasRequest} placeholder="상품 특징을 입력하세요" onChange={event=>edit('features',event.target.value)}/><small>원문에서 확인되는 주요 특징을 입력하세요.</small></label>
        <label>타겟 키워드<input aria-label="SEO 타겟 키워드" value={memo.keywords} maxLength={2000} disabled={busy||hasRequest} placeholder="타겟 키워드" onChange={event=>edit('keywords',event.target.value)}/><small>상품과 관련된 검색어를 입력하세요.</small></label>
      </div>
      <div className="seo-title-example"><strong>생성될 상품명 예시:</strong> {titleExample}</div>
      {google&&<small>무료 Google 번역을 사용합니다. 특징·키워드는 검토 메모로 보관하며 Google 번역에는 전송하지 않습니다. 실제 상품명에 사용할 브랜드는 적용 미리보기에서 확인하세요.</small>}
      {!google&&basis?.configuration.configured&&<label className="seo-ai-consent"><input type="checkbox" checked={confirmAi} disabled={busy} onChange={event=>setConfirmAi(event.target.checked)}/> 현재 설정된 {basis.configuration.model}의 초안 생성 요청 1회를 실행합니다. 서비스 사용량에 따라 비용이 발생할 수 있습니다.</label>}
      {!!basis?.remainingOptions&&<small>이번 요청 한도를 넘는 옵션 번역 항목 {basis.remainingOptions}개는 원문에 유지됩니다. 추가 번역은 아래 생성 이력에서 이어갈 수 있습니다.</small>}
      {busy&&<p role="status">{basis?'초안 요청 상태를 확인하고 있습니다…':'수집 원문을 불러오는 중입니다…'}</p>}
      {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
      {error&&!basis&&<button className="btn ghost" type="button" disabled={busy} onClick={()=>setAttempt(value=>value+1)}>수집 원문 다시 조회</button>}
      {basis&&!basis.configuration.configured&&<p role="alert">{basis.configuration.issues.join(' ')}</p>}
      <div className="seo-generation-actions"><button className="btn ghost" type="button" disabled={busy||recoveryInvalid||!basis?.configuration.configured} onClick={()=>void generate()}>{hasRequest&&!job?'같은 초안 요청 확인':!basis?'초안 작성':google?'한국어 초안 자동 작성':'AI로 자동 생성'}</button>
        {hasRequest&&<button className="btn ghost" type="button" disabled={busy} onClick={()=>void generate(true)}>초안 상태 조회</button>}
        {hasRequest&&closed&&<button className="btn ghost" type="button" disabled={busy} onClick={()=>{draftState.current=null;setHasRequest(false);setClosed(false);setJob(null);setConfirmAi(false);setMessage('새 요청의 입력을 준비했습니다. 작성 버튼을 누르면 새 초안을 요청합니다.');try{sessionStorage.removeItem(storageKey);}catch{}}}>새 초안 입력</button>}
      </div>
      {hasResult&&<div className="seo-generated-result"><h4>작성된 초안</h4><dl><dt>상품명</dt><dd>{job.result!.draft.title}</dd><dt>검색태그</dt><dd>{job.result!.draft.keywords.join(', ')}</dd></dl>
        {!!job.result!.draft.warnings.length&&<ul>{job.result!.draft.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}
        <TranslationIntegratedPreview productId={productId} version={version} jobId={job.id} disabled={busy||!active} beforeApply={beforeGenerate} onSaved={onSaved}/>
      </div>}
    </div>
  </section>;
}
