import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {managedProductHarness,managedFixture,managedHeaders} from './helpers/managed-products.mjs';
import {importPriceFixture,postImportPrices} from './helpers/managed-import-prices.mjs';
const native=createRequire(import.meta.url),nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>typeof tree==='string'||typeof tree==='number'?String(tree):Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):'';
function ui(fetcher){
 const slots=[],effects=[],cleanups=new Map(),downloads=[];let cursor=0;
 const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useEffect(fn,deps){const index=cursor++,prior=slots[index];if(!prior||deps.some((dep,i)=>dep!==prior[i])){slots[index]=deps;effects.push(()=>{cleanups.get(index)?.();cleanups.set(index,fn());});}}};
 const table={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/managed-product-table.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:table,URLSearchParams,Error});
 const files=new Map();class TestURL extends URL{static createObjectURL(blob){const key='blob:managed-'+files.size;files.set(key,blob);return key;}static revokeObjectURL(){}}
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/managed-products-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,URL:TestURL,URLSearchParams,FormData,AbortController,Error,queueMicrotask,setTimeout(fn){fn();},document:{createElement(){return{click(){downloads.push({name:this.download,blob:files.get(this.href)});}};}},fetch:fetcher,require:name=>name==='react'?hooks:name==='@/app/managed-product-table'?table:name==='@/app/components/managed-import-prices-panel'?{ManagedImportPricesPanel:function ManagedImportPricesPanel(){}}:name==='@/app/components/managed-purchase-info-panel'?{ManagedPurchaseInfoPanel:function ManagedPurchaseInfoPanel(){}}:name.endsWith('.css')?{}:native(name)});
 const render=()=>{cursor=0;const tree=exports.ManagedProductsPanel();while(effects.length)effects.shift()();return tree;};
 return{render,downloads,async settle(){for(let i=0;i<12;i++){render();await new Promise(resolve=>setImmediate(resolve));}},close(){for(const cleanup of cleanups.values())cleanup?.();},button(label){const result=nodes(render()).find(n=>n.type==='button'&&text(n)===label);assert.ok(result,'missing button '+label);return result;}};
}
test('actual component previews owner file, requires company confirmation, imports once and exposes every exported field',async()=>{
 const h=managedProductHarness(),panel=ui(h.fetcher);try{
  await panel.settle();const file=new File([managedFixture(3,rows=>{rows[0].latestImportPrice='0';rows[0].priceHistory='[{"price":8000}]';rows[0]['판매링크']='javascript:alert(1)';})],'상품DB.xlsx');
  nodes(panel.render()).find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[file]}});
  const previewButton=panel.button('파일 미리보기');previewButton.props.onClick();previewButton.props.onClick();await panel.settle();
  assert.equal(h.state.calls.filter(c=>c.method==='POST').length,1);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM managed_products').get().n,0);
  assert.equal(panel.button('상품 DB 3개 가져오기').props.disabled,true);
  const companyCheck=nodes(panel.render()).find(n=>n.type==='label'&&text(n).includes('이 파일은 와이홉'));nodes(companyCheck).find(n=>n.type==='input').props.onChange({target:{checked:true}});
  const importButton=panel.button('상품 DB 3개 가져오기');assert.equal(importButton.props.disabled,false);importButton.props.onClick();importButton.props.onClick();await panel.settle();
  assert.equal(h.state.calls.filter(c=>c.method==='POST').length,2);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM managed_products').get().n,3);
  const tree=panel.render();assert.match(text(tree),/신규 3개/);assert.match(text(tree),/2026-08-07/);assert.ok(!nodes(tree).some(n=>n.type==='a'&&n.props.href?.startsWith('javascript:')));
  const columnBox=nodes(tree).find(n=>n.props?.className==='managed-columns');
  assert.deepEqual(new Set(nodes(columnBox).filter(n=>n.type==='input').map(n=>n.props['data-column-field'])),new Set(managedHeaders));
  const historyLabel=nodes(columnBox).find(n=>n.type==='label'&&text(n)==='priceHistory');nodes(historyLabel).find(n=>n.type==='input').props.onChange({target:{checked:true}});
  assert.ok(nodes(panel.render()).some(n=>n.type==='pre'&&text(n)==='[{"price":8000}]'));
 }finally{panel.close();h.close();}
});

