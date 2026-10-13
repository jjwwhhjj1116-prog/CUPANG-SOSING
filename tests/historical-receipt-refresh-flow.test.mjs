import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';

const native=createRequire(import.meta.url),origin='https://sourceflow.jjwwhhjj1116.workers.dev';
const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const digest=async bytes=>Buffer.from(await webcrypto.subtle.digest('SHA-256',bytes)).toString('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64');

async function fixture(company){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
 const fields=['skuId','categoryId',...h.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field=>field.id)],workbook=new Uint8Array(quotationWorkbook(fields)),sha256=await digest(workbook),storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');
 await h.bindings.FILES.put(storageKey,workbook,{customMetadata:{sha256,format:'xlsx'}});
 const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'합성 이전 접수 조회 검수',categoryId:'80719',categoryPath:h.context.category.categoryPath,template:{name:'historical-review.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
 h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
 const sourceUrl='https://detail.1688.com/offer/634000000001.html';h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=? WHERE id=?').run('634000000001',sourceUrl,'job');
 await json(await h.route('/api/collection-jobs/job/result',{method:'POST',body:{schemaVersion:1,sourceUrl,provider:'synthetic-step634-history',collectedAt:new Date().toISOString(),title:'Synthetic review product',description:'Synthetic source description',attributes:[],options:Array.from({length:6},(_,i)=>({sku:'SYNTHETIC-634-'+i,name:'Synthetic option '+i,unitPriceCny:5,minimumOrder:1,stock:3})),images:[]}}));await h.intake();
 let product=h.sqlite.prepare('SELECT * FROM products').get();const base='/api/products/'+product.id,keys=[];
 for(const [index,role]of ['main','additional','detail','label'].entries()){const key='owner/synthetic634-'+role+'.png',bytes=Buffer.concat([png,Buffer.from([index])]);await h.bindings.FILES.put(key,bytes,{httpMetadata:{contentType:'image/png'},customMetadata:{sha256:await digest(bytes)}});keys.push(key);}
 await h.load('db/queries.ts').updateProduct('owner',product.id,{image_keys:JSON.stringify(keys)},product.updated_at);product=h.sqlite.prepare('SELECT * FROM products').get();
 let content=(await json(await h.route(base+'/content'))).content;
 await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:company.name+' 원래 검토 상품'},label:{model:'SYNTHETIC-634',material:'검토한 합성 재질'},assets:{main:[keys[0]],additional:[keys[1]],detail:[keys[2]],label:[keys[3]]}}}}));
 const view=await json(await h.route(base+'/quotation-fields'));
 await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:'handlingReason',optionId:null,value:'해당사항없음'},{fieldKey:'packagedWeightG',optionId:null,value:'420'},{fieldKey:'packagedDimensionsMm',optionId:null,value:'100*200*300'},{fieldKey:'storageMaterial',optionId:null,value:''}]}}));
 const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));assert.equal(preview.submissionReview.errorCount,0,JSON.stringify(preview.submissionReview.issues));
 const observedAt=Date.now(),quotationId='SYNTHETIC-634-QUOTE-'+company.code,result={state:'validation-complete',filename:preview.filename,company,includedOptions:6,quotationId,status:'검증 완료',observedAt,registered:false,registration:{quotationId,scope:'queried-pages',pagesRead:2,hasMore:false,includedOptions:6,observedAt,registered:false,rows:Array.from({length:6},(_,i)=>({title:'원래 검토 옵션 '+i,submittedAt:'2026-10-13',category:'합성 카테고리',barcode:'',sourceQuotation:preview.filename,skuId:'634-ISSUED-'+i,status:'상품 검수중',stage:'상품 검수'}))}};
 await json(await h.route(base+'/supplier-hub-receipt',{method:'POST',body:{profileId:profile.id,categoryId:'80719',fingerprint:preview.fingerprint,result}}));
 const receipt=(await json(await h.route(base+'/supplier-hub-receipt?fingerprint='+preview.fingerprint))).receipt;
 content=(await json(await h.route(base+'/content'))).content;
 await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:company.name+' 수정한 현재 상품',description:'현재 수정본의 검토 설명'}}}}));
 const current=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));assert.notEqual(current.fingerprint,receipt.fingerprint);
 const retained=()=>JSON.stringify(['products','product_content','product_options','product_quotation_fields','collection_results','collection_context','category_profiles'].map(table=>h.sqlite.prepare('SELECT * FROM '+table).all()));
 return{...h,base,product,receipt,current,retained};
}

