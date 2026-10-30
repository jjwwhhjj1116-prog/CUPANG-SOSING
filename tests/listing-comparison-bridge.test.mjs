import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash,randomUUID,webcrypto} from 'node:crypto';

const content=fs.readFileSync(new URL('../extensions/supplier-hub/handoff-content.js',import.meta.url),'utf8');
const start=content.indexOf('async function saveListingComparisonsInApp(message){'),end=content.indexOf('function sourceStoredReceipt(',start);
assert.ok(start>=0&&end>start,'the shipped comparison bridge function exists');
const bridge=content.slice(start,end)+'\nthis.saveListingComparisonsInApp=saveListingComparisonsInApp;';
const origin='https://sourceflow.jjwwhhjj1116.workers.dev';
const scope={ownerId:'member-1',company:{code:'A01526306',name:'유앤채'}};
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const sourcePayload=message=>({batchId:message.batchId,captureId:message.captureId,listingUrl:message.listingUrl,items:message.items});
const digest=message=>createHash('sha256').update(canonical(sourcePayload(message))).digest('hex');
const makeMessage=()=>({type:'YOOFAM_SAVE_LISTING_COMPARISONS',batchId:randomUUID(),captureId:randomUUID(),expectedOwnerId:scope.ownerId,company:{...scope.company},listingUrl:'https://s.1688.com/selloffer/offer_search.htm?keywords=hat',items:[{offerId:'886034098637',sourceUrl:'https://detail.1688.com/offer/886034098637.html',title:'원문 상품',thumbnail:'https://cbu01.alicdn.com/img/one.jpg',displayPrice:'¥ 0.28'},{offerId:'963861920029',sourceUrl:'https://detail.1688.com/offer/963861920029.html',title:'두 번째 상품',thumbnail:'',displayPrice:''}]});
const makeReceipt=message=>({format:'yoofam-listing-comparison-receipt-v1',captureId:message.captureId,batchId:message.batchId,ownerId:message.expectedOwnerId,company:{...message.company},stored:true,revision:7,storedCount:1,existingCount:message.items.length-1,itemOfferIds:message.items.map(item=>item.offerId),payloadSha256:digest(message),recordedAt:new Date().toISOString()});

function fixture(options={}){
 const calls=[],updates=[],timers=new Map(),location={origin};let serial=0,contextReads=0,cancelled=0,released=0;
 const globals={URL,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,AbortController,structuredClone,Date,Error,crypto:webcrypto,location,
  setTimeout(fn,delay){const id=++serial;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},
  async readCurrentCatalogContext(){contextReads++;if(options.context)return options.context(contextReads,location);return structuredClone(scope);},
  async fetch(path,init){calls.push({path,init});const body=JSON.parse(init.body),message={batchId:body.batchId,captureId:body.captureId,listingUrl:body.listingUrl,items:body.items,expectedOwnerId:body.expectedOwnerId,company:body.expectedCompany};
   await options.onFetch?.({path,init,location,message});if(options.fetchError)throw options.fetchError;
   const result={ok:true,receipt:makeReceipt(message)};options.alterResult?.(result,message);
   const bytes=options.bytes||new TextEncoder().encode(JSON.stringify(result)),chunks=options.chunks||[bytes.slice(0,19),bytes.slice(19,53),bytes.slice(53)];let offset=0;
   return {ok:options.ok??true,url:options.url??origin+path,redirected:options.redirected??false,headers:{get:()=>options.contentType??'application/json; charset=utf-8'},
    body:options.noBody?null:{getReader(){return{async read(){if(options.readError)throw options.readError;return offset<chunks.length?{done:false,value:chunks[offset++]}:{done:true};},async cancel(){cancelled++;},releaseLock(){released++;}};}}};
  },
  window:{postMessage(message,target){updates.push({message,target});}},
 };
 vm.runInNewContext(bridge,globals);
 return{run:globals.saveListingComparisonsInApp,calls,updates,timers,location,get contextReads(){return contextReads;},get cancelled(){return cancelled;},get released(){return released;}};
}
const throwsBeforePost=async(message,pattern)=>{const h=fixture();await assert.rejects(h.run(message),error=>{assert.notEqual(error.uncertain,true);return pattern?pattern.test(error.message):true;});assert.equal(h.calls.length,0);assert.equal(h.updates.length,0);assert.equal(h.timers.size,0);};

