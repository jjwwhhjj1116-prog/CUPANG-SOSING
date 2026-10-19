import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const fixtureUrl=new URL('./batch-work-panel.test.mjs',import.meta.url),source=fs.readFileSync(fixtureUrl,'utf8'),ast=ts.createSourceFile(fixtureUrl.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declarations=ast.statements.filter(statement=>!ts.isImportDeclaration(statement)&&!(ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression))).map(statement=>statement.getText(ast)).join('\n').replaceAll('import.meta.url',JSON.stringify(fixtureUrl.href));
const {harness,nodes,settle}=vm.runInNewContext('"use strict";\n'+declarations+'\n({harness,nodes,settle})',{assert,fs,vm,ts,createRequire,URL,Response,AbortController,crypto:globalThis.crypto,setImmediate});
test('work-start synchronously locks retained navigation, holds price until SEO decisions and rejects late queue callbacks',async()=>{
 const events=[],h=harness(async()=>Response.json({productId:'p',productVersion:'2026-10-05T00:00:00.001Z',prepared:true,changedRoles:1,changedOptions:1,availableImages:1,message:'합성 이미지 초안'}),value=>events.push(value));try{
  const oldOpen=h.button('이미지 초안 검토').props.onClick,start=h.button('선택 상품 초안 준비·가격 확인').props.onClick;start();oldOpen();start();assert.equal(h.opened.length,0);assert.equal(events[0],true);assert.equal(h.requests.length,0);
  const seo=nodes(h.render()).find(node=>node.props.onComplete);seo.props.onBusyChange(false);seo.props.onPendingChange(true);seo.props.onComplete(seo.props.products);oldOpen();assert.equal(h.requests.length,0);assert.equal(h.opened.length,0);
  seo.props.onPendingChange(false);seo.props.onComplete(seo.props.products);await settle();assert.equal(h.requests.filter(call=>call.url.endsWith('/automation')).length,1);assert.equal(h.requests.filter(call=>call.url.endsWith('/work-draft')).length,1);
  const image=nodes(h.render()).find(node=>node.props.autoPrepare===true);assert.ok(image);image.props.onPendingChange(true);seo.props.onPendingChange(false);seo.props.onBusyChange(false);seo.props.onComplete(seo.props.products);oldOpen();assert.equal(h.opened.length,0);assert.equal(h.button('견적 초안 검토').props.disabled,true);assert.equal(h.requests.filter(call=>call.url.endsWith('/automation')).length,1);
 }finally{h.unmount();}
});
