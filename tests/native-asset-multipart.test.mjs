import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareNativeLegalBytes} from '../extensions/supplier-hub/native-legal-bytes.mjs';
import {prepareNativeAssetMultipart,nativeAssetMultipartCanonical,nativeAssetUploadPlanSha256,validateNativeAssetUploadDescriptors,NATIVE_ASSET_UPLOAD_PLAN_FORMAT,NATIVE_ASSET_MULTIPART_FORMAT} from '../extensions/supplier-hub/native-asset-multipart.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex'),jsonSha=value=>sha(nativeAssetMultipartCanonical(value));
const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'));
// One white pixel encoded locally with sharp; no decoder is needed by this suite.
const jpeg=new Uint8Array(Buffer.from("/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpAB//Z",'base64'));
const pdf=new TextEncoder().encode('%PDF-1.7\nSynthetic immutable original\n%%EOF\n');
const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const wire={MAIN:{path:['imagePage','images','mainImage']},ADDITIONAL:{path:['imagePage','images','additionalImage']},SIZECHART:{path:['imagePage','images','sizeChartImage']},DETAIL:{path:['imagePage','details','detailedImage']},
 LABEL:{path:['imagePage','images','labelImages'],nameKey:'labelImageType',valueKey:'labelImageFiles',name:'제품 한글 표시사항 라벨 또는 도안 이미지'}};
const clone=value=>JSON.parse(JSON.stringify(value));
function signLegal(plan){plan.identityDigest=jsonSha(plan.identity);const {planSha256:ignored,...body}=plan;void ignored;plan.planSha256=jsonSha(body);return plan;}
async function resign(f){f.plan.identityDigest=jsonSha(f.plan.identity);f.plan.planSha256=await nativeAssetUploadPlanSha256(f.plan);f.options.expectedPlanSha256=f.plan.planSha256;return f;}
async function fixture(company=companies[0],legal=true){
 const identity={ownerId:'owner',productId:'private-product',company:{...company},categoryId:'81452',categoryPath:['합성 분류','상품'],schemaSha256:'a'.repeat(64),sourceFingerprint:'b'.repeat(64),inputFingerprint:'c'.repeat(64),
  source:{productVersion:'2026-10-20T00:00:00.000Z',contentRevision:5,optionRevision:8,quotationRevision:9,profileId:'captured-category',profileRevision:null},members:[{optionId:'second-option-first',optionLabel:'두 번째 옵션 먼저',documentIndex:0},{optionId:'first-option-second',optionLabel:'첫 번째 옵션 나중',documentIndex:1}]};
 const target={docId:758001,requestId:'new-request-758',packetDigest:'d'.repeat(64),preparedBodySha256:'e'.repeat(64),createOperationId:'new-request-758:create',baselineDocIds:[100,101]};
 const originals=new Map(),images=['MAIN','ADDITIONAL','ADDITIONAL','SIZECHART','LABEL','DETAIL'].map((imageType,index)=>{
  const key='owner/original-'+index+'.png',slotIndex=imageType==='ADDITIONAL'?(index===1?1:0):0;originals.set(key,png.slice());
  return{key,originalName:`원문 사진 ${index}.png`,transportName:`${imageType}-${index}-${sha(png)}.png`,imageType,contentType:'image/png',byteLength:png.length,sha256:sha(png),
   references:identity.members.map(member=>({optionId:member.optionId,documentIndex:member.documentIndex,wire:clone(wire[imageType]),slotIndex}))};
 });
 let nativeLegalAttachmentPlan=null,legalPreparation;
 if(legal){
  const binding={format:'supplier-hub-native-legal-binding-v1',schemaSha256:identity.schemaSha256,categoryId:identity.categoryId,nativeType:'certificate',
   certificate:{schemaIndex:1,fieldId:'kc-source',path:['legalPage','certificates'],nameKey:'certificateName',valueKey:'certificateValue',name:'KC 인증',value:'합성 인증값'}};
  const key='owner/legal/private-product/legal-75800000-0000-4000-8000-000000000001.pdf',originalName='인증서 원본.pdf',file={key,originalName,transportName:'cert1-'+originalName,type:'pdf',contentType:'application/pdf',byteLength:pdf.length,sha256:sha(pdf),nativeType:'certificate',binding,targetId:'certificate:kc-source',downloadPath:'/api/products/private-product/legal-documents?key='+encodeURIComponent(key)};
  originals.set(key,pdf.slice());nativeLegalAttachmentPlan=signLegal({format:'yoofam-native-legal-attachment-plan-v1',identity:clone(identity),identityDigest:null,applicability:'required',targets:[{id:file.targetId,binding}],files:[file],groups:[{nativeType:'certificate',fileKeys:[key]}],issues:[],metadataValid:true,planSha256:null,registered:false,remoteWrites:false,submissionReady:false,transportReady:false,bytesVerified:false});
  legalPreparation=await prepareNativeLegalBytes(nativeLegalAttachmentPlan,{expectedIdentity:clone(identity),expectedPlanSha256:nativeLegalAttachmentPlan.planSha256,readOriginal:async file=>originals.get(file.key)});
 }
 const plan={format:NATIVE_ASSET_UPLOAD_PLAN_FORMAT,identity,identityDigest:null,target,images,nativeLegalAttachmentPlan,planSha256:null,registered:false,remoteWrites:false,submissionReady:false,transportReady:false};
 const reads=[],options={expectedIdentity:clone(identity),expectedTarget:clone(target),expectedPlanSha256:null,readImage:async image=>{reads.push(image.key);assert.ok(Object.isFrozen(image));assert.ok(Object.isFrozen(image.references));return originals.get(image.key);},...(legalPreparation?{legalPreparation}:{})};
 return resign({plan,options,originals,reads});
}
function mutableLegal(prepared){return{...prepared,groups:prepared.groups.map(group=>({...group,parts:group.parts.map(part=>({...part}))}))};}

