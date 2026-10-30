import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {CAPABILITIES,LIMITS,allowedAppUrl,validateSender,validateRequest,assertCompany,dateRange,claimRequest,boundedResult} from '../extensions/operations-connector/protocol.mjs';
import {normalizeInventoryItem,normalizeTabular,normalizeStatement,normalizeAdMetric,parseCsv,readNumber} from '../extensions/operations-connector/normalizers.mjs';
import {collectOperationsPage,confirmStatementPage} from '../extensions/operations-connector/page.mjs';
import {createStatementApprovals,statementSeqs,approvalHash,validateApprovalSender,canAttemptStatement} from '../extensions/operations-connector/approval.mjs';
import {installOperationsWorker,normalizePayload} from '../extensions/operations-connector/worker.mjs';
import {readPackageZip} from '../extensions/supplier-hub/package.mjs';

const app='https://sourceflow.jjwwhhjj1116.workers.dev/operations';
const sender={url:app,frameId:0,tab:{id:12,windowId:3,url:app}};
const request=(kind='inventory',values={})=>({source:'YOOFAM_OPS_PAGE',requestId:'request-'+crypto.randomUUID(),kind,companyCode:'A01464742',values});

test('operations extension accepts only the exact app origin and HTTP literal loopback',()=>{
 for(const url of [app,'http://localhost:3025/operations','http://127.0.0.1:8768/operations'])assert.equal(allowedAppUrl(url),true);
 for(const url of ['https://sourceflow.jjwwhhjj1116.workers.dev.evil.test/','https://other.workers.dev/','http://192.168.0.2/','https://127.0.0.1/','http://user@localhost:3000/','file:///operations'])assert.equal(allowedAppUrl(url),false);
 assert.equal(validateSender(sender),'https://sourceflow.jjwwhhjj1116.workers.dev');
 for(const bad of [{...sender,frameId:1},{...sender,url:'https://evil.test/'},{...sender,tab:{...sender.tab,url:'https://evil.test/'}},{...sender,tab:{url:app}}])assert.throws(()=>validateSender(bad));
});

test('request validation rejects arbitrary kinds, missing financial company and oversized payloads',()=>{
 assert.equal(validateRequest(request()).kind,'inventory');
 assert.equal(validateRequest({...request('ping'),companyCode:''}).kind,'ping');
 for(const bad of [{...request(),source:'ROS-PAGE'},{...request(),requestId:'x'},{...request(),kind:'fetchUrl'},{...request(),companyCode:''},{...request(),values:[]},{...request(),values:{body:'x'.repeat(LIMITS.requestBytes)}}])assert.throws(()=>validateRequest(bad));
 assert.equal(CAPABILITIES.statementConfirm,true);
});

test('live-company contract fails closed and never substitutes app claims for observed seller identity',()=>{
 assert.equal(assertCompany('A01464742','A01464742'),'A01464742');
 for(const actual of ['',undefined,'A01526306','123456'])assert.throws(()=>assertCompany(actual,'A01464742'));
});

test('period validation preserves exact requested dates and rejects invalid, reversed and excessively broad periods',()=>{
 assert.deepEqual(dateRange({startDate:'2026-10-29',endDate:'2026-10-30'}).days,['2026-10-29','2026-10-30']);
 for(const values of [{startDate:'2026-10-30',endDate:'2026-10-29'},{date:'2026-02-31'},{startDate:'2020-01-01',endDate:'2026-10-30'}])assert.throws(()=>dateRange(values));
 assert.equal(dateRange({},'2026-10-30').start,'2026-10-30');
});

test('request replay is scoped to source tab and retained across worker restarts without storing raw results',()=>{
 const req=request(),history=claimRequest([],req,sender,1000);assert.equal(history.length,1);
 assert.throws(()=>claimRequest(history,req,sender,1001),/이미 처리/);
 assert.equal(claimRequest(history,req,{...sender,tab:{...sender.tab,id:13}},1001).length,2);
 assert.equal(history[0].companyCode,req.companyCode);assert.equal('rows'in history[0],false);
});

