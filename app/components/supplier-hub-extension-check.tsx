'use client';

import {useEffect,useState} from 'react';
import {readSupplierHubExtensionInfo,type SupplierHubExtensionInfo} from '@/app/supplier-hub-handoff';

/** A local, read-only check inside the existing settings dialog. The ZIP label
 * is never evidence that this Chrome has installed that version. */
export function SupplierHubExtensionCheck(){
  const [attempt,setAttempt]=useState(0);
  const [info,setInfo]=useState<SupplierHubExtensionInfo|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    const controller=new AbortController();
    void readSupplierHubExtensionInfo(controller.signal).then(value=>{
      if(!controller.signal.aborted)setInfo(value);
    }).catch(cause=>{
      if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'현재 Chrome 확장을 확인하지 못했습니다.');
    }).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[attempt]);
  const needsResultsUpdate=Boolean(info&&(!info.pendingReceiptRefreshRecovery||!info.registrationObservationCas||info.originalFileObservationCas!==true||!info.productTransmissionHistory||!info.historicalReceiptLookup||!info.exactAgreementLabels));
  const needsUpdate=needsResultsUpdate||Boolean(info&&(info.version.localeCompare('2.1.46','en',{numeric:true})<0||!info.publicSingleSkuCapture||!info.companyRegistrationStatus));
  return <section aria-label="설치된 Chrome 확장" aria-busy={loading}>
    <h3>Chrome 상품 수집·전송 확장</h3>
    {loading&&<p role="status">현재 Chrome의 확장을 확인하는 중입니다.</p>}
    {info&&<dl className="connection-list"><div><dt>설치된 버전</dt><dd>{info.version}</dd></div><div><dt>전송 결과 조회</dt><dd>{needsResultsUpdate?'확장 업데이트 필요':'검증 결과 복구·SKU 결과 보존 지원'}</dd></div><div><dt>1688 단일 상품 수집</dt><dd>{info.publicSingleSkuCapture?'옵션 속성이 없는 단일 SKU 지원':'단일 SKU 수집은 확장 업데이트 필요'}</dd></div><div><dt>회사 상품 등록 상태</dt><dd>{info.companyRegistrationStatus?'기간·검수상태·상품명 조회 지원':'등록 상태 조회는 확장 업데이트 필요'}</dd></div></dl>}
    {info&&<p>확장 업데이트 후에는 열려 있던 1688 상품 탭도 새로고침해주세요. 최신 버전에서는 상품 수집 버튼 위에 ‘수집기 2.1.46’가 표시되며, 수집 후 서버에 저장된 수집본 번호와 시각을 확인할 수 있습니다.</p>}
    {error&&<p role="status">{error}</p>}
    <div className="modal-actions"><button type="button" className="btn ghost" disabled={loading} onClick={()=>{setLoading(true);setInfo(null);setError('');setAttempt(value=>value+1);}}>설치된 확장 다시 확인</button>{(needsUpdate||error)&&<a className="btn ghost" href="/downloads/yoofam-plus-supplier-hub-extension-2.1.46.zip" download>확장 2.1.46 다운로드</a>}</div>
  </section>;
}
