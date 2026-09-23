'use client';

/* Authenticated R2 previews use the existing file route without a public image optimizer. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from 'react';
import { generatedImagesRolePatch } from '@/app/image-role-adoption';
import type { ProductContent } from '@/app/product-content';
import type { ImageEditJob, ImageEditView, ImagePurpose, ImageQuality, ImageSize } from '@/app/automation/image-edit';

type Props = { productId: string; version: string; imageKeys: string[]; onProductChanged?: () => void };
const statuses: Record<ImageEditJob['status'], string> = { prepared: '원본·요청 검토 대기', approved: '승인됨 · 실행 대기', running: '실행 중 · 중복 호출 차단', completed: '이미지 생성 완료 · 검토 필요', failed: '실패 · 자동 재호출 없음', uncertain: '결과 확인 필요 · 자동 재호출 없음' };
const imageUrl = (key: string) => `/api/files/${encodeURIComponent(key)}`;

export default function ImageGenerationPanel({ productId, version, imageKeys, onProductChanged }: Props) {
  const [view, setView] = useState<ImageEditView | null>(null);
  const [sourceKey, setSourceKey] = useState('');
  const [purpose, setPurpose] = useState<ImagePurpose>('translate');
  const [size, setSize] = useState<ImageSize>('1024x1024');
  const [quality, setQuality] = useState<ImageQuality>('low');
  const [prompt, setPrompt] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice,setNotice]=useState('');
  const [reviewedIds,setReviewedIds]=useState<string[]>([]);
  const source = imageKeys.includes(sourceKey) ? sourceKey : imageKeys[0] ?? '';
  const job = view?.jobs.find(item => item.id === selectedId) ?? view?.jobs[0] ?? null;
  const stale = Boolean(job && (job.productVersion !== version || job.review.settingsFingerprint !== view?.settingsFingerprint || job.review.recipeVersion !== 1));

  useEffect(() => {
    let active = true;
    fetch(`/api/products/${productId}/image-generation`).then(async response => {
      const value = await response.json() as ImageEditView & { error?: string };
      if (!response.ok) throw Error(value.error ?? '이미지 작업을 불러오지 못했습니다.');
      if (active) setView(value);
    }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [productId, version]);
  async function action(body: Record<string, unknown>) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/products/${productId}/image-generation`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const value = await response.json() as Partial<ImageEditView> & { job?: ImageEditJob; error?: string };
      if (!response.ok || !value.job) throw Error(value.error ?? '이미지 요청을 처리하지 못했습니다.');
      const saved = value.job;
      setView(previous => ({ configuration: value.configuration ?? previous!.configuration, settings: value.settings ?? previous!.settings, settingsFingerprint: value.settingsFingerprint ?? previous!.settingsFingerprint, jobs: [saved, ...(previous?.jobs ?? []).filter(item => item.id !== saved.id)] }));
      setSelectedId(saved.id); setConfirmed(false);
      if (saved.result?.attached) onProductChanged?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '요청 실패'); }
    finally { setBusy(false); }
  }
  async function adoptRoles(batch = false) {
    const selected=batch?(view?.jobs??[]).filter(item=>reviewedIds.includes(item.id)):job?[job]:[];
    if(batch&&selected.length!==reviewedIds.length){setError('선택한 작업 목록이 변경됐습니다. 실행 이력을 새로고침하고 다시 선택해주세요.');return;}
    if(!selected.length)return;setBusy(true);setError('');setNotice('');
    try{
      const response=await fetch(`/api/products/${encodeURIComponent(productId)}/content`,{cache:'no-store'});
      const current=await response.json() as {content:ProductContent;error?:string};
      if(!response.ok)throw Error(current.error??'이미지 역할을 읽지 못했습니다.');
      const patch=generatedImagesRolePatch(current.content,selected,imageKeys);
      const saved=await fetch(`/api/products/${encodeURIComponent(productId)}/content`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:current.content.revision,patch})});
      const value=await saved.json() as {error?:string};if(!saved.ok)throw Error(value.error??'이미지 역할 저장 실패');
      setReviewedIds([]);
      setNotice('원본이 있던 대표·추가·상세 위치에 검토한 결과를 적용했습니다. 다른 이미지 순서와 라벨·사이즈표는 유지했습니다. 원본 파일도 보관되어 있습니다.');onProductChanged?.();
    }catch(reason){setError(reason instanceof Error?reason.message:'이미지 적용 실패');}
    finally{setBusy(false);}
  }
  async function refresh() {
    setBusy(true); setError('');
    try { const response = await fetch(`/api/products/${productId}/image-generation`); const next = await response.json() as ImageEditView & { error?: string }; if (!response.ok) throw Error(next.error ?? '조회 실패'); setView(next); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '조회 실패'); } finally { setBusy(false); }
  }
  return <section className="translation-panel image-generation-panel" aria-label="원본 이미지 AI 가공">
    <h4>원본 이미지 AI 가공</h4>
    <p>상품에 업로드한 PNG·JPEG·WebP 한 장을 가공합니다. 결과는 새 파일로 보관하며, 원본과 기존 이미지 역할을 보존합니다.</p>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!view && !error && <p>이미지 실행 설정을 확인하고 있습니다.</p>}
    {view && <>
      {!view.configuration.configured && <div className="connection-note"><strong>이미지 서버 연결 설정이 필요합니다</strong><ul>{view.configuration.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
      <div className="connection-note"><strong>저장된 기본 설정으로 요청 준비</strong>
        <p>문구 번역 {view.settings.translateImages ? '켜짐' : '꺼짐'} · 대표 이미지 배경 정리 {view.settings.removeBackground ? '켜짐' : '꺼짐'} · 저작권 표시 {view.settings.addCopyright ? '켜짐 · 확인된 권리자 문구가 없어 미적용' : '꺼짐'}</p>
        <p>번역 목적을 직접 선택하면 기본 번역 설정과 관계없이 번역합니다. 번역·상세 작업의 배경과 원문 배치는 보존합니다.</p>
        {view.settings.translationPrompt && <details><summary>저장된 번역 지침</summary><pre>{view.settings.translationPrompt}</pre></details>}
        <button type="button" className="btn" disabled={busy} onClick={() => void refresh()}>저장된 설정·실행 이력 새로고침 · 무료</button>
      </div>
      {!imageKeys.length && <p>먼저 이 상품에 원본 이미지를 업로드해주세요. 원본 없이 임의의 상품 이미지를 생성하지 않습니다.</p>}
      <label>가공할 원본<select value={source} onChange={event => setSourceKey(event.target.value)} disabled={busy || !imageKeys.length}>{!imageKeys.length && <option value="">원본 이미지 없음</option>}{imageKeys.map((key, index) => <option key={key} value={key}>이미지 {index + 1} · {key.split('/').at(-1)}</option>)}</select></label>
      {source && <img src={imageUrl(source)} alt="선택한 원본 이미지" style={{ maxWidth: 240, maxHeight: 240, objectFit: 'contain' }} />}
      <label>작업 목적<select value={purpose} onChange={event => setPurpose(event.target.value as ImagePurpose)} disabled={busy}><option value="translate">이미지 속 문구 번역</option><option value="thumbnail">대표 이미지 초안</option><option value="detail">상세 이미지 초안</option></select></label>
      <label>추가 가공 요청 · 선택<textarea rows={4} maxLength={4000} value={prompt} onChange={event => setPrompt(event.target.value)} disabled={busy} placeholder="비워두면 작업 목적과 저장된 설정으로 준비합니다. 추가로 보존할 부분·배치 요청을 적을 수 있습니다. 원문 사실과 기본 처리 규칙은 유지합니다." /></label>
      <div className="form-row"><label>결과 크기<select value={size} onChange={event => setSize(event.target.value as ImageSize)} disabled={busy}><option>1024x1024</option><option>1024x1536</option><option>1536x1024</option></select></label><label>품질<select value={quality} onChange={event => setQuality(event.target.value as ImageQuality)} disabled={busy}><option value="low">낮음</option><option value="medium">중간</option><option value="high">높음</option></select></label></div>
      <button className="btn" type="button" disabled={busy || !source || !view.configuration.configured} onClick={() => void action({ action: 'prepare', expectedVersion: version, sourceKey: source, prompt, purpose, size, quality, idempotencyKey: crypto.randomUUID() })}>이미지 요청 검토하기 · 무료</button>
      {view.jobs.length > 1 && <label>이전 이미지 작업<select value={job?.id ?? ''} onChange={event => { setSelectedId(event.target.value); setConfirmed(false); }} disabled={busy}>{view.jobs.map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} · {statuses[item.status]}</option>)}</select></label>}
      <details className="translation-review"><summary>완료한 이미지 결과 여러 장 검토·적용</summary>
        <p>원본과 결과를 비교한 항목만 선택하세요. 같은 콘텐츠 버전에서 만든 결과를 한 번에 저장하여 이미지 순서를 유지합니다.</p>
        {(view.jobs.filter(item=>item.status==='completed'&&item.result?.attached)).map(item=><label key={item.id} style={{display:'block'}}>
          <input type="checkbox" checked={reviewedIds.includes(item.id)} disabled={busy} onChange={event=>setReviewedIds(ids=>event.target.checked?[...ids,item.id]:ids.filter(id=>id!==item.id))}/>
          <span>{new Date(item.createdAt).toLocaleString()} · 원본 → 결과</span>
          <img src={imageUrl(item.review.sourceKey)} alt="일괄 검토 원본" style={{width:100,height:100,objectFit:'contain'}}/>
          <img src={imageUrl(item.result!.storageKey)} alt="일괄 검토 가공 결과" style={{width:100,height:100,objectFit:'contain'}}/>
        </label>)}
        <button className="btn" type="button" disabled={busy||!reviewedIds.length} onClick={()=>void adoptRoles(true)}>검토한 결과 {reviewedIds.length}개를 원본 위치에 함께 적용 · 무료</button>
        <small>기존 역할이나 콘텐츠가 변경된 항목이 있으면 전체 적용을 중단합니다. 라벨·사이즈표와 원본 파일은 보존합니다.</small>
      </details>
      {job && <div className="translation-review">
        <h4>{statuses[job.status]}</h4>
        <p>모델 <strong>{job.review.model}</strong> · 결과 PNG 1장 · {job.review.size} · 품질 {job.review.quality}</p>
        <p>원본 {job.review.source.width}×{job.review.source.height} · {(job.review.source.bytes / 1024).toFixed(1)}KB · {job.review.source.mime}</p>
        <img src={imageUrl(job.review.sourceKey)} alt="검토 요청에 고정된 원본 이미지" style={{ maxWidth: 240, maxHeight: 240, objectFit: 'contain' }} />
        {job.review.recipe && <div><strong>이 요청에 적용하는 처리 설정</strong><ul>{job.review.recipe.map(step => <li key={step.key}><strong>{step.status === 'applied' ? '적용' : '미적용'}</strong> · {step.description}</li>)}</ul></div>}
        <details><summary>검토 당시 저장 설정과 직접 입력한 추가 요청</summary><pre>{JSON.stringify(job.review.settingsSnapshot ?? {}, null, 2)}</pre><p>{job.review.prompt || '추가 요청 없음 · 저장 설정과 목적을 적용'}</p></details>
        <details><summary>원본 SHA-256과 실제 전송 요청 확인</summary><p>{job.review.source.sha256}</p><pre>{job.review.effectivePrompt}</pre></details>
        <button className="btn" type="button" disabled={busy || !imageKeys.includes(job.review.sourceKey)} onClick={() => { setSourceKey(job.review.sourceKey); setPurpose(job.review.purpose); setSize(job.review.size); setQuality(job.review.quality); setPrompt(job.review.prompt); setConfirmed(false); }}>이 요청을 위 입력란으로 복사해 수정 · 새 검토 필요</button>
        <p>{job.review.paidNotice} <a href={job.review.pricingUrl} target="_blank" rel="noreferrer">공식 요금표</a></p>
        <p>승인 유효 기한: {new Date(job.review.expiresAt).toLocaleString()}</p>
        {stale && ['prepared', 'approved'].includes(job.status) && <p className="form-error">상품 또는 이미지 처리 설정이 변경되었습니다. 새 요청으로 원본과 설정을 다시 검토해주세요.</p>}
        {job.status === 'prepared' && <><label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy || stale} />위 원본·설정·모델·요청·크기·품질의 유료 가공 1회를 승인합니다.</label><button type="button" className="btn" disabled={busy || stale || !confirmed} onClick={() => void action({ action: 'approve', jobId: job.id, reviewFingerprint: job.review.fingerprint, confirmPaid: true })}>유료 요청 승인 · 아직 호출하지 않음</button></>}
        {job.status === 'approved' && <button className="btn blue" type="button" disabled={busy || stale} onClick={() => void action({ action: 'execute', jobId: job.id })}>승인한 이미지 1장 가공 · 비용 발생</button>}
        {job.status === 'running' && <><p>실행 중이거나 결과 확인이 필요한 상태입니다. 같은 작업으로 유료 호출을 반복하지 않습니다.</p><button className="btn" type="button" disabled={busy} onClick={() => void refresh()}>저장된 실행 상태 새로고침 · 무료</button></>}
        {job.error && <p role="alert">{job.error.message}{job.error.mayHaveBeenCharged ? ' 비용이 발생했을 수 있습니다.' : ''}</p>}
        {job.result && <div className="translation-field"><h4>생성 결과 검토</h4><img src={imageUrl(job.result.storageKey)} alt="AI 가공 결과 · 검토 필요" style={{ maxWidth: '100%', maxHeight: 480, objectFit: 'contain' }} /><p>번역 정확성·상표·인증·법적 표시사항을 확인한 결과가 아닙니다. 원본과 비교한 뒤 이미지 역할을 지정해주세요.</p><p>{job.result.attached ? '상품 이미지 목록에 추가했습니다. 대표·상세 역할은 자동 지정하지 않았습니다.' : '가공 중 상품이 변경되어 결과만 보관했습니다. 아래 버튼은 저장한 결과를 무료로 첨부합니다.'}</p>{job.result.attached && <><button className="btn" type="button" disabled={busy || !imageKeys.includes(job.result.storageKey)} onClick={()=>void adoptRoles()}>검토한 결과를 원본의 대표·추가·상세 위치에 적용</button><small>가공 요청 이후 콘텐츠를 수정했다면 이미지 편집에서 직접 선택해주세요.</small></>}{!job.result.attached && <button className="btn" type="button" disabled={busy} onClick={() => void action({ action: 'attach', jobId: job.id, expectedVersion: version })}>생성된 결과를 현재 상품에 추가 · 무료</button>}</div>}
      </div>}
    </>}
  </section>;
}
