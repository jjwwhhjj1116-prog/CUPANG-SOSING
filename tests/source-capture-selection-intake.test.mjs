import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
import {intakeOwnerScopeHarness,intakeScopeCompanies} from './helpers/intake-owner-scope.mjs';
import {acknowledgementClock,deferred,observe,settle} from './helpers/intake-collection-deadline.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {extractPageSource} from '../extensions/supplier-hub/page-source.mjs';

const sourceUrl='https://detail.1688.com/offer/753000000001.html',otherUrl='https://detail.1688.com/offer/753000000002.html';
const captureId='75300000-0000-4000-8000-000000000001',profileId='00000000-0000-0000-0000-000000000647';
const selection={sourceUrl,format:'yoofam-saved-page-capture-v1',captureId,fingerprint:'a'.repeat(64),revision:2};
const selectionModel=providedOptionModule('app/source-capture-selection.ts'),queue=providedOptionModule('app/intake-queue.ts');
const plain=value=>JSON.parse(JSON.stringify(value)),nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const row=()=>({...queue.intakeRow({id:profileId,revision:1,categoryId:'81452',categoryPath:['합성 분류']},'selected-row'),url:sourceUrl,sourceCapture:{...selection}});
const originalJob={id:'selected-job',offer_id:'753000000001',source_url:sourceUrl,goal:'collect',status:'awaiting_connector',created_at:'2026-10-20T00:00:00.000Z',updated_at:'2026-10-20T00:00:00.000Z'};
const receipt=()=>({jobId:originalJob.id,offerId:originalJob.offer_id,receipt:{receivedAt:'2026-10-20T00:00:01.000Z',result:{schemaVersion:1,sourceUrl,offerId:originalJob.offer_id,
  provider:'chrome-current-page-v1',collectedAt:'2026-10-20T00:00:00.000Z',title:'선택한 합성 수집본',description:'',attributes:[],
  options:[{sku:'synthetic-sku',name:'검정',unitPriceCny:2.99,minimumOrder:1,stock:null}],images:[]}}});

test('strict selection snapshots preserve exact version and canonical URL without reading supplier pages',()=>{
  const value=selectionModel.validateSourceCaptureSelection(selection,sourceUrl+'?spm=tracking');assert.deepEqual(plain(value),selection);assert.ok(Object.isFrozen(value));
  assert.deepEqual(plain(selectionModel.sourceCaptureAfterUrlEdit(value,sourceUrl+'?offerId=753000000001')),selection);
  for(const url of [otherUrl,'','editing','https://foreign.test/offer/753000000001.html'])assert.equal(selectionModel.sourceCaptureAfterUrlEdit(value,url),undefined);
  let getters=0;const accessor={...selection};Object.defineProperty(accessor,'fingerprint',{enumerable:true,get(){getters++;return selection.fingerprint;}});
  for(const invalid of [null,[],{...selection,cookie:'no'},{...selection,revision:0},{...selection,revision:1.5},{...selection,captureId:'not-id'},
    {...selection,fingerprint:'bad'},{...selection,sourceUrl:sourceUrl+'?tracking=1'},accessor])assert.throws(()=>selectionModel.validateSourceCaptureSelection(invalid));
  assert.equal(getters,0);assert.throws(()=>selectionModel.validateSourceCaptureSelection(selection,otherUrl));
});

test('submission freezes each selected capture before the collection-job POST and rejects URL/version mismatch without writes',async()=>{
  const selected=row(),calls=[],seen=[];const sourceBefore=plain(selection);
  await queue.submitIntakeQueue([selected],'collect',{signal:new AbortController().signal,onJobs(){},onRow(){},fetcher:async(path,init)=>{
    calls.push({path,body:JSON.parse(init.body)});selected.sourceCapture.revision=999;selected.sourceCapture.fingerprint='b'.repeat(64);
    return Response.json({jobs:[originalJob],preservedRequests:[]});},collect:async(_job,_progress,_product,capture)=>{seen.push(capture);return '합성 상품 추가';}});
  assert.equal(calls.length,1);assert.equal(Object.hasOwn(calls[0].body,'sourceCapture'),false);assert.deepEqual(plain(seen[0]),sourceBefore);assert.ok(Object.isFrozen(seen[0]));
  for(const capture of [{...selection,sourceUrl:otherUrl},{...selection,revision:0}]){
    let requests=0;await assert.rejects(queue.submitIntakeQueue([{...row(),sourceCapture:capture}],'collect',{signal:new AbortController().signal,
      fetcher:async()=>{requests++;},onJobs(){},onRow(){}}));assert.equal(requests,0);
  }
});