test('classic comparison bridge posts one canonical scoped payload and validates exact stored counts, IDs and digest',async()=>{
 const h=fixture(),message=makeMessage(),original=structuredClone(message),result=await h.run(message);
 assert.equal(result.ok,true);assert.equal(h.calls.length,1);assert.deepEqual(message,original);const {path,init}=h.calls[0];assert.equal(path,'/api/operations/listing-candidates');assert.equal(init.method,'POST');assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.signal.aborted,false);
 assert.deepEqual(JSON.parse(init.body),{expectedOwnerId:message.expectedOwnerId,expectedCompany:message.company,...sourcePayload(message)});
 assert.equal(result.receipt.payloadSha256,digest(message));assert.equal(result.receipt.storedCount,1);assert.equal(result.receipt.existingCount,1);assert.deepEqual([...result.receipt.itemOfferIds],message.items.map(item=>item.offerId));
 assert.equal(h.contextReads,2);assert.equal(h.released,1);assert.equal(h.timers.size,0);assert.equal(h.updates.length,1);assert.equal(h.updates[0].target,origin);assert.equal(h.updates[0].message.channel,'YOOFAM_OPERATIONS_UPDATED');assert.equal(h.updates[0].message.revision,7);
});

test('bridge snapshots payload and company before async scope checks, preventing mutable request drift',async()=>{
 const message=makeMessage(),original=structuredClone(message),h=fixture({context(index){if(index===1){message.items[0].offerId='1';message.items[0].title='changed';message.company.name='changed';}return structuredClone(scope);}});
 const result=await h.run(message);assert.equal(result.receipt.payloadSha256,digest(original));const posted=JSON.parse(h.calls[0].init.body);assert.equal(posted.items[0].offerId,original.items[0].offerId);assert.equal(posted.expectedCompany.name,scope.company.name);
});

test('before-POST member, company code, company name or origin changes prevent the write',async()=>{
 for(const changed of [{...scope,ownerId:'member-2'},{...scope,company:{...scope.company,code:'OTHER'}},{...scope,company:{...scope.company,name:'다른 회사'}}]){
  const h=fixture({context:()=>changed});await assert.rejects(h.run(makeMessage()),error=>error.uncertain!==true&&/회원·회사/.test(error.message));assert.equal(h.calls.length,0);assert.equal(h.updates.length,0);
 }
 const moved=fixture({context(_index,location){location.origin='https://other.example';return structuredClone(scope);}});await assert.rejects(moved.run(makeMessage()),error=>error.uncertain!==true);assert.equal(moved.calls.length,0);
});

test('after-POST scope or origin drift is uncertain and never broadcasts a saved result',async()=>{
 for(const options of [{context:index=>index===1?structuredClone(scope):{...scope,ownerId:'member-2'}},{context:index=>index===1?structuredClone(scope):{...scope,company:{...scope.company,name:'변경됨'}}},{onFetch:({location})=>{location.origin='https://other.example';}},{context:index=>{if(index===2)throw Error('context response lost');return structuredClone(scope);}}]){
  const h=fixture(options);await assert.rejects(h.run(makeMessage()),error=>error.uncertain===true);assert.equal(h.calls.length,1);assert.equal(h.updates.length,0);assert.equal(h.timers.size,0);
 }
});

test('mismatched receipt identities, hashes, counts, item order or schema remain uncertain',async()=>{
 const alterations=[
  value=>{value.receipt.captureId=randomUUID();},value=>{value.receipt.batchId=randomUUID();},value=>{value.receipt.ownerId='other';},value=>{value.receipt.company.code='OTHER';},value=>{value.receipt.company.extra=true;},
  value=>{value.receipt.payloadSha256='0'.repeat(64);},value=>{value.receipt.storedCount=0;},value=>{value.receipt.existingCount=-1;},value=>{value.receipt.itemOfferIds.reverse();},value=>{value.receipt.itemOfferIds.push('1');},
  value=>{value.receipt.format='other';},value=>{value.receipt.stored=false;},value=>{value.receipt.revision=0;},value=>{value.receipt.revision=1.1;},value=>{value.receipt.recordedAt='invalid';},value=>{value.receipt.recordedAt=new Date(Date.now()+60000).toISOString();},value=>{value.receipt.extra=true;},value=>{delete value.receipt.payloadSha256;},
 ];
 for(const alterResult of alterations){const h=fixture({alterResult});await assert.rejects(h.run(makeMessage()),error=>error.uncertain===true&&/선택한 상품·회원·회사/.test(error.message));assert.equal(h.calls.length,1);assert.equal(h.updates.length,0);assert.equal(h.timers.size,0);}
});

