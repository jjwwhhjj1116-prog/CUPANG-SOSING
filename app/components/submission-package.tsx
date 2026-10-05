'use client';

import { useEffect, useRef, useState } from 'react';
import { verifyQuotationResultSource, QuotationResultSourceChanged } from '@/app/quotation-result-source';
import { isQuotationFilename } from '@/app/exports/quotation-filename';
import { validatePackageReview, type PackageReview } from '@/app/submission-review-response';
import { QuotationReviewIssues } from '@/app/components/quotation-review-issues';
import type { QuotationNavigationTarget } from '@/app/quotation-navigation';
import { checkSupplierHubExtension, prepareSupplierHubHandoff, transmitSupplierHubPackage, resumeSupplierHubValidation, getSupplierHubResult, getSupplierHubSubmission, validateSupplierHubResultForSource, supplierHubRegistrationEvidence, SupplierHubResultInvalid, type SupplierHubResult, type SupplierHubAgreements } from '@/app/supplier-hub-handoff';
import { followSupplierHubRegistration } from '@/app/supplier-hub-tracking';
import { readStoredSupplierHubResult, storeSupplierHubReceipt, SupplierHubReceiptUnavailable } from '@/app/supplier-hub-receipt-client';
import {LegalDocumentsEditor} from '@/app/components/legal-documents-editor';
import {supplierHubAgreementsReady} from '@/app/supplier-hub-agreements';

type Preview = {
  fingerprint:string; filename:string; headers:string[]; rows:(string|number)[][];
  submissionReview:PackageReview;
  report:{company?:{code:string;name:string}|null;productId:string;categoryId:string|null;profileId:string;rowCount:number;warnings:string[];legalDocuments?:{applicability:'unconfirmed'|'required'|'not-applicable';count:number};publicDetailImages?:{count:number;publishedByThisRequest:false};submissionReady:false};
};

