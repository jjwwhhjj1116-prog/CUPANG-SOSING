import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewFixture as dataFixture} from './helpers/selected-image-review.mjs';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
import {freeImageEditFixture} from './helpers/free-image-edit-api.mjs';
import {cropClientFixture} from './helpers/free-image-crop.mjs';
const copy=value=>JSON.parse(JSON.stringify(value));
const model=providedOptionModule('app/selected-image-review.ts');
function reviewFixture(){const h=dataFixture();return{...h,model,review:model.createSelectedImageReview(h.scope,h.view,h.image,'zh','배경 검토 필요')};}
test('bounded completed-review parser retains exact metadata and rejects image objects, unknown fields and malformed authority',()=>{
 const h=reviewFixture();assert.ok(h.review);assert.deepEqual(copy(h.model.parseSelectedImageReview(h.review)),copy(h.review));
 for(const mutate of [r=>r.canvas={},r=>r.source.editorSource={resultKey:r.source.sourceKey,resultSha256:'a'.repeat(64),documentSha256:'b'.repeat(64)},r=>r.configuration.model='other',r=>r.result.blocks[0].box.width=999,r=>r.message='x'.repeat(131073),r=>r.requestId='bad',r=>r.sourceLanguage='ko',r=>r.company.name='다른회사']){const row=copy(h.review);mutate(row);assert.equal(h.model.parseSelectedImageReview(row),null);}
});
test('harmless label/quotation clocks rebind to fresh server target while preserving null collection profile and nonzero second-option slot',()=>{
 const h=reviewFixture(),view=copy(h.view);view.productVersion='2026-10-06T00:00:02.000Z';view.revision=7;view.contentRevision=8;view.inputFingerprint='d'.repeat(64);
 const target=h.model.rebindSelectedImageReview(h.review,h.scope,view);assert.equal(target.profileId,null);assert.equal(target.optionId,'second');assert.equal(target.slotIndex,1);assert.equal(target.revision,7);assert.equal(target.inputFingerprint,'d'.repeat(64));assert.equal(target.bindingSha256,undefined);
 const image={...h.image,source:{...copy(h.image.source),productVersion:view.productVersion,contentRevision:view.contentRevision,quotationTarget:{...target,bindingSha256:'e'.repeat(64)}}};assert.ok(h.model.matchSelectedImageReview(h.review,image,target));
});
test('current owner/company, complete sibling order/value, schema/provenance/category/options and source pixels stay exact',()=>{
 for(const kind of ['owner','company','category','option','included','order','value','schema','source','revision']){const h=reviewFixture(),view=copy(h.view),scope=copy(h.scope);
  if(kind==='owner')scope.ownerId='other';if(kind==='company')scope.company={code:'A01464742',name:'와이홉'};if(kind==='category')view.categoryContext.categoryId='other';if(kind==='option')view.resolved.rows[1].optionId='other';if(kind==='included')view.resolved.rows[1].included=false;if(kind==='order')view.resolved.rows.reverse();if(kind==='value')view.resolved.rows[1].fields.additionalImages.value='owner/original.png\nowner/second.png';if(kind==='schema')view.resolved.schema.fields[0].maxItems=20;if(kind==='source')view.resolved.rows[1].fields.additionalImages.source='manual-option';if(kind==='revision')view.optionRevision++;
  assert.throws(()=>h.model.rebindSelectedImageReview(h.review,scope,view),/변경/,kind);
 }
 for(const kind of ['key','sha','width','role','config']){const h=reviewFixture(),image={...h.image,source:copy(h.image.source)},target=h.model.rebindSelectedImageReview(h.review,h.scope,h.view);if(kind==='key')image.source.sourceKey='owner/other.png';if(kind==='sha')image.source.sourceSha256='f'.repeat(64);if(kind==='width')image.source.width++;if(kind==='role')image.source.role='main';if(kind==='config')image.visionConfiguration={...h.image.visionConfiguration,configured:false};assert.throws(()=>h.model.matchSelectedImageReview(h.review,image,target));}
});

test('a handoff is copied bounded metadata and never retains pixels or mutable provider objects',()=>{
 const h=reviewFixture(),before=copy(h.review);assert.ok(h.review);assert.equal('canvas'in h.review,false);assert.equal('blob'in h.review,false);assert.equal('visionFetcher'in h.review,false);
 h.image.visionResult.blocks[0].text='mutated provider result';h.image.source.quotationTarget.value='mutated original target';h.image.visionConfiguration.paidAllowed=false;h.view.categoryContext.categoryPath.push('changed');
 assert.deepEqual(copy(h.review),before);const parsed=h.model.parseSelectedImageReview(h.review);parsed.result.blocks[0].text='mutated parsed copy';assert.deepEqual(copy(h.review),before);
 for(const patch of [{blob:{}},{output:{}},{url:'blob:fake'}, {schema:'x'.repeat(32769)}, {options:'x'.repeat(131073)}])assert.equal(h.model.parseSelectedImageReview({...before,...patch}),null);
});

