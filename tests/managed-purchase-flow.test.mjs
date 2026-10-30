import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {managedProductHarness,managedFixture} from './helpers/managed-products.mjs';

const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>typeof tree==='string'||typeof tree==='number'?String(tree):Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):'';
const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};

/** Execute the actual parent and purchase editor against the disposable API.
 * Layout effects commit before handlers are inspected; no remote browser,
 * supplier request, test-module import or mirrored purchase resolver is used. */
function purchaseUI(h){
 const stores=new Map(),cache=new Map(),effects=[],layouts=[];let active=null,cursor=0,depth=0,visited,epoch=0,pendingRequests=0;
 const hook=(initial,factory=false)=>{const slot=cursor++;if(!(slot in active.slots))active.slots[slot]=factory?initial():initial;return slot;};
 const effect=(queue,fn,deps)=>{const slot=cursor++,previous=active.slots[slot],owner=active;if(!previous||!deps||deps.some((value,index)=>value!==previous[index])){active.slots[slot]=deps;queue.push({depth,run(){owner.cleanups.get(slot)?.();owner.cleanups.set(slot,fn());}});}};
 const hooks={
  useState(initial){const owner=active,slot=hook(initial,typeof initial==='function');return[owner.slots[slot],value=>{epoch++;owner.slots[slot]=typeof value==='function'?value(owner.slots[slot]):value;}];},
  useRef(initial){const slot=hook({current:initial});return active.slots[slot];},
  useMemo(fn,deps){const slot=cursor++,previous=active.slots[slot];if(!previous||deps.some((value,index)=>value!==previous.deps[index]))active.slots[slot]={deps,value:fn()};return active.slots[slot].value;},
  useCallback(fn,deps){return hooks.useMemo(()=>fn,deps);},
  useLayoutEffect(fn,deps){effect(layouts,fn,deps);},useEffect(fn,deps){effect(effects,fn,deps);},
 };
 const request=async(url,init={})=>{
  pendingRequests++;
  try{
  const parsed=new URL(url,'https://app.test'),match=/^\/api\/managed-products\/([^/]+)\/purchase-info$/.exec(parsed.pathname);
  if(!match)return await h.fetcher(url,init);
  h.state.calls.push({url,method:init.method??'GET'});
  return await h.load('app/api/managed-products/[skuId]/purchase-info/route.ts')[init.method??'GET'](new Request(parsed,init),{params:Promise.resolve({skuId:decodeURIComponent(match[1])})});
  }finally{pendingRequests--;}
 };
 const load=file=>{
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,URL,URLSearchParams,FormData,File,Blob,AbortController,Error,structuredClone,queueMicrotask,setTimeout,clearTimeout,fetch:request,require(name){
   if(name==='react')return hooks;
   if(name==='@/app/components/use-menu-dismissal')return{usePopupDismissal(){}};
   if(name==='@/app/components/managed-import-prices-panel')return{ManagedImportPricesPanel:()=>null};
   if(name==='@/app/components/managed-product-barcode-panel')return{ManagedProductBarcodePanel:()=>null};
   if(name==='@/app/components/managed-store-settings-panel')return{ManagedStoreSettingsPanel:()=>null};
   if(name.endsWith('.css'))return{};
   if(name.startsWith('@/app/components/'))return load(name.slice(2)+'.tsx');
   if(name.startsWith('@/'))return h.load(name.slice(2)+'.ts');
   return native(name);
  }});return exports;
 };
 const component=load('app/components/managed-products-panel.tsx').ManagedProductsPanel;
 const expand=(value,path='root')=>{
  if(Array.isArray(value))return value.map((item,index)=>expand(item,path+'/'+(item?.key??index)));
  if(!value||typeof value!=='object')return value;
  if(typeof value.type==='function'){
   const key=path+':'+value.type.name;visited.add(key);let store=stores.get(key);if(!store){store={slots:[],cleanups:new Map()};stores.set(key,store);}
   const before=active,beforeCursor=cursor;active=store;cursor=0;depth++;const output=value.type(value.props);const rendered=expand(output,path+'/render');depth--;active=before;cursor=beforeCursor;return rendered;
  }
  return{...value,props:{...value.props,children:expand(value.props?.children,path+'/children')}};
 };
 const render=()=>{
  visited=new Set();const tree=expand({type:component,props:{}});
  for(const [key,store]of stores)if(!visited.has(key)){for(const cleanup of store.cleanups.values())cleanup?.();stores.delete(key);}
  for(const queue of [layouts,effects]){queue.sort((left,right)=>right.depth-left.depth);while(queue.length)queue.shift().run();}
  return tree;
 };
 return{render,request,async settle(){let quiet=0;const deadline=Date.now()+10000;while(quiet<3){const before=epoch;render();await new Promise(resolve=>setTimeout(resolve,2));render();quiet=before===epoch&&!pendingRequests?quiet+1:0;if(Date.now()>deadline)throw Error('purchase workflow UI did not settle');}},close(){for(const store of stores.values())for(const cleanup of store.cleanups.values())cleanup?.();},button(label){const button=nodes(render()).find(node=>node.type==='button'&&text(node)===label);assert.ok(button,'missing actual UI action '+label);return button;}};
}

