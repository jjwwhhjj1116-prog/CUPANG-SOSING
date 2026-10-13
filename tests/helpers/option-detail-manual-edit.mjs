import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {createHash,webcrypto} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {mobileIntakeHarness} from './mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './hub-schema.mjs';
import {quotationWorkbook} from './quotation-workbook.mjs';

export const companies=schemaCompanies;
export const plain=value=>JSON.parse(JSON.stringify(value));
export const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
export const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
export const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};

// Extract declarations preceding the first test registration. No test module
// is imported, so this shared actual-API fixture registers no duplicate cases.
function declarations(file,expose){
 const url=new URL('../'+file,import.meta.url),source=fs.readFileSync(url,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),parts=[];
 for(const statement of ast.statements){
  if(ts.isImportDeclaration(statement))continue;
  if(ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(ast)==='test')break;
  if(!ts.isVariableStatement(statement)&&!ts.isFunctionDeclaration(statement)&&!ts.isClassDeclaration(statement)&&!ts.isExpressionStatement(statement))break;
  parts.push(statement.getText(ast));
 }
 return vm.runInNewContext(parts.join('\n').replaceAll('import.meta.url',JSON.stringify(url.href))+'\n({'+expose+'})',
  {assert,fs,path,vm,ts,createRequire,createHash,deflateSync,webcrypto,mobileIntakeHarness,hubSchemaSnapshot,schemaCompanies,schemaPath,quotationWorkbook,
   URL,URLSearchParams,Blob,File,FormData,Response,Request,Headers,AbortController,AbortSignal,TextEncoder,TextDecoder,Uint8Array,DataView,CompressionStream,DecompressionStream,Buffer,Date,JSON,structuredClone,
   crypto:webcrypto,console,setTimeout,clearTimeout,setImmediate});
}
const apiHelpers=declarations('free-image-quotation-linkage.test.mjs','fixture,png');
const optionHelpers=declarations('option-image-editor.test.mjs','imageUI');
const panelHelpers=declarations('free-image-translation-panel.test.mjs','fixture');
export const manualPanelFixture=panelHelpers.fixture;
const rendererHelpers=declarations('free-image-translation-client.test.mjs','fixture');
const stageHelpers=declarations('dashboard-option-stages.test.mjs','harness');
const mainHelpers=declarations('option-main-image-editor.test.mjs','editor');
export const detailStageUI=stageHelpers.harness;

