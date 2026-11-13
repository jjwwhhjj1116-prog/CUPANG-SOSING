'use client';
import {useEffect,useLayoutEffect,useMemo,useState} from 'react';
import type {ProductContent} from '@/app/product-content';
import type {ProductOptionsResponse} from '@/app/product-options';
import type {QuotationFieldsView} from '@/app/quotation-schema';
import {verifyProductLabelsView,type ProductLabelsView} from '@/app/product-label';

export type PriceMainUiScope={ownerId:string;company:{code:string;name:string};productId:string;productVersion:string;sourceUrl:string;settingsEpoch:number;settingsKey?:string;profileEpoch:number;profileId:string|null;refresh:number};
export type UiContentResponse={content:ProductContent;capturedSettingsBanners?:unknown};
export type UiOptionsResponse=ProductOptionsResponse&{imageLibrary?:unknown};
export type UiMutation={confirm:()=>void};
export type RegistrationUiReads={content:(signal?:AbortSignal)=>Promise<UiContentResponse>;options:(signal?:AbortSignal)=>Promise<UiOptionsResponse>;quotation:(url:string,signal?:AbortSignal)=>Promise<QuotationFieldsView>;hasQuotation:(url:string)=>boolean;productLabels:(url:string,signal?:AbortSignal)=>Promise<ProductLabelsView>;hasProductLabels:(url:string)=>boolean;forgetProductLabels:()=>void;beginMutation:()=>UiMutation;canRead?:()=>boolean;forget:()=>void;retire:()=>void};
type Entry={promise:Promise<unknown>;startedAt:number};
const productLabelReuseMs=8000;
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const revision=(value:unknown)=>Number.isSafeInteger(value)&&(value as number)>=0;
const aborted=()=>Object.assign(new Error('화면의 자료 조회를 중단했습니다.'),{name:'AbortError'});
const stale=()=>Error('저장 상태 또는 편집 화면이 변경되었습니다. 원래 저장 결과를 확인한 뒤 최신 자료를 조회해주세요.');

/** Initial UI responses only. Proof, save and recovery callers use their
 * original fetch functions. A consumer signal never owns the shared transport. */