/** Reuses the reviewed XLSX exporter. Preparing or downloading never marks a product submitted. */
export function SubmissionPackage({productId,profileId,categoryId,onInspect,onReceiptSaved}:{productId:string;profileId:string;categoryId:string|null;onInspect:(profileId:string,target:QuotationNavigationTarget)=>void;onReceiptSaved?:()=>void}) {
  const [preview,setPreview]=useState<Preview|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [receiptError,setReceiptError]=useState('');
  const [message,setMessage]=useState('');
  const [hubResult,setHubResult]=useState<SupplierHubResult|null>(null);
  const [agreements,setAgreements]=useState<SupplierHubAgreements>({priceData:false,labelBusinessContact:false,legalDocumentsNotApplicable:false});
  const [attemptedFingerprint,setAttemptedFingerprint]=useState('');
  const [checkedFingerprint,setCheckedFingerprint]=useState('');
  const [tracking,setTracking]=useState(false);
  const [resumableFingerprint,setResumableFingerprint]=useState('');
  const transferAttempted=Boolean(preview&&preview.fingerprint===attemptedFingerprint);
  const submissionChecked=Boolean(preview&&preview.fingerprint===checkedFingerprint);
  const registrationEvidence=supplierHubRegistrationEvidence(hubResult);
  const skuReceiptConfirmed=registrationEvidence.allSkus;
  const rejectedSubmission=hubResult?.state==='validation-rejected'||registrationEvidence.rejected;
  const requiresDocuments=preview?.report.legalDocuments?.applicability==='required';
  const canResumeValidation=Boolean(transferAttempted&&submissionChecked&&preview?.fingerprint===resumableFingerprint&&(!hubResult||hubResult.state==='not-found'));
  const active=useRef<AbortController|null>(null);
  const receiptNotice=useRef('');
  useEffect(()=>()=>active.current?.abort(),[]);
  function pauseTracking(){
    active.current?.abort();active.current=null;setBusy(false);setTracking(false);
    setMessage('결과 확인을 일시정지했습니다. 전달한 파일은 유지됩니다.');
  }
  async function restoreSubmission(value:Preview,controller:AbortController){
    if(!categoryId||!value.report.company||!value.filename.endsWith('.xlsx'))return;
    const source={productId,categoryId,profileId:value.report.profileId,fingerprint:value.fingerprint,filename:value.filename};
    await verifyQuotationResultSource(source,controller.signal);
    if(controller.signal.aborted)return;
    let stored:SupplierHubResult|null=null,unavailable:SupplierHubReceiptUnavailable|null=null;
    try{
      stored=await readStoredSupplierHubResult({...source,company:value.report.company,includedOptions:value.report.rowCount},controller.signal);
    }catch(cause){
      if(!(cause instanceof SupplierHubReceiptUnavailable))throw cause;
      unavailable=cause;
    }
    await verifyQuotationResultSource(source,controller.signal);
    if(controller.signal.aborted)return;
    if(stored){
      setResumableFingerprint('');
      setAttemptedFingerprint(value.fingerprint);setHubResult(stored);setCheckedFingerprint(value.fingerprint);
      setMessage('보관된 전송 결과를 불러왔습니다. 재전송 없이 결과 확인을 이어갈 수 있습니다.');return;
    }
    const saved=await getSupplierHubSubmission({productId,categoryId,fingerprint:value.fingerprint},controller.signal);
    await verifyQuotationResultSource(source,controller.signal);
    if(controller.signal.aborted)return;
    if(saved.attempt&&(saved.attempt.company.code!==value.report.company.code||saved.attempt.company.name!==value.report.company.name||saved.attempt.includedOptions!==value.report.rowCount))
      throw new Error('저장된 전송 기록의 회사와 옵션 수가 현재 견적서와 다릅니다.');
    if(saved.result)validateSupplierHubResultForSource(saved.result,{filename:value.filename,company:value.report.company,includedOptions:value.report.rowCount});
    // An unavailable server never proves that this quotation has not been sent.
    if(unavailable){setReceiptError(unavailable.message);if(!saved.attempt&&!saved.result)throw unavailable;}
    if(saved.attempt||saved.result){
      setResumableFingerprint(saved.attempt?.validationResume===true&&['attached','unconfirmed'].includes(saved.attempt.state)&&(!saved.result||saved.result.state==='not-found')?value.fingerprint:'');
      setAttemptedFingerprint(value.fingerprint);setHubResult(saved.result);
      setMessage(saved.attempt?.error||'이 견적서의 이전 전송 기록을 불러왔습니다. 재전송 없이 결과 확인을 이어갈 수 있습니다.');
      if(unavailable&&saved.result)await retainResult(value,saved.result,controller);
    }
    if(controller.signal.aborted)return;
    setCheckedFingerprint(value.fingerprint);
  }
  async function retainResult(value:Preview,result:SupplierHubResult|null,controller:AbortController){
    if(!result||result.state==='not-found'||!categoryId||!value.report.company)return;
    try{
      await storeSupplierHubReceipt({productId,profileId:value.report.profileId,categoryId,fingerprint:value.fingerprint,
        filename:value.filename,company:value.report.company,includedOptions:value.report.rowCount},result,controller.signal);
      setReceiptError('');
      const notice=JSON.stringify([value.fingerprint,result.state,result.quotationId,result.registration?.rows.map(row=>[row.skuId,row.status,row.stage])]);
      if(!controller.signal.aborted&&receiptNotice.current!==notice){receiptNotice.current=notice;onReceiptSaved?.();}
    }catch(cause){
      if(controller.signal.aborted)return;
      // Keep the Chrome result and duplicate-upload guard even if D1 is temporarily unavailable.
      if(cause instanceof QuotationResultSourceChanged)throw cause;
      setReceiptError(cause instanceof Error?cause.message:'전송 결과 보관에 실패했습니다. 파일 재전송 없이 결과 조회를 다시 실행해주세요.');
    }
  }
  async function followResults(controller:AbortController,initialResult:SupplierHubResult|null=hubResult){
    if(!preview?.report.company||!categoryId)throw new Error('등록할 회사와 카테고리를 확인해주세요.');
    setTracking(true);
    try{
      const outcome=await followSupplierHubRegistration({productId,categoryId,profileId:preview.report.profileId,
        fingerprint:preview.fingerprint,filename:preview.filename,includedOptions:preview.report.rowCount,company:preview.report.company},
      {signal:controller.signal,initialResult,onRetry:retry=>{
        if(controller.signal.aborted)return;
        setMessage(`Supplier Hub ${retry.phase==='validation-pending'?'검증 결과':'상품별 등록 결과'} 응답이 늦어 ${Math.ceil(retry.delayMs/1000)}초 후 다시 확인합니다 (${retry.attempt}/${retry.maxAttempts}).`);
      },onProgress:async progress=>{
        if(controller.signal.aborted)return;
        setHubResult(progress.result);
        setMessage(progress.phase==='validation-pending'?'Supplier Hub에서 견적서 파일을 검증하고 있습니다.':
          progress.phase==='registration-pending'?`견적서 ID를 확인했습니다. 상품별 SKU를 확인하고 있습니다 (${progress.issuedSkus}/${progress.includedOptions}개).`:
          progress.phase==='sku-issued'?`전송한 옵션 수와 같은 ${progress.issuedSkus}개의 SKU ID를 확인했습니다. 아래에서 Supplier Hub 검수 상태를 확인하세요.`:'');
        await retainResult(preview,progress.result,controller);
      }});
      if(controller.signal.aborted)return;
      if(outcome.phase==='validation-rejected'||outcome.phase==='registration-rejected')setError(outcome.result?.detail||'Supplier Hub 반려 결과를 확인하고 견적서를 수정해주세요.');
      else if(outcome.timedOut)setMessage('Supplier Hub 처리가 아직 진행 중입니다. 전송 결과 계속 확인으로 조회를 이어갈 수 있습니다.');
    }finally{if(!controller.signal.aborted)setTracking(false);}
  }
  async function run(action:'preview'|'export'|'download'|'handoff'|'transmit'|'resume-validation'|'result'|'registration'|'track'|'recover') {
    if(active.current || (action!=='preview'&&!preview))return;
    const controller=new AbortController();active.current=controller;
    setBusy(true);setError('');setReceiptError('');setMessage('');
    if(action==='preview'){setPreview(null);setCheckedFingerprint('');setHubResult(null);setResumableFingerprint('');setAgreements({priceData:false,labelBusinessContact:false,legalDocumentsNotApplicable:false});}
    try {
      if(action==='recover'){setCheckedFingerprint('');await restoreSubmission(preview!,controller);return;}
      if(action==='track'){await followResults(controller);return;}
      if(action==='resume-validation'){
        if(!canResumeValidation||!categoryId||!preview!.report.company||!supplierHubAgreementsReady(agreements,requiresDocuments))throw Error('원래 첨부한 견적서와 필수 선택값을 확인해주세요.');
        await verifyQuotationResultSource({productId,categoryId,profileId:preview!.report.profileId,fingerprint:preview!.fingerprint,filename:preview!.filename},controller.signal);
        if(controller.signal.aborted)return;
        const outcome=await resumeSupplierHubValidation({productId,categoryId,fingerprint:preview!.fingerprint},agreements,controller.signal);
        if(controller.signal.aborted)return;
        if(outcome.state!=='validation-requested'){
          if(outcome.state==='unconfirmed')setResumableFingerprint('');
          setError(outcome.error||'Supplier Hub 첨부 목록과 필수 항목을 확인해주세요.');return;
        }
        setResumableFingerprint('');setMessage('기존 첨부 파일로 검증 요청을 확인했습니다. 전송 결과를 조회합니다.');
        await followResults(controller,null);return;
      }
      if(action==='result'||action==='registration'){
        if(!categoryId||!preview!.report.company)throw new Error('등록할 회사와 카테고리를 먼저 확인해주세요.');
        if(action==='registration'&&(hubResult?.state!=='validation-complete'||!hubResult.quotationId))throw new Error('견적서 파일 검증 완료 결과와 견적서 ID를 먼저 확인해주세요.');
        const quotationId=hubResult?.state==='validation-complete'?hubResult.quotationId:undefined;
        await verifyQuotationResultSource({productId,categoryId,profileId:preview!.report.profileId,fingerprint:preview!.fingerprint,filename:preview!.filename},controller.signal);
        if(controller.signal.aborted)return;
        let result=await getSupplierHubResult({productId,categoryId,fingerprint:preview!.fingerprint},controller.signal,action==='registration'?'registration':true);
        await verifyQuotationResultSource({productId,categoryId,profileId:preview!.report.profileId,fingerprint:preview!.fingerprint,filename:preview!.filename},controller.signal);
        if(!controller.signal.aborted){
          if(result){validateSupplierHubResultForSource(result,{filename:preview!.filename,company:preview!.report.company,includedOptions:preview!.report.rowCount,quotationId});setAttemptedFingerprint(preview!.fingerprint);}
          // This Chrome may have fewer cached SKU rows than the restored server
          // receipt. A file-only refresh does not re-observe those rows or their time.
          if(action==='result'&&result?.state==='validation-complete'&&hubResult?.state==='validation-complete'
            &&hubResult.registration&&hubResult.quotationId===result.quotationId
            &&(!result.registration||result.registration.observedAt<hubResult.registration.observedAt))
            result={...result,registration:hubResult.registration};
          setHubResult(result);if(!result)setMessage('이 견적서의 검증 결과가 아직 표시되지 않았습니다. 잠시 후 다시 확인해주세요.');
          await retainResult(preview!,result,controller);
        }
        return;
      }
      if(action==='handoff'||action==='transmit'){
        if(!categoryId||!preview?.filename.endsWith('.xlsx'))throw new Error('선택한 카테고리의 Excel 양식으로 견적서를 준비해주세요.');
        if(action==='transmit'&&(transferAttempted||!supplierHubAgreementsReady(agreements,requiresDocuments)))throw new Error('전송 시도와 필수 선택값을 확인해주세요.');
        if(!submissionChecked)throw new Error('이 견적서의 이전 전송 기록을 먼저 확인해주세요.');
        await checkSupplierHubExtension(controller.signal,action==='transmit');
      }
      const response=await fetch(`/api/products/${encodeURIComponent(productId)}/quotation`,{
        method:'POST',signal:controller.signal,headers:{'content-type':'application/json'},
        body:JSON.stringify({action:action==='handoff'||action==='transmit'?'export':action,...(profileId?{profileId}:{}),...(action!=='preview'?{fingerprint:preview!.fingerprint}:{})}),
      });
      if(!response.ok){
        const body=await response.json() as {error?:string};
        if(response.status===409)setPreview(null);
        throw new Error(typeof body?.error==='string'?body.error:'견적서 파일을 준비하지 못했습니다.');
      }
      if(action==='preview'){
        const data=await response.json() as Preview;
        if(!data || !/^[a-f0-9]{64}$/.test(data.fingerprint) || data.report?.productId!==productId
          || !isQuotationFilename(data.filename) || !data.filename.startsWith(`YOOFAM-${data.fingerprint}.`)
          || data.report.categoryId!==categoryId || data.report.submissionReady!==false
          || typeof data.report.profileId!=='string' || (profileId&&data.report.profileId!==profileId)
          || !Array.isArray(data.headers) || !data.headers.every(value=>typeof value==='string')
          || !Array.isArray(data.rows) || !data.rows.every(row=>Array.isArray(row)&&row.every(value=>typeof value==='string'||typeof value==='number'))
          || data.report.rowCount!==data.rows.length || !Array.isArray(data.report.warnings) || !data.report.warnings.every(value=>typeof value==='string')){
          throw new Error('검사한 상품·카테고리와 출력 자료가 다릅니다. 자료를 다시 검사해주세요.');
        }
        const submissionReview=validatePackageReview(data.submissionReview,productId,categoryId,data.fingerprint);
        if(!controller.signal.aborted){const value={...data,submissionReview};setPreview(value);await restoreSubmission(value,controller);}
      }else{
        if(action==='download'){
          const extension=preview!.filename.split('.').at(-1);
          const mime=extension==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':extension==='csv'?'text/csv':'text/tab-separated-values';
          if(response.headers.get('content-type')?.split(';')[0]!==mime
            || response.headers.get('x-quotation-fingerprint')!==preview!.fingerprint
            || response.headers.get('content-disposition')!==`attachment; filename="${preview!.filename}"`)throw new Error('검토한 견적서와 다운로드 파일이 일치하지 않습니다. 다시 준비해주세요.');
        }else if(!response.headers.get('content-type')?.startsWith('application/zip'))throw new Error('견적서 ZIP 응답을 확인하지 못했습니다.');
        const blob=await response.blob();if(controller.signal.aborted)return;
        if(action==='transmit'||action==='handoff'){
          await verifyQuotationResultSource({productId,categoryId:categoryId!,profileId:preview!.report.profileId,fingerprint:preview!.fingerprint,filename:preview!.filename},controller.signal);
          if(controller.signal.aborted)return;
        }
        if(action==='transmit'){
          setAttemptedFingerprint(preview!.fingerprint);setHubResult(null);
          const identity={productId,categoryId:categoryId!,fingerprint:preview!.fingerprint};
          const outcome=await transmitSupplierHubPackage(blob,identity,agreements,controller.signal);
          if(controller.signal.aborted)return;
          setResumableFingerprint(['attached','unconfirmed'].includes(outcome.state)?preview!.fingerprint:'');
          if(outcome.state==='not-started'){
            setAttemptedFingerprint('');setError(outcome.error||'파일 전달이 시작되지 않았습니다. Supplier Hub 화면을 확인해주세요.');return;
          }
          if(outcome.state!=='validation-requested'){
            setError(outcome.error||'전송 일부만 확인했습니다. Supplier Hub 첨부 목록을 확인해주세요.');
            setMessage('같은 견적서를 다시 첨부하지 않습니다. 전달된 파일과 검증 상태를 확인해주세요.');return;
          }
          setMessage('견적서·상품 이미지·라벨을 전달하고 파일 검증을 요청했습니다.');
          await followResults(controller,null);
          return;
        }
        if(action==='handoff'){
          await prepareSupplierHubHandoff(blob,{productId,categoryId:categoryId!,fingerprint:preview!.fingerprint},controller.signal);
          if(!controller.signal.aborted)setMessage('확장에 견적서와 첨부 파일을 준비했습니다. 같은 Chrome의 Supplier Hub 대량 등록 탭에서 확장을 눌러 파일을 전달하세요. 아직 등록되지 않았습니다.');
          return;
        }
        const url=URL.createObjectURL(blob);const anchor=document.createElement('a');
        anchor.href=url;anchor.download=action==='download'?preview!.filename:`YOOFAM-PLUS-quotation-${productId}.zip`;anchor.click();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
        setMessage(action==='download'?'검토한 견적서 파일을 내려받았습니다.':'작성된 견적서와 첨부 파일을 내려받았습니다. Supplier Hub 등록은 아직 실행되지 않았습니다.');
      }
    }catch(cause){if(!controller.signal.aborted){if(cause instanceof QuotationResultSourceChanged){setPreview(null);setCheckedFingerprint('');setHubResult(null);setResumableFingerprint('');}else if(cause instanceof SupplierHubResultInvalid){setHubResult(null);}setError(cause instanceof Error?cause.message:'견적서 준비 실패');}}
    finally{if(active.current===controller){active.current=null;if(!controller.signal.aborted)setBusy(false);}}
  }
  return <section className="panel-stack" aria-label="견적서와 첨부 파일 준비" aria-busy={busy}>
    <LegalDocumentsEditor productId={productId} disabled={busy||transferAttempted&&!rejectedSubmission} onSaved={()=>{setPreview(null);setCheckedFingerprint('');setHubResult(null);setAgreements({priceData:false,labelBusinessContact:false,legalDocumentsNotApplicable:false});setMessage('서류를 저장했습니다. 견적서와 첨부 파일을 다시 준비해주세요.');}}/>
    <button type="button" className="btn primary" disabled={busy} onClick={()=>void run('preview')}>{tracking?'등록 결과 확인 중…':busy?'견적서 준비 중…':'견적서 + 첨부 파일 준비'}</button>
    {tracking&&<button type="button" className="btn ghost" onClick={pauseTracking}>결과 확인 일시정지</button>}
    {error&&<p role="alert">{error}</p>}{receiptError&&<p role="alert">{receiptError}</p>}{message&&<p role="status">{message}</p>}
    {preview&&<>
      {preview.report.company&&<p>등록 회사: {preview.report.company.name} · {preview.report.company.code}</p>}
      {preview.report.company===null&&<p role="alert">계정 관리에서 승인된 회사정보를 확인한 뒤 견적서를 다시 준비해주세요.</p>}
      <strong>저장된 양식으로 작성한 견적서 · {preview.report.rowCount}행</strong>
      <p style={{overflowWrap:'anywhere'}}>견적서 파일명: {preview.filename}</p>
      <strong>첨부 파일 검사 · 수정 필요 {preview.submissionReview.errorCount}개 · 확인 {preview.submissionReview.reviewCount}개</strong>
      <QuotationReviewIssues key={preview.fingerprint} issues={preview.submissionReview.issues} omittedIssueCount={preview.submissionReview.omittedIssueCount} disabled={busy} onInspect={target=>onInspect(preview.report.profileId,{...target,categoryId})}/>
      <details><summary>Excel 입력값 확인</summary><div className="table-wrap"><table><thead><tr>{preview.headers.map((header,index)=><th key={index}>{header||`${index+1}열`}</th>)}</tr></thead><tbody>{preview.rows.map((row,index)=><tr key={index}>{row.map((cell,column)=><td key={column}>{String(cell)||'—'}</td>)}</tr>)}</tbody></table></div></details>
      <details><summary>양식·첨부 확인 항목 ({preview.report.warnings.length})</summary><ul>{preview.report.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></details>
      <p>ZIP에는 작성된 Excel/CSV, 상품 이미지, 라벨과 업로드 준비 목록이 포함됩니다. 검토 후 저장값이 바뀌면 다시 준비해야 합니다.</p>
      <fieldset disabled={busy||transferAttempted&&!canResumeValidation||!submissionChecked} className="panel-stack"><legend>Supplier Hub 필수 선택</legend>
        <label><input type="checkbox" checked={agreements.priceData} onChange={event=>setAgreements(value=>({...value,priceData:event.target.checked}))}/> 제공된 권장소비자가격 또는 공식 판매처 가격 데이터에 대한 쿠팡 약관에 동의합니다.</label>
        <label><input type="checkbox" checked={agreements.labelBusinessContact} onChange={event=>setAgreements(value=>({...value,labelBusinessContact:event.target.checked}))}/> 상품 라벨 내 기재된 (010 이하) 연락처는 법인 명의 개통 번호이거나, 해당 브랜드의 공식 대외 창구로 지정된 업무용 연락처에 해당함을 확인하며, 당사는 해당 정보가 대외적으로 공개됨에 동의합니다.</label>
        {requiresDocuments?<label><input type="checkbox" checked={agreements.legalDocumentsRequired===true} onChange={event=>setAgreements(value=>({...value,legalDocumentsNotApplicable:false,legalDocumentsRequired:event.target.checked}))}/> 상품 개별법령에 따른 필수 서류: 해당함 · 원본 {preview.report.legalDocuments?.count}개를 확인했습니다.</label>:<label><input type="checkbox" checked={agreements.legalDocumentsNotApplicable} onChange={event=>setAgreements(value=>({...value,legalDocumentsNotApplicable:event.target.checked}))}/> 상품 개별법령에 따른 필수 서류: 해당없음</label>}
        <small>{requiresDocuments?'확인한 원본 서류를 견적서·이미지·라벨과 함께 전달합니다.':'서류가 필요한 상품은 위 법적 필수서류에서 원본을 첨부하고 견적서를 다시 준비하세요.'}</small>
      </fieldset>
      <button type="button" className="btn rose" disabled={busy||transferAttempted||!submissionChecked||preview.report.company==null||!categoryId||!preview.filename.endsWith('.xlsx')||preview.submissionReview.errorCount>0||!supplierHubAgreementsReady(agreements,requiresDocuments)} onClick={()=>void run('transmit')}>{transferAttempted?'전송 시도됨 · 검증 결과 확인':'등록 전송'}</button>
      {canResumeValidation&&<button type="button" className="btn primary" disabled={busy||!supplierHubAgreementsReady(agreements,requiresDocuments)} onClick={()=>void run('resume-validation')}>첨부 파일 확인 후 검증 재개</button>}
      {!submissionChecked&&preview.report.company&&categoryId&&preview.filename.endsWith('.xlsx')&&<button type="button" className="btn ghost" disabled={busy} onClick={()=>void run('recover')}>전송 기록 다시 확인</button>}
      <p>이 앱과 같은 Chrome 창에 회사코드가 일치하는 Supplier Hub 대시보드 또는 대량 상품 등록 탭을 열어두세요. 등록 전송을 누르면 필요한 새 등록 탭을 준비합니다.</p>
      {!!preview.report.publicDetailImages?.count && <p>견적서 다운로드·첨부 준비·등록전송 시 상세 이미지 {preview.report.publicDetailImages.count}장의 공개 주소를 만듭니다. 해당 주소를 가진 사람은 이미지를 볼 수 있습니다.</p>}
      <button type="button" className="btn primary" disabled={busy} onClick={()=>void run('download')}>견적서 파일 다운로드</button>
      <button type="button" className="btn primary" disabled={busy} onClick={()=>void run('export')}>확인한 견적서 + 첨부 ZIP 다운로드</button>
      <button type="button" className="btn ghost" disabled={busy||transferAttempted||!submissionChecked||preview.report.company==null||!categoryId||!preview.filename.endsWith('.xlsx')||preview.submissionReview.errorCount>0} onClick={()=>void run('handoff')}>확장에 첨부 파일 준비</button>
      <button type="button" className="btn ghost" disabled={busy||preview.report.company===null||!categoryId||!preview.filename.endsWith('.xlsx')} onClick={()=>void run('result')}>Supplier Hub 검증 결과 불러오기</button>
      {(transferAttempted||hubResult)&&<button type="button" className="btn primary" disabled={busy||!preview.report.company||!categoryId||!preview.filename.endsWith('.xlsx')} onClick={()=>void run('track')}>전송 결과 계속 확인</button>}
      <button type="button" className="btn primary" disabled={busy||!categoryId||hubResult?.state!=='validation-complete'||!hubResult.quotationId} onClick={()=>void run('registration')}>견적서 ID로 상품별 등록 상태 조회</button>
      {hubResult&&<div role="status"><strong>{hubResult.state==='not-found'?'검증 목록에서 아직 찾지 못했습니다.':`견적서 검증: ${hubResult.status||'상태 미표시'}`}</strong><p>견적서 ID: {hubResult.quotationId||'미표시'} · 결과 확인 시각: {new Date(hubResult.observedAt).toLocaleString('ko-KR')}</p>{hubResult.detail&&<p>{hubResult.detail}</p>}<p>{skuReceiptConfirmed?'전송한 옵션 수와 동일한 수의 고유 SKU ID가 조회됐습니다. 상품 검수 결과는 아래 상태를 기준으로 확인하세요.':'현재 검토한 견적서 파일의 결과입니다. 상품별 등록 완료는 아직 확인되지 않았습니다.'}</p></div>}
      {hubResult?.registration?.includedOptions!==undefined&&<p role="status">초안 포함 옵션 {hubResult.registration.includedOptions}개 · Supplier Hub 조회 {hubResult.registration.rows.length}개{hubResult.registration.scope==='queried-pages'?` · ${hubResult.registration.pagesRead}페이지 대조`: ' · 현재 페이지'}.</p>}
      {hubResult?.registration&&<div className="panel-stack">
        <strong>상품별 등록 상태 · 조회 {hubResult.registration.rows.length}개</strong>
        <p>확인 시각: {new Date(hubResult.registration.observedAt).toLocaleString('ko-KR')} · 견적서 ID: {hubResult.registration.quotationId}</p>
        {hubResult.registration.rows.length?<div className="table-wrap"><table><thead><tr><th>상품명</th><th>SKU ID</th><th>상태</th><th>등록 진행 단계</th></tr></thead><tbody>{hubResult.registration.rows.map((row,index)=><tr key={index}><td>{row.title}</td><td>{row.skuId||'—'}</td><td>{row.status}</td><td>{row.stage}</td></tr>)}</tbody></table></div>:<p>이 견적서 ID로 조회된 상품이 없습니다. 처리 중이면 잠시 후 다시 조회해주세요.</p>}
        {hubResult.registration.scope==='visible-page'?<small>현재 페이지의 결과입니다. 다른 페이지의 옵션은 아직 대조되지 않았습니다.</small>:
          <small>{hubResult.registration.hasMore===true?'다음 페이지가 남아 있습니다. 결과를 계속 확인해주세요.':hubResult.registration.hasMore===null?'추가 페이지 유무를 확인하지 못했습니다. Supplier Hub 결과 표를 확인해주세요.':'마지막 페이지까지 조회했습니다.'} 상품 검수 완료 여부는 각 행의 상태를 확인하세요.</small>}
      </div>}
      <a href="/downloads/yoofam-plus-supplier-hub-extension-0.2.49.zip" download>Chrome 상품 수집·전송 확장 다운로드 (0.2.49)</a>
    </>}
  </section>;
}
