import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
async function json(response){assert.equal(response.status,200,await response.clone().text());return response.json();}
function png(width,height){
 const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;};
 const chunk=(name,data)=>{const type=Buffer.from(name),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([length,type,data,crc]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(height*(width*4+1)))),chunk('IEND',Buffer.alloc(0))]);
}
/** Actual private handlers, quote CAS, image-job store and SQLite. Initial
 * recorded-source intake and generated pixels are intercepted local fixtures;
 * no real source/provider/Hub request or existing user product is touched. */
async function fixture(company=schemaCompanies[0],{implicitProfile=false}={}){
 const backend=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
 try{
  const snapshot={...hubSchemaSnapshot(company),inputBindings:'couplus-paths-v1'},schema=JSON.parse(snapshot.schemaString);
  schema.properties.imagePage.properties.images={type:'object',properties:{additionalImage:{type:'string',title:'추가이미지'}}};
  schema.properties.imagePage.properties.details={type:'object',properties:{detailedImage:{type:'string',title:'상세이미지'},htmlProductDetailContent:{type:'string',title:'상세 HTML'}}};snapshot.schemaString=JSON.stringify(schema);
  const profile=await backend.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'합성 추가이미지 AI 검수',categoryId:snapshot.categoryId,categoryPath:schemaPath,hubSchema:snapshot,template:null,mappings:[]});
  backend.context.category=profile;backend.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(backend.context),'job');await backend.intake();
  const product=plain(backend.sqlite.prepare('SELECT * FROM products').get()),base='/api/products/'+product.id,endpoint=base+'/quotation-fields'+(implicitProfile?'':'?profileId='+profile.id);
  const read=()=>backend.route(endpoint).then(json),tools=backend.load('app/quotation-image-targets.ts');let view=await read();
  const ids=view.resolved.rows.flatMap(row=>row.optionId?[row.optionId]:[]),id=ids[0],keys=view.imageKeys.slice(0,3);assert.equal(keys.length,3);
  const patch=tools.optionImageChanges(view,id,{additionalImages:keys.join('\n'),detailImages:keys[2],detailHtml:'<p>선택 옵션 상세 HTML 유지</p>'});
  await json(await backend.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:patch}}));
  view=await read();Object.assign(product,plain(backend.sqlite.prepare('SELECT * FROM products').get()));
  const field=tools.optionImageTargets(view.resolved.schema.fields).additionalImages,source=keys[1];backend.objects.set(source,png(2,2));
  const target={ownerId:'owner',productId:product.id,sourceKey:source,productVersion:product.updated_at,quotationView:plain(view),quotationTarget:{kind:'quotation',profileId:implicitProfile?null:profile.id,optionId:id,input:'additionalImages',fieldKey:field.primary,slotIndex:1,revision:view.revision,inputFingerprint:view.inputFingerprint,optionRevision:view.optionRevision,value:keys.join('\n')}};
  const model=backend.load('app/automation/image-edit.ts'),store=backend.load('db/image-jobs.ts'),jobId=crypto.randomUUID();
  const route=backend.load('app/api/products/[id]/image-generation/route.ts'),context={params:Promise.resolve({id:product.id})};
  const configuration=await json(await route.GET(new Request('https://app.test'+base+'/image-generation'),context));
  const review=await model.prepareImageReview({sourceKey:source,prompt:'배경 문구만 정리',purpose:'cleanup',size:'1024x1024',quality:'low'},await model.imageMetadata(backend.objects.get(source)),'gpt-image-1.5',configuration.settings);
  const job={id:jobId,productId:product.id,productVersion:product.updated_at,contentRevision:view.contentRevision,status:'prepared',review,result:null,error:null,createdAt:new Date().toISOString(),approvedAt:null,startedAt:null,finishedAt:null};
  assert.equal((await store.createImageJob('owner',job,product.image_keys,'local-additional-'+jobId,'LOCAL-ONLY-ADDITIONAL-PROOF')).conflict,false);
  await store.approveImageJob('owner',product.id,jobId,review.fingerprint,new Date().toISOString());
  const running=await store.claimImageJob('owner',product.id,jobId,review.fingerprint,'LOCAL-ONLY-CLAIM',new Date().toISOString());assert.equal(running.status,'running');
  const bytes=png(1024,1024),metadata=await model.imageMetadata(bytes),key='owner/ai-'+jobId+'.png';
  await backend.bindings.FILES.put(key,bytes,{httpMetadata:{contentType:'image/png'},customMetadata:{imageJobId:jobId,provenance:'generated',sha256:metadata.sha256}});
  const completed=await store.finishImageSuccess('owner',running,'LOCAL-ONLY-CLAIM',{...metadata,storageKey:key,model:review.model,purpose:review.purpose,generatedAt:new Date().toISOString(),providerRequestId:null,usage:null,attached:false,assignedRole:false,provenance:'generated',reviewRequired:true});assert.equal(completed.result.attached,true);
  const current=await read(),calls=[];let lose=false,unavailable=false;
  const request=async(url,init={})=>{
   const method=init.method??'GET';calls.push({url,method,body:init.body?JSON.parse(init.body):undefined});
   if(unavailable&&method==='GET')throw Error('LOCAL read unavailable');
   if(url===base+'/image-generation'){assert.equal(method,'GET','provider execution forbidden');return route.GET(new Request('https://app.test'+url),context);}
   if(url.startsWith('/api/files/')){assert.equal(method,'GET');const owned=url.slice('/api/files/'.length).split('/').map(decodeURIComponent).join('/');return new Response(backend.objects.get(owned),{headers:{'content-type':'image/png'}});}
   assert.equal(url,endpoint,'source/other product writes forbidden');
   const response=await backend.route(url,{method,...(init.body?{body:JSON.parse(init.body)}:{})});
   if(lose&&method==='PUT'){assert.equal(response.status,200);lose=false;unavailable=true;throw Error('LOCAL committed additional-image ACK lost');}return response;
  };
  return {backend,profile,product,base,endpoint,id,keys,source,target,completed,key,bytes,current,calls,request,read,tools,helper:backend.load('app/additional-image-ai-apply.ts'),
   lost(){lose=true;},recover(){unavailable=false;},close(){backend.close();},
   sourceState:()=>JSON.stringify(['product_options','product_content','product_price_policy','product_source_records','workspace_settings'].map(table=>{try{return[table,backend.sqlite.prepare('SELECT * FROM '+table).all()];}catch{return[table,null];}})),
   files:()=>[...backend.objects].map(([key,value])=>[key,Buffer.from(value).toString('base64')])};
 }catch(error){backend.close();throw error;}
}