test('result boundary removes no uncertainty by coercion and rejects credential-like fields and runaway payloads',()=>{
 const req=request(),valid=boundedResult({status:'partial',rows:[{optionId:'000012345678901234',stock:null,price:0}],warnings:['일부 수집']},req);
 assert.equal(valid.rows[0].stock,null);assert.equal(valid.rows[0].price,0);assert.equal(valid.status,'partial');
 for(const value of [{token:'secret'},{authorization:'secret'},{headers:{a:1}},{cookie:'secret'},{stock:Infinity}])assert.throws(()=>boundedResult({status:'succeeded',rows:[value]},req));
 assert.throws(()=>boundedResult({status:'succeeded',rows:Array(LIMITS.rows+1).fill({})},req));
});

test('inventory normalizer preserves text option IDs and missing-vs-zero stock',()=>{
 assert.deepEqual(normalizeInventoryItem({vendoritemid:'000012345678901234',itemnm:'시험 상품',stockQuantity:null,sales_price:'12,500'}),{optionId:'000012345678901234',name:'시험 상품',stock:null,price:12500,delivery:'',productId:'',externalSkuId:'',barcode:'',quality:'observed'});
 assert.equal(normalizeInventoryItem({vendorItemId:'123',stockQuantity:0}).stock,0);
 assert.throws(()=>normalizeInventoryItem({itemnm:'ID 없음'}));assert.equal(readNumber('미확인'),null);assert.equal(readNumber('0'),0);
 assert.throws(()=>normalizeInventoryItem({vendoritemid:9007199254740993,stockQuantity:1}),/정밀도/);
});

test('inbound parser retains split-event timestamps, signed financial values and long external SKU strings',()=>{
 const headers=['구분','번호','SKU번호','SKU명','입고/반출시각','물류센터','수량','공급가액','세액','계산서번호'];
 const rows=normalizeTabular('inbound',headers,[['입고','PO1','000012345678901234','상품','2026.10.30 08:00:01','센터A','10','100,000','10,000','INV1'],['반출','PO1','000012345678901234','상품','2026.10.30 14:02:03','센터A','2','-20,000','-2,000','INV2']]);
 assert.equal(rows.length,2);assert.notEqual(rows[0].occurredAt,rows[1].occurredAt);assert.equal(rows[0].date,'2026-10-30');assert.equal(rows[1].type,'outbound');assert.equal(rows[1].supply,-20000);assert.equal(rows[0].externalSkuId,'000012345678901234');
 assert.throws(()=>normalizeTabular('inbound',['번호','수량'],[['PO1','1']]));assert.throws(()=>normalizeTabular('inbound',headers,[['입고','PO1','1','상품','잘못된 날짜','','1','100','10','']]));
});

test('rocket CSV import uses actual received quantity and supply unit amount, preserving cancellation',()=>{
 const header=['발주번호','발주현황','SKU ID','SKU 이름','입고예정일','발주일','입고수량','공급가'];
 const rows=normalizeTabular('rocketSales',header,[['PO1','취소','123','상품','2026-10-30','2026-10-28','0','8000'],['PO2','입고','456','상품2','2026-10-30','2026-10-28','3','9000']]);
 assert.equal(rows[0].status,'cancelled');assert.equal(rows[1].qty,3);assert.equal(rows[1].supply,9000);assert.equal(rows[1].type,'rocket');
 assert.deepEqual(parseCsv('"발주번호","상품명"\r\n"PO1","쉼표, 상품"\r\n'),[['발주번호','상품명'],['PO1','쉼표, 상품']]);assert.throws(()=>parseCsv('"닫히지 않음'));
});

test('statement normalization is a read-only requested state, never an approval receipt',()=>{
 const row=normalizeStatement({purchaseOrderSeq:'001234',createdAt:'2026-10-30',receivedAmount:'1000',skuCount:2});assert.equal(row.purchaseOrderSeq,'001234');assert.equal(row.status,'requested');assert.equal(row.externalStatus,'RI');assert.equal(row.amount,1000);assert.throws(()=>normalizeStatement({purchaseOrderSeq:'invalid'}));
});

test('advertising parser rejects unknown metric shape instead of inventing zero performance',()=>{
 assert.equal(normalizeAdMetric({cost:100,revenue:1000,clicks:5,impressions:100,orders:1,units:2},'123','2026-10-30').cost,100);
 assert.throws(()=>normalizeAdMetric({cost:100},'123','2026-10-30'),/필드/);
});

test('inventory response creates complete snapshot only after a complete collection',()=>{
 const result=normalizePayload({status:'partial',items:[{vendoritemid:'123',stockQuantity:0}],snapshot:{date:'2026-10-30T09:00:00Z',businessDate:'2026-10-29',complete:true}},request());
 assert.equal(result.datasets.inventorySnapshots[0].complete,false);assert.equal(result.datasets.inventoryLines[0].stock,0);assert.equal(result.datasets.inventorySnapshots[0].id,result.rows[0].snapshotId);
});

