import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {canObserveSupplierHubRegistration} from '../extensions/supplier-hub/handoff-store.mjs';
import {refreshSupplierHubRegistration} from '../extensions/supplier-hub/app-registration.mjs';
import {searchSupplierHubRegistration} from '../extensions/supplier-hub/registration-search.mjs';
const source=fs.readFileSync(new URL('../extensions/supplier-hub/registration-search.mjs',import.meta.url),'utf8').replace('export async function','async function');
function harness(options={}){
 let clicks=0,resets=0,observerCallback,resultRows=options.initialRows??[];const events=[],timers=new Map();
 const headings=['상품명','상품 등록일','카테고리','바코드','원본 견적서','견적서 ID','SKU ID','상태','등록 진행 단계'];
 const tableBody={};let table={getClientRects:()=>[{}],querySelectorAll:selector=>selector==='thead th'?headings.map(innerText=>({innerText})):resultRows.map(cells=>({getClientRects:()=>[{}],querySelectorAll:()=>cells.map(innerText=>({innerText,querySelectorAll:()=>[]}))})),querySelector:()=>null,contains:node=>node===tableBody};
 const filters=new Map(['input#productName','input#barcode','input#skuId','input#sourcingChannelId','select#state','select#progress','input#isReplyNeeded'].map(selector=>[selector,{value:'old-filter',type:selector.endsWith('isReplyNeeded')?'checkbox':'text',checked:true,getClientRects:()=>[{}]}]));
 class Input {get value(){return this.current||'';}set value(v){this.current=v;}}
 const input=new Input();Object.assign(input,{value:options.value||'',disabled:!!options.disabled,readOnly:false,isConnected:true,getClientRects:()=>[{}],dispatchEvent:e=>{events.push(e.type);if(options.replace)input.isConnected=false;}});
 const button={innerText:'검색',isConnected:true,disabled:!!options.buttonDisabled,getClientRects:()=>[{}],getAttribute:()=>null,click:()=>{clicks++;if(options.resultMode){if(options.resultMode==='switch')input.value='other';
  if(['replace-table','replace-wrapper','unrelated-table','unrelated-wrapper'].includes(options.resultMode)){const replacement={...table};if(options.resultMode.startsWith('replace-')){table=replacement;resultRows=options.resultRows??[];}
   const added=options.resultMode.endsWith('wrapper')?{querySelector:selector=>selector==='table'?replacement:null,contains:node=>node===replacement}:replacement;
   observerCallback?.([{type:'childList',target:{},addedNodes:[added]}]);}
  else observerCallback?.([{type:options.resultMode==='attribute'?'attributes':'childList',target:options.resultMode==='unrelated'?{}:tableBody,addedNodes:[]}]);}}};
 const label={innerText:'견적서 ID',getClientRects:()=>[{}]};
 const reset={innerText:options.resetText??' 재설정',disabled:!!options.resetDisabled,getClientRects:()=>[{}],getAttribute:()=>null,click:()=>{resets++;if(!options.resetFails)input.value='';if(options.resetReplaces)input.isConnected=false;for(const [key,filter]of filters){if(options.staleFilter!==key){filter.value='';filter.checked=false;}}}};
 const context=vm.createContext({HTMLInputElement:Input,Event:class{constructor(type){this.type=type;}},MutationObserver:class{constructor(callback){observerCallback=callback;}observe(){}disconnect(){observerCallback=undefined;}},setTimeout:(callback,ms)=>{timers.set(callback,ms);return callback;},clearTimeout:callback=>timers.delete(callback),location:{origin:'https://supplier.coupang.com',pathname:'/qvt/wims',...options.location},document:{body:{innerText:'Company Code: '+(options.companyCode??'A01464742')},querySelectorAll(selector){if(selector==='table')return options.missingTable?[]:[table];if(selector.startsWith('.pagination'))return [];if(filters.has(selector))return options.missingFilter===selector?[]:[filters.get(selector)];if(selector.startsWith('input'))return options.duplicate?[input,input]:[input];if(selector.startsWith('label'))return [label];return options.missingReset?[button]:options.duplicateReset?[button,reset,{...reset}]:[button,reset];}}});
 vm.runInContext(source,context);
 return {run:(id,wait=false)=>context.searchSupplierHubRegistration(id,wait),script:(func,args=[])=>vm.runInContext(`(${func.toString()})(...args)`,Object.assign(context,{args})),input,events,filters,resets:()=>resets,clicks:()=>clicks,button,timers,tick(ms){for(const [callback,duration]of [...timers])if(duration===ms){timers.delete(callback);callback();}},changed(){observerCallback?.([{type:'childList',target:tableBody,addedNodes:[]}]);}};
}
test('exact validated quotation ID is entered with native events before one search',async()=>{
 for(const value of ['', 'quote-123']){const h=harness({value});const result=await h.run('quote-123');assert.equal(h.input.value,'quote-123');assert.deepEqual(h.events,['input','change']);assert.equal(h.clicks(),1);assert.equal(result.registered,false);assert.equal(result.state,'search-requested');}
});
test('existing different search, duplicate controls, disabled or wrong page do not click',async()=>{
 for(const opts of [{value:'other'},{duplicate:true},{disabled:true},{buttonDisabled:true},{location:{pathname:'/qvt/registration'}},{location:{origin:'https://example.com'}}]){const h=harness(opts);await assert.rejects(h.run('quote-123'));assert.equal(h.clicks(),0);assert.equal(h.events.length,0);}
 for(const id of ['', ' x', null, 'x'.repeat(201)]){const h=harness();await assert.rejects(h.run(id));assert.equal(h.clicks(),0);}
});
test('a form replaced by input events is not searched',async()=>{const h=harness({replace:true});await assert.rejects(h.run('quote-123'),/양식이 변경/);assert.equal(h.clicks(),0);});