test('long generated original image names use unchanged short multipart transport aliases',async()=>{
 const f=await fixture(),file=f.plan.images[0],old=file.key;
 file.originalName=`free-image-00000000-0000-4000-8000-000000000001-${'a'.repeat(64)}-${'b'.repeat(64)}.png`;
 assert.equal(file.originalName.length,181);file.key=`owner/${file.originalName}`;f.originals.set(file.key,f.originals.get(old));f.originals.delete(old);await resign(f);
 const prepared=await prepareNativeAssetMultipart(f.plan,f.options),request=prepared.requests.find(row=>row.imageType===file.imageType);
 assert.equal(request.body.get('additionalImageFiles').name,file.transportName);assert.equal(prepared.bytesVerified,true);assert.equal(prepared.remoteWrites,false);
 for(const bad of ['../unsafe.png','a'.repeat(509)+'.png','unsafe\u202e.png']){const invalid=await fixture();invalid.plan.images[0].originalName=bad;await resign(invalid);
  await assert.rejects(()=>prepareNativeAssetMultipart(invalid.plan,invalid.options));assert.equal(invalid.reads.length,0);}
});

for(const company of companies)test(`${company.code}: all image types and exact schema-row PDF aliases become fresh multipart requests, never a remote submission`,async()=>{
 const f=await fixture(company),before=JSON.stringify(f.plan),originals=[...f.originals].map(([key,bytes])=>[key,sha(bytes)]),oldFetch=globalThis.fetch;let fetches=0;
 globalThis.fetch=async()=>{fetches++;throw Error('Network forbidden');};
 try{
  const prepared=await prepareNativeAssetMultipart(f.plan,f.options);assert.equal(prepared.format,NATIVE_ASSET_MULTIPART_FORMAT);assert.deepEqual(prepared.identity,f.plan.identity);assert.deepEqual(prepared.target,f.plan.target);assert.equal(prepared.identity.source.profileRevision,null);
  for(const flag of ['targetVerified','actualUploadVerified','transportReady','registered','remoteWrites','submissionReady'])assert.equal(prepared[flag],false);assert.equal(prepared.bytesVerified,true);assert.equal(fetches,0);assert.equal(f.reads.length,6);
  assert.ok(Object.isFrozen(prepared));assert.ok(Object.isFrozen(prepared.filenameBindings));assert.ok(Object.isFrozen(prepared.identity.members));assert.ok(Object.isFrozen(prepared.requests[0].files[0]));
  assert.deepEqual(prepared.requests.map(row=>row.kind==='image'?row.imageType:row.nativeType),['MAIN','ADDITIONAL','SIZECHART','LABEL','DETAIL','certificate']);
  for(const request of prepared.requests){assert.equal(request.method,'POST');assert.equal(Object.hasOwn(request,'headers'),false,'the browser owns the multipart Content-Type boundary');assert.equal(Object.hasOwn(request,'credentials'),false);assert.equal(Object.hasOwn(request,'url'),false);
   const field=request.kind==='image'?'additionalImageFiles':'uploadFiles',entries=[...request.body.entries()];assert.ok(entries.length);assert.deepEqual(entries.map(([name])=>name),entries.map(()=>field));
   assert.equal(request.path,request.kind==='image'?`/sr/draft/api/upload-images/758001?imageType=${request.imageType}`:'/sr/draft/api/upload-files-by-type/758001?fileType=certificate');
   for(let index=0;index<entries.length;index++){const file=entries[index][1],metadata=request.files[index];assert.equal(file.name,metadata.transportName);assert.equal(file.type,metadata.contentType);assert.equal(file.size,metadata.byteLength);assert.equal(sha(new Uint8Array(await file.arrayBuffer())),metadata.sha256);}
  }
  const additional=prepared.filenameBindings.filter(row=>row.wire.path.at(-1)==='additionalImage');assert.equal(additional.length,2);for(const row of additional)assert.equal(row.value,[f.plan.images[2].transportName,f.plan.images[1].transportName].join(','),'slot order, rather than file iteration or option display order, controls the wire');
  for(const binding of prepared.filenameBindings){assert.equal(binding.documentIndex,f.plan.identity.members.find(member=>member.optionId===binding.optionId).documentIndex);assert.ok(!binding.value.includes('https:'));assert.ok(!binding.value.includes('owner/'));}
  assert.equal(prepared.requests.at(-1).files[0].transportName,'cert1-인증서 원본.pdf','certificate schema row 1 does not follow document/option 0');
  assert.deepEqual(prepared.reads,[{kind:'image',method:'GET',path:'/sr/draft/api/get-images-by-id/758001'},{kind:'legal',nativeType:'certificate',method:'POST',path:'/sr/draft/api/get-files-by-type/758001?fileType=certificate',body:{}}]);
  assert.equal(JSON.stringify(f.plan),before);assert.deepEqual([...f.originals].map(([key,bytes])=>[key,sha(bytes)]),originals);
 }finally{globalThis.fetch=oldFetch;}
});