for(const company of schemaCompanies)test(`${company.code}: cleanup replaces exactly the middle additional slot and linked wire via actual CAS, retaining common/other options/HTML/files`,async()=>{
 const f=await fixture(company);try{
  const {helper:h}=f,source=f.sourceState(),files=f.files(),network=[...f.backend.network],before=await f.read();
  const attempt=await h.prepareAdditionalImageAiApply(f.target,f.completed,f.current.productVersion,f.current.imageKeys,f.request);
  assert.equal(f.calls.filter(call=>call.method!=='GET').length,0);
  const result=await h.applyAdditionalImageAiResult(attempt,f.request),expected=plain(before.overrides),value=[f.keys[0],f.key,f.keys[2]].join('\n');
  for(const field of f.tools.optionImageTargets(before.resolved.schema.fields).additionalImages.linked)expected.options[f.id][field]=value;
  assert.deepEqual(plain(result.overrides),expected);assert.equal(result.revision,before.revision+1);assert.equal(result.contentRevision,before.contentRevision);assert.equal(result.optionRevision,before.optionRevision);
  assert.equal(f.tools.optionImageValue(result,f.id,'detailHtml'),'<p>선택 옵션 상세 HTML 유지</p>');assert.equal(f.sourceState(),source);assert.deepEqual(f.files(),files);assert.deepEqual(f.backend.network,network);
  assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);assert.equal(f.calls.some(call=>call.method==='POST'),false);
  await h.recoverAdditionalImageAiResult(attempt,f.request);assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);
  const again=await h.prepareAdditionalImageAiApply(f.target,f.completed,result.productVersion,result.imageKeys,f.request);assert.ok(again.alreadyApplied);
  await h.applyAdditionalImageAiResult(again,f.request);assert.equal(f.calls.filter(call=>call.method==='PUT').length,1,'already identical explicit selection is read-only success');
 }finally{f.close();}
});