test('Hub reset clears previous filters before the exact quotation search',async()=>{
 const h=harness({value:'quote-123'});await h.run('quote-123');
 assert.equal(h.resets(),1);assert.equal(h.clicks(),1);
 for(const filter of h.filters.values()){assert.equal(filter.value,'');assert.equal(filter.checked,false);}
});

test('plain and exactly observed FontAwesome reset labels preserve one native reset and exact-ID search',async()=>{
 for(const resetText of ['재설정',' \n 재설정 \t','\uf021 재설정',' \uf021\n 재설정 ']){
  const h=harness({resetText});await h.run('quote-123');assert.equal(h.resets(),1);assert.equal(h.clicks(),1);assert.equal(h.input.value,'quote-123');assert.deepEqual(h.events,['input','change']);
 }
});
test('unknown reset prefixes, other text, duplicate or disabled observed buttons never alter any query',async()=>{
 for(const options of ['초기화 재설정','reset 재설정','\uf021 다시 재설정','\uf021재설정','\uf022 재설정','\uf021\uf021 재설정','재설정 전체'].map(resetText=>({resetText})).concat([{resetText:'\uf021 재설정',duplicateReset:true},{resetText:'\uf021 재설정',resetDisabled:true}])){
  const h=harness(options);await assert.rejects(h.run('quote-123'),/재설정/);assert.equal(h.resets(),0);assert.equal(h.clicks(),0);assert.equal(h.events.length,0);
 }
});

test('missing reset, unfinished reset and stale filters never issue a misleading search',async()=>{
 for(const opts of [{missingReset:true},{resetDisabled:true},{resetFails:true,value:'quote-123'},{resetReplaces:true},
  ...['input#productName','input#barcode','input#skuId','input#sourcingChannelId','select#state','select#progress','input#isReplyNeeded'].flatMap(staleFilter=>[{staleFilter},{missingFilter:staleFilter}])]){
  const h=harness(opts);await assert.rejects(h.run('quote-123'));assert.equal(h.clicks(),0);assert.equal(h.events.length,0);
 }
 const h=harness({value:'other'});await assert.rejects(h.run('quote-123'));assert.equal(h.resets(),0);
});