test('a refreshed company cannot reuse the previous file company confirmation or its retained commit callback',async()=>{
 for(const [first,next]of [[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}],[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}]]){
  const h=managedProductHarness();Object.assign(h.state.user.membership,{companyCode:first.code,companyName:first.name});h.syncMember();const panel=ui(h.fetcher);try{
   await panel.settle();const file=new File([managedFixture(3)],'상품DB.xlsx');
   nodes(panel.render()).find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[file]}});
   panel.button('파일 미리보기').props.onClick();await panel.settle();
   const check=()=>nodes(panel.render()).find(n=>n.type==='label'&&text(n).includes('이 파일은 '));
   nodes(check()).find(n=>n.type==='input').props.onChange({target:{checked:true}});
   const previousCommit=panel.button('상품 DB 3개 가져오기').props.onClick;
   Object.assign(h.state.user.membership,{companyCode:next.code,companyName:next.name});
   h.syncMember();
   panel.button('목록 새로고침').props.onClick();await panel.settle();
   const currentCommit=nodes(panel.render()).find(n=>n.type==='button'&&text(n)==='상품 DB 3개 가져오기');
   if(currentCommit&&!currentCommit.props.disabled)currentCommit.props.onClick();await panel.settle();
   assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM managed_products').get().n,0,'no original-company confirmation may write rows for the refreshed company');
   assert.equal(nodes(panel.render()).some(n=>n.type==='button'&&text(n)==='상품 DB 3개 가져오기'&&!n.props.disabled),false,'an earlier company confirmation must not authorize this company');
   previousCommit();await panel.settle();assert.equal(h.state.calls.filter(c=>c.method==='POST').length,1);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM managed_products').get().n,0);
   assert.match(text(panel.render()),new RegExp(next.name));
   panel.button('파일 미리보기').props.onClick();await panel.settle();assert.match(text(check()),new RegExp(next.name));
   nodes(check()).find(n=>n.type==='input').props.onChange({target:{checked:true}});panel.button('상품 DB 3개 가져오기').props.onClick();await panel.settle();
   const stored=h.sqlite.prepare('SELECT * FROM managed_products ORDER BY sku_id').all();assert.equal(stored.length,3);assert.ok(stored.every(row=>row.company_code===next.code));
   assert.equal(JSON.parse(stored[0].source_payload)['재고'],'0');assert.equal(JSON.parse(stored[0].source_payload)['구매링크'],'');assert.equal(Object.keys(JSON.parse(stored[0].source_payload)).length,39);
  }finally{panel.close();h.close();}
 }
});

test('a new owner in the same company must preview again while the original file and column choices remain available',async()=>{
 const h=managedProductHarness(),existing=managedFixture(1,rows=>{rows[0]['상품명']='이전 계정 보관 상품';}),first=await(await h.submit(existing)).json();await h.submit(existing,{action:'import',sha256:first.sha256,accountContext:first.accountContext});
 const before=JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products').all()),panel=ui(h.fetcher);try{
  await panel.settle();const file=new File([managedFixture(3)],'상품DB.xlsx');nodes(panel.render()).find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[file]}});
  const column=()=>nodes(panel.render()).find(n=>n.type==='label'&&text(n)==='ROI');nodes(column()).find(n=>n.type==='input').props.onChange({target:{checked:true}});
  panel.button('파일 미리보기').props.onClick();await panel.settle();const check=()=>nodes(panel.render()).find(n=>n.type==='label'&&text(n).includes('이 파일은 '));nodes(check()).find(n=>n.type==='input').props.onChange({target:{checked:true}});
  const previousCommit=panel.button('상품 DB 3개 가져오기').props.onClick,old=h.state.user;h.state.user={...old,userId:'same-company-next-owner',membership:{...old.membership,id:'same-company-next-owner'}};h.syncMember();
  panel.button('목록 새로고침').props.onClick();previousCommit();await panel.settle();assert.ok(!text(panel.render()).includes('이전 계정 보관 상품'));assert.equal(check(),undefined);assert.equal(nodes(column()).find(n=>n.type==='input').props.checked,true);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products').all()),before);assert.equal(panel.button('파일 미리보기').props.disabled,false);
  panel.button('파일 미리보기').props.onClick();await panel.settle();assert.equal(panel.button('상품 DB 3개 가져오기').props.disabled,true);
  nodes(check()).find(n=>n.type==='input').props.onChange({target:{checked:true}});panel.button('상품 DB 3개 가져오기').props.onClick();await panel.settle();
  assert.equal(JSON.stringify(h.sqlite.prepare("SELECT * FROM managed_products WHERE owner_id='unari-test'").all()),before);assert.equal(h.sqlite.prepare("SELECT COUNT(*) n FROM managed_products WHERE owner_id='same-company-next-owner'").get().n,3);
 }finally{panel.close();h.close();}
});

