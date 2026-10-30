import {assertCompany,boundedResult} from './protocol.mjs';
import {collectOperationsPage,confirmStatementPage} from './page.mjs';

export const APPROVAL_TTL=300000;
export function statementSeqs(values){
 const input=values?.purchaseOrderSeqs;if(!Array.isArray(input)||!input.length||input.length>10||input.some(value=>typeof value!=='string'||!/^\d{1,24}$/.test(value)))throw Error('승인할 정확한 발주번호 1~10개가 필요합니다.');
 const seqs=[...new Set(input)];if(seqs.length!==input.length)throw Error('중복된 발주번호가 있습니다.');return seqs;
}
export async function approvalHash(request,seqs){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([request.requestId,request.companyCode,[...seqs].sort()]))))].map(value=>value.toString(16).padStart(2,'0')).join('');}
export function validateApprovalSender(api,sender,job,message,now=Date.now()){
 if(!job||sender?.id!==api.runtime.id||sender?.tab?.id!==job.popupTabId||sender?.frameId!==0||sender?.url!==api.runtime.getURL('confirmation.html')+`#${job.id}:${job.nonce}`)throw Error('이 승인 창에서 시작된 요청이 아닙니다.');
 if(message.jobId!==job.id||message.nonce!==job.nonce||now>job.expiresAt)throw Error('승인 확인이 만료되었거나 일치하지 않습니다.');
 if(message.type!=='YOOFAM_OPS_APPROVAL_STATE'&&(message.requestId!==job.request.requestId||message.companyCode!==job.request.companyCode||message.seqHash!==job.seqHash))throw Error('승인 회사·발주번호가 최초 요청과 다릅니다.');
 if(job.phase!=='awaiting')throw Error('이미 처리 중이거나 종료된 승인입니다.');return true;
}
const receiptKey=(companyCode,seq)=>`${companyCode}:${seq}`;
export function canAttemptStatement(checkpoints,companyCode,seq){const status=checkpoints[receiptKey(companyCode,seq)]?.status;return !['succeeded','unknown','pending'].includes(status);}

