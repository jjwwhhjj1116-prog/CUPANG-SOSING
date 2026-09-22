'use client';

import { useCallback, useEffect, useState } from 'react';
import { assetRoles, emptyProductContent, labelFields, productImageKeys, type AssetRole, type ContentField, type LabelField, type ProductContent } from '@/app/product-content';
import { orderedEditorImages, type AssetEditorFilter } from '@/app/option-editor-tools';

type Props = {
  product: { id: string; title: string; image_keys: string; updated_at?: string };
  section: 'SEO' | '표시사항' | '이미지';
  onSaved?: () => void;
};
type Draft = {
  seo: { title: string; keywords: string; description: string };
  label: Record<LabelField, string>;
  assets: Record<AssetRole, string[]>;
};
function draftFrom(content: ProductContent): Draft {
  return {
    seo: { title: content.seo.title.value, keywords: content.seo.keywords.value.join('\n'), description: content.seo.description.value },
    label: Object.fromEntries(Object.entries(content.label).map(([key, field]) => [key, field.value])) as Draft['label'],
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

function ContentEditor({ product, section, onSaved }: Props) {
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
  const [assetFilter, setAssetFilter] = useState<AssetEditorFilter>('all');
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const endpoint = `/api/products/${encodeURIComponent(product.id)}/content`;
  const applyLoaded = useCallback((saved: ProductContent) => {
    setContent(saved); setDraft(draftFrom(saved)); setLoaded(true); setConflict(false); setError(''); setMessage('');
  }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const saved = await fetchContent(endpoint, signal);
      if (!signal?.aborted) { applyLoaded(saved); setSnapshotVersion(product.updated_at); setRefreshNotice(''); }
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : '저장본을 불러오지 못했습니다.');
    } finally { if (!signal?.aborted) setLoading(false); }
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
  const dirty = JSON.stringify(draft[draftKey]) !== JSON.stringify(initial[draftKey]);
  const anyDirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const changedElsewhere = Boolean(product.updated_at && product.updated_at !== snapshotVersion);
  useEffect(() => {
    if (!changedElsewhere) return;
    const controller = new AbortController();
    if (anyDirty) {
      Promise.resolve().then(() => { if (!controller.signal.aborted) setRefreshNotice('다른 탭에서 상품이 변경되었습니다. 현재 입력은 유지했습니다. 입력 내용을 보관한 뒤 최신 저장본을 확인해주세요.'); });
    } else {
      fetchContent(endpoint, controller.signal).then(saved => {
        if (!controller.signal.aborted) { applyLoaded(saved); setSnapshotVersion(product.updated_at); setRefreshNotice(''); }
      }).catch(cause => { if (!controller.signal.aborted) setRefreshNotice(cause instanceof Error ? cause.message : '최신 저장본을 불러오지 못했습니다.'); });
    }
    return () => controller.abort();
  }, [changedElsewhere, anyDirty, endpoint, applyLoaded, product.updated_at]);
  let imageKeys: string[] = [];
  try { imageKeys = productImageKeys(product.image_keys); } catch { /* API reports invalid stored references on save. */ }
  const visibleImages = orderedEditorImages(imageKeys, draft.assets, assetFilter);
  const unavailableImages = [...new Set(Object.values(draft.assets).flat())].filter(key => !imageKeys.includes(key));

  async function save() {
    setBusy(true); setError(''); setMessage('');
    const patch = section === 'SEO' ? { seo: { ...draft.seo, keywords: draft.seo.keywords.split(/[\n,]/).map(value => value.trim()).filter(Boolean) } }
      : section === '표시사항' ? { label: draft.label } : { assets: draft.assets };
    try {
      const response = await fetch(endpoint, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: content.revision, patch }) });
      const body = await response.json() as { content?: ProductContent; error?: string };
      if (!response.ok || !body.content) { if (response.status === 409) setConflict(true); throw new Error(body.error || '저장하지 못했습니다.'); }
      const saved = body.content;
      setContent(saved);
      // Preserve unsaved work in other tabs when this section is saved.
      setDraft(previous => ({ ...previous, [draftKey]: draftFrom(saved)[draftKey] }));
      setMessage(`${section} 저장 완료 · 검토용 자료에 반영됩니다.`); onSaved?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '저장하지 못했습니다.'); }
    finally { setBusy(false); }
  }
  function assign(key: string, role: AssetRole | '') {
    setDraft(previous => {
      const assets = Object.fromEntries(Object.entries(previous.assets).map(([name, keys]) => [name, keys.filter(value => value !== key)])) as Draft['assets'];
      if (role) assets[role] = role === 'main' ? [key] : [...assets[role], key];
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

  return <div className="panel-stack" aria-busy={busy || loading}>
    <div className="panel-note"><div><strong>{section} 작업 자료</strong><p>{section === '표시사항' ? '필요한 표시사항을 기록하고 수정합니다. 빈 항목과 인증·법적 적합성은 카테고리 기준 확인이 필요합니다.' : section === '이미지' ? '업로드한 이미지를 역할과 순서에 맞게 배치합니다. 파일을 지정해도 번역·배경 제거가 실행되지는 않습니다.' : '수집·번역 결과를 검토하고 상품명, 검색어, 설명을 수정하는 작업 공간입니다. 작성하지 않은 내용은 자동으로 채우지 않습니다.'}</p></div></div>
    {loading && <p role="status">저장한 작업 자료를 불러오는 중입니다.</p>}
    {error && <div role="alert" className="panel-note"><div><strong>{error}</strong>{conflict && <p>현재 입력을 복사해 보관한 뒤 저장본을 불러와 변경 내용을 확인해주세요.</p>}<button type="button" className="btn ghost" disabled={busy || loading} onClick={() => { setLoading(true); void load(); }}>{loaded ? '입력 버리고 저장본 불러오기' : '다시 불러오기'}</button></div></div>}
    {message && <p role="status">{message}</p>}
    {refreshNotice && <div role="status" className="panel-note"><div><p>{refreshNotice}</p><button type="button" className="btn ghost" disabled={busy || loading} onClick={() => { setLoading(true); void load(); }}>입력 버리고 최신 저장본 불러오기</button></div></div>}
    {loaded && <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} disabled={busy || loading}>
      {section === 'SEO' && <div className="panel-stack">
        <label className="field"><span>노출 상품명 <Origin field={content.seo.title} /></span><input maxLength={500} value={draft.seo.title} placeholder={product.title} onChange={event => setDraft(previous => ({ ...previous, seo: { ...previous.seo, title: event.target.value } }))} /></label>
        {!draft.seo.title && <button type="button" className="btn ghost" onClick={() => setDraft(previous => ({ ...previous, seo: { ...previous.seo, title: product.title } }))}>현재 상품명 사용</button>}
        <label className="field"><span>검색어 · 줄바꿈 또는 쉼표로 구분, 최대 50개 <Origin field={content.seo.keywords} /></span><textarea maxLength={5050} value={draft.seo.keywords} onChange={event => setDraft(previous => ({ ...previous, seo: { ...previous.seo, keywords: event.target.value } }))} /></label>
        <label className="field"><span>상품 설명 · 텍스트 <Origin field={content.seo.description} /></span><textarea rows={8} maxLength={20000} value={draft.seo.description} onChange={event => setDraft(previous => ({ ...previous, seo: { ...previous.seo, description: event.target.value } }))} /></label>
      </div>}
      {section === '표시사항' && <div className="form-grid">{(Object.keys(labelFields) as LabelField[]).map(key => <label className={`field ${key === 'precautions' || key === 'qualityAssurance' ? 'full' : ''}`} key={key}><span>{labelFields[key]} <Origin field={content.label[key]} /></span><textarea rows={2} maxLength={2000} value={draft.label[key]} onChange={event => setDraft(previous => ({ ...previous, label: { ...previous.label, [key]: event.target.value } }))} /></label>)}</div>}
      {section === '이미지' && <div className="panel-stack">
        {!imageKeys.length && <p>위 업로드 버튼으로 이미지 파일을 추가하면 역할을 지정할 수 있습니다.</p>}
        {imageKeys.length > 0 && <><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}><button type="button" className={`btn ${assetFilter === 'all' ? 'primary' : 'ghost'}`} aria-pressed={assetFilter === 'all'} onClick={() => setAssetFilter('all')}>전체 {imageKeys.length}</button>{(Object.entries(assetRoles) as [AssetRole, string][]).map(([role, label]) => <button type="button" key={role} className={`btn ${assetFilter === role ? 'primary' : 'ghost'}`} aria-pressed={assetFilter === role} onClick={() => setAssetFilter(role)}>{label} {draft.assets[role].filter(key => imageKeys.includes(key)).length}</button>)}<button type="button" className={`btn ${assetFilter === 'unassigned' ? 'primary' : 'ghost'}`} aria-pressed={assetFilter === 'unassigned'} onClick={() => setAssetFilter('unassigned')}>미지정 {orderedEditorImages(imageKeys, draft.assets, 'unassigned').length}</button></div><small style={{ color: '#64748b' }}>역할별 저장 순서로 표시합니다. ↑↓로 순서를 바꾸고 이미지를 누르면 크게 볼 수 있습니다.</small></>}
        {unavailableImages.length > 0 && <div className="panel-note"><div><p>현재 상품 이미지 목록에 없는 역할 참조가 {unavailableImages.length}개 있습니다.</p><button type="button" className="btn ghost" onClick={() => setDraft(previous => ({ ...previous, assets: Object.fromEntries(Object.entries(previous.assets).map(([role, keys]) => [role, keys.filter(key => imageKeys.includes(key))])) as Draft['assets'] }))}>연결이 없는 역할 참조 제외</button></div></div>}
        {previewKey && imageKeys.includes(previewKey) && <figure style={{ margin: 0, border: '1px solid #dfe4ec', borderRadius: 12, padding: 12 }}><figcaption style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}><strong>이미지 {imageKeys.indexOf(previewKey) + 1} 크게 보기</strong><button type="button" className="btn ghost" onClick={() => setPreviewKey(null)}>미리보기 닫기</button></figcaption>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/files/${previewKey.split('/').map(encodeURIComponent).join('/')}`} alt={`이미지 ${imageKeys.indexOf(previewKey) + 1} 큰 미리보기`} style={{ display: 'block', maxWidth: '100%', maxHeight: 520, margin: 'auto', objectFit: 'contain' }} />
        </figure>}
        {imageKeys.length > 0 && !visibleImages.length && <p>이 역할에 지정한 이미지가 없습니다.</p>}
        {visibleImages.map(key => {
          const index = imageKeys.indexOf(key);
          const role = (Object.keys(assetRoles) as AssetRole[]).find(value => draft.assets[value].includes(key)) ?? '';
          const position = role ? draft.assets[role].indexOf(key) : -1;
          return <div key={key} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: 12, border: '1px solid #dfe4ec', borderRadius: 12 }}>
            <button type="button" aria-label={`이미지 ${index + 1} 크게 보기`} onClick={() => setPreviewKey(key)} style={{ border: 0, padding: 0, background: 'transparent', cursor: 'zoom-in' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/files/${key.split('/').map(encodeURIComponent).join('/')}`} alt={`업로드 이미지 ${index + 1}`} width={80} height={80} style={{ display: 'block', objectFit: 'contain', background: '#f8fafc' }} />
            </button>
            <label className="field" style={{ flex: 1 }}><span>이미지 {index + 1} 역할</span><select aria-label={`이미지 ${index + 1} 역할`} value={role} onChange={event => assign(key, event.target.value as AssetRole | '')} style={{ padding: 10, border: '1px solid #dfe4ec', borderRadius: 8 }}><option value="">자료에서 제외</option>{Object.entries(assetRoles).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            {role && <div><span>{assetRoles[role]} {position + 1}번째</span><div style={{ display: 'flex', gap: 6, marginTop: 6 }}><button type="button" className="btn ghost" aria-label={`이미지 ${index + 1} 앞 순서로`} disabled={position === 0} onClick={() => move(role, position, -1)}>↑</button><button type="button" className="btn ghost" aria-label={`이미지 ${index + 1} 뒤 순서로`} disabled={position === draft.assets[role].length - 1} onClick={() => move(role, position, 1)}>↓</button></div></div>}
          </div>;
        })}
      </div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 20 }}><span style={{ fontSize: 12, color: '#64748b' }}>{dirty ? '저장하지 않은 변경' : content.revision ? `저장 버전 ${content.revision}` : '아직 저장한 내용 없음'}</span><button type="button" className="btn primary" disabled={busy || !dirty || conflict} onClick={() => void save()}>{busy ? '저장 중…' : `${section} 저장`}</button></div>
    </fieldset>}
  </div>;
}
