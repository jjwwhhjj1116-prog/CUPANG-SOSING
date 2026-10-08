'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { productLabelChanges, productLabelDraftIssues, productLabelFields, productLabelPlan, productLabelValue, verifyProductLabelsView, verifyProductLabelRefresh, verifyProductLabelSave, type ProductLabelDraft, type ProductLabelKey, type ProductLabelsView } from '@/app/product-label';
import { renderDocument } from '@/app/document-image-render';
import { attachProductLabel } from '@/app/product-label-attachment';
import { productLabelPreviewSignature, type ProductLabelUploadCache } from '@/app/product-label-upload';
import { readProductLabelReferences, saveProductLabelReferences, verifyProductLabelReferenceRefresh, verifyProductLabelReferenceSave, ProductLabelReferenceSaveError, type ProductLabelReferences, type ProductLabelReferenceScope } from '@/app/product-label-references';

type Props = { productId: string; optionId: string | null; version: string; profileId?: string; refreshToken?: string; onSaved?: () => void };
type Preview = { scope: string; sourceKey: string; signature: string; view: ProductLabelsView; url: string; rendered: { blob: Blob; width: number; height: number } };
const unchanged = (before: ProductLabelsView, after: ProductLabelsView) => before.productId === after.productId && before.revision === after.revision && before.inputFingerprint === after.inputFingerprint && before.productVersion === after.productVersion;

