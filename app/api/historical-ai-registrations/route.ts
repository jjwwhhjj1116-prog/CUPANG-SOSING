import {NextResponse} from 'next/server';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {matchesWorkspaceAccount,workspaceAccount} from '@/app/workspace-members';
import {historicalAiCompany,parseHistoricalAiImport,HistoricalAiInputError,historicalAiAccountContext} from '@/app/historical-ai-registrations';
import {importHistoricalAi,listHistoricalAi,historicalAiQuotes} from '@/db/historical-ai-registrations';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});
async function owner(){const user=await getChatGPTUser(),member=user?.membership;return user?.verifiedAccess&&member?.status==='approved'&&user.userId===member.id&&matchesWorkspaceAccount(member)&&workspaceAccount(member.email)?.companyCode===historicalAiCompany.code?user.userId:null;}
export async function GET(request:Request){
 const id=await owner();if(!id)return reply({error:'와이홉 지정 계정으로 로그인해주세요.'},403);
 const params=new URL(request.url).searchParams,page=Number(params.get('page')??1),search=(params.get('search')??'').trim(),registrationId=params.get('registrationId');
 if(!Number.isSafeInteger(page)||page<1||page>10000||search.length>200||registrationId!==null&&!/^\d{12}(?:_[1-9]\d*){0,2}$/.test(registrationId))return reply({error:'기록 조회 조건을 확인해주세요.'},400);
 try{
  const data=registrationId?{registrationId,quotes:await historicalAiQuotes(id,registrationId)}:{...await listHistoricalAi(id,page,search),accountContext:await historicalAiAccountContext(id)};
  if(await owner()!==id)return reply({error:'로그인 계정 또는 회사정보가 변경되었습니다. 원본 기록을 다시 조회해주세요.'},409);
  return reply(data);
 }catch{return reply({error:'쿠플러스 원본 기록을 읽지 못했습니다. 다시 조회해주세요.'},503);}
}
export async function POST(request:Request){
 if(request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'같은 사이트에서 요청해주세요.'},403);
 const id=await owner();if(!id)return reply({error:'와이홉 지정 계정으로 로그인해주세요.'},403);
 try{
  const body=await readBoundedJson(request,2000000) as Record<string,unknown>;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['action','documents','expectedSha256'].includes(key))||!['preview','import'].includes(String(body.action)))return reply({error:'기록 가져오기 형식을 확인해주세요.'},400);
  const source=await parseHistoricalAiImport(body.documents);
  if(body.action==='import'&&body.expectedSha256!==source.sha256)return reply({error:'미리 본 원본 파일이 변경되었습니다. 다시 미리보기해주세요.'},409);
  const counts=await importHistoricalAi(id,source,body.action==='preview');
  if(counts.conflicts||counts.unlinked)return reply({error:counts.conflicts?'같은 등록번호·옵션번호에 다른 원문이 저장되어 있습니다. 기존 기록을 유지했습니다.':'견적 자료의 등록번호에 해당하는 원본 목록을 함께 가져와주세요.',counts},409);
  return reply({preview:body.action==='preview',company:historicalAiCompany,sha256:source.sha256,counts,sample:source.entries.slice(0,5).map(entry=>({registrationId:entry.registrationId,optionId:entry.optionId,title:entry.title,kind:entry.kind}))});
 }catch(error){
  if(error instanceof RequestBodyError)return reply({error:error.message},error.status);
  if(error instanceof HistoricalAiInputError)return reply({error:error.message},400);
  return reply({error:'쿠플러스 원본 기록을 저장하지 못했습니다. 같은 파일로 다시 확인해주세요.'},503);
 }
}
