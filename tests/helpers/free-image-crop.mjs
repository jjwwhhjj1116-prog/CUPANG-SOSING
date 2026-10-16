import fs from 'node:fs';import vm from 'node:vm';import path from 'node:path';import ts from 'typescript';import assert from 'node:assert/strict';
import * as parse5 from 'parse5';
import {createHash,webcrypto} from 'node:crypto';import {deflateSync} from 'node:zlib';
import {memoryDatabase} from '../../scripts/check-db-schema.mjs';
import {mobileIntakeHarness} from './mobile-intake.mjs';import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './hub-schema.mjs';import {quotationWorkbook} from './quotation-workbook.mjs';
export const plain=value=>JSON.parse(JSON.stringify(value));
function declarations(file,expose){const url=new URL('../'+file,import.meta.url),source=fs.readFileSync(url,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),parts=[];
 for(const statement of ast.statements){if(ts.isImportDeclaration(statement))continue;if(ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(ast)==='test')break;if(!ts.isVariableStatement(statement)&&!ts.isFunctionDeclaration(statement)&&!ts.isClassDeclaration(statement)&&!ts.isExpressionStatement(statement))break;parts.push(statement.getText(ast));}
 return vm.runInNewContext(parts.join('\n').replaceAll('import.meta.url',JSON.stringify(url.href))+'\n({'+expose+'})',{fs,vm,path,ts,assert,parse5,createHash,webcrypto,deflateSync,memoryDatabase,mobileIntakeHarness,hubSchemaSnapshot,schemaCompanies,schemaPath,quotationWorkbook,
  Date,URL,URLSearchParams,Blob,File,FormData,Response,Request,Headers,TextEncoder,TextDecoder,Uint8Array,DataView,Buffer,CompressionStream,DecompressionStream,AbortController,AbortSignal,structuredClone,setTimeout,clearTimeout,crypto:webcrypto});}
const renderer=declarations('free-image-translation-client.test.mjs','fixture,image,region,source');
const api=declarations('free-image-text-api.test.mjs','fixture,png');
const quotation=declarations('free-image-quotation-linkage.test.mjs','fixture,labelFixture');
const option=declarations('free-image-option-linkage.test.mjs','fixture');
export const cropApiFixture=()=>api.fixture();
export const cropOptionFixture=()=>option.fixture();
export const cropQuotationFixture=(company,options={})=>quotation.fixture({company,linkedWire:true,withMain:true,...options});
export const cropLabelFixture=company=>quotation.labelFixture(company);
export const pngBytes=(width,height,pixels=90)=>api.png(width,height,pixels);
export function cropCore(){const h=cropApiFixture();const core=h.load('app/free-image-crop.ts'),translation=h.load('app/free-image-translation.ts');h.close();return{...core,...translation};}
/** A pixel-addressable canvas preserves the existing brush/text renderer and
 * adds only the native 9-argument unscaled crop operation plus valid PNG bytes. */
export function cropClientFixture(options={}){const h=renderer.fixture(options),create=h.document.createElement;
 h.document.createElement=tag=>{const output=create(tag),context=output.getContext('2d'),draw=context.drawImage.bind(context);
  context.drawImage=(image,...args)=>{if(args.length===2)return draw(image,...args);assert.equal(args.length,8);const[x,y,width,height,dx,dy,dw,dh]=args;assert.deepEqual([dx,dy,dw,dh],[0,0,width,height]);assert.equal(output.width,width);assert.equal(output.height,height);const pixels=new Uint8Array(width*height*4);for(let py=0;py<height;py++)for(let px=0;px<width;px++)pixels.set(image.pixels.subarray(((y+py)*image.width+x+px)*4,((y+py)*image.width+x+px+1)*4),(py*width+px)*4);output.pixels=pixels;h.operations.push(['crop',x,y,width,height]);};
  output.toBlob=(callback,type)=>{assert.equal(type,'image/png');callback(new Blob([pngBytes(output.width,output.height,output.pixels)],{type}));};return output;};
 return{...h,image:()=>renderer.image(h),region:renderer.region,source:renderer.source};
}