// The completed source record below models the observed status contract only.
// It is synthetic and never establishes a real purchase, supplier match or Hub receipt.
for(const company of companies)test(`owned purchase edits flow through the actual UI, incomplete filter and XLSX while surviving a source refresh (${company.code})`,async()=>{
 const h=managedProductHarness();Object.assign(h.state.user.membership,{companyCode:company.code,companyName:company.name});h.syncMember();let ui;
 const sourceEntry={'상품명':'원본 완료 제품','상품명init':'원본 완료 제품','바코드':'001002','구매링크':'https://sourcing.example.test/original','구매링크init':'https://sourcing.example.test/original',
  '옵션1_중국어':'原色','옵션2_중국어':'小号','판매구성수량':1,'매칭상태':'매칭완료','요청사항':'등록완료',
  '요청내역':{customsType:'integrated',barcode:false,reqcontent:'원본 요청',providerExtension:{literal:'',zero:0,flag:false}},
  '한글표시사항':{'제품명':'원본 완료 제품','제조국':'중국',providerExtension:['',0,false]},providerExtension:{array:['=1+1','',0,false],nested:{literal:'원문'}}};
 const bytes=managedFixture(2,rows=>{rows[0]['구매정보']='';rows[0]['바코드']='001001';rows[1]['구매정보']=JSON.stringify([sourceEntry]);rows[1]['구매정보여부']='true';rows[1]['바코드']='001002';});
 const importFile=async file=>{const preview=await json(await h.submit(file,{companyCode:company.code}));return json(await h.submit(file,{companyCode:company.code,action:'import',sha256:preview.sha256,accountContext:preview.accountContext}),201);};
 const originals=()=>JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products ORDER BY sku_id').all());
 const sidecars=()=>JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_purchase_info ORDER BY sku_id').all());
 try{
  await importFile(bytes);ui=purchaseUI(h);await ui.settle();
  const list=await json(await ui.request('/api/managed-products?page=1&pageSize=10&filter=all'));
  assert.equal(list.summary.noPurchase,1);
  const read=async skuId=>json(await ui.request(`/api/managed-products/${skuId}/purchase-info?expectedAccountContext=${list.accountContext}`));
  const before=originals(),empty=await read('1000000000');assert.deepEqual(empty.purchaseInfo,[]);assert.deepEqual(empty.originalPurchaseInfo,[]);assert.equal(empty.revision,0);
  const find=label=>{const value=nodes(ui.render()).find(node=>node.props?.['aria-label']===label);assert.ok(value,'missing actual UI control '+label);return value;};
  const open=async skuId=>{find(`SKU ${skuId} 구매정보`).props.onClick();await ui.settle();assert.ok(nodes(ui.render()).some(node=>node.props?.role==='dialog'&&node.props['aria-label']==='구매정보'));};
  await open('1000000000');assert.equal(originals(),before,'opening and preparing a new entry never rewrites the supplier DB');
  ui.button('+ 추가').props.onClick();find('구매정보 1 구매링크').props.onChange({target:{value:'https://sourcing.example.test/manually-selected'}});
  find('구매정보 1 옵션1_중국어').props.onChange({target:{value:'透明'}});
  const save=ui.button('저장');assert.equal(save.props.disabled,false);save.props.onClick();save.props.onClick();await ui.settle();
  assert.equal(nodes(ui.render()).some(node=>node.props?.role==='dialog'&&node.props['aria-label']==='구매정보'),false,nodes(ui.render()).filter(node=>node.props?.role==='alert').map(text).join(';')||'an exactly confirmed save refreshes the parent list');
  const first=await read('1000000000');assert.equal(first.revision,1);assert.equal(first.purchaseInfo[0]['구매링크'],'https://sourcing.example.test/manually-selected');assert.equal(first.purchaseInfo[0]['옵션1_중국어'],'透明');assert.equal(first.purchaseInfoComplete,false,'manual text is not a fabricated completed supplier match');assert.equal(originals(),before);
  assert.equal(h.state.calls.filter(call=>call.method==='PUT'&&call.url.includes('/purchase-info')).length,1,'one explicit click and its duplicate callback produce one save');
  let incomplete=await json(await ui.request('/api/managed-products?page=1&pageSize=10&filter=no-purchase'));
  assert.equal(incomplete.summary.noPurchase,1);assert.deepEqual(incomplete.products.map(product=>product.skuId),['1000000000']);
  const completed=await read('1000000001');assert.equal(completed.purchaseInfoComplete,true);
  await open('1000000001');find('구매정보 1 상품명').props.onChange({target:{value:company.name+' 직접 수정 제품'}});
  ui.button('저장').props.onClick();await ui.settle();
  assert.equal(nodes(ui.render()).some(node=>node.props?.role==='dialog'&&node.props['aria-label']==='구매정보'),false,nodes(ui.render()).filter(node=>node.props?.role==='alert').map(text).join(';')||'server and editor agree on the changed request review state');
  let second=await read('1000000001');assert.equal(second.revision,1);assert.equal(second.purchaseInfo[0]['상품명'],company.name+' 직접 수정 제품');
  assert.equal(second.purchaseInfo[0]['매칭상태'],'매칭완료');assert.equal(second.purchaseInfo[0]['요청사항'],'등록완료');assert.equal(second.purchaseInfoComplete,true,'a title-only edit preserves the unchanged recorded matching and request facts');
  assert.deepEqual(second.purchaseInfo[0].providerExtension,sourceEntry.providerExtension);assert.deepEqual(second.purchaseInfo[0]['요청내역'],sourceEntry['요청내역']);assert.deepEqual(second.purchaseInfo[0]['한글표시사항'],sourceEntry['한글표시사항']);
  assert.deepEqual(second.originalPurchaseInfo,[sourceEntry]);assert.equal(originals(),before,'purchase saves preserve all original price, barcode, source SHA and raw rows');
  incomplete=await json(await ui.request('/api/managed-products?page=1&pageSize=10&filter=no-purchase'));assert.equal(incomplete.summary.noPurchase,1);assert.deepEqual(incomplete.products.map(product=>product.skuId),['1000000000']);
  await open('1000000001');find('구매정보 1 구매링크').props.onChange({target:{value:'https://sourcing.example.test/review-again'}});ui.button('저장').props.onClick();await ui.settle();
  assert.equal(nodes(ui.render()).some(node=>node.props?.role==='dialog'&&node.props['aria-label']==='구매정보'),false,nodes(ui.render()).filter(node=>node.props?.role==='alert').map(text).join(';')||'a changed source link is accepted as explicitly unverified matching');
  second=await read('1000000001');assert.equal(second.revision,2);assert.equal(second.purchaseInfo[0]['구매링크'],'https://sourcing.example.test/review-again');assert.equal(second.purchaseInfo[0]['매칭상태'],'매칭필요');assert.equal(second.purchaseInfoComplete,false);
  assert.deepEqual(second.purchaseInfo[0].providerExtension,sourceEntry.providerExtension);assert.deepEqual(second.purchaseInfo[0]['요청내역'],sourceEntry['요청내역']);assert.deepEqual(second.purchaseInfo[0]['한글표시사항'],sourceEntry['한글표시사항']);assert.equal(originals(),before);
  incomplete=await json(await ui.request('/api/managed-products?page=1&pageSize=10&filter=no-purchase'));
  assert.equal(incomplete.summary.noPurchase,2);assert.deepEqual(incomplete.products.map(product=>product.skuId),['1000000000','1000000001']);
  const download=await ui.request(`/api/managed-products/export?filter=all&expectedAccountContext=${list.accountContext}`);assert.equal(download.status,200,await download.clone().text());
  assert.equal(download.headers.get('x-managed-account-context'),list.accountContext);
  const backup=await download.arrayBuffer(),reader=h.load('app/xlsx-template.ts'),book=reader.inspectXlsxArchive(await reader.readXlsxArchive(backup));
  assert.equal(book.sheets[0].name,'로켓배송상품DB');const headers=book.sheets[0].rows[0].values;
  const exported=book.sheets[0].rows.slice(1).map(row=>{const values=Object.fromEntries(headers.map((key,index)=>[key,row.values[index]??'']));return{skuId:values.SKUID,values};});
  assert.equal(exported.length,2);for(const saved of [first,second]){
   const row=exported.find(row=>row.skuId===saved.skuId);assert.ok(row);assert.deepEqual(JSON.parse(row.values['YOOFAM 적용 구매정보']),saved.purchaseInfo);assert.equal(row.values['YOOFAM 구매정보 기준시각'],saved.updatedAt);
   assert.equal(row.values['구매정보'],saved.skuId==='1000000000'?'':JSON.stringify([sourceEntry]),'the original purchase cell remains separate and byte-exact');
   assert.equal(row.values['판매가'],'15000');assert.equal(row.values['공급가'],'8000');assert.equal(row.values['회사코드'],company.code);
  }
  const overlayBytes=sidecars();
  await json(await h.submit(backup,{companyCode:company.code}),400);assert.equal(originals(),before);assert.equal(sidecars(),overlayBytes,'a read-only backup cannot accidentally become new supplier source data');
  const refreshedEntry={...sourceEntry,'상품명':'나중에 받은 원본 제품','상품명init':'나중에 받은 원본 제품',providerExtension:{sourceRevision:2}};
  const refreshed=managedFixture(2,rows=>{rows[0]['구매정보']=JSON.stringify([refreshedEntry]);rows[0]['바코드']='001001';rows[1]['구매정보']=JSON.stringify([refreshedEntry]);rows[1]['구매정보여부']='true';rows[1]['바코드']='001002';rows[1]['상품명']='갱신한 원본 제목';rows[1]['공급가']='9000';});
  const refreshedResult=await importFile(refreshed);assert.equal(refreshedResult.counts.updated,2);assert.equal(sidecars(),overlayBytes,'an original-source refresh never overwrites either explicitly saved purchase row');
  const afterFirst=await read('1000000000'),afterSecond=await read('1000000001');
  assert.deepEqual(afterFirst.purchaseInfo,first.purchaseInfo);assert.deepEqual(afterSecond.purchaseInfo,second.purchaseInfo);assert.deepEqual(afterSecond.originalPurchaseInfo,[refreshedEntry]);
  assert.notEqual(afterSecond.sourceVersion,second.sourceVersion);assert.notEqual(afterSecond.inputFingerprint,second.inputFingerprint);assert.equal(afterSecond.product.title,'갱신한 원본 제목');
  const refreshedRaw=originals();await json(await ui.request('/api/managed-products/1000000001/purchase-info',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedAccountContext:second.accountContext,expectedRevision:second.revision,expectedInputFingerprint:second.inputFingerprint,purchaseInfo:second.purchaseInfo})}),409);
  assert.equal(sidecars(),overlayBytes);assert.equal(originals(),refreshedRaw);
  ui.button('목록 새로고침').props.onClick();await ui.settle();
  const noPurchaseButton=nodes(ui.render()).find(node=>node.type==='button'&&text(node).startsWith('구매정보없음'));assert.ok(noPurchaseButton);noPurchaseButton.props.onClick();await ui.settle();
  assert.deepEqual(nodes(ui.render()).filter(node=>node.type==='tr'&&node.props['data-sku-id']).map(node=>node.props['data-sku-id']),['1000000000','1000000001']);
  await open('1000000001');assert.equal(find('구매정보 1 상품명').props.value,company.name+' 직접 수정 제품');find('구매정보 닫기').props.onClick();await ui.settle();
  assert.equal(sidecars(),overlayBytes);assert.equal(originals(),refreshedRaw);
  for(const table of ['products','collection_jobs','supplier_hub_receipts'])assert.equal(h.sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count,0,'management editing has no sourcing or transmission side effects');
 }finally{ui?.close();h.close();}
});