/** Only this manager can call the separately injected write adapter. Web requests cannot acknowledge it. */
export function createStatementApprovals(api,targetTab){
 const jobs=new Map();
 const execute=async(tabId,func,args)=>{const result=await api.scripting.executeScript({target:{tabId,frameIds:[0]},world:'ISOLATED',func,args:[args]});if(!result?.[0]?.result)throw Error('쿠팡 탭의 응답을 확인하지 못했습니다.');return result[0].result;};
 const result=(job,status,error,rows=[])=>boundedResult({status,rows,...(error?{error}:{}),warnings:['외부 승인은 Supplier Hub의 실제 상태를 기준으로 확인하세요. 응답 불명 항목은 자동 재시도하지 않습니다.']},job.request);
 const finish=(job,output)=>{if(job.finished)return;job.finished=true;clearTimeout(job.timer);job.phase='finished';jobs.delete(job.id);job.resolve(output);};
 const checkpoint=async(job,seq,status)=>{const saved=await api.storage.local.get('ops_statement_receipts');const receipts=saved.ops_statement_receipts??{};receipts[receiptKey(job.request.companyCode,seq)]={status,at:Date.now(),requestId:job.request.requestId};if(Object.keys(receipts).length>5000)throw Error('승인 기록 보관 한도입니다. 원장 및 Supplier Hub를 확인해주세요.');await api.storage.local.set({ops_statement_receipts:receipts});};
 api.windows?.onRemoved?.addListener(windowId=>{for(const job of jobs.values())if(job.windowId===windowId&&job.phase==='awaiting')finish(job,result(job,'failed','승인 창이 닫혔습니다. 외부 승인을 실행하지 않았습니다.'));});
 async function request(request,sender,range){
  if(!api.windows?.create)throw Error('독립 승인 창을 열 수 없어 승인을 실행하지 않습니다.');
  const seqs=statementSeqs(request.values),saved=await api.storage.local.get('ops_statement_receipts');
  for(const seq of seqs)if(!canAttemptStatement(saved.ops_statement_receipts??{},request.companyCode,seq))throw Error(`발주 ${seq}는 성공·진행·불명 이력이 있습니다. 자동 재승인을 차단했습니다. Supplier Hub에서 상태를 확인해주세요.`);
  const tab=await targetTab(api,sender,'statements');
  const prepared=await execute(tab.id,collectOperationsPage,{...request,kind:'statementPrepare',startDate:range.start,endDate:range.end,values:{...request.values,purchaseOrderSeqs:seqs}});
  assertCompany(prepared.companyCode,request.companyCode);
  const rows=prepared.items??[];if(rows.length!==seqs.length||seqs.some(seq=>!rows.some(row=>row.purchaseOrderSeq===seq)))throw Error('요청한 발주가 모두 현재 RI 상태인지 확인하지 못했습니다.');
  const id=crypto.randomUUID(),nonce=crypto.randomUUID()+crypto.randomUUID(),seqHash=await approvalHash(request,seqs);
  let resolve;const promise=new Promise(done=>{resolve=done;});const job={id,nonce,seqHash,request,seqs,rows,tabId:tab.id,sourceTabId:sender.tab.id,range,resolve,phase:'awaiting',expiresAt:Date.now()+APPROVAL_TTL};jobs.set(id,job);
  job.timer=setTimeout(()=>finish(job,result(job,job.phase==='awaiting'?'failed':'unknown',job.phase==='awaiting'?'승인 확인 시간이 만료되었습니다. 외부 승인을 실행하지 않았습니다.':'승인 응답 시간이 만료되었습니다. Supplier Hub의 실제 상태를 확인해주세요.')),APPROVAL_TTL);
  try{const win=await api.windows.create({url:api.runtime.getURL('confirmation.html')+`#${id}:${nonce}`,type:'popup',width:640,height:700,focused:true});job.windowId=win.id;job.popupTabId=win.tabs?.[0]?.id;if(!Number.isSafeInteger(job.popupTabId))throw Error('승인 창 식별자를 확인하지 못했습니다.');}
  catch(error){finish(job,result(job,'failed',error instanceof Error?error.message:'승인 창을 열지 못했습니다.'));}
  return promise;
 }
 async function message(message,sender){
  const job=jobs.get(message?.jobId);validateApprovalSender(api,sender,job,message);
  if(message.type==='YOOFAM_OPS_APPROVAL_STATE')return {ok:true,requestId:job.request.requestId,companyCode:job.request.companyCode,seqHash:job.seqHash,expiresAt:job.expiresAt,rows:job.rows};
  if(message.type==='YOOFAM_OPS_APPROVAL_CANCEL'){finish(job,result(job,'failed','사용자가 취소했습니다. 외부 승인을 실행하지 않았습니다.'));return {ok:true,cancelled:true};}
  if(message.type!=='YOOFAM_OPS_APPROVAL_ACK'||message.userGesture!==true)throw Error('승인 창의 직접 확인이 필요합니다.');
  job.phase='executing';const receipts=[];let uncertain=false;
  try{for(const seq of job.seqs){
   if(job.finished||Date.now()>job.expiresAt){uncertain=true;break;}
   const saved=await api.storage.local.get('ops_statement_receipts');if(!canAttemptStatement(saved.ops_statement_receipts??{},job.request.companyCode,seq)){receipts.push({purchaseOrderSeq:seq,status:'failed',error:'기존 처리 이력이 있어 재실행을 차단했습니다.'});break;}
   // Persist before dispatch. A suspended worker can never silently repeat an ambiguous write.
   await checkpoint(job,seq,'pending');let receipt;
   try{receipt=await execute(job.tabId,confirmStatementPage,{companyCode:job.request.companyCode,purchaseOrderSeq:seq,startDate:job.range.start,endDate:job.range.end});if(!['succeeded','failed','unknown'].includes(receipt.status))throw Error('알 수 없는 승인 응답입니다.');}
   catch{receipt={purchaseOrderSeq:seq,status:'unknown',error:'승인 응답을 확인하지 못했습니다. 자동 재시도하지 않습니다.'};}
   await checkpoint(job,seq,receipt.status);receipts.push(receipt);
   if(receipt.status!=='succeeded'){uncertain=receipt.status==='unknown';break;}
  }}catch{uncertain=true;}
  const all=receipts.length===job.seqs.length&&receipts.every(row=>row.status==='succeeded'),some=receipts.some(row=>row.status==='succeeded');
  const output=result(job,uncertain?'unknown':all?'succeeded':some?'partial':'failed',all?'':uncertain?'일부 승인 응답이 불명입니다. 재승인하지 말고 Supplier Hub에서 확인해주세요.':'일부 발주를 처리하지 못했습니다. 성공 항목은 재실행하지 않습니다.',receipts);finish(job,output);return output;
 }
 return {request,message};
}
