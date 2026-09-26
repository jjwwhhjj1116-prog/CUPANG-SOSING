'use client';

import { QuotationKeywordReview } from '@/app/components/quotation-keyword-review';
import { useCallback, useEffect, useRef, useState } from 'react';
import { assetRoles, detailImageKeys, emptyProductContent, labelFields, productImageKeys, type AssetRole, type ContentField, type LabelField, type ProductContent } from '@/app/product-content';
import { orderedEditorImages, type AssetEditorFilter } from '@/app/option-editor-tools';
import { imageStagePatch, imageStageRoles, mergeSavedImageStage } from '@/app/image-stage-save';
import { fillLabelDraft } from '@/app/label-autofill';
import { ImageSizeNotice } from '@/app/components/image-size-notice';
import { currentLabelLayout, moveLabelField, type LabelLayout } from '@/app/product-content';
import { type CustomLabel } from '@/app/product-content';
import { CustomLabelEditor } from '@/app/components/custom-label-editor';

type Props = {
  product: { id: string; title: string; image_keys: string; updated_at?: string };
  section: 'SEO' | '표시사항' | '이미지';
  focusedAssetRole?: 'main' | 'additional' | 'detail';
  onSaved?: () => void;
};
type Draft = {
  seo: { title: string; keywords: string; description: string };
  label: Record<LabelField, string>;
  labelLayout: LabelLayout;
  customLabels: CustomLabel[];
  assets: Record<AssetRole, string[]>;
};
function draftFrom(content: ProductContent): Draft {
  return {
    seo: { title: content.seo.title.value, keywords: content.seo.keywords.value.join('\n'), description: content.seo.description.value },
    label: Object.fromEntries(Object.entries(content.label).map(([key, field]) => [key, field.value])) as Draft['label'],
    labelLayout: currentLabelLayout(content.labelLayout),
    customLabels: (content.customLabels??[]).map(item=>({...item})),
    assets: Object.fromEntries(Object.entries(content.assets).map(([key, field]) => [key, [...field.value]])) as Draft['assets'],
  };
}
const provenance = { unverified: '미작성', collected: '수집 원문', translated: '번역 결과', generated: '자동 생성 결과', manual: '직접 수정' };
function Origin({ field }: { field: ContentField<unknown> }) {
  return <small style={{ color: '#64748b', fontWeight: 400 }}>{provenance[field.provenance]}</small>;
}
async function fetchContent(endpoint: string, signal?: AbortSignal): Promise<ProductContent> {
  const response = await fetch(endpoint, { signal, cache: 'no-store' });
  const body = await response.json() as { content?: ProductContent; error?: string };
  if (!response.ok || !body.content) throw new Error(body.error || '저장본을 불러오지 못했습니다.');
  return body.content;
}

export function ProductContentEditor(props: Props) { return <ContentEditor key={props.product.id} {...props} />; }

