import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import ts from 'typescript';
import {verifySupplierHubCompany} from '../extensions/supplier-hub/company.mjs';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/supplier-hub-company.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
test('only the approved member exact company pair is bound to exports',()=>{
 for(const company of companies){
  const member={status:'approved',companyCode:company.code,companyName:company.name};
  assert.equal(exports.approvedSupplierHubCompany(member).code,company.code);
  for(const patch of [{status:'pending'},{status:'suspended'},{companyCode:'A99999999'},{companyName:'다른 회사'}])assert.equal(exports.approvedSupplierHubCompany({...member,...patch}),null);
 }
 assert.equal(exports.approvedSupplierHubCompany(),null);
});
function page(expected,{visible='',menuCode=expected.code,menuName=expected.name,missing=false,path='/qvt/registration'}={}){
 let clicks=0;const document={body:{innerText:visible},documentElement:{dataset:{yoofamAttachmentAttempt:JSON.stringify({company:expected})}},querySelectorAll:()=>missing?[]:[{innerText:menuName,disabled:false,getClientRects:()=>[{}],click(){clicks++;document.body.innerText='Company Code: '+menuCode;}}]};
 const context={document,location:{origin:'https://supplier.coupang.com',pathname:path},setTimeout:fn=>fn(),company:expected};
 return {get clicks(){return clicks;},run:()=>vm.runInNewContext(`(${verifySupplierHubCompany.toString()})(company)`,context)};
}
test('both approved companies are checked through the visible menu without any upload',async()=>{
 for(const company of companies){const h=page(company);assert.equal((await h.run()).code,company.code);assert.equal(h.clicks,1);}
 const already=page(companies[0],{visible:'Company Code: A01464742'});await already.run();assert.equal(already.clicks,0);
});

test('company verification is supported on registration status, but not unrelated pages',async()=>{
 for(const company of companies)assert.equal((await page(company,{path:'/qvt/wims'}).run()).code,company.code);
 await assert.rejects(page(companies[0],{path:'/settings'}).run());
});
test('wrong company, absent menu, ambiguous code and login company changes reject',async()=>{
 for(const options of [{visible:'Company Code: A01526306'},{menuCode:'A01526306'},{menuName:'유앤채'},{missing:true},{visible:'Company Code: A01464742\nCompany Code: A01526306'}])await assert.rejects(page(companies[0],options).run());
});
