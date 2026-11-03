import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeReviewFixture,companies,plain} from './helpers/native-source-review.mjs';
import {cropClientFixture} from './helpers/free-image-crop.mjs';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
import {createProductDocumentPacket,validateProductDocumentPacket} from '../extensions/supplier-hub/product-document.mjs';

const styleIssue='VISION_BACKGROUND_COMPLEX: 주변 배경색이 일정하지 않아 단색 채움이 어울리지 않을 수 있습니다. 배경색과 영역을 직접 확인한 뒤 선택해주세요.';
const row=(issue=styleIssue)=>({id:'vision-1',text:'中文',translated:'한국어',issue,box:{x:0,y:0,width:1,height:1},confidence:0,selected:true,erase:true,
 translationProvenance:'generated',background:'#ffffff',foreground:'#111111',fontSize:1});
async function fixture(company=companies[0],role='main'){
 const f=await nativeReviewFixture(company),renderer=cropClientFixture({imageWidth:1,imageHeight:1}),api=f.h.load('app/api/products/[id]/image-text/route.ts'),calls=[];
 const get=f.h.bindings.FILES.get;f.h.bindings.FILES.get=async key=>{const object=await get(key);if(!object)return object;const bytes=new Uint8Array(f.h.objects.get(key));return{...object,body:new Response(bytes).body,arrayBuffer:async()=>bytes.slice().buffer};};
 const view=await f.fields(),input=role==='main'?'mainImage':'additionalImages',fieldKey=f.byWire(['imagePage','images',input==='mainImage'?'mainImage':'additionalImage']),optionId=f.sourcePlan.identity.members[0].optionId;
 const cell=view.resolved.rows.find(row=>row.optionId===optionId).fields[fieldKey],sourceKey=cell.value.split('\n')[0],target={kind:'quotation',profileId:f.profile.id,optionId,input,fieldKey,slotIndex:0,revision:view.revision,inputFingerprint:view.inputFingerprint,optionRevision:view.optionRevision,value:cell.value};
 const request=async(url,init={})=>{calls.push({url,method:init.method??'GET'});if(url.startsWith('/api/files/'))return new Response(f.h.objects.get(decodeURIComponent(url.slice('/api/files/'.length))),{headers:{'content-type':'image/png'}});return api[init.method==='POST'?'POST':'GET'](new Request('https://app.test'+url,init),f.context);};
 const signal=new AbortController().signal,loaded=await renderer.client.readFreeImageSource(f.id,view.productVersion,sourceKey,role,signal,request,target);
 const report=async()=>{const response=await f.h.load('app/api/products/[id]/submission-review/route.ts').GET(new Request('https://app.test'+f.base+'/submission-review'+f.query),f.context);assert.equal(response.status,200);return response.json();};
 return{...f,renderer,loaded,signal,request,calls,view,target,report};
}

for(const company of companies)for(const role of ['main','additional'])test(`${company.code} ${role}: explicit successful erase render/apply clears only handled style review in the current native plan`,async()=>{
 const f=await fixture(company,role);try{
  const before=await f.report(),input=[row()],inputCopy=plain(input),sources=new Map(f.keys.map(key=>[key,Buffer.from(f.h.objects.get(key))]));assert.equal(f.sourcePlan.metadataValid,true);
  const rendered=await f.renderer.client.renderFreeImageTranslation(f.loaded,input,f.signal);assert.ok(f.renderer.operations.some(operation=>operation[0]==='fill'));
  const applied=await f.renderer.client.applyFreeImageTranslation(rendered,f.signal,f.request);assert.equal(applied.applied,true);assert.deepEqual(plain(input),inputCopy);
  const after=await f.report();assert.deepEqual(after.issues.filter(issue=>issue.kind==='error'),before.issues.filter(issue=>issue.kind==='error'),'unrelated required-field fixture errors stay exact');
  const sidecar=JSON.parse(new TextDecoder().decode(f.h.objects.get(applied.key+'.edit.json')));assert.equal(sidecar.document.regions[0].text,'中文');assert.equal(sidecar.document.regions[0].erase,true);
  const plan=await f.source();assert.equal(plan.metadataValid,true,JSON.stringify(plan.issues.filter(issue=>issue.level==='error')));assert.equal(sidecar.document.regions[0].issue,null);assert.deepEqual(f.h.network,[]);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);
  assert.equal((await f.h.load('app/free-image-edit-review.ts').readFreeImageEditReview(f.h.bindings.FILES,'owner',f.id,applied.key)).status,'clear');
  const view=await f.fields(),review=await f.model.compileNativeSupplierHubProductDocument({productId:f.id,profileId:f.profile.id,quotationView:view,sourcePlan:plan,ownerId:'owner'});await validateProductDocumentPacket(await createProductDocumentPacket(review));
  const expected=f.target.value.split('\n');expected[0]=applied.key;assert.equal(view.resolved.rows.find(row=>row.optionId===f.target.optionId).fields[f.target.fieldKey].value,expected.join('\n'));
  for(const [key,bytes]of sources){assert.ok(f.h.objects.has(key),'original remains present');assert.deepEqual(Buffer.from(f.h.objects.get(key)),bytes,key);}
 }finally{f.close();}
});