/** The native component and native handoff client use an in-memory message
 * transport. All receipt reads/writes below go through the actual local API. */
function historyUI(f){
 const slots=[],modules=new Map(),effects=[],layouts=[],listeners=new Set(),calls=[],posts=[],responses=[];let cursor=0,epoch=0,saved=0;
 const effect=(queue,fn,deps)=>{const index=cursor++,previous=slots[index];if(!previous||!deps||deps.some((value,i)=>!Object.is(value,previous.deps[i]))){const next={deps,cleanup:previous?.cleanup};slots[index]=next;queue.push(()=>{previous?.cleanup?.();next.cleanup=fn();});}};
 const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]={value:typeof initial==='function'?initial():initial};return[slots[index].value,value=>{epoch++;slots[index].value=typeof value==='function'?value(slots[index].value):value;}];},useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useEffect(fn,deps){effect(effects,fn,deps);},useLayoutEffect(fn,deps){effect(layouts,fn,deps);}};
 const window={location:{origin},addEventListener(_type,fn){listeners.add(fn);},removeEventListener(_type,fn){listeners.delete(fn);},postMessage(message){
  calls.push(message);const record=message.type==='PING'?null:responses.shift();
  const result=message.type==='PING'?{ok:true,historicalReceiptLookup:true,productTransmissionHistory:true}:{ok:true,fingerprint:f.receipt.fingerprint,registered:false,record:{...record,origin,productId:f.product.id,categoryId:f.receipt.categoryId,fingerprint:f.receipt.fingerprint}};
  queueMicrotask(()=>{for(const fn of [...listeners])fn({source:window,origin,data:{channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId:message.requestId,result}});});
 }};
 const fetcher=async(url,init={})=>{const body=init.body?JSON.parse(init.body):undefined;if(init.method==='POST')posts.push({url,body});return f.route(url,{method:init.method??'GET',body});};
 function load(file){if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,URL,URLSearchParams,Date,AbortController,AbortSignal,TextEncoder,TextDecoder,crypto:webcrypto,window,setTimeout,clearTimeout,queueMicrotask,fetch:fetcher,require(name){if(name==='react')return hooks;if(name.startsWith('@/'))return load(name.slice(2)+(name.includes('/components/')?'.tsx':'.ts'));if(name.startsWith('./')||name.startsWith('../'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');return native(name);}});return exports;}
 const Component=load('app/components/historical-supplier-hub-result.tsx').HistoricalSupplierHubResult;
 const expand=tree=>Array.isArray(tree)?tree.map(expand):tree&&typeof tree==='object'&&typeof tree.type==='function'?expand(tree.type(tree.props)):tree&&typeof tree==='object'&&tree.props?{...tree,props:{...tree.props,children:expand(tree.props.children)}}:tree;
 const render=()=>{cursor=0;const tree=expand(Component({productId:f.product.id,receipt:f.receipt,onSaved(){saved++;}}));layouts.splice(0).forEach(fn=>fn());effects.splice(0).forEach(fn=>fn());return tree;};
 const button=label=>nodes(render()).find(node=>node.type==='button'&&node.props.children===label);
 async function click(label,result){responses.push(result);const target=button(label);assert.ok(target&&!target.props.disabled,label);target.props.onClick();const deadline=Date.now()+10000;while(render().props['aria-busy']){assert.ok(Date.now()<deadline,'historical UI timeout');await new Promise(resolve=>setTimeout(resolve,2));}render();}
 return{calls,posts,render,click,button,load,get saved(){return saved;},get epoch(){return epoch;},close(){slots.forEach(slot=>slot?.cleanup?.());},errors:()=>nodes(render()).filter(node=>node.props?.role==='alert').map(node=>node.props.children),skus:()=>nodes(render()).filter(node=>node.type==='td'&&/^634-ISSUED-/.test(String(node.props.children))).map(node=>node.props.children)};
}

for(const company of companies)test(`file-only refresh preserves the original six-SKU receipt and editable draft through actual historical API and UI (${company.code})`,async()=>{
 const f=await fixture(company);let ui;try{
  const before=f.retained(),original=structuredClone(f.receipt),oldRegistration=JSON.stringify(original.result.registration),originalBytes=new Map([...f.objects].map(([key,bytes])=>[key,bytes.slice()]));ui=historyUI(f);
  const file={...original.result};delete file.registration;const fresh={...file,observedAt:file.observedAt+20,status:'검증 완료 · 재조회'};
  await ui.click('원래 견적서 검증 결과 조회',fresh);
  assert.deepEqual(ui.errors(),[]);assert.equal(ui.saved,1);assert.deepEqual(ui.skus(),original.result.registration.rows.map(row=>row.skuId),'file-only refresh cannot erase the original SKU table');
  const stored=(await json(await f.route(f.base+'/supplier-hub-receipt?fingerprint='+original.fingerprint))).receipt;
  assert.equal(JSON.stringify(stored.result.registration),oldRegistration,'the old per-SKU observation retains its exact timestamp and rows');assert.equal(stored.productVersion,original.productVersion);assert.equal(stored.profileId,original.profileId);assert.equal(stored.result.quotationId,original.result.quotationId);
  assert.equal(ui.posts.length,1);assert.equal(ui.posts[0].body.action,'observe-history');assert.equal(ui.posts[0].body.fingerprint,original.fingerprint);assert.equal(ui.posts[0].body.result.registration.observedAt,original.result.registration.observedAt);assert.equal(ui.posts[0].body.result.observedAt,fresh.observedAt);
  assert.equal(f.retained(),before);assert.equal(JSON.stringify(f.receipt),JSON.stringify(original));assert.equal(ui.calls.some(call=>['PREPARE','TRANSMIT','VALIDATE'].includes(call.type)),false);
  // A new full explicit SKU observation may update statuses, retaining every
  // previously issued ID. It is distinct from a file-only refresh.
  const newRegistration={...original.result,registration:{...original.result.registration,observedAt:file.observedAt+30,rows:original.result.registration.rows.map(row=>({...row,status:'상품 검수완료'}))}};
  await ui.click('원래 견적서 상품별 상태 조회',newRegistration);assert.deepEqual(ui.errors(),[]);assert.equal(ui.saved,2);
  const confirmed=(await json(await f.route(f.base+'/supplier-hub-receipt?fingerprint='+original.fingerprint))).receipt;assert.equal(confirmed.result.registration.observedAt,newRegistration.registration.observedAt);assert.ok(confirmed.result.registration.rows.every(row=>row.status==='상품 검수완료'));assert.equal(confirmed.productVersion,original.productVersion);
  const payload=f.sqlite.prepare('SELECT payload FROM supplier_hub_receipts').get().payload;
  for(const malformed of [{...file,quotationId:'other-full-quotation-id'}, {...file,company:company.code==='A01464742'?companies[1]:companies[0]}]){
   const postCount=ui.posts.length;await ui.click('원래 견적서 검증 결과 조회',malformed);assert.ok(ui.errors().length);assert.equal(ui.posts.length,postCount,'another company or ID never reaches receipt storage');assert.deepEqual(ui.skus(),original.result.registration.rows.map(row=>row.skuId));assert.equal(f.sqlite.prepare('SELECT payload FROM supplier_hub_receipts').get().payload,payload);
  }
  const missingSku={...newRegistration,registration:{...newRegistration.registration,observedAt:file.observedAt+40,rows:newRegistration.registration.rows.slice(0,1)}};
  const rejected=await f.route(f.base+'/supplier-hub-receipt',{method:'POST',body:{action:'observe-history',profileId:original.profileId,categoryId:original.categoryId,fingerprint:original.fingerprint,result:missingSku}});assert.equal(rejected.status,400);assert.equal(f.sqlite.prepare('SELECT payload FROM supplier_hub_receipts').get().payload,payload);
  assert.equal(f.retained(),before);for(const [key,bytes]of originalBytes)assert.deepEqual(f.objects.get(key),bytes);assert.equal(f.objects.size,originalBytes.size);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS total FROM supplier_hub_receipts').get().total,1);assert.deepEqual(f.network,[]);assert.ok(ui.calls.filter(call=>call.type!=='PING').every(call=>['REFRESH','REGISTRATION'].includes(call.type)&&call.payload.historical===true&&call.payload.fingerprint===original.fingerprint));
 }finally{ui?.close();f.close();}
});
