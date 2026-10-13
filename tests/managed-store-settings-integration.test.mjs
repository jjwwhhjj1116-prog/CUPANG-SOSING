import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {managedFixture,managedProductHarness} from './helpers/managed-products.mjs';

const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
const plain=value=>JSON.parse(JSON.stringify(value));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>typeof tree==='string'||typeof tree==='number'?String(tree):Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):'';
const native=createRequire(import.meta.url),fixtureUrl=new URL('./managed-products-panel.test.mjs',import.meta.url);
const source=fs.readFileSync(fixtureUrl,'utf8'),ast=ts.createSourceFile('fixture.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const factory=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='ui');assert.ok(factory);
// Use the existing real component factory while injecting only the child modal.
// The child is tested separately against its real API; these cases test parent
// ownership, callbacks and preservation without importing duplicate test cases.
const controlledRequire=name=>name==='@/app/components/managed-store-settings-panel'?{ManagedStoreSettingsPanel:function ManagedStoreSettingsPanel(){}}:native(name);
export const managedStoreIntegrationUI=vm.runInNewContext('('+factory.getText(ast).replaceAll('import.meta.url','fixtureUrl')+')',
 {fs,vm,ts,fixtureUrl,native:controlledRequire,nodes,text,assert,URL,URLSearchParams,FormData,AbortController,Error,queueMicrotask,setImmediate});
const field=(panel,label)=>{const value=nodes(panel.render()).find(node=>node.props?.['aria-label']===label);assert.ok(value,label);return value;};
const child=(panel,name)=>nodes(panel.render()).find(node=>node.type?.name===name);
const stores=panel=>child(panel,'ManagedStoreSettingsPanel');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const snapshot=h=>JSON.stringify(h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'managed_%' OR name IN ('settings','products','collection_jobs','supplier_hub_receipts')) ORDER BY name").all().map(({name})=>({name,rows:h.sqlite.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()})));
export async function managedStoreIntegrationFixture(company=companies[0],fetchWrapper){
 const h=managedProductHarness();Object.assign(h.state.user.membership,{companyCode:company.code,companyName:company.name});h.syncMember();
 const bytes=managedFixture(30,rows=>rows.forEach((row,index)=>{row['상품명']='합성 보관 상품 '+index;row['발주가능상태']=index%2?'품절':'정상';row['바코드']='00123'+index;row.otherSellers=JSON.stringify({hasOtherSellers:index%3===0,otherVendorNames:['저장한 판매자'],unknownSource:'retain'});row.priceHistory=JSON.stringify([{price:7000,date:'2026-10-10T00:00:00Z'}]);}));
 const preview=await(await h.submit(bytes,{companyCode:company.code})).json();assert.equal((await h.submit(bytes,{companyCode:company.code,action:'import',sha256:preview.sha256})).status,201);
 const panel=managedStoreIntegrationUI(fetchWrapper?fetchWrapper(h):h.fetcher);await panel.settle();
 return{h,panel,company,bytes,before:snapshot(h),close(){panel.close();h.close();}};
}
function readonly(f){assert.equal(snapshot(f.h),f.before);assert.equal(f.h.state.calls.filter(call=>call.method!=='GET').length,2,'only fixture preview/import occurred');assert.equal(f.panel.downloads.length,0);for(const table of ['products','collection_jobs','supplier_hub_receipts'])assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);}

for(const company of companies)test(`real parent opens only the current owned store-settings scope and old modal callbacks cannot close a new instance (${company.code})`,async()=>{
 const f=await managedStoreIntegrationFixture(company),{panel}=f;try{
  assert.equal(stores(panel),undefined);const calls=f.h.state.calls.length,open=panel.button('허용스토어설정').props.onClick;open();open();const first=stores(panel);assert.ok(first);assert.deepEqual(plain(first.props.company),company);assert.equal(first.props.accountContext,await f.h.load('app/managed-products.ts').managedProductAccountContext(f.h.state.user.userId,company));assert.equal(typeof first.props.onBusyChange,'function');assert.equal(f.h.state.calls.length,calls);
  first.props.onClose();assert.equal(stores(panel),undefined);panel.button('허용스토어설정').props.onClick();const second=stores(panel);assert.ok(second);first.props.onBusyChange(true);first.props.onClose();assert.ok(stores(panel));assert.equal(stores(panel).props.accountContext,second.props.accountContext);
  second.props.onClose();assert.equal(stores(panel),undefined);readonly(f);
 }finally{f.close();}
});

