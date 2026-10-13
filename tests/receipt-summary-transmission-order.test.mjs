import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';

const native=createRequire(import.meta.url);
const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const digest=async bytes=>Buffer.from(await webcrypto.subtle.digest('SHA-256',bytes)).toString('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64');
const plain=value=>JSON.parse(JSON.stringify(value));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):typeof tree==='boolean'?'':String(tree??'');

/** Real local queue intake, saved draft and receipt handlers. All supplier facts
 * and file bytes are synthetic; the harness rejects unconfigured networking. */
async function fixture(company){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
 try{
  const fields=['skuId','categoryId',...h.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field=>field.id)];
  const workbook=new Uint8Array(quotationWorkbook(fields)),sha256=await digest(workbook),storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');
  await h.bindings.FILES.put(storageKey,workbook,{customMetadata:{sha256,format:'xlsx'}});
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'합성 최신 전송 순서 검수',categoryId:'80719',categoryPath:h.context.category.categoryPath,
   template:{name:'synthetic-receipt-order.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
  const sourceUrl='https://detail.1688.com/offer/639000000001.html';
  h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=? WHERE id=?').run('639000000001',sourceUrl,'job');
  await json(await h.route('/api/collection-jobs/job/result',{method:'POST',body:{schemaVersion:1,sourceUrl,provider:'synthetic-step639-order',collectedAt:new Date().toISOString(),
   title:'Synthetic reviewed product',description:'Synthetic source description',attributes:[],options:Array.from({length:6},(_,i)=>({sku:'SYNTHETIC-639-'+i,name:'Synthetic option '+i,unitPriceCny:5,minimumOrder:1,stock:3})),images:[]}}));
  await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,keys=[];
  for(const [index,role]of ['main','additional','detail','label'].entries()){
   const key='owner/synthetic639-'+role+'.png',bytes=Buffer.concat([png,Buffer.from([index])]);
   await h.bindings.FILES.put(key,bytes,{httpMetadata:{contentType:'image/png'},customMetadata:{sha256:await digest(bytes)}});keys.push(key);
  }
  await h.load('db/queries.ts').updateProduct('owner',product.id,{image_keys:JSON.stringify(keys)},product.updated_at);
  const content=(await json(await h.route(base+'/content'))).content;
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:company.name+' 원래 검토 상품'},
   label:{model:'SYNTHETIC-639',material:'검토한 합성 재질'},assets:{main:[keys[0]],additional:[keys[1]],detail:[keys[2]],label:[keys[3]]}}}}));
  const view=await json(await h.route(base+'/quotation-fields'));
  await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[
   {fieldKey:'handlingReason',optionId:null,value:'해당사항없음'},{fieldKey:'packagedWeightG',optionId:null,value:'420'},
   {fieldKey:'packagedDimensionsMm',optionId:null,value:'100*200*300'},{fieldKey:'storageMaterial',optionId:null,value:''},
  ]}}));
  const preview=()=>h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}).then(json);
  const write=(value,result,action)=>h.route(base+'/supplier-hub-receipt',{method:'POST',body:{...(action?{action}:{}),profileId:profile.id,categoryId:'80719',fingerprint:value.fingerprint,result}});
  const read=fingerprint=>h.route(base+'/supplier-hub-receipt?fingerprint='+fingerprint).then(json);
  const list=()=>h.load('app/api/products/route.ts').GET().then(json);
  // Receipt refreshes may change only receipts. Capture every other application
  // table as well as the immutable R2 bytes and their metadata.
  const retained=()=>JSON.stringify({tables:Object.fromEntries(h.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('supplier_hub_receipts','product_removals') ORDER BY name").all()
   .map(({name})=>[name,h.sqlite.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()])),files:[...h.objects].map(([key,bytes])=>[key,[...bytes]])});
  const fileSnapshot=async()=>JSON.stringify(await Promise.all([...h.objects].map(async([key,bytes])=>[key,[...bytes],await h.bindings.FILES.head(key)])));
  return{...h,product,base,preview,write,read,list,retained,fileSnapshot};
 }catch(error){h.close();throw error;}
}

/** Run the actual board and its event handlers; no replica of status or filter
 * logic is used to decide which received quotation the operator sees. */
