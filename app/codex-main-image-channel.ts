import type {CliScope} from '@/app/cli-bridge-client';
export type CodexMainImage={mimeType:'image/png'|'image/jpeg';data:string};
export type CodexMainImageJob={productId:string;optionId:string;profileId:string|null;sourceKey:string;prompt:string;image:CodexMainImage};
export type CodexMainImageReceipt={key:string;productVersion:string};
const channelName='yoofam-codex-main-image-v1',limit=5_592_408;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const id=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v);
export function validCodexMainImage(v:unknown):v is CodexMainImage{return object(v)&&Object.keys(v).length===2&&['image/png','image/jpeg'].includes(String(v.mimeType))&&typeof v.data==='string'&&v.data.length>0&&v.data.length<=limit&&v.data.length%4===0&&/^[A-Za-z0-9+/]+={0,2}$/.test(v.data);}
function validJob(v:unknown,scope:CliScope):v is CodexMainImageJob{return object(v)&&Object.keys(v).length===6&&id(v.productId)&&id(v.optionId)&&(v.profileId===null||id(v.profileId))&&typeof v.sourceKey==='string'&&v.sourceKey.startsWith(scope.ownerId+'/')&&v.sourceKey.length<=4096&&typeof v.prompt==='string'&&!!v.prompt.trim()&&v.prompt.length<=2000&&validCodexMainImage(v.image);}
type Controls={signal:AbortSignal;channel?:string};
const detailChannel=(channel:string,detail:boolean)=>detail?channel+'-detail':channel;
const failureReason=(value:unknown)=>value==='processing-failed'||value==='timed-out';
/** The live editor retains the exact upload/CAS basis. The local MCP receives
 * only this explicit request and sends back bytes, never credentials or a URL. */
export function requestCodexMainImageEdit(job:CodexMainImageJob,scope:CliScope,controls:Controls&{stage?:'main'|'detail';onApply:(image:CodexMainImage)=>Promise<CodexMainImageReceipt>;onStatus?:(message:string)=>void}):Promise<CodexMainImageReceipt>{
 const detail=controls.stage==='detail',subject=detail?'상세 이미지':'대표이미지';
 if(!validJob(job,scope))return Promise.reject(Error(`Codex ${subject} 요청을 확인해주세요.`));
 if(controls.signal.aborted)return Promise.reject(Error('이미지 요청이 취소됐습니다.'));
 const channel=new BroadcastChannel(detailChannel(controls.channel??channelName,detail)),requestId=crypto.randomUUID();let claimed=false,applying=false,settled=false;
 return new Promise((resolve,reject)=>{
  const finish=(error?:Error,result?:CodexMainImageReceipt)=>{if(settled)return;settled=true;clearTimeout(timer);controls.signal.removeEventListener('abort',cancel);channel.close();if(error)reject(error);else resolve(result!);};
  const cancel=()=>finish(Error(`Codex ${subject} 요청을 중단했습니다. 원본은 유지됩니다.`));
  const timer=setTimeout(()=>finish(Error('Codex 연결 대기 시간이 끝났습니다. 원본은 유지됩니다.')),10*60*1000);
  controls.signal.addEventListener('abort',cancel,{once:true});
  const send=(callId:string,type:string,value:unknown)=>{if(!settled)channel.postMessage({callId,requestId,scope,type,value});};
  controls.onStatus?.(`내 PC의 Codex 이미지 작업을 기다리고 있습니다. 원본 ${subject}를 보관했습니다.`);
  channel.addEventListener('message',event=>{
   const m:unknown=event.data;if(!object(m)||!same(m.scope,scope)||!uuid(m.callId)||controls.signal.aborted)return;
   if(m.type==='discover'&&!claimed&&!applying)send(m.callId as string,'offer',null);
   if(m.requestId!==requestId)return;
   if(m.type==='claim'&&!claimed&&!applying){claimed=true;const{image,...details}=job;send(m.callId as string,'source',{job:{...details,requestId},image});controls.onStatus?.(`Codex가 선택한 상품의 ${subject}를 처리하고 있습니다.`);}
   if(detail&&m.type==='fail'&&claimed&&!applying&&failureReason(m.value)){
    send(m.callId as string,'failed',null);
    finish(Error(m.value==='timed-out'?'로컬 Codex 이미지 작업 시간이 초과됐습니다.':'로컬 Codex가 업로드할 수 있는 번역 이미지를 만들지 못했습니다.'));
   }
   if(m.type==='apply'&&claimed&&!applying&&validCodexMainImage(m.value)){
    applying=true;controls.onStatus?.('Codex 결과의 상품·옵션을 확인하고 저장하고 있습니다.');
    void controls.onApply(m.value).then(result=>{send(m.callId as string,'saved',result);finish(undefined,result);},cause=>{const error=cause instanceof Error?cause:Error(`${subject} 저장 결과를 확인해주세요.`);send(m.callId as string,'error',error.message);finish(error);});
   }
  });
 });
}
/** Invoked only by a command in an already paired local CLI. A tool call
 * claims one editor request, and a repeat completion cannot dispatch twice. */
