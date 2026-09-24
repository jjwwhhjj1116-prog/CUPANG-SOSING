'use client';

import { useEffect, useRef, useState } from 'react';
import { documentImagePlan, MAX_DOCUMENT_HEIGHT, MAX_SIZE_ROWS, type DocumentImageSection } from '@/app/document-image';
import { renderDocument } from '@/app/document-image-render';
import type { ProductContent } from '@/app/product-content';
import type { ProductOptions } from '@/app/product-options';

type Props = { productId: string; version: string; section: DocumentImageSection; onSaved?: () => void };
type Preview = { blob: Blob; url: string; productVersion: string; contentRevision: number; optionRevision: number; width: number; height: number };
async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store' }); const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || '저장한 자료를 불러오지 못했습니다.');
  return body;
}

export function DocumentImagePanel(props: Props) { return <Panel key={`${props.productId}-${props.section}`} {...props} />; }
function Panel({ productId, version, section, onSaved }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [attachedVersion, setAttachedVersion] = useState<string | null>(null);
  const uploadedKey = useRef<string | null>(null); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const name = section === 'label' ? '표시사항' : '사이즈표';
  // A freshly fetched preview can be newer than the dashboard prop. Only a
  // later dashboard version invalidates it; the server still checks exact CAS.
  const stale = Boolean(preview && Date.parse(version) > Date.parse(attachedVersion ?? preview.productVersion));
  async function generate() {
    setBusy(true); setError(''); setMessage('');
    try {
      const path = `/api/products/${encodeURIComponent(productId)}`;
      const [product, contents, optionState] = await Promise.all([get<{ product: { updated_at: string } }>(path), get<{ content: ProductContent }>(`${path}/content`), get<{ options: ProductOptions; productVersion: string }>(`${path}/options`)]);
      // Parallel requests can straddle an option save. Never pair an old option
      // response with a newer product version and later treat its PNG as current.
      if (section === 'size' && optionState.productVersion !== product.product.updated_at) throw new Error('자료를 불러오는 동안 상품 또는 옵션이 변경되었습니다. 최신 저장값으로 미리보기를 다시 만들어주세요.');
      const rendered = await renderDocument(documentImagePlan(section, contents.content, optionState.options));
      if (!alive.current) return;
      uploadedKey.current = null; setAttachedVersion(null);
      setPreview({ ...rendered, url: URL.createObjectURL(rendered.blob), productVersion: product.product.updated_at, contentRevision: contents.content.revision, optionRevision: optionState.options.revision });
      setMessage('저장한 값으로 PNG를 만들었습니다. 미리보기를 확인한 후 다운로드하거나 상품에 첨부하세요.');
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '이미지를 만들지 못했습니다.'); }
    finally { if (alive.current) setBusy(false); }
  }
  async function attach() {
    if (!preview || stale) return;
    setBusy(true); setError(''); setMessage('');
    try {
      if (!uploadedKey.current) {
        const form = new FormData(); form.set('file', new File([preview.blob], `sourceflow-${section}.png`, { type: 'image/png' }));
        const response = await fetch('/api/files', { method: 'POST', body: form }); const body = await response.json() as { key?: string; error?: string };
        if (!response.ok || !body.key) throw new Error(body.error || 'PNG를 업로드하지 못했습니다.'); uploadedKey.current = body.key;
      }
      const response = await fetch(`/api/products/${encodeURIComponent(productId)}/attachments`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: uploadedKey.current, expectedVersion: preview.productVersion, expectedContentRevision: preview.contentRevision, role: section,
          ...(section === 'size' ? { expectedOptionRevision: preview.optionRevision } : {}) }) });
      const body = await response.json() as { productVersion?: string; error?: string };
      if (!response.ok || !body.productVersion) throw new Error(body.error || '파일은 업로드되었지만 상품 자료에 연결하지 못했습니다.');
      if (!alive.current) return;
      setAttachedVersion(body.productVersion); setMessage(`${name} PNG를 상품 자료에 추가했습니다. 기존 파일과 이미지 역할은 보존했습니다.`); onSaved?.();
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'PNG 첨부를 저장하지 못했습니다.'); }
    finally { if (alive.current) setBusy(false); }
  }
  return <section className="panel-stack" style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid #dfe4ec' }} aria-label={`${name} 문서 이미지`} aria-busy={busy}>
    <div><strong>{name} PNG 만들기</strong><p style={{ color: '#64748b', marginTop: 8 }}>저장한 {section === 'label' ? '표시사항을' : '옵션 치수·무게를'} 이미지로 조판합니다. AI 호출 없이 브라우저에서 만들며 미입력 값은 추정하지 않습니다.{section === 'size' ? ` 한 장 최대 ${MAX_SIZE_ROWS}개 포함 옵션.` : ''} 높이 최대 {MAX_DOCUMENT_HEIGHT.toLocaleString('ko-KR')}px.</p></div>
    <button type="button" className="btn ghost" disabled={busy} onClick={() => void generate()}>{busy ? '처리 중…' : '저장한 값으로 PNG 미리보기'}</button>
    {error && <p role="alert" style={{ color: '#a34410' }}>{error}</p>}
    {message && <p role="status">{message}</p>}
    {stale && <p role="status" style={{ color: '#a34410' }}>상품 자료가 변경되었습니다. 최신 저장값으로 미리보기를 다시 만들어주세요.</p>}
    {preview && <>
      <div style={{ maxHeight: 500, overflow: 'auto', border: '1px solid #dfe4ec', borderRadius: 10 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview.url} alt={`저장값으로 만든 ${name} PNG 미리보기`} width={preview.width} height={preview.height} style={{ display: 'block', width: '100%', height: 'auto' }} />
      </div>
      <small style={{ color: '#64748b' }}>{preview.width} × {preview.height}px · {(preview.blob.size / 1024).toFixed(1)}KB · 검토용</small>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}><a className="btn ghost" href={preview.url} download={`sourceflow-${section}.png`}>PNG 다운로드</a><button type="button" className="btn primary" disabled={busy || stale || Boolean(attachedVersion)} onClick={() => void attach()}>{attachedVersion ? '상품 첨부 완료' : 'PNG 업로드·상품 자료에 추가'}</button></div>
    </>}
  </section>;
}
