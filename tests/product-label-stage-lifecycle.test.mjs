import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { createHash, webcrypto } from 'node:crypto';

// Reuse the actual component loader and Object.is scheduler without registering
// old tests or their proof writers. Only APIs, Canvas and completion are local.
const fixtureUrl=new URL('./product-label-draft-autostart.test.mjs',import.meta.url);
const source=fs.readFileSync(fixtureUrl,'utf8'),ast=ts.createSourceFile(fixtureUrl.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),parts=[];
for(const statement of ast.statements){
  if(ts.isImportDeclaration(statement))continue;
  if(ts.isVariableStatement(statement)&&statement.declarationList.declarations.some(declaration=>declaration.name.getText(ast)==='cases'))break;
  parts.push(statement.getText(ast));
}
const helpers=parts.join('\n').replace("new URL('./product-label-editor.test.mjs',import.meta.url)",`new URL('./product-label-editor.test.mjs',${JSON.stringify(fixtureUrl.href)})`);
const {editor,fixture,result,deferred,nodes}=vm.runInNewContext(helpers+'\n({editor,fixture,result,deferred,nodes})',
  {assert,fs,vm,path,ts,createRequire,webcrypto,Response,Blob,JSON,URL,Date,AbortController,structuredClone,TextEncoder,TextDecoder,setImmediate,setTimeout,clearTimeout});
