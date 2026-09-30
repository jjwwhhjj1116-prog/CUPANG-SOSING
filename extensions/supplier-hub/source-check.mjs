import {HANDOFF_ORIGINS} from './handoff-store.mjs';

// Ask only the original app content script to compare its saved source. No
// account cookies or tokens are read, copied or sent to the Hub origin.
export async function verifyAppQuotationSource(identity,prepared,binding,api=chrome){
  if(!HANDOFF_ORIGINS.includes(identity?.origin)||!/^\w[\w-]{0,99}$/.test(identity.productId||'')
    ||!/^\d{1,20}$/.test(identity.categoryId||'')||!/^[a-f0-9]{64}$/.test(identity.fingerprint||'')
    ||!Number.isSafeInteger(binding?.appTabId)||binding.appTabId<0
    ||!Number.isSafeInteger(binding.windowId)||binding.windowId<0
    ||!/^\w[\w-]{0,99}$/.test(prepared?.profileId||'')
    ||!Object.hasOwn({A01526306:'유앤채',A01464742:'와이홉'},prepared?.company?.code)
    ||({A01526306:'유앤채',A01464742:'와이홉'})[prepared.company.code]!==prepared.company.name)
    throw Error('앱에서 최신 견적서와 첨부 파일을 다시 준비해주세요.');
  const current=async()=>{
    const tab=await api.tabs.get(binding.appTabId);let url;
    try{url=new URL(tab?.url);}catch{throw Error('견적서를 준비한 앱 탭을 같은 Chrome 창에 열어두세요.');}
    if(tab.id!==binding.appTabId||tab.windowId!==binding.windowId||url.origin!==identity.origin||url.username||url.password)
      throw Error('견적서를 준비한 앱 탭 또는 Chrome 창이 변경되었습니다.');
  };
  await current();
  const expected={origin:identity.origin,productId:identity.productId,categoryId:identity.categoryId,
    fingerprint:identity.fingerprint,profileId:prepared.profileId,filename:`YOOFAM-${identity.fingerprint}.xlsx`,
    company:{code:prepared.company.code,name:prepared.company.name}};
  const result=await api.tabs.sendMessage(binding.appTabId,{type:'YOOFAM_VERIFY_QUOTATION_SOURCE',expected},{frameId:0});
  await current();
  if(result?.ok!==true)throw Error(typeof result?.error==='string'?result.error.slice(0,20000):'최신 견적서 저장본을 확인하지 못했습니다. 앱에서 다시 준비해주세요.');
  if(result.fingerprint!==expected.fingerprint||result.productId!==expected.productId||result.categoryId!==expected.categoryId
    ||result.profileId!==expected.profileId||result.filename!==expected.filename
    ||result.company?.code!==expected.company?.code||result.company?.name!==expected.company?.name
    ||!Number.isFinite(result.checkedAt)||result.checkedAt<=0||Math.abs(Date.now()-result.checkedAt)>60000)
    throw Error('첨부하려는 견적서와 최신 저장본이 다릅니다. 앱에서 다시 준비해주세요.');
  return true;
}
