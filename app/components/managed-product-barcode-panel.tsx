'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {validateManagedProductBarcodeView,type ManagedProductBarcodeView} from '@/app/managed-product-barcode';
import {buildManagedBarcodeOutput,downloadManagedBarcodePng,printManagedBarcode,managedBarcodeDefaults,type ManagedBarcodeSettings} from '@/app/managed-product-barcode-output';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
import './managed-product-barcode-panel.css';

type Props={skuId:string;company:SupplierHubCompany;accountContext:string;onClose:()=>void};
export function ManagedProductBarcodePanel({skuId,company,accountContext,onClose}:Props){
 const scope=JSON.stringify([skuId,company.code,company.name,accountContext]),live=useRef({scope,onClose}),mounted=useRef(true),active=useRef<AbortController|null>(null),lastPrint=useRef<AbortController|null>(null),generation=useRef(0);
 const [snapshot,setSnapshot]=useState<{scope:string;view:ManagedProductBarcodeView}|null>(null),[settings,setSettings]=useState<ManagedBarcodeSettings>({...managedBarcodeDefaults}),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[stale,setStale]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[refresh,setRefresh]=useState(0);
 useLayoutEffect(()=>{live.current={scope,onClose};},[scope,onClose]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;active.current?.abort();lastPrint.current?.abort();};},[]);
 const current=()=>mounted.current&&scope===live.current.scope;
 const endpoint=`/api/managed-products/${encodeURIComponent(skuId)}/barcode?expectedAccountContext=${encodeURIComponent(accountContext)}`;
 async function read(signal:AbortSignal,version?:string){
  const response=await fetch(endpoint+(version?`&expectedSourceVersion=${encodeURIComponent(version)}`:''),{signal,cache:'no-store'}),body=await response.json();signal.throwIfAborted();
  if(!response.ok)throw Error(body&&typeof body==='object'&&'error' in body&&typeof body.error==='string'?body.error:'현재 상품의 바코드를 읽지 못했습니다.');
  return validateManagedProductBarcodeView(body,{skuId,company,accountContext});
 }
 useEffect(()=>{
  const controller=new AbortController();active.current=controller;queueMicrotask(()=>{if(current()){setLoading(true);setBusy(false);setStale(false);setError('');setMessage('');setSnapshot(null);setSettings({...managedBarcodeDefaults});}});
  void(async()=>{try{const view=await read(controller.signal);if(current()&&!controller.signal.aborted){generation.current++;const labelIndex=view.labelInfo.findIndex(label=>label.source==='product');setSettings({...managedBarcodeDefaults,labelIndex:labelIndex<0?null:labelIndex});setSnapshot({scope,view});}}catch(cause){if(current()&&!controller.signal.aborted)setError(cause instanceof Error?cause.message:'바코드를 읽지 못했습니다.');}finally{if(active.current===controller){active.current=null;if(current()&&!controller.signal.aborted)setLoading(false);}}})();return()=>{controller.abort();lastPrint.current?.abort();};
 // The latest account/company/SKU must always be fetched before a preview.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[scope,refresh]);
 const view=snapshot?.scope===scope?snapshot.view:null;
 let output:ReturnType<typeof buildManagedBarcodeOutput>|null=null,configurationError='';
 if(view)try{output=buildManagedBarcodeOutput(view,settings);}catch(cause){configurationError=cause instanceof Error?cause.message:'바코드 출력 설정을 확인해주세요.';}
 const locked=loading||busy||stale||!view,renderedGeneration=generation.current;
 function edit(name:keyof ManagedBarcodeSettings,value:number|null){if(!current()||active.current||locked||renderedGeneration!==generation.current||Object.is(settings[name],value))return;generation.current++;setSettings(previous=>({...previous,[name]:value}));setError('');setMessage('');}
 async function emit(kind:'download'|'print'){
  if(!current()||active.current||locked||!view||!output||renderedGeneration!==generation.current)return;
  const before=view,prepared=output,controller=new AbortController();active.current=controller;setBusy(true);setError('');setMessage('');
  let verified=false;
  try{
   const latest=await read(controller.signal,before.sourceVersion);if(JSON.stringify(latest)!==JSON.stringify(before))throw Error('상품 원본 또는 저장된 표시사항이 변경되었습니다. 다시 조회한 뒤 확인해주세요.');
   if(!current()||controller.signal.aborted||renderedGeneration!==generation.current)return;verified=true;
   if(kind==='print'){lastPrint.current?.abort();lastPrint.current=controller;await printManagedBarcode(prepared,controller.signal);}else await downloadManagedBarcodePng(prepared,`yoofam-plus-${company.code}-sku-${skuId}-barcode.png`,controller.signal);
   if(current()&&!controller.signal.aborted)setMessage(kind==='print'?'바코드 인쇄창을 열었습니다. 크기와 배율을 확인해주세요.':'바코드 PNG 다운로드를 요청했습니다.');
  }catch(cause){if(current()&&!controller.signal.aborted){if(!verified){generation.current++;setStale(true);}setError(cause instanceof Error?cause.message:'출력 결과를 확인하지 못했습니다.');}}
  finally{if(active.current===controller){active.current=null;if(current()&&!controller.signal.aborted)setBusy(false);}}
 }
 const close=()=>{if(!current()||active.current)return;live.current.onClose();};
 return <div className="managed-barcode-overlay"><section className="managed-barcode-dialog" role="dialog" aria-modal="true" aria-label="바코드출력" data-workspace-saving={busy}>
  <header><div><h3>바코드출력</h3><p>{company.name} ({company.code}) · SKU {skuId}</p></div><button type="button" className="icon-close" aria-label="바코드출력 닫기" disabled={loading||busy} onClick={close}>×</button></header>
  {loading&&<p role="status">저장된 바코드를 읽고 있습니다.</p>}{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {view&&<><strong className="managed-barcode-title">{view.product.title}</strong><p className="managed-barcode-code">{view.product.barcode}</p>
   <fieldset disabled={locked} className="managed-barcode-settings"><legend>출력 설정</legend>{([['width','바코드 폭(px)',100,1600],['height','바코드 높이(px)',20,400],['copies','인쇄 수량',1,100],['gap','라벨 간격(px)',0,100]] as const).map(([name,label,min,max])=><label key={name}>{label}<input type="number" aria-label={label} min={min} max={max} step={1} value={Number.isNaN(settings[name])?'':settings[name]} onChange={event=>edit(name,event.target.value===''?NaN:Number(event.target.value))}/></label>)}
    <label className="managed-barcode-label-select">한글표시사항<select aria-label="한글표시사항 선택" value={settings.labelIndex===null?'none':String(settings.labelIndex)} onChange={event=>edit('labelIndex',event.target.value==='none'?null:Number(event.target.value))}><option value="none">바코드·상품명만 출력</option>{view.labelInfo.map((label,index)=><option key={index} value={index}>{label.source==='product'?'상품 원문':label.source==='purchase-info-manual'?'저장한 구매정보':'가져온 구매정보'}{label.index===null?'':` ${label.index+1}`} 표시사항</option>)}</select></label>
   </fieldset>
   {configurationError&&<p role="alert">{configurationError}</p>}
   {output&&<div className="managed-barcode-preview" aria-label="인쇄 라벨 미리보기">{/* The SVG is built from bounded CODE128 coordinates and escaped text only. */}<div role="img" aria-label={`SKU ${skuId} 바코드 미리보기`} dangerouslySetInnerHTML={{__html:output.svg}}/></div>}
   <p className="managed-barcode-note">저장된 바코드와 선택한 표시사항을 출력합니다. 인쇄 수량은 인쇄에 적용되며 PNG는 한 장으로 다운로드합니다.</p>
  </>}
  <footer><button type="button" className="btn ghost" disabled={loading||busy} onClick={close}>닫기</button><button type="button" className="btn ghost" disabled={loading||busy} onClick={()=>{if(current()&&!active.current&&renderedGeneration===generation.current){generation.current++;setRefresh(value=>value+1);}}}>다시 조회</button><button type="button" className="btn ghost" disabled={locked||!output} onClick={()=>void emit('download')}>PNG 다운로드</button><button type="button" className="btn primary" disabled={locked||!output} onClick={()=>void emit('print')}>인쇄</button></footer>
 </section></div>;
}