test('pinned rows never infer an existing product by URL or collect into linked work with no source receipt',async()=>{
  const selected=row(),job={...originalJob,product_id:'existing-product',context:{category:selected.profile,features:'',keywords:''}};
  assert.equal(queue.intakeProductId(selected,[job]),null);assert.equal(queue.intakeProductId({...selected,productId:'confirmed-product'},[job]),'confirmed-product');
  for(const existing of [job]){
    let collects=0;const states=[];await queue.submitIntakeQueue([selected],'collect',{signal:new AbortController().signal,
      fetcher:async()=>Response.json({jobs:[existing],preservedRequests:[]}),onJobs(){},onRow:(_id,state)=>states.push(state),collect:async()=>{collects++;return 'never';}});
    assert.equal(collects,0);assert.equal(states.at(-1).status,'error');assert.match(states.at(-1).message,/기존 작업.*새 초안/);
  }
});

function draftFixture(owner='alice'){
  const sqlite=new DatabaseSync(':memory:'),cache=new Map(),state={owner,reads:0,verified:true,profile:{id:profileId,revision:1,categoryId:'81452',categoryPath:['합성 분류']}};
  const DB={prepare(sql){state.reads++;return{async run(){sqlite.exec(sql);},bind(...args){return{async first(){return sqlite.prepare(sql).get(...args)??null;}};}};}};
  function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
      {exports,Error,URL,Response,TextEncoder,TextDecoder,Uint8Array,process:{env:{NODE_ENV:'production'}},require(name){
        if(name==='cloudflare:workers')return{env:{DB}};
        if(name==='@/app/chatgpt-auth')return{getWorkspaceOwnerId:async()=>state.owner,getChatGPTUser:async()=>({verifiedAccess:state.verified})};
        if(name==='@/db/category-profiles')return{getCategoryProfile:async(_owner,id)=>id===profileId?state.profile:null};
        return load(name.slice(2));
      }});return exports;
  }
  const route=load('app/api/intake-draft/route');return{state,sqlite,load,route,put:body=>route.PUT(new Request('https://app.test/api/intake-draft',{
    method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)}))};
}
for(const owner of ['waihop-owner','unand-owner'])test(owner+': actual draft API saves/restores and acknowledges the exact selected version through CAS and profile revisions',async()=>{
  const f=draftFixture(owner);try{
    const model=f.load('app/intake-draft'),input=model.intakeDraftBody([row()],'work',0,owner),saved=await f.put(input);assert.equal(saved.status,200);
    const ack=await saved.json(),confirmed=model.confirmIntakeDraftSave(ack,input);assert.deepEqual(plain(confirmed.rows[0].sourceCapture),selection);assert.ok(Object.isFrozen(confirmed.rows[0].sourceCapture));
    const restored=model.readIntakeDraftResponse(await(await f.route.GET()).json(),owner);assert.deepEqual(plain(restored.rows[0].sourceCapture),selection);
    f.state.profile={...f.state.profile,revision:2,categoryId:'80719'};
    const changed=model.intakeDraftBody([{...restored.rows[0],features:'특징만 변경'}],'work',1,owner),resaved=await f.put(changed);assert.equal(resaved.status,200);
    const reread=await resaved.json();assert.deepEqual(reread.draft.rows[0].sourceCapture,selection);assert.equal(reread.draft.rows[0].profile.revision,1);
    const before=JSON.stringify(f.sqlite.prepare('SELECT * FROM intake_drafts').all());
    for(const body of [{...changed,expectedRevision:1},{...changed,expectedRevision:2,expectedOwnerId:'foreign'},
      {...changed,expectedRevision:2,rows:[{...changed.rows[0],sourceCapture:{...selection,sourceUrl:otherUrl}}]}])assert.notEqual((await f.put(body)).status,200);
    assert.equal(JSON.stringify(f.sqlite.prepare('SELECT * FROM intake_drafts').all()),before);
    for(const field of ['captureId','fingerprint','revision']){const wrong=plain(ack);wrong.draft.rows[0].sourceCapture[field]=field==='revision'?3:field==='captureId'?'75300000-0000-4000-8000-000000000002':'c'.repeat(64);
      assert.throws(()=>model.confirmIntakeDraftSave(wrong,input));}
  }finally{f.sqlite.close();}
});

