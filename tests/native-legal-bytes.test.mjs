import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
import {validateNativeLegalBytePlan,prepareNativeLegalBytes,NATIVE_LEGAL_PLAN_FORMAT,NATIVE_LEGAL_BYTES_FORMAT} from '../extensions/supplier-hub/native-legal-bytes.mjs';
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const sha=value=>createHash('sha256').update(value).digest('hex'),jsonSha=value=>sha(canonical(value));
const pdf=index=>new TextEncoder().encode(`%PDF-1.7\nSynthetic original ${index}\n%%EOF\n`);
const types=['import_type','certificate','additional','categoryCert','adCert','msds'];
function sign(plan){plan.identityDigest=jsonSha(plan.identity);const body={...plan};delete body.planSha256;plan.planSha256=jsonSha(body);return plan;}
function fixture(code='A01464742'){
 const identity={ownerId:'owner',productId:'private-product',company:{code,name:code==='A01464742'?'와이홉':'유앤채'},categoryId:'81452',categoryPath:['스포츠/레져','합성 분류'],schemaSha256:'a'.repeat(64),sourceFingerprint:'b'.repeat(64),inputFingerprint:'c'.repeat(64),
  source:{productVersion:'2026-10-20T00:00:00.000Z',contentRevision:7,optionRevision:3,quotationRevision:5,profileId:'captured-profile',profileRevision:null},members:[{optionId:'black',optionLabel:'검정',documentIndex:0},{optionId:'gray',optionLabel:'회색',documentIndex:1}]};
 const bindings=['msds','certificate','import_type'].map(nativeType=>({format:'supplier-hub-native-legal-binding-v1',schemaSha256:identity.schemaSha256,categoryId:identity.categoryId,nativeType,
  ...(nativeType==='certificate'?{certificate:{schemaIndex:0,fieldId:'kc_source',path:['legalPage','certificates'],nameKey:'certificateName',valueKey:'certificateValue',name:'KC 인증',value:'KC-확인값'}}:{})}));
 const originals=new Map(),targets=bindings.map(binding=>({id:binding.nativeType==='certificate'?'certificate:kc_source':'bucket:'+binding.nativeType,binding}));
 const files=bindings.map((binding,index)=>{const bytes=pdf(index),originalName=index===1?'인증서 원본.pdf':'공통 원본.pdf',key=`owner/legal/private-product/legal-75600000-0000-4000-8000-${String(index+1).padStart(12,'0')}.pdf`;originals.set(key,bytes);
  return{key,originalName,transportName:binding.nativeType==='certificate'?'cert0-'+originalName:originalName,type:'pdf',contentType:'application/pdf',byteLength:bytes.length,sha256:sha(bytes),nativeType:binding.nativeType,binding,downloadPath:'/api/products/private-product/legal-documents?key='+encodeURIComponent(key),targetId:targets[index].id};});
 const plan=sign({format:NATIVE_LEGAL_PLAN_FORMAT,identity,identityDigest:null,applicability:'required',targets,files,groups:types.map(nativeType=>({nativeType,fileKeys:files.filter(file=>file.nativeType===nativeType).map(file=>file.key)})).filter(group=>group.fileKeys.length),issues:[],metadataValid:true,planSha256:null,registered:false,remoteWrites:false,submissionReady:false,transportReady:false,bytesVerified:false});
 const options={expectedIdentity:structuredClone(identity),expectedPlanSha256:plan.planSha256,readOriginal:async file=>originals.get(file.key)};
 return{plan,options,originals};
}
const resultCode=code=>error=>error.code===code;
const deferred=()=>{let resolve;return{promise:new Promise(finish=>{resolve=finish;}),get resolve(){return resolve;}};};

