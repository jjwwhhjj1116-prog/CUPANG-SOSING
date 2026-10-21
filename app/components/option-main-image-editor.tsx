'use client';
/* eslint-disable @next/next/no-img-element -- Final-image previews use the authenticated private file route. */
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {mainImageValue,readMainImageView,saveMainImageView,verifyMainImageRefresh,verifyMainImageSave,verifyMainImageView,MainImageSaveError} from '@/app/quotation-main-image';
import type {QuotationFieldsView} from '@/app/quotation-schema';
import type {FreeImageQuotationRequest} from '@/app/free-image-translation-client';
import {readMainImageLibrary,mainImageLibraryCurrent,mainImageLibraryKeys,type MainImageLibrary,type MainImageLibraryTab} from '@/app/main-image-library';
import {ImageFullscreenPreview} from '@/app/components/image-fullscreen-preview';
type Props={productId:string;version?:string;profileId?:string;refreshToken?:string;focusedOptionId?:string;onSaved?:()=>void;translationEnabled?:boolean;disabled?:boolean;saveOnSelect?:boolean;processingConfigured?:boolean|null;
 onTranslate?:(sourceKey:string,role:'main',sourceLanguage:'zh'|'en',quotationTarget:FreeImageQuotationRequest)=>void;
 onEdit?:(sourceKey:string,role:'main',quotationTarget:FreeImageQuotationRequest)=>void;
 onProcess?:(sourceKey:string,role:'main',quotationTarget:FreeImageQuotationRequest,quotationView?:QuotationFieldsView)=>void};
