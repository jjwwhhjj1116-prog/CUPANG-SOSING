import {sizeChartBytesDigest,sizeChartDigest,sizeChartSaveKey,sizeChartSavePlan,verifySizeChartSaveReceipt,unchangedSizeChartSaveSnapshot,type SizeChartSaveInput,type SizeChartSaveSnapshot} from '@/app/size-chart-save';
import type {ManualSizeChart} from '@/app/manual-size-chart';
import {renderDocument} from '@/app/document-image-render';

export type SizeChartSaveAttempt={before:SizeChartSaveSnapshot;input:SizeChartSaveInput;blob:Blob;profileId:string|null;posted:boolean;uncommitted:boolean};
type Controls={current:()=>boolean;signal?:AbortSignal;fetcher?:typeof fetch};
const assertCurrent=(controls:Controls)=>{if(controls.signal?.aborted||!controls.current())throw Error('작업 화면 또는 상품이 변경되었습니다. 입력과 저장 시도를 유지했습니다.');};
export function sizeChartSaveEndpoint(productId:string,profileId:string|null,uploadId?:string){const query=new URLSearchParams();if(profileId)query.set('profileId',profileId);if(uploadId)query.set('uploadId',uploadId);return `/api/products/${encodeURIComponent(productId)}/size-chart-save${query.size?'?'+query:''}`;}
export async function readSizeChartSaveSnapshot(productId:string,profileId:string|null,controls:Controls,uploadId?:string):Promise<SizeChartSaveSnapshot>{
 assertCurrent(controls);const response=await(controls.fetcher??fetch)(sizeChartSaveEndpoint(productId,profileId,uploadId),{cache:'no-store',signal:controls.signal}),value=await response.json() as SizeChartSaveSnapshot&{error?:string};assertCurrent(controls);
 if(!response.ok)throw Error(value?.error||'사이즈표 저장 결과를 조회하지 못했습니다.');
 if(value.productId!==productId||value.profileId!==profileId||!value.ownerId||!value.content||value.content.productId!==productId||!value.options||value.options.productId!==productId||!Array.isArray(value.imageKeys)||!Number.isFinite(Date.parse(value.productVersion))||!/^[a-f0-9]{64}$/.test(value.inputFingerprint))throw Error('사이즈표 저장 응답을 확인하지 못했습니다.');return value;
}
export async function prepareSizeChartSaveAttempt(before:SizeChartSaveSnapshot,chart:ManualSizeChart|null,profileId:string|null,controls:Controls,render=renderDocument):Promise<SizeChartSaveAttempt>{
 assertCurrent(controls);const plan=sizeChartSavePlan(before.content,before.options,chart),rendered=await render(plan);assertCurrent(controls);
 const pngSha256=await sizeChartBytesDigest(new Uint8Array(await rendered.blob.arrayBuffer()));assertCurrent(controls);
 const uploadId=[...crypto.getRandomValues(new Uint8Array(32))].map(value=>value.toString(16).padStart(2,'0')).join('');
 return{before,input:{expectedProductVersion:before.productVersion,expectedContentRevision:before.content.revision,expectedOptionRevision:before.options.revision,expectedQuotationRevision:before.quotationRevision,expectedQuotationStateSha256:before.quotationStateSha256,expectedInputFingerprint:before.inputFingerprint,chart,uploadId,pngSha256},blob:rendered.blob,profileId,posted:false,uncommitted:false};
}
export async function recoverSizeChartSaveAttempt(attempt:SizeChartSaveAttempt,controls:Controls){
 const snapshot=await readSizeChartSaveSnapshot(attempt.before.productId,attempt.profileId,controls,attempt.input.uploadId);
 if(await verifySizeChartSaveReceipt(attempt.before,attempt.input,snapshot,attempt.blob.size)){assertCurrent(controls);return{state:'committed' as const,snapshot};}
 if(unchangedSizeChartSaveSnapshot(attempt.before,snapshot)){
  // A retained immutable PNG can be reused by an explicit retry. The GET is
  // evidence of an unchanged SQL state, never an invitation to auto-POST.
  const upload=snapshot.upload;if(upload&&(upload.uploadId!==attempt.input.uploadId||upload.key!==sizeChartSaveKey(attempt.before.ownerId,attempt.input.uploadId)||upload.contentType!=='image/png'||upload.sha256!==attempt.input.pngSha256||upload.sourceFingerprint!==attempt.before.inputFingerprint||upload.size!==attempt.blob.size||upload.chartSha256!==await sizeChartDigest(attempt.input.chart)||upload.planSha256!==await sizeChartDigest(sizeChartSavePlan(attempt.before.content,attempt.before.options,attempt.input.chart))))throw Error('저장 번호의 PNG가 일치하지 않습니다. 입력을 유지했습니다.');
  attempt.uncommitted=true;return{state:'uncommitted' as const,snapshot};
 }
 throw Error('다른 변경과 저장 결과를 구분하지 못했습니다. 입력과 PNG를 유지하고 결과를 다시 조회해주세요.');
}
/** Exactly one POST per explicit invocation. Its caller must retain this
 * object before invoking; failed ACK recovery never dispatches a second POST. */
export async function sendSizeChartSaveAttempt(attempt:SizeChartSaveAttempt,controls:Controls,explicitRetry=false){
 assertCurrent(controls);if(attempt.posted&&(!explicitRetry||!attempt.uncommitted))throw Error('저장 결과를 먼저 조회해주세요. 자동으로 다시 전송하지 않습니다.');
 const form=new FormData();form.set('input',JSON.stringify(attempt.input));form.set('file',new File([attempt.blob],'size_chart.png',{type:'image/png'}));attempt.posted=true;attempt.uncommitted=false;
 try{
  const response=await(controls.fetcher??fetch)(sizeChartSaveEndpoint(attempt.before.productId,attempt.profileId),{method:'POST',body:form,signal:controls.signal}),value=await response.json() as SizeChartSaveSnapshot&{error?:string};assertCurrent(controls);
  if(!response.ok)throw Error(value?.error||'사이즈표 저장 응답을 확인하지 못했습니다.');
  if(!await verifySizeChartSaveReceipt(attempt.before,attempt.input,value,attempt.blob.size))throw Error('사이즈표 저장 응답이 요청과 다릅니다. 입력을 유지했습니다.');assertCurrent(controls);return value;
 }catch(cause){assertCurrent(controls);try{const recovered=await recoverSizeChartSaveAttempt(attempt,controls);if(recovered.state==='committed')return recovered.snapshot;}catch{/* The attempt remains available for explicit read-only recovery. */}throw cause;}
}