for(const company of ['A01464742','A01526306'])test(`${company}: exact plan and all private PDFs become immutable uploadFiles parts only after full verification`,async()=>{
 const f=fixture(company),reads=[],before=JSON.stringify(f.plan);f.options.readOriginal=async file=>{reads.push(file);assert.ok(Object.isFrozen(file));assert.ok(Object.isFrozen(file.binding));return reads.length===1?f.originals.get(file.key).buffer:f.originals.get(file.key);};
 const plan=await validateNativeLegalBytePlan(f.plan,f.options);assert.ok(Object.isFrozen(plan));assert.ok(Object.isFrozen(plan.identity.members));
 const prepared=await prepareNativeLegalBytes(f.plan,f.options);assert.equal(prepared.format,NATIVE_LEGAL_BYTES_FORMAT);assert.equal(prepared.bytesVerified,true);assert.equal(prepared.transportReady,false);assert.equal(prepared.registered,false);assert.equal(prepared.remoteWrites,false);assert.equal(prepared.submissionReady,false);
 assert.deepEqual(prepared.groups.map(group=>group.nativeType),['import_type','certificate','msds']);assert.equal(reads.length,3);assert.equal(JSON.stringify(f.plan),before);
 for(const group of prepared.groups)for(const part of group.parts){const original=f.plan.files.find(file=>file.nativeType===group.nativeType);assert.equal(part.name,'uploadFiles');assert.equal(part.originalName,original.originalName);assert.equal(part.transportName,original.transportName);
  assert.equal(part.file.type,'application/pdf');assert.equal(part.file.name,original.transportName);assert.equal(part.file.size,original.byteLength);assert.equal(sha(new Uint8Array(await part.file.arrayBuffer())),original.sha256);assert.ok(Object.isFrozen(part));assert.ok(Object.isFrozen(part.file));
  assert.deepEqual(Object.keys(part).sort(),['byteLength','contentType','file','name','originalName','sha256','transportName']);assert.equal(Object.hasOwn(part,'url'),false);assert.equal(Object.hasOwn(part,'key'),false);
 }
 assert.ok(Object.isFrozen(prepared));assert.ok(Object.isFrozen(prepared.groups));assert.equal(prepared.identity.company.name,company==='A01464742'?'와이홉':'유앤채');
});

test('changed identity and recomputed self-signed file manifests cannot replace the authenticated expected plan',async()=>{
 for(const alter of [plan=>{plan.identity.company={code:'A01526306',name:'유앤채'};},plan=>{plan.identity.source.contentRevision++;},plan=>{plan.files[0].originalName='다른 원본.pdf';plan.files[0].transportName='다른 원본.pdf';}]){
  const f=fixture();let reads=0;f.options.readOriginal=async()=>{reads++;return pdf(1);};alter(f.plan);sign(f.plan);await assert.rejects(prepareNativeLegalBytes(f.plan,f.options));assert.equal(reads,0);
 }
 const f=fixture();delete f.options.expectedPlanSha256;await assert.rejects(validateNativeLegalBytePlan(f.plan,f.options),resultCode('OPTIONS'));
});

