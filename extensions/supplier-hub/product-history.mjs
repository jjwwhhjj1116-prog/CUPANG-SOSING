import {HANDOFF_ORIGINS,productTransferRecords,isStoredReceiptResult} from './handoff-store.mjs';

export function validateProductTransferRecords(origin,productId,rows){
  if(!HANDOFF_ORIGINS.includes(origin)||!/^\w[\w-]{0,99}$/.test(productId||'')||!Array.isArray(rows)||rows.length>200
    ||new TextEncoder().encode(JSON.stringify(rows)).length>512*1024)throw Error('상품의 전체 Chrome 전송 이력을 확인하지 못했습니다.');
  for(const row of rows){const value=row?.value;
    if(!value||!['result','transmission'].some(kind=>row.key===`${kind}:${origin}:${productId}:${value.categoryId}:${value.fingerprint}`)
      ||value.origin!==origin||value.productId!==productId||!/^\d{1,20}$/.test(value.categoryId||'')||!/^[a-f0-9]{64}$/.test(value.fingerprint||'')
      ||value.registered!==false)throw Error('이전 전송 기록을 확인하지 못해 새 첨부를 중단했습니다.');
  }
  return rows;
}
export function productTransferHistoryBlocked(origin,productId,rows){
  validateProductTransferRecords(origin,productId,rows);
  const rejected=new Set(rows.filter(row=>row.key.startsWith('result:')&&isStoredReceiptResult(row.value,row.value)
    &&row.value.state==='validation-rejected'&&!row.value.quotationId&&row.value.registration===undefined).map(row=>row.value.fingerprint));
  return rows.some(row=>!rejected.has(row.value.fingerprint));
}
export async function readAppProductTransmissionHistory(identity,binding,api=chrome){
  if(!HANDOFF_ORIGINS.includes(identity?.origin)||!/^\w[\w-]{0,99}$/.test(identity.productId||'')||!Number.isSafeInteger(binding?.appTabId)||binding.appTabId<0||!Number.isSafeInteger(binding.windowId)||binding.windowId<0)throw Error('상품 전송 이력을 조회할 앱을 확인해주세요.');
  const expected={origin:identity.origin,productId:identity.productId};
  const check=async()=>{const tab=await api.tabs.get(binding.appTabId);let url;try{url=new URL(tab?.url);}catch{}
    if(!url||tab?.id!==binding.appTabId||tab.windowId!==binding.windowId||tab.pendingUrl||url.origin!==expected.origin)throw Error('원래 앱 탭에서 상품 전송 이력을 확인해주세요.');};
  await check();const reply=await api.tabs.sendMessage(binding.appTabId,{type:'YOOFAM_READ_PRODUCT_TRANSMISSION_HISTORY',expected},{frameId:0});await check();
  const history=reply?.history;
  if(reply?.ok!==true||reply.origin!==expected.origin||reply.productId!==expected.productId||!Number.isFinite(reply.checkedAt)||Math.abs(Date.now()-reply.checkedAt)>60000
    ||!history||history.schemaVersion!==1||history.productId!==expected.productId||typeof history.blocked!=='boolean'||!Array.isArray(history.receipts)||history.receipts.length>200
    ||new TextEncoder().encode(JSON.stringify(history)).length>512*1024||new Set(history.receipts.map(receipt=>receipt?.fingerprint)).size!==history.receipts.length
    ||history.receipts.some(receipt=>receipt?.schemaVersion!==1||receipt.evidence!=='chrome-observation'||!/^\w[\w-]{0,99}$/.test(receipt.profileId||'')
      ||!/^\d{1,20}$/.test(receipt.categoryId||'')||!/^[a-f0-9]{64}$/.test(receipt.fingerprint||'')||!Number.isFinite(Date.parse(receipt.productVersion))||!Number.isFinite(Date.parse(receipt.recordedAt))
      ||!isStoredReceiptResult({origin:identity.origin,productId:identity.productId,categoryId:receipt.categoryId,fingerprint:receipt.fingerprint},{...receipt.result,origin:identity.origin,productId:identity.productId,categoryId:receipt.categoryId,fingerprint:receipt.fingerprint}))
    ||history.blocked!==history.receipts.some(receipt=>receipt?.result?.state!=='validation-rejected'||Boolean(receipt.result.quotationId)||receipt.result.registration!==undefined))throw Error('서버의 상품 전체 전송 이력을 확인하지 못했습니다.');
  return history;
}
export async function assertProductNotTransmitted(identity,binding,api=chrome,readLocal=productTransferRecords){
  const [server,local]=await Promise.all([readAppProductTransmissionHistory(identity,binding,api),readLocal(identity.origin,identity.productId)]);
  if(server.blocked||productTransferHistoryBlocked(identity.origin,identity.productId,local)){
    const error=Error('이 상품에 이전 전송 또는 미확정 시도가 있습니다. 원래 견적서의 결과를 확인해주세요. 수정본을 다시 첨부하지 않았습니다.');error.code='SUPPLIER_HUB_ALREADY_SUBMITTED';throw error;
  }
}

/** A guessed product ID is not permission to reveal another member's durable
 * Chrome records. Prove current owner/product and approved company on both
 * sides of the local read; never return a cross-company record. */
export async function readOwnedProductTransferHistory(identity,binding,api=chrome,readLocal=productTransferRecords){
  const context=async()=>{
    const tab=await api.tabs.get(binding.appTabId);let url;try{url=new URL(tab?.url);}catch{}
    if(!url||tab.id!==binding.appTabId||tab.windowId!==binding.windowId||tab.pendingUrl||url.origin!==identity.origin)throw Error('원래 앱 탭에서 상품 전송 이력을 확인해주세요.');
    const value=await api.tabs.sendMessage(binding.appTabId,{type:'YOOFAM_READ_CATALOG_CONTEXT'},{frameId:0});
    if(value?.ok!==true||!/^\w[\w-]{0,99}$/.test(value.ownerId||'')||!Object.hasOwn({A01464742:'와이홉',A01526306:'유앤채'},value.company?.code)
      ||({A01464742:'와이홉',A01526306:'유앤채'})[value.company.code]!==value.company.name)throw Error('로그인 회원의 승인된 회사를 확인하지 못했습니다.');
    return value;
  };
  const before=await context(),server=await readAppProductTransmissionHistory(identity,binding,api);
  const records=validateProductTransferRecords(identity.origin,identity.productId,await readLocal(identity.origin,identity.productId));
  if(records.some(row=>row.value.company?.code!==before.company.code||row.value.company?.name!==before.company.name)
    ||server.receipts.some(receipt=>receipt.result.company?.code!==before.company.code||receipt.result.company?.name!==before.company.name))throw Error('이 상품의 원래 전송 회사와 현재 회원 회사가 다릅니다. 기록을 공개하지 않았습니다.');
  const after=await context();if(after.ownerId!==before.ownerId||after.company.code!==before.company.code||after.company.name!==before.company.name)throw Error('상품 이력 조회 중 로그인 회원 또는 회사가 변경되었습니다.');
  const final=await readAppProductTransmissionHistory(identity,binding,api);
  if(final.receipts.some(receipt=>receipt.result.company?.code!==before.company.code||receipt.result.company?.name!==before.company.name))throw Error('상품 이력 조회 중 원래 전송 회사가 변경되었습니다.');
  return records;
}
