import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {managedProductHarness,managedFixture} from './helpers/managed-products.mjs';
import {importPriceFixture,postImportPrices} from './helpers/managed-import-prices.mjs';
import {managedComponentUI,nodes,text} from './helpers/managed-purchase-info-ui.mjs';

const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
const now=Date.parse('2026-10-13T05:30:00.000Z'),cutoff=new Date(now);
cutoff.setDate(cutoff.getDate()-7);
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const sku=index=>String(1000000000+index),iso=value=>new Date(value).toISOString();
const sourceEntry={'상품명':'원문 완료 제품','매칭상태':'매칭완료','요청사항':'등록완료','구매링크':'https://purchase.example.test/original','요청내역':{literal:'',zero:0,flag:false},'한글표시사항':{'제품명':'원문 완료 제품'},providerExtension:{rows:['',0,false]}};

/** Real production handlers and SQLite. Fix only the request clock so the
 * recorded rolling setDate predicate has an exact, repeatable boundary. */
function api(h){
 const cache=new Map(),materialized=[];
 class RequestDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const db={prepare(sql){let args=[];const query={sql,bind(...values){args=values;return query;},execute(){const rows=h.sqlite.prepare(sql).all(...args);if(rows.some(row=>Object.hasOwn(row,'source_payload')))materialized.push(rows.length);return rows;},async all(){return{results:query.execute()};},async first(){return query.execute()[0]??null;},async run(){return h.sqlite.prepare(sql).run(...args);}};return query;},async batch(queries){h.state.beforeBatch?.(queries);h.sqlite.exec('BEGIN');try{const results=queries.map(query=>({results:query.execute()}));h.sqlite.exec('COMMIT');return results;}catch(error){h.sqlite.exec('ROLLBACK');throw error;}}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,RangeError,Date:RequestDate,URL,URLSearchParams,Response,Request,File,FormData,Blob,DecompressionStream,TextEncoder,TextDecoder,Uint8Array,DataView,crypto,process:{env:{NODE_ENV:'production'}},fetch(){throw Error('external transport is forbidden');},require(name){if(name==='cloudflare:workers')return{env:{DB:db}};if(name==='next/server')return{NextResponse:Response};if(name==='@/app/chatgpt-auth')return{getChatGPTUser:async()=>h.state.user};return load(name.startsWith('@/')?name.slice(2)+'.ts':path.posix.join(path.posix.dirname(file),name)+'.ts');}});return exports;
 }
 async function request(url,init={}){h.state.calls.push({url,method:init.method??'GET'});const target=new URL(url,'https://app.test'),purchase=/^\/api\/managed-products\/(\d+)\/purchase-info$/u.exec(target.pathname),request=new Request(target,init);
  if(purchase)return load('app/api/managed-products/[skuId]/purchase-info/route.ts')[init.method==='PUT'?'PUT':'GET'](request,{params:Promise.resolve({skuId:purchase[1]})});
  return load(target.pathname.endsWith('/export')?'app/api/managed-products/export/route.ts':'app/api/managed-products/route.ts').GET(request);
 }
 return{request,load,materialized};
}