test('strict metadata rejects malformed identity, paths, targets, aliases, groups and flags before reading an original',async()=>{
 const changes=[p=>p.identity.ownerId=12,p=>p.identity.company.name='다른 회사',p=>p.identity.categoryId='081452',p=>p.identity.source.profileRevision=-1,p=>{p.identity.source.profileId=null;p.identity.source.profileRevision=1;},
  p=>p.identity.members[1].optionId='black',p=>p.identity.members[1].documentIndex=0,p=>p.files[0].key=p.files[0].key.replace('owner/','other/'),p=>p.files[0].downloadPath='https://foreign.test/private.pdf',
  p=>p.files[0].downloadPath+='&key=other',p=>p.files[0].type='png',p=>p.files[0].contentType='text/plain',p=>p.files[0].binding.categoryId='80719',p=>p.files[0].binding.schemaSha256='e'.repeat(64),
  p=>p.files[1].binding.certificate.path=['imagePage','certificates'],p=>p.files[1].binding.certificate.schemaIndex=-1,p=>p.files[1].transportName='인증서 원본.pdf',p=>p.files[0].targetId='unknown',
  p=>p.targets.push(structuredClone(p.targets[0])),p=>p.files.push(structuredClone(p.files[0])),p=>p.groups.reverse(),p=>p.groups[0].fileKeys.push(p.files[0].key),p=>p.registered=true,p=>p.bytesVerified=true,p=>p.metadataValid=false,
  p=>p.issues.push({code:'UNCONFIRMED',message:'확인 필요'}),p=>p.files[0].originalName=' ../원본.pdf',p=>p.files[0].originalName='원본\u202e.pdf',p=>p.files[0].originalName='원본?.pdf',
  p=>p.identity.members[0].optionLabel='',p=>p.identity.members[0].optionLabel=' 앞 공백',p=>p.identity.members[0].optionLabel='가'.repeat(2001),p=>p.identity.categoryPath=Array(21).fill('분류'),p=>p.identity.categoryPath[0]='가'.repeat(501)];
 for(const change of changes){const f=fixture();let reads=0;change(f.plan);sign(f.plan);f.options.expectedIdentity=structuredClone(f.plan.identity);f.options.expectedPlanSha256=f.plan.planSha256;f.options.readOriginal=async()=>{reads++;return pdf(0);};await assert.rejects(prepareNativeLegalBytes(f.plan,f.options));assert.equal(reads,0);}
});

test('declared file count and byte limits fail before byte allocation or original reads',async()=>{
 for(const mode of ['one-file','total','count']){const f=fixture();if(mode==='one-file')f.plan.files[0].byteLength=5*1024*1024+1;if(mode==='total')f.plan.files.forEach(file=>{file.byteLength=3*1024*1024;});if(mode==='count')f.plan.files=Array.from({length:11},()=>structuredClone(f.plan.files[0]));
  sign(f.plan);f.options.expectedPlanSha256=f.plan.planSha256;let reads=0;f.options.readOriginal=async()=>{reads++;return pdf(0);};await assert.rejects(prepareNativeLegalBytes(f.plan,f.options));assert.equal(reads,0);}
 for(const applicability of ['not-applicable','unconfirmed']){const f=fixture();f.plan.applicability=applicability;f.plan.files=[];f.plan.groups=[];sign(f.plan);f.options.expectedPlanSha256=f.plan.planSha256;await assert.rejects(prepareNativeLegalBytes(f.plan,f.options));}
});

test('getters, custom prototypes, sparse arrays, symbols and dangerous JSON keys are rejected without executing getters',async()=>{
 let getters=0;
 for(const mode of ['getter','toJSON','prototype','sparse','symbol','hidden','secret','url']){const f=fixture();
  if(mode==='getter')Object.defineProperty(f.plan.files[0],'sha256',{enumerable:true,get(){getters++;return'a'.repeat(64);}});
  if(mode==='toJSON')Object.defineProperty(f.plan,'toJSON',{get(){getters++;return()=>({});}});
  if(mode==='prototype')Object.setPrototypeOf(f.plan.files[0],{foreign:true});if(mode==='sparse')delete f.plan.files[1];if(mode==='symbol')f.plan[Symbol('foreign')]=true;
  if(mode==='hidden')Object.defineProperty(f.plan,'hidden',{value:true});if(mode==='secret')Object.defineProperty(f.plan,'__proto__',{value:{},enumerable:true});if(mode==='url')f.plan.files[0].s3Link='https://foreign.test/private.pdf';
  let reads=0;f.options.readOriginal=async()=>{reads++;return pdf(0);};await assert.rejects(prepareNativeLegalBytes(f.plan,f.options));assert.equal(reads,0);
 }
 const f=fixture(),options={...f.options};Object.defineProperty(options,'expectedIdentity',{get(){getters++;return f.plan.identity;}});await assert.rejects(validateNativeLegalBytePlan(f.plan,options));assert.equal(getters,0);
});