async function fakePage(fn,handler,origin='https://advertising.coupang.com'){
 const before={fetch:globalThis.fetch,location:globalThis.location};globalThis.location={origin};const calls=[];globalThis.fetch=async(input,init={})=>{const url=new URL(String(input));calls.push({url,init});const value=await handler(url,init,calls);return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});};
 try{return await fn(calls);}finally{globalThis.fetch=before.fetch;if(before.location===undefined)delete globalThis.location;else globalThis.location=before.location;}
}

test('actual isolated financial adapter rechecks server company before and after reading and makes no credential extraction',async()=>{
 await fakePage(async calls=>{
  const result=await collectOperationsPage({kind:'inventory',companyCode:'A01464742',values:{},startDate:'2026-10-30',endDate:'2026-10-30'});
  assert.equal(result.status,'succeeded');assert.equal(result.companyCode,'A01464742');assert.equal(calls.filter(c=>c.url.pathname==='/marketing/cmg-api/advertiser').length,2);assert.ok(calls.every(c=>c.init.method==='GET'));assert.ok(calls.every(c=>!c.init.headers?.cookie&&!c.init.headers?.authorization));
 },url=>url.pathname.endsWith('/advertiser')?{advertiser:{vendorId:'A01464742'}}:{products:[{vendoritemid:'123',stockQuantity:0}],total:1});
});

test('actual adapter refuses changed company after fetching and never releases those results',async()=>{
 let checks=0;await fakePage(async()=>{
  await assert.rejects(()=>collectOperationsPage({kind:'inventory',companyCode:'A01464742',values:{},startDate:'2026-10-30',endDate:'2026-10-30'}),/회사가 다릅니다/);
 },url=>url.pathname.endsWith('/advertiser')?{advertiser:{vendorId:++checks===1?'A01464742':'A01526306'}}:{products:[{vendoritemid:'123',stockQuantity:1}],total:1});
});

test('actual adapter halts before inventory request when no authenticated company evidence exists',async()=>{
 await fakePage(async calls=>{await assert.rejects(()=>collectOperationsPage({kind:'inventory',companyCode:'A01464742',values:{}}),/회사코드/);assert.equal(calls.length,1);},()=>({advertiser:{}}));
});

test('advertising adapter refuses unsafe numeric campaign IDs before posting any metric query',async()=>{
 await fakePage(async calls=>{await assert.rejects(()=>collectOperationsPage({kind:'adMetrics',companyCode:'A01464742',values:{campaignIds:['9007199254740993']},startDate:'2026-10-30',endDate:'2026-10-30'}),/정밀도/);assert.equal(calls.some(call=>call.init.method==='POST'),false);},()=>({advertiser:{vendorId:'A01464742'}}));
});

test('worker rejects foreign frame and refuses approval when no independent extension window is available',async()=>{
 let listener,scripts=0;const state={};const api={runtime:{onMessage:{addListener(value){listener=value;}}},storage:{local:{async get(key){return {[key]:state[key]};},async set(value){Object.assign(state,value);}}},tabs:{async query(){return [];}},scripting:{async executeScript(){scripts++;return [];}}};installOperationsWorker(api);
 const call=(req,who=sender)=>new Promise(resolve=>listener({type:'YOOFAM_OPS_COLLECT',request:req},who,resolve));
 const ping=await call(request('ping'));assert.equal(ping.capabilities.statementConfirm,true);
 const approval=await call(request('statementConfirm',{purchaseOrderSeqs:['123'],explicitConfirmation:true}));assert.equal(approval.ok,false);assert.equal(scripts,0);assert.match(approval.error,/승인 창/);
 const foreign=await call(request(),{...sender,frameId:1});assert.equal(foreign.ok,false);assert.equal(scripts,0);
});

