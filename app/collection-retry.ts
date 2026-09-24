/** Retry only the idempotent collection endpoints. Never used for paid providers or submission. */
export async function collectionRequestWithRetry(url: string, init: RequestInit, options: {
 fetcher: typeof fetch; attempts?: number; shouldStop?: () => boolean;
 wait?: (milliseconds: number) => Promise<void>; onRetry?: (attempt: number) => void;
}): Promise<Response> {
 const attempts=options.attempts??1;
 if(!Number.isInteger(attempts)||attempts<1||attempts>3)throw new Error('재시도 횟수는 1~3회여야 합니다.');
 const wait=options.wait??(milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds)));
 for(let attempt=1;attempt<=attempts;attempt++){
  if(options.shouldStop?.())throw new Error('수집 반영을 중단했습니다.');
  let response:Response;
  try{response=await options.fetcher(url,init);}catch(error){
   if(attempt===attempts||options.shouldStop?.())throw error;
   options.onRetry?.(attempt+1);await wait(500*attempt);continue;
  }
  if(![502,503,504].includes(response.status)||attempt===attempts||options.shouldStop?.())return response;
  // Release a failed response before repeating the same idempotent request.
  try{await response.body?.cancel();}catch{/* No successful result is discarded. */}
  options.onRetry?.(attempt+1);await wait(500*attempt);
 }
 throw new Error('수집 요청 결과를 확인하지 못했습니다.');
}