export function dispatchCodexMainImageCommand(command:string,payload:unknown,scope:CliScope,controls:Controls):Promise<Record<string,unknown>>{
 const detail=command.startsWith('detail-image/'),next=command==='main-image/next'||command==='detail-image/next';
 const complete=command==='main-image/complete'||command==='detail-image/complete',failed=command==='detail-image/fail';
 if(!object(payload)||!next&&!complete&&!failed||next&&Object.keys(payload).length
   ||!next&&(!uuid(payload.requestId)||Object.keys(payload).length!==2)
   ||complete&&!validCodexMainImage(payload.image)||failed&&!failureReason(payload.reason))return Promise.reject(Error('Codex 이미지 명령을 확인해주세요.'));
 if(controls.signal.aborted)return Promise.reject(Error('Codex 연결이 끝났습니다.'));
 const channel=new BroadcastChannel(detailChannel(controls.channel??channelName,detail)),callId=crypto.randomUUID();let selected:string|null=null;
 return new Promise((resolve,reject)=>{
  const finish=(error?:Error,result?:Record<string,unknown>)=>{clearTimeout(timer);controls.signal.removeEventListener('abort',cancel);channel.close();if(error)reject(error);else resolve(result!);};
  const cancel=()=>finish(Error('Codex 연결이 끝났습니다.'));
  const timer=setTimeout(()=>next&&!selected?finish(undefined,{job:null}):finish(Error('대기 중인 이미지 요청 또는 저장 응답을 확인하지 못했습니다.')),next?1500:50000);
  const send=(type:string,requestId?:string,value?:unknown)=>channel.postMessage({callId,scope,type,...(requestId?{requestId}:{}),...(value?{value}:{})});
  controls.signal.addEventListener('abort',cancel,{once:true});
  channel.addEventListener('message',event=>{
   const m:unknown=event.data;if(!object(m)||m.callId!==callId||!same(m.scope,scope)||!uuid(m.requestId)||controls.signal.aborted)return;
   if(next){
    if(m.type==='offer'&&!selected){selected=m.requestId as string;send('claim',selected);}
    else if(m.type==='source'&&m.requestId===selected&&object(m.value)&&object(m.value.job)&&m.value.job.requestId===selected){
     const{requestId,...job}=m.value.job;if(requestId===selected&&validJob({...job,image:m.value.image},scope))finish(undefined,m.value);
    }
   }else if(m.requestId===payload.requestId){
    if(failed&&m.type==='failed')finish(undefined,{failed:true});
    if(complete&&m.type==='error')finish(Error(typeof m.value==='string'?m.value:'이미지 저장 결과를 확인해주세요.'));
    else if(complete&&m.type==='saved'&&object(m.value)&&typeof m.value.key==='string'&&m.value.key.startsWith(scope.ownerId+'/')&&typeof m.value.productVersion==='string'&&Number.isFinite(Date.parse(m.value.productVersion)))finish(undefined,m.value);
   }
  });
  if(next)send('discover');else send(failed?'fail':'apply',payload.requestId as string,failed?payload.reason:payload.image);
 });
}
