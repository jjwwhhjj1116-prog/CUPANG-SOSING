'use client';
import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {loadSupplierHubCategoryRecommendations,type HubCategoryRecommendation,type HubCategoryRecommendations} from '@/app/supplier-hub-category-recommendations';
import './category-recommendations-panel.css';

type Props={
 initialTitle:string;
 workspaceOwnerId?:string;
 selectionScope?:string;
 disabled:boolean;
 onChoose:(candidate:HubCategoryRecommendation,result:HubCategoryRecommendations)=>Promise<void>|void;
};
type Context={initialTitle:string;ownerId?:string;selectionScope?:string;name:string;disabled:boolean};
const sameContext=(left:Context,right:Context)=>left.initialTitle===right.initialTitle&&left.ownerId===right.ownerId&&left.selectionScope===right.selectionScope&&left.name===right.name;

/** Only the member's radio selection resolves a recommendation into a category. */
export function CategoryRecommendationsPanel({initialTitle,workspaceOwnerId,selectionScope,disabled,onChoose}:Props){
 const id=useId(),[name,setName]=useState(initialTitle.trim()),[result,setResult]=useState<HubCategoryRecommendations|null>(null);
 const [chosen,setChosen]=useState<string|null>(null),[pending,setPending]=useState(false),[applying,setApplying]=useState(false),[error,setError]=useState('');
 const mounted=useRef(false),generation=useRef(0),applyGeneration=useRef(0),applyingRef=useRef(false);
 const controller=useRef<AbortController|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const [resultContext,setResultContext]=useState<(Context&{generation:number})|null>(null);
 const selfBusyCycle=useRef(false);
 const previousSelectionScope=useRef(selectionScope),scopeInvalidated=useRef(false);
 const context=useRef<Context>({initialTitle,ownerId:workspaceOwnerId,selectionScope,name,disabled}),choose=useRef(onChoose);
 useLayoutEffect(()=>{context.current={initialTitle,ownerId:workspaceOwnerId,selectionScope,name,disabled};choose.current=onChoose;});

 function cancel(){
  generation.current++;controller.current?.abort();controller.current=null;
  if(timer.current!==null){clearTimeout(timer.current);timer.current=null;}
  applyGeneration.current++;applyingRef.current=false;
 }
 function reset(){cancel();selfBusyCycle.current=false;setResultContext(null);setResult(null);setChosen(null);setPending(false);setApplying(false);setError('');}
 async function request(force:boolean){
  const requestContext={...context.current},productName=requestContext.name.trim();
  if(!mounted.current||requestContext.disabled||!requestContext.ownerId||!productName||applyingRef.current)return;
  scopeInvalidated.current=false;
  reset();const ticket=generation.current,abort=new AbortController();controller.current=abort;setPending(true);
  const current=()=>mounted.current&&!abort.signal.aborted&&!context.current.disabled&&ticket===generation.current&&sameContext(requestContext,context.current);
  try{
   const response=await loadSupplierHubCategoryRecommendations(productName,{workspaceOwnerId:requestContext.ownerId,signal:abort.signal,force});
   if(!current())return;
   if(response.source!=='supplier-hub-category-predict-api'||response.ownerId!==requestContext.ownerId||response.productName!==productName||!Array.isArray(response.items))throw Error('현재 회원과 상품명의 카테고리 추천 결과를 확인하지 못했습니다. 다시 추천해주세요.');
   const visible=response.items.slice(0,3);
   if(new Set(visible.map(item=>item.id)).size!==visible.length||visible.some(item=>!item.id||!item.code||!item.label||!Array.isArray(item.path)||!item.path.length||item.path.some(part=>typeof part!=='string'||!part.trim())))throw Error('카테고리 추천 경로를 확인하지 못했습니다. 다시 추천해주세요.');
   setResultContext({...requestContext,generation:ticket});setResult(response);
  }catch(reason){if(current())setError(reason instanceof Error?reason.message:'카테고리 추천을 불러오지 못했습니다. 다시 시도해주세요.');}
  finally{if(current()){setPending(false);controller.current=null;}}
 }
 const requestRef=useRef(request);useLayoutEffect(()=>{requestRef.current=request;});
 useLayoutEffect(()=>{
  if(previousSelectionScope.current===selectionScope)return;
  previousSelectionScope.current=selectionScope;scopeInvalidated.current=true;reset();
  setError('카테고리 설정이 변경되었습니다. 추천 새로고침으로 현재 설정을 확인해주세요.');
  // Only an external selection change invalidates this result, not the state
  // changes made by reset itself or the current application busy cycle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[selectionScope]);

 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;cancel();};},[]);
 // Switching the source/member must discard its editable name, without writing any product.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{setName(initialTitle.trim());},[initialTitle,workspaceOwnerId]);
 useEffect(()=>{
  // Member/source changes invalidate recommendations before a debounced read.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  scopeInvalidated.current=false;reset();
  if(!context.current.disabled&&workspaceOwnerId&&name.trim())timer.current=setTimeout(()=>{timer.current=null;void requestRef.current(false);},600);
  return cancel;
  // Reset is intentionally scoped to the source and query, not its own parent selection busy state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[initialTitle,workspaceOwnerId,name]);
 useEffect(()=>{
  if(applyingRef.current){if(disabled)selfBusyCycle.current=true;return;}
  if(!disabled&&selfBusyCycle.current){selfBusyCycle.current=false;return;}
  if(disabled){
   // An external busy/disabled transition must invalidate a pending member query.
   // eslint-disable-next-line react-hooks/set-state-in-effect
   reset();return;
  }
  if(scopeInvalidated.current||!context.current.ownerId||!context.current.name.trim())return;
  if(timer.current===null&&!controller.current&&!resultContext)timer.current=setTimeout(()=>{timer.current=null;void requestRef.current(false);},600);
  // Only the disabled transition is observed here; query changes have their own cancellation effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[disabled]);

 const activeResult=result&&resultContext&&sameContext(resultContext,{initialTitle,ownerId:workspaceOwnerId,selectionScope,name,disabled})&&!disabled?result:null;
 const visible=activeResult?.items.slice(0,3)??[];
 const candidate=visible.find(item=>item.id===chosen),blocked=disabled||pending||applying||!workspaceOwnerId;
 async function apply(selection:HubCategoryRecommendation){
  const confirmed=visible.find(item=>item.id===selection.id);
  if(blocked||applyingRef.current||!confirmed||!result||!mounted.current||context.current.disabled
   ||!resultContext||resultContext.generation!==generation.current||!sameContext(resultContext,context.current))return;
  const before={...context.current},ticket=++applyGeneration.current,selectedResult=result;
  applyingRef.current=true;setChosen(confirmed.id);setApplying(true);setError('');
  const current=()=>mounted.current&&ticket===applyGeneration.current&&sameContext(before,context.current);
  try{await choose.current(confirmed,selectedResult);}
  catch(reason){if(current())setError(reason instanceof Error?reason.message:'선택한 카테고리를 적용하지 못했습니다. 다시 확인해주세요.');}
  finally{if(current()){applyingRef.current=false;setApplying(false);}}
 }
 const queryProductName=activeResult&&'queryProductName' in activeResult?activeResult.queryProductName:undefined;
 return <section className="category-recommendations-card" aria-labelledby={`${id}-heading`}>
  <h3 id={`${id}-heading`}>기본정보</h3>
  <label className="category-recommendations-title" htmlFor={`${id}-title`}>추천 검색용 상품명</label>
  <input id={`${id}-title`} className="category-recommendations-input" value={name} maxLength={500} placeholder="추천 카테고리를 검색할 상품명을 입력하세요" aria-describedby={`${id}-title-help`} disabled={disabled||applying} onChange={event=>{reset();context.current={...context.current,name:event.target.value};setName(event.target.value);}}/>
  <p id={`${id}-title-help`} className="category-recommendations-help">카테고리 추천에만 사용합니다. 판매 상품명은 초안 작성 후 SEO 설정에서 수정하세요.</p>
  <div className="category-recommendations-heading"><label htmlFor={`${id}-choices`}>카테고리</label><button type="button" className="category-recommendations-refresh" disabled={blocked||!name.trim()} onClick={()=>void request(true)}>{pending?'추천 불러오는 중…':'↻ 추천 새로고침'}</button></div>
  <p id={`${id}-help`} className="category-recommendations-help">상품명을 기준으로 추천 카테고리 최대 3개를 표시합니다. 경로를 확인하고 하나를 선택하세요.</p>
  {pending&&<p className="category-recommendations-status" role="status">카테고리 추천을 불러오는 중입니다. 잠시 기다려주세요.</p>}
  {error&&<p className="category-recommendations-error" role="alert">{error}</p>}
  {typeof queryProductName==='string'&&queryProductName!==activeResult?.productName&&<p className="category-recommendations-query">추천에 사용한 상품명: {queryProductName}</p>}
  {!pending&&activeResult&&visible.length===0&&!error&&<p className="category-recommendations-status" role="status">추천 카테고리가 없습니다. 상품명을 수정하거나 직접 카테고리를 찾아주세요.</p>}
  {visible.length>0&&<fieldset id={`${id}-choices`} className="category-recommendations-choices" aria-describedby={`${id}-help`} disabled={blocked}>
   <legend className="category-recommendations-sr-only">추천 카테고리 선택</legend>
   {visible.map(item=><label key={item.id} className={`category-recommendations-choice${chosen===item.id?' is-selected':''}`}><input type="radio" name={`${id}-category`} value={item.id} checked={chosen===item.id} onChange={()=>void apply(item)}/><span>{item.path.join(' > ')}</span></label>)}
  </fieldset>}
  {applying&&<p className="category-recommendations-status" role="status">선택한 카테고리를 확인하고 있습니다.</p>}
  {error&&candidate&&<div className="category-recommendations-actions"><button type="button" className="btn primary" disabled={blocked} onClick={()=>void apply(candidate)}>선택한 카테고리 다시 적용</button></div>}
 </section>;
}
