import { NextResponse } from 'next/server';
import { getChatGPTUser,getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findCollectionJob } from '@/db/collection-jobs';
import { readCollectionResult,storeCollectionResult } from '@/db/collection-results';
import { COLLECTION_RESULT_LIMIT,validateCollectionResult } from '@/app/collection-result';
type Context={params:Promise<{id:string}>};
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});
async function access(context:Context){
 if(process.env.NODE_ENV==='production'&&!(await getChatGPTUser())?.verifiedAccess)return null;
 const owner=await getWorkspaceOwnerId();const {id}=await context.params;return {owner,id};
}
export async function GET(_:Request,context:Context){
 try{const auth=await access(context);if(!auth)return reply({error:'운영 인증 연결이 필요합니다.'},503);
 const job=await findCollectionJob(auth.owner,auth.id);if(!job)return reply({error:'수집 요청을 찾을 수 없습니다.'},404);
 const result=await readCollectionResult(auth.owner,auth.id);
 return reply({jobId:auth.id,offerId:job.offer_id,receipt:result,productCreated:false,message:result?'수집 원문 수신 · 상품 반영과 이미지 다운로드는 별도입니다.':'수집 결과가 아직 도착하지 않았습니다.'});
 }catch{return reply({error:'수집 결과를 읽지 못했습니다.'},503);}
}
export async function POST(request:Request,context:Context){
 try{const auth=await access(context);if(!auth)return reply({error:'운영 인증 연결이 필요합니다.'},503);
 const job=await findCollectionJob(auth.owner,auth.id);if(!job)return reply({error:'수집 요청을 찾을 수 없습니다.'},404);
 if(job.status==='cancelled')return reply({error:'취소된 수집 요청입니다.'},409);
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply({error:'JSON 요청이 필요합니다.'},415);
 const reader=request.body?.getReader();if(!reader)return reply({error:'결과 내용이 필요합니다.'},400);
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>COLLECTION_RESULT_LIMIT){await reader.cancel();return reply({error:'수집 결과는 512KB 이하여야 합니다.'},413);}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 let result;try{result=validateCollectionResult(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),job.offer_id);}catch(cause){return reply({error:cause instanceof Error?cause.message:'수집 결과를 확인해주세요.'},400);}
 const saved=await storeCollectionResult(auth.owner,auth.id,result);
 if(saved.status!=='stored')return reply({error:saved.status==='conflict'?'이미 다른 결과가 수신됐습니다. 기존 원문은 보존됩니다.':'수집 요청이 취소됐습니다.'},409);
 return reply({jobId:auth.id,offerId:job.offer_id,receipt:{result:saved.result,receivedAt:saved.receivedAt},productCreated:false,executionStarted:false});
 }catch{return reply({error:'수집 결과 저장 여부를 확인하지 못했습니다. 동일 결과로 재시도할 수 있습니다.'},503);}
}