test('independent expected owner/company/source/plan and new-document checkpoint reject replacement before reading bytes',async()=>{
 for(const mutate of [f=>f.plan.identity.ownerId='other',f=>f.plan.identity.company=companies[1],f=>f.plan.identity.source.quotationRevision++,f=>f.plan.identity.sourceFingerprint='f'.repeat(64),f=>f.plan.target.docId=101,f=>f.plan.target.requestId='other-request']){
  const f=await fixture(undefined,false),expected=f.options.expectedPlanSha256;mutate(f);f.plan.planSha256=await nativeAssetUploadPlanSha256(f.plan);assert.notEqual(f.plan.planSha256,expected);await assert.rejects(prepareNativeAssetMultipart(f.plan,f.options));assert.equal(f.reads.length,0);
 }
 for(const field of ['expectedIdentity','expectedTarget','expectedPlanSha256']){const f=await fixture(undefined,false);delete f.options[field];await assert.rejects(prepareNativeAssetMultipart(f.plan,f.options));assert.equal(f.reads.length,0);}
});

test('even a newly signed plan cannot refer to an old document alias, malformed identity, unproven image type, ambiguous wire or unsupported image format',async()=>{
 const mutations=[p=>p.identity.ownerId=12,p=>p.identity.company.name='다른 회사',p=>p.identity.members[1].optionId=p.identity.members[0].optionId,p=>p.identity.members[1].documentIndex=0,p=>{p.identity.source.profileId=null;p.identity.source.profileRevision=1;},
  p=>p.target.baselineDocIds.push(String(p.target.docId)),p=>p.target.docId='000100',p=>p.target.packetDigest=[p.target.packetDigest],p=>p.target.preparedBodySha256=[p.target.preparedBodySha256],p=>p.target.createOperationId='another:create',p=>p.target.docId='../../old',p=>p.images[0].key='other/raw.png',p=>p.images[0].imageType='HTML_CONTENT',p=>p.images[0].contentType='image/webp',p=>p.images[0].sha256=[p.images[0].sha256],p=>p.images[0].transportName='bad,name.png',p=>p.images[0].transportName='../unsafe.png',
  p=>p.images[0].references[0].optionId='unselected',p=>p.images[0].references[0].documentIndex=1,p=>p.images[0].references[0].wire.path=['legalPage','images','mainImage'],p=>p.images[0].references[0].slotIndex=1,p=>p.images[4].references[0].wire.name='guessed label',
  p=>p.images[1].references[0].slotIndex=2,p=>p.images[1].references.push(clone(p.images[1].references[0])),p=>p.images[1].transportName=p.images[0].transportName,p=>p.images.push(clone(p.images[0])),p=>p.images[0].byteLength=10*1024*1024+1,p=>p.registered=true];
 for(const mutate of mutations){const f=await fixture(undefined,false);mutate(f.plan);await resign(f);f.options.expectedIdentity=clone(f.plan.identity);f.options.expectedTarget=clone(f.plan.target);await assert.rejects(prepareNativeAssetMultipart(f.plan,f.options));assert.equal(f.reads.length,0);}
});

