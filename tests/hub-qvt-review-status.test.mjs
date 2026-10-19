import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {readSupplierHubRegistration} from '../extensions/supplier-hub/registration-result.mjs';
import {querySupplierHubCompanyRegistrations} from '../extensions/supplier-hub/company-registration-page.mjs';
import {collectSupplierHubRegistrationPages} from '../extensions/supplier-hub/registration-pages.mjs';
import {company,query,headers,quotationId,nativeMarkup,qvtHarness} from './helpers/qvt-native-pagination.mjs';
const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/hub-qvt-review-status-20261019.json',import.meta.url),'utf8'));
const labels={pending:'상품 검수중',rejected:'상품 검수 반려',completed:'상품 검수 완료',completedWithHistory:'상품 검수 완료'};
const page=(status,index=1,end=1,stage='가격/정책 해당 검수가 완료되었습니다.')=>({table:`<table><thead><tr>${headers.map(value=>`<th>${value}</th>`).join('')}</tr></thead><tbody><tr><td>합성 상품 ${index}</td><td>2026/10/19 10:00:00</td><td>합성 분류 (991743)</td><td>-</td><td>-</td><td>${quotationId}</td><td>synthetic-sku-${index}</td>${status}<td>${stage}</td></tr></tbody></table>`,pager:nativeMarkup(index,end)});
const modules=new Map();
function load(file){
 if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Error,Set,Map,TextEncoder,window:{location:{origin:'https://sourceflow.jjwwhhjj1116.workers.dev'}},require(name){assert.ok(name.startsWith('@/app/'));return load(name.slice(2)+'.ts');}});return exports;
}
const handoff=load('app/supplier-hub-handoff.ts'),receipt=load('app/supplier-hub-receipt.ts');
const result=registration=>({state:'validation-complete',filename:'YOOFAM-'+ 'a'.repeat(64)+'.xlsx',company,includedOptions:registration.rows.length,quotationId,observedAt:Date.now(),registered:false,registration:{...registration,includedOptions:registration.rows.length,observedAt:Date.now()}});

for(const account of [company,{code:'A01464742',name:'와이홉'}])for(const[key,html]of Object.entries(fixtures))test(`${account.code}: ${key} matches its canonical status filter without invoking history controls`,async()=>{
 const h=qvtHarness({mode:'company',company:account,capturedPages:[page(html)],total:1}),filter={...query,status:labels[key]};
 const value=await h.settle(h.run(querySupplierHubCompanyRegistrations,filter,account));
 assert.equal(value.rows.length,1);assert.equal(value.rows[0].status,labels[key]);assert.equal(value.query.status,labels[key]);assert.equal(value.mutated,false);assert.deepEqual(h.actions,[{kind:'search'}]);assert.equal(h.timers.size,0);
 const checked=load('app/company-registration-status.ts').validateCompanyRegistrationStatus({...value,ownerId:'owner'},filter,{ownerId:'owner',company:account});assert.equal(checked.rows[0].status,labels[key]);
});

test('a completed row with a rejection-history button stays complete through page aggregation, validation and receipt display',async()=>{
 const h=qvtHarness({capturedPages:[page(fixtures.completedWithHistory)],total:1});
 const registration=await h.settle(collectSupplierHubRegistrationPages(quotationId,1,{check:async()=>{},read:async()=>h.run(readSupplierHubRegistration,quotationId,{company}),advance:()=>{throw Error('No next page expected');}}));
 const observed=result(registration);handoff.validateRegistrationResult(observed.registration,quotationId);
 const evidence=handoff.supplierHubRegistrationEvidence(observed);assert.equal(evidence.rejected,false);assert.equal(evidence.allSkus,true);assert.equal(observed.registered,false);assert.equal(observed.registration.registered,false);
 const summary=receipt.supplierHubReceiptSummary({schemaVersion:1,evidence:'chrome-observation',profileId:'synthetic',categoryId:'991743',fingerprint:'a'.repeat(64),productVersion:'synthetic',recordedAt:new Date().toISOString(),result:observed});assert.equal(summary.label,'SKU ID 확인');assert.equal(summary.issuedSkus,1);assert.equal(h.moves,0);
});

test('actual rejection status and actual stage rejection remain rejection evidence; no broad rejection-word removal is applied',()=>{
 for(const[html,stage]of [[fixtures.rejected,'가격/정책 쿠팡 기준 미달'],[fixtures.completedWithHistory,'가격/정책 상품이 반려되었습니다.']]){
  const h=qvtHarness({capturedPages:[page(html,1,1,stage)],total:1});const observed=result(h.run(readSupplierHubRegistration,quotationId));
  const value=handoff.supplierHubRegistrationEvidence(observed);assert.equal(value.rejected,true);assert.equal(value.allSkus,false);assert.equal(receipt.supplierHubReceiptSummary({result:observed}).label,'상품 반려');
 }
});

test('an unknown status, inconsistent class, extra label, reply link or malformed history control stops both readers',async()=>{
 const base=fixtures.completedWithHistory;
 const invalid=[base.replace('상품 검수 완료','알 수 없는 상태'),base.replace('text-success','text-danger'),base.replace('반려내역','완료'),base.replace('<button ','<a ').replace('</button>','</a>'),base.replace('btn-default','unknown'),base.replace('>반려내역<','><span>반려내역</span><'),base.replace('</td>','추가 상태</td>'),base.replace('</div></td>','<button>반려내역</button></div></td>'),base.replace('<button ','<button type="submit" '),'<td>상품 검수 완료 반려내역</td>'];
 for(const html of invalid){
  const h=qvtHarness({capturedPages:[page(html)],total:1});assert.throws(()=>h.run(readSupplierHubRegistration,quotationId),/검수 상태/);assert.equal(h.actions.length,0);
  const c=qvtHarness({mode:'company',capturedPages:[page(html)],total:1});await assert.rejects(c.settle(c.run(querySupplierHubCompanyRegistrations,query,company)),/검수 상태/);assert.equal(c.moves,0);assert.equal(c.timers.size,0);
 }
});

test('a canonical status cannot satisfy a different requested filter',async()=>{
 const h=qvtHarness({mode:'company',capturedPages:[page(fixtures.completedWithHistory)],total:1});await assert.rejects(h.settle(h.run(querySupplierHubCompanyRegistrations,{...query,status:'상품 검수 반려'},company)),/조회 범위/);assert.equal(h.moves,0);assert.equal(h.timers.size,0);
});

test('completed historical rows remain distinct and canonical across six fresh native pages',async()=>{
 const pages=Array.from({length:6},(_,i)=>page(fixtures.completedWithHistory,i+1,6));const h=qvtHarness({mode:'company',capturedPages:pages,total:6});const value=await h.settle(h.run(querySupplierHubCompanyRegistrations,{...query,status:'상품 검수 완료'},company));
 assert.equal(value.pagesRead,6);assert.ok(value.rows.every(row=>row.status==='상품 검수 완료'));assert.deepEqual(h.actions.filter(action=>action.kind==='page').map(action=>action.target),[2,3,4,5,6]);assert.equal(h.timers.size,0);
});