test('app status lookup waits for rendered result rows rather than the search click or unrelated mutations',async()=>{
 const settle=async()=>{for(let i=0;i<4;i++)await Promise.resolve();};
 const h=harness({resultMode:'changed'});const pending=h.run('quote-123',true);await settle();
 assert.equal(h.clicks(),1);assert.equal(h.timers.size,2);h.tick(350);assert.equal((await pending).state,'search-complete');assert.equal(h.timers.size,0);
 for(const resultMode of [undefined,'unrelated','attribute']){const bad=harness({resultMode});const request=bad.run('quote-123',true);await settle();bad.tick(350);bad.tick(8000);await assert.rejects(request,/갱신/);assert.equal(bad.timers.size,0);}
 const switched=harness({resultMode:'switch'});const request=switched.run('quote-123',true);await settle();switched.tick(350);await assert.rejects(request,/변경/);assert.equal(switched.timers.size,0);
 const missing=harness({missingTable:true});await assert.rejects(missing.run('quote-123',true),/결과 표/);assert.equal(missing.clicks(),0);
});

test('result rendering cannot finish while the search button remains disabled',async()=>{
 const h=harness({resultMode:'changed'});const request=h.run('quote-123',true);for(let i=0;i<4;i++)await Promise.resolve();
 h.button.disabled=true;h.tick(350);assert.equal(h.timers.size,1);h.button.disabled=false;h.changed();h.tick(350);assert.equal((await request).state,'search-complete');assert.equal(h.timers.size,0);
});

test('replacing the matching result table completes exact-ID search without mistaking an unrelated table for results',async()=>{
 for(const resultMode of ['replace-table','replace-wrapper','unrelated-table','unrelated-wrapper']){
  const h=harness({resultMode}),pending=h.run('quote-123',true);for(let i=0;i<4;i++)await Promise.resolve();
  h.tick(350);h.tick(8000);
  if(resultMode.startsWith('replace-'))assert.equal((await pending).state,'search-complete');else await assert.rejects(pending,/갱신/);
  assert.equal(h.clicks(),1);assert.equal(h.input.value,'quote-123');assert.equal(h.timers.size,0);
 }
});

test('an unrelated table wrapper leaves the lookup pending until the real result table changes',async()=>{
 const h=harness({resultMode:'unrelated-wrapper'});let completed=false;
 const pending=h.run('quote-123',true).then(result=>{completed=true;return result;});
 for(let i=0;i<4;i++)await Promise.resolve();h.tick(350);await Promise.resolve();
 assert.equal(completed,false);assert.deepEqual([...h.timers.values()],[8000]);
 h.changed();h.tick(350);assert.equal((await pending).state,'search-complete');assert.equal(h.timers.size,0);
});