test('fresh binding is server-owned, while old target clocks, requested profile or sibling slots cannot be retagged',()=>{
 const h=reviewFixture(),view=copy(h.view);Object.assign(view,{revision:8,inputFingerprint:'d'.repeat(64),productVersion:'2026-10-06T00:00:04.000Z'});
 const original=copy(h.review),target=h.model.rebindSelectedImageReview(h.review,h.scope,view);assert.equal(Object.hasOwn(target,'bindingSha256'),false);
 const fresh={...h.image,source:{...copy(h.image.source),productVersion:view.productVersion,quotationTarget:{...target,bindingSha256:'f'.repeat(64)}}};
 assert.deepEqual(copy(h.model.matchSelectedImageReview(h.review,fresh,target)),original);assert.deepEqual(copy(h.review),original);
 assert.throws(()=>h.model.matchSelectedImageReview(h.review,{...fresh,source:copy(h.image.source)},target));
 for(const mutate of [source=>{delete source.quotationTarget.bindingSha256;},source=>{source.quotationTarget.profileId='other-profile';},source=>{source.quotationTarget.slotIndex=0;},source=>{source.quotationTarget.value='owner/other-sibling.png\nowner/original.png';},source=>{source.quotationTarget.fieldKey='other-field';},source=>{source.quotationTarget.optionId='first';}]){
  const source=copy(fresh.source);mutate(source);assert.throws(()=>h.model.matchSelectedImageReview(h.review,{...fresh,source},target));
 }
});

test('queryless collection scope retains null even with a recorded profile ID, while explicit profiles remain exact',()=>{
 for(const explicit of [false,true]){const h=reviewFixture(),view=copy(h.view),image={...h.image,source:copy(h.image.source)};
  view.categoryContext.profileId='saved-profile';view.categoryContext.source=explicit?'profile':'collection';image.source.quotationTarget.profileId=explicit?'saved-profile':null;
  const review=h.model.createSelectedImageReview(h.scope,view,image,'zh','검토');assert.ok(review);const latest=copy(view);latest.revision++;latest.inputFingerprint='e'.repeat(64);
  const target=h.model.rebindSelectedImageReview(review,h.scope,latest);assert.equal(target.profileId,explicit?'saved-profile':null);
  latest.categoryContext.profileId='other-profile';assert.throws(()=>h.model.rebindSelectedImageReview(review,h.scope,latest));
 }
});

test('captured primary wire and canonical sibling fields must stay linked with identical full values and sources',()=>{
 const h=reviewFixture(),view=copy(h.view),image={...h.image,source:copy(h.image.source)},wire={...view.resolved.schema.fields[0],id:'captured-images',hubInput:'additionalImages',hubWire:{path:['imagePage','images','additionalImage']}};
 view.resolved.schema.fields.push(wire);for(const row of view.resolved.rows)row.fields[wire.id]=copy(row.fields.additionalImages);image.source.quotationTarget.fieldKey=wire.id;
 const review=h.model.createSelectedImageReview(h.scope,view,image,'zh','검토');assert.ok(review);const latest=copy(view);latest.revision++;latest.inputFingerprint='e'.repeat(64);
 assert.equal(h.model.rebindSelectedImageReview(review,h.scope,latest).fieldKey,wire.id);
 for(const mutate of [v=>{v.resolved.rows[1].fields.additionalImages.value='owner/original.png';},v=>{v.resolved.rows[1].fields.additionalImages.source='manual-common';},v=>{v.resolved.schema.fields[1].hubWire.path=['imagePage','details','detailedImage'];},v=>{v.resolved.schema.fields.push({...wire,id:'duplicate-wire'});}]){
  const changed=copy(latest);mutate(changed);assert.throws(()=>h.model.rebindSelectedImageReview(review,h.scope,changed));
 }
});

test('the normal two-hundred-option boundary includes the separate null common row',()=>{
 const h=reviewFixture(),view=copy(h.view),cell=copy(view.resolved.rows[1].fields);
 view.resolved.rows=[{optionId:null,included:true,optionLabel:'공통',fields:copy(cell)},...Array.from({length:200},(_,index)=>({optionId:index===0?'second':'option-'+index,included:true,optionLabel:'옵션 '+index,fields:copy(cell)}))];
 const review=h.model.createSelectedImageReview(h.scope,view,h.image,'zh','검토');assert.ok(review,'the existing200-option limit excludes the null common row');
 const latest=copy(view);latest.revision++;latest.inputFingerprint='e'.repeat(64);assert.equal(h.model.rebindSelectedImageReview(review,h.scope,latest).optionId,'second');
 latest.resolved.rows.push({optionId:'option-201',included:true,fields:copy(cell)});assert.throws(()=>h.model.rebindSelectedImageReview(review,h.scope,latest));
});