for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])test(`registered table shows the exact 22 columns, whole-result controls and original XLSX download (${company.code})`,async()=>{
 const h=managedProductHarness();Object.assign(h.state.user.membership,{companyCode:company.code,companyName:company.name});h.syncMember();const bytes=managedFixture(130,rows=>{for(const [index,row]of rows.entries()){row['판매가']=String(index);row['공급가']=String(index*10);row['구매정보']=index===129?'=1+1':'[]';row['바코드']='00123'+index;}}),preview=await(await h.submit(bytes,{companyCode:company.code})).json();await h.submit(bytes,{companyCode:company.code,action:'import',sha256:preview.sha256});const before=JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products').all()),panel=ui(h.fetcher);
 const find=label=>{const found=nodes(panel.render()).find(node=>node.props?.['aria-label']===label);assert.ok(found,label);return found;},rows=()=>nodes(panel.render()).filter(node=>node.type==='tr'&&node.props['data-sku-id']);
 try{await panel.settle();assert.equal(rows().length,10);assert.deepEqual(nodes(panel.render()).filter(node=>node.type==='th'&&node.props['data-column']).map(node=>text(node).replace(/⌕$/,'')),['이미지','상품명','SKU ID','바코드','노출ID','옵션ID','판매링크','발주가능상태','쿠팡재고','판매가','공급가','리뷰평점','리뷰수','구매정보','매입관리','마진','마진율','ROI','최소ROAS','쿠팡마진','쿠팡마진율','바코드출력']);
  const size=find('상품관리 페이지당 상품 수');assert.equal(size.props.value,10);assert.deepEqual(nodes(size).filter(node=>node.type==='option').map(node=>node.props.value),[10,25,50,100]);
  find('상품관리 현재 페이지 전체 선택').props.onChange({target:{checked:true}});panel.button('다음').props.onClick();await panel.settle();find('SKU 1000000010 선택').props.onChange({target:{checked:true}});assert.match(text(panel.render()),/선택 11개/);panel.button('이전').props.onClick();await panel.settle();assert.equal(find('상품관리 현재 페이지 전체 선택').props.checked,true,'off-page selection is retained');
  find('상품관리 페이지당 상품 수').props.onChange({target:{value:'100'}});await panel.settle();assert.equal(rows().length,100);
  find('판매가 정렬').props.onClick();await panel.settle();find('판매가 정렬').props.onClick();await panel.settle();assert.equal(rows()[0].props['data-sku-id'],'1000000129');assert.equal(rows().at(-1).props['data-sku-id'],'1000000030');
  find('상품관리 고정할 열 선택').props.onChange({target:{value:'공급가'}});assert.ok(nodes(panel.render()).filter(node=>node.type==='th'&&node.props.className==='managed-pinned').every(node=>node.props['data-column']==='공급가'));
  const height=nodes(panel.render()).find(node=>node.type==='fieldset'&&node.props.className==='managed-height');nodes(height).find(node=>node.type==='label'&&text(node)==='N').props.children[0].props.onChange();assert.equal(nodes(panel.render()).some(node=>node.props?.className?.includes('managed-height-fixed')),false);
  find('판매가 열 필터').props.onClick();find('상품관리 열 필터 조건').props.onChange({target:{value:'gte'}});find('상품관리 열 필터 값').props.onChange({target:{value:'125'}});nodes(panel.render()).find(node=>node.type==='form'&&node.props.role==='dialog').props.onSubmit({preventDefault(){}});await panel.settle();assert.equal(rows().length,5);assert.equal(rows()[0].props['data-sku-id'],'1000000129');assert.match(text(panel.render()),/전체 결과 5개/);
  const download=panel.button('상품DB 다운로드');download.props.onClick();download.props.onClick();await panel.settle();assert.equal(panel.downloads.length,1);assert.equal(panel.downloads[0].name,`YOOFAM-${company.code}-products.xlsx`);const parsed=await h.load('app/managed-products.ts').parseManagedProductWorkbook(await panel.downloads[0].blob.arrayBuffer(),company);assert.equal(parsed.rows.length,5);assert.equal(parsed.rows[0].values['판매가'],'129');assert.equal(parsed.rows[0].values['구매정보'],'=1+1');assert.equal(parsed.rows[0].values['바코드'],'00123129');
  panel.button('열 필터 모두 해제').props.onClick();await panel.settle();panel.button('상품DB 다운로드').props.onClick();await panel.settle();const complete=await h.load('app/managed-products.ts').parseManagedProductWorkbook(await panel.downloads[1].blob.arrayBuffer(),company);assert.equal(complete.rows.length,130,'download must include off-page matching rows');
  const column=find('공급가 컬럼 표시');column.props.onChange({target:{checked:false}});assert.equal(find('상품관리 고정할 열 선택').props.value,'');assert.ok(!nodes(panel.render()).some(node=>node.type==='th'&&node.props['data-column']==='공급가'));panel.button('기본 22열').props.onClick();assert.equal(nodes(panel.render()).filter(node=>node.type==='th'&&node.props['data-column']).length,22);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products').all()),before);assert.equal(h.state.calls.filter(call=>call.url.startsWith('/api/managed-products/export')).length,2);for(const table of ['products','collection_jobs','supplier_hub_receipts'])assert.equal(h.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
 }finally{panel.close();h.close();}
});

