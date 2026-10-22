import {validateSourceCaptureSelection} from '@/app/source-capture-selection';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {readQuerySourceCapture} from '@/db/query-source-captures';
import {normalizeQuerySource,querySourceFingerprint} from '@/app/query-source-capture';

/** A saved server query retains its own provenance. It is never recast as
 * browser HTML, a reviewed PageSource, or a new upstream request. */
export async function parseOwnedSourceCapture(owner:string,input:unknown,sourceUrl:string){
 const selection=validateSourceCaptureSelection(input,sourceUrl);
 if(selection.format==='yoofam-saved-page-capture-v1')return (await import('@/app/owned-page-capture')).parseOwnedPageCapture(owner,selection,sourceUrl);
 const user=await getChatGPTUser(),company=user?.verifiedAccess&&user.userId===owner?approvedSupplierHubCompany(user.membership):null;
 if(!company)throw Error('승인된 회사 계정으로 로그인해주세요.');
 const item=await readQuerySourceCapture(owner,selection.captureId,company);
 if(!item||item.ownerId!==owner||item.archivedAt!==null||item.company.code!==company.code||item.company.name!==company.name
  ||item.fingerprint!==selection.fingerprint||item.revision!==selection.revision||item.snapshot.sourceUrl!==sourceUrl)throw Error('수집 원문 또는 회원·회사가 변경되었습니다. 수집함에서 다시 확인해주세요.');
 const source=normalizeQuerySource(item.snapshot);
 if(await querySourceFingerprint(source)!==selection.fingerprint)throw Error('저장된 상품 원문의 지문을 확인하지 못했습니다.');
 const current=await getChatGPTUser(),currentCompany=current?.verifiedAccess&&current.userId===owner?approvedSupplierHubCompany(current.membership):null;
 if(!currentCompany||currentCompany.code!==company.code||currentCompany.name!==company.name)throw Error('수집 원문 확인 중 로그인 계정·회사가 변경되었습니다.');
 return source;
}
