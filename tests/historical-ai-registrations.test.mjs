import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalHarness,historicalRow,historicalQuote,historicalDocument as doc} from './helpers/historical-ai-registrations.mjs';
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const snapshot=h=>JSON.stringify(h.sqlite.prepare('SELECT * FROM historical_ai_records ORDER BY record_kind,registration_id,option_id').all());
const commit=async(h,files)=>{const preview=await json(await h.submit(files));return json(await h.submit(files,{action:'import',sha256:preview.sha256}));};

test('read-only history context binds the owner without changing original list or quotation values',async()=>{
 const h=historicalHarness();try{
  const quote=historicalQuote();await commit(h,[doc('page.json',[historicalRow()]),doc('quote.json',quote)]);const before=snapshot(h),first=await json(await h.fetcher('/api/historical-ai-registrations')),second=await json(await h.fetcher('/api/historical-ai-registrations'));
  assert.match(first.accountContext,/^[a-f0-9]{64}$/);assert.equal(first.accountContext,second.accountContext);assert.ok(!JSON.stringify(first).includes(h.state.user.userId));
  assert.equal(first.accountContext,await h.load('app/historical-ai-registrations.ts').historicalAiAccountContext(h.state.user.userId));
  const detail=await json(await h.fetcher('/api/historical-ai-registrations?registrationId=261002001001'));assert.deepEqual(detail,{registrationId:'261002001001',quotes:[quote]});assert.equal(snapshot(h),before);
 }finally{h.close();}
});