test('a stale company download is refused by the real route without clicking an anchor',async()=>{const h=managedProductHarness(),bytes=managedFixture(1),preview=await(await h.submit(bytes)).json();await h.submit(bytes,{action:'import',sha256:preview.sha256});const panel=ui(h.fetcher);try{await panel.settle();Object.assign(h.state.user.membership,{companyCode:'A01526306',companyName:'유앤채'});h.syncMember();panel.button('상품DB 다운로드').props.onClick();await panel.settle();assert.equal(panel.downloads.length,0);assert.match(text(panel.render()),/현재 계정 또는 회사가 변경/);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM managed_products').get().n,1);}finally{panel.close();h.close();}});

test('import management opens the selected owned SKU, survives a same-company refresh and closes on account changes',async()=>{
 const h=managedProductHarness(),bytes=managedFixture(2),preview=await(await h.submit(bytes)).json();await h.submit(bytes,{action:'import',sha256:preview.sha256});const panel=ui(h.fetcher);
 const dialog=()=>nodes(panel.render()).find(node=>node.type?.name==='ManagedImportPricesPanel');
 try{await panel.settle();const rowButton=nodes(panel.render()).find(node=>node.props?.['aria-label']==='SKU 1000000001 매입관리');assert.ok(rowButton);rowButton.props.onClick();assert.equal(dialog().props.initialSkuId,'1000000001');assert.equal(dialog().props.company.code,'A01464742');assert.match(dialog().props.accountContext,/^[a-f0-9]{64}$/);dialog().props.onImported();await panel.settle();assert.equal(dialog().props.initialSkuId,'1000000001');
  const originalRows=JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products').all());Object.assign(h.state.user.membership,{companyCode:'A01526306',companyName:'유앤채'});h.syncMember();panel.button('목록 새로고침').props.onClick();await panel.settle();assert.equal(dialog(),undefined);rowButton.props.onClick();assert.equal(dialog(),undefined);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products').all()),originalRows);
  panel.button('매입정보 관리').props.onClick();assert.equal(dialog().props.initialSkuId,'');assert.equal(dialog().props.company.code,'A01526306');
 }finally{panel.close();h.close();}
});