for(const company of intakeScopeCompanies)test(company.code+': category selection pins the seed, preserves it for category/guidance/tracking edits, and releases it for another URL',()=>{
  const h=intakeOwnerScopeHarness(company,{sourceSeed:{id:'selected-source',sourceUrl:sourceUrl+'?spm=1',title:'선택한 합성 제목',sourceCapture:selection}});
  try{
    const picker=()=>nodes(h.render()).find(node=>node.type?.name==='CategoryPicker');picker().props.onSelected(h.profile);assert.deepEqual(plain(h.rows[1].sourceCapture),selection);assert.ok(Object.isFrozen(h.rows[1].sourceCapture));
    const input=label=>nodes(h.render()).find(node=>node.props?.['aria-label']===label);
    input('2번째 특징').props.onChange({target:{value:'새 특징'}});input('2번째 키워드').props.onChange({target:{value:'새 키워드'}});
    input('2번째 1688 링크').props.onChange({target:{value:sourceUrl+'?spm=another'}});assert.deepEqual(plain(h.rows[1].sourceCapture),selection);
    nodes(h.render()).filter(node=>node.type==='button'&&node.props.className==='intake-category-button')[1].props.onClick();picker().props.onSelected({...h.profile,revision:2,categoryId:'80719'});
    assert.deepEqual(plain(h.rows[1].sourceCapture),selection);assert.equal(h.rows[1].features,'새 특징');
    input('2번째 1688 링크').props.onChange({target:{value:otherUrl}});assert.equal(h.rows[1].sourceCapture,undefined);
    assert.equal(h.posts.length,0);assert.equal(h.collections.length,0);
  }finally{h.close();}
});

for(const company of intakeScopeCompanies)test(company.code+': same-URL later version cannot replace the pinned row title, issues or collection selection',async()=>{
  const original={id:captureId,ownerId:company.owner,fingerprint:selection.fingerprint,revision:selection.revision,snapshot:{sourceUrl,title:'선택한 제목'},reviewed:null,issues:[]};
  const later={...original,id:'75300000-0000-4000-8000-000000000002',fingerprint:'b'.repeat(64),snapshot:{sourceUrl,title:'다른 최신 제목'},issues:['최신 수집본 SKU 확인 필요']};
  const componentSource=fs.readFileSync(new URL('../app/components/intake-queue-panel.tsx',import.meta.url),'utf8').replace('sourceItems=[]','sourceItems='+JSON.stringify([later,original]));
  const h=intakeOwnerScopeHarness(company,{componentSource,sourceSeed:{id:'selected-seed',sourceUrl,title:'선택한 제목',sourceCapture:selection}});
  try{
    nodes(h.render()).find(node=>node.type?.name==='CategoryPicker').props.onSelected(h.profile);
    nodes(h.render()).filter(node=>node.type==='button'&&node.props.className==='intake-category-button')[1].props.onClick();
    const picker=nodes(h.render()).find(node=>node.type?.name==='CategoryPicker');assert.equal(picker.props.sourceTitle,'선택한 제목');picker.props.onSelected(h.profile);
    nodes(h.render()).find(node=>node.props?.['aria-label']==='1번째 상품 선택').props.onChange({target:{checked:false}});
    h.button('시작 (1건)').props.onClick();await h.settle();assert.equal(h.collections.length,1);assert.deepEqual(plain(h.collections[0].callbacks.selectedCapture),selection);
    assert.ok(Object.isFrozen(h.collections[0].callbacks.selectedCapture));h.collections[0].resolve('합성 수집 완료');await h.settle();
  }finally{h.close();}
});

test('a replaced seed version rejects the earlier category ticket even with an unchanged URL and seed ID',()=>{
  const seed={id:'same-seed',sourceUrl,sourceCapture:selection},h=intakeOwnerScopeHarness(intakeScopeCompanies[0],{sourceSeed:seed});
  try{const selected=nodes(h.render()).find(node=>node.type?.name==='CategoryPicker').props.onSelected;
    h.setSeed({...seed,sourceCapture:{...selection,revision:3}});const before=plain(h.rows);selected(h.profile);assert.deepEqual(plain(h.rows),before);assert.equal(h.consumed.length,0);
  }finally{h.close();}
});

