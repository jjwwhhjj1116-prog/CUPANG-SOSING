import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
import {readSourceInbox} from '@/db/source-inbox';
import {sourceArchiveReference,sameSourceArchiveReference} from '@/app/source-inbox-archive-client';
import {sourceHasManualTitle} from '@/app/source-inbox-title';
import {sourceTitleBrand,sourceTitleFields} from '@/db/source-inbox-titles';
import {prepareCollectedSourceTitle,SourceTitlePreparationConflict} from '@/app/source-inbox-title-service';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
async function access(){const owner=await getWorkspaceOwnerId(),user=await getChatGPTUser(),member=user?.membership,company=user?.verifiedAccess?approvedSupplierHubCompany(member):null;
 return company&&user?.userId===owner&&member?.id===owner&&member.status==='approved'&&['admin','member'].includes(member.role)?{owner,company,member:{id:owner,email:member.email.trim().toLowerCase(),role:member.role as 'admin'|'member'}}:null;}
export async function POST(request:Request){
 try{
  const auth=await access();if(!auth)return reply({error:'승인된 회사 계정으로 로그인해주세요.'},401);
  const body=await readBoundedJson(request,4096) as Record<string,unknown>;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='expectedCompany,expectedFingerprint,expectedOwnerId,expectedRevision,expectedSourceUrl,id'||typeof body.id!=='string'||!body.expectedCompany||typeof body.expectedCompany!=='object'||Array.isArray(body.expectedCompany))return reply({error:'상품명 준비 요청을 확인해주세요.'},400);
  const item=await readSourceInbox(auth.owner,body.id);if(!item)return reply({error:'선택한 수집 상품을 찾지 못했습니다.'},404);
  const reference=sourceArchiveReference(item,auth.owner,auth.company),expected={ownerId:body.expectedOwnerId,company:body.expectedCompany,id:body.id,fingerprint:body.expectedFingerprint,sourceUrl:body.expectedSourceUrl,revision:body.expectedRevision};
  if(!reference||!sameSourceArchiveReference(reference,expected as typeof reference))return reply({error:'선택한 수집본 또는 로그인 회사가 변경되었습니다.'},409);
  const respond=async(row:Parameters<typeof sourceTitleFields>[1],run?:Parameters<typeof sourceTitleFields>[3])=>reply({...reference,...sourceTitleFields(item,row,await sourceTitleBrand(auth.owner),run)});
  if(sourceHasManualTitle(item))return respond(undefined);
  const work=await prepareCollectedSourceTitle(item,auth.member,request.signal);
  const latest=await access();if(!latest||latest.owner!==auth.owner||JSON.stringify(latest.company)!==JSON.stringify(auth.company)||JSON.stringify(latest.member)!==JSON.stringify(auth.member))return reply({error:'상품명을 준비하는 동안 로그인 회원·회사가 변경되었습니다.'},409);
  return respond(work.row,work.run);
 }catch(error){return reply({error:error instanceof RequestBodyError||error instanceof SourceTitlePreparationConflict?error.message:'수집 상품명을 준비하지 못했습니다. 원문은 보존됩니다.'},error instanceof RequestBodyError?error.status:error instanceof SourceTitlePreparationConflict?409:503);}
}