function board(products){
 const slots=[],cache=new Map();let cursor=0;
 const hooks={...native('react'),useState(initial){const at=cursor++;if(!(at in slots))slots[at]=typeof initial==='function'?initial():initial;return[slots[at],next=>{slots[at]=typeof next==='function'?next(slots[at]):next;}];},
  useRef(initial){const at=cursor++;if(!(at in slots))slots[at]={current:initial};return slots[at];}};
 function load(file){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
   {exports,URL,Date,Error,window:{innerWidth:1600,innerHeight:900},require(name){if(name==='react')return hooks;if(!name.startsWith('@/'))return native(name);
    const base=name.slice(2),file=['.ts','.tsx'].map(extension=>base+extension).find(candidate=>fs.existsSync(new URL('../'+candidate,import.meta.url)));assert.ok(file,name);return load(file);}});
  return exports;
 }
 const boardModule=load('app/components/registration-board.tsx');
 const render=()=>{cursor=0;return boardModule.RegistrationBoard({products,selected:new Set(),onSelected(){},onOpen(){},onDelete:async()=>assert.fail('board inspection may not delete'),loading:false,error:'',onArchive(){}});};
 const control=label=>{const target=nodes(render()).find(node=>node.props?.['aria-label']===label);assert.ok(target,label);return target;};
 const cells=()=>nodes(render()).filter(node=>node.type==='td'&&node.props['data-column']==='status');
 return{render,cells,module:boardModule,filter(value){control('등록 상태 필터').props.onChange({target:{value}});},columnFilter(values){
  control('등록상태 열 필터').props.onClick({currentTarget:{getBoundingClientRect:()=>({left:100,bottom:100})}});
  const popup=nodes(render()).find(node=>node.props?.label==='등록상태'&&typeof node.props.onApply==='function');assert.ok(popup);
  popup.props.onApply({mode:'values',values});
 }};
}