test('app status recovery reads only freshly rendered SKU rows after a serialized replacement without replaying attachments',async()=>{
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])for(const resultMode of ['replace-table','replace-wrapper','unrelated-wrapper']){
  const identity={origin:'http://localhost:3000',productId:'p',categoryId:'80719',fingerprint:'a'.repeat(64)},quotationId='quote-123';
  const saved={...identity,company,includedOptions:3,filename:`YOOFAM-${identity.fingerprint}.xlsx`,quotationId,state:'validation-complete',observedAt:Date.now()-10000,registered:false};
  const key=`result:${identity.origin}:${identity.productId}:${identity.categoryId}:${identity.fingerprint}`,original={...identity,company,includedOptions:3},records=new Map([[key,saved],['attempt:123',original]]);
  const rows=Array.from({length:3},(_,index)=>['상품 '+index,'2026-10-03','합성 폼','','file.xlsx',quotationId,'sku-'+index,'상품 검수중','가격/정책']);
  const oldRows=rows.map(row=>row.map((value,index)=>index===6?'old-'+value:value));
  const h=harness({companyCode:company.code,resultMode,resultRows:rows,initialRows:oldRows}),scripts=[],tabs=[{id:123,windowId:17,url:'https://supplier.coupang.com/qvt/registration',status:'complete'}];
  const store=async(action,name,value)=>{if(action==='put')records.set(name,value);return records.get(name);};
  const api={tabs:{query:async()=>tabs,get:async id=>tabs.find(tab=>tab.id===id),create:async value=>{const tab={id:124,status:'complete',...value};tabs.push(tab);return tab;}},scripting:{executeScript:async({func,args})=>{
   scripts.push(func.name);const result=h.script(func,args);
   if(func===searchSupplierHubRegistration){for(let i=0;i<4;i++)await Promise.resolve();h.tick(350);h.tick(8000);}
   return [{result:await result}];
  }}};
  const pending=refreshSupplierHubRegistration({...identity,type:'YOOFAM_REFRESH_REGISTRATION'},{frameId:0,url:identity.origin+'/',tab:{id:7,windowId:17}},api,store);
  if(resultMode==='unrelated-wrapper'){
   await assert.rejects(pending,/갱신/);assert.equal(scripts.includes('readSupplierHubRegistration'),false);assert.equal(records.get(key),saved);assert.equal(h.timers.size,0);continue;
  }
  const result=await pending;
  assert.deepEqual(Array.from(result.registration.rows,row=>row.skuId),['sku-0','sku-1','sku-2']);assert.equal(result.registration.includedOptions,3);assert.equal(result.quotationId,quotationId);assert.equal(result.registered,false);
  assert.equal(result.observedAt,saved.observedAt);assert.ok(result.registration.observedAt>saved.observedAt);assert.equal(h.clicks(),1);assert.equal(h.timers.size,0);
  assert.equal(tabs.length,2);assert.equal(tabs[1].windowId,17);assert.equal(tabs[1].active,false);assert.deepEqual(records.get('attempt:123'),original);
  assert.equal(scripts.some(name=>/attach|requestSupplierHubValidation/.test(name)),false);assert.equal(records.has(`transmission:${identity.origin}:${identity.productId}:${identity.categoryId}:${identity.fingerprint}`),false);
 }
});

