'use client';
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {newOptionsRetryState,parseOptionsRetryState,retryOptionsTranslation,type OptionsRetryState} from '@/app/options-translation-retry';
import type {BatchSeoPlan,BatchSeoTask} from '@/app/batch-seo-work';

type Props={task:BatchSeoTask;plan:BatchSeoPlan;beforeRetry:(signal:AbortSignal,recovering:boolean)=>Promise<void>;onSettled:(saved:boolean,message:string)=>void;
  onBusyChange:(value:boolean)=>void;onPendingChange:(value:boolean)=>void;onUncertainChange:(value:boolean)=>void};
const scope=(props:Props)=>JSON.stringify([props.plan.ownerId,props.plan.company,props.task.productId,props.task.productVersion,props.task.contentRevision,props.task.optionRevision,props.task.sourceIdentity]);
/** One explicit options-only free batch. The existing retry helper owns the
 * durable nonce, execute/apply guards and exact after-image recovery. */
export function BatchOptionTranslationRetry(props:Props){
  return <OptionRetryContent key={scope(props)} {...props}/>;
}
function OptionRetryContent(props:Props){
  const [hydrated,setHydrated]=useState(false),[busy,setBusy]=useState(false),[hasRequest,setHasRequest]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[invalidState,setInvalidState]=useState(false);
  const state=useRef<OptionsRetryState|null>(null),request=useRef<AbortController|null>(null),invalid=useRef(false),current=useRef({mounted:true,props,key:scope(props)});
  const key=scope(props),productId=props.task.productId,storageKey=`yoofam-options-retry:${productId}`;
  useLayoutEffect(()=>{current.current={mounted:true,props,key};});
  const active=useCallback(()=>current.current.mounted&&current.current.key===key,[key]);
  const publish=useCallback((b:boolean,p:boolean,u:boolean)=>{if(!active())return;current.current.props.onBusyChange(b);current.current.props.onPendingChange(p);current.current.props.onUncertainChange(u);},[active]);
  useEffect(()=>{
    let listening=true;
    void Promise.resolve().then(()=>{
      if(!listening||!active())return;
      try{const raw=sessionStorage.getItem(storageKey),saved=raw&&raw.length<=4096?parseOptionsRetryState(JSON.parse(raw),productId):null;
        if(raw&&!saved)throw Error('이전 옵션 요청의 복구 정보를 확인하지 못했습니다. 기존 생성 이력을 확인해주세요. 새 번역은 요청하지 않았습니다.');
        state.current=saved;setHasRequest(Boolean(saved));publish(false,Boolean(saved),Boolean(saved));
      }catch(cause){invalid.current=true;setInvalidState(true);setError(cause instanceof Error?cause.message:'옵션 복구 정보를 확인하지 못했습니다.');publish(false,true,true);}
      setHydrated(true);
    });
    return()=>{listening=false;};
  },[storageKey,productId,active,publish]);
  useEffect(()=>()=>{current.current.mounted=false;request.current?.abort();current.current.props.onBusyChange(false);current.current.props.onPendingChange(false);current.current.props.onUncertainChange(false);},[]);
  async function run(){
    if(!active()||!hydrated||invalid.current||request.current)return;
    const controller=new AbortController();request.current=controller;setBusy(true);setError('');setMessage('');publish(true,Boolean(state.current),Boolean(state.current));
    const alive=()=>active()&&!controller.signal.aborted&&request.current===controller;
    const persist=(value:OptionsRetryState)=>{state.current=value;try{sessionStorage.setItem(storageKey,JSON.stringify(value));}catch{/* In-memory state still prevents another nonce. */}if(alive()){setHasRequest(true);publish(true,true,false);}};
    const timeout=setTimeout(()=>{if(!alive())return;setError('옵션 번역 응답이 늦습니다. 같은 요청 결과 확인으로 조회를 이어가세요. 새 요청은 자동으로 만들지 않습니다.');controller.abort();request.current=null;setBusy(false);publish(false,Boolean(state.current),Boolean(state.current));},30000);
    try{
      await current.current.props.beforeRetry(controller.signal,Boolean(state.current?.executeSubmitted||state.current?.applySubmitted));if(!alive())return;
      const selected=state.current??newOptionsRetryState(props.task.productId,props.task.productVersion);persist(selected);
      const result=await retryOptionsTranslation(selected,{signal:controller.signal,fetcher:fetch,onState:persist});if(!alive())return;
      setMessage(result.message);
      if(result.done){
        const savedCurrent=result.saved&&selected.productVersion===props.task.productVersion;
        state.current=null;setHasRequest(false);try{sessionStorage.removeItem(storageKey);}catch{}
        publish(true,false,false);current.current.props.onSettled(savedCurrent,result.message);
      }else publish(true,true,true);
    }catch(cause){if(alive()){setError(cause instanceof Error?cause.message:'옵션 번역 결과를 확인하지 못했습니다.');publish(true,Boolean(state.current),Boolean(state.current));}}
    finally{clearTimeout(timeout);if(request.current===controller){request.current=null;if(active()){setBusy(false);publish(false,Boolean(state.current),Boolean(state.current));}}}
  }
  return <section className="panel-stack" aria-label="미완료 옵션 전용 번역" aria-busy={busy||!hydrated}>
    <p>미완료 옵션명·색상·사이즈 {props.task.pendingOptionAttributes??0}개를 확인합니다. 상품명·검색태그·설명과 이미 번역한 값·수동 공란·제외 옵션은 유지합니다.</p>
    <p>버튼을 누를 때마다 최대 50개 항목을 무료 번역하고 저장합니다. 남은 항목과 부분 실패는 다시 표시하며 다음 묶음을 자동 실행하지 않습니다.</p>
    <button type="button" className="btn primary" disabled={!hydrated||busy||invalidState} onClick={()=>void run()}>{hasRequest?'같은 옵션 번역 계속 확인':'미완료 옵션 한 묶음 번역·저장'}</button>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  </section>;
}