test('identity and complete plan digests must both match their actual canonical values',async()=>{
 for(const mode of ['identity','plan']){const f=fixture();if(mode==='identity'){f.plan.identityDigest='f'.repeat(64);const body={...f.plan};delete body.planSha256;f.plan.planSha256=jsonSha(body);}else f.plan.planSha256='f'.repeat(64);f.options.expectedPlanSha256=f.plan.planSha256;
  await assert.rejects(validateNativeLegalBytePlan(f.plan,f.options),resultCode(mode==='identity'?'IDENTITY_DIGEST':'PLAN_DIGEST'));}
});

test('length, PDF magic/EOF and SHA mismatches never return partial prepared files',async()=>{
 for(const mode of ['length','magic','eof','digest','response','reader']){const f=fixture();let delivered=false,reads=0;f.options.readOriginal=async file=>{reads++;if(reads===1)return f.originals.get(file.key);if(mode==='reader')throw Error('private original unavailable');if(mode==='response')return new Response(pdf(1));
   const bytes=f.originals.get(file.key).slice();if(mode==='length')return bytes.slice(1);if(mode==='magic')bytes[0]=0;if(mode==='eof')bytes.fill(32,bytes.length-6);if(mode==='digest')bytes[12]^=1;return bytes;};
  await assert.rejects(prepareNativeLegalBytes(f.plan,f.options).then(result=>{delivered=true;return result;}));assert.equal(delivered,false);assert.equal(reads,2);
 }
});

test('original manifest and current source mutations across asynchronous reads stop the entire preparation',async()=>{
 for(const mode of ['plan','source','expected-hash','reader']){const f=fixture(),gate=deferred();let reads=0;f.options.readOriginal=async()=>{reads++;return gate.promise;};const pending=prepareNativeLegalBytes(f.plan,f.options);
  while(!reads)await new Promise(resolve=>setImmediate(resolve));if(mode==='plan')f.plan.files[1].originalName='바뀐 원본.pdf';if(mode==='source')f.options.expectedIdentity.source.contentRevision++;if(mode==='expected-hash')f.options.expectedPlanSha256='f'.repeat(64);if(mode==='reader')f.options.readOriginal=async()=>pdf(0);
  gate.resolve(pdf(0));await assert.rejects(pending,resultCode('SOURCE_CHANGED'));assert.equal(reads,1);
 }
});

test('copying an offset byte view prevents a reused reader buffer from changing a previously verified original',async()=>{
 const f=fixture(),first=f.plan.files[0],padded=new Uint8Array(first.byteLength+8);padded.set(f.originals.get(first.key),4);let reads=0;
 f.options.readOriginal=async file=>{if(++reads===1)return padded.subarray(4,4+first.byteLength);padded.fill(0);return f.originals.get(file.key);};
 const result=await prepareNativeLegalBytes(f.plan,f.options),part=result.groups.find(group=>group.nativeType===first.nativeType).parts[0];assert.equal(sha(new Uint8Array(await part.file.arrayBuffer())),first.sha256);assert.equal(padded[4],0);
});

test('an aborted preparation or immutable-reader mutation exposes no file parts',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();let reads=0;f.options.signal=controller.signal;f.options.readOriginal=async()=>{reads++;return pdf(0);};await assert.rejects(prepareNativeLegalBytes(f.plan,f.options),resultCode('ABORTED'));assert.equal(reads,0);
 const g=fixture();g.options.readOriginal=async file=>{file.downloadPath='https://foreign.test/pdf';return pdf(0);};await assert.rejects(prepareNativeLegalBytes(g.plan,g.options),TypeError);
});

