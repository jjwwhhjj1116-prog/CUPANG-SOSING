// Explicit integration smoke run against the local development server only.
// Creates clearly named synthetic records. Never visits or collects a source URL.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';

if(!process.argv.includes('--allow-test-records'))throw Error('Pass --allow-test-records to create local synthetic records.');
const base='http://localhost:3000';
async function json(path,body,method=body?'POST':'GET') {
  const response=await fetch(base+path,{method,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
  const value=await response.json();assert.ok(response.ok,JSON.stringify({path,status:response.status,body:value}));return value;
}
async function upload(path,name,type,bytes) {
  const form=new FormData();form.set('file',new File([bytes],name,{type}));
  const response=await fetch(base+path,{method:'POST',body:form});const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;
}
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const headers=['상품명','옵션명','공급가','대표이미지','제조국'];
const sheet=`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><dimension ref="A1:E2"/><sheetData><row r="1">${headers.map((header,i)=>`<c r="${String.fromCharCode(65+i)}1" t="inlineStr"><is><t>${header}</t></is></c>`).join('')}</row><row r="2"><c r="A2" s="0"/></row></sheetData></worksheet>`;
const raw={
  '[Content_Types].xml':`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
  '_rels/.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  'xl/workbook.xml':`<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="검증양식" sheetId="1" r:id="sheet1"/><sheet name="안내" sheetId="2" r:id="sheet2"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="sheet2" Type="${rel}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
  'xl/worksheets/sheet1.xml':sheet,
  'xl/worksheets/sheet2.xml':`<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>LOCAL TEST - 공식 Supplier Hub 양식 아님</t></is></c></row></sheetData></worksheet>`,
};
const templateBytes=zipSync(Object.fromEntries(Object.entries(raw).map(([key,value])=>[key,strToU8(value)])));
const {template}=await upload('/api/category-profiles/template','LOCAL-TEST-quotation.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',templateBytes);
const name='[LOCAL TEST] XLSX 견적서 통합 검증';
const existingProfile=(await json('/api/category-profiles')).profiles.find(profile=>profile.name===name);
const profileInput={name,categoryId:'LOCAL-TEST-NOT-OFFICIAL',categoryPath:['LOCAL TEST','통합 검증 전용'],template:{...template,sheetName:'검증양식',headerRow:1,headers},mappings:[{column:0,field:'title',required:true},{column:1,field:'skuName',required:true},{column:2,field:'supplyPrice',required:true},{column:3,field:'mainImage',required:true},{column:4,field:'countryOfOrigin',required:true}]};
const {profile}=existingProfile?await json('/api/category-profiles',{id:existingProfile.id,expectedRevision:existingProfile.revision,profile:profileInput},'PUT'):await json('/api/category-profiles',profileInput);
const title='[LOCAL TEST] XLSX·옵션·첨부 통합 검증 — 실상품 아님';
let product=(await json('/api/products')).products.find(product=>product.title===title);
if(!product)({product}=await json('/api/products',{title,sourceUrl:'https://detail.1688.com/offer/123456789.html',sourcePriceCny:10}));
// A 1px PNG fixture tests binary attachment consistency, not real product imagery.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR5sAAAAASUVORK5CYII=','base64');
let imageKey=JSON.parse(product.image_keys)[0];
if(!imageKey){({key:imageKey}=await upload('/api/files','LOCAL-TEST-pixel.png','image/png',png));({product}=await json(`/api/products/${product.id}`,{image_keys:JSON.stringify([imageKey]),expectedVersion:product.updated_at},'PATCH'));}
const content=(await json(`/api/products/${product.id}/content`)).content;
await json(`/api/products/${product.id}/content`,{expectedRevision:content.revision,patch:{seo:{title,description:'로컬 검증용 데이터입니다. 실제 상품이 아닙니다.',keywords:['LOCAL TEST']},assets:{main:[imageKey]}}},'PATCH');
const state=await json(`/api/products/${product.id}/options`);
await json(`/api/products/${product.id}/options`,{expectedRevision:state.options.revision,expectedProductVersion:state.productVersion,rows:[{id:state.options.rows[0]?.id??crypto.randomUUID(),originalName:'LOCAL TEST 原文',translatedName:'로컬 검증 옵션',supplierSku:'LOCAL-TEST-SKU',unitCostCny:3.25,unitsPerPack:2,minimumOrderQuantity:1,widthCm:10,lengthCm:20,heightCm:3,weightKg:0.2,included:true,imageKey}]},'PATCH');
const preview=await json(`/api/products/${product.id}/quotation`,{action:'preview',profileId:profile.id,dataStartRow:2});
assert.equal(preview.report.rowCount,1);assert.equal(preview.rows[0][0],title);assert.equal(preview.rows[0][1],'로컬 검증 옵션');assert.equal(preview.rows[0][3],'image-001.png');
assert.ok(preview.report.missingRequired.some(field=>field.header==='제조국'));
const response=await fetch(`${base}/api/products/${product.id}/quotation`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'export',profileId:profile.id,dataStartRow:2,fingerprint:preview.fingerprint})});
assert.equal(response.status,200,await (response.status===200?Promise.resolve(''):response.text()));
const zip=new Uint8Array(await response.arrayBuffer());const files=unzipSync(zip);const workbook=unzipSync(files['quotation-filled.xlsx']);
assert.deepEqual(files['assets/image-001.png'],new Uint8Array(png));
assert.equal(strFromU8(workbook['xl/worksheets/sheet2.xml']),raw['xl/worksheets/sheet2.xml']);
assert.ok(strFromU8(workbook['xl/worksheets/sheet1.xml']).includes('로컬 검증 옵션'));
assert.ok(strFromU8(workbook['xl/worksheets/sheet1.xml']).includes('image-001.png'));
const current=(await json(`/api/products/${product.id}/content`)).content;
await json(`/api/products/${product.id}/content`,{expectedRevision:current.revision,patch:{seo:{description:'수정 후 이전 견적서 지문 무효화 확인. 실상품 아님.'}}},'PATCH');
const stale=await fetch(`${base}/api/products/${product.id}/quotation`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'export',profileId:profile.id,dataStartRow:2,fingerprint:preview.fingerprint})});assert.equal(stale.status,409);
await fs.mkdir('outputs',{recursive:true});await fs.writeFile('outputs/local-smoke-quotation.zip',zip);
const report={checkedAt:new Date().toISOString(),synthetic:true,actualProductCollected:false,paidCalls:0,supplierSubmissions:0,productId:product.id,profileId:profile.id,checks:['D1/R2 upload and save','XLSX actual mapping','option price and SKU row','attachment filename and bytes','unmodified other worksheet','missing required facts remain blank','stale export returns 409'],row:preview.rows[0]};
await fs.writeFile('outputs/local-smoke-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