test('lost committed ACK and unavailable read retain uncertainty; explicit recovery performs only GET and never repeats PUT',async()=>{
 const f=await fixture(schemaCompanies[1]);try{
  const h=f.helper,attempt=await h.prepareAdditionalImageAiApply(f.target,f.completed,f.current.productVersion,f.current.imageKeys,f.request),before=f.sourceState(),files=f.files();
  f.lost();await assert.rejects(h.applyAdditionalImageAiResult(attempt,f.request),error=>error.uncertain===true);
  assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);f.recover();const result=await h.recoverAdditionalImageAiResult(attempt,f.request);
  assert.equal(f.tools.quotationImageKeys(f.tools.optionImageValue(result,f.id,'additionalImages'))[1],f.key);assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);assert.equal(f.sourceState(),before);assert.deepEqual(f.files(),files);
 }finally{f.close();}
});

for(const company of schemaCompanies)test(`${company.code}: implicit default-profile queryless entry keeps its resolved profile through preflight, exact-slot apply and readback`,async()=>{
 const f=await fixture(company,{implicitProfile:true});try{
  assert.equal(f.target.quotationTarget.profileId,null);assert.equal(f.endpoint,f.base+'/quotation-fields');
  assert.equal(f.target.quotationView.categoryContext.profileId,f.profile.id);assert.equal(f.current.categoryContext.profileId,f.profile.id);
  const before=await f.read(),source=f.sourceState(),files=f.files(),network=[...f.backend.network];
  const attempt=await f.helper.prepareAdditionalImageAiApply(f.target,f.completed,f.current.productVersion,f.current.imageKeys,f.request);
  assert.equal(f.calls.filter(call=>call.method!=='GET').length,0);
  const result=await f.helper.applyAdditionalImageAiResult(attempt,f.request),readback=await f.read();
  assert.equal(result.categoryContext.profileId,f.profile.id);assert.deepEqual(plain(result.categoryContext),plain(before.categoryContext));assert.deepEqual(plain(readback),plain(result));
  const expected=plain(before.overrides),value=[f.keys[0],f.key,f.keys[2]].join('\n');
  for(const field of f.tools.optionImageTargets(before.resolved.schema.fields).additionalImages.linked)expected.options[f.id][field]=value;
  assert.deepEqual(plain(result.overrides),expected);assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);
  assert.ok(f.calls.filter(call=>call.url.includes('/quotation-fields')).every(call=>call.url===f.endpoint),'resolved profile is verified without silently adding an explicit query');
  await f.helper.recoverAdditionalImageAiResult(attempt,f.request);assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);
  assert.equal(f.sourceState(),source);assert.deepEqual(f.files(),files);assert.deepEqual(f.backend.network,network);
 }finally{f.close();}
});