const collectionCompiled=ts.transpileModule(fs.readFileSync(new URL('../app/intake-collection.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function collectionFixture(options={}){
  const {job=originalJob,fetcher=async()=>Response.json(receipt())}=options,capture=Object.hasOwn(options,'capture')?options.capture:selection;
  const calls=[],imports=[],jobs=[];let probes=0,browsers=0;const exports={};
  vm.runInNewContext(collectionCompiled,{exports,Error,AbortSignal,require(name){
    if(name==='@/app/collection-batch')return{importReceivedJobs:async(values,callbacks)=>{if(options.verifyImportResult)await callbacks.fetcher(`/api/collection-jobs/${encodeURIComponent(values[0].id)}/result`,{cache:'no-store'});
      imports.push(plain(values));await callbacks.onProductSaved(values[0].id,'synthetic-product');callbacks.onResult(values[0].id,{status:'completed',productId:'synthetic-product',completedImages:0});}};
    if(name==='@/app/intake-seo')return{prepareIntakeSeoOutcome:()=>assert.fail('collect-only does not generate SEO')};
    return providedOptionModule(name.slice(2)+'.ts');
  }});
  return{calls,imports,jobs,get probes(){return probes;},get browsers(){return browsers;},run:()=>exports.collectIntakeProduct(job,{selectedCapture:capture,signal:new AbortController().signal,
    fetcher:async(path,init)=>{calls.push({path,init});return fetcher(path,init);},onJob:value=>jobs.push(value),onProgress(){},
    probeExistingFromBrowser:async()=>{probes++;throw Error('must not probe');},captureFromBrowser:async()=>{browsers++;throw Error('must not capture');}})};
}
test('selected capture enters collect directly and never probes, opens Chrome, supplements or sends a provider fallback',async()=>{
  const f=collectionFixture(),message=await f.run();assert.match(message,/상품 추가 완료/);assert.equal(f.calls.length,1);
  assert.deepEqual(JSON.parse(f.calls[0].init.body),{browserCapture:selection});assert.equal(f.probes,0);assert.equal(f.browsers,0);assert.equal(f.imports.length,1);
});
for(const mode of ['unavailable','conflict','network','500','html'])test(`selected capture ${mode} is terminal and cannot recover another receipt by GET`,async()=>{
  const f=collectionFixture({fetcher:async()=>{if(mode==='network')throw Error('synthetic ACK lost');if(mode==='html')return new Response('<html>broken</html>');
    return Response.json({code:mode==='conflict'?'SOURCE_SELECTION_CONFLICT':'SOURCE_NOT_COLLECTED',error:'선택한 원문 확인 필요'},{status:mode==='500'?500:mode==='conflict'?409:422});}});
  await assert.rejects(f.run());assert.equal(f.calls.length,1);assert.equal(f.calls[0].init.method,'POST');assert.equal(f.imports.length,0);assert.equal(f.probes,0);assert.equal(f.browsers,0);assert.equal(f.jobs.length,0);
});
test('linked selected work with no receipt stays protected while ordinary linked work stays unchanged',async()=>{
  for(const job of [{...originalJob,product_id:'working-product'}]){
    const f=collectionFixture({job});await assert.rejects(f.run(),/기존 작업.*새 초안/);assert.equal(f.calls.length,0);assert.equal(f.imports.length,0);
  }
  const f=collectionFixture({job:{...originalJob,product_id:'working-product'},capture:undefined});assert.match(await f.run(),/기존 상품 열기/);assert.equal(f.calls.length,0);
});
test('the same received selection must pass one exact collect POST before import and a changed receipt clock stays terminal',async()=>{
  const job={...originalJob,received_at:'2026-10-20T00:00:01.000Z'},f=collectionFixture({job});assert.match(await f.run(),/상품 추가 완료/);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].init.method,'POST');assert.deepEqual(JSON.parse(f.calls[0].init.body),{browserCapture:selection});assert.equal(f.imports.length,1);
  const mismatch=collectionFixture({job,fetcher:async()=>{const body=receipt();body.receipt.receivedAt='2026-10-20T00:00:02.000Z';return Response.json(body);}});
  await assert.rejects(mismatch.run(),/보관된 수집 원문이 변경/);assert.equal(mismatch.calls.length,1);assert.equal(mismatch.imports.length,0);
});
test('a queued already-received selection is forwarded for exact validation rather than silently acknowledged or blocked',async()=>{
  const calls=[],states=[];await queue.submitIntakeQueue([row()],'collect',{signal:new AbortController().signal,onJobs(){},onRow:(_id,state)=>states.push(state),
    fetcher:async()=>Response.json({jobs:[{...originalJob,received_at:'2026-10-20T00:00:01.000Z'}],preservedRequests:[]}),
    collect:async(job,_progress,_product,capture)=>{calls.push({job,capture});return '검증 후 재개';}});
  assert.equal(calls.length,1);assert.deepEqual(plain(calls[0].capture),selection);assert.equal(states.at(-1).status,'saved');
});
const withImages=()=>{const body=receipt();body.receipt.result.images=[{url:'https://cbu01.alicdn.com/synthetic-753-main.png',role:'main'},{url:'https://cbu01.alicdn.com/synthetic-753-detail.png',role:'detail'}];return body;};
for(const mode of ['complete','excluded'])test(`already linked ${mode} image work performs exact receipt/capacity reads only and never prepares SEO or image roles`,async()=>{
  const job={...originalJob,goal:'work',product_id:'synthetic-product',received_at:'2026-10-20T00:00:01.000Z'};
  const f=collectionFixture({job,fetcher:async(path)=>path.endsWith('/collect')?Response.json(withImages()):Response.json({capacity:{usedSlots:2,totalImages:2,
    reusableIndices:mode==='complete'?[0,1]:[0],blockedIndices:mode==='excluded'?[1]:[]}})});
  assert.match(await f.run(),/기존 상품 열기/);assert.equal(f.imports.length,0);assert.equal(f.probes,0);assert.equal(f.browsers,0);
  assert.deepEqual(f.calls.map(call=>[call.path.split('/').at(-1),call.init.method??'GET']),[['collect','POST'],['capacity','GET']]);
  assert.ok(f.jobs.every(value=>value.product_id==='synthetic-product'));
});
test('linked partial images resume only after exact source validation and do not rerun SEO or image-role draft writes',async()=>{
  const job={...originalJob,goal:'work',product_id:'synthetic-product',received_at:'2026-10-20T00:00:01.000Z'};
  const f=collectionFixture({job,verifyImportResult:true,fetcher:async(path)=>path.endsWith('/capacity')?Response.json({capacity:{usedSlots:1,totalImages:2,reusableIndices:[0]}}):Response.json(withImages())});
  assert.match(await f.run(),/누락된 원본 이미지를 반영/);assert.equal(f.imports.length,1);assert.equal(f.browsers,0);
  assert.deepEqual(f.calls.map(call=>[call.path.split('/').at(-1),call.init.method??'GET']),[['collect','POST'],['capacity','GET'],['result','GET']]);
});
test('a different source returned by import after the exact ACK cannot reach product/image writes',async()=>{
  const job={...originalJob,product_id:'synthetic-product',received_at:'2026-10-20T00:00:01.000Z'};
  const f=collectionFixture({job,verifyImportResult:true,fetcher:async(path)=>{
    if(path.endsWith('/capacity'))return Response.json({capacity:{usedSlots:1,totalImages:2,reusableIndices:[0]}});
    const body=withImages();if(path.endsWith('/result'))body.receipt.result.title='다른 수집본';return Response.json(body);
  }});
  await assert.rejects(f.run(),/이미지 반영 전에.*원문이 변경/);assert.equal(f.imports.length,0);
  assert.ok(f.calls.every(call=>call.path.endsWith('/collect')||call.init.method===undefined));
});
for(const phase of ['headers','body'])test(`selected capture stalled ${phase} times out without a recovery GET or accepting a late other receipt`,async()=>{
  const h=acknowledgementClock(),held=deferred(),calls=[];
  const value=observe(h.requestIntakeCollectionReceipt(originalJob,'collect',{capture:selection,signal:new AbortController().signal,fetcher:async(path,init)=>{
    calls.push({path,init});return phase==='headers'?held.promise:{ok:true,status:200,json:()=>held.promise};}}));
  await settle();h.fire(40_000);await settle();assert.match(value.error.message,/선택한 수집본.*확정되지/);assert.equal(calls.length,1);assert.equal(calls[0].init.signal.aborted,true);
  held.resolve(phase==='headers'?Response.json(receipt()):receipt());await settle();assert.equal(calls.length,1);assert.equal(value.value,undefined);assert.equal(h.timers.size,0);
});

