'use client';
import {useEffect,useLayoutEffect,useMemo,useRef,useState,useCallback} from 'react';
import type {SourceInboxItem} from '@/app/source-inbox';
import {validateReviewedSourceTransition} from '@/app/source-review-intake';
import {readSourceArchiveReceipt,sourceArchiveReference,sameSourceArchiveReference,type SourceArchiveReceipt} from '@/app/source-inbox-archive-client';
import {sourceHasManualTitle} from '@/app/source-inbox-title';
import {prepareSourceInboxDisplayTitle} from '@/app/source-inbox-title-client';

type SourceRegistrationState={ownerId?:string;items:SourceInboxItem[];error:string};
type SourceRegistrationSession={ownerId?:string;token:object;alive:boolean;epoch:number;cancel:()=>void;accepted:Map<string,SourceInboxItem>;archived:Map<string,SourceArchiveReceipt>};
type SourceDeliveryCompany={code:string;name:string};
type SourceDeliveryAttempt={token:object;epoch:number;origin:string;ownerId:string;company:SourceDeliveryCompany|null;requestId:string;controller:AbortController;posted:boolean;waiting:boolean;expiresAt:number;timer?:ReturnType<typeof setTimeout>};
const deliveryCompany=(value:unknown):SourceDeliveryCompany|null=>{
 if(!value||typeof value!=='object')return null;const company=value as SourceDeliveryCompany;
 return typeof company.code==='string'&&typeof company.name==='string'&&({A01526306:'유앤채',A01464742:'와이홉'} as Record<string,string>)[company.code]===company.name?{code:company.code,name:company.name}:null;
};
const sameCompany=(first:SourceDeliveryCompany|null|undefined,second:SourceDeliveryCompany|null|undefined)=>!!first&&!!second&&first.code===second.code&&first.name===second.name;

