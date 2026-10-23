import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';

const fixtureUrl=new URL('./dashboard-account-actions.test.mjs',import.meta.url),source=fs.readFileSync(fixtureUrl,'utf8'),ast=ts.createSourceFile(fixtureUrl.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declarations=ast.statements.filter(statement=>ts.isVariableStatement(statement)||ts.isFunctionDeclaration(statement)).map(statement=>statement.getText(ast)).join('\n').replaceAll('import.meta.url',JSON.stringify(fixtureUrl.href));
const {harness,nodes}=vm.runInNewContext(declarations+'\n({harness,nodes})',{assert,fs,vm,ts,createRequire,URL,Response,Request,File,Blob,FormData,URLSearchParams,TextEncoder,TextDecoder,AbortController,AbortSignal,crypto,structuredClone,setImmediate,setTimeout,clearTimeout});
const stageIds=['seo','pricing','mainImage','additionalImages','detailImage','sizeChart','koreanLabel','quotation'];
const check=(h,label,value)=>{const input=nodes(h.render()).find(node=>node.type==='input'&&node.props['aria-label']===label);assert.ok(input,label);input.props.onChange({target:{checked:value}});};
const plain=value=>JSON.parse(JSON.stringify(value));

test('전체 작업 selects all eight work stages, while product selection remains a separate menu',async()=>{
 const h=harness();try{await h.settle();assert.equal(nodes(h.render()).filter(node=>node.type==='input'&&String(node.props['aria-label']).endsWith(' 작업')).length,9);h.component('registration-board').onSelected(new Set([h.products[0].id]));const before=JSON.stringify(h.products);await h.click('작업 개시');const panel=h.component('batch-work-panel');assert.deepEqual(plain(panel.runRequest.stages),stageIds);assert.equal(panel.runRequest.ownerId,'test-owner');assert.deepEqual(plain(panel.products.map(item=>item.id)),[h.products[0].id]);assert.equal(JSON.stringify(h.products),before);assert.equal(h.button('작업 개시').props.disabled,true);assert.equal(h.requests.some(call=>call.method!=='GET'),false,'the host hands immutable intent to the runner; it does not run pricing itself');}finally{h.close();}
});

test('partial work freezes only chosen stages/products and rejects repeated or retained kickoff while running',async()=>{
 const h=harness();try{await h.settle();check(h,'전체 작업',false);check(h,'SEO 작업',true);check(h,'견적서 작업',true);h.component('registration-board').onSelected(new Set([h.products[1].id]));const start=h.button('작업 개시').props.onClick;start();const first=h.component('batch-work-panel');assert.deepEqual(plain(first.runRequest.stages),['seo','quotation']);assert.deepEqual(plain(first.products.map(item=>item.id)),[h.products[1].id]);start();assert.equal(h.component('batch-work-panel').runRequest.id,first.runRequest.id);check(h,'가격 작업',true);h.component('registration-board').onSelected(new Set([h.products[0].id]));assert.deepEqual(plain(h.component('batch-work-panel').runRequest.stages),['seo','quotation']);assert.deepEqual(plain(h.component('batch-work-panel').products.map(item=>item.id)),[h.products[1].id]);first.onBusyChange(false);await h.click('×');await h.click('선택 상품 일괄 작업');assert.equal(h.component('batch-work-panel').runRequest,undefined);}finally{h.close();}
});

test('no selected task cannot start, and old scope callbacks cannot revive or unlock a new owner run',async()=>{
 const h=harness();try{await h.settle();h.component('registration-board').onSelected(new Set([h.products[0].id]));check(h,'전체 작업',false);assert.equal(h.button('작업 개시').props.disabled,true);h.button('작업 개시').props.onClick();assert.equal(h.component('batch-work-panel'),undefined);check(h,'SEO 작업',true);const oldStart=h.button('작업 개시').props.onClick;await h.click('작업 개시');const old=h.component('batch-work-panel');h.products[0].owner_id='next-owner';h.setSettingsBody({settings:{},scope:{ownerId:'next-owner',company:{code:'A01464742',name:'와이홉'}}});h.switchOwner('next-owner');await h.settle();assert.equal(h.component('batch-work-panel'),undefined);oldStart();old.onBusyChange(true);old.onOpen(h.products[0].id,'SEO');assert.equal(h.component('batch-work-panel'),undefined);await h.click('작업 개시');const current=h.component('batch-work-panel');assert.equal(current.runRequest.ownerId,'next-owner');old.onBusyChange(false);assert.equal(h.button('작업 개시').props.disabled,true);current.onBusyChange(false);}finally{h.close();}
});

test('an active selected run blocks settings saves and retained add, submit, edit and delete callbacks',async()=>{
 const h=harness();try{
  await h.settle();await h.click('⚙ 기본설정');await h.settle();
  const settings=h.component('workspace-settings-editor'),toggle=h.button('⚙ 기본설정').props.onClick,add=h.button('＋ 상품 추가').props.onClick,submit=h.button('등록 전송').props.onClick,board=h.component('registration-board');
  assert.ok(settings);board.onSelected(new Set([h.products[0].id]));await h.click('작업 개시');
  for(const label of ['⚙ 기본설정','＋ 상품 추가','등록 전송'])assert.equal(h.button(label).props.disabled,true,label);
  assert.equal(nodes(h.render()).find(node=>node.type==='fieldset'&&node.props['aria-label']==='기본설정 편집').props.disabled,true);
  toggle();add();submit();board.onOpen(h.products[0]);board.onOptions(h.products[0]);
  await assert.rejects(()=>settings.onSave(settings.value),/일괄 작업/);await assert.rejects(()=>board.onDelete(h.products[0]),/진행 중인 작업/);await h.settle();
  assert.ok(h.component('workspace-settings-editor'),'the edited form stays mounted');assert.equal(h.component('intake-queue-panel'),undefined);assert.equal(h.component('submission-review-panel'),undefined);assert.equal(h.component('product-content-editor'),undefined);assert.equal(h.requests.some(call=>call.method!=='GET'),false);
  h.component('batch-work-panel').onBusyChange(false);assert.equal(h.button('⚙ 기본설정').props.disabled,false);await settings.onSave(settings.value);assert.equal(h.requests.filter(call=>call.method==='PUT'&&call.url==='/api/settings').length,1);
 }finally{h.close();}
});

test('returning to the same owner cannot resurrect an earlier batch session or its retained kickoff',async()=>{
 const h=harness();try{
  await h.settle();h.component('registration-board').onSelected(new Set([h.products[0].id]));const oldStart=h.button('작업 개시').props.onClick;await h.click('작업 개시');const old=h.component('batch-work-panel');
  for(const ownerId of ['other-owner','test-owner']){for(const product of h.products)product.owner_id=ownerId;h.setSettingsBody({settings:{},scope:{ownerId,company:{code:'A01526306',name:'유앤채'}}});h.switchOwner(ownerId);assert.equal(h.component('batch-work-panel'),undefined);await h.settle();}
  oldStart();old.onBusyChange(true);assert.equal(h.component('batch-work-panel'),undefined);assert.equal(h.button('작업 개시').props.disabled,false);
  await h.click('작업 개시');assert.notEqual(h.component('batch-work-panel').runRequest.id,old.runRequest.id);old.onBusyChange(false);assert.equal(h.button('작업 개시').props.disabled,true);h.component('batch-work-panel').onBusyChange(false);
 }finally{h.close();}
});
