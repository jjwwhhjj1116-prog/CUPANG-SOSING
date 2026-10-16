import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash,webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {deflateSync} from 'node:zlib';
import {mobileIntakeHarness} from './mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './hub-schema.mjs';
import {quotationWorkbook} from './quotation-workbook.mjs';
import {detailStageUI,encodedPng,plain,nodes,text,json} from './option-detail-manual-edit.mjs';
export {plain,nodes,text,json,encodedPng};
export const companies=schemaCompanies;

// Only fixture declarations are loaded: importing an existing test module
// would register its cases again and obscure the independent regression count.
function declarations(file,expose,freeImageRoles){
 const url=new URL('../'+file,import.meta.url),source=fs.readFileSync(url,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),parts=[];
 for(const statement of ast.statements){
  if(ts.isImportDeclaration(statement))continue;
  if(ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(ast)==='test')break;
  if(!ts.isVariableStatement(statement)&&!ts.isFunctionDeclaration(statement)&&!ts.isClassDeclaration(statement)&&!ts.isExpressionStatement(statement))break;
  parts.push(statement.getText(ast));
 }
 let code=parts.join('\n').replaceAll('import.meta.url',JSON.stringify(url.href));
 if(freeImageRoles){const legacy="FREE_IMAGE_ROLES: ['main', 'additional', 'detailTop', 'detail', 'detailBottom']";assert.equal(code.split(legacy).length,2,'adapt only the existing fixture role enum to the actual runtime enum');code=code.replace(legacy,'FREE_IMAGE_ROLES: freeImageRoles');}
 return vm.runInNewContext(code+'\n({'+expose+'})',
  {assert,fs,path,vm,ts,createHash,createRequire,webcrypto,deflateSync,mobileIntakeHarness,hubSchemaSnapshot,schemaCompanies,schemaPath,quotationWorkbook,freeImageRoles,
   URL,URLSearchParams,Blob,File,FormData,Response,Request,Headers,AbortController,AbortSignal,TextEncoder,TextDecoder,Uint8Array,DataView,Buffer,Date,JSON,structuredClone,CompressionStream,DecompressionStream,
   crypto:webcrypto,setTimeout,clearTimeout,setImmediate});
}
const api=declarations('free-image-quotation-linkage.test.mjs','labelFixture');
const refs=declarations('product-label-reference-editor.test.mjs','fixture,editor');
const renderer=declarations('free-image-translation-client.test.mjs','fixture');
export const labelReferenceFixture=refs.fixture,labelReferenceUI=refs.editor;

export async function labelManualFixture(company){
 const f=await api.labelFixture(company),requests=[],networkBaseline=[...f.h.network];
 const account=f.h.load('app/workspace-members.ts').WORKSPACE_ACCOUNTS.find(value=>value.companyCode===company.code&&value.companyName===company.name),now=new Date().toISOString();
 assert.ok(account,'known synthetic approved company account');
 f.h.sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at,reviewed_by) VALUES(?,?,?,?,?,?,?,?,?,?)')
  .run('owner',account.email,'fixture-not-a-password',account.role,'approved',company.code,company.name,now,now,null);
 const clientHarness=renderer.fixture({imageWidth:3,imageHeight:2}),client=clientHarness.client,createCanvas=clientHarness.document.createElement;
 clientHarness.document.createElement=tag=>{const canvas=createCanvas(tag);canvas.toBlob=(callback,type)=>{assert.equal(type,'image/png');callback(new Blob([encodedPng(canvas.width,canvas.height,canvas.pixels)],{type}));};return canvas;};
 const transport=async(url,init={})=>{
  const parsed=new URL(url,'https://app.test'),method=init.method??'GET';requests.push({method,path:parsed.pathname+parsed.search});
  if(parsed.pathname.startsWith('/api/files/')){const key=parsed.pathname.slice(11).split('/').map(decodeURIComponent).join('/'),bytes=f.h.objects.get(key);assert.ok(bytes,'owned synthetic file');return new Response(bytes,{headers:{'content-type':'image/png'}});}
  if(parsed.pathname===f.base+'/image-text')return f.h.load('app/api/products/[id]/image-text/route.ts')[method](new Request(parsed.href,{...init,method}),{params:Promise.resolve({id:f.id})});
  if(parsed.pathname===f.base)return f.h.load('app/api/products/[id]/route.ts').GET(new Request(parsed.href),{params:Promise.resolve({id:f.id})});
  return f.h.route(parsed.pathname+parsed.search,{method,body:init.body});
 };
 const current=async()=>((await json(await f.h.load('app/api/products/[id]/route.ts').GET(new Request('https://app.test'+f.base),{params:Promise.resolve({id:f.id})})))).product;
 const stageUI=detailStageUI({tab:'표시사항',product:await current(),focusedOptionId:f.selected,preferredProfileId:f.profile.id});
 const props=stageUI.record('product-label-editor').props,opened=[];
 const references=refs.editor({helpers:f.h.load('app/product-label-references.ts'),request:transport},{...props,onTranslate:(...args)=>{opened.push(args);props.onTranslate(...args);}});
 const panelProps=stageUI.record('free-image-translation-panel').props;
 const panelFactory=declarations('free-image-translation-panel.test.mjs','fixture',f.h.load('app/free-image-translation.ts').FREE_IMAGE_ROLES).fixture;
 const panel=panelFactory({productId:panelProps.productId,version:panelProps.version,imageKeys:panelProps.imageKeys,quotationContext:panelProps.quotationContext,focusedOptionId:panelProps.focusedOptionId,translationTarget:undefined},
  {sameFreeImageQuotationRequest:client.sameFreeImageQuotationRequest,FreeImageApplyError:client.FreeImageApplyError});
 panel.setSource((image,signal)=>client.readFreeImageSource(f.id,image.source.productVersion,image.source.sourceKey,image.source.role,signal,transport,
  image.source.quotationTarget?Object.fromEntries(Object.entries(image.source.quotationTarget).filter(([key])=>key!=='bindingSha256')):undefined));
 panel.setRender((image,rows,signal,ids,crop)=>client.renderFreeImageTranslation(image,rows,signal,ids,crop));
 panel.setApply((image,signal)=>client.applyFreeImageTranslation(image,signal,transport));panel.setRecover((image,signal)=>client.recoverFreeImageTranslation(image,signal,transport));
 async function settlePanel(){const deadline=Date.now()+10000;do{await panel.settle();if(!panel.render().props['data-workspace-saving'])return;assert.ok(Date.now()<deadline,'actual label source work timed out');await new Promise(resolve=>setTimeout(resolve,1));}while(true);}
 async function openCard(index=2,kind='manual'){
  await references.idle();await references.click(`최종 라벨 ${index} ${kind==='manual'?'문구 영역 편집':kind==='zh'?'중국어 한국어 번역':'영어 한국어 번역'}`);
  const next=stageUI.record('free-image-translation-panel').props,{onProductChanged,onBusyChange,beforeApply,...binding}=next;
  assert.equal(typeof onProductChanged,'function');assert.equal(typeof onBusyChange,'function');assert.equal(typeof beforeApply,'function');panel.setProps(binding);await settlePanel();return next.translationTarget;
 }
 const fileSnapshot=async()=>new Map(await Promise.all([...f.h.objects].map(async([key,bytes])=>[key,{bytes:[...bytes],head:plain(await f.h.bindings.FILES.head(key))}])));
 return {...f,company,requests,networkBaseline,clientHarness,client,transport,current,stageUI,references,opened,panel,openCard,settlePanel,fileSnapshot,
  close(){references.close();panel.close();stageUI.close();f.close();}};
}
