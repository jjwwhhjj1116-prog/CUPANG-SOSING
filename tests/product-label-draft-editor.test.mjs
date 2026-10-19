import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {createHash,webcrypto} from 'node:crypto';

const fixtureUrl=new URL('./product-label-editor.test.mjs',import.meta.url),source=fs.readFileSync(fixtureUrl,'utf8');
const ast=ts.createSourceFile(fixtureUrl.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),parts=[];
for(const statement of ast.statements){
  if(ts.isImportDeclaration(statement))continue;
  if(ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(ast)==='test')break;
  parts.push(statement.getText(ast));
}
const helpers=parts.join('\n').replaceAll('import.meta.url',JSON.stringify(fixtureUrl.href))
  .replace('{exports,Error,AbortController','{exports,crypto:webcrypto,JSON,TextDecoder,Date,setTimeout,clearTimeout,Error,AbortController');
const {editor,fixture,nodes,text,deferred}=vm.runInNewContext(helpers+'\n({editor,fixture,nodes,text,deferred})',
  {assert,fs,vm,path,ts,createRequire,webcrypto,Response,Blob,JSON,URL,Date,AbortController,structuredClone,TextEncoder,TextDecoder,setImmediate,setTimeout,clearTimeout});
const plain=value=>JSON.parse(JSON.stringify(value));
const aiButton='한글 표시사항 생성 시작',pngButton='저장한 표시사항 PNG 미리보기';
const cases=[],files=['app/components/product-label-editor.tsx','app/product-label-draft.ts','app/product-label.ts','app/quotation-ai.ts','tests/product-label-draft-editor.test.mjs','tests/product-label-editor.test.mjs'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')]));
const frozen=hashes();
after(()=>{assert.deepEqual(hashes(),frozen);fs.writeFileSync(new URL('../outputs/step704-draft-ui-proof.json',import.meta.url),JSON.stringify({format:'product-label-draft-editor-proof-v1',sourceHashes:frozen,cases,
  boundary:'Actual component callbacks/model result verification; local API, hooks, canvas and attachment fixtures. No external AI or operating product writes.',externalRequests:0,operatingProductWrites:0,supplierHubWrites:0},null,2)+'\n');});
function fresh(){
  const f=fixture();delete f.view.overrides.common.material;delete f.view.overrides.common.netContents;
  function restoreCollectedFacts(){for(const row of f.view.rows){
    if(row.optionId!=='blue')row.automatic.material='硅胶';
    if(!Object.hasOwn(f.view.overrides.options[row.optionId]??{},'material')&&!Object.hasOwn(f.view.overrides.common,'material')){row.values.material='硅胶';row.sources.material='content';}
    if(!Object.hasOwn(f.view.overrides.options[row.optionId]??{},'netContents')&&!Object.hasOwn(f.view.overrides.common,'netContents')){row.values.netContents='';row.sources.netContents='empty';}
  }}
  restoreCollectedFacts();
  // The older fixture reconstructs its fixed automatic facts after every PUT.
  // Retain this test's additional collected material fact across the same save.
  const reply=f.reply;f.reply=(url,init)=>{reply(url,init);restoreCollectedFacts();return Response.json(f.view);};
  return f;
}
function result(view,optionId='red',values={netContents:'1개',material:'실리콘',productType:'보호 밴드'}){
  return {productId:view.productId,optionId,profileId:view.categoryContext.profileId,productVersion:view.productVersion,labelRevision:view.revision,inputFingerprint:view.inputFingerprint,
    values,warnings:['AI 초안이므로 상품과 대조해주세요.'],provider:'Cloudflare Workers AI',model:'@cf/meta/llama-3.3-70b-instruct-fp8-fast',generatedAt:'2026-10-18T00:00:00.000Z'};
}
const draftCalls=h=>h.calls.filter(call=>call.url.includes('/product-label-draft'));
const puts=h=>h.calls.filter(call=>call.init?.method==='PUT');

test('label generation requests the three-field draft once, stages an actual before/after review, then only explicit save persists edited proposals',async()=>{
  const f=fresh(),before=plain(f.view),h=editor((url,init)=>url.includes('/product-label-draft')?Response.json(result(f.view)):f.reply(url,init));
  try{
    await h.idle();assert.equal(draftCalls(h).length,0);await h.click(aiButton);
    assert.equal(draftCalls(h).length,1);const call=draftCalls(h)[0];assert.equal(call.url,'/api/products/p/product-label-draft?profileId=cat');
    assert.deepEqual(JSON.parse(call.init.body),{optionId:'red',expectedRevision:before.revision,expectedInputFingerprint:before.inputFingerprint});
    assert.deepEqual(plain(f.view),before);assert.equal(puts(h).length,0);assert.equal(h.plans.length,0);assert.equal(h.attachments.length,0);
    assert.equal(h.input('선택 옵션 원료명 및 성분명(재질)').props.value,'실리콘');assert.equal(h.input('선택 옵션 내용량').props.value,'1개');
    assert.equal(h.input('선택 옵션 제품명').props.value,'검정 수정 제품명');assert.match(text(h.render()),/硅胶.*실리콘/u);
    assert.ok(nodes(h.render()).some(node=>node.props?.['aria-label']==='생성한 표시사항 초안 검토'));assert.equal(h.button(pngButton).props.disabled,true);
    h.edit('선택 옵션 내용량','검수한 2개');await h.click('정보 저장하기');assert.equal(puts(h).length,1);assert.equal(h.saved,1);
    const changes=JSON.parse(puts(h)[0].init.body).changes;assert.deepEqual(changes.map(change=>change.fieldKey).sort(),['material','netContents','productType']);
    assert.ok(changes.every(change=>change.optionId==='red'));assert.equal(f.view.overrides.options.red.netContents,'검수한 2개');
    assert.deepEqual(plain(f.view.overrides.options.blue),before.overrides.options.blue);assert.deepEqual(plain(f.view.overrides.common),before.overrides.common);
    assert.equal(h.plans.length,0);assert.equal(h.attachments.length,0);
    cases.push({name:'review and explicit save',requests:1,writes:1,sourceAndOtherOptionPreserved:true,editedBeforeSave:true,completionBoundary:'mocked; full chain covered separately',renderedPlans:0,attachmentFixtureCalls:0});
  }finally{h.close();}
});

test('common-scope draft can be cancelled without a write, preserves explicit option edits, and a later fresh user request is separate',async()=>{
  const f=fresh(),before=plain(f.view),h=editor((url,init)=>url.includes('/product-label-draft')?Response.json(result(f.view,null)):f.reply(url,init),{optionId:null});
  try{
    await h.idle();await h.click(aiButton);assert.equal(h.input('상품 공통 원료명 및 성분명(재질)').props.value,'실리콘');
    await h.click('입력 취소·저장 표시사항 다시 조회');assert.deepEqual(plain(f.view),before);assert.equal(h.input('상품 공통 원료명 및 성분명(재질)').props.value,'硅胶');
    assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(puts(h).length,0);assert.equal(draftCalls(h).length,1);
    await h.click(aiButton);await h.click('정보 저장하기');assert.equal(puts(h).length,1);assert.equal(draftCalls(h).length,2);
    assert.ok(JSON.parse(puts(h)[0].init.body).changes.every(change=>change.optionId===null));assert.deepEqual(plain(f.view.overrides.options),before.overrides.options);
    cases.push({name:'common and cancellation',requests:2,cancellationWrites:0,explicitSaveWrites:1,optionOverridesPreserved:true});
  }finally{h.close();}
});

test('malformed, protected-key, wrong option/source and HTTP failure replies never become edits or invoke raster/upload/save',async()=>{
  const mutations=[
    value=>({...value,optionId:'blue'}),value=>({...value,labelRevision:value.labelRevision+1}),
    value=>({...value,productVersion:'2026-10-08T00:00:00.000Z'}),value=>({...value,inputFingerprint:'f'.repeat(64)}),
    value=>({...value,values:{productName:'변조한 제목'}}),value=>({...value,values:{material:'가'.repeat(2001)}}),
    value=>({...value,unexpected:true}),value=>({...value,provider:'another service'}),
  ];
  for(const mutate of [...mutations,null]){
    const f=fresh(),before=plain(f.view),h=editor((url,init)=>url.includes('/product-label-draft')?mutate?Response.json(mutate(result(f.view))):Response.json({error:'AI 초안 응답을 읽지 못했습니다.'},{status:503}):f.reply(url,init));
    try{await h.idle();await h.click(aiButton);assert.deepEqual(plain(f.view),before);assert.equal(h.render().props['data-workspace-dirty'],false);assert.ok(nodes(h.render()).some(node=>node.props?.role==='alert'));assert.equal(draftCalls(h).length,1);assert.equal(puts(h).length,0);assert.equal(h.plans.length,0);assert.equal(h.attachments.length,0);}finally{h.close();}
  }
  cases.push({name:'rejected results',cases:mutations.length+1,localDrafts:0,writes:0,automaticRetries:0});
});

test('source changes during generation or the post-result read keep replies out of the new workspace, and unmount aborts the request',async()=>{
  for(const mode of ['source','option','unmount','server-read']){
    const f=fresh(),pending=deferred(),reply=result(f.view);let postSeen=false;
    const h=editor((url,init)=>{if(url.includes('/product-label-draft')){postSeen=true;return pending.promise;}if(postSeen&&mode==='server-read')f.source();return f.reply(url,init);});
    try{
      await h.idle();h.button(aiButton).props.onClick();await Promise.resolve();assert.equal(draftCalls(h).length,1);
      if(mode==='source')h.source(f.source());else if(mode==='option')h.select('blue');else if(mode==='unmount')h.close();
      pending.resolve(Response.json(reply));
      if(mode==='unmount'){await new Promise(resolve=>setImmediate(resolve));assert.equal(h.lateWrites,0);assert.equal(draftCalls(h)[0].init.signal.aborted,true);}
      else{await h.idle();assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(h.input('선택 옵션 상품 유형').props.value,'');}
      assert.equal(puts(h).length,0);assert.equal(h.plans.length,0);
    }finally{if(mode!=='unmount')h.close();}
  }
  cases.push({name:'generation lifecycle',sourceAndOptionChangesIgnored:true,postReadChangedSourceBlocked:true,unmountAborted:true,writes:0});
});

test('an old generate callback cannot overwrite a new local edit, excluded option, busy operation or changed workspace',async()=>{
  const f=fresh(),pending=deferred(),h=editor((url,init)=>url.includes('/product-label-draft')?pending.promise:f.reply(url,init));
  try{
    await h.idle();const old=h.button(aiButton).props.onClick;
    h.edit('선택 옵션 내용량','직접 확인한 내용량');old();await h.idle();assert.equal(draftCalls(h).length,0);assert.equal(h.input('선택 옵션 내용량').props.value,'직접 확인한 내용량');
    await h.click('입력 취소·저장 표시사항 다시 조회');const active=h.button(aiButton).props.onClick;active();active();assert.equal(draftCalls(h).length,1);
    pending.resolve(Response.json(result(f.view)));await h.idle();assert.equal(puts(h).length,0);
    await h.click('입력 취소·저장 표시사항 다시 조회');f.view.rows.find(row=>row.optionId==='blue').included=false;h.select('blue');await h.idle();
    assert.equal(h.button(aiButton).props.disabled,true);old();await h.idle();assert.equal(draftCalls(h).length,1);
    cases.push({name:'stale and busy callbacks',dirtyDraftPreserved:true,requests:1,duplicateCallsBlocked:true,excludedOptionBlocked:true,oldOptionIgnored:true,writes:0});
  }finally{h.close();}
});
