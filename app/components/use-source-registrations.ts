'use client';
import {useEffect,useLayoutEffect,useMemo,useRef,useState,useCallback} from 'react';
import type {SourceInboxItem} from '@/app/source-inbox';
import {validateReviewedSourceTransition} from '@/app/source-review-intake';

type SourceRegistrationState={ownerId?:string;items:SourceInboxItem[];error:string};
type SourceRegistrationSession={ownerId?:string;token:object;alive:boolean;epoch:number;cancel:()=>void;accepted:Map<string,SourceInboxItem>};

/** Refresh the current member's captured list without touching existing products. */
export function useSourceRegistrations(ownerId?:string){
 const [state,setState]=useState<SourceRegistrationState>({items:[],error:''});
 const token=useMemo(()=>({ownerId}),[ownerId]),current=useRef(state),owner=useRef(token),session=useRef<SourceRegistrationSession|null>(null);
 useLayoutEffect(()=>{current.current=state;owner.current=token;},[state,token]);
 const refresh=useRef<()=>void>(()=>{});
 useEffect(()=>{
  if(typeof window==='undefined'||typeof document==='undefined')return;
  let alive=true,running:AbortController|null=null,queued=false;
  const scope:SourceRegistrationSession={ownerId,token,alive:true,epoch:0,cancel:()=>{running?.abort();running=null;queued=false;},accepted:new Map()};session.current=scope;
  const active=(epoch:number)=>alive&&scope.alive&&session.current===scope&&owner.current===token&&scope.epoch===epoch;
  const publish=(value:SourceRegistrationState)=>{current.current=value;setState(value);};
  async function load(){
   if(!ownerId||!active(scope.epoch))return;
   if(running){queued=true;return;}
   const controller=new AbortController(),epoch=scope.epoch;running=controller;
   const timeout=setTimeout(()=>controller.abort(),15000);
   try{
    const response=await fetch('/api/source-inbox',{cache:'no-store',redirect:'error',signal:controller.signal});
    const body=await response.json() as {ownerId?:string;items?:SourceInboxItem[];error?:string};
    if(!active(epoch)||controller.signal.aborted)return;
    if(!response.ok||body.ownerId!==ownerId||!Array.isArray(body.items)||body.items.some(item=>item.ownerId!==ownerId))throw Error(body.error||'수집 상품 목록을 확인하지 못했습니다.');
    // An old read must not roll back a review acknowledgement, including a
    // refresh that raced with propagation of the saved revision.
    const items=body.items.map(item=>{const accepted=scope.accepted.get(item.id);if(!accepted)return item;if(item.revision>=accepted.revision){scope.accepted.delete(item.id);return item;}return accepted;});
    for(const accepted of scope.accepted.values())if(!items.some(item=>item.id===accepted.id))items.push(accepted);
    publish({ownerId,items,error:''});
   }catch(error){if(active(epoch)&&!controller.signal.aborted)publish({ownerId,items:current.current.ownerId===ownerId?current.current.items:[],error:error instanceof Error?error.message:'수집 상품 조회 실패'});}
   finally{clearTimeout(timeout);if(running===controller){running=null;if(active(epoch)&&queued){queued=false;void load();}}}
  }
  const reload=()=>{void load();};refresh.current=reload;
  const message=(event:MessageEvent)=>{if(event.source===window&&event.origin===location.origin&&event.data?.channel==='YOOFAM_SOURCE_INBOX_UPDATED')reload();};
  const visible=()=>{if(document.visibilityState==='visible')reload();};
  window.addEventListener('message',message);window.addEventListener('focus',reload);document.addEventListener('visibilitychange',visible);
  const interval=setInterval(visible,30000);reload();
  // Deliver captures retained while the app was closed; owner/company are
  // checked independently by the worker and the app API before acknowledgement.
  const flush=setTimeout(()=>{if(alive&&ownerId)window.postMessage({channel:'YOOFAM_SOURCE_INBOX',type:'FLUSH',requestId:crypto.randomUUID()},location.origin);},1500);
  return()=>{alive=false;scope.alive=false;scope.epoch++;scope.cancel();clearInterval(interval);clearTimeout(flush);window.removeEventListener('message',message);window.removeEventListener('focus',reload);document.removeEventListener('visibilitychange',visible);if(refresh.current===reload)refresh.current=()=>{};};
 },[ownerId,token]);
 const acceptReviewed=useCallback((before:SourceInboxItem,saved:SourceInboxItem):boolean=>{
  const scope=session.current;
  if(!ownerId||owner.current!==token||!scope?.alive||scope.token!==token||scope.ownerId!==ownerId||!validateReviewedSourceTransition(before,saved,ownerId))return false;
  const previous=current.current.ownerId===ownerId?current.current.items:[],existing=previous.find(item=>item.id===saved.id);
  if(existing&&(existing.revision>before.revision||existing.ownerId!==saved.ownerId||existing.fingerprint!==saved.fingerprint||existing.snapshot.sourceUrl!==saved.snapshot.sourceUrl||existing.company.code!==saved.company.code||existing.company.name!==saved.company.name))return false;
  scope.epoch++;scope.cancel();scope.accepted.set(saved.id,saved);
  const value={ownerId,items:existing?previous.map(item=>item.id===saved.id?saved:item):[saved,...previous],error:''};
  current.current=value;setState(value);return true;
 },[ownerId,token]);
 return {items:state.ownerId===ownerId?state.items:[],error:state.ownerId===ownerId?state.error:'',reload:useCallback(()=>refresh.current(),[]),acceptReviewed};
}
