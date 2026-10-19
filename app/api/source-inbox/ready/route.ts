import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {pageSourceUrl} from '@/extensions/supplier-hub/page-source.mjs';
import {findSourceInbox} from '@/db/source-inbox';
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
/** This endpoint reads saved app data only; never opens/fetches a source URL. */
export async function GET(request:Request){
 try{
  const user=await getChatGPTUser(),company=user?.verifiedAccess?approvedSupplierHubCompany(user.membership):null;if(!company)return reply({error:'회원 로그인이 필요합니다.'},401);
  const owner=await getWorkspaceOwnerId(),{sourceUrl,offerId}=pageSourceUrl(new URL(request.url).searchParams.get('sourceUrl')??'');
  const item=await findSourceInbox(owner,offerId);
  if(!item)return reply({ownerId:owner,capture:null});
  if(item.company.code!==company.code||item.company.name!==company.name)return reply({error:'수집 당시 회사가 현재 로그인 회사와 다릅니다.'},409);
  if(item.issues.length)return reply({code:'PAGE_SOURCE_REVIEW_REQUIRED',error:`1688 수집함에서 ${item.issues.join('·')}을 확인해주세요.`,ownerId:owner},409);
  return reply({ownerId:owner,capture:{format:'yoofam-saved-page-capture-v1',sourceUrl,captureId:item.id,fingerprint:item.fingerprint,revision:item.revision}});
 }catch{return reply({error:'보관된 수집 원문을 확인하지 못했습니다.'},503);}
}
