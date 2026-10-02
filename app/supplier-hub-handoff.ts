type PackageIdentity={productId:string;categoryId:string;fingerprint:string};
/** Only a missing reply to a read-only result request is safe to retry. */
export class SupplierHubLookupUnavailable extends Error {}
export function exchange(type:'PING'|'PREPARE'|'RESULT'|'TRANSMIT'|'VALIDATE'|'REFRESH'|'REGISTRATION'|'CATEGORIES'|'SCHEMA'|'TEMPLATE',payload:unknown,signal:AbortSignal):Promise<Record<string,unknown>>{
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new Error('작업을 취소했습니다.'));return;}
    const requestId=crypto.randomUUID();
    const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive);signal.removeEventListener('abort',abort);};
    const abort=()=>{cleanup();reject(new Error('작업을 취소했습니다.'));};
    const receive=(event:MessageEvent)=>{
      if(event.source!==window||event.origin!==window.location.origin||event.data?.channel!=='YOOFAM_HUB_HANDOFF_RESULT'||event.data.requestId!==requestId)return;
      cleanup();const result=event.data.result;
      if(!result||result.ok!==true)reject(new Error(typeof result?.error==='string'?result.error:'확장에 견적서를 전달하지 못했습니다.'));
      else resolve(result);
    };
    const timer=setTimeout(()=>{
      cleanup();
      const message=type==='PING'?'YOOFAM PLUS 첨부 확장 0.2 이상을 설치하고 이 페이지를 새로고침해주세요.':(type==='TRANSMIT'||type==='VALIDATE')?'전송 응답을 확인하지 못했습니다. 다시 전송하지 말고 Supplier Hub 첨부 목록과 검증 결과를 확인해주세요.':type==='REGISTRATION'?'상품별 등록 상태 응답이 없습니다. 잠시 후 다시 조회해주세요.':(type==='CATEGORIES'||type==='SCHEMA'||type==='TEMPLATE')?'카테고리 조회 응답을 확인하지 못했습니다. 다시 목록을 불러와주세요.':type==='RESULT'||type==='REFRESH'?'검증 결과 응답이 없습니다. Supplier Hub에서 검증 상태를 확인한 뒤 다시 불러와주세요.':'확장 준비 응답을 확인하지 못했습니다. Supplier Hub 확장에서 준비된 파일을 확인해주세요.';
      reject(['RESULT','REFRESH','REGISTRATION'].includes(type)?new SupplierHubLookupUnavailable(message):new Error(message));
    },type==='PING'?2000:(type==='TRANSMIT'||type==='VALIDATE')?55000:type==='REGISTRATION'?120000:type==='CATEGORIES'?45000:type==='SCHEMA'?60000:type==='TEMPLATE'?90000:20000);
    window.addEventListener('message',receive);signal.addEventListener('abort',abort,{once:true});
    window.postMessage({channel:'YOOFAM_HUB_HANDOFF',requestId,type,payload},window.location.origin);
  });
}
export async function checkSupplierHubExtension(signal:AbortSignal,direct=false){
  const result=await exchange('PING',null,signal);
  if(result.companyBinding!==true)throw new Error('회사코드 확인을 지원하는 첨부 확장 0.2.18 이상으로 업데이트하고 앱 페이지를 새로고침해주세요.');
  if(direct&&result.directTransmission!==true)throw new Error('등록 전송을 지원하는 Chrome 확장 0.2.23 이상으로 업데이트하고 앱 페이지를 새로고침해주세요.');
  if(result.latestSourceBinding!==true)throw new Error('최신 저장본 확인을 지원하는 Chrome 확장 0.2.27 이상으로 업데이트하고 앱 페이지를 새로고침해주세요.');
  if(result.durableAttachmentRecovery!==true)throw new Error('부분 첨부 결과 복원과 중복 전송 방지를 지원하는 Chrome 확장 0.2.30 이상으로 업데이트하고 앱 페이지를 새로고침해주세요.');
  if(result.imageIntegrityBinding!==true)throw new Error('견적 이미지 내용 확인을 지원하는 Chrome 확장 0.2.31 이상으로 업데이트하고 앱 페이지를 새로고침해주세요.');
  if(result.serverReceiptReplayProtection!==true)throw new Error('서버 전송 기록 확인을 지원하는 Chrome 확장 0.2.34 이상으로 업데이트하고 앱 페이지를 새로고침해주세요.');
  if(direct&&result.companyMenuRecovery!==true)throw new Error('회사 메뉴 복구를 지원하는 Chrome 확장 0.2.40 이상으로 업데이트하고 앱 페이지를 새로고침해주세요.');
}
export type SupplierHubRegistrationRow={title:string;submittedAt:string;category:string;barcode:string;sourceQuotation:string;skuId:string;status:string;stage:string};
export type SupplierHubRegistration={quotationId:string;registered:false;observedAt:number;includedOptions?:number;rows:SupplierHubRegistrationRow[]}&(
  {scope:'visible-page';pagesRead?:never;hasMore?:never}|{scope:'queried-pages';pagesRead:number;hasMore:boolean|null}
);
export type SupplierHubResult={state:string;filename:string;company?:{code:string;name:string};submittedAt?:string;status?:string;detail?:string;quotationId?:string;includedOptions?:number;observedAt:number;registered:false;registration?:SupplierHubRegistration};
export type SupplierHubSavedAttempt={state:'started'|'validation-requested'|'attached'|'partial'|'unconfirmed';company:{code:string;name:string};includedOptions:number;startedAt:number;registered:false;validationResume?:boolean;error?:string};
export type SupplierHubSavedSubmission={attempt:SupplierHubSavedAttempt|null;result:SupplierHubResult|null};
type ResultSource={filename:string;company:{code:string;name:string};includedOptions:number;quotationId?:string};
export class SupplierHubResultInvalid extends Error {}
/** Shared evidence for restored receipts and fresh lookups; SKU issuance is not approval. */
export function supplierHubRegistrationEvidence(result:SupplierHubResult|null){
  const registration=result?.registration,rows=registration?.rows??[],includedOptions=result?.includedOptions;
  const skus=rows.map(row=>row.skuId.trim()).filter(value=>value&&!/\.\.\.|…/.test(value)
    &&!/^(?:-|—|n\/a|미표시|해당사항없음)$/i.test(value));
  const duplicateSkus=new Set(skus).size!==skus.length;
  const rejected=rows.some(row=>/반려|거절|실패/.test(row.status+' '+row.stage));
  const allSkus=Boolean(result?.state==='validation-complete'&&result.registered===false&&registration?.registered===false
    &&registration.quotationId===result.quotationId&&registration.includedOptions===includedOptions
    &&typeof includedOptions==='number'&&Number.isSafeInteger(includedOptions)&&includedOptions>=1&&includedOptions<=200
    &&['visible-page','queried-pages'].includes(registration.scope)
    &&rows.length===includedOptions&&skus.length===includedOptions&&!duplicateSkus&&!rejected
    &&!(registration.scope==='queried-pages'&&registration.hasMore===true));
  return {observedRows:rows.length,issuedSkus:skus.length,duplicateSkus,rejected,allSkus};
}
/** A cached receipt and a live lookup must refer to the same reviewed company and rows. */
export function validateSupplierHubResultForSource(result:SupplierHubResult,source:ResultSource):void{
  if(result.registered!==false||result.filename!==source.filename||result.company?.code!==source.company.code||result.company?.name!==source.company.name)
    throw new SupplierHubResultInvalid('현재 검토한 회사의 견적서 결과인지 확인하지 못했습니다.');
  if(result.includedOptions!==source.includedOptions||result.registration&&(result.registration.includedOptions!==source.includedOptions||result.registration.rows.length>source.includedOptions))
    throw new SupplierHubResultInvalid('검토한 견적서의 옵션 수와 Supplier Hub 결과가 다릅니다.');
  if(source.quotationId!==undefined&&result.quotationId!==source.quotationId)
    throw new SupplierHubResultInvalid('조회 중 견적서 ID가 변경되었습니다. 다시 결과를 확인해주세요.');
}
export function validateRegistrationResult(value:unknown,quotationId:unknown):SupplierHubRegistration{
  const result=value as SupplierHubRegistration;
  if(!result||typeof quotationId!=='string'||!quotationId.trim()||result.quotationId!==quotationId||!['visible-page','queried-pages'].includes(result.scope)||result.registered!==false||!Number.isFinite(result.observedAt)||result.observedAt<=0||result.observedAt>Date.now()+60000||(result.includedOptions!==undefined&&(!Number.isSafeInteger(result.includedOptions)||result.includedOptions<1||result.includedOptions>200))||!Array.isArray(result.rows)||result.rows.length>1000||result.rows.some(row=>!row||['title','submittedAt','category','barcode','sourceQuotation','skuId','status','stage'].some(key=>typeof row[key as keyof SupplierHubRegistrationRow]!=='string'||row[key as keyof SupplierHubRegistrationRow].length>20000)))throw new SupplierHubResultInvalid('현재 견적서의 상품별 등록 결과인지 확인하지 못했습니다.');
  if(result.scope==='queried-pages'&&(!Number.isSafeInteger(result.pagesRead)||result.pagesRead<1||result.pagesRead>200||![true,false,null].includes(result.hasMore)
    ||result.includedOptions===undefined||result.rows.length>result.includedOptions)
    ||result.scope==='visible-page'&&(result.pagesRead!==undefined||result.hasMore!==undefined))throw new SupplierHubResultInvalid('상품별 조회 페이지의 범위와 옵션 수를 확인하지 못했습니다.');
  return result;
}
function readResultRecord(value:unknown,identity:PackageIdentity):SupplierHubResult|null{
  if(value===null)return null;
  const record=value as Record<string,unknown>;
  if(!record||record.origin!==window.location.origin||record.productId!==identity.productId||record.categoryId!==identity.categoryId||record.fingerprint!==identity.fingerprint||record.filename!==`YOOFAM-${identity.fingerprint}.xlsx`||record.registered!==false||!['not-found','validation-complete','validation-rejected','validation-pending'].includes(String(record.state))||typeof record.observedAt!=='number'||!Number.isFinite(record.observedAt)||record.observedAt<=0||record.observedAt>Date.now()+60000||(record.includedOptions!==undefined&&(typeof record.includedOptions!=='number'||!Number.isSafeInteger(record.includedOptions)||record.includedOptions<1||record.includedOptions>200))||['submittedAt','status','detail','quotationId'].some(key=>record[key]!==undefined&&(typeof record[key]!=='string'||String(record[key]).length>20000)))throw new SupplierHubResultInvalid('검토한 상품의 검증 결과인지 확인하지 못했습니다.');
  if(record.registration!==undefined){
    if(record.state!=='validation-complete')throw new SupplierHubResultInvalid('파일 검증 완료 결과가 필요합니다.');
    const registration=validateRegistrationResult(record.registration,record.quotationId);
    if(registration.includedOptions!==record.includedOptions)throw new SupplierHubResultInvalid('초안 옵션 수와 상품별 등록 결과의 연결을 확인하지 못했습니다.');
  }
  return record as SupplierHubResult;
}
export async function getSupplierHubResult(identity:PackageIdentity,signal:AbortSignal,refresh:boolean|'registration'=false):Promise<SupplierHubResult|null>{
  if(refresh==='registration'){
    const capability=await exchange('PING',null,signal);
    if(capability.companyBinding!==true||capability.registrationLookup!==true||capability.registrationPages!==true)throw new Error('상품별 등록 조회를 지원하는 Chrome 확장 0.2.26 이상으로 업데이트하고 앱 페이지를 새로고침해주세요.');
    if(capability.companyMenuRecovery!==true)throw new Error('회사 메뉴 복구를 지원하는 Chrome 확장 0.2.40 이상으로 업데이트하고 앱 페이지를 새로고침해주세요.');
  }
  const response=await exchange(refresh==='registration'?'REGISTRATION':refresh?'REFRESH':'RESULT',identity,signal);
  if(response.fingerprint!==identity.fingerprint||response.registered!==false)throw new SupplierHubResultInvalid('견적서 결과의 식별값이 일치하지 않습니다.');
  const record=readResultRecord(response.record,identity);
  if(refresh==='registration'&&!record?.registration)throw new SupplierHubResultInvalid('현재 견적서의 상품별 등록 조회 결과가 없습니다.');
  return record;
}
/** Reads this Chrome profile's persisted claim/results. Never navigates or uploads to Hub. */
export async function getSupplierHubSubmission(identity:PackageIdentity,signal:AbortSignal):Promise<SupplierHubSavedSubmission>{
  const capability=await exchange('PING',null,signal);
  if(capability.savedSubmission!==true)throw new Error('전송 기록 복원을 지원하는 Chrome 확장 0.2.28 이상으로 업데이트하고 앱 페이지를 새로고침해주세요.');
  const response=await exchange('RESULT',identity,signal);
  if(response.fingerprint!==identity.fingerprint||response.registered!==false)throw new Error('전송 기록의 식별값이 일치하지 않습니다.');
  const result=readResultRecord(response.record,identity);
  const value=response.attempt as Record<string,unknown>|null;
  if(value!==null){
    const company=value?.company as {code?:unknown;name?:unknown}|undefined;
    const companies:Record<string,string>={A01526306:'유앤채',A01464742:'와이홉'};
    if(!value||value.origin!==window.location.origin||value.productId!==identity.productId||value.categoryId!==identity.categoryId||value.fingerprint!==identity.fingerprint
      ||value.registered!==false||!['started','validation-requested','attached','partial','unconfirmed'].includes(String(value.state))
      ||typeof company?.code!=='string'||!Object.hasOwn(companies,company.code)||company.name!==companies[company.code]
      ||typeof value.includedOptions!=='number'||!Number.isSafeInteger(value.includedOptions)||value.includedOptions<1||value.includedOptions>200
      ||typeof value.startedAt!=='number'||!Number.isSafeInteger(value.startedAt)||value.startedAt<=0||value.startedAt>Date.now()+60000
      ||!Number.isSafeInteger(value.tabId)||Number(value.tabId)<0||!Number.isSafeInteger(value.windowId)||Number(value.windowId)<0
      ||value.validationResume!==undefined&&typeof value.validationResume!=='boolean'
      ||value.error!==undefined&&(typeof value.error!=='string'||value.error.length>20000))throw new Error('검토한 견적서의 저장된 전송 기록인지 확인하지 못했습니다.');
  }
  const attempt=value as SupplierHubSavedAttempt|null;
  if(result&&attempt)validateSupplierHubResultForSource(result,{filename:`YOOFAM-${identity.fingerprint}.xlsx`,company:attempt.company,includedOptions:attempt.includedOptions});
  return {attempt,result};
}
export async function prepareSupplierHubHandoff(blob:Blob,identity:PackageIdentity,signal:AbortSignal){
  const result=await exchange('PREPARE',{...identity,base64:await packageBase64(blob)},signal);
  if(result.fingerprint!==identity.fingerprint||result.registered!==false)throw new Error('검토한 견적서와 확장 준비 결과가 다릅니다.');
}
export type SupplierHubAgreements={priceData:boolean;labelBusinessContact:boolean;legalDocumentsNotApplicable:boolean;legalDocumentsRequired?:boolean};
export type SupplierHubTransmission={state:'not-started'|'validation-requested'|'attached'|'partial'|'unconfirmed';registered:false;error?:string};
export async function transmitSupplierHubPackage(blob:Blob,identity:PackageIdentity,reviewedAgreements:SupplierHubAgreements,signal:AbortSignal):Promise<SupplierHubTransmission>{
  if(!reviewedAgreements||reviewedAgreements.priceData!==true||reviewedAgreements.labelBusinessContact!==true||!(reviewedAgreements.legalDocumentsNotApplicable===true&&reviewedAgreements.legalDocumentsRequired!==true||reviewedAgreements.legalDocumentsRequired===true&&reviewedAgreements.legalDocumentsNotApplicable===false))throw new Error('Supplier Hub 필수 동의와 법적 서류 선택을 확인해주세요.');
  if(reviewedAgreements.legalDocumentsRequired===true){const capability=await exchange('PING',null,signal);if(capability.legalDocumentAttachments!==true)throw Error('법적 서류 전송을 지원하는 Chrome 확장 0.2.38로 갱신해주세요.');}
  const response=await exchange('TRANSMIT',{...identity,reviewedAgreements,base64:await packageBase64(blob)},signal);
  const result=response.result as SupplierHubTransmission;
  if(response.fingerprint!==identity.fingerprint||response.registered!==false||!result||result.registered!==false
    ||!['not-started','validation-requested','attached','partial','unconfirmed'].includes(result.state)
    ||(result.error!==undefined&&(typeof result.error!=='string'||result.error.length>20000)))throw new Error('전송 결과를 확인하지 못했습니다. Supplier Hub 첨부 목록과 검증 상태를 확인해주세요.');
  return result;
}
/** Reuses the original Hub attachment; no exporter or package bytes are sent. */
export async function resumeSupplierHubValidation(identity:PackageIdentity,reviewedAgreements:SupplierHubAgreements,signal:AbortSignal):Promise<SupplierHubTransmission>{
  if(reviewedAgreements.priceData!==true||reviewedAgreements.labelBusinessContact!==true
    ||!(reviewedAgreements.legalDocumentsNotApplicable===true&&reviewedAgreements.legalDocumentsRequired!==true||reviewedAgreements.legalDocumentsRequired===true&&reviewedAgreements.legalDocumentsNotApplicable===false))throw Error('Supplier Hub 필수 동의와 법적 서류 선택을 확인해주세요.');
  const capability=await exchange('PING',null,signal);
  if(capability.validationResume!==true||capability.latestSourceBinding!==true||capability.serverReceiptReplayProtection!==true)throw Error('첨부 검증 재개를 지원하는 Chrome 확장 0.2.39로 갱신하고 앱 페이지를 새로고침해주세요.');
  if(capability.companyMenuRecovery!==true)throw new Error('회사 메뉴 복구를 지원하는 Chrome 확장 0.2.40 이상으로 업데이트하고 앱 페이지를 새로고침해주세요.');
  const response=await exchange('VALIDATE',{...identity,reviewedAgreements},signal);
  const result=response.result as SupplierHubTransmission;
  if(response.fingerprint!==identity.fingerprint||response.registered!==false||!result||result.registered!==false
    ||!['attached','validation-requested','unconfirmed'].includes(result.state)
    ||result.error!==undefined&&(typeof result.error!=='string'||result.error.length>20000))throw Error('검증 요청 응답을 확인하지 못했습니다. 다시 첨부하지 않고 전송 결과를 확인해주세요.');
  return result;
}
async function packageBase64(blob:Blob){
  if(blob.size>30*1024*1024)throw new Error('첨부 패키지는 30MB 이하여야 합니다.');
  const bytes=new Uint8Array(await blob.arrayBuffer());let text='';
  for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return btoa(text);
}