export function OptionMainImageEditor({productId,version,profileId,refreshToken,focusedOptionId,onSaved,translationEnabled=true,disabled=false,saveOnSelect=false,processingConfigured=null,onTranslate,onEdit,onProcess}:Props){
 const endpoint=`/api/products/${encodeURIComponent(productId)}/quotation-fields${profileId?`?profileId=${encodeURIComponent(profileId)}`:''}`,scope=JSON.stringify([endpoint,focusedOptionId??'']),sourceKey=JSON.stringify([scope,version,refreshToken]);
 const liveScope=useRef(scope),liveSource=useRef(sourceKey),mounted=useRef(true),request=useRef<AbortController|null>(null);
 const [saved,setSaved]=useState<{scope:string;sourceKey:string;view:QuotationFieldsView}|null>(null),liveSaved=useRef<typeof saved>(null),[selection,setSelection]=useState<{scope:string;id:string}>({scope,id:focusedOptionId??''});
 const [pending,setPending]=useState<{scope:string;optionId:string;value:string|null|undefined}>({scope,optionId:'',value:undefined}),liveDraft=useRef(pending);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[uncertain,setUncertain]=useState(false),liveUncertain=useRef(false);
 const [library,setLibrary]=useState<{scope:string;sourceKey:string;value:MainImageLibrary|null;error:string}|null>(null);
 const libraryRequest=useRef<AbortController|null>(null);
 const current=()=>mounted.current&&liveScope.current===scope&&liveSource.current===sourceKey;
 useLayoutEffect(()=>{mounted.current=true;liveScope.current=scope;liveSource.current=sourceKey;if(liveDraft.current.scope!==scope)liveDraft.current={scope,optionId:'',value:undefined};return()=>{mounted.current=false;request.current?.abort();request.current=null;libraryRequest.current?.abort();libraryRequest.current=null;};},[scope,sourceKey]);
 const base=saved?.scope===scope?saved:null,rows=base?.view.resolved.rows.filter(row=>row.optionId!==null)??[],chosen=selection.scope===scope?selection.id:'',id=focusedOptionId!==undefined?focusedOptionId:chosen||(rows.find(row=>row.included)?.optionId??rows[0]?.optionId??'');
 const tabScope=JSON.stringify([scope,id]);
 const [libraryTab,setLibraryTab]=useState(()=>({scope:tabScope,tab:'main' as MainImageLibraryTab,token:{}}));
 if(libraryTab.scope!==tabScope)setLibraryTab({scope:tabScope,tab:'main',token:{}});
 const tabGeneration=libraryTab.scope===tabScope?libraryTab.token:null,liveTabGeneration=useRef(tabGeneration);
 useLayoutEffect(()=>{liveTabGeneration.current=tabGeneration;},[tabGeneration]);
 const liveOption=useRef(id),liveTranslationEnabled=useRef(translationEnabled),liveDisabled=useRef(disabled),liveSaveOnSelect=useRef(saveOnSelect),liveProcessingConfigured=useRef(processingConfigured);
 useLayoutEffect(()=>{liveOption.current=id;liveTranslationEnabled.current=translationEnabled;liveDisabled.current=disabled;liveSaveOnSelect.current=saveOnSelect;liveProcessingConfigured.current=processingConfigured;},[id,translationEnabled,disabled,saveOnSelect,processingConfigured]);
 const currentOption=()=>current()&&liveOption.current===id;
 const dirty=pending.scope===scope&&pending.value!==undefined,editing=dirty&&pending.optionId===id?pending.value:undefined,fresh=base?.sourceKey===sourceKey;
 let selected:string[]=[];try{if(base&&id)selected=mainImageValue(base.view,id,editing).split('\n').map(key=>key.trim()).filter(Boolean);}catch{/* The read/save helpers preserve and report invalid binding. */}
 function store(view:QuotationFieldsView){liveSaved.current={scope,sourceKey,view};setSaved(liveSaved.current);}
 function markUncertain(value:boolean){liveUncertain.current=value;setUncertain(value);}
 function clear(){liveDraft.current={scope,optionId:'',value:undefined};setPending(liveDraft.current);markUncertain(false);}
 function begin(){if(!currentOption()||liveDisabled.current||request.current)return null;const c=new AbortController();request.current=c;setBusy(true);setError('');setMessage('');return c;}
 function finish(c:AbortController){if(request.current===c){request.current=null;if(current()&&!c.signal.aborted)setBusy(false);}}
 function scoped(c:AbortController):typeof fetch{return async(url,init)=>{if(!current()||c.signal.aborted)throw Error('대표이미지 편집 대상이 변경되었습니다.');const response=await fetch(url,{...init,signal:c.signal});if(!current()||c.signal.aborted)throw Error('대표이미지 편집 대상이 변경되었습니다.');return response;};}
 async function groupLibrary(view:QuotationFieldsView){
  libraryRequest.current?.abort();const c=new AbortController();libraryRequest.current=c;
  const valid=()=>current()&&libraryRequest.current===c&&!c.signal.aborted&&liveSaved.current?.view===view;
  try{const value=await readMainImageLibrary(productId,view,scoped(c));if(valid())setLibrary({scope,sourceKey,value,error:''});}
  catch{if(valid())setLibrary({scope,sourceKey,value:null,error:'이미지 종류를 확인하지 못했습니다. 전체 저장 이미지에서 선택할 수 있습니다.'});}
  finally{if(libraryRequest.current===c)libraryRequest.current=null;}
 }
 async function load(keep=false){const c=begin();if(!c)return;try{const view=await readMainImageView(endpoint,scoped(c));if(!current()||c.signal.aborted)return;const previous=liveSaved.current?.scope===scope?liveSaved.current.view:null,draft=liveDraft.current;let recovered=false;
   if(keep&&previous&&draft.scope===scope&&draft.value!==undefined){try{verifyMainImageSave(previous,view,draft.optionId,draft.value);recovered=true;}catch{if(uncertain)throw Error('이전 대표이미지 저장 결과를 확인하지 못했습니다. 선택은 유지했습니다.');verifyMainImageRefresh(previous,view,draft.optionId);}}
   else if(version&&view.productVersion!==version)throw Error('상품 저장 상태가 바뀌었습니다. 최신 상품으로 다시 확인해주세요.');
   store(view);if(!keep||recovered)clear();void groupLibrary(view);if(recovered){setMessage('저장된 최종 대표이미지를 확인했습니다.');onSaved?.();}
  }catch(cause){if(current()&&!c.signal.aborted)setError(cause instanceof Error?cause.message:'대표이미지 조회 실패');}finally{finish(c);}}
 useEffect(()=>{let active=true;void Promise.resolve().then(()=>{if(!active||!current())return;setBusy(false);if(liveDraft.current.scope===scope&&liveDraft.current.value!==undefined||disabled||liveSaved.current?.scope===scope&&liveSaved.current.sourceKey===sourceKey)return;void load();});return()=>{active=false;request.current?.abort();request.current=null;};
  // Keep the final-image draft mounted across price/source-image stage changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[scope,sourceKey,disabled]);
 function edit(value:string|null){
  if(!base||!id||!currentOption()||liveDisabled.current||liveSaveOnSelect.current!==saveOnSelect||liveSaved.current?.view!==base.view||request.current||busy||liveUncertain.current||saveOnSelect&&liveDraft.current.scope===scope&&liveDraft.current.value!==undefined)return;
  if(saveOnSelect&&liveDraft.current.value===undefined){try{const target=verifyMainImageView(base.view);if(target.linked.every(key=>value===null?!Object.hasOwn(base.view.overrides.options[id]??{},key):base.view.overrides.options[id]?.[key]===value))return;}catch{/* The save helper reports invalid bindings without writing. */}}
  liveDraft.current={scope,optionId:id,value};setPending(liveDraft.current);setMessage('');if(saveOnSelect)void save();
 }
 async function save(){const before=liveSaved.current,draft=liveDraft.current;if(!currentOption()||liveDisabled.current||liveSaveOnSelect.current!==saveOnSelect||busy||request.current||!before||before.scope!==scope||draft.scope!==scope||draft.optionId!==id||draft.value===undefined)return;
  if(before.sourceKey!==sourceKey&&!liveUncertain.current){setError('이미지 선택은 유지했습니다. 최신 자료를 조회한 뒤 저장해주세요.');return;}const c=begin();if(!c)return;
  const guarded:typeof fetch=async(url,init)=>{if(!currentOption()||liveDisabled.current||liveSaveOnSelect.current!==saveOnSelect)throw Error('대표이미지 편집 상태가 변경되었습니다. 선택은 유지했습니다.');return scoped(c)(url,init);};
  try{const view=await saveMainImageView(endpoint,before.view,draft.optionId,draft.value,guarded);if(!current()||c.signal.aborted)return;store(view);clear();void groupLibrary(view);setMessage('선택 옵션의 최종 견적 대표이미지를 저장했습니다.');onSaved?.();}
  catch(cause){if(current()&&!c.signal.aborted){markUncertain(cause instanceof MainImageSaveError&&cause.uncertain);setError(cause instanceof Error?cause.message:'대표이미지 저장 실패');}}finally{finish(c);}}
 const pool=base?.view.imageKeys??[],url=(key:string)=>`/api/files/${key.split('/').map(encodeURIComponent).join('/')}`,valid=!!id&&rows.some(row=>row.optionId===id);
 const previewScope=JSON.stringify([scope,sourceKey,id,selected,selected.map(key=>pool.includes(key)),translationEnabled,disabled,processingConfigured]);
 const [previewClock,setPreviewClock]=useState(()=>({scope:previewScope,token:{}}));
 if(previewClock.scope!==previewScope)setPreviewClock({scope:previewScope,token:{}});
 const previewGeneration=previewClock.scope===previewScope?previewClock.token:null,previewEpoch=useRef(previewGeneration);
 type Preview={generation:object;key:string};
 const [preview,setPreview]=useState<Preview|null>(null),livePreview=useRef<Preview|null>(null);
 useLayoutEffect(()=>{previewEpoch.current=previewGeneration;if(livePreview.current?.generation!==previewGeneration)livePreview.current=null;},[previewGeneration]);
 function openPreview(key:string){
  const before=liveSaved.current,draft=liveDraft.current;
  if(!previewGeneration||!before||!base||!valid||!fresh||!currentOption()||liveDisabled.current||previewEpoch.current!==previewGeneration||before.view!==base.view||!pool.includes(key))return;
  try{
   const actual=mainImageValue(before.view,id,draft.scope===scope&&draft.optionId===id?draft.value:undefined).split('\n').map(value=>value.trim()).filter(Boolean);
   if(JSON.stringify(actual)!==JSON.stringify(selected)||!actual.includes(key))return;
   const next={generation:previewGeneration,key};livePreview.current=next;setPreview(next);
  }catch{/* Invalid image bindings remain owned by the existing read/save guards. */}
 }
 function closePreview(target:Preview){if(previewEpoch.current!==previewGeneration||livePreview.current!==target)return;livePreview.current=null;setPreview(null);}
 const libraryState=library?.scope===scope&&library.sourceKey===sourceKey?library:null;
 const groups=base&&libraryState?.value&&mainImageLibraryCurrent(libraryState.value,productId,base.view)?libraryState.value:null;
 const tab=groups?(libraryTab.scope===tabScope?libraryTab.tab:'main'):'work';
 const visiblePool=base?mainImageLibraryKeys(tab,base.view,groups):[];
 const libraryTabs=[['work','작업 이미지'],['main','메인 이미지'],['options','옵션 이미지'],['detail','상세 이미지']] as const;
 function translateSelected(key:string,sourceLanguage:'zh'|'en',manual=false,process=false){
  const before=liveSaved.current,draft=liveDraft.current;
  if(!(process?onProcess:manual?onEdit:onTranslate)||process&&(processingConfigured!==true||liveProcessingConfigured.current!==true||!previewGeneration||previewEpoch.current!==previewGeneration)||!translationEnabled||!liveTranslationEnabled.current||liveDisabled.current||!current()||liveOption.current!==id||focusedOptionId&&focusedOptionId!==id
   ||request.current||busy||liveUncertain.current||!before||before.view!==base?.view||before.scope!==scope||before.sourceKey!==sourceKey
   ||version&&before.view.productVersion!==version||draft.scope===scope&&draft.value!==undefined||!before.view.imageKeys.includes(key))return;
  try{const target=verifyMainImageView(before.view),row=before.view.resolved.rows.find(row=>row.optionId===id),value=mainImageValue(before.view,id);
   if(value.split('\n').map(item=>item.trim()).filter(Boolean).length!==1||value.trim()!==key||target.linked.some(field=>row?.fields[field]?.value!==value))return;
   const quotationTarget:FreeImageQuotationRequest={kind:'quotation',profileId:profileId??null,optionId:id,input:'mainImage',fieldKey:target.primary,slotIndex:0,
    revision:before.view.revision,inputFingerprint:before.view.inputFingerprint,optionRevision:before.view.optionRevision,value};
   if(process)onProcess?.(key,'main',quotationTarget,before.view);else if(manual)onEdit?.(key,'main',quotationTarget);else onTranslate?.(key,'main',sourceLanguage,quotationTarget);
  }catch(cause){setError(cause instanceof Error?cause.message:'번역할 최종 대표이미지 연결을 확인해주세요.');}
 }
 function candidate(key:string){const index=pool.indexOf(key);return <button type="button" key={key} aria-label={`최종 대표이미지 ${index+1} 선택`} aria-pressed={selected.length===1&&selected[0]===key} disabled={disabled||!valid||busy||uncertain||saveOnSelect&&dirty} onClick={()=>edit(key)}><img src={url(key)} alt={`저장 이미지 ${index+1}`} width={100} height={100} loading="lazy"/><span>이미지 {index+1}</span></button>;}
 return <section className="panel-stack option-main-image-editor" aria-label="옵션 최종 견적 대표이미지 편집" data-quotation-source-step="대표 이미지" data-workspace-dirty={dirty} data-workspace-saving={busy}>
  <h3>최종 견적 대표이미지</h3><p>이 옵션의 견적서와 상품 표에 표시할 대표이미지를 선택합니다.{saveOnSelect&&' 선택·비우기·복원하면 바로 저장됩니다.'}</p>{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}{dirty&&!fresh&&<p role="status">다른 저장값이 변경되었습니다. 이미지 선택은 유지했습니다.</p>}
  <label className="field"><span>편집할 옵션</span><select aria-label="최종 대표이미지 옵션" value={id} disabled={disabled||busy||dirty||focusedOptionId!==undefined} onChange={event=>{if(focusedOptionId===undefined&&currentOption()&&!liveDisabled.current&&!request.current&&!(liveDraft.current.scope===scope&&liveDraft.current.value!==undefined))setSelection({scope,id:event.target.value});}}><option value="">옵션 선택</option>{rows.filter(row=>focusedOptionId===undefined||row.optionId===focusedOptionId).map(row=><option key={row.optionId} value={row.optionId!}>{row.optionLabel}{row.included?'':' · 견적 제외'}</option>)}</select></label>
  {!valid&&<p role="alert">선택한 옵션이 현재 견적서에 없습니다.</p>}
  <div className="image-edit-workspace main-image-editor-workspace">
   <aside className="image-edit-library main-image-library" aria-label="대표이미지 후보">
    <h4>이미지 선택</h4>
    <nav aria-label="대표이미지 후보 종류" className="main-image-library-tabs">{libraryTabs.map(([name,label])=><button type="button" className={`btn ${tab===name?'primary':'ghost'}`} key={name} aria-label={`${label} 보기`} aria-pressed={tab===name} disabled={disabled||busy||name!=='work'&&!groups} onClick={()=>{if(tabGeneration&&liveTabGeneration.current===tabGeneration&&currentOption()&&!liveDisabled.current&&!request.current&&(name==='work'||groups))setLibraryTab(previous=>previous.scope===tabScope&&previous.token===tabGeneration?{...previous,tab:name}:previous);}}>{label} <small>{groups?.[name].length??'미확인'}</small></button>)}</nav>
    <div className="main-image-library-candidates">
    {libraryState?.error&&<p role="status">{libraryState.error}</p>}
    <div className="image-asset-grid main-image-library-grid" aria-label={`${libraryTabs.find(([name])=>name===tab)?.[1]} 후보`}>{visiblePool.map(candidate)}</div>
    {base&&!visiblePool.length&&<p>이 종류에 연결된 이미지가 없습니다.</p>}
    <small>탭을 바꿔도 현재 선택은 유지됩니다. 직접 올린 사진은 아래 전체 저장 이미지에서 선택하세요.</small>
    <details className="main-image-all-saved"><summary>전체 저장 이미지 · {pool.length}개</summary><p>직접 업로드한 사진을 포함한 저장 목록입니다.</p><div className="image-asset-grid main-image-library-grid">{pool.map(candidate)}</div></details>
    </div>
    <section className="main-image-current-summary" aria-label="현재 메인 이미지">
     <h4>현재 메인 이미지</h4>
     {selected.length===1&&pool.includes(selected[0])?<>
      <button type="button" className="main-image-current-thumbnail" aria-label="현재 메인 이미지 크게 보기" aria-haspopup="dialog" disabled={!valid||!fresh||disabled} onClick={()=>openPreview(selected[0])}><img src={url(selected[0])} alt="현재 메인 이미지 작은 미리보기" width={160} height={160}/></button>
      {onProcess&&<button type="button" className="btn primary" aria-label="최종 대표이미지 AI 처리" disabled={processingConfigured!==true||disabled||!translationEnabled||!valid||busy||uncertain||dirty||!fresh} onClick={()=>translateSelected(selected[0],'zh',false,true)}>{processingConfigured===true?'AI 처리':processingConfigured===false?'AI 서버 설정 필요':'AI 설정 확인 중'}</button>}
      {onTranslate&&<div role="group" className="main-image-current-translation" aria-label="최종 견적 대표이미지 번역"><button type="button" className="btn ghost" aria-label="최종 대표이미지 중국어 한국어 번역" disabled={disabled||!translationEnabled||!valid||busy||uncertain||dirty||!fresh} onClick={()=>translateSelected(selected[0],'zh')}>중국어 → 한국어</button><button type="button" className="btn ghost" aria-label="최종 대표이미지 영어 한국어 번역" disabled={disabled||!translationEnabled||!valid||busy||uncertain||dirty||!fresh} onClick={()=>translateSelected(selected[0],'en')}>영어 → 한국어</button></div>}
     </>:<small>{selected.length?'대표 이미지 연결을 확인해주세요.':'대표 이미지를 선택해주세요.'}</small>}
    </section>
   </aside>
   <section className="image-edit-canvas main-image-current" aria-label="현재 대표이미지 미리보기">
    <h4>현재 대표 이미지</h4>
    {selected.map(key=><figure className="image-large-preview" key={key}>{pool.includes(key)?<button type="button" aria-label="최종 대표이미지 크게 보기" aria-haspopup="dialog" disabled={!valid||!fresh||disabled} onClick={()=>openPreview(key)} style={{display:'block',width:'100%',padding:0,border:0,background:'transparent',cursor:'zoom-in'}}><img src={url(key)} alt="최종 견적 대표이미지" style={{maxWidth:'100%',height:'auto'}}/></button>:<p>현재 상품에 없는 대표이미지 참조</p>}<figcaption>선택한 대표 이미지</figcaption>
     <div className="quote-actions main-image-preview-actions">
      {onEdit&&<button type="button" className="btn ghost" aria-label="최종 대표이미지 편집하기" disabled={disabled||!translationEnabled||!valid||busy||uncertain||dirty||!fresh||!pool.includes(key)} onClick={()=>translateSelected(key,'zh',true)}>편집하기</button>}
     </div>
    </figure>)}
    {valid&&!selected.length&&<div className="empty"><p>최종 대표이미지는 공란입니다.</p></div>}
    <div className="quote-actions main-image-save-actions"><button type="button" className="btn ghost" disabled={disabled||!valid||busy||uncertain||saveOnSelect&&dirty} onClick={()=>edit('')}>최종 대표이미지 비우기</button><button type="button" className="btn ghost" disabled={disabled||!valid||busy||uncertain||saveOnSelect&&dirty} onClick={()=>edit(null)}>공통·원본 대표이미지 복원</button><button type="button" className="btn primary" hidden={saveOnSelect&&!dirty} disabled={disabled||!valid||busy||!dirty} onClick={()=>void save()}>{uncertain?'대표이미지 저장 결과 확인·재시도':saveOnSelect?busy?'대표이미지 저장 중…':'선택한 대표이미지 다시 저장':'최종 견적 대표이미지 저장'}</button></div>
    {dirty&&<button type="button" className="btn ghost" disabled={disabled||busy} onClick={()=>void load(true)}>선택 유지·최신 대표이미지 조회</button>}<button type="button" className="btn ghost" disabled={disabled||busy} onClick={()=>{if(currentOption()&&!liveDisabled.current&&!request.current){clear();void load();}}}>{dirty?'선택 취소·저장 대표이미지 조회':'최종 대표이미지 저장본 조회'}</button>
   </section>
  </div>
  {preview?.generation===previewGeneration&&selected.includes(preview.key)&&pool.includes(preview.key)&&<ImageFullscreenPreview src={url(preview.key)} alt="최종 견적 대표이미지 전체 화면" onClose={()=>closePreview(preview)}/>}
 </section>;
}
