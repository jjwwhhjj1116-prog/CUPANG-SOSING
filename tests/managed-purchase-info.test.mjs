import test from 'node:test';
import assert from 'node:assert/strict';
import {managedProductHarness,managedFixture} from './helpers/managed-products.mjs';
const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}],plain=value=>JSON.parse(JSON.stringify(value)),json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
async function fixture(company){
 const h=managedProductHarness();try{Object.assign(h.state.user.membership,{companyCode:company.code,companyName:company.name});h.syncMember();
  const model=h.load('app/managed-purchase-info.ts'),entry=model.createManagedPurchaseInfoEntry({title:'두 번째 합성 상품',barcode:'001234',image:'https://example.test/image.png'});Object.assign(entry,{'구매링크':'https://detail.1688.com/offer/631010000001.html','옵션1_중국어':'白色','매칭상태':'매칭완료','요청사항':'등록완료',unknownLegacy:{extra:[0,'',false,{literal:'원문\n"quote"'}]}});
  const bytes=managedFixture(2,rows=>{rows[0]['구매정보']='[]';rows[1]['구매정보']=JSON.stringify([entry]);}),preview=await json(await h.submit(bytes,{companyCode:company.code}));await json(await h.submit(bytes,{companyCode:company.code,action:'import',sha256:preview.sha256}),201);
  const request=async(url,init={})=>{const match=new URL('https://app.test'+url).pathname.match(/^\/api\/managed-products\/(\d+)\/purchase-info$/u);if(!match)return h.fetcher(url,init);return h.load('app/api/managed-products/[skuId]/purchase-info/route.ts')[init.method==='PUT'?'PUT':'GET'](new Request('https://app.test'+url,init),{params:Promise.resolve({skuId:match[1]})});};
  const get=sku=>request('/api/managed-products/'+sku+'/purchase-info').then(json),put=(view,purchaseInfo,extra={})=>request('/api/managed-products/'+view.skuId+'/purchase-info',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedAccountContext:view.accountContext,expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,purchaseInfo,...extra})}),save=(view,purchaseInfo)=>put(view,purchaseInfo).then(json);
  return{h,model,request,get,put,save,entry,raw:()=>JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products ORDER BY sku_id').all()),close:()=>h.close()};
 }catch(error){h.close();throw error;}
}
for(const company of companies)test(`owned purchase drafts and verified original entries project to list/filter without rewriting original DB (${company.code})`,async()=>{
 const f=await fixture(company);try{
  const before=f.raw(),empty=await f.get('1000000000'),original=await f.get('1000000001');assert.equal(empty.revision,0);assert.deepEqual(empty.purchaseInfo,[]);assert.equal(original.purchaseInfoComplete,true);
  const added=plain(f.model.createManagedPurchaseInfoEntry(empty.product));added['협의ID']='직접 입력한 협의 메모';added.unknownExtension={zero:0,blank:'',nested:[false,'保留']};const saved=await f.save(empty,[added]);assert.equal(saved.revision,1);assert.equal(saved.sourceVersion,empty.sourceVersion);assert.deepEqual(saved.purchaseInfo,[added]);assert.equal(saved.purchaseInfoComplete,false);assert.equal(f.raw(),before);
  let list=await json(await f.h.fetcher('/api/managed-products'));const product=list.products.find(row=>row.skuId===empty.skuId);assert.deepEqual(product.purchaseInfo,[added]);assert.equal(product.values['구매정보'],'[]');assert.equal(f.h.load('app/managed-product-table.ts').managedCell(product,'구매정보'),JSON.stringify([added]));
  const edited=plain(original.purchaseInfo);edited[0]['한글표시사항']['사용시주의사항']='직접 확인한 주의사항';edited[0]['요청사항']='등록대기';await f.save(original,edited);list=await json(await f.h.fetcher('/api/managed-products?filter=no-purchase'));assert.equal(list.total,2);assert.equal(list.summary.noPurchase,2);assert.equal(f.raw(),before);
 }finally{f.close();}
});