test('approval sequences require exact text identifiers, bounded count and a hash tied to company/request/sequences',async()=>{
 assert.deepEqual(statementSeqs({purchaseOrderSeqs:['000123']}),['000123']);for(const values of [{},{purchaseOrderSeqs:[123]},{purchaseOrderSeqs:['1','1']},{purchaseOrderSeqs:Array.from({length:11},(_,i)=>String(i))}])assert.throws(()=>statementSeqs(values));
 const req=request('statementConfirm');assert.equal(await approvalHash(req,['1','2']),await approvalHash(req,['2','1']));assert.notEqual(await approvalHash(req,['1']),await approvalHash({...req,companyCode:'A01526306'},['1']));
 assert.equal(canAttemptStatement({'A01464742:1':{status:'unknown'}},'A01464742','1'),false);assert.equal(canAttemptStatement({'A01464742:1':{status:'succeeded'}},'A01526306','1'),true);
});

function approvalFixture(outcome='succeeded'){
 const state={},writes=[],windows=[];let removed;
 const api={runtime:{id:'test-extension',getURL:path=>'chrome-extension://test-extension/'+path},storage:{local:{async get(key){return {[key]:state[key]};},async set(value){Object.assign(state,value);}}},windows:{onRemoved:{addListener(fn){removed=fn;}},async create(options){windows.push(options);return {id:10,tabs:[{id:20}]};}},scripting:{async executeScript(options){if(options.func===collectOperationsPage)return [{result:{companyCode:'A01464742',items:options.args[0].values.purchaseOrderSeqs.map(seq=>({purchaseOrderSeq:seq,firstSkuName:'상품',receivedAmount:1000}))}}];writes.push(options.args[0].purchaseOrderSeq);return [{result:{purchaseOrderSeq:options.args[0].purchaseOrderSeq,status:outcome,companyCode:'A01464742'}}];}}};
 const manager=createStatementApprovals(api,async()=>({id:30}));
 const begin=async(seqs=['00123'])=>{const req=request('statementConfirm',{purchaseOrderSeqs:seqs}),promise=manager.request(req,sender,{start:'2026-10-01',end:'2026-10-30'});for(let attempts=0;!windows.length&&attempts<100;attempts++)await new Promise(resolve=>setTimeout(resolve,1));const url=windows.at(-1)?.url;if(!url)return {promise};const [jobId,nonce]=new URL(url).hash.slice(1).split(':'),who={id:api.runtime.id,tab:{id:20},frameId:0,url},base={jobId,nonce},initial=await manager.message({type:'YOOFAM_OPS_APPROVAL_STATE',...base},who);return {promise,who,base:{...base,requestId:initial.requestId,companyCode:initial.companyCode,seqHash:initial.seqHash}};};
 return {api,state,writes,windows,manager,begin,close:()=>removed(10)};
}

test('approval acknowledgement is limited to exact extension tab, nonce, company, sequence hash and expiration',async()=>{
 const fixture=approvalFixture(),pending=await fixture.begin();
 for(const [who,change]of [[{...pending.who,id:'foreign'},{}],[{...pending.who,tab:{id:21}},{}],[{...pending.who,frameId:1},{}],[pending.who,{nonce:'wrong'}],[pending.who,{companyCode:'A01526306'}],[pending.who,{seqHash:'wrong'}]])await assert.rejects(()=>fixture.manager.message({type:'YOOFAM_OPS_APPROVAL_ACK',...pending.base,...change,userGesture:true},who));
 assert.equal(fixture.writes.length,0);await fixture.manager.message({type:'YOOFAM_OPS_APPROVAL_CANCEL',...pending.base},pending.who);assert.equal((await pending.promise).status,'failed');
 const job={id:'j',nonce:'n',popupTabId:20,expiresAt:1,phase:'awaiting',request:request('statementConfirm'),seqHash:'s'};assert.throws(()=>validateApprovalSender(fixture.api,{...pending.who,url:fixture.api.runtime.getURL('confirmation.html')+'#j:n'},job,{jobId:'j',nonce:'n'},2));
});

test('closing independent approval window cancels before any external write',async()=>{
 const fixture=approvalFixture(),pending=await fixture.begin();fixture.close();const output=await pending.promise;assert.equal(output.status,'failed');assert.match(output.error,/닫혔/);assert.equal(fixture.writes.length,0);
});

test('one extension acknowledgement executes exact selected sequences once and checkpoints successful receipts',async()=>{
 const fixture=approvalFixture(),pending=await fixture.begin(['00123','00456']);await fixture.manager.message({type:'YOOFAM_OPS_APPROVAL_ACK',...pending.base,userGesture:true},pending.who);
 assert.deepEqual(fixture.writes,['00123','00456']);assert.equal((await pending.promise).status,'succeeded');assert.equal(fixture.state.ops_statement_receipts['A01464742:00123'].status,'succeeded');
 await assert.rejects(()=>fixture.manager.request(request('statementConfirm',{purchaseOrderSeqs:['00123']}),sender,{start:'2026-10-01',end:'2026-10-30'}),/재승인/);assert.equal(fixture.writes.length,2);
});

