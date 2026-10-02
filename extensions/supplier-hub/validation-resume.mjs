import {validateAppHubRequest,isHubRegistrationTab} from './app-request.mjs';
import {transferRecord,resultKey} from './handoff-store.mjs';
import {verifyAppQuotationSource} from './source-check.mjs';
import {assertAppSupplierHubNotSubmitted} from './receipt-recovery.mjs';
import {claimSupplierHubTransmissionWindow} from './transmission-window.mjs';
import {requestSupplierHubValidation} from './validate.mjs';
import {verifySupplierHubCompany} from './company.mjs';

// Only the original, persisted attachment is eligible. No ZIP, file input,
// tab creation or upload is part of this command.
export async function resumeSupplierHubValidation(message,sender,api=chrome,store=transferRecord){
  const identity=validateAppHubRequest(message,sender,'YOOFAM_RESUME_VALIDATION');
  const reviewed=message.reviewedAgreements;
  if(!reviewed||Array.isArray(reviewed)||typeof reviewed!=='object'
    ||Object.keys(reviewed).some(key=>!['priceData','labelBusinessContact','legalDocumentsNotApplicable','legalDocumentsRequired'].includes(key))
    ||Object.values(reviewed).some(value=>typeof value!=='boolean')||reviewed.priceData!==true||reviewed.labelBusinessContact!==true
    ||!(reviewed.legalDocumentsNotApplicable===true&&reviewed.legalDocumentsRequired!==true||reviewed.legalDocumentsRequired===true&&reviewed.legalDocumentsNotApplicable===false))
    throw Error('가격 정보·라벨 연락처 동의와 법적 서류 해당 여부를 확인해주세요.');
  const release=claimSupplierHubTransmissionWindow(sender.tab.windowId);
  try{
    const key=`transmission:${identity.origin}:${identity.productId}:${identity.categoryId}:${identity.fingerprint}`;
    const record=await store('get',key);
    if(!record||!['origin','productId','categoryId','fingerprint'].every(field=>record[field]===identity[field])
      ||!['attached','unconfirmed','validation-requested'].includes(record.state)||record.registered!==false
      ||record.windowId!==sender.tab.windowId||!Number.isSafeInteger(record.tabId)||record.tabId<0
      ||record.filename!==`YOOFAM-${identity.fingerprint}.xlsx`||!/^\w[\w-]{0,99}$/.test(record.profileId||'')
      ||!Array.isArray(record.attachmentNames)||record.attachmentNames.length<1||record.attachmentNames.length>200
      ||new Set(record.attachmentNames).size!==record.attachmentNames.length
      ||record.attachmentNames.some(name=>typeof name!=='string'||name.length>200||!name||/[\s<>"'(),;\/\\]/.test(name))
      ||record.attachmentNames[0]!==record.filename||record.validationResume!==true)
      throw Error('원래 첨부한 견적서 기록과 Chrome 창을 확인해주세요. 파일을 다시 첨부하지 않습니다.');
    if((record.legalDocumentsRequired===true)!==(reviewed.legalDocumentsRequired===true))throw Error('첨부한 원본 서류와 현재 필수 서류 선택이 다릅니다.');
    const binding=await store('get',`attempt:${record.tabId}`);
    if(!binding||!['origin','productId','categoryId','fingerprint','includedOptions'].every(field=>binding[field]===record[field])
      ||binding.company?.code!==record.company?.code||binding.company?.name!==record.company?.name)throw Error('다른 견적서가 연결된 탭에서는 검증을 재개할 수 없습니다.');
    const current=async()=>{
      const tab=await api.tabs.get(record.tabId);
      if(tab.id!==record.tabId||!isHubRegistrationTab(tab,record.windowId))throw Error('처음 파일을 첨부한 Supplier Hub 등록 탭을 확인해주세요.');
      await verifyAppQuotationSource(identity,record,{appTabId:sender.tab.id,windowId:record.windowId},api);
      const cached=await store('get',resultKey(identity));
      if(cached&&cached.state!=='not-found')throw Error('이미 검증 결과가 있습니다. 전송 결과 계속 확인으로 조회해주세요.');
      await assertAppSupplierHubNotSubmitted(identity,record,{appTabId:sender.tab.id,windowId:record.windowId},api,store);
    };
    const checkCompany=async()=>{
      if(!isHubRegistrationTab(await api.tabs.get(record.tabId),record.windowId))throw Error('처음 파일을 첨부한 Supplier Hub 등록 탭을 확인해주세요.');
      const [checked]=await api.scripting.executeScript({target:{tabId:record.tabId},func:verifySupplierHubCompany,args:[record.company]});
      if(checked?.result?.code!==record.company?.code)throw Error('첨부한 회사와 현재 Supplier Hub 회사코드가 다릅니다.');
      if(!isHubRegistrationTab(await api.tabs.get(record.tabId),record.windowId))throw Error('회사 확인 중 Supplier Hub 등록 탭이 변경되었습니다.');
    };
    await current();
    await checkCompany();
    const [inspection]=await api.scripting.executeScript({target:{tabId:record.tabId},func:readAttachedSupplierHubPackage,args:[record]});
    const attached=inspection?.result;
    if(!attached||attached.registered!==false||!['dispatched','upload-pending','validation-requested'].includes(attached.state))throw Error('첨부 목록을 확인하지 못했습니다. Supplier Hub에서 확인해주세요.');
    const save=async outcome=>{await store('put',key,{...record,error:undefined,...outcome});return outcome;};
    if(attached.state==='validation-requested')return save({state:'validation-requested',registered:false});
    if(record.state==='validation-requested')throw Error('검증 요청 기록이 있습니다. 다시 요청하지 않고 결과를 조회해주세요.');
    if(attached.state==='upload-pending')return save({state:'attached',registered:false,error:'첨부 파일 업로드가 아직 완료되지 않았습니다. 파일을 유지하고 잠시 후 검증을 재개해주세요.'});
    await current();
    await checkCompany();
    const claimKey=key+':validation',claim=await store('get',claimKey);
    // An unanswered execution may still be running. Only an explicit response
    // proving no click occurred permits another user-initiated validation.
    if(claim&&claim.state!=='not-started')return save({state:'unconfirmed',registered:false,error:'이전 검증 요청 응답을 확인하지 못했습니다. 다시 요청하지 않고 전송 결과를 확인해주세요.'});
    const started={...identity,state:'started',registered:false,startedAt:Date.now()};
    if(claim)await store('put',claimKey,started);
    else if(!await store('claim',claimKey,started))throw Error('다른 검증 요청이 진행 중입니다. 전송 결과를 확인해주세요.');
    try{
      const [execution]=await api.scripting.executeScript({target:{tabId:record.tabId},func:requestSupplierHubValidation,args:[reviewed,false,{marker:attached.marker}]});
      const result=execution?.result;
      if(result?.registered!==false||result.validated!==false||!['validation-requested','attached'].includes(result.state))throw Error('검증 요청 응답을 확인하지 못했습니다. 전송 결과를 확인해주세요.');
      if(result.state==='attached'&&result.validationNotStarted!==true)throw Error('검증 미실행 여부를 확인하지 못했습니다.');
      await store('put',claimKey,{...started,state:result.state==='attached'?'not-started':'validation-requested'});
      return save({state:result.state,registered:false,...(result.state==='attached'?{error:'파일 검증 버튼이 아직 활성화되지 않았습니다. Supplier Hub 필수 항목을 확인한 뒤 검증을 재개해주세요.'}:{})});
    }catch(error){return save({state:'unconfirmed',registered:false,error:String(error?.message||error)});}
  }finally{release();}
}

// Visible DOM and this extension's attachment marker only; never remote state.
export function readAttachedSupplierHubPackage(expected){
  if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/qvt/registration')throw Error('처음 첨부한 Supplier Hub 등록 화면이 필요합니다.');
  const marker=document.documentElement.dataset.yoofamAttachmentAttempt;
  let attempt;try{attempt=JSON.parse(marker||'');}catch{throw Error('원래 첨부한 파일 기록이 없습니다.');}
  const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
  if(codes.length!==1||codes[0]!==expected.company?.code||attempt.company?.code!==expected.company?.code||attempt.company?.name!==expected.company?.name
    ||!['dispatched','validation-requested'].includes(attempt.state)||!Array.isArray(attempt.files)||attempt.files.length!==expected.attachmentNames.length
    ||attempt.files.some((name,index)=>name!==expected.attachmentNames[index])
    ||(attempt.legalDocumentsRequired===true)!==(expected.legalDocumentsRequired===true)
    ||JSON.stringify(attempt.legalDocuments??[])!==JSON.stringify(expected.legalDocuments??[]))throw Error('첨부한 회사·견적서·이미지·원본 서류가 전송 기록과 다릅니다.');
  const headers=['견적서 명','견적서 등록일','검증 상태','검증 결과','견적서 ID'];
  const normalize=value=>(value||'').replace(/\?/g,'').replace(/\s+/g,' ').trim();
  const tables=Array.from(document.querySelectorAll('table')).filter(table=>table.getClientRects().length&&Array.from(table.querySelectorAll('thead th')).map(cell=>normalize(cell.innerText)).join('|')===headers.join('|'));
  if(tables.length>1)throw Error('검증 결과 표가 중복되어 있습니다. Supplier Hub에서 결과를 확인해주세요.');
  const submitted=tables.some(table=>Array.from(table.querySelectorAll('tbody tr')).some(row=>normalize(row.querySelectorAll('td')[0]?.innerText)===expected.filename));
  if(attempt.state==='validation-requested'||submitted)return {state:'validation-requested',registered:false};
  const names=(document.body.innerText||'').split(/[\s<>"'(),;]+/);
  return {state:attempt.files.every(name=>names.includes(name))?'dispatched':'upload-pending',marker,registered:false};
}