const fixtureText=file=>fs.readFileSync(new URL('./fixtures/'+file,import.meta.url),'utf8');
function dbSnapshot(h){return JSON.stringify(h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({name})=>[name,h.sqlite.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all()]));}
function contentEdits(row){const content=JSON.parse(row.payload);delete content.revision;delete content.updatedAt;return content;}
for(const company of intakeScopeCompanies)test(company.code+': actual selected-source API/SQLite image retry saves only missing bytes, preserves edits, then completed work is read only',async()=>{
  const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
  try{
    const model=h.load('app/alibaba-mobile-product.ts'),mobile=JSON.parse(fixtureText('1688-mobile-813724060928.json'));
    const original=model.parseAlibabaMobileProduct(model.parseAlibabaMobilePage('<script>window.__INIT_DATA='+JSON.stringify(mobile)+';</script>',h.sourceUrl),
      JSON.parse(fixtureText('1688-skus-813724060928.json')),model.parseAlibabaMobileDescription(fixtureText('1688-description-813724060928.txt')));
    const snapshot=extractPageSource({sourceUrl:h.sourceUrl,title:'合成重试商品',priceText:'¥5.00',minimumOrderText:'1件起批',scripts:[JSON.stringify({subject:'合成重试商品',
      skuModel:{offerId:'813724060928',skuInfoMap:{black:{skuId:'synthetic-retry-black',specAttrs:'黑色',price:'5.00'}}},offerImgList:original.images.slice(0,2).map(image=>image.url)})]});
    const fingerprint=await h.load('app/source-inbox.ts').pageSourceFingerprint(snapshot),api=h.load('app/api/source-inbox/route.ts');
    const added=await api.POST(new Request('https://app.test/api/source-inbox',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:'owner',
      expectedCompany:{code:company.code,name:company.name},id:captureId,fingerprint,snapshot})}));assert.equal(added.status,200,await added.clone().text());
    const selectedCapture={format:'yoofam-saved-page-capture-v1',captureId,fingerprint,revision:1,sourceUrl:h.sourceUrl};
    h.sqlite.prepare("UPDATE collection_jobs SET goal='collect' WHERE id='job'").run();h.stats.failImageIndex=1;
    const currentJob=()=>h.load('db/collection-jobs.ts').findCollectionJob('owner','job');
    const request=(path,init)=>h.route(path,{method:init?.method??'GET',body:init?.body});
    const run=async()=>h.load('app/intake-collection.ts').collectIntakeProduct(await currentJob(),{selectedCapture,signal:new AbortController().signal,fetcher:request,onJob(){},onProgress(){}});
    await assert.rejects(run(),/이미지/);const linked=await currentJob();assert.ok(linked.product_id);assert.ok(linked.received_at);
    const id=linked.product_id,contentResponse=await h.route('/api/products/'+id+'/content');assert.equal(contentResponse.status,200);const content=(await contentResponse.json()).content;
    const keys=JSON.parse(h.sqlite.prepare('SELECT image_keys FROM products WHERE id=?').get(id).image_keys);assert.equal(keys.length,1);
    const edited=await h.route('/api/products/'+id+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'직접 수정한 작업 상품',keywords:['보존 태그']},assets:{main:[keys[0]]}}}});
    assert.equal(edited.status,200,await edited.clone().text());
    const beforeContent=h.sqlite.prepare('SELECT * FROM product_content WHERE product_id=?').get(id),beforeOptions=h.sqlite.prepare('SELECT * FROM product_options WHERE product_id=?').get(id);
    h.stats.failImageIndex=null;const downloads=h.stats.downloads,ai=h.aiSources.length,message=await run();assert.match(message,/누락된 원본 이미지/);
    assert.equal(h.stats.downloads-downloads,1,'only the missing local fixture image is fetched; the original is reused');assert.equal(h.aiSources.length,ai);
    assert.deepEqual(contentEdits(h.sqlite.prepare('SELECT * FROM product_content WHERE product_id=?').get(id)),contentEdits(beforeContent));assert.deepEqual(h.sqlite.prepare('SELECT * FROM product_options WHERE product_id=?').get(id),beforeOptions);
    const completeBefore=dbSnapshot(h),objects=JSON.stringify([...h.objects].map(([key,bytes])=>[key,Buffer.from(bytes).toString('base64')])),callStart=h.calls.length,downloadStart=h.stats.downloads;
    assert.match(await run(),/기존 상품 열기/);assert.deepEqual(h.calls.slice(callStart),['/api/collection-jobs/job/collect','/api/collection-jobs/job/capacity']);
    assert.equal(dbSnapshot(h),completeBefore);assert.equal(JSON.stringify([...h.objects].map(([key,bytes])=>[key,Buffer.from(bytes).toString('base64')])),objects);assert.equal(h.stats.downloads,downloadStart);
    assert.ok(h.network.every(host=>host==='cbu01.alicdn.com'),'only in-memory CDN byte fixtures run; no source/provider/translation requests');
  }finally{h.close();}
});

