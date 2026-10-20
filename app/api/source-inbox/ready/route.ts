import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {pageSourceUrl} from '@/extensions/supplier-hub/page-source.mjs';
import {findSourceInbox,readSourceInbox} from '@/db/source-inbox';
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
/** This endpoint reads saved app data only; never opens/fetches a source URL. */
export async function GET(request:Request){
 try{
  const user=await getChatGPTUser(),company=user?.verifiedAccess?approvedSupplierHubCompany(user.membership):null;if(!company)return reply({error:'회원 로그인이 필요합니다.'},401);
  const query=new URL(request.url).searchParams,selection=['captureId','fingerprint','revision'],explicit=selection.some(key=>query.has(key));
  if([...query.keys()].some(key=>!['sourceUrl',...selection].includes(key))||['sourceUrl',...selection].some(key=>query.getAll(key).length>1)||explicit&&(!selection.every(key=>query.has(key))||!/^[a-f0-9-]{36}$/.test(query.get('captureId')??'')||!/^[a-f0-9]{64}$/.test(query.get('fingerprint')??'')||!/^[1-9]\d{0,9}$/.test(query.get('revision')??'')))return reply({code:'PAGE_SOURCE_LOOKUP_UNCERTAIN',error:'선택한 수집 원문 ID·확인값·검토 버전을 함께 확인해주세요.'},409);
  const owner=await getWorkspaceOwnerId();let source;
  try{source=pageSourceUrl(query.get('sourceUrl')??'');}catch{if(explicit)return reply({code:'PAGE_SOURCE_LOOKUP_UNCERTAIN',error:'선택한 수집 원문의 상품 URL을 다시 확인해주세요.',ownerId:owner},409);throw Error('상품 URL을 확인해주세요.');}
  const {sourceUrl,offerId}=source;
  const item=explicit?await readSourceInbox(owner,query.get('captureId')!):await findSourceInbox(owner,offerId);
  if(explicit&&(!item||item.snapshot.sourceUrl!==sourceUrl||item.fingerprint!==query.get('fingerprint')||item.revision!==Number(query.get('revision'))))return reply({code:'PAGE_SOURCE_LOOKUP_UNCERTAIN',error:'선택한 수집 원문 또는 검토 버전이 변경되었습니다. 해당 버전을 다시 선택해주세요.',ownerId:owner},409);
  if(!item)return reply({ownerId:owner,capture:null});
  if(item.company.code!==company.code||item.company.name!==company.name)return reply({error:'수집 당시 회사가 현재 로그인 회사와 다릅니다.',...(explicit?{code:'PAGE_SOURCE_LOOKUP_UNCERTAIN'}:{})},409);
  if(item.issues.length)return reply({code:'PAGE_SOURCE_REVIEW_REQUIRED',error:`1688 수집함에서 ${item.issues.join('·')}을 확인해주세요.`,ownerId:owner},409);
  return reply({ownerId:owner,capture:{format:'yoofam-saved-page-capture-v1',sourceUrl,captureId:item.id,fingerprint:item.fingerprint,revision:item.revision}});
 }catch{return reply({error:'보관된 수집 원문을 확인하지 못했습니다.'},503);}
}
