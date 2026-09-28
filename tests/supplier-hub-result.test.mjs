import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readSupplierHubValidation} from '../extensions/supplier-hub/result.mjs';
const filename='YOOFAM-'+ 'a'.repeat(64)+'.xlsx';
function run(rows,options={}){
 let notify;
 const table={isConnected:true,contains:target=>target===table,getClientRects:()=>[{}],querySelectorAll(selector){return selector==='thead th'?['견적서 명 ?','견적서 등록일 ?','검증 상태 ?','검증 결과 ?','견적서 ID ?'].map(innerText=>({innerText})):rows.map(values=>({querySelectorAll:()=>values.map(innerText=>({innerText}))}));}};
 const refresh={innerText:'refresh 새로고침',disabled:!!options.refreshDisabled,getAttribute:()=>null,getClientRects:()=>[{}],click(){options.onRefresh?.();if(options.refreshedRows)rows=options.refreshedRows;notify([{target:table}]);}};
 const document={body:{},documentElement:{dataset:{yoofamAttachmentAttempt:JSON.stringify({state:options.state||'validation-requested',files:[filename]})}},querySelectorAll:selector=>selector==='button'?(options.noRefresh?[]:[refresh]):options.ambiguous?[table,table]:[table]};
 if(options.reloaded)document.documentElement.dataset={};
 return vm.runInNewContext(`(${readSupplierHubValidation.toString()})(expectedFilename)`,{setTimeout,clearTimeout,MutationObserver:class {constructor(callback){notify=callback;}observe(){}disconnect(){}},expectedFilename:options.expectedFilename,document,location:{origin:options.wrong?'https://evil.example':'https://supplier.coupang.com',pathname:'/qvt/registration'}});
}
test('matches only the exact submitted quotation and preserves remote ID without claiming product registration',async()=>{
 const result=await run([['other.xlsx','date','완료','done','other-id'],[filename,'2026-09-27','완료','검증 완료','12345']]);
 assert.equal(result.state,'validation-complete');assert.equal(result.quotationId,'12345');assert.equal(result.registered,false);
});
test('rejection, pending and absent results remain distinguishable',async()=>{
 assert.equal((await run([[filename,'date','반려','오류 내역','123']])).state,'validation-rejected');
 assert.equal((await run([[filename,'date','검증중','','123']])).state,'validation-pending');
 assert.equal((await run([['데이터가 없습니다']])).state,'not-found');
 assert.equal((await run([[filename+'.bak','date','완료','','123']])).state,'not-found');
});
test('duplicate results, wrong hosts and unrequested attempts are rejected',async()=>{
 const row=[filename,'date','완료','','123'];
 await assert.rejects(()=>run([row,row]));
 for(const options of [{wrong:true},{state:'dispatched'},{ambiguous:true}])await assert.rejects(()=>run([row],options));
});
test('saved exact filename recovers read-only results after the Hub page reloads',async()=>{
 const row=[filename,'date','완료','','123'];
 const result=await run([row],{reloaded:true,expectedFilename:filename});
 assert.equal(result.quotationId,'123');assert.equal(result.registered,false);
 assert.equal((await run([row],{reloaded:true,expectedFilename:'YOOFAM-'+'b'.repeat(64)+'.xlsx'})).state,'not-found');
 for(const expectedFilename of ['other.xlsx','../'+filename,{},null])await assert.rejects(()=>run([row],{reloaded:true,expectedFilename}));
 await assert.rejects(()=>run([row],{reloaded:true}));
});


test('an already open result table is refreshed before its new status is read',async()=>{
 let clicks=0;
 const result=await run([[filename,'date','검증중','','123']],{onRefresh:()=>clicks++,refreshedRows:[[filename,'date','완료','완료','123']]});
 assert.equal(clicks,1);assert.equal(result.state,'validation-complete');assert.equal(result.registered,false);
 for(const options of [{noRefresh:true},{refreshDisabled:true}])await assert.rejects(()=>run([[filename,'date','완료','','123']],options),/새로고침/);
});
