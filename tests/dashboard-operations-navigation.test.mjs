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


test('all shared category links and the compact operations utility preserve active work',async()=>{
 const h=harness();try{
  await h.settle();const links=()=>nodes(h.render()).filter(n=>n.type==='a'&&(n.props.href==='/operations'||n.props.href?.startsWith('/operations?view=')));
  const categories=()=>links().filter(n=>n.props.className.startsWith('studio-menu-item'));
  const expected=['discovery','related','keyword','reviews','compare','inventory','sales-report','revenue','inbound','ad-reports','campaigns','pnl','cost-details','expense-categories','expenses','purchasing','import-cost','ledger','statements','settings'];
  assert.equal(links().length,21);assert.deepEqual(plain(categories().map(n=>n.props.href)),expected.map(id=>'/operations?view='+id));
  const utility=()=>links().find(n=>n.props.href==='/operations');assert.ok(utility().props.className.includes('workspace-utility'));
  for(const link of links()){let stopped=false;link.props.onClick({preventDefault(){stopped=true;}});assert.equal(stopped,false,link.props.href);}
  h.component('registration-board').onSelected(new Set([h.products[0].id]));await h.click('작업 개시');
  assert.equal(utility().props['aria-disabled'],true);
  for(const link of links()){let stopped=false;link.props.onClick({preventDefault(){stopped=true;}});assert.equal(stopped,true,link.props.href);}
  assert.ok(h.component('batch-work-panel'));assert.ok(h.requests.every(call=>call.method==='GET'));
  h.component('batch-work-panel').onBusyChange(false);await h.settle();assert.equal(utility().props['aria-disabled'],false);
  for(const link of links()){let stopped=false;link.props.onClick({preventDefault(){stopped=true;}});assert.equal(stopped,false,link.props.href);}
 }finally{h.close();}
});
