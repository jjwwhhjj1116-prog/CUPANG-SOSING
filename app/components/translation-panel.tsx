'use client';

import { useEffect, useState } from 'react';
import type { TranslationJob, TranslationView } from '@/app/automation/translation';
import { optionTranslationAttributes, adoptOptionTranslations } from '@/app/option-translation';
import type { ProductOptionsResponse } from '@/app/product-options';
import type { ProductContent } from '@/app/product-content';

type Props = { productId: string; version: string; title: string; onContentSaved?: () => void };
const statuses: Record<TranslationJob['status'], string> = { prepared: '검토 대기', approved: '승인됨 · 실행 대기', running: '실행 중 · 중복 실행 차단', completed: '초안 생성 완료', failed: '실패 · 재호출 안 함', uncertain: '결과 확인 필요 · 재호출 안 함' };

export default function TranslationPanel({ productId, version, title, onContentSaved }: Props) {
  const [view, setView] = useState<TranslationView | null>(null);
  const [content, setContent] = useState<ProductContent | null>(null);
  const [sourceTitle, setSourceTitle] = useState(title);
  const [description, setDescription] = useState('');
  const [sourceReference,setSourceReference]=useState('저장 상품명과 사용자가 검토한 직접 입력 원문');
  const [attributes, setAttributes] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const job = view?.jobs.find(item => item.id === selectedId) ?? view?.jobs[0] ?? null;
  const stale = Boolean(job && (job.productVersion !== version || (content && job.contentRevision !== content.revision)));
  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`/api/products/${productId}/translation`).then(async response => { const value = await response.json() as TranslationView & { error?: string }; if (!response.ok) throw Error(value.error ?? '번역 작업을 불러오지 못했습니다.'); return value; }),
      fetch(`/api/products/${productId}/content`).then(async response => { const value = await response.json() as { content: ProductContent; error?: string }; if (!response.ok) throw Error(value.error ?? '현재 콘텐츠를 불러오지 못했습니다.'); return value.content; }),
    ]).then(([next, current]) => { if (active) { setView(next); setContent(current); } }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [productId, version]);

  async function action(body: Record<string, unknown>) {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/products/${productId}/translation`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const value = await response.json() as { job?: TranslationJob; configuration?: TranslationView['configuration']; error?: string; message?: string };
      if (!response.ok || !value.job) throw Error(value.error ?? '번역 요청을 처리하지 못했습니다.');
      const saved = value.job;
      setView(previous => ({ configuration: value.configuration ?? previous!.configuration, jobs: [saved, ...(previous?.jobs ?? []).filter(item => item.id !== saved.id)] }));
      setSelectedId(saved.id); setConfirmed(false);
      if (value.message) setNotice(value.message);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '요청 실패'); }
    finally { setBusy(false); }
  }
  async function loadCollectedSource() {
    setBusy(true);setError('');setNotice('');
    try {
      const response=await fetch(`/api/products/${encodeURIComponent(productId)}/translation-source`,{cache:'no-store'});
      const value=await response.json() as {error?:string;title:string;description:string;jobId:string;sourceUrl:string;productVersion:string;message:string};
      if(!response.ok)throw Error(value.error??'원문 조회 실패');
      if(value.productVersion!==version)throw Error('상품이 변경되었습니다. 최신 상품을 다시 열어주세요.');
      setSourceTitle(value.title);setDescription(value.description);
      setSourceReference(`수집 요청 ${value.jobId} (${value.sourceUrl})에서 가져와 사용자가 검토·편집한 원문`);
      setNotice(value.message+' 입력란만 채웠으며 번역 호출이나 상품 저장은 하지 않았습니다.');
    }catch(reason){setError(reason instanceof Error?reason.message:'원문 조회 실패');}
    finally{setBusy(false);}
  }
  async function loadOptionSource() {
    setBusy(true);setError('');setNotice('');
    try {
      const response=await fetch(`/api/products/${encodeURIComponent(productId)}/options`,{cache:'no-store'});
      const value=await response.json() as ProductOptionsResponse & {error?:string};
      if(!response.ok)throw Error(value.error??'옵션 조회 실패');
      if(value.productVersion!==version)throw Error('상품이 변경되었습니다. 최신 상품을 다시 열어주세요.');
      const pairs=optionTranslationAttributes(value.options);
      if(pairs.some(pair=>/[\r\n]/.test(pair.value)))throw Error('여러 줄 옵션 원문은 옵션 편집에서 한 줄로 정리해주세요.');
      setAttributes(pairs.map(pair=>`${pair.name}=${pair.value}`).join('\n'));
      setNotice(`한국어 이름이 비어 있는 옵션 ${pairs.length}개를 번역 검토에 넣었습니다. 아직 유료 호출하지 않았습니다.`);
    }catch(reason){setError(reason instanceof Error?reason.message:'옵션 조회 실패');}
    finally{setBusy(false);}
  }
  async function adoptOptions() {
    if(!job)return;setBusy(true);setError('');setNotice('');
    try {
      const response=await fetch(`/api/products/${encodeURIComponent(productId)}/options`,{cache:'no-store'});
      const current=await response.json() as ProductOptionsResponse & {error?:string};
      if(!response.ok)throw Error(current.error??'옵션 조회 실패');
      const next=adoptOptionTranslations(current.options,job,current.productVersion);
      const saved=await fetch(`/api/products/${encodeURIComponent(productId)}/options`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:current.options.revision,expectedProductVersion:current.productVersion,rows:next.rows})});
      const value=await saved.json() as {error?:string};if(!saved.ok)throw Error(value.error??'옵션 저장 실패');
      setNotice(`빈 한국어 옵션명 ${next.changed}개에 검토한 초안을 적용했습니다. 기존 이름·가격·수량은 보존했습니다.`);onContentSaved?.();
    }catch(reason){setError(reason instanceof Error?reason.message:'옵션 적용 실패');}
    finally{setBusy(false);}
  }
  function prepare() {
    const pairs: { name: string; value: string }[] = [];
    for (const line of attributes.split('\n').map(value => value.trim()).filter(Boolean)) {
      const index = line.indexOf('=');
      if (index <= 0 || index === line.length - 1) { setError('속성은 한 줄에 속성명=원문 값 형식으로 입력해주세요.'); return; }
      pairs.push({ name: line.slice(0, index).trim(), value: line.slice(index + 1).trim() });
    }
    void action({ action: 'prepare', expectedVersion: version, idempotencyKey: crypto.randomUUID(),
      source: { title: sourceTitle, description, attributes: pairs, provenance: 'manual', reference: sourceReference } });
  }
  async function adopt(field: 'title' | 'keywords' | 'description') {
    if (!content || !job?.result) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/products/${productId}/content`, { method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: content.revision, patch: { seo: { [field]: job.result.draft[field] } } }) });
      const value = await response.json() as { content?: ProductContent; error?: string };
      if (!response.ok || !value.content) throw Error(value.error ?? '초안을 적용하지 못했습니다.');
      setContent(value.content); setNotice('선택한 항목만 검토 후 적용했습니다. 다른 편집 항목은 보존했습니다.'); onContentSaved?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '적용 실패'); }
    finally { setBusy(false); }
  }
  return <section className="translation-panel" aria-label="원문 번역과 SEO 초안">
    <h4>원문 번역 · SEO 초안</h4>
    <p>저장된 원문으로 한국어 초안을 생성합니다. 아래 직접 입력 내용은 자동 수집 증빙으로 기록되지 않습니다.</p>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!view && !error && <p>번역 설정을 확인하고 있습니다.</p>}
    {view && <>
      {!view.configuration.configured && <div className="connection-note"><strong>서버 연결 설정이 필요합니다</strong><ul>{view.configuration.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
      <button className="btn" type="button" disabled={busy} onClick={()=>void loadCollectedSource()}>수집 원문 불러오기 · 상품명·설명 입력 교체</button><small>옵션·이미지 번역은 별도입니다. 불러온 원문도 전송 전에 수정하고 검토할 수 있습니다.</small><label>상품명 원문<input value={sourceTitle} maxLength={1000} onChange={event => setSourceTitle(event.target.value)} disabled={busy} /></label>
      <label>상품 설명 원문<textarea rows={5} value={description} maxLength={20000} onChange={event => setDescription(event.target.value)} disabled={busy} /></label>
      <button className="btn" type="button" disabled={busy} onClick={()=>void loadOptionSource()}>미번역 옵션 불러오기 · 속성 입력 교체</button><label>속성 원문 · 한 줄에 속성명=값<textarea rows={3} value={attributes} onChange={event => setAttributes(event.target.value)} disabled={busy} placeholder={'材质=棉\n颜色=白色'} /></label>
      <button className="btn" type="button" onClick={prepare} disabled={busy || !view.configuration.configured || (!sourceTitle.trim() && !description.trim())}>번역 요청 검토하기 · 무료</button>
      {view.jobs.length > 1 && <label>이전 번역 요청<select value={job?.id ?? ''} onChange={event => { setSelectedId(event.target.value); setConfirmed(false); }} disabled={busy}>{view.jobs.map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} · {statuses[item.status]}</option>)}</select></label>}
      {job && <div className="translation-review">
        <h4>{statuses[job.status]}</h4>
        <p>모델 <strong>{job.review.model}</strong> · 원문 {job.review.inputCharacters.toLocaleString()}자 · 최대 출력 {job.review.maxOutputTokens.toLocaleString()}토큰</p>
        <p>{job.review.paidNotice} <a href={job.review.pricingUrl} target="_blank" rel="noreferrer">공식 요금표</a></p>
        <p>전송 범위: 아래 상품명·설명·속성 원문. 수신 서비스: {job.review.destination}. 승인 유효 기한: {new Date(job.review.expiresAt).toLocaleString()}</p>
        <details><summary>실제로 전송할 원문 확인</summary><pre>{JSON.stringify(job.review.source, null, 2)}</pre></details>
        {stale && <p className="form-error">이 요청 이후 상품 또는 콘텐츠가 변경되었습니다. 새 유료 실행에는 새 검토 요청이 필요합니다. 기존 결과는 확인할 수 있습니다.</p>}
        {job.status === 'prepared' && <><label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy || stale} />위 모델·원문·유료 API 요청 1회를 검토하고 승인합니다.</label><button type="button" className="btn" disabled={busy || stale || !confirmed} onClick={() => void action({ action: 'approve', jobId: job.id, reviewFingerprint: job.review.fingerprint, confirmPaid: true })}>유료 요청 승인 · 아직 호출하지 않음</button></>}
        {job.status === 'approved' && <button type="button" className="btn blue" disabled={busy || stale} onClick={() => void action({ action: 'execute', jobId: job.id })}>승인한 번역 1회 실행 · 비용 발생</button>}
        {job.status === 'running' && <p>이미 시작된 요청을 다시 호출하지 않습니다. 장시간 상태가 유지되면 OpenAI 사용량과 서버 실행 이력을 확인해주세요.</p>}
        {job.error && <p role="alert">{job.error.message}{job.error.mayHaveBeenCharged ? ' 비용이 발생했을 수 있습니다.' : ''}</p>}
        {job.result && <>
          <p>AI 생성 초안 · 출처 검토 필요 · 기존 콘텐츠에 자동 적용하지 않았습니다.</p>
          {job.result.usage && <p>입력 {job.result.usage.inputTokens.toLocaleString()}토큰 · 출력 {job.result.usage.outputTokens.toLocaleString()}토큰</p>}
          {job.result.draft.warnings.length > 0 && <ul>{job.result.draft.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
          {(['title', 'keywords', 'description'] as const).map(field => <div key={field} className="translation-field"><strong>{field === 'title' ? '한국어 상품명' : field === 'keywords' ? 'SEO 검색어' : '한국어 설명'}</strong><pre>{Array.isArray(job.result!.draft[field]) ? (job.result!.draft[field] as string[]).join(', ') : job.result!.draft[field]}</pre><details><summary>현재 저장된 내용과 비교</summary><pre>{content ? JSON.stringify(content.seo[field].value, null, 2) : '불러오지 못함'}</pre></details><button className="btn" type="button" disabled={busy || !content} onClick={() => void adopt(field)}>검토한 초안을 이 항목에 적용 · 기존 내용 교체</button></div>)}
          {job.result.draft.attributes.length > 0 && <details><summary>번역된 속성·옵션 확인</summary><ul>{job.result.draft.attributes.map(attribute => <li key={attribute.sourceIndex}>{attribute.name}: {attribute.value}</li>)}</ul><button className="btn" type="button" disabled={busy || job.productVersion !== version} onClick={()=>void adoptOptions()}>검토한 옵션 번역 적용 · 빈 한국어 이름만</button></details>}
        </>}
      </div>}
    </>}
  </section>;
}
