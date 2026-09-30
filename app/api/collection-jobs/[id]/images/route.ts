import {storeCollectedImage} from '@/app/collection-image-store';
import {NextResponse} from 'next/server';
import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 try{
  if(process.env.NODE_ENV==='production'&&!(await getChatGPTUser())?.verifiedAccess)return reply({error:'운영 인증이 필요합니다.'},503);
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'같은 사이트에서 요청해주세요.'},400);
  const body=await readBoundedJson(request,1024) as {index:number;assignToStage?:boolean};
  if(!body||typeof body!=='object'||Object.keys(body).some(k=>!['index','assignToStage'].includes(k))||!Number.isInteger(body.index)||body.index<0||body.index>=200||body.assignToStage!==undefined&&typeof body.assignToStage!=='boolean')return reply({error:'이미지 번호와 선택 방식을 확인해주세요.'},400);
  const assignToStage=body.assignToStage!==false;
  const owner=await getWorkspaceOwnerId();const {id}=await context.params;
  return storeCollectedImage(owner,id,body.index,assignToStage);

 }catch(error){
  return reply({error:error instanceof RequestBodyError?error.message:'이미지 반영을 완료하지 못했습니다. 다시 시도해도 완료된 이미지는 중복 반영되지 않습니다.'},error instanceof RequestBodyError?error.status:503);
 }
}
