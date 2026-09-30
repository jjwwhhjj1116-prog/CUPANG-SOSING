import type {CollectionImportOutcome,CollectionImportProgress} from '@/app/collection-import';

type ImageReply={index:number;status:number;key?:string;error?:string;code?:string;warnings?:unknown};

/** Serial batches avoid competing draft revisions. Only CDN downloads overlap. */
export async function importCollectionImageBatches(base:string,productId:string,indices:readonly number[],options:{
 request:(url:string,init:RequestInit)=>Promise<Response>;shouldStop:()=>boolean;
 continueOnImageError?:boolean;onProgress?:(progress:CollectionImportProgress)=>void;
}):Promise<CollectionImportOutcome>{
 let completedImages=0;
 const warnings:string[]=[],failedImageIndices:number[]=[];
 const result=(status:CollectionImportOutcome['status'],error?:string):CollectionImportOutcome=>({status,productId,completedImages,...(error?{error}:{}),...(warnings.length?{warnings}:{}),...(failedImageIndices.length?{failedImageIndices}: {})});
 const progress=()=>options.onProgress?.({stage:'images',completedImages,totalImages:indices.length});
 for(let start=0;start<indices.length;start+=3){
  if(options.shouldStop())return result('stopped');
  const selected=indices.slice(start,start+3);progress();
  let replies:ImageReply[];
  try{
   const response=await options.request(base+'/images-batch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({indices:selected})});
   if(!response.ok){const body=await response.json() as {error?:string};return result(options.shouldStop()?'stopped':'failed',body.error||'이미지 저장에 실패했습니다.');}
   const body=await response.json() as {results?:ImageReply[]};
   if(!Array.isArray(body.results)||body.results.length!==selected.length||new Set(body.results.map(row=>row?.index)).size!==selected.length||body.results.some(row=>!row||!selected.includes(row.index)||!Number.isInteger(row.status)||row.status<200||row.status>599||row.status===200&&(typeof row.key!=='string'||!row.key.trim())))throw Error('이미지 묶음 저장 응답이 원본 선택과 다릅니다.');
   replies=body.results;
  }catch(error){
   failedImageIndices.push(...selected);
   warnings.push(`원본 ${selected.map(index=>index+1).join(', ')}번 이미지 저장 응답을 확인하지 못했습니다. 재시도 시 저장 여부를 다시 확인합니다.`);
   if(options.shouldStop())return result('stopped');
   if(!options.continueOnImageError)return result('failed',error instanceof Error?error.message:'이미지 응답 확인 실패');
   continue;
  }
  // The server may already have committed later entries in this batch.
  // Count every acknowledgement before deciding whether a failure is terminal.
  let terminal:string|undefined;
  for(let reply of replies){
   if([502,503,504].includes(reply.status)&&!options.shouldStop()){
    try{
     const retry=await options.request(base+'/images',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({index:reply.index,assignToStage:false})});
     reply={...await retry.json(),index:reply.index,status:retry.status};
    }catch{/* Preserve the unconfirmed index for a receipt-based retry. */}
   }
   if(reply.status===200&&typeof reply.key==='string'&&reply.key.trim()){
    completedImages++;
    if(Array.isArray(reply.warnings))for(const warning of reply.warnings)if(typeof warning==='string'&&warning.trim())warnings.push(`원본 ${reply.index+1}번: ${warning}`);
    progress();continue;
   }
   failedImageIndices.push(reply.index);
   const recoverable=reply.status===502&&reply.code==='IMAGE_DOWNLOAD_FAILED'||[503,504].includes(reply.status);
   warnings.push(`원본 ${reply.index+1}번 이미지 저장을 확인하지 못했습니다. 완료된 파일은 재시도 시 재사용합니다.`);
   if(!recoverable||!options.continueOnImageError)terminal=reply.error||'이미지 저장에 실패했습니다.';
  }
  if(options.shouldStop())return result('stopped');
  if(terminal)return result('failed',terminal);
 }
 return failedImageIndices.length?result('failed',`원본 ${failedImageIndices.map(index=>index+1).join(', ')}번 이미지 저장을 완료하지 못했습니다. 저장된 이미지는 재시도 시 재사용합니다.`):result('completed');
}
