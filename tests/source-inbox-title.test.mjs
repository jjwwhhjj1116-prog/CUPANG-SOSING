import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {sourceReviewHookFixture,sourceReviewModule} from './helpers/source-review-intake.mjs';
const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}],turn=()=>new Promise(resolve=>setImmediate(resolve));
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const titleModel=sourceReviewModule('app/source-inbox-title.ts');
const QWEN='@cf/qwen/qwen3-30b-a3b-fp8';
const qwen=translatedText=>({object:'chat.completion',model:QWEN,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({translatedText})}}]});
const source={format:'yoofam-page-source-v1',sourceUrl:'https://detail.1688.com/offer/764000000009.html',offerId:'764000000009',collectedAt:'2026-10-20T00:00:00.000Z',title:'合成测试商品',description:'原文保留',options:[{key:'black',name:'黑色',supplierSku:'supplier-black',unitPriceCny:5,currency:'CNY',minimumOrder:1,stock:3,imageUrl:null}],images:[{url:'https://cbu01.alicdn.com/title-fixture.png',role:'main'}],attributes:[]};
async function fixture(company=companies[1],translator=()=>Response.json([[['합성 테스트 상품',source.title]],null,'zh-CN']),snapshot=source){
 let requests=0;const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,translationFetcher:(...args)=>{requests++;return translator(...args);}});h.bindings.SOURCEFLOW_TEXT_PROVIDER='google-free';const api=h.load('app/api/source-inbox/route.ts'),title=h.load('app/api/source-inbox/title/route.ts');
 h.sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('owner',company.code==='A01526306'?'jwhj1116@kakao.com':'unari8484@gmail.com','synthetic',company.code==='A01526306'?'admin':'member','approved',company.code,company.name,'2026-10-23','2026-10-23');
 await h.load('db/queries.ts').saveSettings('owner',JSON.stringify({...h.settings,brand:'회원 브랜드'}));
 h.sqlite.prepare('INSERT INTO products(id,owner_id,source_url,title,source_price_cny,exchange_rate,supply_margin,coupang_margin,supply_price,sale_price,msrp,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('protected-original','owner',source.sourceUrl,'기존 등록 상품',5,300,50,40,3000,5000,6500,'2026-10-22','2026-10-22');
 const fingerprint=await h.load('app/source-inbox.ts').pageSourceFingerprint(snapshot),body={expectedOwnerId:'owner',expectedCompany:company,id:'76400000-0000-4000-8000-000000000009',fingerprint,snapshot};
 await json(await api.POST(new Request('https://app.test/api/source-inbox',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})));
 const item=(await json(await api.GET())).items[0],request=item=>new Request('https://app.test/api/source-inbox/title',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:item.ownerId,expectedCompany:item.company,id:item.id,expectedFingerprint:item.fingerprint,expectedRevision:item.revision,expectedSourceUrl:item.snapshot.sourceUrl})});
 const raw=()=>JSON.stringify({sources:h.sqlite.prepare('SELECT * FROM source_inbox').all(),captures:h.sqlite.prepare('SELECT * FROM source_inbox_captures').all(),products:h.sqlite.prepare('SELECT * FROM products').all(),jobs:h.sqlite.prepare('SELECT * FROM collection_jobs').all()});
 return {h,api,title,item,request,raw,get requests(){return requests;},close:()=>h.close()};
}

for(const company of companies)test(company.code+': raw row is immediate, literal Korean title and own brand are a separate replay-safe sidecar',async()=>{
 const x=await fixture(company);try{
  const before=x.raw();assert.equal(x.requests,0);assert.equal(x.item.displayTitle,source.title);assert.equal(x.item.titlePreparation.state,'pending');
  const prepared=await json(await x.title.POST(x.request(x.item)));assert.equal(prepared.displayTitle,'회원 브랜드 합성 테스트 상품');assert.equal(prepared.titlePreparation.state,'completed');assert.equal(x.requests,1);assert.equal(x.raw(),before);
  const repeated=await json(await x.title.POST(x.request(x.item)));assert.equal(repeated.displayTitle,prepared.displayTitle);assert.equal(x.requests,1);
  let item=(await json(await x.api.GET())).items[0];assert.equal(titleModel.sourceInboxDisplayTitle(item),prepared.displayTitle);assert.equal(item.snapshot.title,source.title);assert.equal(item.fingerprint,x.item.fingerprint);assert.equal(item.revision,x.item.revision);
  await x.h.load('db/queries.ts').saveSettings('owner',JSON.stringify({...x.h.settings,brand:'다른 회원 브랜드'}));item=(await json(await x.api.GET())).items[0];assert.equal(item.displayTitle,'다른 회원 브랜드 합성 테스트 상품');assert.equal(x.requests,1);
  const reviewed={title:'직접 확정한 상품명',options:source.options.map(({key,name,supplierSku,unitPriceCny,currency,minimumOrder})=>({key,name,supplierSku,unitPriceCny,currency,minimumOrder}))};
  const saved=(await json(await x.api.PUT(new Request('https://app.test/api/source-inbox',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:'owner',id:item.id,expectedRevision:item.revision,review:reviewed})})))).item;
  const manual=(await json(await x.api.GET())).items[0];assert.equal(manual.displayTitle,'직접 확정한 상품명');await json(await x.title.POST(x.request(saved)));assert.equal(x.requests,1);assert.equal(manual.snapshot.title,source.title);assert.equal(manual.fingerprint,x.item.fingerprint);
 }finally{x.close();}
});