test('native SIZECHART and LABEL multi-file slots preserve filenames, and a real JPEG is copied without conversion',async()=>{
 const f=await fixture(undefined,false);
 for(const imageType of ['SIZECHART','LABEL']){const original=f.plan.images.find(file=>file.imageType===imageType),extra=clone(original);extra.key=`owner/extra-${imageType}.jpg`;extra.originalName=`추가 ${imageType}.jpg`;extra.transportName=`${imageType}-extra.jpg`;extra.contentType='image/jpeg';extra.byteLength=jpeg.length;extra.sha256=sha(jpeg);extra.references.forEach(ref=>ref.slotIndex=1);f.plan.images.push(extra);f.originals.set(extra.key,jpeg.slice());}
 await resign(f);const prepared=await prepareNativeAssetMultipart(f.plan,f.options);
 for(const imageType of ['SIZECHART','LABEL']){const files=f.plan.images.filter(file=>file.imageType===imageType);const matches=prepared.filenameBindings.filter(binding=>binding.wire.path.at(-1)===(imageType==='SIZECHART'?'sizeChartImage':'labelImages'));assert.equal(matches.length,2);for(const binding of matches)assert.equal(binding.value,files.map(file=>file.transportName).join(','));const request=prepared.requests.find(row=>row.imageType===imageType),parts=[...request.body.values()];assert.equal(parts.length,2);assert.equal(parts[1].type,'image/jpeg');assert.equal(sha(new Uint8Array(await parts[1].arrayBuffer())),sha(jpeg));}
 for(const mutation of ['trailer','segment','dimensions']){const bad=await fixture(undefined,false),image=bad.plan.images[0],bytes=jpeg.slice();if(mutation==='trailer')bytes[bytes.length-1]=0;if(mutation==='segment'){bytes[4]=255;bytes[5]=255;}if(mutation==='dimensions'){const sof=bytes.findIndex((value,index)=>value===255&&bytes[index+1]===192);assert.ok(sof>0);bytes[sof+5]=0;bytes[sof+6]=0;}
  image.key='owner/broken.jpg';image.originalName='broken.jpg';image.transportName='broken.jpg';image.contentType='image/jpeg';image.byteLength=bytes.length;image.sha256=sha(bytes);await resign(bad);bad.options.readImage=async()=>bytes;await assert.rejects(prepareNativeAssetMultipart(bad.plan,bad.options),error=>error.code==='IMAGE_HEADER');}
});

