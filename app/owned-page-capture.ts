import {readSourceInbox} from '@/db/source-inbox';
import {pageSourceCollectionResult} from '@/app/source-inbox';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
export async function parseOwnedPageCapture(owner:string,input:unknown,sourceUrl:string){
 const value=input as {format?:unknown;sourceUrl?:unknown;captureId?:unknown;fingerprint?:unknown;revision?:unknown};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['format','sourceUrl','captureId','fingerprint','revision'].includes(key))||value.format!=='yoofam-saved-page-capture-v1'||value.sourceUrl!==sourceUrl||typeof value.captureId!=='string'||!/^[a-f0-9-]{36}$/.test(value.captureId)||typeof value.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(value.fingerprint)||!Number.isSafeInteger(value.revision))throw Error('보관된 수집 원문의 요청을 확인해주세요.');
 const user=await getChatGPTUser(),company=user?.verifiedAccess?approvedSupplierHubCompany(user.membership):null;
 if(!company)throw Error('승인된 회사 계정으로 로그인해주세요.');
 const item=await readSourceInbox(owner,value.captureId);
 if(!item||item.ownerId!==owner||item.company.code!==company.code||item.company.name!==company.name||item.fingerprint!==value.fingerprint||item.revision!==value.revision||item.snapshot.sourceUrl!==sourceUrl)throw Error('수집 원문 또는 회원·회사가 변경되었습니다. 수집함에서 다시 확인해주세요.');
 return pageSourceCollectionResult(item.reviewed??item.snapshot,Boolean(item.reviewed));
}