test('an already Korean title keeps its existing member-brand prefix exactly once without a translation request',async()=>{
 const korean={...source,title:'회원 브랜드 검토한 상품'},x=await fixture(companies[1],()=>assert.fail('Korean source requires no provider call'),korean);
 try{const result=await json(await x.title.POST(x.request(x.item)));assert.equal(result.displayTitle,korean.title);assert.equal(result.titlePreparation.state,'completed');assert.equal(x.requests,0);assert.equal((await json(await x.api.GET())).items[0].displayTitle,korean.title);}finally{x.close();}
});

test('an interrupted title claim becomes a bounded retry after thirty seconds without touching the raw capture',async()=>{
 const x=await fixture();try{
  const before=x.raw(),db=x.h.load('db/source-inbox-titles.ts');await db.claimSourceInboxTitle(x.item,{id:'owner',email:'unari8484@gmail.com',role:'member'});
  x.h.sqlite.prepare('UPDATE source_inbox_titles SET updated_at=?').run(new Date(Date.now()-31000).toISOString());
  x.h.sqlite.prepare('UPDATE source_inbox_title_runs SET updated_at=?').run(new Date(Date.now()-31000).toISOString());
  const stale=(await json(await x.api.GET())).items[0];assert.equal(stale.titlePreparation.state,'failed');assert.equal(stale.titlePreparation.retryable,true);
  const result=await json(await x.title.POST(x.request(stale)));assert.equal(result.titlePreparation.state,'completed');assert.equal(result.titlePreparation.attempts,2);assert.equal(x.requests,1);assert.equal(x.raw(),before);
 }finally{x.close();}
});

test('typed free-translation failures preserve raw title and bound retries; 429 never auto-retries',async()=>{
 const limited=await fixture(companies[1],()=>new Response('limited',{status:429}));try{const before=limited.raw(),result=await json(await limited.title.POST(limited.request(limited.item)));assert.equal(result.titlePreparation.state,'failed');assert.equal(result.titlePreparation.retryable,false);assert.equal(result.displayTitle,source.title);await json(await limited.title.POST(limited.request(limited.item)));assert.equal(limited.requests,1);assert.equal(limited.raw(),before);}finally{limited.close();}
 const transient=await fixture(companies[1],()=>{throw new TypeError('connection reset');});try{for(let i=1;i<=3;i++){const result=await json(await transient.title.POST(transient.request(transient.item)));assert.equal(result.titlePreparation.attempts,Math.min(i,2));assert.equal(result.titlePreparation.retryable,i===1);}assert.equal(transient.requests,2);}finally{transient.close();}
});

test('changed source revision or approved membership cannot adopt a held translation result',async()=>{
 for(const change of ['review','member']){let release,entered;const started=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;}),x=await fixture(companies[1],()=>{entered();return held;});try{
  const work=x.title.POST(x.request(x.item));await started;
  if(change==='review')await x.h.load('db/source-inbox.ts').reviewSourceInbox('owner',x.item.id,x.item.revision,{...source,title:'직접 검토한 최신 상품명'});
  else x.h.sqlite.prepare("UPDATE members SET status='suspended' WHERE id='owner'").run();
  release(Response.json([[['합성 테스트 상품',source.title]],null,'zh-CN']));await json(await work,409);assert.equal(x.h.sqlite.prepare('SELECT translated_title FROM source_inbox_titles').get().translated_title,null);assert.equal(x.h.sqlite.prepare("SELECT title FROM products WHERE id='protected-original'").get().title,'기존 등록 상품');
 }finally{x.close();}}
});