test('empty, count and total-byte bounds stop before private reads; all parts must verify before any request is returned',async()=>{
 const empty=await fixture(undefined,false);empty.plan.images=[];await resign(empty);await assert.rejects(prepareNativeAssetMultipart(empty.plan,empty.options),error=>error.code==='EMPTY');assert.equal(empty.reads.length,0);
 const tooMany=await fixture(undefined,false);tooMany.plan.images=Array.from({length:151},()=>clone(tooMany.plan.images[0]));await resign(tooMany);await assert.rejects(prepareNativeAssetMultipart(tooMany.plan,tooMany.options));assert.equal(tooMany.reads.length,0);
 const tooLarge=await fixture(undefined,false);tooLarge.plan.images.push({...clone(tooLarge.plan.images[0]),key:'owner/extra.png',transportName:'extra.png',references:[{...clone(tooLarge.plan.images[5].references[0]),slotIndex:1}]});tooLarge.plan.images[6].imageType='DETAIL';tooLarge.plan.images.forEach(file=>{file.byteLength=10*1024*1024;});await resign(tooLarge);await assert.rejects(prepareNativeAssetMultipart(tooLarge.plan,tooLarge.options),error=>error.code==='BYTE_LIMIT');assert.equal(tooLarge.reads.length,0);
 const corrupt=await fixture(undefined,false);corrupt.originals.get(corrupt.plan.images.at(-1).key)[30]^=1;await assert.rejects(prepareNativeAssetMultipart(corrupt.plan,corrupt.options),error=>error.code==='BYTE_DIGEST');assert.equal(corrupt.reads.length,6);
});

test('private buffers are copied; malformed PNG/JPEG and shared/wrong-length bytes fail without source replacement or file conversion',async()=>{
 for(const kind of ['truncated','header','shared','wrong-length']){const f=await fixture(undefined,false),image=f.plan.images[0];let bytes=png.slice();if(kind==='truncated')bytes=bytes.slice(0,24);if(kind==='header')bytes[0]=0;if(kind==='shared'){bytes=new Uint8Array(new SharedArrayBuffer(png.length));bytes.set(png);}if(kind==='wrong-length')bytes=bytes.slice(1);
  if(kind!=='wrong-length'){image.byteLength=bytes.length;image.sha256=sha(bytes);await resign(f);}f.options.readImage=async()=>bytes;await assert.rejects(prepareNativeAssetMultipart(f.plan,f.options));}
 const f=await fixture(undefined,false),prepared=await prepareNativeAssetMultipart(f.plan,f.options);for(const bytes of f.originals.values())bytes.fill(0);for(const request of prepared.requests)for(const [,file]of request.body)assert.equal(sha(new Uint8Array(await file.arrayBuffer())),sha(png));
});

test('input/authority/reader/signal changes or cancellation across an injected read cannot publish stale parts',async()=>{
 for(const kind of ['plan','expected','target','reader','signal','abort']){const f=await fixture(undefined,false),controller=new AbortController();f.options.signal=controller.signal;let reads=0;f.options.readImage=async()=>{reads++;await Promise.resolve();if(kind==='plan')f.plan.identity.inputFingerprint='9'.repeat(64);if(kind==='expected')f.options.expectedIdentity.source.optionRevision++;if(kind==='target')f.options.expectedTarget.docId++;if(kind==='reader')f.options.readImage=async()=>png;if(kind==='signal')f.options.signal=new AbortController().signal;if(kind==='abort')controller.abort();return png;};await assert.rejects(prepareNativeAssetMultipart(f.plan,f.options));assert.equal(reads,1);}
});