const plain=value=>JSON.parse(JSON.stringify(value)),cases=[];
const mutations=h=>h.calls.filter(call=>['POST','PUT','PATCH','DELETE'].includes(call.init?.method));
const drafts=h=>h.calls.filter(call=>call.url.includes('/product-label-draft'));
const input=h=>h.input('선택 옵션 내용량');
const waitFor=async(check,h)=>{const deadline=Date.now()+10000;while(!check()){assert.ok(Date.now()<deadline,'bounded label stage work');h.render();await new Promise(resolve=>setImmediate(resolve));}};
const files=['app/components/product-label-editor.tsx','tests/product-label-stage-lifecycle.test.mjs'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')])),frozen=hashes();
after(()=>{assert.deepEqual(hashes(),frozen);fs.writeFileSync(new URL('../outputs/step776-label-stage-lifecycle-proof.json',import.meta.url),JSON.stringify({sourceSha256:frozen,cases,
  boundary:'Actual component handlers and existing Object.is hook scheduler; synthetic API, Canvas and label-completion adapters. No vendor/browser or real product access.',
  externalRequests:0,operatingProductWrites:0,supplierHubWrites:0},null,2)+'\n');});

test('inactive value, draft, text-save and PNG controls cannot start work, including callbacks retained across a stage ABA',async()=>{
  for(const mode of ['initial-inactive','hidden','aba']){
    const f=fixture(),before=plain(f.view),h=editor((url,init)=>url.includes('/product-label-draft')?Response.json(result(f.view)):f.reply(url,init),{active:mode!=='initial-inactive'});
    try{
      await h.idle();const value=input(h).props.onChange;
      const callbacks=['한글 표시사항 생성 시작','정보 저장하기','저장한 표시사항 PNG 미리보기'].map(label=>h.button(label).props.onClick);
      if(mode!=='initial-inactive')h.setControls({active:false});
      if(mode==='aba')h.setControls({active:true});
      else for(const label of ['한글 표시사항 생성 시작','정보 저장하기','저장한 표시사항 PNG 미리보기'])assert.equal(h.button(label).props.disabled,true);
      value({target:{value:'늦은 입력'}});for(const callback of callbacks)callback();await h.idle();
      assert.equal(mutations(h).length,0);assert.equal(h.plans.length,0);assert.equal(h.attachments.length,0);assert.equal(h.saved,0);
      assert.deepEqual(plain(f.view),before);assert.equal(input(h).props.value,'');assert.equal(h.render().props['data-workspace-dirty'],false);
    }finally{h.close();}
  }
  cases.push({name:'inactive and retained ABA callbacks',modes:3,mutations:0,renderedImages:0});
});

test('hiding a manual draft preserves its exact values while old save callbacks and inactive edits are rejected',async()=>{
  const f=fixture(),before=plain(f.view),h=editor((url,init)=>f.reply(url,init));try{
    await h.idle();h.edit('선택 옵션 내용량','검토한 2개');const save=h.button('정보 저장하기').props.onClick,edit=input(h).props.onChange;
    h.setControls({active:false});save();edit({target:{value:'숨은 수정'}});await h.idle();
    assert.equal(input(h).props.value,'검토한 2개');assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(mutations(h).length,0);
    h.setControls({active:true});save();await h.idle();assert.equal(mutations(h).length,0,'old stage callback stays invalid after returning');
    await h.click('정보 저장하기');assert.equal(mutations(h).length,1);assert.equal(f.view.overrides.options.red.netContents,'검토한 2개');
    assert.deepEqual(plain(f.view.overrides.options.blue),before.overrides.options.blue);assert.deepEqual(plain(f.view.overrides.common),before.overrides.common);
  }finally{h.close();}cases.push({name:'manual draft survives hide',explicitFreshSaveWrites:1,hiddenWrites:0});
});

test('late AI responses after hide or stage ABA do not become edits and always release busy without automatic retry',async()=>{
  for(const aba of [false,true]){
    const f=fixture(),before=plain(f.view),pending=deferred(),h=editor((url,init)=>url.includes('/product-label-draft')?pending.promise:f.reply(url,init));try{
      await h.idle();h.button('한글 표시사항 생성 시작').props.onClick();assert.equal(drafts(h).length,1);
      h.setControls({active:false});if(aba)h.setControls({active:true});pending.resolve(Response.json(result(f.view)));await h.idle();
      assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(h.render().props['data-workspace-saving'],false);assert.equal(h.notifications.busy.at(-1),false);
      assert.equal(h.input('선택 옵션 상품 유형').props.value,'');assert.equal(drafts(h).length,1);assert.deepEqual(plain(f.view),before);
    }finally{h.close();}
  }cases.push({name:'late AI after hide and ABA',cases:2,adoptedDrafts:0,automaticRetries:0,busyReleased:true});
});

test('a text PUT dispatched before hide is retained for exact read-first recovery rather than repeated or followed by hidden PNG work',async()=>{
  const f=fixture(),before=plain(f.view),pending=deferred();let committed;
  const h=editor((url,init)=>{const response=f.reply(url,init);if(init?.method==='PUT'){committed=response;return pending.promise;}return response;});try{
    await h.idle();h.edit('선택 옵션 내용량','검토한 3개');h.button('정보 저장하기').props.onClick();
    assert.equal(mutations(h).length,1);const sent=mutations(h)[0];h.setControls({active:false});assert.equal(sent.init.signal.aborted,false,'hiding cannot undo a dispatched write');
    pending.resolve(committed);await h.idle();assert.equal(h.saved,0);assert.equal(h.render().props['data-workspace-saving'],false);assert.equal(h.render().props['data-workspace-dirty'],true);
    assert.equal(input(h).props.value,'검토한 3개');assert.equal(h.plans.length,0);assert.equal(h.attachments.length,0);
    h.setControls({active:true});await h.idle();const start=h.calls.length;await h.click('정보 저장하기');
    assert.equal(h.calls[start].init?.method,undefined,'the next action reads before considering another write');assert.equal(mutations(h).length,1);assert.equal(h.saved,1);
    assert.equal(h.render().props['data-workspace-dirty'],false);assert.deepEqual(plain(f.view.overrides.common),before.overrides.common);assert.deepEqual(plain(f.view.overrides.options.blue),before.overrides.options.blue);
  }finally{h.close();}cases.push({name:'committed text response interrupted by hide',puts:1,recoveryPuts:0,hiddenPngWork:0});
});

test('an explicit safe keep-draft rebase releases an uncommitted save basis and preserves a newer other-option value',async()=>{
  const f=fixture(),before=plain(f.view);let fail=true;
  const h=editor((url,init)=>{if(init?.method==='PUT'&&fail){fail=false;return Response.json({error:'synthetic uncommitted save unavailable'},{status:503});}return f.reply(url,init);});try{
    await h.idle();h.edit('선택 옵션 내용량','검토한 새 4개');await h.click('정보 저장하기');
    assert.equal(mutations(h).length,1);assert.deepEqual(plain(f.view),before);assert.equal(h.saved,0);
    f.reply('',{method:'PUT',body:JSON.stringify({expectedRevision:f.view.revision,expectedInputFingerprint:f.view.inputFingerprint,
      changes:[{optionId:'blue',fieldKey:'material',value:'다른 옵션의 새 검토 재질'}]})});
    const latestOther=plain(f.view.overrides.options.blue);
    await h.click('입력 유지·최신 표시사항 조회');assert.equal(input(h).props.value,'검토한 새 4개');assert.equal(mutations(h).length,1);
    await h.click('정보 저장하기');assert.equal(mutations(h).length,2,'one failed request plus exactly one fresh explicit CAS write');assert.equal(h.saved,1);
    const saved=JSON.parse(mutations(h)[1].init.body);assert.equal(saved.expectedRevision,before.revision+1);
    assert.deepEqual(saved.changes,[{optionId:'red',fieldKey:'netContents',value:'검토한 새 4개'}]);
    assert.deepEqual(plain(f.view.overrides.options.blue),latestOther);assert.deepEqual(plain(f.view.overrides.common),before.overrides.common);
  }finally{h.close();}cases.push({name:'safe explicit rebase after failed save',failedRequests:1,freshWrites:1,otherOptionPreserved:true});
});

test('PNG rendering completed after hide is ignored without a blob URL and fresh stage controls can prepare it explicitly',async()=>{
  const f=fixture(),pending=deferred(),h=editor((url,init)=>f.reply(url,init),{renderer:()=>pending.promise});try{
    await h.idle();h.button('저장한 표시사항 PNG 미리보기').props.onClick();await waitFor(()=>h.plans.length===1,h);
    h.setControls({active:false});pending.resolve({blob:new Blob(['synthetic'],{type:'image/png'}),width:800,height:900});await h.idle();
    assert.equal(h.urls.length,0);assert.equal(h.render().props['data-workspace-saving'],false);assert.equal(h.attachments.length,0);assert.equal(mutations(h).length,0);
    h.setControls({active:true});await h.idle();await h.click('저장한 표시사항 PNG 미리보기');assert.equal(h.urls.length,1);assert.equal(h.attachments.length,0);
  }finally{h.close();}cases.push({name:'late raster completion',hiddenUrls:0,hiddenUploads:0,freshExplicitPreview:true});
});

test('a paused attachment cannot issue its next API request while hidden and its reviewed PNG remains available',async()=>{
  const f=fixture(),before=plain(f.view),pending=deferred();
  const h=editor((url,init)=>f.reply(url,init),{attach:async(input,request)=>{await pending.promise;await request('/api/products/p/quotation-fields',{method:'PUT',body:'{}'});return{view:f.view,key:'owner/result.png'};}});try{
    await h.idle();await h.click('저장한 표시사항 PNG 미리보기');h.button('PNG 업로드·견적에 연결').props.onClick();await waitFor(()=>h.attachments.length===1,h);
    h.setControls({active:false});pending.resolve();await h.idle();assert.equal(mutations(h).length,0);assert.equal(h.saved,0);assert.equal(h.render().props['data-workspace-saving'],false);assert.equal(h.urls.length,1);
    assert.deepEqual(plain(f.view),before);h.setControls({active:true});await h.idle();assert.equal(h.button('PNG 업로드·견적에 연결').props.disabled,false);
  }finally{h.close();}cases.push({name:'attachment dispatch guard',hiddenFollowupWrites:0,reviewedPngRetained:true});
});

test('final-label reference editor receives the same inactive stage boundary',async()=>{
  const f=fixture(),h=editor((url,init)=>f.reply(url,init));try{
    await h.idle();h.setControls({active:false});const child=nodes(h.render()).find(node=>typeof node.type==='function'&&node.type.name==='ProductLabelReferenceEditor');
    assert.equal(child.props.active,false);assert.equal(child.props.disabled,true);assert.equal(child.props.beforeSave(),false);
  }finally{h.close();}cases.push({name:'child stage boundary',inactive:true});
});
