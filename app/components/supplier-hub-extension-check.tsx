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
  const needsUpdate=Boolean(info&&(!info.pendingReceiptRefreshRecovery||!info.registrationObservationCas||!info.productTransmissionHistory||!info.historicalReceiptLookup));
  return <section aria-label="설치된 Chrome 확장" aria-busy={loading}>
    <h3>Chrome 상품 수집·전송 확장</h3>
    {loading&&<p role="status">현재 Chrome의 확장을 확인하는 중입니다.</p>}
    {info&&<dl className="connection-list"><div><dt>설치된 버전</dt><dd>{info.version}</dd></div><div><dt>전송 결과 조회</dt><dd>{needsUpdate?'확장 업데이트 필요':'검증 결과 복구·SKU 결과 보존 지원'}</dd></div></dl>}
    {error&&<p role="status">{error}</p>}
    <div className="modal-actions"><button type="button" className="btn ghost" disabled={loading} onClick={()=>{setLoading(true);setInfo(null);setError('');setAttempt(value=>value+1);}}>설치된 확장 다시 확인</button>{(needsUpdate||error)&&<a className="btn ghost" href="/downloads/yoofam-plus-supplier-hub-extension-0.2.58.zip" download>확장 0.2.58 다운로드</a>}</div>
  </section>;
}
