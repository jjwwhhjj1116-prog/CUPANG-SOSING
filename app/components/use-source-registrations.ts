'use client';
import {useEffect,useRef,useState,useCallback} from 'react';
import type {SourceInboxItem} from '@/app/source-inbox';

/** Refresh the current member's captured list without touching existing products. */
export function useSourceRegistrations(ownerId?:string){
 const [state,setState]=useState<{ownerId?:string;items:SourceInboxItem[];error:string}>({items:[],error:''});
 const refresh=useRef<()=>void>(()=>{});
 useEffect(()=>{
  if(typeof window==='undefined'||typeof document==='undefined')return;
  let alive=true,running:AbortController|null=null,queued=false;
  async function load(){
   if(!ownerId||!alive)return;
   if(running){queued=true;return;}
   const controller=new AbortController();running=controller;
   const timeout=setTimeout(()=>controller.abort(),15000);
   try{
    const response=await fetch('/api/source-inbox',{cache:'no-store',redirect:'error',signal:controller.signal});
    const body=await response.json() as {ownerId?:string;items?:SourceInboxItem[];error?:string};
    if(!alive)return;
    if(!response.ok||body.ownerId!==ownerId||!Array.isArray(body.items)||body.items.some(item=>item.ownerId!==ownerId))throw Error(body.error||'수집 상품 목록을 확인하지 못했습니다.');
    setState({ownerId,items:body.items,error:''});
   }catch(error){if(alive)setState(previous=>({ownerId,items:previous.ownerId===ownerId?previous.items:[],error:error instanceof Error?error.message:'수집 상품 조회 실패'}));}
   finally{clearTimeout(timeout);if(running===controller)running=null;if(alive&&queued){queued=false;void load();}}
  }
  const reload=()=>{void load();};refresh.current=reload;
  const message=(event:MessageEvent)=>{if(event.source===window&&event.origin===location.origin&&event.data?.channel==='YOOFAM_SOURCE_INBOX_UPDATED')reload();};
  const visible=()=>{if(document.visibilityState==='visible')reload();};
  window.addEventListener('message',message);window.addEventListener('focus',reload);document.addEventListener('visibilitychange',visible);
  const interval=setInterval(visible,30000);reload();
  // Deliver captures retained while the app was closed; owner/company are
  // checked independently by the worker and the app API before acknowledgement.
  const flush=setTimeout(()=>{if(alive&&ownerId)window.postMessage({channel:'YOOFAM_SOURCE_INBOX',type:'FLUSH',requestId:crypto.randomUUID()},location.origin);},1500);
  return()=>{alive=false;running?.abort();clearInterval(interval);clearTimeout(flush);window.removeEventListener('message',message);window.removeEventListener('focus',reload);document.removeEventListener('visibilitychange',visible);if(refresh.current===reload)refresh.current=()=>{};};
 },[ownerId]);
 return {items:state.ownerId===ownerId?state.items:[],error:state.ownerId===ownerId?state.error:'',reload:useCallback(()=>refresh.current(),[])};
}