for(const company of companies){
 test(`uncertain post-write source changes return conflict, fresh read recovers saved purchases, and storage errors roll back atomically (${company.code})`,async()=>{
  const f=await fixture(company);try{
   const view=await f.get('1000000000'),rows=[plain(f.model.createManagedPurchaseInfoEntry(view.product))],raw=f.raw();f.h.sqlite.exec("CREATE TRIGGER reject_purchase BEFORE INSERT ON managed_purchase_info BEGIN SELECT RAISE(ABORT,'PRIVATE_PURCHASE_STORAGE_DETAILS'); END;");const failure=await f.put(view,rows);assert.equal(failure.status,503);assert.doesNotMatch(await failure.text(),/PRIVATE_PURCHASE_STORAGE_DETAILS/);assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM managed_purchase_info').get().n,0);assert.equal(f.raw(),raw);
   f.h.sqlite.exec("DROP TRIGGER reject_purchase;CREATE TRIGGER source_changes_after_purchase AFTER INSERT ON managed_purchase_info BEGIN UPDATE managed_products SET imported_at='2026-12-12T00:00:00.000Z' WHERE owner_id=NEW.owner_id AND company_code=NEW.company_code AND sku_id=NEW.sku_id;END;");const uncertain=await f.put(view,rows);assert.equal(uncertain.status,409);const current=await f.get(view.skuId);assert.equal(current.revision,1);assert.deepEqual(current.purchaseInfo,rows);assert.notEqual(current.sourceVersion,view.sourceVersion);assert.equal((await f.put(view,rows)).status,409);assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM managed_purchase_info').get().n,1);
  }finally{f.close();}
 });

 test(`a pending row cannot consume unchanged completed proof, and changing approved company during GET cannot adopt another scope (${company.code})`,async()=>{
  const f=await fixture(company);try{
   const values=JSON.parse(f.h.sqlite.prepare("SELECT source_payload FROM managed_products WHERE sku_id='1000000001'").get().source_payload),completed=plain(f.model.createManagedPurchaseInfoEntry({title:'두 번째 합성 상품',barcode:'001234',image:'https://example.test/image.png'}));completed['매칭상태']='매칭완료';completed['요청사항']='등록완료';values['구매정보']=JSON.stringify([completed]);f.h.sqlite.prepare("UPDATE managed_products SET source_payload=? WHERE sku_id='1000000001'").run(JSON.stringify(values));const view=await f.get('1000000001'),pending=plain(f.model.createManagedPurchaseInfoEntry(view.product));const saved=await f.save(view,[pending,...view.purchaseInfo]);assert.deepEqual(saved.purchaseInfo,[pending,...view.purchaseInfo]);assert.equal(saved.purchaseInfo[1]['매칭상태'],'매칭완료');assert.equal(saved.purchaseInfo[0]['매칭상태'],'매칭대기');
   const db=f.h.load('db/managed-purchase-info.ts'),read=db.readManagedPurchaseInfo;db.readManagedPurchaseInfo=async(...args)=>{const snapshot=await read(...args);const other=companies.find(item=>item.code!==company.code);Object.assign(f.h.state.user.membership,{companyCode:other.code,companyName:other.name});f.h.syncMember();return snapshot;};assert.equal((await f.request('/api/managed-products/'+view.skuId+'/purchase-info?expectedAccountContext='+view.accountContext)).status,409);assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM managed_purchase_info').get().n,1);
  }finally{f.close();}
 });

 test(`completed link edits rematch only, request/label edits reset registration, title and numeric edits retain observed completion (${company.code})`,async()=>{
  const f=await fixture(company);try{
   const raw=f.raw();let view=await f.get('1000000001'),rows=plain(view.purchaseInfo);rows[0]['구매링크']='https://detail.1688.com/offer/631010000002.html';rows[0]['구매링크init']=rows[0]['구매링크'];rows[0]['상품명']='같이 수정한 상품명';rows[0]['상품명init']=rows[0]['상품명'];rows[0]['판매구성수량']=4;rows[0]['매칭상태']='매칭필요';view=await f.save(view,rows);assert.equal(view.purchaseInfo[0]['요청사항'],'등록완료');assert.equal(view.purchaseInfoComplete,false);
   rows=plain(view.purchaseInfo);rows[0]['요청내역'].reqcontent='검토한 포장 요청';rows[0]['요청사항']='등록대기';view=await f.save(view,rows);assert.deepEqual(view.purchaseInfo,rows);
   const source=await f.get('1000000001');assert.equal(source.originalPurchaseInfo[0]['요청사항'],'등록완료');assert.equal(f.raw(),raw);
  }finally{f.close();}
  const f2=await fixture(company);try{
   let view=await f2.get('1000000001'),rows=plain(view.purchaseInfo);Object.assign(rows[0],{'상품명':'수동 상품명','상품명init':'수동 상품명','판매구성수량':3,'협의단가':320.5});view=await f2.save(view,rows);assert.equal(view.purchaseInfoComplete,true);assert.deepEqual(view.purchaseInfo,rows);
   const same=await f2.save(view,plain(rows));assert.equal(same.revision,2);assert.notEqual(same.inputFingerprint,view.inputFingerprint);assert.ok(Date.parse(same.updatedAt)>Date.parse(view.updatedAt));assert.equal(same.purchaseInfoComplete,true);
  }finally{f2.close();}
 });

 test(`new rows and copied IDs cannot fabricate completed matches, while explicit deletion and opaque row order persist (${company.code})`,async()=>{
  const f=await fixture(company);try{
   const empty=await f.get('1000000000'),complete=await f.get('1000000001'),rows=plain(complete.purchaseInfo),before=f.raw();rows[0].new_id='copied-current-id';
   for(const forged of [rows,[...rows,...plain(rows)]]){const response=await f.put(forged.length===1?empty:complete,forged);assert.equal(response.status,400,await response.clone().text());}
   assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM managed_purchase_info').get().n,0);
   const added=plain(f.model.createManagedPurchaseInfoEntry(complete.product));added.custom={array:[0,false,'',{'层':null}]};const edited=[added,...plain(complete.purchaseInfo)];const saved=await f.save(complete,edited);assert.deepEqual(saved.purchaseInfo,edited);
   const reordered=await f.save(saved,[saved.purchaseInfo[1],saved.purchaseInfo[0]]);assert.deepEqual(reordered.purchaseInfo,[edited[1],edited[0]]);const removed=await f.save(reordered,[]);assert.deepEqual(removed.purchaseInfo,[]);assert.equal(removed.purchaseInfoComplete,false);
   const list=await json(await f.h.fetcher('/api/managed-products?columnFilters='+encodeURIComponent(JSON.stringify([{column:'구매정보',operator:'eq',value:'[]'}]))));assert.equal(list.total,2);assert.equal(f.raw(),before);
  }finally{f.close();}
 });

 test(`legacy explicit blank cells are editable without rewriting literals; damaged or absent cells stay opaque and uneditable (${company.code})`,async()=>{
  const f=await fixture(company);try{
   const baseline=f.h.sqlite.prepare("SELECT source_payload FROM managed_products WHERE sku_id='1000000000'").get().source_payload,original=JSON.parse(baseline);
   for(const raw of ['', '  \t\n', 'null', null, '[]']){const values={...original,'구매정보':raw};f.h.sqlite.prepare("UPDATE managed_products SET source_payload=? WHERE sku_id='1000000000'").run(JSON.stringify(values));const view=await f.get('1000000000');assert.deepEqual(view.originalPurchaseInfo,[]);assert.deepEqual(view.purchaseInfo,[]);assert.equal(JSON.parse(f.h.sqlite.prepare("SELECT source_payload FROM managed_products WHERE sku_id='1000000000'").get().source_payload)['구매정보'],raw);}
   for(const raw of [undefined,'not json','{}','[null]','[[]]','[1]']){const values={...original};if(raw===undefined)delete values['구매정보'];else values['구매정보']=raw;f.h.sqlite.prepare("UPDATE managed_products SET source_payload=? WHERE sku_id='1000000000'").run(JSON.stringify(values));const response=await f.request('/api/managed-products/1000000000/purchase-info');assert.equal(response.status,409);const list=await json(await f.h.fetcher('/api/managed-products'));assert.equal(list.products.length,2);assert.equal(list.products.find(row=>row.skuId==='1000000000').purchaseInfo,undefined);}
   f.h.sqlite.prepare("UPDATE managed_products SET source_payload=? WHERE sku_id='1000000000'").run(JSON.stringify({...original,'구매정보':'=1+1'}));const context=(await json(await f.h.fetcher('/api/managed-products'))).accountContext;const download=await f.h.fetcher('/api/managed-products/export?expectedAccountContext='+context);assert.equal(download.status,200);const parsed=await f.h.load('app/managed-products.ts').parseManagedProductWorkbook(await download.arrayBuffer(),company);assert.equal(parsed.rows.find(row=>row.skuId==='1000000000').values['구매정보'],'=1+1');
   assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM managed_purchase_info').get().n,0);
  }finally{f.close();}
 });

 test(`owned account proof, concurrent source/member/revision/clock changes and stale saves fail before purchase writes (${company.code})`,async()=>{
  for(const change of ['source','member','revision','clock']){
   const f=await fixture(company);try{
    let view=await f.get('1000000000');view=await f.save(view,[]);const rows=[plain(f.model.createManagedPurchaseInfoEntry(view.product))],before=f.h.sqlite.prepare('SELECT payload,revision,updated_at FROM managed_purchase_info').get();
    f.h.state.beforeBatch=queries=>{if(!queries.some(q=>q.sql.startsWith('INSERT INTO managed_purchase_info')))return;f.h.state.beforeBatch=null;if(change==='source')f.h.sqlite.prepare("UPDATE managed_products SET source_name='다른 원문.xlsx' WHERE sku_id='1000000000'").run();if(change==='member')f.h.sqlite.prepare("UPDATE members SET status='suspended'").run();if(change==='revision')f.h.sqlite.prepare('UPDATE managed_purchase_info SET revision=revision+1').run();if(change==='clock')f.h.sqlite.prepare("UPDATE managed_purchase_info SET updated_at='2026-12-01T00:00:00.000Z'").run();};
    assert.equal((await f.put(view,rows)).status,409);const stored=f.h.sqlite.prepare('SELECT payload,revision,updated_at FROM managed_purchase_info').get();assert.equal(stored.payload,before.payload);assert.equal(stored.revision,change==='revision'?before.revision+1:before.revision);assert.equal(stored.updated_at,change==='clock'?'2026-12-01T00:00:00.000Z':before.updated_at);
   }finally{f.close();}
  }
  const f=await fixture(company);try{
   const view=await f.get('1000000000'),old=f.h.state.user;f.h.state.user={...old,userId:'other-631-owner',membership:{...old.membership,id:'other-631-owner'}};f.h.syncMember();assert.equal((await f.request('/api/managed-products/'+view.skuId+'/purchase-info?expectedAccountContext='+view.accountContext)).status,409);assert.equal((await f.put(view,[])).status,409);assert.equal((await f.request('/api/managed-products/'+view.skuId+'/purchase-info')).status,404);assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM managed_purchase_info').get().n,0);
   f.h.state.user=old;const saved=await f.save(view,[]);assert.equal((await f.put(view,[])).status,409);assert.equal((await f.put(saved,[],{unexpected:true})).status,400);assert.equal((await f.request('/api/managed-products/'+view.skuId+'/purchase-info?expectedAccountContext=invalid')).status,400);
  }finally{f.close();}
 });

 test(`current source import preserves manual purchases and export separates immutable original from explicit applied values (${company.code})`,async()=>{
  const f=await fixture(company);try{
   const view=await f.get('1000000000'),entry=plain(f.model.createManagedPurchaseInfoEntry(view.product));entry.unknown={literal:'=SUM(1,2)\n_x0041_"<&>',values:[false,0,'']};const saved=await f.save(view,[entry]),sidecar=JSON.stringify(f.h.sqlite.prepare('SELECT * FROM managed_purchase_info').all());
   const changed=managedFixture(2,rows=>{rows[0]['商品扩展']='unused';rows[0]['상품명']='다시 가져온 최신 제목';rows[0]['구매정보']='null';rows[1]['구매정보']=JSON.stringify([f.entry]);}),preview=await json(await f.h.submit(changed,{companyCode:company.code}));await json(await f.h.submit(changed,{companyCode:company.code,action:'import',sha256:preview.sha256}),201);const current=await f.get(view.skuId);assert.notEqual(current.sourceVersion,saved.sourceVersion);assert.notEqual(current.inputFingerprint,saved.inputFingerprint);assert.equal(current.product.title,'다시 가져온 최신 제목');assert.deepEqual(current.originalPurchaseInfo,[]);assert.deepEqual(current.purchaseInfo,[entry]);assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM managed_purchase_info').all()),sidecar);assert.equal((await f.put(saved,[entry])).status,409);
   const download=await f.h.fetcher('/api/managed-products/export?expectedAccountContext='+current.accountContext);assert.equal(download.status,200,await download.clone().text());const bytes=await download.arrayBuffer(),reader=f.h.load('app/xlsx-template.ts'),inspection=reader.inspectXlsxArchive(await reader.readXlsxArchive(bytes)),rows=plain(inspection.sheets[0].rows).map(row=>row.values),header=rows[0],data=rows.find(row=>row[header.indexOf('SKUID')]===view.skuId);assert.equal(data[header.indexOf('구매정보')],'null');assert.equal(data[header.indexOf('YOOFAM 적용 구매정보')],JSON.stringify([entry]));assert.equal(data[header.indexOf('YOOFAM 구매정보 기준시각')],saved.updatedAt);assert.equal((await f.h.submit(new Uint8Array(bytes),{companyCode:company.code})).status,400);
   const filtered=await json(await f.h.fetcher('/api/managed-products?columnFilters='+encodeURIComponent(JSON.stringify([{column:'구매정보',operator:'contains',value:'SUM(1,2)'}]))+'&sort=구매정보&direction=ascending'));assert.equal(filtered.total,1);assert.equal(filtered.products[0].skuId,view.skuId);assert.equal(filtered.products[0].values['구매정보'],'null');
   for(const table of ['products','product_content','collection_jobs','supplier_hub_receipts'])assert.equal(f.h.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
  }finally{f.close();}
 });
}

test('purchase JSON bounds preserve unknown data atomically and reject invalid known numbers without truncation',async()=>{
 const f=await fixture(companies[0]);try{const view=await f.get('1000000000');const entry=plain(f.model.createManagedPurchaseInfoEntry(view.product));for(const payload of [[{opaque:'a'.repeat(20000)}],[{opaque:'한'.repeat(20000)}],[{협의단가:-1}],[{협의단가:'bad'}],[{판매구성수량:0}],[{판매구성수량:1.2}]]){const response=await f.put(view,payload);assert.ok([400,413].includes(response.status),await response.clone().text());}assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM managed_purchase_info').get().n,0);
 const exact=[{opaque:'a'.repeat(19985)}];assert.equal(JSON.stringify(exact).length,20000);const saved=await f.save(view,exact);assert.deepEqual(saved.purchaseInfo,exact);assert.equal(saved.revision,1);const cyclic={};cyclic.self=cyclic;assert.throws(()=>f.model.validateManagedPurchaseInfo([cyclic]));assert.throws(()=>f.model.validateManagedPurchaseInfo([{opaque:NaN}]));assert.equal(entry['요청내역'].deliveryType,'coupang-shipment');assert.equal(entry['한글표시사항']['kc인증'],false);
 }finally{f.close();}
});

test('export SQL preflight refuses oversized effective source/sidecars before materializing rows and filtered exports stay available',async()=>{
 const f=await fixture(companies[0]);try{
  const payload=JSON.stringify([{opaque:'a'.repeat(19000),'매칭상태':'매칭대기','요청사항':'등록대기'}]);f.h.sqlite.exec(`WITH RECURSIVE seq(n) AS(SELECT 0 UNION ALL SELECT n+1 FROM seq WHERE n<449) INSERT INTO managed_products SELECT owner_id,company_code,CAST(2000000000+n AS TEXT),title,source_payload,source_name,source_sha256,source_row+n,first_imported_at,imported_at FROM managed_products CROSS JOIN seq WHERE sku_id='1000000000';`);f.h.sqlite.prepare("INSERT INTO managed_purchase_info SELECT owner_id,company_code,sku_id,1,?,'2026-10-13T00:00:00.000Z' FROM managed_products WHERE sku_id>='2000000000'").run(payload);
  const view=await f.get('1000000000');let readRows=-1;f.h.state.beforeBatch=queries=>{for(const q of queries)if(q.sql.includes('SELECT managed_products.* FROM export_scope')){const execute=q.execute;q.execute=()=>{const result=execute();readRows=result.length;return result;};}};const response=await f.h.fetcher('/api/managed-products/export?expectedAccountContext='+view.accountContext);assert.equal(response.status,413);assert.match(await response.text(),/원문·구매정보·매입내역/);assert.equal(readRows,0,'SQL must not send oversized result rows to the Worker');
  const filtered=await f.h.fetcher('/api/managed-products/export?expectedAccountContext='+view.accountContext+'&search=1000000000');assert.equal(filtered.status,200);assert.equal(readRows,1);
 }finally{f.close();}
});