for(const input of ['mainImage','additionalImages'])test(`${input}: old completed Vision request permits explicit preview and actual API apply with a fresh current source after quote clocks advance`,async()=>{
 const company={code:'A01464742',name:'와이홉'},f=await freeImageEditFixture(company),renderer=cropClientFixture({imageWidth:3,imageHeight:2}),signal=new AbortController().signal;
 try{
  const contract=f.h.load('app/image-text-vision.ts'),route=f.h.load('app/api/products/[id]/image-text/route.ts'),context={params:Promise.resolve({id:f.id})},role=input==='mainImage'?'main':'additional';let modelCalls=0;
  Object.assign(f.h.bindings,{SOURCEFLOW_IMAGE_TEXT_PROVIDER:'workers-ai-vision',SOURCEFLOW_IMAGE_TEXT_MODEL:contract.IMAGE_TEXT_VISION_MODEL,SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED:'true'});
  f.h.bindings.AI.run=async()=>{modelCalls++;return{response:{decision:'foreign-text',blocks:[{original:'中文',translated:'한국어',box:{x:0,y:0,width:2,height:1}}]}};};
  const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
  const opened=await json(await f.source(input)),requestId=crypto.randomUUID(),result=await json(await route.POST(new Request('https://app.test'+f.base+'/image-text',{method:'POST',headers:{origin:'https://app.test','content-type':'application/json','sec-fetch-site':'same-origin'},
   body:JSON.stringify({action:'vision',source:opened.source,sourceLanguage:'zh',configuration:opened.visionConfiguration,requestId,inspectionPolicy:contract.IMAGE_TEXT_INSPECTION_POLICY})}),context));
  const before=await f.read(),scope={ownerId:'owner',company},image={source:opened.source,width:3,height:2,visionRequestId:requestId,visionConfiguration:opened.visionConfiguration,visionResult:result.result,visionStyleIssues:['VISION_BACKGROUND_COMPLEX']},review=model.createSelectedImageReview(scope,before,image,'zh','직접 배경 검토 필요');assert.ok(review);
  const rows=()=>JSON.stringify(f.h.sqlite.prepare('SELECT * FROM image_vision_requests ORDER BY request_id').all()),visionRows=rows();
  await json(await f.h.route(f.qurl,{method:'PUT',body:{expectedRevision:before.revision,expectedInputFingerprint:before.inputFingerprint,changes:[{optionId:null,fieldKey:'searchTags',value:'합성 검토 태그'}]}}));
  const current=await f.read(),target=model.rebindSelectedImageReview(review,scope,current),calls=[];
  const request=async(url,init={})=>{calls.push({url,method:init.method??'GET'});if(url.startsWith('/api/files/'))return new Response(f.h.objects.get(decodeURIComponent(url.slice('/api/files/'.length))),{headers:{'content-type':'image/png'}});
   return route[init.method==='POST'?'POST':'GET'](new Request('https://app.test'+url,init),context);};
  const loaded=await renderer.client.readFreeImageSource(f.id,current.productVersion,opened.source.sourceKey,role,signal,request,target),retained=model.matchSelectedImageReview(review,loaded,target);
  assert.notEqual(loaded.source.quotationTarget.revision,review.source.quotationTarget.revision);assert.notEqual(loaded.source.quotationTarget.inputFingerprint,review.source.quotationTarget.inputFingerprint);
  Object.assign(loaded,{visionRequestId:retained.requestId,visionResult:retained.result,visionExecution:{requests:0,cached:true}});assert.equal(modelCalls,1);assert.ok(calls.every(call=>call.method==='GET'));
  const block=retained.result.blocks[0],regions=[{id:block.id,text:block.text,box:block.box,confidence:95,selected:true,translated:block.translated,translationProvenance:'generated',issue:null,background:'#ffffff',foreground:'#111111',fontSize:1,erase:true}];
  const rendered=await renderer.client.renderFreeImageTranslation(loaded,regions,signal);assert.equal(modelCalls,1);assert.equal(rows(),visionRows);assert.equal(rendered.editDocument.regions[0].text,block.text);
  const sourceRows=f.sourceRows(),saved=await renderer.client.applyFreeImageTranslation(rendered,signal,request);assert.equal(saved.applied,true);assert.equal(saved.quotationRevision,current.revision+1);assert.equal(f.sourceRows(),sourceRows);
  assert.equal(modelCalls,1);assert.equal(rows(),visionRows);assert.equal(calls.filter(call=>call.method==='POST').length,1);assert.equal(review.requestId,requestId);
  const after=await f.read(),cell=after.resolved.rows.find(row=>row.optionId===f.selected).fields[target.fieldKey];const expected=target.value.split('\n');expected[target.slotIndex]=saved.key;assert.equal(cell.value,expected.join('\n'));
 }finally{f.close();}
});
