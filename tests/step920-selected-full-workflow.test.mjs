import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {selectedWorkflowFixture,companies} from './helpers/step920-selected-workflow.mjs';

test('step920 actual collected product runs the real SEO and pricing adapters through local API/SQLite',async()=>{
 const f=await selectedWorkflowFixture(companies[0]);
 try{
  const result=await f.run();console.log('STEP920_TRACE '+JSON.stringify({stages:Array.from(result?.stages??[],({id,status,message})=>({id,status,message})),counts:f.counts(),boundaries:f.boundaries}));
  assert.ok(result);assert.deepEqual(Array.from(result.stages,row=>row.id),['seo','pricing']);
  for(const row of result.stages)assert.ok(['draft','complete','skipped'].includes(row.status),row.id+': '+row.message);
  assert.ok(f.requests.some(row=>row.url.endsWith('/seo-generation')&&row.method==='POST'));
  assert.ok(f.requests.some(row=>row.url.endsWith('/stage-two-pricing')&&row.method==='POST'));
 }finally{f.close();}
});

test('step920 foreign-text main/additional cleanup and raw BODY Korean translation save through actual image adapters before the quote draft',async()=>{
 const f=await selectedWorkflowFixture(companies[0],{completeInputs:true,foreignTextImages:true,qwenSeo:true}),stages=['seo','pricing','mainImage','additionalImages','detailImage','sizeChart','koreanLabel','quotation'];
 try{
  const result=await f.run(stages);console.log('STEP920_FOREIGN_TRACE '+JSON.stringify({syntheticOnly:true,stages:Array.from(result?.stages??[],({id,status,message})=>({id,status,message})),counts:f.counts(),boundaries:f.boundaries}));
  assert.ok(result);for(const row of result.stages)assert.ok(['draft','complete','skipped'].includes(row.status),row.id+': '+row.message);
  assert.equal(f.immutableSource(),f.sourceBefore,'actual collected source, captured settings/category and import links remain exact');
  const view=await(await f.request(f.base+'/quotation-fields')).json(),row=view.resolved.rows.find(row=>row.included),targets=f.h.load('app/quotation-seo-targets.ts'),outputs=[];
  for(const input of ['mainImage','additionalImages']){
   const target=targets.exactPrimaryQuotationTarget(view.resolved.schema.fields,input),key=row.fields[target.primary].value.split('\n')[0];assert.match(key,/^owner\/free-image-/);
   const sidecar=JSON.parse(new TextDecoder().decode(f.h.objects.get(key+'.edit.json'))),region=sidecar.document.regions[0];
   assert.equal(region.text,'中文');assert.equal(region.erase,true);assert.equal(region.translated,'');assert.equal(region.translationProvenance,'empty');assert.equal(region.issue,null);assert.equal(region.backgroundMode,'inpaint-telea-v1');
   const original=f.originals.get(sidecar.source.sourceKey);assert.ok(original);assert.deepEqual(Buffer.from(f.h.objects.get(sidecar.source.sourceKey)),original);
   const{data:before,info}=await sharp(original).ensureAlpha().raw().toBuffer({resolveWithObject:true}),after=await sharp(f.h.objects.get(key)).ensureAlpha().raw().toBuffer();assert.equal(before.length,after.length);assert.equal(info.width,800);assert.equal(info.height,800);
   const box=region.box;let changed=0;for(let y=0;y<info.height;y++){
    const start=y*info.width*4,end=start+info.width*4;
    if(y<box.y||y>=box.y+box.height)assert.deepEqual(after.subarray(start,end),before.subarray(start,end));
    else{assert.deepEqual(after.subarray(start,start+box.x*4),before.subarray(start,start+box.x*4));assert.deepEqual(after.subarray(start+(box.x+box.width)*4,end),before.subarray(start+(box.x+box.width)*4,end));for(let x=box.x;x<box.x+box.width;x++){const i=start+x*4;if(!before.subarray(i,i+4).equals(after.subarray(i,i+4)))changed++;}}
   }assert.ok(changed>0,'actual OpenCV output changes the original glyph pixels');
   assert.equal((await f.h.load('app/free-image-edit-review.ts').readFreeImageEditReview(f.h.bindings.FILES,'owner',f.productId,key)).status,'clear');
   outputs.push({key,input,optionId:row.optionId});
  }
  const workspaceResponse=await f.request(f.base+'/detail-workspace?optionId='+row.optionId);assert.equal(workspaceResponse.status,200,await workspaceResponse.clone().text());const workspace=(await workspaceResponse.json()).workspace;
  const photo=workspace.document.photos.find(photo=>photo.role==='body');assert.ok(photo);assert.notEqual(photo.key,photo.originKey);
  const detailSidecar=JSON.parse(new TextDecoder().decode(f.h.objects.get(photo.key+'.edit.json'))),translated=detailSidecar.document.regions[0];
  assert.equal(translated.text,'中文');assert.equal(translated.translated,'중문');assert.equal(translated.translationProvenance,'generated');assert.equal(translated.selected,true);assert.notEqual(translated.erase,true);assert.equal(translated.issue,null);assert.equal(detailSidecar.source.workspaceTarget.optionId,row.optionId);
  assert.deepEqual(Buffer.from(f.h.objects.get(photo.originKey)),f.originals.get(photo.originKey));
  assert.ok(f.boundaries.some(row=>row.stage==='detailImage'&&row.type==='synthetic-canvas'&&row.textRows>0),'actual BODY renderer draws the generated Korean text');
  assert.equal(f.boundaries.filter(row=>row.type==='synthetic-worker').length,3);assert.equal(f.boundaries.filter(row=>row.task==='vision-foreign-text').length,3);
  assert.equal(f.boundaries.filter(row=>row.task==='qwen-integrated-translation').length,1);assert.equal(f.boundaries.some(row=>row.type==='google-translation'),false,'Qwen integrated SEO never falls back to Google');
  const response=await f.request(f.base+'/native-assets');assert.equal(response.status,200,await response.clone().text());const plan=await response.json();
  console.log('STEP920_NATIVE_TRACE '+JSON.stringify({metadataValid:plan.metadataValid,images:plan.images.map(({key,imageType,references})=>({key,imageType,references})),blockingIssues:plan.issues.filter(issue=>issue.level==='error')}));
  // This AI-focused synthetic schema intentionally omits native legal/import
  // wires. Do not claim a prepared submission or repair its view after running.
  assert.equal(plan.metadataValid,false);assert.ok(plan.issues.some(issue=>issue.code==='NATIVE_ASSET_LEGAL_UNCONFIRMED'));
  assert.equal(plan.issues.some(issue=>issue.code.startsWith('FREE_IMAGE_')),false,'the freshly saved exact image sidecars are clear at the independent native source boundary');
  for(const output of outputs){const image=plan.images.find(image=>image.key===output.key&&image.imageType===(output.input==='mainImage'?'MAIN':'ADDITIONAL'));assert.ok(image);assert.ok(image.references.some(ref=>ref.optionId===output.optionId&&ref.slotIndex===0));}
 }finally{f.close();}
});