test('ambiguous approval halts remaining sequences and blocks automatic retry after worker restart',async()=>{
 const fixture=approvalFixture('unknown'),pending=await fixture.begin(['00123','00456']);await fixture.manager.message({type:'YOOFAM_OPS_APPROVAL_ACK',...pending.base,userGesture:true},pending.who);
 assert.deepEqual(fixture.writes,['00123']);assert.equal((await pending.promise).status,'unknown');assert.equal(fixture.state.ops_statement_receipts['A01464742:00123'].status,'unknown');const restarted=createStatementApprovals(fixture.api,async()=>({id:30}));await assert.rejects(()=>restarted.request(request('statementConfirm',{purchaseOrderSeqs:['00123']}),sender,{start:'2026-10-01',end:'2026-10-30'}),/재승인/);
});

test('approval page adapter revalidates company and exact RI state before its only POST; unknown responses remain unknown',async()=>{
 for(const success of [true,false])await fakePage(async calls=>{const result=await confirmStatementPage({companyCode:'A01464742',purchaseOrderSeq:'00123',startDate:'2026-10-01',endDate:'2026-10-30'});assert.equal(result.status,success?'succeeded':'unknown');assert.equal(calls.filter(call=>call.init.method==='POST').length,1);assert.ok(calls.filter(call=>call.init.method==='POST').every(call=>call.url.pathname==='/scm/purchase/order/confirmInvoice'));assert.equal(calls.filter(call=>call.url.pathname==='/vendor/').length,3);},url=>url.pathname==='/vendor/'?{vendorId:'A01464742'}:url.pathname.endsWith('/list')?{body:[{purchaseOrderSeq:'00123',purchaseOrderStatus:'RI'}]}:success?{success:true}:{unexpected:'shape'},'https://supplier.coupang.com');
 await fakePage(async calls=>{const output=await confirmStatementPage({companyCode:'A01464742',purchaseOrderSeq:'00123',startDate:'2026-10-01',endDate:'2026-10-30'});assert.equal(output.status,'failed');assert.equal(calls.some(call=>call.init.method==='POST'),false);},()=>({vendorId:'A01526306'}),'https://supplier.coupang.com');
 const source=fs.readFileSync(new URL('../extensions/operations-connector/confirmation.js',import.meta.url),'utf8');assert.match(source,/event\.isTrusted/);
});

test('manifest and source package do not weaken authentication or install existing app automation',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../extensions/operations-connector/manifest.json',import.meta.url),'utf8'));
 assert.equal(manifest.manifest_version,3);assert.equal(manifest.permissions.includes('cookies'),false);assert.equal(manifest.permissions.includes('webRequest'),false);assert.ok(manifest.host_permissions.includes('https://advertising.coupang.com/*'));assert.equal(manifest.content_scripts[0].all_frames,false);
 const file=new URL('../public/downloads/yoofam-operations-connector.zip',import.meta.url);if(fs.existsSync(file)){const files=readPackageZip(new Uint8Array(fs.readFileSync(file)));for(const name of ['worker.mjs','protocol.mjs','normalizers.mjs','page.mjs','content.js','manifest.json'])assert.equal(new TextDecoder().decode(files.get(name)),fs.readFileSync(new URL('../extensions/operations-connector/'+name,import.meta.url),'utf8').replace(/\r\n/g,'\n'));}
});

test('content bridge reports disconnected approval worker as unknown, never safely failed or approved',()=>{
 let receive;const posted=[],location=new URL(app),window={addEventListener(type,fn){receive=fn;},postMessage(message){posted.push(message);}};window.top=window;
 vm.runInNewContext(fs.readFileSync(new URL('../extensions/operations-connector/content.js',import.meta.url),'utf8'),{window,location,setTimeout,clearTimeout,chrome:{runtime:{lastError:{message:'worker disconnected'},sendMessage(message,callback){callback();}}}});
 receive({source:window,origin:location.origin,data:request('statementConfirm',{purchaseOrderSeqs:['00123']})});assert.equal(posted[0].result.status,'unknown');assert.equal(posted[0].result.ok,false);
});
