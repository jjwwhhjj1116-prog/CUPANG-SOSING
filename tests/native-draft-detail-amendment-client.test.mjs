import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,observation,plain,descriptor,reserved,lookup,anchor,amendmentId,scope} from './helpers/native-draft-detail-amendment.mjs';

test('amendment begin capability requires the actually installed version and explicit feature flag before reservation',async()=>{
 for(const capability of [{ok:true,version:'2.1.87',nativeDraftDetailAmendment:true},{ok:true,version:'2.1.88'},{ok:true,version:'2.1.88',nativeDraftDetailAmendment:true}]){
  const h=fixture(),client=h.load('app/native-draft-detail-amendment-client.ts'),before=[...h.stored];h.capability=capability;
  const action=()=>client.assertNativeDraftDetailAmendmentCapability(new AbortController().signal);
  if(capability.version==='2.1.88'&&capability.nativeDraftDetailAmendment)await action();else await assert.rejects(action);
  assert.deepEqual([...h.stored],before);assert.equal(h.sent.length,1);assert.equal(h.sent[0].type,'PING');
 }
});

test('amendment reservation upgrades to its verified descriptor without replacing the original pending',async()=>{
 const h=fixture(),pending=h.load('app/native-draft-detail-amendment-pending.ts'),signal=new AbortController().signal,before=h.stored.get(h.parentKey);
 assert.equal(pending.readNativeDraftDetailAmendmentPending(scope),null);
 await pending.claimNativeDraftDetailAmendmentPending(reserved,signal);assert.deepEqual(plain(pending.readNativeDraftDetailAmendmentPending(scope)),reserved);
 await pending.claimNativeDraftDetailAmendmentPending(descriptor,signal);assert.deepEqual(plain(pending.readNativeDraftDetailAmendmentPending(scope)),descriptor);
 pending.assertNativeDraftDetailAmendmentCurrent(descriptor,observation());assert.equal(h.stored.get(h.parentKey),before);assert.equal(h.stored.size,2);
 assert.ok([...h.stored.values()].every(value=>value.length<=4096&&!value.includes('jsonDocument')));
});

test('a real rich review identity reads only the original owner company product amendment scope',async()=>{
 const h=fixture(),pending=h.load('app/native-draft-detail-amendment-pending.ts');await pending.claimNativeDraftDetailAmendmentPending(descriptor,new AbortController().signal);
 const rich={identity:{...scope.identity,categoryId:'103689',schemaVersion:'actual-schema',profileId:'saved-profile',fingerprint:'a'.repeat(64),source:'collection',members:[{key:'option-a'}]}};
 assert.deepEqual(plain(pending.readNativeDraftDetailAmendmentPending(rich)),descriptor);
 assert.equal(pending.readNativeDraftDetailAmendmentPending({identity:{...rich.identity,productId:'different-product'}}),null);
});

test('foreign, corrupt and replaced amendment reservations retain every original record and fail closed',async()=>{
 for(const change of [value=>{value.lookup.ownerId='other';},value=>{value.lookup.company={code:'A01464742',name:'와이홉'};},value=>{value.lookup.requestId='33333333-3333-4333-8333-333333333333';},value=>{value.lookup.parentOriginalBodySha256='9'.repeat(64);}]){
  const h=fixture(),pending=h.load('app/native-draft-detail-amendment-pending.ts'),value=plain(reserved),before=[...h.stored];change(value);
  await assert.rejects(pending.claimNativeDraftDetailAmendmentPending(value,new AbortController().signal));assert.deepEqual([...h.stored],before);
 }
 const h=fixture(),pending=h.load('app/native-draft-detail-amendment-pending.ts');await pending.claimNativeDraftDetailAmendmentPending(reserved,new AbortController().signal);
 const key=pending.nativeDraftDetailAmendmentPendingKey(scope);h.stored.set(key,'{bad');assert.throws(()=>pending.readNativeDraftDetailAmendmentPending(scope));assert.equal(h.stored.get(key),'{bad');
});

test('current amendment ownership also admits its exact mutating apply result without treating it as an inspect',async()=>{
 const h=fixture(),pending=h.load('app/native-draft-detail-amendment-pending.ts');await pending.claimNativeDraftDetailAmendmentPending(descriptor,new AbortController().signal);
 const applied=observation({state:'validated',sequence:8,previewDigest:'8'.repeat(64),latest:{reviewDigest:'8'.repeat(64),sourcePlanSha256:'9'.repeat(64),originalBodySha256:'a'.repeat(64),preparedBodySha256:'b'.repeat(64),identityDigest:'c'.repeat(64),packetDigest:'d'.repeat(64)},validatedSteps:[2,3,4,5],readOnly:false,execution:{create:0,upload:1,update:1,validate:4,submit:0}});
 assert.doesNotThrow(()=>pending.assertNativeDraftDetailAmendmentCurrent(descriptor,applied));
});

test('amendment bridge accepts only its exact origin/window/correlation and preserves the readonly observation',async()=>{
 const h=fixture(),client=h.load('app/native-draft-detail-amendment-client.ts'),request={action:'inspect',amendmentId,lookup};
 h.reply=message=>{h.emit(message,observation(),{origin:'https://untrusted.example'});h.emit(message,observation(),{source:{}});h.emit(message,observation(),{data:{channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId:'other',result:{ok:true,result:observation()}}});h.emit(message,observation());};
 assert.deepEqual(plain(await client.runNativeDraftDetailAmendment(request,new AbortController().signal)),observation());assert.equal(h.sent.length,1);assert.deepEqual(h.sent[0].payload,request);
});

test('a lost amendment lifecycle ACK never retries and retains its durable parent and child reservations',async()=>{
 const h=fixture(),pending=h.load('app/native-draft-detail-amendment-pending.ts');await pending.claimNativeDraftDetailAmendmentPending(descriptor,new AbortController().signal);const before=[...h.stored];
 const client=h.load('app/native-draft-detail-amendment-client.ts'),running=client.runNativeDraftDetailAmendment({action:'review',amendmentId,anchor},new AbortController().signal);
 for(let index=0;index<20&&!h.sent.length;index++)await new Promise(resolve=>setImmediate(resolve));assert.equal(h.sent.length,1);h.advance();
 await assert.rejects(running,error=>error.uncertain===true);assert.equal(h.sent.length,1);assert.deepEqual([...h.stored],before);
});

test('a changed current company cannot adopt an otherwise correlated amendment read',async()=>{
 const h=fixture(),client=h.load('app/native-draft-detail-amendment-client.ts');h.reply=message=>{h.actor.company={code:'A01464742',name:'와이홉'};h.emit(message,observation());};
 await assert.rejects(client.runNativeDraftDetailAmendment({action:'inspect',amendmentId,anchor},new AbortController().signal));assert.equal(h.sent.length,1);
});