test('actual SQLite late product creation adopts explicit reused ACK and stops before SEO, image or role writes on completed work',async()=>{
  const company=intakeScopeCompanies[0],h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
  try{
    const model=h.load('app/alibaba-mobile-product.ts'),mobile=JSON.parse(fixtureText('1688-mobile-813724060928.json'));
    const original=model.parseAlibabaMobileProduct(model.parseAlibabaMobilePage('<script>window.__INIT_DATA='+JSON.stringify(mobile)+';</script>',h.sourceUrl),
      JSON.parse(fixtureText('1688-skus-813724060928.json')),model.parseAlibabaMobileDescription(fixtureText('1688-description-813724060928.txt')));
    const snapshot=extractPageSource({sourceUrl:h.sourceUrl,title:'合成并发商品',priceText:'¥5.00',minimumOrderText:'1件起批',scripts:[JSON.stringify({subject:'合成并发商品',
      skuModel:{offerId:'813724060928',skuInfoMap:{black:{skuId:'synthetic-race-black',specAttrs:'黑色',price:'5.00'}}},offerImgList:original.images.slice(0,2).map(image=>image.url)})]});
    const fingerprint=await h.load('app/source-inbox.ts').pageSourceFingerprint(snapshot),api=h.load('app/api/source-inbox/route.ts');
    const added=await api.POST(new Request('https://app.test/api/source-inbox',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:'owner',
      expectedCompany:{code:company.code,name:company.name},id:captureId,fingerprint,snapshot})}));assert.equal(added.status,200,await added.clone().text());
    const selectedCapture={format:'yoofam-saved-page-capture-v1',captureId,fingerprint,revision:1,sourceUrl:h.sourceUrl};
    h.sqlite.prepare("UPDATE collection_jobs SET goal='work' WHERE id='job'").run();
    const job=await h.load('db/collection-jobs.ts').findCollectionJob('owner','job');assert.equal(job.product_id,null);
    let competitor=false,confirmedId=null,before=null,objects=null,callStart=0;
    const fetcher=async(path,init)=>{
      const request={method:init?.method??'GET',body:init?.body};
      if(path.endsWith('/product')&&request.method==='POST'&&!competitor){
        competitor=true;const created=await h.route(path,request),ack=await created.json();assert.equal(created.status,200);assert.equal(ack.reused,false);confirmedId=ack.productId;
        for(const index of [0,1]){const image=await h.route('/api/collection-jobs/job/images',{method:'POST',body:{index,assignToStage:false}});assert.equal(image.status,200,await image.clone().text());}
        const response=await h.route('/api/products/'+confirmedId+'/content'),content=(await response.json()).content;
        const edited=await h.route('/api/products/'+confirmedId+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'다른 창에서 수정한 상품',keywords:['그대로 보존']}}}});
        assert.equal(edited.status,200,await edited.clone().text());before=dbSnapshot(h);objects=JSON.stringify([...h.objects]);callStart=h.calls.length;
      }
      const response=await h.route(path,request);
      if(path.endsWith('/product')&&request.method==='POST'){const ack=await response.clone().json();assert.equal(ack.reused,true);assert.equal(ack.productId,confirmedId);}
      return response;
    };
    const reported=[];assert.match(await h.load('app/intake-collection.ts').collectIntakeProduct(job,{selectedCapture,signal:new AbortController().signal,fetcher,onJob:value=>reported.push(value),onProgress(){}}),/기존 상품 열기/);
    assert.equal(competitor,true);assert.equal(h.aiSources.length,0);assert.equal(dbSnapshot(h),before);assert.equal(JSON.stringify([...h.objects]),objects);
    assert.deepEqual(h.calls.slice(callStart),['/api/collection-jobs/job/product','/api/collection-jobs/job/capacity']);assert.ok(reported.some(value=>value.product_id===confirmedId));
    assert.equal(h.stats.downloads,2);assert.ok(h.network.every(host=>host==='cbu01.alicdn.com'));
  }finally{h.close();}
});