/** Refresh the current member's captured list without touching existing products. */
export function useSourceRegistrations(ownerId?:string){
 const [state,setState]=useState<SourceRegistrationState>({items:[],error:''});
 const token=useMemo(()=>({ownerId}),[ownerId]),current=useRef(state),owner=useRef(token),session=useRef<SourceRegistrationSession|null>(null);
 const delivery=useRef<SourceDeliveryAttempt|null>(null),lastDeliveryAt=useRef(0);
 useLayoutEffect(()=>{current.current=state;owner.current=token;},[state,token]);
 const refresh=useRef<()=>void>(()=>{});
 useEffect(()=>{
  if(typeof window==='undefined'||typeof document==='undefined')return;
  let alive=true,running:AbortController|null=null,titleRunning:AbortController|null=null,titleQueued=false,queued=false,queuedCompany:SourceDeliveryCompany|undefined,deliveryTimer:ReturnType<typeof setTimeout>|undefined,titleRetry:ReturnType<typeof setTimeout>|undefined;
  const titleAttempts=new Map<string,number>();
  const origin=location.origin;
  const releaseDelivery=(attempt:SourceDeliveryAttempt)=>{clearTimeout(attempt.timer);attempt.controller.abort();if(delivery.current===attempt)delivery.current=null;};
  // An expired result wait is uncertainty, not a save acknowledgement. Only a
  // later foreground may retry the same immutable, idempotent worker queue.
  const expireDelivery=()=>{const attempt=delivery.current;if(attempt?.posted&&Date.now()>=attempt.expiresAt)releaseDelivery(attempt);};
  const scope:SourceRegistrationSession={ownerId,token,alive:true,epoch:0,cancel:()=>{running?.abort();running=null;titleRunning?.abort();titleRunning=null;titleQueued=false;clearTimeout(titleRetry);titleRetry=undefined;queued=false;queuedCompany=undefined;clearTimeout(deliveryTimer);deliveryTimer=undefined;const attempt=delivery.current;if(attempt?.token===token)releaseDelivery(attempt);},accepted:new Map(),archived:new Map()};session.current=scope;
  const active=(epoch:number)=>alive&&scope.alive&&session.current===scope&&owner.current===token&&scope.epoch===epoch&&location.origin===origin;
  const publish=(value:SourceRegistrationState)=>{current.current=value;setState(value);};
  async function prepareTitles(items:SourceInboxItem[]){
   if(!ownerId||!active(scope.epoch))return;if(titleRunning){titleQueued=true;return;}
   const controller=new AbortController(),epoch=scope.epoch;titleRunning=controller;
   try{for(const item of items){
    if(!active(epoch)||controller.signal.aborted)return;
    if(item.titlePreparation?.format!=='yoofam-collected-title-v1')continue;
    const reference=sourceArchiveReference(item,ownerId,item.company),value=item.titlePreparation,key=reference&&JSON.stringify([reference,value.providerSignature??'legacy-google-free']);
    if(!key||value?.format!=='yoofam-collected-title-v1'||sourceHasManualTitle(item)||value.state==='completed'||value.state==='running'||value.state==='failed'&&!value.retryable||(titleAttempts.get(key)??0)>=2)continue;
    titleAttempts.set(key,(titleAttempts.get(key)??0)+1);
    const timer=setTimeout(()=>controller.abort(),35000);
    try{
     const fields=await prepareSourceInboxDisplayTitle(item,controller.signal);if(!active(epoch)||controller.signal.aborted)return;
     const latest=current.current;if(latest.ownerId!==ownerId)continue;
     const rows=latest.items.map(row=>sameSourceArchiveReference(reference,sourceArchiveReference(row,ownerId,row.company))?{...row,...fields}:row);
     publish({ownerId,items:rows,error:latest.error});
     if(fields.titlePreparation?.retryable&&fields.titlePreparation.state==='failed'&&titleRetry===undefined)titleRetry=setTimeout(()=>{titleRetry=undefined;void prepareTitles(current.current.items);},2000);
    }catch{
     if(active(epoch)){
      const latest=current.current;if(latest.ownerId===ownerId)publish({ownerId,error:latest.error,items:latest.items.map(row=>sameSourceArchiveReference(reference,sourceArchiveReference(row,ownerId,row.company))
       ?{...row,displayTitle:row.reviewed?.title??row.snapshot.title,titlePreparation:{...value,state:'failed',translatedTitle:null,retryable:false,attempts:Math.max(value.attempts,titleAttempts.get(key)??1),message:controller.signal.aborted?'상품명 준비 응답이 지연되었습니다. 원문을 보존했습니다.':'상품명 준비 결과를 확인하지 못했습니다. 원문을 보존했습니다.'}}:row)});
     }
    }
    finally{clearTimeout(timer);}
   }}finally{if(titleRunning===controller){titleRunning=null;if(active(epoch)&&titleQueued){titleQueued=false;void prepareTitles(current.current.items);}}}
  }
  async function load(expectedCompany?:SourceDeliveryCompany){
   if(!ownerId||!active(scope.epoch))return;
   if(running){queued=true;if(expectedCompany)queuedCompany=expectedCompany;return;}
   const controller=new AbortController(),epoch=scope.epoch;running=controller;
   const timeout=setTimeout(()=>{if(active(epoch)&&running===controller){publish({ownerId,items:current.current.ownerId===ownerId?current.current.items:[],error:'수집 상품 목록 응답이 지연되고 있습니다. 표시된 이전 목록에 최신 수집본이 없을 수 있습니다. 다시 불러와주세요.'});controller.abort();}},15000);
   try{
    const response=await fetch('/api/source-inbox',{cache:'no-store',redirect:'error',signal:controller.signal});
    const body=await response.json().catch(()=>{throw Error('수집 상품 목록을 불러오지 못했습니다.');}) as {ownerId?:string;company?:SourceDeliveryCompany;items?:SourceInboxItem[];error?:string};
    if(!active(epoch)||controller.signal.aborted)return;
    const readCompany=deliveryCompany(body.company);
    if(!response.ok||body.ownerId!==ownerId||!Array.isArray(body.items)||body.items.some(item=>item.ownerId!==ownerId)||body.company!==undefined&&(!readCompany||body.items.some(item=>!sameCompany(item.company,readCompany)))||expectedCompany&&!sameCompany(readCompany,expectedCompany))throw Error(body.error||'수집 상품 목록을 확인하지 못했습니다.');
    // An old read must not roll back a review acknowledgement, including a
    // refresh that raced with propagation of the saved revision.
    const items=body.items.filter(item=>{const archived=scope.archived.get(item.id);if(!archived||!sameCompany(item.company,archived.company))return true;
     if(item.fingerprint!==archived.fingerprint||item.snapshot.sourceUrl!==archived.sourceUrl)return false;
     if(item.revision>archived.revision&&item.archivedAt===null){scope.archived.delete(item.id);return true;}return false;
    }).map(item=>{const accepted=scope.accepted.get(item.id);if(!accepted||readCompany&&!sameCompany(accepted.company,readCompany))return item;if(item.revision>=accepted.revision){scope.accepted.delete(item.id);return item;}return accepted;});
    for(const accepted of scope.accepted.values())if((!readCompany||sameCompany(accepted.company,readCompany))&&!items.some(item=>item.id===accepted.id))items.push(accepted);
    publish({ownerId,items,error:''});void prepareTitles(items);
   }catch(error){if(active(epoch)&&!controller.signal.aborted)publish({ownerId,items:current.current.ownerId===ownerId?current.current.items:[],error:(error instanceof Error?error.message:'수집 상품 조회 실패')+' 이전 목록에 최신 수집본이 없을 수 있습니다. 다시 불러와주세요.'});}
   finally{clearTimeout(timeout);if(running===controller){running=null;if(active(epoch)&&queued){const company=queuedCompany;queued=false;queuedCompany=undefined;void load(company);}}}
  }
  const reload=()=>{void load();};refresh.current=reload;
  async function context(attempt:SourceDeliveryAttempt){
   const path='/api/supplier-hub/catalog-context',timer=setTimeout(()=>attempt.controller.abort(),10000);
   try{
    const response=await fetch(path,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:attempt.controller.signal});
    if(!active(attempt.epoch)||attempt.controller.signal.aborted||delivery.current!==attempt||!response.ok||response.redirected||response.url!==origin+path)return null;
    const text=await response.text();if(text.length>4096)return null;const body=JSON.parse(text),company=deliveryCompany(body?.company);
    return active(attempt.epoch)&&!attempt.controller.signal.aborted&&delivery.current===attempt&&body?.ownerId===ownerId&&company?company:null;
   }finally{clearTimeout(timer);}
  }
  async function flushRetained(){
   expireDelivery();
   if(!ownerId||!active(scope.epoch)||document.visibilityState!=='visible'||delivery.current)return;
   const attempt:SourceDeliveryAttempt={token,epoch:scope.epoch,origin,ownerId,company:null,requestId:crypto.randomUUID(),controller:new AbortController(),posted:false,waiting:false,expiresAt:0};delivery.current=attempt;lastDeliveryAt.current=Date.now();
   try{
    const company=await context(attempt);if(!company||!active(attempt.epoch)||document.visibilityState!=='visible')return;
    attempt.company=company;attempt.posted=true;attempt.waiting=true;attempt.expiresAt=Date.now()+20000;attempt.timer=setTimeout(expireDelivery,20000);
    window.postMessage({channel:'YOOFAM_SOURCE_INBOX',type:'FLUSH',requestId:attempt.requestId},origin);
   }catch{/* The immutable extension queue is retained for the next foreground. */}
   finally{if(delivery.current===attempt&&!attempt.posted)delivery.current=null;}
  }
  const scheduleDelivery=()=>{
   expireDelivery();
   if(!ownerId||!active(scope.epoch)||document.visibilityState!=='visible'||delivery.current||deliveryTimer!==undefined||Date.now()-lastDeliveryAt.current<1000)return;
   deliveryTimer=setTimeout(()=>{deliveryTimer=undefined;void flushRetained();},250);
  };
  const message=(event:MessageEvent)=>{
   if(event.source!==window||event.origin!==origin||location.origin!==origin)return;
   if(event.data?.channel==='YOOFAM_SOURCE_INBOX_UPDATED'){reload();return;}
   expireDelivery();
   const attempt=delivery.current,result=event.data?.result;
   if(event.data?.channel!=='YOOFAM_SOURCE_INBOX_RESULT'||!attempt?.posted||!attempt.waiting||attempt.origin!==origin||event.data.requestId!==attempt.requestId||!result||typeof result!=='object')return;
   const success=result.ok===true&&result.ownerId===attempt.ownerId&&sameCompany(result.company,attempt.company)&&Number.isSafeInteger(result.delivered)&&result.delivered>=0&&Number.isSafeInteger(result.pending)&&result.pending>=0&&Array.isArray(result.errors)&&result.errors.every((error:unknown)=>typeof error==='string');
   if(!success&&!(result.ok===false&&typeof result.error==='string'))return;
   attempt.waiting=false;
   if(!success||attempt.token!==token||!active(attempt.epoch)||attempt.controller.signal.aborted){releaseDelivery(attempt);return;}
   void (async()=>{try{const company=await context(attempt);if(company&&sameCompany(company,attempt.company)&&active(attempt.epoch)&&!attempt.controller.signal.aborted)void load(company);}catch{/* A result never substitutes for the current member's saved list. */}finally{releaseDelivery(attempt);}})();
  };
  const focused=(event:FocusEvent)=>{reload();if(event?.isTrusted===true)scheduleDelivery();};
  const visible=(event?:Event)=>{if(document.visibilityState==='visible'){reload();if(event?.isTrusted===true)scheduleDelivery();}};
  window.addEventListener('message',message);window.addEventListener('focus',focused);document.addEventListener('visibilitychange',visible);
  const interval=setInterval(()=>visible(),30000);reload();
  // Foreground retries deliver only an already captured immutable queue. A
  // result deadline releases a local wait; its timer never retries or implies ACK.
  deliveryTimer=setTimeout(()=>{deliveryTimer=undefined;void flushRetained();},1500);
  return()=>{alive=false;scope.alive=false;scope.epoch++;scope.cancel();clearInterval(interval);window.removeEventListener('message',message);window.removeEventListener('focus',focused);document.removeEventListener('visibilitychange',visible);if(refresh.current===reload)refresh.current=()=>{};};
 },[ownerId,token]);
 const acceptReviewed=useCallback((before:SourceInboxItem,saved:SourceInboxItem):boolean=>{
  const scope=session.current;
  if(!ownerId||owner.current!==token||!scope?.alive||scope.token!==token||scope.ownerId!==ownerId||!validateReviewedSourceTransition(before,saved,ownerId))return false;
  // A delayed review acknowledgement cannot undo an acknowledged archive.
  // Only a fresh list containing an explicitly newer restored revision clears
  // this tombstone and permits subsequent review acknowledgements again.
  if(scope.archived.has(saved.id))return false;
  const previous=current.current.ownerId===ownerId?current.current.items:[],existing=previous.find(item=>item.id===saved.id);
  if(existing&&(existing.revision>before.revision||existing.ownerId!==saved.ownerId||existing.fingerprint!==saved.fingerprint||existing.snapshot.sourceUrl!==saved.snapshot.sourceUrl||existing.company.code!==saved.company.code||existing.company.name!==saved.company.name))return false;
  scope.epoch++;scope.cancel();scope.accepted.set(saved.id,saved);
  const value={ownerId,items:existing?previous.map(item=>item.id===saved.id?saved:item):[saved,...previous],error:''};
  current.current=value;setState(value);return true;
 },[ownerId,token]);
 const acceptArchived=useCallback((before:SourceInboxItem,receipt:SourceArchiveReceipt):boolean=>{
  const scope=session.current,reference=sourceArchiveReference(before,ownerId,before.company);
  if(!ownerId||!reference||owner.current!==token||!scope?.alive||scope.token!==token||scope.ownerId!==ownerId)return false;
  try{readSourceArchiveReceipt(receipt,reference);}catch{return false;}
  const previous=current.current.ownerId===ownerId?current.current.items:[],existing=previous.find(item=>item.id===before.id);
  if(existing&&(existing.revision!==before.revision||existing.fingerprint!==before.fingerprint||existing.ownerId!==ownerId||existing.snapshot.sourceUrl!==before.snapshot.sourceUrl||!sameCompany(existing.company,before.company)))return false;
  scope.epoch++;scope.cancel();scope.accepted.delete(before.id);scope.archived.set(before.id,receipt);
  const value={ownerId,items:previous.filter(item=>item.id!==before.id),error:''};current.current=value;setState(value);return true;
 },[ownerId,token]);
 return {items:state.ownerId===ownerId?state.items:[],error:state.ownerId===ownerId?state.error:'',reload:useCallback(()=>refresh.current(),[]),acceptReviewed,acceptArchived};
}