test('history ownership changes during a read reject the response without rewriting the retained original',async()=>{
 const h=historicalHarness();try{
  await commit(h,[doc('page.json',[historicalRow()])]);const before=snapshot(h),original=h.state.user;
  h.state.beforeBatch=()=>{h.state.beforeBatch=null;h.state.user={...original,userId:'after-read-owner',membership:{...original.membership,id:'after-read-owner'}};};
  const response=await h.fetcher('/api/historical-ai-registrations');assert.equal(response.status,409);assert.match(await response.text(),/계정 또는 회사정보가 변경/);assert.equal(snapshot(h),before);
  for(const table of ['products','collection_jobs','supplier_hub_receipts'])assert.equal(h.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
 }finally{h.close();}
});

test('actual API/SQLite keeps distinct registrations sharing a URL and exact partial quotation blanks, false and option IDs',async()=>{
 const h=historicalHarness({withoutMigration:true});try{
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name='historical_ai_records'").get().n,0);
  h.sqlite.exec(`INSERT INTO products(id,owner_id,source_url,title,source_price_cny,exchange_rate,supply_margin,coupang_margin,supply_price,sale_price,msrp,created_at,updated_at)
   VALUES('manual','unari-history','https://detail.1688.com/offer/813724060928.html','수동 상품',25.6,350,50,40,17920,29870,38830,'2026-10-01','2026-10-01');
   INSERT INTO product_content VALUES('manual','unari-history',7,'{"seo":{"title":""},"assets":{"main":[]}}','2026-10-01');`);
  const existing=JSON.stringify({products:h.sqlite.prepare('SELECT * FROM products').all(),content:h.sqlite.prepare('SELECT * FROM product_content').all()});
  const rows=[historicalRow(),historicalRow('261002001001_1',3)],quote=historicalQuote(),second=historicalQuote('261002001001','261002001002'),files=[doc('page1.json',rows),doc('quote.json',quote),doc('option2.json',second)];
  const preview=await json(await h.submit(files));assert.deepEqual(preview.counts,{total:4,registrations:2,quotations:2,added:4,unchanged:0,conflicts:0,unlinked:0});assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM historical_ai_records').get().n,0);
  await json(await h.submit(files,{action:'import',sha256:preview.sha256}));const stored=snapshot(h);
  const retry=await commit(h,files);assert.equal(retry.counts.added,0);assert.equal(retry.counts.unchanged,4);assert.equal(snapshot(h),stored);
  const result=await json(await h.fetcher('/api/historical-ai-registrations'));assert.equal(result.total,2);assert.equal(result.reportedOptions,5);assert.equal(result.records[0].sourceUrl,result.records[1].sourceUrl);assert.equal(new Set(result.records.map(row=>row.registrationId)).size,2);assert.deepEqual(result.records.find(row=>row.registrationId==='261002001001').raw,rows[0]);
  const detail=await json(await h.fetcher('/api/historical-ai-registrations?registrationId=261002001001'));assert.deepEqual(detail.quotes,[quote,second]);
  assert.equal(JSON.stringify({products:h.sqlite.prepare('SELECT * FROM products').all(),content:h.sqlite.prepare('SELECT * FROM product_content').all()}),existing);
  for(const table of ['product_options','collection_jobs','supplier_hub_receipts'])assert.equal(h.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
 }finally{h.close();}
});

test('more than 1000 rows across 100-row source pages import atomically and later pages append without a lifetime cap',async()=>{
 const h=historicalHarness();try{
  const pages=Array.from({length:12},(_,page)=>doc(`page${page+1}.json`,Array.from({length:100},(_,i)=>historicalRow(String(260000000000+page*100+i),1))));
  const preview=await json(await h.submit(pages));assert.equal(preview.counts.registrations,1200);await json(await h.submit(pages,{action:'import',sha256:preview.sha256}));
  await commit(h,[doc('page13.json',[historicalRow('260000001200',3)])]);const list=await json(await h.fetcher('/api/historical-ai-registrations?page=49'));assert.equal(list.total,1201);assert.equal(list.reportedOptions,1203);assert.equal(list.records.length,1);
  const row=h.sqlite.prepare("SELECT * FROM historical_ai_records WHERE registration_id='260000000999'").get();assert.equal(row.source_name,'page10.json');assert.equal(row.source_row,100);
  assert.equal((await json(await h.fetcher('/api/historical-ai-registrations?search=%25'))).total,0);
 }finally{h.close();}
});

test('changed originals, unlinked quotations, stale previews and duplicate keys never partially import or replace records',async()=>{
 const h=historicalHarness();try{
  const first=[doc('page1.json',[historicalRow()])];await commit(h,first);const before=snapshot(h),changed=historicalRow();changed.cells[13]='등록완료';
  const conflict=[doc('page2.json',[changed,historicalRow('261002001002')])],parsed=await h.load('app/historical-ai-registrations.ts').parseHistoricalAiImport(conflict);
  assert.equal((await h.submit(conflict)).status,409);assert.equal((await h.submit(conflict,{action:'import',sha256:parsed.sha256})).status,409);assert.equal(snapshot(h),before);
  const orphan=[doc('quote.json',historicalQuote('261002001009'))],unlinked=await h.load('app/historical-ai-registrations.ts').parseHistoricalAiImport(orphan);
  assert.equal((await h.submit(orphan,{action:'import',sha256:unlinked.sha256})).status,409);assert.equal(snapshot(h),before);
  assert.equal((await h.submit(first,{action:'import',sha256:'0'.repeat(64)})).status,409);
  assert.equal((await h.submit([doc('duplicate.json',[historicalRow(),historicalRow()])])).status,400);
  const extra=[doc('new.json',[historicalRow('261002001002')])],preview=await json(await h.submit(extra));
  h.sqlite.exec("CREATE TRIGGER fail_history BEFORE INSERT ON historical_ai_records BEGIN SELECT RAISE(ABORT,'PRIVATE_DATABASE_ERROR'); END;");
  const response=await h.submit(extra,{action:'import',sha256:preview.sha256});assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/PRIVATE_DATABASE_ERROR/);assert.equal(snapshot(h),before);
 }finally{h.close();}
});

test('exact account, current membership and request/file boundaries prevent cross-owner or company import',async()=>{
 const h=historicalHarness();try{
  const files=[doc('page1.json',[historicalRow()])],preview=await json(await h.submit(files)),original=h.state.user;
  assert.equal((await h.submit(files,{headers:{origin:'https://other.test'}})).status,403);
  assert.equal((await h.submit(files,{extra:{ownerId:'other-owner'}})).status,400);
  for(const user of [null,{...original,verifiedAccess:false},{...original,membership:{...original.membership,companyCode:'A01526306'}},{...original,userId:'other-owner'},{...original,membership:{...original.membership,email:'unapproved@example.test'}}]){
   h.state.user=user;assert.equal((await h.fetcher('/api/historical-ai-registrations')).status,403);assert.equal((await h.submit(files)).status,403);
  }
  h.state.user=original;h.state.beforeBatch=()=>{h.sqlite.exec("UPDATE members SET status='suspended'");h.state.beforeBatch=null;};
  assert.equal((await h.submit(files,{action:'import',sha256:preview.sha256})).status,503);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM historical_ai_records').get().n,0);
  h.sqlite.exec("UPDATE members SET status='approved'");await commit(h,files);
  h.state.user={...original,userId:'other-owner',membership:{...original.membership,id:'other-owner'}};assert.equal((await json(await h.fetcher('/api/historical-ai-registrations'))).total,0);assert.deepEqual((await json(await h.fetcher('/api/historical-ai-registrations?registrationId=261002001001'))).quotes,[]);
  h.state.user=original;const foreign=historicalQuote();foreign.companyCode='A01526306';assert.equal((await h.submit([doc('quote.json',foreign)])).status,400);
  const bad=historicalRow();bad.links=['https://not-1688.example/offer/813724060928.html'];assert.equal((await h.submit([doc('page.json',[bad])])).status,400);
  assert.equal((await h.submit([{name:'../page.json',text:files[0].text}])).status,400);
 }finally{h.close();}
});

test('recorded textContent spacing and innerText line boundaries keep raw cells unchanged and report ambiguous option markers',async()=>{
 const h=historicalHarness();try{
  const old=historicalRow(),spaced=historicalRow('261002001002',183);spaced.cells[3]='시험 상품 이름    옵션 183개    원본 분류';
  const documents=[doc('innerText.json',[old]),doc('textContent.json',[spaced])],preview=await json(await h.submit(documents));await json(await h.submit(documents,{action:'import',sha256:preview.sha256}));
  const list=await json(await h.fetcher('/api/historical-ai-registrations'));assert.equal(list.reportedOptions,185);const saved=list.records.find(row=>row.registrationId==='261002001002');assert.equal(saved.title,'시험 상품 이름');assert.deepEqual(saved.raw,spaced);
  const parser=h.load('app/historical-ai-registrations.ts');for(const content of ['시험  옵션 2개  별도  옵션 3개  원본','시험 옵션 2개 원본']){
   const row=historicalRow('261002001009');row.cells[3]=content;await assert.rejects(parser.parseHistoricalAiImport([doc('ambiguous.json',[row])]),error=>error.code==='INVALID_OPTION_MARKER');
  }
  await assert.rejects(parser.parseHistoricalAiImport(Array.from({length:101},()=>doc('page.json',[old]))),error=>error.code==='INPUT_LIMIT');
  const sameId=historicalRow();sameId.cells[3]=old.cells[3].replaceAll('\n','    ');assert.equal((await h.submit([doc('same-id-different-capture.json',[sameId])])).status,409,'different raw capture is never silently declared identical');
 }finally{h.close();}
});

test('observed second-level registration suffixes remain distinct from their parent and keep quotation lookups exact',async()=>{
 const h=historicalHarness();try{
  const ids=['261002001001','261002001001_2_2','261002001001_6_2','261002001001_6_3'],rows=ids.map(id=>historicalRow(id)),quote=historicalQuote(ids[2]);
  await commit(h,[doc('nested-registrations.json',rows),doc('nested-quote.json',quote)]);
  const list=await json(await h.fetcher('/api/historical-ai-registrations'));assert.equal(list.total,4);assert.deepEqual(list.records.map(row=>row.registrationId).sort(),[...ids].sort());
  assert.deepEqual((await json(await h.fetcher('/api/historical-ai-registrations?registrationId='+ids[2]))).quotes,[quote]);
  assert.deepEqual((await json(await h.fetcher('/api/historical-ai-registrations?registrationId='+ids[0]))).quotes,[]);
  assert.equal((await h.submit([doc('invalid-depth.json',[historicalRow('261002001001_2_2_1')])])).status,400);
 }finally{h.close();}
});