test('only complete fixed style diagnostics and their exact combinations qualify; provider/unknown fragments never do',()=>{
 const only=providedOptionModule('app/free-image-vision-style.ts').isOnlyVisionStyleIssue,fit='VISION_TEXT_FIT: 한국어를 읽을 수 있는 크기로 넣기 어렵습니다. 문구와 영역을 직접 조정한 뒤 선택해주세요.';
 for(const value of [styleIssue,fit,styleIssue+' '+fit])assert.equal(only(value),true);
 for(const value of [null,'','VISION_BACKGROUND_COMPLEX','unknown '+styleIssue,styleIssue+' unknown',styleIssue+' '+styleIssue,'번역 검증을 통과하지 못했습니다. 원문과 영역을 확인해주세요. '+styleIssue,styleIssue+' '])assert.equal(only(value),false,value);
});

test('unselected, provider and unknown issues remain saved and block the exact currently selected native output',async()=>{
 const f=await fixture();try{let view=f.view;
  for(const change of ['unselected','provider','unknown']){
   if(change!=='unselected'){view=await f.fields();const value=view.resolved.rows.find(row=>row.optionId===f.target.optionId).fields[f.target.fieldKey].value;f.loaded=await f.renderer.client.readFreeImageSource(f.id,view.productVersion,value,'main',f.signal,f.request,{...f.target,value,revision:view.revision,inputFingerprint:view.inputFingerprint});}
   const unresolved={...row(change==='provider'?'번역 제공자 확인 필요 '+styleIssue:change==='unknown'?styleIssue+' unknown':styleIssue),id:'pending',selected:change!=='unselected'},input=[{...row(),id:'handled'},unresolved],before=plain(input);
   const rendered=await f.renderer.client.renderFreeImageTranslation(f.loaded,input,f.signal);assert.equal(rendered.editDocument.regions[0].issue,null);assert.equal(rendered.editDocument.regions[1].issue,unresolved.issue);assert.deepEqual(plain(input),before);
   const applied=await f.renderer.client.applyFreeImageTranslation(rendered,f.signal,f.request),read=await f.h.load('app/free-image-edit-review.ts').readFreeImageEditReview(f.h.bindings.FILES,'owner',f.id,applied.key);assert.equal(read.status,'unresolved');assert.equal(read.unresolvedRegions,1);
   const plan=await f.source();assert.equal(plan.metadataValid,false);assert.ok(plan.issues.some(issue=>issue.code==='FREE_IMAGE_TRANSLATION_UNRESOLVED'));
  }
  assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('selected text operations and Stage5 quotation/workspace documents preserve their style issues',async()=>{
 for(const kind of ['text','detail','workspace']){const h=cropClientFixture(),image=h.image();image.source=plain(image.source);
  if(kind==='workspace')image.source={...image.source,role:'detail',workspaceTarget:{kind:'detail-workspace',profileId:null,optionId:'option',photoId:'photo',revision:1,digest:'d'.repeat(64),bindingSha256:'c'.repeat(64)}};
  else image.source={...image.source,role:kind==='detail'?'detail':'main',quotationTarget:{kind:'quotation',profileId:null,optionId:'option',input:kind==='detail'?'detailImages':'mainImage',fieldKey:'image',slotIndex:0,revision:1,inputFingerprint:'b'.repeat(64),optionRevision:1,bindingSha256:'c'.repeat(64),value:image.source.sourceKey}};
  const input=[{...row(),box:{x:0,y:0,width:20,height:12},erase:kind!=='text',fontSize:3}],before=plain(input),rendered=await h.client.renderFreeImageTranslation(image,input,new AbortController().signal);assert.equal(rendered.editDocument.regions[0].issue,styleIssue,kind);assert.deepEqual(plain(input),before);
 }
});

test('render failure, failed PNG encoding and cancellation cannot return a resolved document or mutate live issues',async()=>{
 for(const kind of ['paint','encoding','abort']){const h=cropClientFixture(),image=h.image(),controller=new AbortController(),create=h.document.createElement;image.source={...plain(image.source),role:'main',quotationTarget:{kind:'quotation',profileId:null,optionId:'option',input:'mainImage',fieldKey:'image',slotIndex:0,revision:1,inputFingerprint:'b'.repeat(64),optionRevision:1,bindingSha256:'c'.repeat(64),value:image.source.sourceKey}};
  h.document.createElement=tag=>{const canvas=create(tag),encode=canvas.toBlob;if(kind==='paint')canvas.getContext('2d').fillRect=()=>{throw Error('synthetic paint failure');};else canvas.toBlob=(callback,type)=>{if(kind==='abort'){controller.abort(Error('synthetic canceled'));encode(callback,type);}else callback(null);};return canvas;};
  const input=[row()],before=plain(input);let output;await assert.rejects(async()=>{output=await h.client.renderFreeImageTranslation(image,input,controller.signal);});assert.equal(output,undefined);assert.deepEqual(plain(input),before);
 }
});

test('stale source/slot/revision and a failed apply acknowledgement never adopt a normalized preview as the current output',async()=>{
 for(const kind of ['source','slot','revision','ack']){const f=await fixture();try{
  const rendered=await f.renderer.client.renderFreeImageTranslation(f.loaded,[row()],f.signal),before=await f.fields();assert.equal(rendered.editDocument.regions[0].issue,null);
  if(kind==='source')rendered.source={...plain(rendered.source),sourceKey:f.keys[1]};if(kind==='slot')rendered.source={...plain(rendered.source),quotationTarget:{...rendered.source.quotationTarget,slotIndex:1}};
  if(kind==='revision'){const reply=await f.h.route(f.fieldsPath,{method:'PUT',body:{expectedRevision:before.revision,expectedInputFingerprint:before.inputFingerprint,changes:[{optionId:null,fieldKey:'searchTags',value:'명시적 합성 수정'}]}});assert.equal(reply.status,200);}
  const request=kind==='ack'?async()=>{throw Error('synthetic failed ACK before dispatch');}:f.request;await assert.rejects(f.renderer.client.applyFreeImageTranslation(rendered,f.signal,request));
  const current=await f.fields();assert.equal(current.resolved.rows.find(row=>row.optionId===f.target.optionId).fields[f.target.fieldKey].value,f.target.value);assert.equal([...f.h.objects.keys()].some(key=>key.startsWith('owner/free-image-')),false);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}}
});

test('a committed apply with lost ACK remains client-uncertain until the same normalized document and PNG recover by reads',async()=>{
 const f=await fixture();try{
  const rendered=await f.renderer.client.renderFreeImageTranslation(f.loaded,[row()],f.signal);let posted;
  await assert.rejects(f.renderer.client.applyFreeImageTranslation(rendered,f.signal,async(url,init)=>{const response=await f.request(url,init);assert.equal(response.status,200);posted=await response.json();throw Error('synthetic lost ACK after CAS');}),error=>error.uncertain===true);
  assert.equal((await f.fields()).resolved.rows.find(row=>row.optionId===f.target.optionId).fields[f.target.fieldKey].value,posted.key);
  const before=f.state(),objects=f.objectState(),source=JSON.stringify(rendered.source),document=JSON.stringify(rendered.editDocument);
  const recovered=await f.renderer.client.recoverFreeImageTranslation(rendered,f.signal,f.request);assert.equal(recovered.applied,true);assert.equal(recovered.key,posted.key);assert.equal(f.state(),before);assert.equal(f.objectState(),objects);assert.equal(JSON.stringify(rendered.source),source);assert.equal(JSON.stringify(rendered.editDocument),document);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});