async function reviewedReceiptFixture(company){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name}),json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
 try{
  const fields=['skuId','categoryId',...h.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field=>field.id)],bytes=quotationWorkbook(fields),sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',bytes)).toString('hex'),storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,bytes);
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'합성 정확 접수 조회 시험',categoryId:'80719',categoryPath:h.context.category.categoryPath,template:{name:'synthetic-step628.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,content=(await json(await h.route(base+'/content'))).content,images=JSON.parse(product.image_keys);
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{label:{model:'SYNTHETIC-628',material:'검토한 합성 재질'},assets:{main:[images[0]],additional:[images[1]],detail:[images[2]],label:[images[3]]}}}}));
  const fieldsView=await json(await h.route(base+'/quotation-fields'));await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:fieldsView.revision,expectedInputFingerprint:fieldsView.inputFingerprint,changes:[{fieldKey:'handlingReason',optionId:null,value:'해당사항없음'},{fieldKey:'packagedWeightG',optionId:null,value:'420'},{fieldKey:'packagedDimensionsMm',optionId:null,value:'100*200*300'},{fieldKey:'storageMaterial',optionId:null,value:''}]}}));
  const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}}));assert.equal(preview.submissionReview.errorCount,0);
  const result={state:'validation-complete',filename:preview.filename,company,includedOptions:preview.report.rowCount,quotationId:'synthetic-step628-'+company.code,observedAt:Date.now(),registered:false},payload=value=>({profileId:profile.id,categoryId:'80719',fingerprint:preview.fingerprint,result:value});
  await json(await h.route(base+'/supplier-hub-receipt',{method:'POST',body:payload(result)}));
  return{h,base,product,profile,preview,result,payload,json};
 }catch(error){h.close();throw error;}
}
for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])test(`observed reset icon lets the accepted quotation collect fresh SKUs and persist an exact owned receipt (${company.code})`,async()=>{
 const f=await reviewedReceiptFixture(company);try{
  const identity={origin:'http://localhost:3000',productId:f.product.id,categoryId:'80719',fingerprint:f.preview.fingerprint},key=`result:${identity.origin}:${identity.productId}:${identity.categoryId}:${identity.fingerprint}`,saved={...identity,...f.result},original={...identity,company,includedOptions:f.result.includedOptions},records=new Map([[key,saved],['attempt:123',original]]),quotationId=saved.quotationId;
  const rows=Array.from({length:saved.includedOptions},(_,index)=>['상품 '+index,'2026-10-13','합성 조회 분류','',saved.filename,quotationId,'synthetic-sku-'+index,'상품 검수중','가격/정책']),oldRows=rows.map(row=>row.map((value,index)=>index===6?'old-'+value:value));
  const ui=harness({companyCode:company.code,resetText:'\uf021 재설정',resultMode:'replace-wrapper',initialRows:oldRows,resultRows:rows}),scripts=[],tabs=[{id:123,windowId:17,url:'https://supplier.coupang.com/qvt/registration',status:'complete'}];
  const store=async(action,name,value)=>{if(action==='put')records.set(name,value);if(action==='register'){if(JSON.stringify(records.get(name))!==JSON.stringify(value.expected)||!canObserveSupplierHubRegistration(value.expected,value.observation))return false;records.set(name,value.observation);return true;}return records.get(name);};
  const api={tabs:{query:async()=>tabs,get:async id=>tabs.find(tab=>tab.id===id),create:async value=>{const tab={id:124,status:'complete',...value};tabs.push(tab);return tab;}},scripting:{executeScript:async({func,args})=>{scripts.push(func.name);const result=ui.script(func,args);if(func===searchSupplierHubRegistration){for(let i=0;i<4;i++)await Promise.resolve();ui.tick(350);ui.tick(8000);}return[{result:await result}];}}};
  const snapshot=()=>JSON.stringify(['products','product_content','product_options','product_quotation_fields','collection_context','category_profiles','translation_jobs'].map(table=>f.h.sqlite.prepare('SELECT * FROM '+table).all())),before=snapshot();
  const result=await refreshSupplierHubRegistration({...identity,type:'YOOFAM_REFRESH_REGISTRATION'},{frameId:0,url:identity.origin+'/',tab:{id:7,windowId:17}},api,store);
  assert.equal(ui.resets(),1);assert.equal(ui.clicks(),1);assert.equal(ui.input.value,quotationId);assert.deepEqual(Array.from(result.registration.rows,row=>row.skuId),rows.map(row=>row[6]));assert.equal(records.get(key),result);assert.deepEqual(records.get('attempt:123'),original);assert.equal(tabs[1].active,false);assert.equal(tabs[1].windowId,17);assert.equal(scripts.some(name=>/attach|requestSupplierHubValidation/.test(name)),false);assert.equal([...records.keys()].some(name=>name.startsWith('transmission:')),false);
  await f.json(await f.h.route(f.base+'/supplier-hub-receipt',{method:'POST',body:f.payload(result)}));const receipt=(await f.json(await f.h.route(f.base+'/supplier-hub-receipt?fingerprint='+identity.fingerprint))).receipt,summary=f.h.load('app/supplier-hub-receipt.ts').supplierHubReceiptSummary(receipt);
  assert.equal(receipt.result.quotationId,quotationId);assert.deepEqual(receipt.result.registration.rows.map(row=>row.skuId),rows.map(row=>row[6]));assert.equal(summary.label,'SKU ID 확인');assert.equal(summary.issuedSkus,saved.includedOptions);assert.equal(summary.company.code,company.code);assert.equal(receipt.result.registered,false);assert.equal(snapshot(),before);assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n,1);
 }finally{f.h.close();}
});
