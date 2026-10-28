import test from 'node:test';
import assert from 'node:assert/strict';
import {runReservedSegments} from '../app/supplier-hub-reserved-work.mjs';
const expected={requestId:'original-request',docId:2347603,packetDigest:'p',preparedBodySha256:'b'};
const reply=(sequence,state='update-requested',extra={})=>({...expected,state,recovered:true,draftProof:{checkpointSequence:sequence},...extra});
test('one click continues verified file segments and then the same original body',async()=>{
 let calls=0,checks=0;const progress=[];
 const result=await runReservedSegments({expected,signal:new AbortController().signal,send:async()=>reply(++calls,calls===4?'updated':'update-requested'),fresh:async()=>{checks++;},onProgress:n=>progress.push(n)});
 assert.equal(result.state,'updated');assert.equal(calls,4);assert.equal(checks,3);assert.deepEqual(progress,[1,2,3]);
});
for(const failure of ['lost-ack','error','fresh','abort','document','stale'])test(`reserved work never continues after ${failure}`,async()=>{
 const controller=new AbortController();let calls=0;
 const operation=()=>runReservedSegments({expected,signal:controller.signal,send:async()=>{
  calls++;if(failure==='lost-ack')throw Error('missing ACK');if(failure==='abort')controller.abort();
  if(failure==='document')return reply(calls,'update-requested',{docId:2347604});
  if(failure==='stale')return reply(1);
  return reply(calls,'update-requested',failure==='error'?{error:{code:'UNKNOWN_UPLOAD'}}:{});
 },fresh:async()=>{if(failure==='fresh')throw Error('changed source');}});
 if(failure==='error'){assert.ok((await operation()).error);assert.equal(calls,1);}
 else{await assert.rejects(operation);assert.equal(calls,failure==='stale'?2:1);}
});
test('a bounded segment count cannot become an indefinite repeat',async()=>{
 let calls=0;await assert.rejects(runReservedSegments({expected,signal:new AbortController().signal,maxSegments:3,send:async()=>reply(++calls),fresh:async()=>{}}));assert.equal(calls,3);
});