export function encodedPng(width,height,pixels){
 const chunk=(name,data)=>{
  const joined=Buffer.concat([Buffer.from(name),data]);let crc=0xffffffff;
  for(const byte of joined){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const size=Buffer.alloc(4),check=Buffer.alloc(4);size.writeUInt32BE(data.length);check.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([size,joined,check]);
 };
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const stride=width*4,rows=Buffer.alloc((stride+1)*height);
 for(let y=0;y<height;y++){rows[y*(stride+1)]=0;Buffer.from(pixels).copy(rows,y*(stride+1)+1,y*stride,(y+1)*stride);}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}

export async function manualEditFixture(company,{stage='detail'}={}){
 const f=await apiHelpers.fixture({company,linkedWire:true,withMain:stage==='main'});
 const requests=[],clientHarness=rendererHelpers.fixture({imageWidth:3,imageHeight:2}),client=clientHarness.client;
 const createCanvas=clientHarness.document.createElement;
 clientHarness.document.createElement=tag=>{
  const canvas=createCanvas(tag),context=canvas.getContext('2d'),draw=context.drawImage;
  context.drawImage=function(image,...args){
   if(args.length===8){
    const[x,y,width,height,dx,dy,destWidth,destHeight]=args;assert.deepEqual([dx,dy,destWidth,destHeight],[0,0,width,height]);assert.equal(canvas.width,width);assert.equal(canvas.height,height);
    assert.ok(x>=0&&y>=0&&x+width<=image.width&&y+height<=image.height);canvas.pixels=new Uint8Array(width*height*4);
    for(let py=0;py<height;py++)for(let px=0;px<width;px++)canvas.pixels.set(image.pixels.subarray(((py+y)*image.width+px+x)*4,((py+y)*image.width+px+x)*4+4),(py*width+px)*4);
    clientHarness.operations.push(['crop',x,y,width,height,dx,dy,destWidth,destHeight]);return;
   }
   return draw.call(this,image,...args);
  };
  canvas.toBlob=(callback,type)=>{assert.equal(type,'image/png');callback(new Blob([encodedPng(canvas.width,canvas.height,canvas.pixels)],{type}));};return canvas;
 };
 const transport=async(url,init={})=>{
  const parsed=new URL(url,'https://app.test'),method=init.method??'GET';requests.push({method,path:parsed.pathname+parsed.search});
  if(parsed.pathname.startsWith('/api/files/')){
   const key=parsed.pathname.slice(11).split('/').map(decodeURIComponent).join('/'),bytes=f.h.objects.get(key);assert.ok(bytes,'owned synthetic file');
   return new Response(bytes,{headers:{'content-type':'image/png'}});
  }
  if(parsed.pathname===f.base+'/image-text'){
   const route=f.h.load('app/api/products/[id]/image-text/route.ts');return route[method](new Request(parsed.href,{...init,method}),{params:Promise.resolve({id:f.id})});
  }
  if(parsed.pathname===f.base)return f.h.load('app/api/products/[id]/route.ts').GET(new Request(parsed.href),{params:Promise.resolve({id:f.id})});
  return f.h.route(parsed.pathname+parsed.search,{method,body:init.body});
 };
 const current=async()=>{const response=await f.h.load('app/api/products/[id]/route.ts').GET(new Request('https://app.test'+f.base),{params:Promise.resolve({id:f.id})});return(await json(response)).product;};
 const sourceSnapshot=()=>f.sourceRows();
 const fileSnapshot=async()=>new Map(await Promise.all([...f.h.objects].map(async([key,bytes])=>[key,{bytes:[...bytes],head:plain(await f.h.bindings.FILES.head(key))}])));
 const stageUI=detailStageUI({tab:stage==='main'?'대표 이미지':stage==='additional'?'추가 이미지':'상세 이미지',product:await current(),focusedOptionId:f.selected,preferredProfileId:f.profile.id});
 const panelProps=stageUI.record('free-image-translation-panel').props;
 const panel=panelHelpers.fixture({productId:panelProps.productId,version:panelProps.version,imageKeys:panelProps.imageKeys,quotationContext:panelProps.quotationContext,focusedOptionId:panelProps.focusedOptionId,translationTarget:undefined},
  {sameFreeImageQuotationRequest:client.sameFreeImageQuotationRequest,FreeImageApplyError:client.FreeImageApplyError});
 panel.setSource((image,signal)=>client.readFreeImageSource(f.id,image.source.productVersion,image.source.sourceKey,image.source.role,signal,transport,
  image.source.quotationTarget?Object.fromEntries(Object.entries(image.source.quotationTarget).filter(([key])=>key!=='bindingSha256')):undefined));
 panel.setRender((image,rows,signal,ids,crop)=>client.renderFreeImageTranslation(image,rows,signal,ids,crop));
 panel.setApply((image,signal)=>client.applyFreeImageTranslation(image,signal,transport));
 panel.setRecover((image,signal)=>client.recoverFreeImageTranslation(image,signal,transport));
 const optionProps=stage==='main'?stageUI.record('product-options-editor',props=>props.imageView===true).props:stageUI.record('option-image-editor',props=>props.stage===stage).props;
 let options;
 if(stage==='main'){
  const main=mainHelpers.editor({backend:f.h,product:await current(),profile:f.profile,id:f.selected,request:transport},{wrapper:true,onEdit:optionProps.onEdit,onTranslate:optionProps.onTranslate});
  options={...main,ordered:()=>nodes(main.render()).filter(node=>node.type==='img'&&node.props.alt==='최종 견적 대표이미지').map(node=>node.props.src.slice(11).split('/').map(decodeURIComponent).join('/')),
   source(value,nextRefresh=main.props.refreshToken){main.props.version=value;main.props.product.updated_at=value;main.props.refreshToken=nextRefresh;main.render();},
   disabled(value){main.props.imageProcessingBusy=value;main.render();}};
 }else options=optionHelpers.imageUI(transport,{...optionProps,onSaved:undefined});
 async function settlePanel(){
  const deadline=Date.now()+10000;do{await panel.settle();if(!panel.render().props['data-workspace-saving'])return;assert.ok(Date.now()<deadline,'actual image API work timed out');await new Promise(resolve=>setTimeout(resolve,1));}while(true);
 }
 async function openCard(index=1){
  await options.idle();await options.click(stage==='main'?'최종 대표이미지 편집하기':(stage==='additional'?'추가 이미지 ':'상세 이미지 ')+index+' 편집하기');
  const props=stageUI.record('free-image-translation-panel').props;assert.equal(props.translationTarget.intent,'manual');
  const {onProductChanged,onBusyChange,beforeApply,...binding}=props;assert.equal(typeof onProductChanged,'function');assert.equal(typeof onBusyChange,'function');assert.equal(typeof beforeApply,'function');panel.setProps(binding);await settlePanel();
  return props.translationTarget;
 }
 return {...f,company,stage,requests,intakeNetworkBaseline:[...f.h.network],clientHarness,client,transport,current,sourceSnapshot,fileSnapshot,stageUI,panel,options,openCard,settlePanel,
  close(){options.close();panel.close();stageUI.close();f.close();}};
}