test('intervening unrelated quote edit before preparation or apply is rejected without a new PUT',async()=>{
 for(const phase of ['prepare','apply']){const f=await fixture();try{
   const h=f.helper,attempt=phase==='apply'?await h.prepareAdditionalImageAiApply(f.target,f.completed,f.current.productVersion,f.current.imageKeys,f.request):null;
   const view=await f.read();await json(await f.backend.route(f.endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{optionId:null,fieldKey:'brand',value:'사용자 보존 브랜드'}]}}));
   const current=await f.read(),before=plain(current);
   if(phase==='prepare')await assert.rejects(h.prepareAdditionalImageAiApply(f.target,f.completed,current.productVersion,current.imageKeys,f.request));
   else await assert.rejects(h.applyAdditionalImageAiResult(attempt,f.request));
   assert.equal(f.calls.filter(call=>call.method==='PUT').length,0);assert.deepEqual(plain(await f.read()),before);
  }finally{f.close();}}
});

test('invalid slot, alias disagreement, wrong purpose, duplicate list or altered generated pixels never reach quotation PUT',async()=>{
 for(const mode of ['slot','input','field','profile','duplicate','wire','purpose','unattached','foreign','bytes']){const f=await fixture();try{
   const target=plain(f.target),job=plain(f.completed);
   if(mode==='slot')target.quotationTarget.slotIndex=0;
   if(mode==='input')target.quotationTarget.input='detailImages';
   if(mode==='field')target.quotationTarget.fieldKey='detailImages';
   if(mode==='profile')target.quotationTarget.profileId='different-profile';
   if(mode==='duplicate'){const value=[f.keys[0],f.keys[1],f.keys[1]].join('\n');target.quotationTarget.value=value;for(const field of f.tools.optionImageTargets(target.quotationView.resolved.schema.fields).additionalImages.linked)target.quotationView.resolved.rows.find(row=>row.optionId===f.id).fields[field].value=value;}
   if(mode==='wire'){
    // Exercise a legacy canonical+captured-wire shape as inert input only.
    // The current schema compiler normally gives the canonical field its wire.
    const canonical=target.quotationView.resolved.schema.fields.find(field=>field.id==='additionalImages'),alias={...canonical,id:'wire-additionalImages',hubInput:'additionalImages',hubWire:{path:['imagePage','images','additionalImage']}};
    delete canonical.hubWire;target.quotationView.resolved.schema.fields.push(alias);
    target.quotationView.resolved.rows.find(row=>row.optionId===f.id).fields[alias.id]={value:f.keys[2],source:'manual-option',validationIssues:[]};target.quotationTarget.fieldKey=alias.id;
   }
   if(mode==='purpose')job.review.purpose='detail';
   if(mode==='unattached')job.result.attached=false;
   if(mode==='foreign')job.result.storageKey='other/generated.png';
   if(mode==='bytes')f.backend.objects.set(f.key,f.bytes.slice(0,-1));
   const before=await f.read(),source=f.sourceState();await assert.rejects(f.helper.prepareAdditionalImageAiApply(target,job,f.current.productVersion,f.current.imageKeys,f.request));
   assert.equal(f.calls.filter(call=>call.method==='PUT').length,0);assert.deepEqual(plain(await f.read()),plain(before));assert.equal(f.sourceState(),source);
  }finally{f.close();}}
});

test('reordered selected slots after generation or an extra attached image invalidate the exact result-append proof',async()=>{
 for(const mode of ['reorder','extra']){const f=await fixture();try{
   let current=await f.read();
   if(mode==='reorder'){const changes=f.tools.optionImageChanges(current,f.id,{additionalImages:[f.keys[2],f.keys[1],f.keys[0]].join('\n')});await json(await f.backend.route(f.endpoint,{method:'PUT',body:{expectedRevision:current.revision,expectedInputFingerprint:current.inputFingerprint,changes}}));current=await f.read();}
   const keys=mode==='extra'?[...current.imageKeys,'owner/other-generated.png']:current.imageKeys;
   await assert.rejects(f.helper.prepareAdditionalImageAiApply(f.target,f.completed,current.productVersion,keys,f.request));assert.equal(f.calls.filter(call=>call.method==='PUT').length,0);
  }finally{f.close();}}
});
