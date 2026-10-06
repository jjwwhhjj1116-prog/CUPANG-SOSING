import type {ImageLike,RecognizeOptions,OutputFormats,Worker as TesseractWorker,WorkerOptions} from 'tesseract.js';
import {MAX_IMAGE_BYTES} from '@/app/image-files';

export type OcrWorkerPort={postMessage:(message:unknown,transfer:Transferable[])=>void;terminate:()=>unknown;addEventListener:(type:string,handler:(event:MessageEvent|ErrorEvent)=>void)=>void;removeEventListener:(type:string,handler:(event:MessageEvent|ErrorEvent)=>void)=>void};
const LOCAL_WORKER='/ocr/7.0.0/worker.min.js',LOCAL_CORE='/ocr/7.0.0/core',LOCAL_LANG='/ocr/7.0.0/lang';

/** Pinned Tesseract 7 worker protocol, owned from construction through cleanup.
 * Its JS SDK exposes a worker handle only after model initialization. Owning
 * this one worker directly lets cancellation also terminate model loading. */
export async function createFreeOcrWorker(languages:string[],oem:1,options:Partial<WorkerOptions>,signal:AbortSignal,
 spawn:(path:string)=>OcrWorkerPort=path=>new Worker(path)) :Promise<Pick<TesseractWorker,'recognize'|'terminate'>>{
 signal.throwIfAborted();
 if(oem!==1||!languages.length||languages.length>2||new Set(languages).size!==languages.length||languages.some(language=>!['eng','chi_sim'].includes(language))
  ||options.workerPath!==LOCAL_WORKER||options.corePath!==LOCAL_CORE||options.langPath!==LOCAL_LANG||options.workerBlobURL!==false)throw Error('고정된 무료 문구 인식 도구를 확인해주세요.');
 const port=spawn(LOCAL_WORKER),workerId='yoofam-'+crypto.randomUUID();
 let closed=false,sequence=0,recognizing=false;
 const pending=new Map<string,{action:string;resolve:(value:{jobId:string;data:unknown})=>void;reject:(reason:unknown)=>void;timer:ReturnType<typeof setTimeout>}>();
 function close(reason:unknown=Error('문구 인식 작업이 종료됐습니다.')){
  if(closed)return;closed=true;
  signal.removeEventListener('abort',abort);
  port.removeEventListener('message',message);port.removeEventListener('error',error);port.removeEventListener('messageerror',error);
  for(const job of pending.values()){clearTimeout(job.timer);job.reject(reason);}pending.clear();port.terminate();
 }
 const abort=()=>close(signal.reason??Error('문구 인식을 취소했습니다.'));
 const error=()=>close(Error('문구 인식 도구를 읽지 못했습니다. 원본과 저장 내용은 유지됩니다.'));
 const message=(event:MessageEvent|ErrorEvent)=>{
  const value=(event as MessageEvent).data as {workerId?:unknown;jobId?:unknown;action?:unknown;status?:unknown;data?:unknown};
  if(closed||!value||value.workerId!==workerId||typeof value.jobId!=='string')return;
  const job=pending.get(value.jobId);if(!job||value.action!==job.action)return;
  if(value.status==='progress'){
   const progress=value.data as {status?:unknown;progress?:unknown};
   if(progress&&typeof progress.status==='string'&&typeof progress.progress==='number'&&Number.isFinite(progress.progress))options.logger?.({jobId:value.jobId,workerId,userJobId:value.jobId,status:progress.status,progress:Math.max(0,Math.min(1,progress.progress))});
   return;
  }
  if(value.status==='reject'){close(Error('이미지 문구 인식에 실패했습니다. 원본을 확인하거나 영역과 문구를 직접 추가해주세요.'));return;}
  if(value.status!=='resolve')return;
  clearTimeout(job.timer);pending.delete(value.jobId);job.resolve({jobId:value.jobId,data:value.data});
 };
 port.addEventListener('message',message);port.addEventListener('error',error);port.addEventListener('messageerror',error);signal.addEventListener('abort',abort,{once:true});
 function job(action:string,payload:unknown,transfer:Transferable[]=[]):Promise<{jobId:string;data:unknown}>{
  if(closed||signal.aborted)return Promise.reject(signal.reason??Error('문구 인식이 종료됐습니다.'));
  const jobId=workerId+'-'+(++sequence);
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>close(Error('문구 인식 시간이 길어져 중단했습니다. 원본을 확인한 뒤 다시 실행해주세요.')),60000);
   pending.set(jobId,{action,resolve,reject,timer});
   try{port.postMessage({workerId,jobId,action,payload},transfer);}catch{close(Error('문구 인식 도구에 이미지를 전달하지 못했습니다.'));}
  });
 }
 async function imageBytes(input:ImageLike):Promise<Uint8Array>{
  signal.throwIfAborted();let bytes:Uint8Array;
  if(input instanceof Uint8Array)bytes=input.slice();
  else if(input instanceof Blob)bytes=new Uint8Array(await input.arrayBuffer());
  else if(typeof HTMLCanvasElement!=='undefined'&&input instanceof HTMLCanvasElement){
   const blob=await new Promise<Blob>((resolve,reject)=>{input.toBlob(value=>value?resolve(value):reject(Error('인식할 원본 이미지를 준비하지 못했습니다.')),'image/png');});
   bytes=new Uint8Array(await blob.arrayBuffer());
  }else throw Error('인식할 이미지의 화면 원본을 확인해주세요.');
  signal.throwIfAborted();if(!bytes.length||bytes.length>MAX_IMAGE_BYTES)throw Error('문구 인식용 이미지가 10MB를 초과합니다.');return bytes;
 }
 try{
  await job('load',{options:{lstmOnly:true,corePath:LOCAL_CORE,logging:false}});
  // Leave dataPath at the engine default: Tesseract rejects mkdir('/') because
  // its virtual root already exists, even though the language data is valid.
  await job('loadLanguage',{langs:languages,options:{langPath:LOCAL_LANG,cachePath:'yoofam-free-ocr-7.0.0',cacheMethod:'write',gzip:true,lstmOnly:true}});
  await job('initialize',{langs:languages,oem:1,config:{}});
  signal.throwIfAborted();
  return{recognize:async(input:ImageLike,recognizeOptions:Partial<RecognizeOptions>={},output:Partial<OutputFormats>={text:true})=>{
   if(closed||recognizing)throw Error('진행 중인 문구 인식을 마친 뒤 다시 실행해주세요.');
   recognizing=true;
   try{const bytes=await imageBytes(input);return await job('recognize',{image:bytes,options:recognizeOptions,output},[bytes.buffer]) as Awaited<ReturnType<TesseractWorker['recognize']>>;}
   finally{recognizing=false;}
  },terminate:async()=>{close();return{jobId:workerId+'-terminated',data:null};}};
 }catch(reason){close(reason);throw reason;}
}
