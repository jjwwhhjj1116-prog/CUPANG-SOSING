import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {stageDOM,repo} from './helpers/cold-price-main-dom.mjs';
const {mobileIntakeHarness}=await import(pathToFileURL(path.join(repo,'tests/helpers/mobile-intake.mjs')).href);
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};

test('first SEO → price → main reuses the same full content/options/queryless quotation UI responses',async()=>{
 const api=mobileIntakeHarness(),calls=[],gates=[],resourceBodies=new Map();let phase='setup',h;
 // Existing recorded fixture, real in-memory SQLite handlers; no real provider.
 // Fixture intake completes before the measured UI read interval.
 try{
  await api.intake();
  const product=await api.load('db/queries.ts').findProduct('owner',api.latest.product_id);
  assert.ok(product?.id,'existing API fixture collected and saved its product');
  const base='/api/products/'+product.id,originalState=JSON.stringify(api.sqlite.prepare('SELECT * FROM products WHERE id=?').get(product.id));
  const measured=['content','options','quotation-fields'];
  const components=Object.fromEntries(['seo-workspace-generator','seo-workspace-editor','product-content-editor','product-options-editor','option-main-image-editor','option-quotation-prices','option-price-table'].map(name=>[name,true]));
  h=await stageDOM(async(url,init={})=>{
   url=String(url);const method=init.method??'GET';assert.equal(method,'GET','UI navigation never dispatches a write');
   const request={phase,url,method,cache:init.cache,started:calls.length,finished:false,aborted:false};calls.push(request);
   init.signal?.addEventListener('abort',()=>{request.aborted=true;request.abortAfterFinish=request.finished;},{once:true});
   const response=url===base?await api.load('app/api/products/[id]/route.ts').GET(new Request('https://app.test'+url),{params:Promise.resolve({id:product.id})}):await api.route(url,{method}),body=await response.clone().json();request.status=response.status;
   assert.equal(response.status,200,JSON.stringify({url,body}));
   const resource=url===base?'product':url.startsWith(base+'/')?url.slice(base.length+1):null;request.resource=resource;
   if(measured.includes(resource)){
    const previous=resourceBodies.get(resource);if(previous)assert.equal(sha(body),previous.hash,'unchanged real API response '+resource);
    else resourceBodies.set(resource,{hash:sha(body),body});
    request.resource=resource;request.hash=sha(body);const gate=deferred();gates.push({phase,resource,gate});await gate.promise;
   }
   request.finished=true;return response;
  },{components});
  const Detail=h.load('app/components/dashboard-client.tsx').DetailPanel;
  const props={product,workspaceOwnerId:'owner',settings:api.settings,uiReadScope:{company:{code:'A01464742',name:'와이홉'},settingsEpoch:0},onSaved(){throw Error('read-only navigation must not save');},onUpload(){throw Error('no upload');},onSavePrice:async()=>{throw Error('no price save');},onManageCategories(){},onProfileSelected(){},onBeforeFreeImageApply:()=>true,onBeforeSeoGenerate:()=>true,onPrepareSubmission(){},onReviewPackaging(){},onReceiptSaved(){}};
  const release=async(p)=>{await h.React.act(async()=>{for(const item of gates.filter(item=>item.phase===p))item.gate.resolve();});for(let i=0;i<6;i++)await h.settle();};
  const counts=()=>Object.fromEntries(measured.map(resource=>[resource,calls.filter(call=>!call.phase.startsWith('proof:')&&call.resource===resource).length]));
  phase='SEO';await h.render(Detail,{...props,tab:'SEO'});
  assert.equal(counts().content,1);assert.equal(counts().options,1);
  assert.ok(calls.filter(call=>call.phase==='SEO'&&measured.includes(call.resource)).every(call=>!call.finished),'first SEO full data is deliberately held');
  await release('SEO');
  assert.ok(h.container.querySelector('[aria-label="SEO 상품명"]'),'actual integrated SEO editor rendered');
  assert.equal(h.container.querySelector('[data-seo-generation-input]').getAttribute('data-workspace-saving'),'false','actual generator basis finished');
  phase='가격';await h.render(Detail,{...props,tab:'가격'});
  const quoteBeforeOptionsRelease=calls.filter(call=>call.phase==='가격'&&call.resource==='quotation-fields').length;
  assert.equal(quoteBeforeOptionsRelease,1,'price quotation starts while the independent options response is still held');
  await release('가격');await release('가격');
  assert.ok(h.container.querySelector('input[type="number"]'),'actual options/price editor rendered');
  phase='대표 이미지';await h.render(Detail,{...props,tab:'대표 이미지'});
  await release('대표 이미지');await release('대표 이미지');
  assert.ok(h.container.querySelector('[aria-label="최종 대표이미지 옵션"]'),'actual main-image editor rendered');
  assert.equal(h.container.querySelector('[aria-label="최종 대표이미지 옵션"]').disabled,false,'actual first main-image selection input is usable after its reads');
  assert.equal(h.container.querySelector('.option-main-image-editor').getAttribute('data-workspace-saving'),'false','actual main editor finished initial quote read');
  assert.equal(JSON.stringify(api.sqlite.prepare('SELECT * FROM products WHERE id=?').get(product.id)),originalState,'no product mutation');
  phase='proof:size';await h.render(h.load('app/components/size-chart-workspace.tsx').SizeChartWorkspace,{productId:product.id,version:product.updated_at,active:true});await release(phase);await release(phase);
  const sizeProof=calls.filter(call=>call.phase===phase).map(call=>call.resource);assert.deepEqual(sizeProof,['product','content','product'],'actual fresh size three-read proof remains explicit');
  phase='proof:label-ref';await h.render(h.load('app/components/product-label-editor.tsx').ProductLabelReferenceEditor,{productId:product.id,version:product.updated_at,active:true});await release(phase);await release(phase);
  const labelProof=calls.filter(call=>call.phase===phase).map(call=>call.resource);assert.deepEqual(labelProof,['product-labels','quotation-fields','product-labels'],'actual fresh label reference proof remains explicit');
  assert.ok(calls.every(call=>call.cache==='no-store'),'all normal UI and proof reads retain no-store');
  const proofCalls=calls.filter(call=>call.phase.startsWith('proof:')||!measured.includes(call.resource)).map(({phase,url,method,cache,status})=>({phase,url,method,cache,status}));
  const evidence={head:'fd3e4c6af45f6c0ffe2d6398b8b54ec2ecd65ff7',scenario:'same editor, same owner/company/productVersion, no user edits, first SEO→price→main',productVersion:product.updated_at,counts:counts(),quoteStartedBeforeOptionsReleased:quoteBeforeOptionsRelease,realAPIResponseHashes:Object.fromEntries([...resourceBodies].map(([key,value])=>[key,value.hash])),readCalls:calls,freshProofCounts:{size:sizeProof,labelReference:labelProof},otherContractAndProofCalls:proofCalls,unrunContracts:['label PNG receipt (no canonical generated PNG fixture)','submit preflight','unknown recovery (no write attempted)'],freshPolicy:'All actual requests retain cache:no-store; fresh proof calls are separately asserted, not counted as eliminated UI duplicates. Unrun contracts are not asserted as zero.'};
  if(process.env.COLD_PRICE_MAIN_EVIDENCE)fs.writeFileSync(process.env.COLD_PRICE_MAIN_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
  assert.deepEqual(counts(),{content:1,options:1,'quotation-fields':1},'unchanged first stages share genuine full DTOs');
 }finally{
  for(const item of gates)item.gate.resolve();if(h)await h.close();api.close();
 }
});
