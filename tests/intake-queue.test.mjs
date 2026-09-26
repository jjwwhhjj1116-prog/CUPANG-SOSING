import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file) {
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,require:name=>load(name.slice(2)+'.ts')});return exports;
}
const {intakeRow,intakeQueueRequests,submitIntakeQueue}=load('app/intake-queue.ts');
const profile=(n)=>({id:`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`,revision:n,categoryId:String(n),categoryPath:['주방용품',String(n)]});
const row=(n)=>({...intakeRow(profile(n),String(n)),url:`https://detail.1688.com/offer/${n}.html?spm=test`,features:`특징${n}`,keywords:`키워드${n}`});
const response=(body,status=200)=>Response.json(body,{status});
const saved=body=>({jobs:[{id:'job',offer_id:body.urls[0].match(/offer\/(\d+)/)[1],source_url:body.urls[0],status:'awaiting_connector'}],preservedRequests:[]});

test('each row retains its category revision and attributes; validate entire queue before network',async()=>{
 const rows=[row(1),row(2)];const before=JSON.stringify(rows);const result=intakeQueueRequests(rows,'price');
 assert.equal(result[1].body.profileId,profile(2).id);assert.equal(result[1].body.expectedProfileRevision,2);assert.equal(result[1].body.features,'특징2');assert.equal(result[0].body.urls[0],'https://detail.1688.com/offer/1.html');assert.equal(JSON.stringify(rows),before);
 let calls=0;
 for(const invalid of [[row(1),{...row(2),url:'wrong'}],[row(1),{...row(2),url:row(1).url}],[],Array.from({length:51},(_,i)=>row(i+1)),[{...row(1),features:'x'.repeat(2001)}]]){
  await assert.rejects(submitIntakeQueue(invalid,'price',{signal:new AbortController().signal,fetcher:async()=>{calls++;},onRow(){},onJobs(){}}));
 }
 assert.equal(calls,0);
});

test('partial failures preserve input, continue other rows and only retry unsaved rows',async()=>{
 let rows=[row(1),row(2),row(3)];const calls=[],jobs=[];
 const options={signal:new AbortController().signal,onRow(id,state){rows=rows.map(r=>r.id===id?{...r,...state}:r);},onJobs:j=>jobs.push(...j),fetcher:async(_url,init)=>{const body=JSON.parse(init.body);calls.push(body);return body.features==='특징2'?response({error:'설정 버전 변경'},409):response(saved(body));}};
 await submitIntakeQueue(rows,'work',options);assert.equal(calls.length,3);assert.equal(jobs.length,2);assert.equal(rows[0].status,'saved');assert.equal(rows[1].status,'error');assert.equal(rows[1].features,'특징2');assert.equal(rows[1].url,row(2).url);
 options.fetcher=async(_url,init)=>{const body=JSON.parse(init.body);calls.push(body);return response(saved(body));};
 await submitIntakeQueue(rows,'work',options);assert.equal(calls.length,4);assert.equal(calls[3].profileId,profile(2).id);assert.ok(rows.every(r=>r.status==='saved'));
});

test('conflicting existing request and unconfirmed response never mark a row saved',async()=>{
 const states=[];let reads=0;
 await submitIntakeQueue([row(1),row(2)],'collect',{signal:new AbortController().signal,fetcher:async(_url,init)=>{const body=JSON.parse(init.body);return response(++reads===1?{...saved(body),preservedRequests:[{differences:['카테고리·견적서 설정']}]}:{jobs:[]});},onJobs(){},onRow:(_id,state)=>states.push(state)});
 assert.ok(states.every(s=>s.status==='error'));assert.match(states[0].message,/기존 요청 유지/);assert.match(states[1].message,/저장 결과/);
});

test('abort while first request is pending prevents later requests and late callbacks',async()=>{
 const controller=new AbortController();let resolve;let calls=0,updates=0;
 const pending=new Promise(r=>resolve=r);
 const run=submitIntakeQueue([row(1),row(2)],'price',{signal:controller.signal,fetcher:async()=>{calls++;return pending;},onRow(){updates++;},onJobs(){updates++;}});
 controller.abort();resolve(response(saved(intakeQueueRequests([row(1)],'price')[0].body)));await run;
 assert.equal(calls,1);assert.equal(updates,0);
});

test('preflight reports every invalid row and both duplicates without sending requests or changing input',async()=>{
 const rows=[row(1),{...row(2),url:row(1).url},{...row(3),url:'invalid',profile:{...profile(3),revision:0},keywords:'x'.repeat(2001)},row(4)];
 const before=JSON.stringify(rows),states=[];let calls=0;
 await assert.rejects(submitIntakeQueue(rows,'price',{signal:new AbortController().signal,fetcher:async()=>{calls++;},onJobs(){},onRow:(id,state)=>states.push({id,...state})}),/3개 행/);
 assert.equal(calls,0);assert.equal(states.length,3);assert.match(states.find(s=>s.id==='1').message,/1, 2행/);assert.match(states.find(s=>s.id==='2').message,/중복/);
 assert.match(states.find(s=>s.id==='3').message,/카테고리/);assert.match(states.find(s=>s.id==='3').message,/2,000/);assert.ok(!states.some(s=>s.id==='4'));assert.equal(JSON.stringify(rows),before);
 const corrected=rows.filter(r=>r.id!=='2').map(r=>r.id==='3'?row(3):r);
 await submitIntakeQueue(corrected,'price',{signal:new AbortController().signal,fetcher:async(_url,init)=>{calls++;return response(saved(JSON.parse(init.body)));},onJobs(){},onRow(){}});assert.equal(calls,3);
});