for(const company of companies)test(`pending or uncertain store save immediately locks retained list/import/export/filter and sibling callbacks (${company.code})`,async()=>{
 const f=await managedStoreIntegrationFixture(company),{panel}=f;try{
  const file=nodes(panel.render()).find(node=>node.type==='input'&&node.props.type==='file');file.props.onChange({target:{files:[new File([f.bytes],'합성DB.xlsx')]}});
  const retained={refresh:panel.button('목록 새로고침').props.onClick,download:panel.button('상품DB 다운로드').props.onClick,import:panel.button('매입정보 관리').props.onClick,upload:panel.button('파일 미리보기').props.onClick,purchase:field(panel,'SKU 1000000000 구매정보').props.onClick,barcode:field(panel,'SKU 1000000000 바코드출력').props.onClick,status:field(panel,'발주가능상태 필터').props.onClick,next:panel.button('다음').props.onClick,sort:field(panel,'판매가 정렬').props.onClick,pageSize:field(panel,'상품관리 페이지당 상품 수').props.onChange,filter:panel.button('타사매칭 10').props.onClick};
  panel.button('허용스토어설정').props.onClick();const dialog=stores(panel),calls=f.h.state.calls.length;dialog.props.onBusyChange(true);dialog.props.onClose();
  for(const [name,callback]of Object.entries(retained))callback(name==='pageSize'?{target:{value:'25'}}:undefined);await panel.settle();assert.ok(stores(panel));assert.equal(f.h.state.calls.length,calls);assert.equal(child(panel,'ManagedPurchaseInfoPanel'),undefined);assert.equal(child(panel,'ManagedImportPricesPanel'),undefined);assert.equal(child(panel,'ManagedProductBarcodePanel'),undefined);assert.equal(field(panel,'상품관리 페이지당 상품 수').props.value,10);assert.equal(field(panel,'판매가 정렬').props.children[1],'');
  assert.equal(nodes(panel.render()).find(node=>node.props?.['aria-label']==='발주가능상태 선택'),undefined,'retained status menu cannot open a second popup while a save is pending');
  assert.equal(panel.button('목록 새로고침').props.disabled,true);assert.equal(panel.button('상품DB 다운로드').props.disabled,true);assert.equal(panel.button('파일 미리보기').props.disabled,true);
  // An uncertain save reports busy until the child explicitly reconciles it.
  dialog.props.onClose();assert.ok(stores(panel));dialog.props.onBusyChange(false);dialog.props.onClose();assert.equal(stores(panel),undefined);readonly(f);
 }finally{f.close();}
});

test('idle store settings also preserve the draft while retained read/filter actions wait for explicit close',async()=>{
 const f=await managedStoreIntegrationFixture(),{panel}=f;try{
  const callbacks=[panel.button('다음').props.onClick,field(panel,'판매가 정렬').props.onClick,panel.button('타사매칭 10').props.onClick,panel.button('상품DB 다운로드').props.onClick];panel.button('허용스토어설정').props.onClick();const current=stores(panel),calls=f.h.state.calls.length;for(const callback of callbacks)callback();await panel.settle();assert.ok(stores(panel));assert.equal(f.h.state.calls.length,calls);current.props.onClose();assert.equal(stores(panel),undefined);
  panel.button('다음').props.onClick();await panel.settle();assert.match(text(panel.render()),/2 \/ 3/);readonly(f);
 }finally{f.close();}
});