for(const company of companies)test(`latest transmitted draft remains selected after older rejected receipt refreshes and UPSERTs (${company.code})`,async()=>{
 const f=await fixture(company);
 try{
  let a=await f.preview();
  // Keep both ordering directions well inside the hash range. These previews
  // come from actual saved content, never a forged fingerprint or receipt.
  for(let index=0;a.fingerprint<'8'&&index<128;index++){
   const content=(await json(await f.route(f.base+'/content'))).content;
   await json(await f.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:company.name+' 원래 검토 상품 '+index}}}}));
   a=await f.preview();
  }
  assert.ok(a.fingerprint>='8');assert.equal(a.submissionReview.errorCount,0,JSON.stringify(a.submissionReview.issues));
  const at=Date.now()-10000,rejected={state:'validation-rejected',filename:a.filename,company,includedOptions:6,quotationId:'',status:'검증 실패',observedAt:at,registered:false};
  await json(await f.write(a,rejected));
  const rowIds=()=>f.sqlite.prepare('SELECT fingerprint,rowid AS first_insert FROM supplier_hub_receipts ORDER BY rowid').all();
  const originalA=rowIds()[0],beforeUpset=(await f.read(a.fingerprint)).receipt;
  // Normal repeated receipt storage takes the real ON CONFLICT DO UPDATE path.
  await json(await f.write(a,{...rejected,observedAt:at+100,status:'검증 실패 재확인'}));
  await json(await f.write(a,{...rejected,observedAt:at+100,status:'검증 실패 재확인'}));
  assert.deepEqual(rowIds(),[originalA]);assert.equal((await f.read(a.fingerprint)).receipt.result.observedAt,at+100);
  assert.equal((await f.read(a.fingerprint)).receipt.productVersion,beforeUpset.productVersion);
  let history=await json(await f.route(f.base+'/supplier-hub-receipt?mode=history'));assert.equal(history.history.blocked,false,'an ID-free file rejection really permits a corrected draft');
  // Produce a genuine reviewed B whose hash sorts before A, so a tied clock
  // cannot accidentally pass because of the old fingerprint tie-breaker.
  let b;
  for(let index=0;index<128;index++){
   const content=(await json(await f.route(f.base+'/content'))).content;
   await json(await f.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:company.name+' 수정 검토 상품 '+index}}}}));
   b=await f.preview();if(b.fingerprint<a.fingerprint)break;
  }
  assert.ok(b.fingerprint<a.fingerprint,'the source-generated hashes must oppose insertion order');assert.equal(b.submissionReview.errorCount,0);
  const quotationId='SYNTHETIC-639-ACCEPTED-'+company.code;
  const registration={quotationId,scope:'queried-pages',pagesRead:1,hasMore:false,includedOptions:6,observedAt:at+1000,registered:false,
   rows:Array.from({length:6},(_,i)=>({title:'검토 옵션 '+i,submittedAt:'2026-10-13',category:'합성 카테고리',barcode:'',sourceQuotation:b.filename,skuId:'639-SKU-'+i,status:'상품 검수중',stage:'상품 검수'}))};
  const accepted={state:'validation-complete',filename:b.filename,company,includedOptions:6,quotationId,status:'검증 완료',observedAt:at+1000,registered:false,registration};
  await json(await f.write(b,accepted));const inserted=rowIds();assert.equal(inserted.length,2);assert.deepEqual(inserted[0],originalA);assert.equal(inserted[1].fingerprint,b.fingerprint);
  const retained=f.retained(),files=await f.fileSnapshot(),savedB=(await f.read(b.fingerprint)).receipt;
  const verifyLatest=async()=>{
   const products=(await f.list()).products;assert.equal(products.length,1);const product=products[0],summary=product.hub_receipt;
   assert.equal(summary.fingerprint,b.fingerprint);assert.equal(summary.label,'SKU ID 확인');assert.equal(summary.quotationId,quotationId);assert.equal(summary.issuedSkus,6);assert.equal(summary.company.code,company.code);
   const ui=board(products);assert.equal(ui.module.registrationTransmissionLabel(product),'SKU ID 확인');assert.equal(ui.cells().length,1);assert.ok(text(ui.cells()[0]).includes(quotationId));
   assert.equal(nodes(ui.render()).find(node=>node.type==='button'&&node.props.className==='registration-delete').props.disabled,true,'latest accepted receipt remains deletion-locked');
   ui.filter('파일 반려');assert.equal(ui.cells().length,0);ui.filter('SKU ID 확인');assert.equal(ui.cells().length,1);ui.filter('전체');
   ui.columnFilter(['파일 반려']);assert.equal(ui.cells().length,0);ui.columnFilter(['SKU ID 확인']);assert.equal(ui.cells().length,1);
   const single=await f.load('app/api/products/[id]/route.ts').GET(new Request('https://app.test'+f.base),{params:Promise.resolve({id:f.product.id})}).then(json);assert.deepEqual(single.product.hub_receipt,summary);
   assert.equal(f.retained(),retained);assert.equal(await f.fileSnapshot(),files);assert.deepEqual(rowIds(),inserted);return summary;
  };
  await verifyLatest();
  // A is no longer the current reviewed fingerprint: current-source writes
  // must still fail instead of replaying an obsolete draft as a new receipt.
  assert.equal((await f.write(a,{...rejected,observedAt:at+2000})).status,409);assert.deepEqual(rowIds(),inserted);
  const refreshed={...rejected,observedAt:at+2000,status:'원래 파일 반려 재확인'};
  await json(await f.write(a,refreshed,'observe-history'));await verifyLatest();
  assert.deepEqual(plain((await f.read(a.fingerprint)).receipt.result),plain(refreshed));
  history=await json(await f.route(f.base+'/supplier-hub-receipt?mode=history'));
  assert.equal(history.history.receipts[0].fingerprint,a.fingerprint,'history deliberately retains newest-observation ordering');assert.equal(history.history.blocked,true);
  await json(await f.write(a,{...refreshed,observedAt:at+3000,status:'원래 파일 반려 반복 조회'},'observe-history'));await verifyLatest();
  assert.equal((await f.read(a.fingerprint)).receipt.result.observedAt,at+3000);assert.deepEqual(plain((await f.read(b.fingerprint)).receipt),plain(savedB));
  // Both receipts now have exactly the same observation time and A's hash sorts
  // higher. Only the immutable first-INSERT order may choose B.
  await json(await f.write(b,{...accepted,observedAt:at+3000,registration:{...registration,observedAt:at+3000}}));
  assert.equal((await f.read(a.fingerprint)).receipt.result.observedAt,(await f.read(b.fingerprint)).receipt.result.registration.observedAt);await verifyLatest();
  const db=f.load('db/supplier-hub-receipts.ts');assert.deepEqual(plain(await db.readSupplierHubReceiptSummaries('other-owner',[f.product])),{});
  assert.equal(await db.readSupplierHubReceipt('other-owner',f.product.id,b.fingerprint),null);
  assert.deepEqual(plain((await db.readSupplierHubTransmissionHistory('other-owner',f.product.id)).receipts),[]);
  const current=f.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(f.product.id),remove=await f.load('app/api/products/[id]/route.ts').DELETE(new Request('https://app.test'+f.base,{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({expectedVersion:current.updated_at})}),{params:Promise.resolve({id:f.product.id})});
  assert.equal(remove.status,409);assert.equal(f.sqlite.prepare('SELECT count(*) AS count FROM product_removals').get().count,0);
  assert.equal(f.retained(),retained);assert.equal(await f.fileSnapshot(),files);assert.deepEqual(rowIds(),inserted);assert.deepEqual(f.network,[]);
 }finally{f.close();}
});
