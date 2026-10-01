import { getSupplierHubResult, validateSupplierHubResultForSource, validateRegistrationResult, supplierHubRegistrationEvidence, SupplierHubResultInvalid, type SupplierHubResult } from '@/app/supplier-hub-handoff';
import { verifyQuotationResultSource } from '@/app/quotation-result-source';

export type SupplierHubTrackingSource = {
  productId:string; categoryId:string; profileId:string; fingerprint:string; filename:string;
  includedOptions:number; company:{code:string;name:string};
};
export type SupplierHubTrackingPhase = 'validation-pending'|'validation-rejected'|'registration-pending'|'registration-rejected'|'sku-issued';
export type SupplierHubTrackingProgress = {
  phase:SupplierHubTrackingPhase; result:SupplierHubResult|null; includedOptions:number;
  observedRows:number; issuedSkus:number;
};
export type SupplierHubTrackingOutcome = SupplierHubTrackingProgress & { timedOut:boolean; registered:false };

/** Read-only follow-up to one accepted upload. This never attaches or resubmits files. */
export async function followSupplierHubRegistration(prepared:SupplierHubTrackingSource,options:{
  signal:AbortSignal; onProgress?:(progress:SupplierHubTrackingProgress)=>void|Promise<void>;
  initialResult?:SupplierHubResult|null;
  read?:typeof getSupplierHubResult; verify?:typeof verifyQuotationResultSource;
  wait?:(ms:number,signal:AbortSignal)=>Promise<void>; now?:()=>number;
  maxDurationMs?:number;
}):Promise<SupplierHubTrackingOutcome>{
  const allowedCompany=prepared.company?.code==='A01464742'&&prepared.company.name==='와이홉'
    ||prepared.company?.code==='A01526306'&&prepared.company.name==='유앤채';
  if(!allowedCompany||!Number.isSafeInteger(prepared.includedOptions)||prepared.includedOptions<1||prepared.includedOptions>200
    ||!prepared.productId||!prepared.categoryId||!prepared.profileId||!/^[a-f0-9]{64}$/.test(prepared.fingerprint)
    ||prepared.filename!==`YOOFAM-${prepared.fingerprint}.xlsx`)throw new Error('검토한 견적서의 회사·양식·옵션 수를 확인해주세요.');
  const duration=options.maxDurationMs??2*60*60*1000;
  if(!Number.isFinite(duration)||duration<=0||duration>2*60*60*1000)throw new Error('등록 결과 확인 시간을 확인해주세요.');
  const read=options.read??getSupplierHubResult,verify=options.verify??verifyQuotationResultSource;
  const now=options.now??Date.now,wait=options.wait??waitForNextLookup,start=now();
  const identity={productId:prepared.productId,categoryId:prepared.categoryId,fingerprint:prepared.fingerprint};
  const validateResult=(result:SupplierHubResult,quotationId?:string)=>{
    if(result.company?.code!==prepared.company.code||result.company?.name!==prepared.company.name
      ||result.includedOptions!==prepared.includedOptions)throw new SupplierHubResultInvalid('전송한 견적서의 회사 또는 옵션 수가 조회 결과와 다릅니다.');
    if(!['not-found','validation-pending','validation-complete','validation-rejected'].includes(result.state)
      ||!Number.isSafeInteger(result.observedAt)||result.observedAt<=0||result.observedAt>Date.now()+60000)
      throw new SupplierHubResultInvalid('현재 견적서의 검증 결과와 조회 시각을 확인하지 못했습니다.');
    if(quotationId&&result.state!=='validation-complete')throw new SupplierHubResultInvalid('상품별 조회 중 파일 검증 상태가 변경되었습니다.');
    if(Array.isArray(result.registration?.rows)&&result.registration.rows.length>prepared.includedOptions)
      throw new SupplierHubResultInvalid('조회된 상품 수가 전송한 옵션 수보다 많습니다.');
    validateSupplierHubResultForSource(result,{...prepared,...(quotationId?{quotationId}:{})});
    if(result.state==='validation-complete'&&(typeof result.quotationId!=='string'||!result.quotationId.trim()
      ||result.quotationId!==result.quotationId.trim()||result.quotationId.length>200))
      throw new SupplierHubResultInvalid('파일 검증 완료 결과에 견적서 ID가 없습니다.');
    if(result.registration){
      if(result.state!=='validation-complete')throw new SupplierHubResultInvalid('상품별 조회 중 파일 검증 상태가 변경되었습니다.');
      validateRegistrationResult(result.registration,result.quotationId);
    }
  };
  if(options.initialResult)validateResult(options.initialResult);
  // A restored receipt anchors the next fresh lookup, but its rows never count as a new observation.
  let quotationId=options.initialResult?.state==='validation-complete'?options.initialResult.quotationId!:'',
    mode:boolean|'registration'=quotationId?'registration':true;
  let progress:SupplierHubTrackingProgress={phase:'validation-pending',result:null,includedOptions:prepared.includedOptions,observedRows:0,issuedSkus:0};
  const checkCancelled=()=>{if(options.signal.aborted)throw new Error('등록 결과 확인을 중단했습니다.');};
  const publish=async()=>{checkCancelled();await options.onProgress?.(progress);checkCancelled();};
  const outcome=(timedOut=false):SupplierHubTrackingOutcome=>({...progress,timedOut,registered:false});
  const delays=[3000,5000,10000,15000,30000];
  // Time and request limits also bound unexpectedly immediate or changing replies.
  for(let attempt=0;attempt<300;attempt++){
    checkCancelled();
    if(attempt&&now()-start>=duration)return outcome(true);
    await verify(prepared,options.signal);checkCancelled();
    const result=await read(identity,options.signal,mode);checkCancelled();
    // Editing while Chrome is reading must not publish evidence for the old draft.
    await verify(prepared,options.signal);checkCancelled();
    if(result)validateResult(result,quotationId||undefined);
    // A file-only refresh cannot promote an older cached per-SKU lookup.
    const observation=mode==='registration'||!result?result:{...result,registration:undefined};
    progress={phase:'validation-pending',result:observation,includedOptions:prepared.includedOptions,observedRows:0,issuedSkus:0};
    if(result?.state==='validation-rejected'){
      progress.phase='validation-rejected';await publish();return outcome();
    }
    if(result?.state==='validation-complete'){
      quotationId=result.quotationId!;
      progress.phase='registration-pending';
      if(mode==='registration'){
        const registration=result.registration;
        if(!registration||registration.quotationId!==quotationId||registration.includedOptions!==prepared.includedOptions
          ||!['visible-page','queried-pages'].includes(registration.scope)||registration.registered!==false)throw new Error('이 견적서의 상품별 조회 결과를 확인하지 못했습니다.');
        const evidence=supplierHubRegistrationEvidence(result);
        if(evidence.duplicateSkus)throw new SupplierHubResultInvalid('같은 SKU ID가 중복되어 옵션별 결과를 확인하지 못했습니다.');
        progress.observedRows=evidence.observedRows;progress.issuedSkus=evidence.issuedSkus;
        if(evidence.rejected){
          progress.phase='registration-rejected';await publish();return outcome();
        }
        // SKU issuance is a receipt observation, not approval or final registration.
        if(evidence.allSkus){
          progress.phase='sku-issued';await publish();return outcome();
        }
      }
      await publish();
      if(mode!== 'registration'){mode='registration';continue;}
    }else{
      if(mode==='registration')throw new Error('상품별 조회 중 파일 검증 상태가 변경되었습니다.');
      await publish();
    }
    const remaining=duration-(now()-start);
    if(remaining<=0)return outcome(true);
    await wait(Math.min(delays[Math.min(attempt,delays.length-1)],remaining),options.signal);checkCancelled();
  }
  return outcome(true);
}

export function waitForNextLookup(ms:number,signal:AbortSignal):Promise<void>{
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new Error('등록 결과 확인을 중단했습니다.'));return;}
    const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new Error('등록 결과 확인을 중단했습니다.'));};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
    signal.addEventListener('abort',abort,{once:true});
  });
}