test('store settings cannot discard an open purchase, import-price or barcode editor including same-tick captured callbacks',async()=>{
 for(const sibling of ['purchase','import','row-import','barcode']){const f=await managedStoreIntegrationFixture(),{panel}=f;try{
  const open=panel.button('허용스토어설정').props.onClick,button=sibling==='purchase'?field(panel,'SKU 1000000000 구매정보'):sibling==='barcode'?field(panel,'SKU 1000000000 바코드출력'):sibling==='row-import'?field(panel,'SKU 1000000000 매입관리'):panel.button('매입정보 관리');button.props.onClick();open();await panel.settle();assert.equal(stores(panel),undefined);const editor=child(panel,sibling==='purchase'?'ManagedPurchaseInfoPanel':sibling==='barcode'?'ManagedProductBarcodePanel':'ManagedImportPricesPanel');assert.ok(editor);editor.props.onClose();assert.equal(stores(panel),undefined);
  const retainedSibling=button.props.onClick;panel.button('허용스토어설정').props.onClick();retainedSibling();await panel.settle();assert.ok(stores(panel));assert.equal(child(panel,sibling==='purchase'?'ManagedPurchaseInfoPanel':sibling==='barcode'?'ManagedProductBarcodePanel':'ManagedImportPricesPanel'),undefined);readonly(f);
 }finally{f.close();}}
});

test('explicit close then refresh binds the next same-company owner or another company and invalidates prior store callbacks',async()=>{
 for(const boundary of ['owner','company']){const f=await managedStoreIntegrationFixture(),{panel,h}=f;try{
  panel.button('허용스토어설정').props.onClick();const old=stores(panel),oldOpen=panel.button('허용스토어설정').props.onClick;old.props.onClose();
  if(boundary==='owner'){h.state.user={...h.state.user,userId:'same-company-next-store-owner',membership:{...h.state.user.membership,id:'same-company-next-store-owner'}};}else Object.assign(h.state.user.membership,{companyCode:companies[1].code,companyName:companies[1].name});h.syncMember();
  panel.button('목록 새로고침').props.onClick();oldOpen();await panel.settle();assert.equal(stores(panel),undefined);assert.ok(!text(panel.render()).includes('합성 보관 상품'));panel.button('허용스토어설정').props.onClick();const fresh=stores(panel);assert.ok(fresh);assert.notEqual(fresh.props.accountContext,old.props.accountContext);assert.equal(fresh.props.company.code,boundary==='owner'?companies[0].code:companies[1].code);old.props.onBusyChange(true);old.props.onClose();assert.ok(stores(panel));assert.equal(panel.button('목록 새로고침').props.disabled,false);fresh.props.onClose();readonly(f);
 }finally{f.close();}}
});

test('a delayed old list cannot publish the previous owner or allow a retained settings-open callback during a newer read',async()=>{
 let hold=false,wait=deferred(),held;
 const f=await managedStoreIntegrationFixture(companies[0],h=>async(url,init)=>{const response=await h.fetcher(url,init);if(hold&&url.startsWith('/api/managed-products?')){hold=false;held=init.signal;await wait.promise;}return response;}),{panel,h}=f;try{
  const oldOpen=panel.button('허용스토어설정').props.onClick;hold=true;panel.button('목록 새로고침').props.onClick();await panel.settle();oldOpen();assert.equal(stores(panel),undefined);
  h.state.user={...h.state.user,userId:'new-owner-with-late-list',membership:{...h.state.user.membership,id:'new-owner-with-late-list'}};h.syncMember();panel.button('목록 새로고침').props.onClick();await panel.settle();assert.equal(held.aborted,true);assert.ok(!text(panel.render()).includes('합성 보관 상품'));wait.resolve();await panel.settle();assert.ok(!text(panel.render()).includes('합성 보관 상품'));oldOpen();assert.equal(stores(panel),undefined);panel.button('허용스토어설정').props.onClick();assert.ok(stores(panel));assert.equal(stores(panel).props.company.code,companies[0].code);readonly(f);
 }finally{wait.resolve();f.close();}
});