test('background hook publishes raw source first, then only exact title fields, and discards late owner results',async()=>{
 const company=companies[1],base={id:'76400000-0000-4000-8000-000000000009',ownerId:'owner',company,fingerprint:'a'.repeat(64),snapshot:source,reviewed:null,revision:1,receivedAt:'2026-10-20T00:00:00Z',archivedAt:null,issues:[]};
 const pending={...base,titlePreparation:{format:'yoofam-collected-title-v1',fingerprint:base.fingerprint,revision:1,sourceTitle:source.title,state:'pending',translatedTitle:null,brand:'회원 브랜드',attempts:0,retryable:true,message:'한국어 상품명 준비 대기'}};
 let release;const h=sourceReviewHookFixture((url,init)=>url==='/api/source-inbox'?Response.json({ownerId:'owner',company,items:[pending]}):url==='/api/source-inbox/title'?new Promise(resolve=>{release=resolve;}):assert.fail(url));
 try{h.render();await turn();let shown=h.render().items[0];const rawSnapshot=shown.snapshot;assert.equal(shown.snapshot.title,source.title);assert.equal(shown.titlePreparation.state,'pending');assert.equal(h.calls.filter(call=>call.url==='/api/source-inbox/title').length,1);
  const titlePreparation={...pending.titlePreparation,state:'completed',translatedTitle:'합성 테스트 상품',attempts:1,retryable:false,message:'번역 완료'};
  release(Response.json({ownerId:'owner',company,id:base.id,fingerprint:base.fingerprint,revision:1,sourceUrl:source.sourceUrl,titlePreparation,displayTitle:'회원 브랜드 합성 테스트 상품'}));await turn();shown=h.render().items[0];assert.equal(shown.displayTitle,'회원 브랜드 합성 테스트 상품');assert.equal(shown.snapshot,rawSnapshot);assert.equal(shown.revision,1);
 }finally{h.close();}
 const late=sourceReviewHookFixture(url=>url==='/api/source-inbox'?Response.json({ownerId:'owner',company,items:[pending]}):new Promise(resolve=>{release=resolve;}));
 try{late.render();await turn();late.owner('different-owner');release(Response.json({ownerId:'owner',company,id:base.id,fingerprint:base.fingerprint,revision:1,sourceUrl:source.sourceUrl,titlePreparation:{...pending.titlePreparation,state:'completed',translatedTitle:'합성 테스트 상품',attempts:1},displayTitle:'회원 브랜드 합성 테스트 상품'}));await turn();assert.equal(late.render().items.length,0);}finally{late.close();}
});

test('legacy Google429 sidecars resume once with configured Qwen and reuse literal results within the same member/company only',async()=>{
 const x=await fixture();let calls=0;try{
  x.h.sqlite.prepare(`INSERT INTO source_inbox_titles VALUES(?,?,?,?,?,?,?,'failed',NULL,?,1,0,?)`).run(x.item.ownerId,x.item.id,x.item.company.code,x.item.company.name,x.item.fingerprint,x.item.revision,source.title,'상품명 번역 요청이 제한되었습니다. 원문을 보존했습니다.',new Date().toISOString());
  x.h.bindings.SOURCEFLOW_TEXT_PROVIDER='workers-ai';x.h.bindings.SOURCEFLOW_TEXT_MODEL=QWEN;
  x.h.bindings.AI.run=async(model,input)=>{calls++;assert.equal(model,QWEN);assert.equal(input.max_tokens,1024);assert.equal(input.stream,false);assert.equal(input.temperature,0.7);assert.equal(input.top_p,0.8);assert.equal(input.top_k,20);assert.equal(Object.hasOwn(input,'response_format'),false);assert.equal(input.messages.length,2);assert.deepEqual(JSON.parse(input.messages[1].content.replace(/\n\/no_think$/u,'')),{sourceProductName:source.title});assert.doesNotMatch(JSON.stringify(input),/owner|회원 브랜드|764000000009|unari8484/);return qwen('합성 테스트 상품');};
  const before=x.raw(),ready=(await json(await x.api.GET())).items[0];assert.equal(ready.titlePreparation.state,'pending');assert.equal(ready.titlePreparation.attempts,0);assert.match(ready.titlePreparation.providerSignature,/workers-ai.*qwen3/);
  const result=await json(await x.title.POST(x.request(ready)));assert.equal(result.displayTitle,'회원 브랜드 합성 테스트 상품');assert.equal(result.titlePreparation.provider,'workers-ai');assert.equal(result.titlePreparation.model,QWEN);assert.equal(result.titlePreparation.attempts,1);assert.equal(calls,1);assert.equal(x.requests,0);assert.equal(x.raw(),before);
  await json(await x.title.POST(x.request(ready)));assert.equal(calls,1);
  const captured={...source,collectedAt:'2026-10-20T00:00:01.000Z'},fingerprint=await x.h.load('app/source-inbox.ts').pageSourceFingerprint(captured);
  await json(await x.api.POST(new Request('https://app.test/api/source-inbox',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:'owner',expectedCompany:x.item.company,id:'76400000-0000-4000-8000-000000000010',fingerprint,snapshot:captured})})));
  const second=(await json(await x.api.GET())).items.find(item=>item.id!==x.item.id);const reused=await json(await x.title.POST(x.request(second)));assert.equal(reused.displayTitle,result.displayTitle);assert.equal(calls,1,'same member/company/title/provider signature reuses completed literal text');
  assert.equal(await x.h.load('db/source-inbox-titles.ts').reusableSourceInboxTitle({...second,ownerId:'foreign'},result.titlePreparation.providerSignature),null);
  assert.equal(await x.h.load('db/source-inbox-titles.ts').reusableSourceInboxTitle({...second,company:companies[0]},result.titlePreparation.providerSignature),null);
 }finally{x.close();}
});