test('step920 missing explicit tax and legal settings blocks Stage7 after actual prior stages save',async()=>{
 const f=await selectedWorkflowFixture(companies[0]),stages=['seo','pricing','mainImage','additionalImages','detailImage','sizeChart','koreanLabel','quotation'];
 try{
  const result=await f.run(stages);console.log('STEP920_FULL_TRACE '+JSON.stringify({stages:Array.from(result?.stages??[],({id,status,message})=>({id,status,message})),counts:f.counts(),boundaries:f.boundaries}));
  assert.ok(result);assert.deepEqual(Array.from(result.stages,row=>row.id),stages);
  for(const row of result.stages.slice(0,-1))assert.ok(['draft','complete','skipped'].includes(row.status),row.id+': '+row.message);
  const last=result.stages.at(-1);assert.equal(last.status,'blocked');
  for(const field of ['과세여부','인증 마크 타입','유통기간','취급주의 사유'])assert.ok(last.message.includes(field),last.message);
  assert.deepEqual(f.initialInputs,[]);
 }finally{f.close();}
});

for(const company of companies)test(`step920 ${company.code}: actual selected stages 1–7 save a complete draft from explicit synthetic initial settings`,async()=>{
 const f=await selectedWorkflowFixture(company,{completeInputs:true}),stages=['seo','pricing','mainImage','additionalImages','detailImage','sizeChart','koreanLabel','quotation'];
 try{
  const result=await f.run(stages);console.log('STEP920_HAPPY_TRACE '+JSON.stringify({company:company.code,syntheticOnly:true,initialInputs:f.initialInputs,stages:Array.from(result?.stages??[],({id,status,message})=>({id,status,message})),counts:f.counts(),boundaries:f.boundaries}));
  assert.ok(result);assert.deepEqual(Array.from(result.stages,row=>row.id),stages);
  for(const row of result.stages)assert.ok(['draft','complete','skipped'].includes(row.status),row.id+': '+row.message);
  assert.equal(result.stages.at(-1).status,'draft');assert.equal(f.initialInputs.length,2);
  assert.equal(f.immutableSource(),f.sourceBefore,'generation does not rewrite collected source or its captured context');
  const view=await(await f.request(f.base+'/quotation-fields')).json();
  assert.equal(view.overrides.common.kcMarkType,'해당사항없음','the runner retains the explicit initial legal assessment');
  for(const row of view.resolved.rows.filter(row=>row.included))for(const[key,value]of Object.entries({taxType:'과세',kcMarkType:'해당사항없음',shelfLifeDays:'0',handlingReason:'해당사항없음'}))assert.equal(row.fields[key].value,value);
  assert.ok(f.requests.some(row=>row.url.endsWith('/detail-save')&&row.method==='POST'));
  assert.ok(f.requests.some(row=>row.url.endsWith('/attachments')&&row.method==='POST'&&row.stage==='koreanLabel'));
  assert.ok(f.requests.some(row=>row.url==='/api/files'&&row.method==='POST'&&row.stage==='koreanLabel'));
  assert.ok(f.requests.some(row=>row.url.endsWith('/quotation-fields')&&row.method==='PUT'&&row.stage==='quotation'));
  assert.ok(f.h.network.every(host=>['translate.googleapis.com','cbu01.alicdn.com'].includes(host)),'all external boundaries are the inert translation/CDN fixture; supplier reads remain forbidden');
 }finally{f.close();}
});