function rowsFixture(refreshed=false){let rows;
 const bytes=managedFixture(130,source=>{rows=source;for(const [index,row]of source.entries()){
  row['상품명']=(index>=100?'후반 ':'앞쪽 ')+String(index).padStart(3,'0');row['판매가']=String(10000+index);row['발주가능상태']=['정상','품절','판매중지',''][index%4];
  row.productIdHistory=JSON.stringify(index<110?[{date:iso(now-86400000),productId:index===0?'12345':'이전 '+index,unknown:{literal:'=1+1'}}]:[]);
  row.priceHistory=JSON.stringify(index<105?[{date:iso(now-86400000),price:index===0?8000:7000}]:[]);
  row.otherSellers=JSON.stringify({hasOtherSellers:index<108?(index%3===0?'false':index%3===1?[]:{}):false,...(index%2?{}:{otherVendorNames:['기록된 회사 '+index]})});
  row['매입정보']=JSON.stringify([{date:'2026-10-10','매입가':index%3===0?0:index%3===1?10:-2}]);row.latestImportPrice='999';row['구매정보']=index===0?JSON.stringify([sourceEntry]):'[]';
 }
 for(const [offset,price]of [undefined,'',null,false,0].entries())source[5+offset]['매입정보']=JSON.stringify([{date:'2026-10-10','매입가':10},{date:'2026-10-12',...(price===undefined?{}:{'매입가':price})}]);
 for(const [offset,price]of ['NaN','미확인'].entries())source[10+offset]['매입정보']=JSON.stringify([{date:'2026-10-10','매입가':10},{date:'2026-10-12','매입가':price}]);
 const edge=[{date:iso(+cutoff)},{date:iso(+cutoff-1)},{date:'2026-10-06T14:30:00.000+09:00'},{date:'2026-10-06'},{date:'2026-10-13'},{date:'2030-01-01T00:00:00.000Z'},{date:'not-a-date'},{date:+cutoff},{date:'Tue, 06 Oct 2026 05:30:00 GMT'}, {date:null},{unknown:'no date'},[],null,'broken','object',{date:iso(now)}, {date:iso(now),productId:'12345'},{date:false},{date:iso(+cutoff+1)},{date:'2026-10-05T22:30:00.000-07:00'}];
 for(const [offset,entry]of edge.entries()){const row=source[110+offset];row.productIdHistory=entry==='broken'?'{broken':entry==='object'?'{}':entry===null?'':Array.isArray(entry)?'[]':JSON.stringify([entry]);row.priceHistory=row.productIdHistory;}
 source[109].otherSellers='{broken';source[110].otherSellers='[]';source[111].otherSellers=JSON.stringify({otherVendorNames:['목록만으로 매칭을 만들지 않음']});source[112].otherSellers=JSON.stringify({hasOtherSellers:1});source[113].otherSellers=JSON.stringify({hasOtherSellers:0});source[114].otherSellers=JSON.stringify({hasOtherSellers:''});source[115].otherSellers=JSON.stringify({hasOtherSellers:null});
 if(refreshed){source[0].productIdHistory='[]';source[0].priceHistory='[]';source[0].otherSellers=JSON.stringify({hasOtherSellers:false});source[0]['구매정보']='[]';source[1]['매입정보']=JSON.stringify([{date:'2026-10-13','매입가':999}]);source[129].productIdHistory=JSON.stringify([{date:iso(+cutoff-1)}]);}
 });return{bytes,rows};
}
const parsed=value=>{try{return JSON.parse(value);}catch{return null;}};
const recent=value=>{const entries=parsed(value);return Array.isArray(entries)&&entries.some(entry=>entry&&new Date(entry.date)>=cutoff);};
const matched=value=>{const entry=parsed(value);return Boolean(entry&&entry.hasOtherSellers);};
const sourcePrice=row=>{const records=parsed(row['매입정보']);return Array.isArray(records)&&records.length?[...records].sort((left,right)=>new Date(right.date)-new Date(left.date))[0]['매입가']||0:0;};
const selected=(row,filter)=>filter==='all'||filter==='product-id-changed'&&recent(row.productIdHistory)||filter==='price-changed'&&recent(row.priceHistory)||filter==='other-sellers'&&matched(row.otherSellers);
const ids=(rows,filter)=>rows.filter(row=>selected(row,filter)).map(row=>row.SKUID);
const original=h=>createHash('sha256').update(JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products ORDER BY owner_id,company_code,sku_id').all())).digest('hex');
const sidecars=h=>JSON.stringify(['managed_purchase_info','managed_import_prices'].map(table=>h.sqlite.prepare(`SELECT * FROM ${table} ORDER BY sku_id`).all()));

for(const company of companies)test(`history filters use the recorded whole-result predicates through API/UI/export and preserve manual overlays on original reimport (${company.code})`,async()=>{
 const h=managedProductHarness();Object.assign(h.state.user.membership,{companyCode:company.code,companyName:company.name});h.syncMember();const a=api(h),f=rowsFixture();let ui;
 const importFile=async bytes=>{const preview=await json(await h.submit(bytes,{companyCode:company.code}));return json(await h.submit(bytes,{companyCode:company.code,action:'import',sha256:preview.sha256,accountContext:preview.accountContext}),201);};
 const list=async params=>json(await a.request('/api/managed-products?'+new URLSearchParams({pageSize:'100',...params})));
 try{
  await importFile(f.bytes);const all=await list({}),accountContext=all.accountContext;
  assert.equal(all.summary.total,130);assert.equal(all.total,130);assert.equal(all.products.length,100);
  for(const [filter,key]of [['product-id-changed','productIdChanged'],['price-changed','priceChanged'],['other-sellers','otherSellers']]){
   assert.equal(all.summary[key],ids(f.rows,filter).length);const first=await list({filter,pageSize:'10'});assert.equal(first.total,ids(f.rows,filter).length);assert.equal(first.products.length,10);assert.equal(first.summary[key],all.summary[key]);
   const page2=await list({filter,page:'2'});assert.deepEqual(page2.products.map(row=>row.skuId),ids(f.rows,filter).slice(100));
  }
  const boundary=await list({page:'2'}),bySku=new Map(boundary.products.map(row=>[row.skuId,row]));
  for(const index of [110,112,114,115,117,118,125,126,128,129])assert.equal(bySku.get(sku(index)).history.productId.changedRecently,true,'valid source date includes '+index);
  for(const index of [111,113,116,119,120,121,122,123,124,127])assert.equal(bySku.get(sku(index)).history.productId.changedRecently,false,'absent, NaN, old or malformed date excludes '+index);
  assert.equal(bySku.get(sku(110)).history.productId.latest.previous,null,'date-only evidence is included without inventing a previous ID');
  assert.equal(bySku.get(sku(115)).history.productId.latest.date,'2030-01-01T00:00:00.000Z','there is no invented upper date bound');
  assert.equal(bySku.get(sku(112)).history.otherSellers.matched,true);assert.notEqual(bySku.get(sku(111)).history.otherSellers.matched,true);
  assert.deepEqual(all.products.slice(0,3).map(row=>row.effectiveImportPrice),['0','10','-2']);
  assert.deepEqual(all.products.slice(5,10).map(row=>row.effectiveImportPrice),['0','0','0','0','0'],'the newest recorded date wins even if its price is missing/blank/null/false/zero; an older positive price is not current');
  assert.deepEqual(all.products.slice(10,12).map(row=>row.effectiveImportPrice),[null,null],'nonnumeric source stays unconfirmed rather than turning into a fabricated zero or an older price');
  assert.ok(all.products.slice(10,12).every(row=>row.history.sourceImportPrice.state==='invalid'&&row.history.sourceImportPrice.noImport===false),'the observed truthy nonnumeric filter is distinct from a verified numeric price');
  assert.equal((await list({filter:'unavailable'})).total,f.rows.filter(row=>row['발주가능상태']!=='정상').length);
  assert.equal((await list({filter:'no-import'})).total,f.rows.filter(row=>!sourcePrice(row)||sourcePrice(row)<=0).length);

  const sourceBefore=original(h),purchase=await json(await a.request(`/api/managed-products/${sku(0)}/purchase-info?expectedAccountContext=${accountContext}`)),manual=structuredClone(purchase.purchaseInfo);manual[0]['상품명']=company.name+' 직접 수정 제품';
  const saved=await json(await a.request(`/api/managed-products/${sku(0)}/purchase-info`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedAccountContext:accountContext,expectedRevision:purchase.revision,expectedInputFingerprint:purchase.inputFingerprint,purchaseInfo:manual})}));assert.equal(saved.purchaseInfoComplete,true);
  const priceFile=importPriceFixture([[sku(0),'2026-10-11','0'],[sku(1),'2026-10-12','2.50']]),pricePreview=await json(await postImportPrices(h,priceFile));await json(await postImportPrices(h,priceFile,{action:'import',preview:pricePreview}),201);
  assert.equal(original(h),sourceBefore);const overlays=sidecars(h);
  const filteredParams={filter:'product-id-changed',search:'후반',sort:'판매가',direction:'descending',columnFilters:JSON.stringify([{column:'판매가',operator:'gte',value:'10120'}])},expected=f.rows.filter(row=>selected(row,filteredParams.filter)&&row['상품명'].includes('후반')&&Number(row['판매가'])>=10120).reverse();
  const filtered=await list({...filteredParams,pageSize:'10'});assert.equal(filtered.total,expected.length);assert.deepEqual(filtered.products.map(row=>row.skuId),expected.map(row=>row.SKUID));assert.equal(filtered.summary.total,130);assert.equal(filtered.summary.productIdChanged,all.summary.productIdChanged);

  ui=managedComponentUI('app/components/managed-products-panel.tsx','ManagedProductsPanel',a.request);await ui.idle();
  const nav=()=>nodes(ui.render()).find(node=>node.type==='nav'&&node.props['aria-label']==='등록 상품 필터'),button=label=>nodes(nav()).find(node=>node.type==='button'&&text(node).replace(/\s/gu,'').startsWith(label)),shown=()=>nodes(ui.render()).filter(node=>node.type==='tr'&&node.props['data-sku-id']).map(node=>node.props['data-sku-id']);
  assert.equal(nodes(nav()).filter(node=>node.type==='button').length,8);
  for(const [filter,label]of [['product-id-changed','노출ID변경'],['price-changed','공급가변경'],['other-sellers','타사매칭']]){assert.ok(button(label));button(label).props.onClick();await ui.idle();assert.deepEqual(shown(),ids(f.rows,filter).slice(0,10));assert.match(text(ui.render()),new RegExp('전체 결과 '+ids(f.rows,filter).length+'개'));assert.equal(new URL(ui.requests.at(-1).url,'https://app.test').searchParams.get('filter'),filter);}
  button('노출ID변경').props.onClick();await ui.idle();ui.edit('상품관리 페이지당 상품 수','100');await ui.idle();assert.deepEqual(shown(),ids(f.rows,'product-id-changed').slice(0,100));await ui.click('다음');assert.deepEqual(shown(),ids(f.rows,'product-id-changed').slice(100));
  await ui.click('상품DB 다운로드');assert.equal(ui.downloads.length,1);assert.equal(ui.downloads[0].filename,`YOOFAM-${company.code}-products.xlsx`);
  const reader=a.load('app/xlsx-template.ts'),inspect=async bytes=>{const book=reader.inspectXlsxArchive(await reader.readXlsxArchive(bytes)),headers=book.sheets[0].rows[0].values;return Array.from(book.sheets[0].rows.slice(1),row=>Object.fromEntries(Array.from(headers,(header,index)=>[header,row.values[index]??''])));};
  const backup=await ui.downloads[0].blob.arrayBuffer(),exported=await inspect(backup);assert.deepEqual(exported.map(row=>row.SKUID),ids(f.rows,'product-id-changed'));
  for(const row of exported){const raw=f.rows.find(item=>item.SKUID===row.SKUID);for(const [key,value]of Object.entries(raw))assert.equal(row[key],value,'original XLSX cell '+key);assert.equal(row['회사코드'],company.code);}
  const manualExport=exported.find(row=>row.SKUID===sku(0));assert.deepEqual(JSON.parse(manualExport['YOOFAM 적용 구매정보']),saved.purchaseInfo);assert.equal(manualExport['YOOFAM 적용 매입가'],'0');assert.equal(exported.find(row=>row.SKUID===sku(1))['YOOFAM 적용 매입가'],'2.50');
  const selectionExport=await a.request('/api/managed-products/export?'+new URLSearchParams({...filteredParams,expectedAccountContext:accountContext}));assert.equal(selectionExport.status,200);assert.deepEqual((await inspect(await selectionExport.arrayBuffer())).map(row=>row.SKUID),expected.map(row=>row.SKUID));
  await json(await h.submit(backup,{companyCode:company.code}),400);assert.equal(original(h),sourceBefore);assert.equal(sidecars(h),overlays);

  const refreshed=rowsFixture(true),imported=await importFile(refreshed.bytes);assert.equal(imported.counts.updated,3);assert.equal(sidecars(h),overlays);const next=await list({filter:'product-id-changed'});assert.equal(next.total,ids(refreshed.rows,'product-id-changed').length);assert.equal(next.summary.productIdChanged,next.total);
  const manualAgain=await json(await a.request(`/api/managed-products/${sku(0)}/purchase-info?expectedAccountContext=${accountContext}`));assert.deepEqual(manualAgain.purchaseInfo,saved.purchaseInfo);assert.deepEqual(manualAgain.originalPurchaseInfo,[]);
  const refreshedAll=await list({});assert.deepEqual(refreshedAll.products.slice(0,2).map(row=>row.effectiveImportPrice),['0','2.50']);assert.equal(refreshedAll.products[1].values['매입정보'],refreshed.rows[1]['매입정보']);
  const rowsAfter=original(h);await ui.click('목록 새로고침');await ui.click('이전');assert.deepEqual(shown(),ids(refreshed.rows,'product-id-changed').slice(0,100));assert.equal(sidecars(h),overlays);assert.equal(original(h),rowsAfter);
  const owner=h.state.user;h.state.user={...owner,userId:'other-owner',membership:{...owner.membership,id:'other-owner'}};h.syncMember();const foreign=await list({filter:'other-sellers'});assert.equal(foreign.total,0);assert.equal(foreign.summary.total,0);h.state.user=owner;
  const other=companies.find(value=>value.code!==company.code);h.state.user={...owner,membership:{...owner.membership,companyCode:other.code,companyName:other.name}};h.syncMember();const otherCompany=await list({filter:'product-id-changed'});assert.equal(otherCompany.total,0);assert.equal(otherCompany.summary.total,0);h.state.user=owner;h.syncMember();assert.equal(original(h),rowsAfter);assert.equal(sidecars(h),overlays);

  // Several valid, bounded source imports can make a whole-result export too
  // large. It must fail in SQL before handing business rows to the Worker.
  for(let batch=0;batch<6;batch++){const large=managedFixture(55,rows=>{for(const [index,row]of rows.entries()){row.SKUID=String(2000000000+batch*55+index);row['옵션1_중국어']='X'.repeat(14000);row['옵션2_중국어']='Y'.repeat(14000);}});await importFile(large);}
  const largeBefore=original(h),largeOverlays=sidecars(h),largeList=await list({});assert.equal(largeList.total,460,'multiple valid source files are still queryable after their combined bytes exceed the cache batch bound');assert.equal(largeList.summary.total,460);assert.equal(largeList.products.length,100);a.materialized.length=0;await json(await a.request('/api/managed-products/export?'+new URLSearchParams({expectedAccountContext:accountContext})),413);assert.deepEqual(a.materialized,[],'over-limit source rows are never materialized by the export handler');assert.equal(original(h),largeBefore);assert.equal(sidecars(h),largeOverlays);
  for(const table of ['products','collection_jobs','supplier_hub_receipts'])assert.equal(h.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
 }finally{ui?.close();h.close();}
});