function ContentEditor({ product, section, focusedAssetRole, onSaved }: Props) {
  const [content, setContent] = useState<ProductContent>(() => emptyProductContent(product.id));
  const [draft, setDraft] = useState<Draft>(() => draftFrom(emptyProductContent(product.id)));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [snapshotVersion, setSnapshotVersion] = useState(product.updated_at);
  const [refreshNotice, setRefreshNotice] = useState('');
  const activeRequest=useRef<AbortController|null>(null);
  const labelAutofillAttempted=useRef(false);
  useEffect(()=>()=>{activeRequest.current?.abort();},[]);
  const [assetFilterOverride, setAssetFilterOverride] = useState<{step:string;filter:AssetEditorFilter}|null>(null);
  const filterStep=focusedAssetRole??'all';
  const assetFilter:AssetEditorFilter=assetFilterOverride?.step===filterStep?assetFilterOverride.filter:'all';
  const setAssetFilter=(filter:AssetEditorFilter)=>setAssetFilterOverride({step:filterStep,filter});
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [imageSizes, setImageSizes] = useState<Record<string, { width: number; height: number } | null>>({});
  const endpoint = `/api/products/${encodeURIComponent(product.id)}/content`;
  const applyLoaded = useCallback((saved: ProductContent) => {
    setContent(saved); setDraft(draftFrom(saved)); setLoaded(true); setConflict(false); setError(''); setMessage('');
  }, []);
  const load = useCallback(async () => {
    if(activeRequest.current)return;
    const controller=new AbortController();activeRequest.current=controller;const signal=controller.signal;
    setLoading(true);
    try {
      const saved = await fetchContent(endpoint, signal);
      if (!signal?.aborted) { applyLoaded(saved); setSnapshotVersion(product.updated_at); setRefreshNotice(''); }
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : '저장본을 불러오지 못했습니다.');
    } finally { if(activeRequest.current===controller)activeRequest.current=null;if (!signal.aborted) setLoading(false); }
  }, [endpoint, applyLoaded, product.updated_at]);
  useEffect(() => {
    const controller = new AbortController();
    fetchContent(endpoint, controller.signal).then(saved => { if (!controller.signal.aborted) applyLoaded(saved); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '저장본을 불러오지 못했습니다.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, applyLoaded]);
  const initial = draftFrom(content);
  const draftKey = section === 'SEO' ? 'seo' : section === '표시사항' ? 'label' : 'assets';
  const editingDetail = section === '이미지' && focusedAssetRole === 'detail';
  const dirty = (editingDetail && draft.seo.description !== initial.seo.description) || (section==='이미지'?imageStageRoles(focusedAssetRole).some(role=>JSON.stringify(draft.assets[role])!==JSON.stringify(initial.assets[role])):JSON.stringify(draft[draftKey]) !== JSON.stringify(initial[draftKey])) || (section==='표시사항'&&(JSON.stringify(draft.labelLayout)!==JSON.stringify(initial.labelLayout)||JSON.stringify(draft.customLabels)!==JSON.stringify(initial.customLabels)));
  const anyDirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const changedElsewhere = Boolean(product.updated_at && product.updated_at !== snapshotVersion);
  useEffect(() => {
    if (!changedElsewhere || busy || loading || activeRequest.current) return;
    const controller = new AbortController();
    if (anyDirty) {
      Promise.resolve().then(() => { if (!controller.signal.aborted) setRefreshNotice('다른 탭에서 상품이 변경되었습니다. 현재 입력은 유지했습니다. 입력 내용을 보관한 뒤 최신 저장본을 확인해주세요.'); });
    } else {
      fetchContent(endpoint, controller.signal).then(saved => {
        if (!controller.signal.aborted && !activeRequest.current) { applyLoaded(saved); setSnapshotVersion(product.updated_at); setRefreshNotice(''); }
      }).catch(cause => { if (!controller.signal.aborted) setRefreshNotice(cause instanceof Error ? cause.message : '최신 저장본을 불러오지 못했습니다.'); });
    }
    return () => controller.abort();
  }, [changedElsewhere, anyDirty, endpoint, applyLoaded, product.updated_at, busy, loading]);
  let imageKeys: string[] = [];
  try { imageKeys = productImageKeys(product.image_keys); } catch { /* API reports invalid stored references on save. */ }
  const visibleImages = orderedEditorImages(imageKeys, draft.assets, assetFilter);
  const activePreview = previewKey && visibleImages.includes(previewKey) ? previewKey : visibleImages[0] ?? null;
  const detailPreview = focusedAssetRole === 'detail' ? detailImageKeys(draft.assets).filter(key => imageKeys.includes(key)) : [];
  const unavailableImages = [...new Set(Object.values(draft.assets).flat())].filter(key => !imageKeys.includes(key));
  const sectionTitle = section === '이미지' && focusedAssetRole ? assetRoles[focusedAssetRole] : section;

  async function fillLabel() {
    if(!loaded || busy || loading || activeRequest.current)return;
    const controller=new AbortController();activeRequest.current=controller;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/products/${encodeURIComponent(product.id)}/registration-settings`, { cache: 'no-store', signal:controller.signal });
      const body = await response.json() as { settings?: unknown; error?: string };
      if(controller.signal.aborted)return;
      if (!response.ok) throw new Error(body.error || '저장된 기본설정을 읽지 못했습니다.');
      const next = fillLabelDraft(draft.label, content, product.title, body.settings);
      setDraft(previous => ({ ...previous, label: next.label }));
      setMessage(next.filled.length
        ? `${next.filled.map(key => labelFields[key]).join(' · ')} 입력을 채웠습니다. 실제 상품과 대조한 뒤 표시사항을 저장하면 PNG와 견적 자료에 반영됩니다.`
        : '채울 수 있는 빈 항목이 없습니다. 직접 입력·직접 비운 항목은 보존했습니다.');
    } catch (cause) { if(!controller.signal.aborted)setError(cause instanceof Error ? cause.message : '기본설정 반영 실패'); }
    finally { if(activeRequest.current===controller)activeRequest.current=null;if(!controller.signal.aborted)setBusy(false); }
  }

  // Prepare a reviewable draft once on first entry; never refill a field the
  // owner clears later or discard unsaved edits in another stage.
  useEffect(() => {
    if (section !== '표시사항' || !loaded || loading || busy || anyDirty || activeRequest.current || labelAutofillAttempted.current) return;
    labelAutofillAttempted.current = true;
    void fillLabel();
  }, [section, loaded, loading, busy, anyDirty]);

  async function save() {
    if(!loaded || busy || loading || conflict || activeRequest.current)return;
    const controller=new AbortController();activeRequest.current=controller;
    setBusy(true); setError(''); setMessage('');
    const patch = section === 'SEO' ? { seo: { ...draft.seo, keywords: draft.seo.keywords.split(/[\n,]/).map(value => value.trim()).filter(Boolean) } }
      : section === '표시사항' ? { label: draft.label, labelLayout: draft.labelLayout, customLabels: draft.customLabels } : { assets: imageStagePatch(initial.assets,draft.assets,focusedAssetRole), ...(editingDetail ? { seo: { description: draft.seo.description } } : {}) };
    try {
      const response = await fetch(endpoint, { method: 'PATCH', signal:controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: content.revision, patch }) });
      const body = await response.json() as { content?: ProductContent; error?: string };
      if(controller.signal.aborted)return;
      if (!response.ok || !body.content) { if (response.status === 409) setConflict(true); throw new Error(body.error || '저장하지 못했습니다.'); }
      const saved = body.content;
      setContent(saved);
      // Preserve unsaved work in other tabs when this section is saved.
      setDraft(previous => ({ ...previous, [draftKey]: section==='이미지'?mergeSavedImageStage(initial.assets,previous.assets,draftFrom(saved).assets,focusedAssetRole):draftFrom(saved)[draftKey], ...(editingDetail ? { seo: { ...previous.seo, description: saved.seo.description.value } } : {}), ...(section==='표시사항'?{labelLayout:draftFrom(saved).labelLayout,customLabels:draftFrom(saved).customLabels}:{}) }));
      setMessage(`${section} 저장 완료 · 검토용 자료에 반영됩니다.`); onSaved?.();
    } catch (cause) { if(!controller.signal.aborted)setError(cause instanceof Error ? cause.message : '저장하지 못했습니다.'); }
    finally { if(activeRequest.current===controller)activeRequest.current=null;if(!controller.signal.aborted)setBusy(false); }
  }
  function assign(key: string, role: AssetRole | '') {
    setDraft(previous => {
      const assets = Object.fromEntries(Object.entries(previous.assets).map(([name, keys]) => [name, keys.filter(value => value !== key)])) as Draft['assets'];
      if (role) assets[role] = ['main', 'detailTop', 'detailBottom'].includes(role) ? [key] : [...assets[role], key];
      return { ...previous, assets };
    });
  }
  function move(role: AssetRole, index: number, offset: number) {
    setDraft(previous => {
      const keys = [...previous.assets[role]]; const destination = index + offset;
      if (destination < 0 || destination >= keys.length) return previous;
      [keys[index], keys[destination]] = [keys[destination], keys[index]];
      return { ...previous, assets: { ...previous.assets, [role]: keys } };
    });
  }

  return <div className="panel-stack" aria-busy={busy || loading} data-workspace-dirty={anyDirty} data-workspace-saving={busy}>
    {([
      ['SEO', JSON.stringify(draft.seo)!==JSON.stringify(initial.seo)],
      ['대표 이미지', JSON.stringify(draft.assets.main)!==JSON.stringify(initial.assets.main)],
      ['추가 이미지', JSON.stringify(draft.assets.additional)!==JSON.stringify(initial.assets.additional)],
      ['상세 이미지', ['detailTop','detail','detailBottom'].some(key=>JSON.stringify(draft.assets[key as AssetRole])!==JSON.stringify(initial.assets[key as AssetRole]))],
      ['표시사항', JSON.stringify(draft.label)!==JSON.stringify(initial.label)||JSON.stringify(draft.labelLayout)!==JSON.stringify(initial.labelLayout)||JSON.stringify(draft.customLabels)!==JSON.stringify(initial.customLabels)],
      ['대표 이미지', JSON.stringify(draft.assets.size)!==JSON.stringify(initial.assets.size)||JSON.stringify(draft.assets.label)!==JSON.stringify(initial.assets.label)],
    ] as const).map(([step,changed],index)=><span hidden key={index} data-quotation-source-step={step} data-workspace-dirty={changed}/>)}
    <div className="panel-note"><div><strong>{sectionTitle} 작업 자료</strong><p>{section === '표시사항' ? '필요한 표시사항을 기록하고 수정합니다. 빈 항목과 인증·법적 적합성은 카테고리 기준 확인이 필요합니다.' : section === '이미지' ? '업로드한 이미지를 역할과 순서에 맞게 배치합니다. 파일을 지정해도 번역·배경 제거가 실행되지는 않습니다.' : '수집·번역 결과를 검토하고 상품명, 검색어, 설명을 수정하는 작업 공간입니다. 작성하지 않은 내용은 자동으로 채우지 않습니다.'}</p></div></div>
    {loading && <p role="status">저장한 작업 자료를 불러오는 중입니다.</p>}
    {error && <div role="alert" className="panel-note"><div><strong>{error}</strong>{conflict && <p>현재 입력을 복사해 보관한 뒤 저장본을 불러와 변경 내용을 확인해주세요.</p>}<button type="button" className="btn ghost" disabled={busy || loading} onClick={() => void load()}>{loaded ? '입력 버리고 저장본 불러오기' : '다시 불러오기'}</button></div></div>}
    {message && <p role="status">{message}</p>}
    {refreshNotice && <div role="status" className="panel-note"><div><p>{refreshNotice}</p><button type="button" className="btn ghost" disabled={busy || loading} onClick={() => void load()}>입력 버리고 최신 저장본 불러오기</button></div></div>}
    {loaded && <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} disabled={busy || loading}>
      {section === '표시사항' && <button type="button" className="btn ghost" onClick={() => void fillLabel()}>상품명·저장 기본설정으로 빈 표시사항 채우기</button>}
      {section === 'SEO' && <div className="panel-stack">
        <label className="field"><span>노출 상품명 <Origin field={content.seo.title} /></span><input maxLength={500} value={draft.seo.title} placeholder={product.title} onChange={event => setDraft(previous => ({ ...previous, seo: { ...previous.seo, title: event.target.value } }))} /></label>
        {!draft.seo.title && <button type="button" className="btn ghost" onClick={() => setDraft(previous => ({ ...previous, seo: { ...previous.seo, title: product.title } }))}>현재 상품명 사용</button>}
        <label className="field"><span>검색어 · 줄바꿈 또는 쉼표로 구분, 최대 50개 <Origin field={content.seo.keywords} /></span><textarea maxLength={5050} value={draft.seo.keywords} onChange={event => setDraft(previous => ({ ...previous, seo: { ...previous.seo, keywords: event.target.value } }))} /></label>
        <QuotationKeywordReview value={draft.seo.keywords} onApply={keywords => setDraft(previous => ({ ...previous, seo: { ...previous.seo, keywords } }))}/>
        <label className="field"><span>상품 설명 · 텍스트 <Origin field={content.seo.description} /></span><textarea rows={8} maxLength={20000} value={draft.seo.description} onChange={event => setDraft(previous => ({ ...previous, seo: { ...previous.seo, description: event.target.value } }))} /></label>
      </div>}
      {section === '표시사항' && <>
        <p className="panel-note">↑↓로 라벨 순서를 바꾸고 표시 여부를 선택하세요. 숨긴 값은 보존되며 견적서 입력값은 바뀌지 않습니다. 변경 후 표시사항을 저장하고 라벨 이미지를 다시 생성해주세요.</p>
        <button type="button" className="btn ghost" onClick={()=>setDraft(previous=>({...previous,labelLayout:currentLabelLayout()}))}>기본 순서·전체 표시로 복원</button>
        <div className="form-grid">{draft.labelLayout.order.map((key,index) => <div className={`field ${key === 'precautions' || key === 'qualityAssurance' ? 'full' : ''}`} key={key}>
          <div className="quote-actions"><label><input type="checkbox" checked={!draft.labelLayout.hidden.includes(key)} onChange={event=>{const visible=event.target.checked;setDraft(previous=>({...previous,labelLayout:{...previous.labelLayout,hidden:visible?previous.labelLayout.hidden.filter(item=>item!==key):[...previous.labelLayout.hidden.filter(item=>item!==key),key]}}));}}/>{labelFields[key]} 라벨에 표시</label>
            <button type="button" className="btn ghost" aria-label={`${labelFields[key]} 위로`} disabled={index===0} onClick={()=>setDraft(previous=>({...previous,labelLayout:moveLabelField(previous.labelLayout,key,-1)}))}>↑</button>
            <button type="button" className="btn ghost" aria-label={`${labelFields[key]} 아래로`} disabled={index===draft.labelLayout.order.length-1} onClick={()=>setDraft(previous=>({...previous,labelLayout:moveLabelField(previous.labelLayout,key,1)}))}>↓</button></div>
          <label className="field"><span>{labelFields[key]} <Origin field={content.label[key]} /></span><textarea rows={2} maxLength={2000} value={draft.label[key]} onChange={event => setDraft(previous => ({ ...previous, label: { ...previous.label, [key]: event.target.value } }))} /></label>
          {key === 'specifications' && <p className="muted">확인한 상품별 세부 사양을 입력하세요. 헬스보호대 견적서의 같은 항목에 반영됩니다.</p>}
          {key === 'kcInformation' && <p className="muted">확인한 KC 인증정보를 입력하세요. 헬스보호대 견적의 KC 인증정보에 연결됩니다. 일반 인증·허가 사항과 별도로 저장하며, 인증번호·인증 마크 타입을 자동 판정하지 않습니다.</p>}
        </div>)}</div>
        <CustomLabelEditor rows={draft.customLabels} onChange={customLabels=>setDraft(previous=>({...previous,customLabels}))}/>
      </>}
      {section === '이미지' && <div className="panel-stack">
        <small style={{ color: '#64748b' }}>Supplier Hub 안내: 대표 1,000×1,000px 이상 권장 · 상세 상단·본문·하단 각각 가로 780px, 세로 1,500px 이내. 표시 크기는 브라우저가 읽은 값이며 화질·번역·접수 완료를 뜻하지 않습니다. 원본 헤더 기준 견적 검사와 다를 수 있습니다.</small>
        {focusedAssetRole&&<div className="image-step-summary"><div><strong>{assetRoles[focusedAssetRole]} <b>{draft.assets[focusedAssetRole].length}장</b></strong><p>{focusedAssetRole==='main'?'상품을 대표할 이미지 한 장을 선택하세요.':focusedAssetRole==='additional'?'상품의 다른 모습과 옵션 이미지를 선택하고 순서를 조정하세요.':'이미지 역할에서 상단·본문·하단을 선택하세요. 상단과 하단은 각각 한 장이며 본문 순서는 ↑↓로 조정합니다.'} 저장한 선택은 견적 자료에 반영됩니다.</p></div><button type="button" className="btn ghost" disabled={!draft.assets[focusedAssetRole].length} onClick={()=>setAssetFilter(focusedAssetRole)}>선택한 이미지 보기</button></div>}
        {!imageKeys.length && <p>위 업로드 버튼으로 이미지 파일을 추가하면 역할을 지정할 수 있습니다.</p>}
        {imageKeys.length > 0 && <><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}><button type="button" className={`btn ${assetFilter === 'all' ? 'primary' : 'ghost'}`} aria-pressed={assetFilter === 'all'} onClick={() => setAssetFilter('all')}>전체 {imageKeys.length}</button>{(Object.entries(assetRoles) as [AssetRole, string][]).map(([role, label]) => <button type="button" key={role} className={`btn ${assetFilter === role ? 'primary' : 'ghost'}`} aria-pressed={assetFilter === role} onClick={() => setAssetFilter(role)}>{label} {draft.assets[role].filter(key => imageKeys.includes(key)).length}</button>)}<button type="button" className={`btn ${assetFilter === 'unassigned' ? 'primary' : 'ghost'}`} aria-pressed={assetFilter === 'unassigned'} onClick={() => setAssetFilter('unassigned')}>미지정 {orderedEditorImages(imageKeys, draft.assets, 'unassigned').length}</button></div><small style={{ color: '#64748b' }}>역할별 저장 순서로 표시합니다. ↑↓로 순서를 바꾸고 이미지를 누르면 크게 볼 수 있습니다.</small></>}
        {unavailableImages.length > 0 && <div className="panel-note"><div><p>현재 상품 이미지 목록에 없는 역할 참조가 {unavailableImages.length}개 있습니다.</p><button type="button" className="btn ghost" onClick={() => setDraft(previous => ({ ...previous, assets: Object.fromEntries(Object.entries(previous.assets).map(([role, keys]) => [role, keys.filter(key => imageKeys.includes(key))])) as Draft['assets'] }))}>연결이 없는 역할 참조 제외</button></div></div>}
        {editingDetail && <label className="field"><span>상세 설명</span><textarea aria-label="상세페이지 설명" value={draft.seo.description} maxLength={20000} rows={6} onChange={event=>setDraft(previous=>({...previous,seo:{...previous.seo,description:event.target.value}}))}/><small>1단계 설명과 같은 내용입니다. 이미지와 함께 저장하면 7단계 자동 HTML과 상세페이지 검토 파일에 반영됩니다. 7단계에서 직접 수정한 HTML은 유지됩니다.</small></label>}
        <div className="image-edit-workspace">
        <section className="image-edit-canvas" aria-label={focusedAssetRole==='detail'?'상세페이지 배치 미리보기':'선택 이미지 미리보기'}>
          {editingDetail && draft.seo.description && <div aria-label="상세 설명 미리보기" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',padding:16}}>{draft.seo.description}</div>}
          {detailPreview.length>0 ? <div className="detail-image-strip">{detailPreview.map((key,index)=><figure key={key}><figcaption>{draft.assets.detailTop.includes(key)?'상단 이미지':draft.assets.detailBottom.includes(key)?'하단 이미지':`본문 이미지 ${draft.assets.detail.indexOf(key)+1}`}</figcaption>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files/${key.split('/').map(encodeURIComponent).join('/')}`} alt={`상세페이지 순서 ${index+1}`} loading="lazy"/>
          </figure>)}</div> : activePreview ? <figure className="image-large-preview"><figcaption>이미지 {imageKeys.indexOf(activePreview)+1} 미리보기</figcaption>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files/${activePreview.split('/').map(encodeURIComponent).join('/')}`} alt={`이미지 ${imageKeys.indexOf(activePreview)+1} 큰 미리보기`}/>
          </figure> : <p className="empty">이미지 목록에서 미리볼 자료를 선택하세요.</p>}
        </section>
        <aside className="image-edit-library" aria-label="상품 이미지 선택 목록">
        {imageKeys.length > 0 && !visibleImages.length && <p>이 역할에 지정한 이미지가 없습니다.</p>}
        <div className="image-asset-grid">{visibleImages.map(key => {
          const index = imageKeys.indexOf(key);
          const role = (Object.keys(assetRoles) as AssetRole[]).find(value => draft.assets[value].includes(key)) ?? '';
          const position = role ? draft.assets[role].indexOf(key) : -1;
          return <div key={key} className={`image-asset-card ${key===activePreview?'previewing':''} ${role===focusedAssetRole?'chosen':''}`}>
            <button type="button" className="image-asset-preview" aria-label={`이미지 ${index + 1} 크게 보기`} onClick={() => setPreviewKey(key)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/files/${key.split('/').map(encodeURIComponent).join('/')}`} alt={`업로드 이미지 ${index + 1}`} width={200} height={180} loading="lazy"
                onLoad={event => { const { naturalWidth: width, naturalHeight: height } = event.currentTarget; setImageSizes(previous => ({ ...previous, [key]: { width, height } })); }}
                onError={() => setImageSizes(previous => ({ ...previous, [key]: null }))} />
              <span>이미지 {index + 1} · 확대</span>
            </button>
            <ImageSizeNotice size={imageSizes[key]} role={role} />
            {focusedAssetRole&&<button type="button" className={`btn ${role===focusedAssetRole?'primary':'ghost'}`} aria-pressed={role===focusedAssetRole} onClick={()=>assign(key,role===focusedAssetRole?'':focusedAssetRole)}>{role===focusedAssetRole?'선택 해제':`${assetRoles[focusedAssetRole]}로 선택`}</button>}
            <label className="field"><span>이미지 {index + 1} 역할</span><select aria-label={`이미지 ${index + 1} 역할`} value={role} onChange={event => assign(key, event.target.value as AssetRole | '')}><option value="">자료에서 제외</option>{Object.entries(assetRoles).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            {role && <div className="image-asset-order"><span>{assetRoles[role]} {position + 1}번째</span><div><button type="button" className="btn ghost" aria-label={`이미지 ${index + 1} 앞 순서로`} disabled={position === 0} onClick={() => move(role, position, -1)}>↑</button><button type="button" className="btn ghost" aria-label={`이미지 ${index + 1} 뒤 순서로`} disabled={position === draft.assets[role].length - 1} onClick={() => move(role, position, 1)}>↓</button></div></div>}
          </div>;
        })}</div></aside></div>
        {focusedAssetRole && <div className="image-selected-strip" aria-label="현재 선택 이미지 순서">{draft.assets[focusedAssetRole].filter(key=>imageKeys.includes(key)).map((key,index)=><button type="button" key={key} onClick={()=>{setAssetFilter(focusedAssetRole);setPreviewKey(key);}} aria-label={`선택 이미지 ${index+1} 미리보기`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/files/${key.split('/').map(encodeURIComponent).join('/')}`} alt="" width={64} height={64}/><span>{index+1}</span>
        </button>)}</div>}
      </div>}
      <div className="content-editor-save"><span>{dirty ? '저장하지 않은 변경' : content.revision ? `저장 버전 ${content.revision}` : '아직 저장한 내용 없음'}{section==='이미지'&&<small>{focusedAssetRole?'현재 단계의 이미지 배치를 저장합니다. 다른 단계의 입력은 유지됩니다.':'이미지 역할과 순서를 함께 저장합니다.'}</small>}</span><button type="button" className="btn primary" disabled={busy || !dirty || conflict} onClick={() => void save()}>{busy ? '저장 중…' : editingDetail?'상세 설명·이미지 저장':section==='이미지'?'이미지 역할·순서 저장':`${section} 저장`}</button></div>
    </fieldset>}
  </div>;
}
