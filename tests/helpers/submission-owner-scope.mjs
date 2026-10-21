import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {mobileIntakeHarness} from './mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './hub-schema.mjs';
import {workbookArchive} from './quotation-workbook.mjs';
import {prepareAttachments} from '../../extensions/supplier-hub/package.mjs';
export const companies=schemaCompanies,plain=value=>JSON.parse(JSON.stringify(value));
const sourceUrl=new URL('../dashboard-account-actions.test.mjs',import.meta.url),source=fs.readFileSync(sourceUrl,'utf8'),ast=ts.createSourceFile(sourceUrl.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),parts=[];
for(const statement of ast.statements){if(ts.isImportDeclaration(statement))continue;if(ts.isForOfStatement(statement)||ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(ast)==='test')break;parts.push(statement.getText(ast));}
const fixtureFns=vm.runInNewContext(parts.join('\n').replaceAll('import.meta.url',JSON.stringify(sourceUrl.href))+'\n({harness,officialSubmissionFlow,nodes,text,scope,settleUntil})',
 {assert,fs,path,vm,ts,createRequire,mobileIntakeHarness,hubSchemaSnapshot,schemaCompanies,schemaPath,workbookArchive,prepareAttachments,
  Response,Request,File,Blob,FormData,URL,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,Buffer,Date,Intl,AbortController,AbortSignal,crypto,structuredClone,setImmediate,setTimeout,clearTimeout,atob,btoa});
export const nodes=fixtureFns.nodes,text=fixtureFns.text;
export async function submissionScopeFixture(company){
 const flow=await fixtureFns.officialSubmissionFlow(company),rawRequest=flow.request,originalProduct=plain(flow.products[0]);let owner='owner',held=null;
 flow.request=async(url,init={})=>{
  if(owner!=='owner')return url==='/api/category-profiles'?Response.json({profiles:[]}):Response.json({error:'다른 합성 계정의 상품입니다.'},{status:404});
  const response=await rawRequest(url,init),body=typeof init.body==='string'?JSON.parse(init.body):null;
  if(held&&held.match(url,init,body)){const pending=held;held=null;pending.signal=init.signal;init.signal?.addEventListener('abort',()=>pending.aborts++,{once:true});pending.arrive();await pending.wait;}
  return response;
 };
 const h=fixtureFns.harness({workspaceOwnerId:'owner',settingsBody:{settings:flow.api.settings,scope:fixtureFns.scope('owner',company.code)},officialFlow:flow});
 const other=companies.find(value=>value.code!==company.code);
 const snapshot=()=>JSON.stringify(Object.fromEntries(['products','product_content','product_options','product_quotation_fields','product_price_policy','supplier_hub_receipts','category_profiles','collection_context','collection_results'].map(table=>[table,flow.api.sqlite.prepare('SELECT * FROM '+table).all()])));
 async function ready(){
  await h.settle();h.component('registration-board').onOpen(h.products[0],'견적서');await h.settle();await h.click('공식 파일 기준으로 연결');
  await fixtureFns.settleUntil(h,()=>!h.button('공식 파일 기준으로 연결'));return snapshot();
 }
 async function open({prepare=true}={}){
  await h.click('저장한 견적 전송 준비');await h.toggleDetails('Excel 파일 전송 · 별도 방식');await fixtureFns.settleUntil(h,()=>Boolean(h.instance('SubmissionPackage')));
  if(prepare){await h.click('견적서 + 첨부 파일 준비');await fixtureFns.settleUntil(h,()=>h.button('확장에 첨부 파일 준비')&&!nodes(h.render()).find(node=>node.props?.['aria-label']==='견적서와 첨부 파일 준비').props['aria-busy']);}
 }
 function switchOwner(next='next-owner'){
  owner=next;const companyForOwner=next==='owner'?company:other;
  // Reuse the ID deliberately in the frontend source to prove an older intent
  // is not revived by ID equality. Saved API/SQLite rows remain untouched.
  flow.products.splice(0,flow.products.length,{...originalProduct,owner_id:next,title:next==='owner'?originalProduct.title:'다음 회사의 합성 상품'});
  h.setSettingsBody({settings:flow.api.settings,scope:fixtureFns.scope(next,companyForOwner.code)});return h.switchOwner(next);
 }
 function defer(match){let arrive,release;const arrived=new Promise(resolve=>arrive=resolve),wait=new Promise(resolve=>release=resolve),pending={match,arrive,wait,signal:null,aborts:0};held=pending;return{arrived,release,get signal(){return pending.signal;},get aborts(){return pending.aborts;}};}
 return{h,flow,company,other,originalProduct,ready,open,switchOwner,defer,snapshot,close(){h.close();flow.close();}};
}