test('lost ACK, non-JSON, redirected, wrong URL, missing body, failed stream and server error never trigger retry',async()=>{
 const cases=[{fetchError:Error('connection lost after save')},{contentType:'text/html'},{redirected:true},{url:origin+'/login'},{noBody:true},{readError:Error('stream lost')},{ok:false,alterResult:result=>{result.ok=false;result.error='write not acknowledged';}},{bytes:new Uint8Array([0xff,0xff])}];
 for(const options of cases){const h=fixture(options);await assert.rejects(h.run(makeMessage()),error=>error.uncertain===true);assert.equal(h.calls.length,1);assert.equal(h.updates.length,0);assert.equal(h.timers.size,0);}
});

test('response streaming stops above 64 KiB, cancels the reader and releases the lock',async()=>{
 const h=fixture({chunks:[new Uint8Array(32768),new Uint8Array(32769),new Uint8Array(1)]});await assert.rejects(h.run(makeMessage()),error=>error.uncertain===true&&/한도를 넘었/.test(error.message));assert.equal(h.cancelled,1);assert.equal(h.released,1);assert.equal(h.calls.length,1);assert.equal(h.updates.length,0);assert.equal(h.timers.size,0);
});

test('pending POST timeout marks its signal aborted and cannot be accepted as a save',async()=>{
 let holder;const h=fixture({async onFetch(){const timer=[...h.timers.values()][0];assert.equal(timer.delay,20000);timer.fn();}});holder=h;
 await assert.rejects(holder.run(makeMessage()),error=>error.uncertain===true);assert.equal(h.calls[0].init.signal.aborted,true);assert.equal(h.updates.length,0);assert.equal(h.timers.size,0);
});

test('invalid request shape, IDs and canonical source identity never post',async()=>{
 const changes=[message=>{message.type='OTHER';},message=>{message.batchId='not-uuid';},message=>{message.captureId=randomUUID().toUpperCase();},message=>{message.extra=true;},message=>{message.items=[];},message=>{message.items=Array.from({length:61},(_,index)=>({...message.items[0],offerId:String(index+1),sourceUrl:'https://detail.1688.com/offer/'+(index+1)+'.html'}));},message=>{message.items[0].offerId='0';},message=>{message.items[0].offerId='123456789012345678901';},message=>{message.items[0].sourceUrl+='?tracking=1';},message=>{message.items.push({...message.items[0]});},message=>{message.items[0].skuId='fabricated';},message=>{delete message.items[0];}];
 for(const change of changes){const message=makeMessage();change(message);await throwsBeforePost(message);}
});

test('invalid literal bounds, thumbnail URLs and listing scope never post',async()=>{
 const changes=[message=>{message.expectedOwnerId='';},message=>{message.expectedOwnerId='x'.repeat(101);},message=>{message.company.code='';},message=>{message.company.name='x'.repeat(101);},message=>{message.listingUrl='http://s.1688.com/selloffer/offer_search.htm';},message=>{message.listingUrl='https://detail.1688.com/offer/886034098637.html';},message=>{message.listingUrl+='&x='+'a'.repeat(6000);},message=>{message.items[0].title='';},message=>{message.items[0].title='x'.repeat(501);},message=>{message.items[0].title=' title';},message=>{message.items[0].title='ti\ntle';},message=>{message.items[0].displayPrice=' ¥1';},message=>{message.items[0].displayPrice='x'.repeat(121);},message=>{message.items[0].thumbnail='javascript:alert(1)';},message=>{message.items[0].thumbnail='https://evil.example/thumbnail.jpg';},message=>{message.items[0].thumbnail='https://cbu01.alicdn.com/image.jpg#private';},message=>{message.items[0].thumbnail='https://user:secret@cbu01.alicdn.com/image.jpg';}];
 for(const change of changes){const message=makeMessage();change(message);await throwsBeforePost(message);}
});
