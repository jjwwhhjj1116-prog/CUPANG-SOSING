import {NextResponse} from 'next/server';
import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {CollectionForkError,collectionForkId,collectionForkFingerprint,parseCollectionNewDraftTarget} from '@/app/collection-fork';
import {prepareCollectionNewDraft,createCollectionNewDraft,recoverCollectionNewDraft} from '@/db/collection-forks';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});
async function access(){const user=await getChatGPTUser(),owner=await getWorkspaceOwnerId(),company=user?.verifiedAccess&&user.userId===owner?approvedSupplierHubCompany(user.membership):null;if(!company)throw new CollectionForkError(409,'현재 로그인 계정의 승인 회사 코드·이름을 확인해주세요.');return{owner,company};}
async function current(before:Awaited<ReturnType<typeof access>>){const after=await access();if(before.owner!==after.owner||before.company.code!==after.company.code||before.company.name!==after.company.name)throw new CollectionForkError(409,'로그인 계정 또는 승인 회사가 변경되었습니다. 새 초안 내용을 다시 확인해주세요.');}
function failed(error:unknown){return reply({error:error instanceof CollectionForkError||error instanceof RequestBodyError?error.message:'새 초안의 저장 결과를 확인하지 못했습니다. 같은 요청번호로 결과를 다시 확인해주세요.'},error instanceof CollectionForkError||error instanceof RequestBodyError?error.status:503);}
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
 try{const scope=await access(),{id}=await context.params,params=new URL(request.url).searchParams,requestId=params.get('requestId');
  if(requestId!==null){const proof=params.get('baseFingerprint');if(!collectionForkId(requestId)||!collectionForkFingerprint(proof))throw new CollectionForkError(400,'확인할 새 초안 요청번호와 지문을 확인해주세요.');const saved=await recoverCollectionNewDraft(scope.owner,scope.company,id,requestId,proof);await current(scope);return saved?reply(saved):reply({error:'해당 요청번호로 생성된 새 초안이 아직 없습니다.'},404);}
  const input=parseCollectionNewDraftTarget({profileId:params.get('profileId'),expectedProfileRevision:Number(params.get('expectedProfileRevision')),goal:params.get('goal'),features:params.get('features')??'',keywords:params.get('keywords')??''}),prepared=await prepareCollectionNewDraft(scope.owner,scope.company,id,input);await current(scope);return reply(prepared.preview);
 }catch(error){return failed(error);}
}
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 try{if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)throw new CollectionForkError(400,'같은 사이트에서 새 초안을 생성해주세요.');
  const scope=await access(),{id}=await context.params,body=await readBoundedJson(request,20000);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['requestId','baseFingerprint','profileId','expectedProfileRevision','goal','features','keywords'].includes(key)))throw new CollectionForkError(400,'새 초안의 입력 형식을 확인해주세요.');const input=body as Record<string,unknown>;
  if(!collectionForkId(input.requestId)||!collectionForkFingerprint(input.baseFingerprint))throw new CollectionForkError(400,'새 초안 요청번호와 검토 지문이 필요합니다.');
  const target=parseCollectionNewDraftTarget(input),saved=await createCollectionNewDraft(scope.owner,scope.company,id,target,input.requestId,input.baseFingerprint);await current(scope);return reply(saved);
 }catch(error){return failed(error);}
}