test('accessors and special metadata are rejected without executing getters or private readers',async()=>{
 for(const mode of ['plan','option','array','toJSON']){const f=await fixture(undefined,false);let accessed=0;if(mode==='plan')Object.defineProperty(f.plan,'identity',{get(){accessed++;return f.options.expectedIdentity;},enumerable:true});if(mode==='option')Object.defineProperty(f.options,'expectedIdentity',{get(){accessed++;return f.plan.identity;},enumerable:true});if(mode==='array')Object.defineProperty(f.plan.images,'0',{get(){accessed++;return{};},enumerable:true});if(mode==='toJSON')f.plan.toJSON=()=>{accessed++;return{};};await assert.rejects(prepareNativeAssetMultipart(f.plan,f.options));assert.equal(accessed,0);assert.equal(f.reads.length,0);}
});

test('PDF preparation must match the exact pinned plan and still contain its verified original bytes and cert-row alias',async()=>{
 for(const kind of ['plan','alias','blob','content','accessor']){const f=await fixture();f.options.legalPreparation=mutableLegal(f.options.legalPreparation);const p=f.options.legalPreparation,part=p.groups[0].parts[0];let accessed=0;
  if(kind==='plan')p.planSha256='f'.repeat(64);if(kind==='alias')part.transportName='cert0-인증서 원본.pdf';if(kind==='blob')part.file=new Blob([pdf.slice(1)],{type:'application/pdf'});if(kind==='content'){const changed=pdf.slice();changed[20]^=1;part.file=new Blob([changed],{type:'application/pdf'});}if(kind==='accessor')Object.defineProperty(part,'transportName',{get(){accessed++;return 'forged.pdf';},enumerable:true});
  await assert.rejects(prepareNativeAssetMultipart(f.plan,f.options));assert.equal(accessed,0);
  assert.equal(f.reads.length,0,'invalid legal metadata/original is rejected before image bytes are read');
 }
});

test('upload/list descriptor validation consumes only proven array fields and never claims byte persistence or a receipt',async()=>{
 const f=await fixture(),prepared=await prepareNativeAssetMultipart(f.plan,f.options);
 for(const request of prepared.requests){const rows=request.files.map(file=>request.kind==='image'?{imageName:file.transportName,imageUrl:'/image/uploaded.png',host:'static.coupangcdn.com',s3Link:'opaque/'+file.transportName,mainImage:request.imageType==='MAIN'}:{fileName:file.transportName,fileType:request.nativeType,s3Link:'opaque/'+file.transportName});
  const reply=validateNativeAssetUploadDescriptors(rows,{kind:request.kind,expectedFiles:request.files});assert.equal(reply.metadataMatched,true);for(const key of ['remoteBytesVerified','actualUploadVerified','registered','remoteWrites','submissionReady'])assert.equal(reply[key],false);assert.ok(Object.isFrozen(reply.descriptors));
  for(const change of [value=>value.pop(),value=>value[0].s3Link='',value=>value[0][request.kind==='image'?'imageName':'fileName']='foreign.png',value=>value.push(clone(value[0])),value=>{if(request.kind==='image')value[0].imageUrl='javascript:alert(1)';else value[0].fileType='msds';}]){const bad=clone(rows);change(bad);assert.throws(()=>validateNativeAssetUploadDescriptors(bad,{kind:request.kind,expectedFiles:request.files}));}
  assert.throws(()=>validateNativeAssetUploadDescriptors({data:rows},{kind:request.kind,expectedFiles:request.files}),'an unobserved HTTP envelope is not guessed');
  if(request.kind==='image')for(const imageUrl of ['https://user:pass@static.coupangcdn.com/image.png','/\\external.example/image.png','//external.example/image.png']){const bad=clone(rows);bad[0].imageUrl=imageUrl;assert.throws(()=>validateNativeAssetUploadDescriptors(bad,{kind:'image',expectedFiles:request.files}));}
 }
});