test('actual server-produced long paths, nonempty option labels and certificate newlines share the exact byte validator contract',async()=>{
 const f=fixture(),identity=f.plan.identity;identity.categoryPath=Array.from({length:20},(_,index)=>String(index).padStart(2,'0')+'분류'.repeat(249));identity.members[0].optionLabel='검토'.repeat(1000);
 identity.source.productVersion='2026-10-20T00:00:00.'+'1'.repeat(35)+'Z';assert.ok(identity.source.productVersion.length>40);assert.ok(Number.isFinite(Date.parse(identity.source.productVersion)));
 f.plan.files[1].binding.certificate.value='확인한 인증번호\n두 번째 줄\t추가 값\r마지막 줄';
 const context={schemaSha256:identity.schemaSha256,categoryId:identity.categoryId,company:identity.company,targets:f.plan.targets.map(target=>({...target,label:'확인한 '+target.id})),issues:[],
  files:f.plan.files.map(file=>({key:file.key,name:file.originalName,type:file.type,byteLength:file.byteLength,sha256:file.sha256,nativeBinding:file.binding})),registered:false,remoteWrites:false,submissionReady:false};
 const model=providedOptionModule('app/native-legal-attachment-plan.ts'),plan=await model.buildNativeLegalAttachmentPlan({identity,context,applicability:'required'});assert.equal(plan.metadataValid,true,JSON.stringify(plan.issues));
 const options={...f.options,expectedIdentity:structuredClone(plan.identity),expectedPlanSha256:plan.planSha256};
 const checked=await validateNativeLegalBytePlan(plan,options);assert.equal(checked.identity.members[0].optionLabel.length,2000);assert.equal(checked.identity.categoryPath.length,20);assert.equal(checked.identity.categoryPath[0].length,500);
 assert.equal(checked.files[1].binding.certificate.value,'확인한 인증번호\n두 번째 줄\t추가 값\r마지막 줄');
 const prepared=await prepareNativeLegalBytes(plan,options);assert.equal(prepared.bytesVerified,true);assert.equal(prepared.registered,false);assert.equal(prepared.groups.flatMap(group=>group.parts).length,3);
});

test('reserved certificate row tokens inside originals cannot match a different includes-based native row',async()=>{
 for(const name of ['cert0-proof.pdf','확인-CERT009-proof.pdf','cert1-proof.pdf']){
  const f=fixture(),file=f.plan.files[1];file.binding.certificate.schemaIndex=1;file.originalName=name;file.transportName='cert1-'+name;sign(f.plan);f.options.expectedPlanSha256=f.plan.planSha256;
  let reads=0;f.options.readOriginal=async()=>{reads++;return pdf(1);};await assert.rejects(prepareNativeLegalBytes(f.plan,f.options),resultCode('ALIAS'));assert.equal(reads,0);assert.equal(file.originalName,name);
 }
 const f=fixture();f.plan.files[0].originalName='cert0-proof.pdf';f.plan.files[0].transportName='cert0-proof.pdf';sign(f.plan);f.options.expectedPlanSha256=f.plan.planSha256;
 const prepared=await prepareNativeLegalBytes(f.plan,f.options);assert.equal(prepared.groups.find(group=>group.nativeType==='msds').parts[0].originalName,'cert0-proof.pdf');
});

test('a source change between async validator completion and byte preparation cannot become the accepted baseline',async()=>{
 const f=fixture();let hashReads=0,reads=0,queued=false;f.options.readOriginal=async file=>{reads++;return f.originals.get(file.key);};
 const options=new Proxy(f.options,{getOwnPropertyDescriptor(target,key){const descriptor=Reflect.getOwnPropertyDescriptor(target,key);
  // Schedule exactly after the validator's final source/hash read. The task
  // runs before prepareNativeLegalBytes continues from its first await.
  if(key==='expectedPlanSha256'&&++hashReads===4){queued=true;queueMicrotask(()=>{target.expectedIdentity.source.contentRevision++;});}
  return descriptor;
 }});
 await assert.rejects(prepareNativeLegalBytes(f.plan,options),resultCode('SOURCE_CHANGED'));assert.equal(queued,true);assert.equal(reads,0);
});