export function createRegistrationUiReads(scope:PriceMainUiScope,controllers:Set<AbortController>,request:typeof fetch=fetch,pendingHolds:Set<object>=new Set()):RegistrationUiReads{
 const entries=new Map<string,Entry>(),base=`/api/products/${encodeURIComponent(scope.productId)}`;let epoch=0,retired=false;
 function subscribe<T>(promise:Promise<unknown>,signal?:AbortSignal):Promise<T>{
  return new Promise((resolve,reject)=>{
   const cancel=()=>reject(aborted());if(signal?.aborted){cancel();return;}signal?.addEventListener('abort',cancel,{once:true});
   promise.then(value=>{if(!signal?.aborted)resolve(structuredClone(value) as T);},reject).finally(()=>signal?.removeEventListener('abort',cancel));
  });
 }
 function read<T>(url:string,kind:'content'|'options'|'quotation'|'product-labels',signal?:AbortSignal,profileId:string|null=null):Promise<T>{
  if(retired||pendingHolds.size>0)return Promise.reject(stale());if(signal?.aborted)return Promise.reject(aborted());
  const isLabel=kind==='product-labels';
  let entry=entries.get(url);
  if(isLabel&&entry&&Date.now()-entry.startedAt>=productLabelReuseMs){entries.delete(url);entry=undefined;}
  if(!entry){
   const generation=epoch,controller=new AbortController();controllers.add(controller);entry={promise:Promise.resolve(),startedAt:Date.now()};entries.set(url,entry);
   const current=entry;
   entry.promise=(async()=>{
    const response=await request(url,{cache:'no-store',signal:controller.signal}),body:unknown=await response.json();
    if(retired||pendingHolds.size>0||epoch!==generation||controller.signal.aborted)throw stale();
    if(!response.ok)throw Error(record(body)&&typeof body.error==='string'?body.error:'저장 자료를 읽지 못했습니다.');
    if(!record(body))throw stale();
    if(kind==='content'){
     if(!record(body.content)||body.content.productId!==scope.productId||!revision(body.content.revision)||!record(body.content.assets)||!record(body.content.seo)||!record(body.content.label))throw stale();
    }else if(kind==='options'){
     if(body.productVersion!==scope.productVersion||!record(body.options)||body.options.productId!==scope.productId||!revision(body.options.revision)||!Array.isArray(body.options.rows)||!record(body.pricing)||!record(body.pricing.policy)||!Array.isArray(body.pricing.rows))throw stale();
     if(record(body.imageLibrary)&&(!record(body.imageLibrary.company)||body.imageLibrary.company.code!==scope.company.code||body.imageLibrary.company.name!==scope.company.name))throw stale();
    }else if(kind==='product-labels'){
     if(body.productId!==scope.productId||body.productVersion!==scope.productVersion)throw stale();
     verifyProductLabelsView(body as unknown as ProductLabelsView,null,profileId??undefined);
    }else if(body.productVersion!==scope.productVersion||!revision(body.revision)||!revision(body.contentRevision)||!revision(body.optionRevision)||typeof body.inputFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(body.inputFingerprint)||!record(body.resolved)||!record(body.resolved.schema)||!Array.isArray(body.resolved.schema.fields)||!Array.isArray(body.resolved.rows)||!record(body.automatic)||!Array.isArray(body.automatic.rows)||!Array.isArray(body.imageKeys)||!record(body.categoryContext)||profileId!==null&&body.categoryContext.profileId!==profileId)throw stale();
    return body;
   })().catch(cause=>{if(entries.get(url)===current)entries.delete(url);throw cause;}).finally(()=>controllers.delete(controller));
  }
  const adoptionEpoch=epoch;
  return subscribe<T>(entry.promise.then(value=>{if(retired||pendingHolds.size>0||epoch!==adoptionEpoch||isLabel&&entries.get(url)!==entry)throw stale();return value;}),signal);
 }
 function readProfiled<T>(url:string,kind:'quotation'|'product-labels',signal?:AbortSignal):Promise<T>{
  const plain=base+'/'+(kind==='quotation'?'quotation-fields':kind),selected=scope.profileId?plain+`?profileId=${encodeURIComponent(scope.profileId)}`:null;
  // Queryless and explicit profile URLs retain distinct fingerprints/sources.
  if(url===plain)return read<T>(url,kind,signal);
  if(selected!==null&&url===selected)return read<T>(url,kind,signal,scope.profileId);
  return Promise.reject(stale());
 }
 return{
  content:signal=>read<UiContentResponse>(base+'/content','content',signal),
  options:signal=>read<UiOptionsResponse>(base+'/options','options',signal),
  quotation:(url,signal)=>readProfiled<QuotationFieldsView>(url,'quotation',signal),
  hasQuotation:url=>entries.has(url),
  productLabels:(url,signal)=>readProfiled<ProductLabelsView>(url,'product-labels',signal),
  hasProductLabels(url){const entry=entries.get(url);return !!entry&&Date.now()-entry.startedAt<productLabelReuseMs;},
  forgetProductLabels(){for(const url of entries.keys())if(url===base+'/product-labels'||url.startsWith(base+'/product-labels?'))entries.delete(url);},
  canRead:()=>!retired&&pendingHolds.size===0,
  beginMutation(){epoch++;const token={};pendingHolds.add(token);entries.clear();return{confirm(){pendingHolds.delete(token);}};},
  forget(){epoch++;entries.clear();},
  retire(){retired=true;epoch++;entries.clear();},
 };
}
export function usePriceMainUiReads(scope:PriceMainUiScope|null,profileCatalog?:object){
 const [controllers]=useState(()=>new Set<AbortController>()),[pendingHolds]=useState(()=>new Set<object>()),key=scope?JSON.stringify(scope):'';
 const episode=useMemo(()=>({key,profileCatalog}),[key,profileCatalog]);
 const reads=useMemo(()=>episode.key?createRegistrationUiReads(JSON.parse(episode.key) as PriceMainUiScope,controllers,fetch,pendingHolds):null,[episode,controllers,pendingHolds]);
 useLayoutEffect(()=>()=>reads?.retire(),[reads]);
 useEffect(()=>()=>{for(const controller of controllers)controller.abort();controllers.clear();pendingHolds.clear();},[controllers,pendingHolds]);
 return reads;
}