test('saved rows are excluded from duplicate checks and cancelled preflight emits no updates',async()=>{
 const rows=[{...row(1),status:'saved'},{...row(2),url:row(1).url}];assert.equal(intakeQueueRequests(rows,'price').length,1);
 const controller=new AbortController();controller.abort();let updates=0;
 await submitIntakeQueue([{...row(1),url:'invalid'}],'price',{signal:controller.signal,fetcher:async()=>{updates++;},onJobs(){updates++;},onRow(){updates++;}});assert.equal(updates,0);
});

test('selected queue submission ignores unselected invalid rows and never submits saved rows',async()=>{
 const rows=[row(1),{...row(2),url:'invalid'},{...row(3),status:'saved'}];
 const before=JSON.stringify(rows),calls=[],updates=[];
 await submitIntakeQueue(rows,'price',{selectedIds:new Set(['1','3']),signal:new AbortController().signal,fetcher:async(_url,init)=>{const body=JSON.parse(init.body);calls.push(body);return response(saved(body));},onJobs(){},onRow:(id,state)=>updates.push({id,...state})});
 assert.equal(calls.length,1);assert.equal(calls[0].urls[0],'https://detail.1688.com/offer/1.html');assert.equal(updates.length,1);assert.equal(updates[0].id,'1');assert.equal(JSON.stringify(rows),before);
 await assert.rejects(submitIntakeQueue(rows,'price',{selectedIds:new Set(),signal:new AbortController().signal,fetcher:async()=>{throw Error('must not send');},onJobs(){},onRow(){}}),/1~50/);
});

test('queue search matches category and URL without changing saved drafts or selection',()=>{
 const {visibleIntakeRows}=load('app/intake-queue.ts');const rows=[row(1),row(2)];const before=JSON.stringify(rows);
 assert.deepEqual(Array.from(visibleIntakeRows(rows,'주방용품 특징2'),r=>r.id),['2']);
 assert.deepEqual(Array.from(visibleIntakeRows(rows,'offer/1.html'),r=>r.id),['1']);
 assert.equal(visibleIntakeRows(rows,'no-such-product').length,0);assert.equal(visibleIntakeRows(rows,' ').length,2);assert.equal(JSON.stringify(rows),before);
});

test('invalid SEO keywords remain in the queue and block submission before any request',async()=>{
 const draft={...row(1),keywords:'x'.repeat(101)};let calls=0;const errors=[];
 await assert.rejects(submitIntakeQueue([draft],'price',{signal:new AbortController().signal,fetcher:async()=>{calls++;},onRow:(_id,state)=>errors.push(state),onJobs(){}}));
 assert.equal(calls,0);assert.equal(draft.keywords.length,101);assert.match(errors[0].message,/키워드/);
});

test('queue freezes displayed settings across rows and stops further rows when settings change',async()=>{
 const settings={brand:'처음',exchangeRate:350};const requests=[],states=[];
 const options={signal:new AbortController().signal,expectedSettings:settings,onJobs(){},onRow:(id,state)=>states.push({id,...state}),fetcher:async(_url,init)=>{const body=JSON.parse(init.body);requests.push(body);settings.brand='도중 변경';return response(saved(body));}};
 await submitIntakeQueue([row(1),row(2)],'price',options);assert.equal(requests.length,2);assert.equal(requests[0].expectedSettings.brand,'처음');assert.equal(requests[1].expectedSettings.brand,'처음');
 requests.length=0;states.length=0;let collected=0;
 await submitIntakeQueue([row(1),row(2)],'price',{...options,collect:async()=>{collected++;},fetcher:async(_url,init)=>{requests.push(JSON.parse(init.body));return response({code:'REGISTRATION_SETTINGS_CHANGED',error:'기본설정 변경'},409);}});
 assert.equal(requests.length,1);assert.equal(collected,0);assert.equal(states.length,1);assert.equal(states[0].status,'error');assert.equal(states[0].id,'1');
});

test('saved intake navigation requires one linked product and canonical URL, preserving unfinished rows',()=>{
 const {intakeProductId}=load('app/intake-queue.ts');const item={...row(1),status:'saved'};
 const job={source_url:'https://detail.1688.com/offer/1.html',status:'awaiting_connector',product_id:'product-one'};
 assert.equal(intakeProductId(item,[job]),'product-one');
 assert.equal(intakeProductId(item,[job,{...job}]),'product-one');
 for(const status of ['draft','error'])assert.equal(intakeProductId({...item,status},[job]),null);
 assert.equal(intakeProductId(item,[{...job,status:'cancelled'}]),null);
 assert.equal(intakeProductId(item,[{...job,product_id:null}]),null);
 assert.equal(intakeProductId(item,[job,{...job,product_id:'another'}]),null);
 assert.equal(intakeProductId({...item,url:'invalid'},[job]),null);
 assert.equal(intakeProductId({...item,url:row(2).url},[job]),null);
});