async function managedPageFixture(company,fetcher){
 const h=managedProductHarness();Object.assign(h.state.user.membership,{companyCode:company.code,companyName:company.name});h.syncMember();
 const bytes=managedFixture(130),source=await(await h.submit(bytes,{companyCode:company.code})).json();assert.equal((await h.submit(bytes,{companyCode:company.code,action:'import',sha256:source.sha256})).status,201);
 const original=JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products').all()),panel=ui(fetcher?fetcher(h):h.fetcher),rows=()=>nodes(panel.render()).filter(node=>node.type==='tr'&&node.props['data-sku-id']);
 const price=async count=>{const bytes=importPriceFixture(Array.from({length:count},(_,index)=>[String(1000000000+index),'2026-10-13','10.50'])),response=await postImportPrices(h,bytes);assert.equal(response.status,200,await response.clone().text());const preview=await response.json();const saved=await postImportPrices(h,bytes,{action:'import',preview});assert.equal(saved.status,201,await saved.clone().text());};
 await panel.settle();panel.button('매입정보없음 130').props.onClick();await panel.settle();
 return{h,panel,rows,price,original,close(){panel.close();h.close();}};
}
for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])test(`a price import re-reads the valid filtered page without losing table choices or original rows (${company.code})`,async()=>{
 const f=await managedPageFixture(company);try{
  const find=label=>nodes(f.panel.render()).find(node=>node.props?.['aria-label']===label);find('SKU ID 정렬').props.onClick();await f.panel.settle();find('SKU ID 정렬').props.onClick();await f.panel.settle();find('ROI 컬럼 표시').props.onChange({target:{checked:false}});
  for(let page=1;page<13;page++){f.panel.button('다음').props.onClick();await f.panel.settle();}assert.equal(f.rows().length,10);find('SKU 1000000000 선택').props.onChange({target:{checked:true}});
  f.panel.button('매입정보 관리').props.onClick();const dialog=nodes(f.panel.render()).find(node=>node.type?.name==='ManagedImportPricesPanel');await f.price(20);dialog.props.onImported();await f.panel.settle();
  assert.equal(f.rows().length,10);assert.equal(f.rows()[0].props['data-sku-id'],'1000000029');assert.match(text(f.panel.render()),/11 \/ 11 페이지/);assert.match(text(f.panel.render()),/전체 결과 110개 · 선택 1개/);assert.equal(find('ROI 컬럼 표시').props.checked,false);assert.equal(f.panel.button('다음').props.disabled,true);
  const last=new URL(f.h.state.calls.filter(call=>call.url.startsWith('/api/managed-products?')).at(-1).url,'https://app.test');assert.equal(last.searchParams.get('page'),'11');assert.equal(last.searchParams.get('filter'),'no-import');assert.equal(last.searchParams.get('sort'),'SKUID');assert.equal(last.searchParams.get('direction'),'descending');
  assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM managed_products').all()),f.original);assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM managed_import_prices').get().n,20);for(const table of ['products','collection_jobs','supplier_hub_receipts'])assert.equal(f.h.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
 }finally{f.close();}
});
test('a now-empty filter returns to page one while all registered source rows remain available',async()=>{
 const f=await managedPageFixture({code:'A01464742',name:'와이홉'});try{
  for(let page=1;page<13;page++){f.panel.button('다음').props.onClick();await f.panel.settle();}f.panel.button('매입정보 관리').props.onClick();const dialog=nodes(f.panel.render()).find(node=>node.type?.name==='ManagedImportPricesPanel');await f.price(130);dialog.props.onImported();await f.panel.settle();
  assert.equal(f.rows().length,0);assert.match(text(f.panel.render()),/1 \/ 1 페이지/);assert.equal(f.panel.button('이전').props.disabled,true);assert.match(text(f.panel.render()),/전체 결과 0개/);
  f.panel.button('전체 130').props.onClick();await f.panel.settle();assert.equal(f.rows().length,10);assert.match(text(f.panel.render()),/전체 결과 130개/);assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM managed_products').all()),f.original);
 }finally{f.close();}
});
test('an aborted old page cannot rebase a newer filter or expose rows after an account change',async()=>{
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])for(const switchOwner of [false,true]){
  let hold=false,finish,heldSignal;const f=await managedPageFixture(company,h=>async(url,init={})=>{const response=await h.fetcher(url,init),query=new URL(url,'https://app.test').searchParams;if(hold&&url.startsWith('/api/managed-products?')&&query.get('page')==='13'&&query.get('filter')==='no-import'){hold=false;heldSignal=init.signal;return new Promise(resolve=>{finish=()=>resolve(response);});}return response;});
  try{
   for(let page=1;page<13;page++){f.panel.button('다음').props.onClick();await f.panel.settle();}await f.price(20);hold=true;f.panel.button('목록 새로고침').props.onClick();await f.panel.settle();assert.ok(finish);assert.equal(f.panel.button('상품DB 다운로드').props.disabled,true);const heldCallCount=f.h.state.calls.length;
   if(switchOwner){const old=f.h.state.user;f.h.state.user={...old,userId:'next-same-company-owner',membership:{...old.membership,id:'next-same-company-owner'}};f.h.syncMember();}
   f.panel.button('전체 130').props.onClick();await f.panel.settle();assert.equal(heldSignal.aborted,true);finish();await f.panel.settle();
   assert.match(text(f.panel.render()),switchOwner?/전체 결과 0개/:/전체 결과 130개/);assert.equal(f.rows().length,switchOwner?0:10);assert.match(text(f.panel.render()),/1 \/ (?:1|13) 페이지/);assert.ok(!f.h.state.calls.slice(heldCallCount).some(call=>new URL(call.url,'https://app.test').searchParams.get('page')==='11'));assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM managed_products').all()),f.original);
  }finally{f.close();}
 }
});
