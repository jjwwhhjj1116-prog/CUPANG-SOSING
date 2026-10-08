'use client';
/* eslint-disable @next/next/no-img-element -- Final-image previews use the authenticated private file route. */
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {mainImageValue,readMainImageView,saveMainImageView,verifyMainImageRefresh,verifyMainImageSave,MainImageSaveError} from '@/app/quotation-main-image';
import type {QuotationFieldsView} from '@/app/quotation-schema';
type Props={productId:string;version?:string;profileId?:string;refreshToken?:string;focusedOptionId?:string;onSaved?:()=>void};
export function OptionMainImageEditor({productId,version,profileId,refreshToken,focusedOptionId,onSaved}:Props){
 const endpoint=`/api/products/${encodeURIComponent(productId)}/quotation-fields${profileId?`?profileId=${encodeURIComponent(profileId)}`:''}`,scope=JSON.stringify([endpoint,focusedOptionId??'']),sourceKey=JSON.stringify([scope,version,refreshToken]);
 const liveScope=useRef(scope),liveSource=useRef(sourceKey),mounted=useRef(true),request=useRef<AbortController|null>(null);
 const [saved,setSaved]=useState<{scope:string;sourceKey:string;view:QuotationFieldsView}|null>(null),liveSaved=useRef<typeof saved>(null),[selection,setSelection]=useState<{scope:string;id:string}>({scope,id:focusedOptionId??''});
 const [pending,setPending]=useState<{scope:string;optionId:string;value:string|null|undefined}>({scope,optionId:'',value:undefined}),liveDraft=useRef(pending);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[uncertain,setUncertain]=useState(false);
 const current=()=>mounted.current&&liveScope.current===scope&&liveSource.current===sourceKey;
 useLayoutEffect(()=>{mounted.current=true;liveScope.current=scope;liveSource.current=sourceKey;if(liveDraft.current.scope!==scope)liveDraft.current={scope,optionId:'',value:undefined};return()=>{mounted.current=false;request.current?.abort();request.current=null;};},[scope,sourceKey]);
 const base=saved?.scope===scope?saved:null,rows=base?.view.resolved.rows.filter(row=>row.optionId!==null)??[],chosen=selection.scope===scope?selection.id:focusedOptionId??'',id=chosen||(focusedOptionId?focusedOptionId:rows.find(row=>row.included)?.optionId??rows[0]?.optionId??'');
 const dirty=pending.scope===scope&&pending.value!==undefined,editing=dirty&&pending.optionId===id?pending.value:undefined,fresh=base?.sourceKey===sourceKey;
 let selected:string[]=[];try{if(base&&id)selected=mainImageValue(base.view,id,editing).split('\n').map(key=>key.trim()).filter(Boolean);}catch{/* The read/save helpers preserve and report invalid binding. */}
 function store(view:QuotationFieldsView){liveSaved.current={scope,sourceKey,view};setSaved(liveSaved.current);}
 function clear(){liveDraft.current={scope,optionId:'',value:undefined};setPending(liveDraft.current);setUncertain(false);}
 function begin(){if(!current()||request.current)return null;const c=new AbortController();request.current=c;setBusy(true);setError('');setMessage('');return c;}
 function finish(c:AbortController){if(request.current===c){request.current=null;if(current()&&!c.signal.aborted)setBusy(false);}}
 function scoped(c:AbortController):typeof fetch{return async(url,init)=>{if(!current()||c.signal.aborted)throw Error('대표이미지 편집 대상이 변경되었습니다.');const response=await fetch(url,{...init,signal:c.signal});if(!current()||c.signal.aborted)throw Error('대표이미지 편집 대상이 변경되었습니다.');return response;};}
 async function load(keep=false){const c=begin();if(!c)return;try{const view=await readMainImageView(endpoint,scoped(c));if(!current()||c.signal.aborted)return;const previous=liveSaved.current?.scope===scope?liveSaved.current.view:null,draft=liveDraft.current;let recovered=false;
   if(keep&&previous&&draft.scope===scope&&draft.value!==undefined){try{verifyMainImageSave(previous,view,draft.optionId,draft.value);recovered=true;}catch{if(uncertain)throw Error('이전 대표이미지 저장 결과를 확인하지 못했습니다. 선택은 유지했습니다.');verifyMainImageRefresh(previous,view,draft.optionId);}}
   else if(version&&view.productVersion!==version)throw Error('상품 저장 상태가 바뀌었습니다. 최신 상품으로 다시 확인해주세요.');
   store(view);if(!keep||recovered)clear();if(recovered){setMessage('저장된 최종 대표이미지를 확인했습니다.');onSaved?.();}
  }catch(cause){if(current()&&!c.signal.aborted)setError(cause instanceof Error?cause.message:'대표이미지 조회 실패');}finally{finish(c);}}
 useEffect(()=>{let active=true;void Promise.resolve().then(()=>{if(!active||!current())return;setBusy(false);if(liveDraft.current.scope===scope&&liveDraft.current.value!==undefined)return;void load();});return()=>{active=false;request.current?.abort();request.current=null;};
  // Keep the final-image draft mounted across price/source-image stage changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[scope,sourceKey]);
 function edit(value:string|null){if(!base||!id||!current()||request.current||busy||uncertain)return;liveDraft.current={scope,optionId:id,value};setPending(liveDraft.current);setMessage('');}
 async function save(){const before=liveSaved.current,draft=liveDraft.current;if(!current()||busy||request.current||!before||before.scope!==scope||draft.scope!==scope||draft.value===undefined)return;
  if(before.sourceKey!==sourceKey&&!uncertain){setError('이미지 선택은 유지했습니다. 최신 자료를 조회한 뒤 저장해주세요.');return;}const c=begin();if(!c)return;
  try{const view=await saveMainImageView(endpoint,before.view,draft.optionId,draft.value,scoped(c));if(!current()||c.signal.aborted)return;store(view);clear();setMessage('선택 옵션의 최종 견적 대표이미지를 저장했습니다.');onSaved?.();}
  catch(cause){if(current()&&!c.signal.aborted){setUncertain(cause instanceof MainImageSaveError&&cause.uncertain);setError(cause instanceof Error?cause.message:'대표이미지 저장 실패');}}finally{finish(c);}}
 const pool=base?.view.imageKeys??[],url=(key:string)=>`/api/files/${key.split('/').map(encodeURIComponent).join('/')}`,valid=!!id&&rows.some(row=>row.optionId===id);
 return <section className="panel-stack" aria-label="옵션 최종 견적 대표이미지 편집" data-quotation-source-step="대표 이미지" data-workspace-dirty={dirty} data-workspace-saving={busy}>
  <h3>최종 견적 대표이미지</h3><p>이 옵션의 견적서와 상품 표에 표시할 대표이미지를 선택합니다.</p>{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}{dirty&&!fresh&&<p role="status">다른 저장값이 변경되었습니다. 이미지 선택은 유지했습니다.</p>}
  <label className="field"><span>편집할 옵션</span><select aria-label="최종 대표이미지 옵션" value={id} disabled={busy||dirty} onChange={event=>{if(current()&&!request.current&&!dirty)setSelection({scope,id:event.target.value});}}><option value="">옵션 선택</option>{rows.map(row=><option key={row.optionId} value={row.optionId!}>{row.optionLabel}{row.included?'':' · 견적 제외'}</option>)}</select></label>
  {!valid&&<p role="alert">선택한 옵션이 현재 견적서에 없습니다.</p>}
  <div className="image-selected-strip">{selected.map(key=><figure key={key}>{pool.includes(key)?<img src={url(key)} alt="최종 견적 대표이미지" style={{maxWidth:'100%',maxHeight:320}}/>:<p>현재 상품에 없는 대표이미지 참조</p>}<figcaption>{key.split('/').at(-1)}</figcaption></figure>)}</div>{valid&&!selected.length&&<p>최종 대표이미지는 공란입니다.</p>}
  <div className="image-asset-grid">{pool.map((key,index)=><button type="button" key={key} aria-label={`최종 대표이미지 ${index+1} 선택`} aria-pressed={selected.length===1&&selected[0]===key} disabled={!valid||busy||uncertain} onClick={()=>edit(key)}><img src={url(key)} alt={`저장 이미지 ${index+1}`} width={100} height={100}/><span>이미지 {index+1}</span></button>)}</div>
  <div className="quote-actions"><button type="button" className="btn ghost" disabled={!valid||busy||uncertain} onClick={()=>edit('')}>최종 대표이미지 비우기</button><button type="button" className="btn ghost" disabled={!valid||busy||uncertain} onClick={()=>edit(null)}>공통·원본 대표이미지 복원</button><button type="button" className="btn primary" disabled={!valid||busy||!dirty} onClick={()=>void save()}>{uncertain?'대표이미지 저장 결과 확인·재시도':'최종 견적 대표이미지 저장'}</button></div>
  {dirty&&<button type="button" className="btn ghost" disabled={busy} onClick={()=>void load(true)}>선택 유지·최신 대표이미지 조회</button>}<button type="button" className="btn ghost" disabled={busy} onClick={()=>{if(current()&&!request.current){clear();void load();}}}>{dirty?'선택 취소·저장 대표이미지 조회':'최종 대표이미지 저장본 조회'}</button>
 </section>;
}
