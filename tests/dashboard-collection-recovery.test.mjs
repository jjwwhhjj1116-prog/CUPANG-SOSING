import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {reviewSourceFixture} from './helpers/source-review-intake.mjs';

const native=createRequire(import.meta.url);
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const plain=value=>JSON.parse(JSON.stringify(value));
const fixtureUrl=new URL('./dashboard-source-availability.test.mjs',import.meta.url),source=fs.readFileSync(fixtureUrl,'utf8'),ast=ts.createSourceFile(fixtureUrl.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declaration=ast.statements.find(statement=>ts.isFunctionDeclaration(statement)&&statement.name?.text==='dashboard').getText(ast).replaceAll('import.meta.url',JSON.stringify(fixtureUrl.href));
const dashboard=vm.runInNewContext(declaration+'\ndashboard',{assert,fs,vm,ts,native,nodes,text,plain,reviewSourceFixture,URL,URLSearchParams,Response,Date,AbortController,AbortSignal,TextEncoder,TextDecoder,crypto,structuredClone,setImmediate});

test('linked page-capture diagnostics target only missing raw originals on the exact product while unlinked intake stays unchanged',async()=>{
 const h=dashboard({code:'A01526306',name:'유앤채'},'ready');try{
  const linked=h.products[0],sourceUrl=h.saved.snapshot.sourceUrl;linked.source_url=sourceUrl;
  h.jobs.push({id:'linked-capture-job',offer_id:'123',product_id:linked.id,source_url:sourceUrl,status:'awaiting_connector',goal:'work',created_at:'2026-11-04T00:00:00.000Z'},
   {id:'unlinked-job',offer_id:'456',product_id:null,source_url:'https://detail.1688.com/offer/456.html',status:'awaiting_connector',goal:'work',created_at:'2026-11-04T00:00:00.000Z'});
  await h.settle();const panels=nodes(h.render()).filter(node=>node.type?.displayName==='collection-result-panel').map(node=>node.props),recovery=panels.find(props=>props.jobId==='linked-capture-job'),intake=panels.find(props=>props.jobId==='unlinked-job');
  assert.ok(recovery);assert.equal(recovery.productId,linked.id);assert.equal(recovery.expectedProductId,linked.id);assert.equal(recovery.assignToStage,false);
  assert.ok(intake);assert.equal(intake.productId,null);assert.equal(intake.expectedProductId,undefined);assert.equal(intake.assignToStage,undefined);
  assert.ok(h.requests.every(request=>request.method==='GET'));
 }finally{h.close();}
});