test('configured Qwen rejects unsupported facts and never silently falls back to Google',async()=>{
 const x=await fixture();let calls=0;try{x.h.bindings.SOURCEFLOW_TEXT_PROVIDER='workers-ai';x.h.bindings.SOURCEFLOW_TEXT_MODEL=QWEN;x.h.bindings.AI.run=async()=>{calls++;return qwen('방수 합성 테스트 상품 999');};
  const result=await json(await x.title.POST(x.request(x.item)));assert.equal(result.titlePreparation.state,'failed');assert.equal(result.titlePreparation.retryable,false);assert.equal(result.displayTitle,source.title);await json(await x.title.POST(x.request(x.item)));assert.equal(calls,1);assert.equal(x.requests,0);
 }finally{x.close();}
});

test('an interrupted Qwen request stays uncertain and cannot automatically invoke the model again',async()=>{
 let entered,release;const started=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;}),x=await fixture();let calls=0;
 try{x.h.bindings.SOURCEFLOW_TEXT_PROVIDER='workers-ai';x.h.bindings.SOURCEFLOW_TEXT_MODEL=QWEN;x.h.bindings.AI.run=()=>{calls++;entered();return held;};
  const controller=new AbortController(),work=x.title.POST(new Request(x.request(x.item),{signal:controller.signal}));await started;controller.abort();const result=await json(await work);assert.equal(result.titlePreparation.state,'failed');assert.equal(result.titlePreparation.retryable,false);assert.equal(x.h.sqlite.prepare('SELECT status FROM source_inbox_title_runs').get().status,'uncertain');
  await json(await x.title.POST(x.request(x.item)));assert.equal(calls,1);release(qwen('늦게 온 번역 상품'));await turn();assert.equal((await json(await x.api.GET())).items[0].displayTitle,source.title);assert.equal(x.requests,0);
 }finally{x.close();}
});

test('collection-time waitUntil returns the immutable raw ACK before Qwen and shares its claim with UI recovery',async()=>{
 const background=[];let entered,release;const started=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;});let calls=0;
 const h=mobileIntakeHarness({backgroundWaitUntil:promise=>background.push(promise)});
 try{
  h.bindings.SOURCEFLOW_TEXT_PROVIDER='workers-ai';h.bindings.SOURCEFLOW_TEXT_MODEL=QWEN;h.bindings.AI.run=()=>{calls++;entered();return held;};
  h.sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('owner','unari8484@gmail.com','synthetic','member','approved',companies[1].code,companies[1].name,'2026-10-23','2026-10-23');await h.load('db/queries.ts').saveSettings('owner',JSON.stringify({...h.settings,brand:'회원 브랜드'}));
  const api=h.load('app/api/source-inbox/route.ts'),title=h.load('app/api/source-inbox/title/route.ts'),fingerprint=await h.load('app/source-inbox.ts').pageSourceFingerprint(source),id='76400000-0000-4000-8000-000000000011';
  const acknowledgement=await json(await api.POST(new Request('https://app.test/api/source-inbox',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:'owner',expectedCompany:companies[1],id,fingerprint,snapshot:source})})));assert.equal(acknowledgement.storedFingerprint,fingerprint);assert.equal(background.length,1);await started;
  const raw=h.sqlite.prepare('SELECT * FROM source_inbox').get();let item=(await json(await api.GET())).items[0];assert.equal(item.displayTitle,source.title);assert.equal(item.titlePreparation.state,'running');
  const replay=await json(await title.POST(new Request('https://app.test/api/source-inbox/title',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:'owner',expectedCompany:companies[1],id,expectedFingerprint:fingerprint,expectedRevision:item.revision,expectedSourceUrl:source.sourceUrl})})));assert.equal(replay.titlePreparation.state,'running');assert.equal(calls,1);
  release(qwen('합성 테스트 상품'));await Promise.all(background);item=(await json(await api.GET())).items[0];assert.equal(item.displayTitle,'회원 브랜드 합성 테스트 상품');assert.equal(item.titlePreparation.provider,'workers-ai');assert.deepEqual(h.sqlite.prepare('SELECT * FROM source_inbox').get(),raw);
 }finally{h.close();}
});