export function ProductLabelEditor({ productId, optionId, version, profileId, refreshToken, onSaved }: Props) {
  const query = profileId ? `?profileId=${encodeURIComponent(profileId)}` : '';
  const endpoint = `/api/products/${encodeURIComponent(productId)}/product-labels${query}`, quotationEndpoint = `/api/products/${encodeURIComponent(productId)}/quotation-fields${query}`;
  const scope = JSON.stringify([endpoint, optionId]), sourceKey = JSON.stringify([scope, version, refreshToken]);
  const currentScope = useRef(scope), currentSource = useRef(sourceKey), mounted = useRef(true), request = useRef<AbortController | null>(null);
  const [saved, setSaved] = useState<{ scope: string; sourceKey: string; view: ProductLabelsView } | null>(null), latestSaved = useRef<typeof saved>(null);
  const [pending, setPending] = useState<{ scope: string; values: ProductLabelDraft }>({ scope, values: {} }), latestDraft = useRef({ scope, values: {} as ProductLabelDraft });
  const [preview, setPreview] = useState<Preview | null>(null), latestPreview = useRef<Preview | null>(null);
  const uploads = useRef(new Map<string, ProductLabelUploadCache>());
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [referencesBusy,setReferencesBusy]=useState(false),referenceBusy=useRef(false);
  const [notice, setNotice] = useState<{ scope: string; text: string; identity: string | null }>({ scope, text: '', identity: null });
  const current = () => mounted.current && currentScope.current === scope && currentSource.current === sourceKey;
  useLayoutEffect(() => {
    mounted.current = true; currentScope.current = scope; currentSource.current = sourceKey;
    if (latestDraft.current.scope !== scope) latestDraft.current = { scope, values: {} };
    return () => { mounted.current = false; request.current?.abort(); request.current = null; };
  }, [scope, sourceKey]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const view = saved?.scope === scope ? saved.view : null, draft = pending.scope === scope ? pending.values : {};
  const dirty = Object.keys(draft).length > 0, fresh = saved?.sourceKey === sourceKey;
  const reviewed = preview?.scope === scope && preview.sourceKey === sourceKey && !dirty && fresh ? preview : null;
  const row = view?.rows.find(row => row.optionId === optionId), caption = optionId === null ? '상품 공통' : '선택 옵션';
  const message = notice.scope === scope ? notice.text : '';
  function setMessage(text: string, verified?: ProductLabelsView) { setNotice({ scope, text, identity: verified ? JSON.stringify([verified.productVersion, verified.inputFingerprint]) : null }); }
  function clearPreview() { latestPreview.current = null; setPreview(null); }
  function store(body: ProductLabelsView) { latestSaved.current = { scope, sourceKey, view: body }; setSaved(latestSaved.current); }
  function clearDraft() { latestDraft.current = { scope, values: {} }; setPending(latestDraft.current); }
  function verify(body: ProductLabelsView) { verifyProductLabelsView(body, optionId, profileId); if (body.productId !== productId) throw Error('표시사항을 편집할 상품을 다시 확인해주세요.'); }
  function finish(controller: AbortController) { if (request.current === controller) { request.current = null; if (!controller.signal.aborted && current()) setBusy(false); } }
  async function read(signal: AbortSignal) {
    const response = await fetch(endpoint, { cache: 'no-store', signal }), body = await response.json() as ProductLabelsView & { error?: string };
    if (!response.ok) throw Error(body.error || '제품 표시사항을 불러오지 못했습니다.'); verify(body); return body;
  }
  async function load(keepDraft = false, explicitLatest = false, preserveCompletion = false) {
    if (request.current || !current()) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); clearPreview();
    try {
      const body = await read(controller.signal); if (controller.signal.aborted || !current()) return;
      const editing = latestDraft.current.scope === scope ? latestDraft.current.values : {}, before = latestSaved.current?.scope === scope ? latestSaved.current.view : null;
      let recovered = false;
      if (keepDraft || explicitLatest) {
        if (!before) throw Error('이전 제품 표시사항 입력 기준을 확인하지 못했습니다.'); verifyProductLabelRefresh(before, body, optionId, keepDraft ? editing : {});
        if (keepDraft && Object.keys(editing).length) { try { verifyProductLabelSave(before, body, optionId, editing); recovered = true; } catch { /* An unrelated source update can be reviewed while retaining the draft. */ } }
      } else if (body.productVersion !== version) throw Error('상품 저장 상태가 변경됐습니다. 상품을 다시 열어 최신 표시사항을 확인해주세요.');
      store(body); if (!keepDraft || recovered) clearDraft();
      if (recovered) setMessage('저장된 제품 표시사항을 확인했습니다.', body);
      else if (keepDraft) setMessage('입력을 유지하고 최신 표시사항을 읽었습니다. 확인 후 저장해주세요.');
      else if (!preserveCompletion || notice.scope !== scope || notice.identity !== JSON.stringify([body.productVersion, body.inputFingerprint])) setMessage('');
      if (recovered) onSaved?.();
    } catch (cause) { if (!controller.signal.aborted && current()) setError(cause instanceof Error ? cause.message : '제품 표시사항 조회 실패'); }
    finally { finish(controller); }
  }
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (!active || !current()) return; setBusy(false); setError(''); clearPreview(); if (latestDraft.current.scope === scope && Object.keys(latestDraft.current.values).length && latestSaved.current?.scope === scope) return; void load(false, false, true); });
    return () => { active = false; request.current?.abort(); request.current = null; };
    // This editor stays mounted across stages. Source commits invalidate PNG
    // previews but never discard local edits or start an automatic write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, sourceKey]);
  function edit(key: ProductLabelKey, value: string | null) {
    if (!view || request.current || referenceBusy.current || !current()) return;
    latestDraft.current = { scope, values: { ...(latestDraft.current.scope === scope ? latestDraft.current.values : {}), [key]: value } };
    setPending(latestDraft.current); clearPreview(); setMessage('');
  }
  function restoreAll() {
    if (!view || request.current || referenceBusy.current || !current()) return;
    latestDraft.current = { scope, values: Object.fromEntries(productLabelFields.map(field => [field.key, null])) as ProductLabelDraft };
    setPending(latestDraft.current); clearPreview(); setMessage('복원할 값을 확인한 뒤 정보 저장하기를 눌러주세요.');
  }
  const issues = view ? productLabelDraftIssues(view, optionId, draft) : [];
  async function save() {
    const base = latestSaved.current, editing = latestDraft.current.scope === scope ? latestDraft.current.values : {};
    if (!base || base.scope !== scope || !Object.keys(editing).length || request.current || referenceBusy.current || !current()) return;
    if (base.sourceKey !== sourceKey) { setError('상품 저장 상태가 변경됐습니다. 입력을 유지하고 최신 표시사항을 조회한 뒤 저장해주세요.'); return; }
    let changes; try { changes = productLabelChanges(base.view, optionId, editing); } catch (cause) { setError(cause instanceof Error ? cause.message : '표시사항 입력을 확인해주세요.'); return; }
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); setMessage(''); clearPreview();
    try {
      const response = await fetch(endpoint, { method: 'PUT', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: base.view.revision, expectedInputFingerprint: base.view.inputFingerprint, changes }) }), body = await response.json() as ProductLabelsView & { error?: string };
      if (controller.signal.aborted || !current()) return;
      if (!response.ok) throw Error(body.error || '표시사항을 저장하지 못했습니다. 입력은 유지됩니다.'); verify(body); verifyProductLabelSave(base.view, body, optionId, editing);
      store(body); clearDraft(); setMessage(`${caption} 제품 표시사항 저장 완료. 수정한 내용을 견적서 이미지에 반영하려면 다시 생성한 뒤 PNG를 견적에 연결하세요.`, body); onSaved?.();
    } catch (cause) { if (!controller.signal.aborted && current()) setError(cause instanceof Error ? cause.message : '제품 표시사항 저장 실패'); }
    finally { finish(controller); }
  }
  async function generate() {
    const base = latestSaved.current;
    if (!base || base.scope !== scope || base.sourceKey !== sourceKey || request.current || referenceBusy.current || !current() || latestDraft.current.scope === scope && Object.keys(latestDraft.current.values).length) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); setMessage(''); clearPreview();
    try {
      const before = await read(controller.signal); if (controller.signal.aborted || !current()) return;
      if (!unchanged(base.view, before)) throw Error('저장된 표시사항이 바뀌었습니다. 최신 자료를 조회한 뒤 다시 만들어주세요.');
      const signature = productLabelPreviewSignature({ productId, endpoint, view: before, optionId });
      let cache = uploads.current.get(signature);
      if (!cache) { cache = { signature, uploadedKey: null, rendered: null }; uploads.current.set(signature, cache); while (uploads.current.size > 8) uploads.current.delete(uploads.current.keys().next().value!); }
      const rendered = cache.rendered ?? await renderDocument(productLabelPlan(before, optionId));
      if (controller.signal.aborted || !current()) return;
      const after = await read(controller.signal); if (controller.signal.aborted || !current()) return;
      if (!unchanged(before, after) || productLabelPreviewSignature({ productId, endpoint, view: after, optionId }) !== signature) throw Error('이미지를 만드는 동안 표시사항이 바뀌었습니다. 최신 저장값으로 다시 만들어주세요.');
      cache.rendered = rendered; const next = { scope, sourceKey, signature, view: after, rendered, url: URL.createObjectURL(rendered.blob) };
      latestPreview.current = next; setPreview(next); setMessage('저장된 9항목으로 제품 표시사항 이미지를 만들었습니다.');
    } catch (cause) { if (!controller.signal.aborted && current()) setError(cause instanceof Error ? cause.message : '제품 표시사항 이미지 생성 실패'); }
    finally { finish(controller); }
  }
  async function attach() {
    const chosen = latestPreview.current;
    if (!chosen || chosen.scope !== scope || chosen.sourceKey !== sourceKey || request.current || referenceBusy.current || !current() || latestDraft.current.scope === scope && Object.keys(latestDraft.current.values).length) return;
    const cache = uploads.current.get(chosen.signature); if (!cache) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); setMessage('');
    try {
      const scopedFetch: typeof fetch = async (url, init) => { if (controller.signal.aborted || !current()) throw Error('상품 또는 옵션 저장 상태가 변경되었습니다.'); const response = await fetch(url, { ...init, signal: controller.signal }); if (controller.signal.aborted || !current()) throw Error('상품 또는 옵션 저장 상태가 변경되었습니다.'); return response; };
      const result = await attachProductLabel({ productId, endpoint, quotationEndpoint, renderedView: chosen.view, optionId, blob: chosen.rendered.blob, uploadedKey: cache.uploadedKey, onUploaded: key => { cache.uploadedKey = key; } }, scopedFetch);
      if (controller.signal.aborted || !current()) return;
      verify(result.view);
      if (productLabelPreviewSignature({ productId, endpoint, view: result.view, optionId }) !== chosen.signature || !result.key || !result.view.imageKeys.includes(result.key)) throw Error('연결한 PNG와 현재 제품 표시사항 저장값을 확인하지 못했습니다.');
      store(result.view); clearPreview(); setMessage(`${caption} 표시사항 PNG를 견적서에 연결했습니다. 기존 라벨은 유지했습니다.`, result.view); onSaved?.();
    } catch (cause) { if (!controller.signal.aborted && current()) setError(`${cause instanceof Error ? cause.message : '제품 표시사항 PNG 연결 실패'}${cache.uploadedKey ? ' 업로드한 파일은 보존됩니다. 같은 저장값으로 다시 연결하면 기존 파일을 확인해 사용합니다.' : ''}`); }
    finally { finish(controller); }
  }
  return <section className="panel-stack product-label-editor" aria-label={`${caption} 제품 표시사항`} data-quotation-source-step="표시사항" data-source-step="표시사항" data-workspace-dirty={dirty} data-workspace-saving={busy||referencesBusy}>
    <h3>제품 한글 표시사항</h3><p>{row?.optionLabel || (optionId === null ? '상품 공통' : optionId)}{optionId !== null && row?.included === false ? ' · 견적 제외 옵션' : ''}</p>
    <p>{optionId === null ? '공통 9항목은 개별 표시사항을 수정하지 않은 옵션에 적용합니다. 각 옵션의 직접 수정값은 유지됩니다.' : '이 옵션의 제품 표시사항 9항목을 편집합니다. 다른 옵션과 상품 공통 표시사항은 유지됩니다.'} 카테고리별 상품고시는 7단계 견적서에서 따로 확인합니다.</p>
    {busy && <p role="status">제품 표시사항 처리 중…</p>}{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {dirty && !fresh && <p role="status">상품 저장 상태가 변경됐습니다. 입력은 유지했습니다. 최신 자료를 조회한 뒤 저장해주세요.</p>}
    {view && <div className="product-label-rows">{productLabelFields.map(field => <label className="product-label-row field" key={field.key}><span>{field.label}</span><textarea aria-label={`${caption} ${field.label}`} value={productLabelValue(view, optionId, field.key, draft)} disabled={busy||referencesBusy} onChange={event => edit(field.key, event.target.value)} />
      <button type="button" className="btn ghost" disabled={busy||referencesBusy} onClick={() => edit(field.key, '')}>{field.label} 비우기</button><button type="button" className="btn ghost" disabled={busy||referencesBusy} onClick={() => edit(field.key, null)}>{field.label} {optionId === null ? '자동값' : '공통·자동값'} 복원</button>
    </label>)}</div>}
    <small>공란도 직접 수정값으로 저장합니다. 내용량·재질·상품 유형·사용 기준은 확인한 값만 입력하세요.</small>
    <small>수정한 내용을 견적서 이미지에 반영하려면 다시 생성한 뒤 PNG를 견적에 연결하세요.</small>
    {!!issues.length && <p role="alert">{[...new Set(issues)].join(' ')}</p>}
    <div className="quote-actions"><button type="button" className="btn primary" disabled={!view || busy || referencesBusy || !dirty || !!issues.length} onClick={() => void save()}>정보 저장하기</button><button type="button" className="btn ghost" disabled={!view || busy || referencesBusy} onClick={restoreAll}>전체 {optionId === null ? '자동값' : '공통·자동값'} 복원</button>
      <button type="button" className="btn blue" disabled={!view || busy || referencesBusy || dirty || !fresh || optionId !== null && row?.included !== true} onClick={() => void generate()}>한글 표시사항 생성 시작</button></div>
    {dirty && <button type="button" className="btn ghost" disabled={busy} onClick={() => void load(true)}>입력 유지·최신 표시사항 조회</button>}
    <button type="button" className="btn ghost" disabled={busy} onClick={() => void load(false, true)}>{dirty ? '입력 취소·저장 표시사항 다시 조회' : '저장 표시사항 다시 조회'}</button>
    {reviewed && <><div className="product-label-preview" style={{ maxHeight: 600, overflow: 'auto' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={reviewed.url} alt={`${caption} 저장된 9항목 제품 표시사항 PNG`} width={reviewed.rendered.width} height={reviewed.rendered.height} style={{ width: '100%', height: 'auto' }} /></div>
      <div className="quote-actions"><a className="btn ghost" href={reviewed.url} download="yoofam-product-label.png">표시사항 PNG 다운로드</a><button type="button" className="btn ghost" disabled={busy||referencesBusy} onClick={() => void generate()}>저장한 값으로 다시 생성</button><button type="button" className="btn primary" disabled={busy||referencesBusy} onClick={() => void attach()}>PNG 업로드·견적에 연결</button></div>
    </>}
    <ProductLabelReferenceEditor productId={productId} optionId={optionId} version={version} profileId={profileId} refreshToken={refreshToken} disabled={busy||dirty}
      beforeSave={()=>current()&&!request.current&&!(latestDraft.current.scope===scope&&Object.keys(latestDraft.current.values).length)}
      onBusyChange={value=>{referenceBusy.current=value;setReferencesBusy(value);}} onSaved={()=>{clearPreview();onSaved?.();}}/>
  </section>;
}

type ReferenceProps=Props & {disabled?:boolean;beforeSave?:()=>boolean;onBusyChange?:(busy:boolean)=>void};
export function ProductLabelReferenceEditor({productId,optionId,version,profileId,refreshToken,disabled=false,beforeSave,onBusyChange,onSaved}:ReferenceProps){
  const query=profileId?`?profileId=${encodeURIComponent(profileId)}`:'',input:ProductLabelReferenceScope={productId,optionId,endpoint:`/api/products/${encodeURIComponent(productId)}/product-labels${query}`,quotationEndpoint:`/api/products/${encodeURIComponent(productId)}/quotation-fields${query}`};
  const scope=JSON.stringify([productId,optionId,profileId??'']),sourceKey=JSON.stringify([scope,version,refreshToken]),liveScope=useRef(scope),liveSource=useRef(sourceKey),mounted=useRef(true),request=useRef<AbortController|null>(null);
  const [saved,setSaved]=useState<{scope:string;sourceKey:string;value:ProductLabelReferences}|null>(null),liveSaved=useRef<typeof saved>(null);
  const [pending,setPending]=useState<{scope:string;keys:string[]|null}>({scope,keys:null}),liveDraft=useRef(pending);
  const [replacement,setReplacement]=useState(''),liveReplacement=useRef(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[uncertain,setUncertain]=useState(false);
  const busyCallback=useRef(onBusyChange),current=()=>mounted.current&&liveScope.current===scope&&liveSource.current===sourceKey;
  useLayoutEffect(()=>{busyCallback.current=onBusyChange;});
  useLayoutEffect(()=>{mounted.current=true;liveScope.current=scope;liveSource.current=sourceKey;if(liveDraft.current.scope!==scope)liveDraft.current={scope,keys:null};return()=>{mounted.current=false;request.current?.abort();request.current=null;busyCallback.current?.(false);};},[scope,sourceKey]);
  const base=saved?.scope===scope?saved:null,editing=pending.scope===scope?pending.keys:null,dirty=editing!==null,selected=editing??base?.value.keys??[],fresh=base?.sourceKey===sourceKey,locked=disabled||busy;
  function store(value:ProductLabelReferences){liveSaved.current={scope,sourceKey,value};setSaved(liveSaved.current);}
  function draft(keys:string[]|null){liveDraft.current={scope,keys};setPending(liveDraft.current);setNotice('');}
  function begin(){if(request.current||!current())return null;const controller=new AbortController();request.current=controller;setBusy(true);busyCallback.current?.(true);setError('');setNotice('');return controller;}
  function finish(controller:AbortController){if(request.current===controller){request.current=null;busyCallback.current?.(false);if(current()&&!controller.signal.aborted)setBusy(false);}}
  function scopedFetch(controller:AbortController):typeof fetch{return async(url,init)=>{if(controller.signal.aborted||!current())throw Error('라벨 편집 대상이 변경되었습니다.');const response=await fetch(url,{...init,signal:controller.signal});if(controller.signal.aborted||!current())throw Error('라벨 편집 대상이 변경되었습니다.');return response;};}
  async function load(keep=false){const controller=begin();if(!controller)return;try{
    const value=await readProductLabelReferences(input,scopedFetch(controller));if(!current()||controller.signal.aborted)return;
    const previous=liveSaved.current?.scope===scope?liveSaved.current.value:null,choices=liveDraft.current.scope===scope?liveDraft.current.keys:null;let recovered=false;
    if(keep&&previous&&choices!==null){try{verifyProductLabelReferenceSave(input,previous,value,choices);recovered=true;}catch{if(uncertain)throw Error('이전 저장 결과를 확인하지 못했습니다. 연결 선택을 유지했습니다.');verifyProductLabelReferenceRefresh(input,previous,value);}}
    else if(!keep&&value.view.productVersion!==version)throw Error('상품 저장 상태가 변경되었습니다. 최신 상품을 다시 확인해주세요.');
    store(value);if(!keep||recovered){draft(null);setUncertain(false);}if(recovered){setNotice('저장된 최종 라벨 연결을 확인했습니다.');onSaved?.();}
  }catch(cause){if(current()&&!controller.signal.aborted)setError(cause instanceof Error?cause.message:'최종 라벨 조회 실패');}finally{finish(controller);}}
  useEffect(()=>{let active=true;void Promise.resolve().then(()=>{if(!active||!current())return;setBusy(false);setError('');if(liveDraft.current.scope===scope&&liveDraft.current.keys!==null)return;void load();});return()=>{active=false;request.current?.abort();request.current=null;};
    // Keep unsaved reference choices across source updates and hidden stages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[scope,sourceKey]);
  function edit(keys:string[]){if(locked||request.current||!current()||uncertain||!base)return;draft([...new Set(keys)]);}
  const latestKeys=()=>liveDraft.current.scope===scope&&liveDraft.current.keys!==null?liveDraft.current.keys:liveSaved.current?.scope===scope?liveSaved.current.value.keys:[];
  async function save(){const previous=liveSaved.current,choices=liveDraft.current.scope===scope?liveDraft.current.keys:null;if(locked||!previous||previous.scope!==scope||choices===null||!current()||request.current)return;
    if(beforeSave&&!beforeSave()){setError('9항목 수정 내용을 먼저 저장한 뒤 최종 라벨 연결을 저장해주세요.');return;}if(previous.sourceKey!==sourceKey&&!uncertain){setError('연결 선택은 유지했습니다. 최신 라벨을 조회한 뒤 저장해주세요.');return;}
    const controller=begin();if(!controller)return;try{const value=await saveProductLabelReferences(input,previous.value,choices,scopedFetch(controller));if(!current()||controller.signal.aborted)return;store(value);draft(null);setUncertain(false);setNotice('최종 라벨 연결을 저장했습니다. 제외한 파일과 생성 기록은 보관됩니다.');onSaved?.();}
    catch(cause){if(current()&&!controller.signal.aborted){setUncertain(cause instanceof ProductLabelReferenceSaveError&&cause.uncertain);setError(cause instanceof Error?cause.message:'최종 라벨 저장 실패');}}finally{finish(controller);}}
  const caption=optionId===null?'상품 공통':'선택 옵션',pool=base?.value.view.imageKeys??[],url=(key:string)=>`/api/files/${key.split('/').map(encodeURIComponent).join('/')}`;
  return <section className="panel-stack" aria-label={`${caption} 최종 라벨 연결`} data-quotation-source-step="표시사항" data-workspace-dirty={dirty} data-workspace-saving={busy}>
    <h4>견적서에 연결할 최종 라벨 · {selected.length}장</h4><p>아래 선택은 {caption}의 최종 견적 참조만 바꿉니다. 원본 파일·생성 기록과 다른 옵션의 직접 수정값은 유지됩니다.</p>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{dirty&&!fresh&&<p role="status">저장 상태가 변경되었습니다. 라벨 선택은 유지했습니다.</p>}
    {/* eslint-disable-next-line @next/next/no-img-element -- Private reference thumbnails require the authenticated same-origin file route. */}
    <div className="image-selected-strip">{selected.map((key,index)=><figure key={key}>{pool.includes(key)?<><img src={url(key)} alt={`최종 라벨 ${index+1}`} width={120} height={120}/><figcaption>{index+1} · {key.split('/').at(-1)}</figcaption></>:<p>현재 상품에 없는 라벨 참조 · {key.split('/').at(-1)}</p>}<button type="button" className="btn ghost" aria-label={`최종 라벨 ${index+1} 견적에서 제외`} disabled={locked||uncertain} onClick={()=>edit(latestKeys().filter(value=>value!==key))}>견적에서 제외</button></figure>)}</div>
    {base&&!selected.length&&<p>이 범위의 최종 라벨은 공란입니다. 공통 라벨을 자동으로 다시 선택하지 않습니다.</p>}
    {base&&<><label className="field"><span>전체 교체할 저장 이미지</span><select aria-label="최종 라벨 전체 교체 이미지" value={replacement} disabled={locked||uncertain} onChange={event=>{if(!current()||locked||request.current||uncertain)return;liveReplacement.current=event.target.value;setReplacement(event.target.value);}}><option value="">파일 선택</option>{pool.map((key,index)=><option key={key} value={key}>이미지 {index+1} · {key.split('/').at(-1)}</option>)}</select></label>
      <button type="button" className="btn ghost" disabled={locked||uncertain||!pool.includes(replacement)} onClick={()=>{if(pool.includes(liveReplacement.current))edit([liveReplacement.current]);}}>선택 파일로 최종 라벨 전체 교체</button><button type="button" className="btn ghost" disabled={locked||uncertain} onClick={()=>edit([])}>최종 라벨 전체 비우기</button></>}
    <button type="button" className="btn primary" disabled={locked||!dirty||!base} onClick={()=>void save()}>{uncertain?'라벨 연결 저장 결과 확인·재시도':'최종 라벨 연결 저장'}</button>
    {dirty&&<button type="button" className="btn ghost" disabled={busy} onClick={()=>void load(true)}>선택 유지·최신 라벨 조회</button>}
    <button type="button" className="btn ghost" disabled={busy} onClick={()=>{if(!current()||request.current)return;draft(null);setUncertain(false);void load();}}>{dirty?'선택 취소·저장 라벨 조회':'최종 라벨 저장본 조회'}</button>
  </section>;
}
