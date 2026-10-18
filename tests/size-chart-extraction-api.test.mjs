import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {extractionApiFixture,companies,json,selection,lines} from './helpers/size-chart-extraction.mjs';
const proofs=[],sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test.after(()=>fs.writeFileSync(new URL('../outputs/step708-backend-api-proof.json',import.meta.url),JSON.stringify({format:'step708-backend-api-proof-v1',cases:proofs,
 boundary:'Actual local routes/SQLite/R2 and strict parser. Synthetic PNG, OCR, approved members, AI binding and Google fetch responses. Existing quota reservation is the only application write. No real browser, seller/Hub request or product touched.'},null,2)+'\n'));
for(const company of companies)test(`owned pool image OCR becomes an unsaved source-token chart and row-name-only translation (${company.code})`,async()=>{
 const f=await extractionApiFixture(company);try{
  const inventory=await json(await f.route());assert.equal(inventory.productId,f.id);assert.equal(inventory.purpose,'size-chart-extraction');assert.equal(inventory.images.at(-1).key,f.sourceKey);assert.equal(inventory.images.at(-1).role,'other');assert.equal(inventory.images[0].role,'detail');
  const body=await f.body(),before=f.state();assert.equal(body.source.sourceSha256,sha(f.pixels));assert.equal(body.source.role,'detail');assert.equal(body.source.width,800);
  const result=await json(await f.route(f.endpoint,{method:'POST',body}));assert.deepEqual(result.chart,{sizeType:'이미지 추출 사이즈표',sizeUnits:'cm',sizes:['S','M'],measurements:[{name:'가슴둘레',values:['40.5','44']},{name:'옷길이',values:['60','']}]});
  assert.equal(f.calls.length,1);assert.equal(f.quota(),1);assert.equal(f.google.length,1);assert.ok(f.google[0].text.includes('胸围'));assert.ok(!/40\.5|\b44\b|\bcm\b|尺码/u.test(f.google[0].text),'Google receives row names only');
  assert.equal(f.calls[0].model,f.h.load('app/quotation-ai.ts').QUOTATION_AI_MODEL);const prompt=JSON.parse(f.calls[0].input.messages[1].content);assert.deepEqual(prompt.display,body.display);assert.ok(!Object.hasOwn(prompt,'source'));
  assert.equal(result.evidence.translations[0].original,'胸围');f.h.load('app/size-chart-extraction.ts').verifySizeChartExtractionResult(result,body.source,body.lines,body.display);assert.deepEqual(f.state(),before);
  f.setProvider(async()=>({response:JSON.stringify({hasSizeChart:false,unit:null,sizes:[],measurements:[]})}));const none=await json(await f.route(f.endpoint,{method:'POST',body}));assert.equal(none.chart,null);assert.equal(f.calls.length,2);assert.equal(f.google.length,1);assert.deepEqual(f.state(),before);
  f.setProvider(async(_model,input)=>({response:JSON.stringify(selection(JSON.parse(input.messages[1].content).tokens))}));const mixed={...body,lines:lines(['单位 cm / inch','尺码 S M','胸围 40.5 44','衣长 60'])},ambiguous=await json(await f.route(f.endpoint,{method:'POST',body:mixed}));assert.equal(ambiguous.chart.sizeUnits,null);assert.deepEqual(ambiguous.chart.measurements[0].values,['40.5','44']);assert.equal(f.quota(),3);assert.deepEqual(f.state(),before);
  assert.equal(f.h.network.length,0);assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM image_jobs').get().n,0);for(const table of ['supplier_hub_receipts','supplier_hub_single_receipts'])assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,0);
  proofs.push({company,kind:'normal-no-table-mixed-unit',requests:f.requests,aiCalls:f.calls.length,quota:f.quota(),googleFixtureRequests:f.google.length,businessAndFilesUnchanged:true,externalRequests:0,sourceSha256:body.source.sourceSha256,values:result.chart.measurements.map(row=>row.values)});
 }finally{f.h.close();}
});
for(const company of companies)test(`unowned/stale/malformed/unconfigured/limited extraction never applies any grid (${company.code})`,async()=>{
 const f=await extractionApiFixture(company);try{
  const body=await f.body(),before=f.state(),assertUnchanged=()=>assert.deepEqual(f.state(),before);
  await json(await f.route(f.endpoint+'?role=detail'),400);await json(await f.route(f.endpoint+'?sourceKey=other-owner/x.png'),404);
  await json(await f.route(f.endpoint,{method:'POST',headers:{origin:'https://foreign.test'},body}),403);
  for(const changed of [{...body,extra:true},{...body,source:{...body.source,role:'main'}},{...body,lines:[{...body.lines[0],box:{x:800,y:0,width:20,height:10}}]},{...body,display:{width:400,height:300}}])await json(await f.route(f.endpoint,{method:'POST',body:changed}),400);
  await json(await f.route(f.endpoint,{method:'POST',body:{...body,source:{...body.source,sourceSha256:'0'.repeat(64)}}}),409);assert.equal(f.calls.length,0);assert.equal(f.quota(),0);assertUnchanged();
  f.h.bindings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY='false';await json(await f.route(f.endpoint,{method:'POST',body}),503);f.h.bindings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY='true';
  f.auth.verified=false;await json(await f.route(),403);f.auth.verified=true;f.auth.owner='other-owner';await json(await f.route(),404);f.auth.owner='owner';f.auth.company={code:'UNKNOWN',name:'unknown'};await json(await f.route(),403);f.auth.company={...company};assertUnchanged();
  for(const raw of ['{"hasSizeChart":false,"hasSizeChart":true,"unit":null,"sizes":[],"measurements":[]}',JSON.stringify({hasSizeChart:true,unit:null,sizes:[['invented']],measurements:[{name:['invented'],values:[['42']]}]})]){f.setProvider(async()=>({response:raw}));const n=f.calls.length;await json(await f.route(f.endpoint,{method:'POST',body}),503);assert.equal(f.calls.length,n+1);assertUnchanged();}
  f.setProvider(async()=>{throw Error('isolated refusal');});await json(await f.route(f.endpoint,{method:'POST',body}),503);assert.equal(f.calls.length,3);assert.equal(f.quota(),3);assertUnchanged();
  f.h.sqlite.prepare('UPDATE quotation_ai_daily SET requests=40 WHERE day=?').run(new Date().toISOString().slice(0,10));await json(await f.route(f.endpoint,{method:'POST',body}),429);assert.equal(f.calls.length,3);assert.equal(f.quota(),40);assertUnchanged();
  proofs.push({company,kind:'validation-auth-quota-failures',requests:f.requests,aiCalls:f.calls.length,expectedReservedBeforeExternalQuotaEdit:3,quotaAfterExternalEdit:40,businessAndFilesUnchanged:true,externalRequests:f.h.network.length});
 }finally{f.h.close();}
});
test('content, pool, pixel and company changes during AI reject the result while preserving the external edit',async()=>{
 for(const kind of ['content','pool','pixels','company']){
  const f=await extractionApiFixture();try{
   const body=await f.body();let observed;f.setProvider(async(_model,input)=>{
    if(kind==='content')f.h.sqlite.prepare("UPDATE product_content SET payload=json_set(payload,'$.seo.title.value','별도 화면에서 변경') WHERE product_id=?").run(f.id);
    if(kind==='pool'){const product=f.h.sqlite.prepare('SELECT image_keys FROM products WHERE id=?').get(f.id);f.h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify([...JSON.parse(product.image_keys),'owner/new-from-other-view.png']),f.id);}
    if(kind==='pixels'){const next=await sharp({create:{width:800,height:600,channels:4,background:'#aaaaaa'}}).png().toBuffer();await f.h.bindings.FILES.put(f.sourceKey,next,{httpMetadata:{contentType:'image/png'}});}
    if(kind==='company')f.auth.company={...companies.find(company=>company.code!==f.company.code)};
    observed=f.state();return{response:JSON.stringify(selection(JSON.parse(input.messages[1].content).tokens))};
   });
   await json(await f.route(f.endpoint,{method:'POST',body}),409);assert.deepEqual(f.state(),observed);assert.equal(f.calls.length,1);assert.equal(f.quota(),1);assert.equal(f.h.network.length,0);
   proofs.push({company:f.company,kind:'after-AI-'+kind,requests:f.requests,aiCalls:1,quota:1,externalEditPreserved:true,extractionApplied:false,externalRequests:0});
  }finally{f.h.close();}
 }
});
test('row-name translation cannot change a physical unit and EXIF display bounds are checked independently of source bytes',async()=>{
 const f=await extractionApiFixture();try{
  const body=await f.body();body.lines=lines(['单位 cm','尺码 S M','胸围(cm) 40.5 44','衣长 60']);
  f.setProvider(async(_model,input)=>{const tokens=JSON.parse(input.messages[1].content).tokens,result=selection(tokens),name=tokens.filter(token=>token.lineId==='line-2');result.measurements[0].name=name.slice(0,4).map(token=>token.id);return{response:JSON.stringify(result)};});
  f.setTranslation(url=>Response.json([[[url.searchParams.get('q').replaceAll('胸围(cm)','가슴둘레(mm)').replaceAll('衣长','옷길이')]],null,'zh-CN']));
  const before=f.state(),result=await json(await f.route(f.endpoint,{method:'POST',body}));assert.equal(result.chart.measurements[0].name,'胸围(cm)');assert.deepEqual(result.chart.measurements[0].values,['40.5','44']);assert.ok(result.evidence.translations[0].issue);assert.deepEqual(f.state(),before);
  // The same source can be displayed in swapped orientation; geometry may not
  // be arbitrarily scaled or inferred from an unrelated thumbnail.
  const swapped={...body,display:{width:600,height:800},lines:body.lines.map(line=>({...line,box:{...line.box,width:500}}))};await json(await f.route(f.endpoint,{method:'POST',body:swapped}));await json(await f.route(f.endpoint,{method:'POST',body:{...swapped,display:{width:300,height:400}}}),400);assert.deepEqual(f.state(),before);
  proofs.push({company:f.company,kind:'translation-unit-and-display',requests:f.requests,aiCalls:f.calls.length,quota:f.quota(),rowNameUnitProtected:true,businessAndFilesUnchanged:true,externalRequests:0});
 }finally{f.h.close();}
});
