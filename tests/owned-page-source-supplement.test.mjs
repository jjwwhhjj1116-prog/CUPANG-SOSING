import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {stageRefreshDOM} from './helpers/stage-refresh-dom.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const captureId='9b000000-0000-4000-8000-000000000706';
async function fixture(){
 const h=mobileIntakeHarness({companyCode:'A01526306',companyName:'유앤채'});
 h.sqlite.prepare("UPDATE collection_jobs SET goal='collect' WHERE id='job'").run();
 const sku=JSON.parse(fs.readFileSync(new URL('./fixtures/1688-public-sku-813724060928.json',import.meta.url),'utf8'));
 const original=h.load('app/alibaba-mobile-product.ts').parseAlibabaPublicSkuProduct(sku,h.sourceUrl);
 original.options=Array.from({length:16},(_,i)=>({...original.options[0],sku:'s'+i,name:'红'+i+' / 100*200cm',color:'红'+i,size:'100*200cm',unitPriceCny:4.8,minimumOrder:1,imageIndex:0}));
 await h.load('db/collection-results.ts').storeCollectionResult('owner','job',original);
 const snapshot={format:'yoofam-page-source-v1',sourceUrl:h.sourceUrl,offerId:'813724060928',collectedAt:new Date().toISOString(),title:original.title,description:'새 상세 원문',
  options:original.options.map(row=>({key:row.sku,name:row.color+'&gt;'+row.size,supplierSku:row.sku,unitPriceCny:row.unitPriceCny,currency:'CNY',minimumOrder:row.minimumOrder,stock:1,imageUrl:null})),
  images:[...original.images,{...original.images[0],role:'detail'}],attributes:[{name:'材质',value:'涤纶'}]};
 const inbox=h.load('db/source-inbox.ts'),fingerprint=await h.load('app/source-inbox.ts').pageSourceFingerprint(snapshot),stored=await inbox.storeSourceInbox('owner',{code:'A01526306',name:'유앤채'},captureId,fingerprint,snapshot);
 assert.ok(stored);const item=stored.item,pointer=h.load('app/source-capture-selection.ts').sourceCaptureSelection(item);
 const route=h.load('app/api/collection-jobs/[id]/source-supplement/route.ts'),post=(capture=pointer,extra={})=>route.POST(new Request('https://app.test/api/collection-jobs/job/source-supplement',{method:'POST',headers:{'content-type':'application/json',origin:'https://app.test'},body:JSON.stringify({capture,...extra})}),{params:Promise.resolve({id:'job'})});
 const state=()=>JSON.stringify(['collection_results','collection_context','collection_source_supplements','products','product_options','product_content'].map(table=>{try{return h.sqlite.prepare('SELECT * FROM '+table).all();}catch{return[];}}));
 return{h,original,snapshot,item,pointer,post,state};
}

test('owned saved page pointer supplements all16 matching source SKUs without changing original rows or selected6 manual values',async()=>{
 const f=await fixture(),{h}=f;
 try{
  const merge=h.load('app/collection-source-supplement.ts').supplementCollectionSource,captured=h.load('app/source-inbox.ts').pageSourceCollectionResult(f.snapshot);
  await h.intake();const p=h.sqlite.prepare('SELECT * FROM products').get();
  const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
  const edited=await h.route(`/api/products/${p.id}/content`,{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'직접 수정한 커튼',description:'직접 작성한 설명',keywords:[]},label:{material:''},assets:{main:[]}}}});assert.equal(edited.status,200,await edited.clone().text());
  const options=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);options.rows=options.rows.slice(0,6);options.rows[0].translatedName='수동 이름';options.rows[0].color='';options.rows[0].provenance.color='manual';
  for(const [index,row]of options.rows.entries()){row.imageKey=index?JSON.parse(p.image_keys)[0]:null;row.provenance.imageKey='manual';}
  h.sqlite.prepare('UPDATE product_options SET payload=?').run(JSON.stringify(options));
  h.sqlite.prepare('UPDATE products SET sale_price=10500,supply_price=5775').run();
  const policy=h.load('app/pricing.ts').pricePolicy({exchangeRate:310,supplyMargin:50,coupangMargin:45,minimumMargin:3000,msrpMultiple:1.3,roundingUnit:10,roundingMode:'nearest',arithmeticMode:'couplus-number-v1',useIntegratedRate:true,integratedRate:290,fixedSourcing:{version:1,referenceCny:4.8,salePrice:10500,supplyPrice:5775,purchaseCost:2738,sourceUnitsPerPack:1}}),policyPayload=JSON.stringify(policy);
  h.sqlite.prepare('INSERT INTO product_price_policy(product_id,payload) VALUES(?,?) ON CONFLICT(product_id) DO UPDATE SET payload=excluded.payload').run(p.id,policyPayload);
  const beforeOptions=h.sqlite.prepare('SELECT payload FROM product_options').get().payload,raw=h.sqlite.prepare('SELECT * FROM collection_results').get(),context=h.sqlite.prepare('SELECT payload FROM collection_context').get().payload;
  const response=await f.post(f.pointer,{expectedProductVersion:h.sqlite.prepare('SELECT updated_at FROM products').get().updated_at});assert.equal(response.status,200,await response.clone().text());
  const result=merge(f.original,captured,'owned-page');assert.deepEqual(plain(result.options),plain(f.original.options));assert.equal(result.attributes.length,1);
  assert.deepEqual(plain(result.images.slice(0,f.original.images.length)),plain(f.original.images));
  for(const field of Object.keys(f.original).filter(key=>!['provider','description','attributes','images'].includes(key)))assert.deepEqual(plain(result[field]),plain(f.original[field]),field);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM collection_results').get(),raw);assert.equal(h.sqlite.prepare('SELECT payload FROM collection_context').get().payload,context);assert.equal(h.sqlite.prepare('SELECT payload FROM product_options').get().payload,beforeOptions);
  assert.deepEqual(plain((await response.json()).receipt.result.options),plain(f.original.options));const after=h.sqlite.prepare('SELECT * FROM products').get();assert.equal(after.sale_price,10500);assert.equal(after.supply_price,5775);
  const contentBefore=h.sqlite.prepare('SELECT payload FROM product_content').get().payload,paths=[];
  await h.load('app/collection-supplement-client.ts').completeCollectionSupplement({jobId:'job',offerId:f.original.offerId,sourceUrl:h.sourceUrl,productId:p.id,productVersion:after.updated_at,provider:f.original.provider},
   {fetcher:(url,init={})=>{paths.push(url);return h.route(url,{method:init.method??'GET',body:init.body});},signal:new AbortController().signal,captureFromBrowser:async()=>assert.fail('already stored pointer merge must resume without recapture'),onProgress(){}});
  assert.equal(paths.some(path=>path.endsWith('/source-supplement')),false);assert.equal(h.sqlite.prepare('SELECT payload FROM product_options').get().payload,beforeOptions);assert.equal(h.sqlite.prepare('SELECT sale_price FROM products').get().sale_price,10500);
  assert.equal(h.sqlite.prepare('SELECT supply_price FROM products').get().supply_price,5775);assert.equal(h.sqlite.prepare('SELECT payload FROM product_price_policy').get().payload,policyPayload);assert.equal(h.load('app/pricing.ts').calculateRepresentativePrice(4.8,policy).costKrw,2738);
  const currentContent=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload),previousContent=JSON.parse(contentBefore);assert.deepEqual(currentContent.seo,previousContent.seo);assert.deepEqual(currentContent.label,previousContent.label);assert.equal(h.aiSources.length,0);
 }finally{h.close();}
});

const uiVersion='2026-11-06T00:00:00.000Z';
async function click(ui,label){const node=[...ui.container.querySelectorAll('button')].find(item=>item.textContent===label||item.textContent.includes(label));assert.ok(node&&!node.disabled,label);await ui.React.act(async()=>node.click());await ui.settle();}
test('actual recovery UI lists only on explicit opening and uses the selected saved pointer with zero browser captures',async()=>{
 const f=await fixture(),calls=[];let merged=false,browserCalls=0;
 const context=()=>({productId:'p',sourceUrl:f.h.sourceUrl,productVersion:uiVersion,jobId:'job',provider:merged?'chrome-public-mobile-supplement-v1':f.original.provider,requestContext:null,sourceGaps:[{fieldId:'noticeMaterial',label:'소재',step:'표시사항'}]});
 const ui=await stageRefreshDOM(async(url,init={})=>{url=String(url);calls.push({url,method:init.method??'GET',body:init.body?JSON.parse(init.body):null});
  if(url.endsWith('/translation-source'))return Response.json(context());
  if(url==='/api/source-inbox')return Response.json({ownerId:'owner',company:f.item.company,items:[f.item,{...f.item,id:'8b000000-0000-4000-8000-000000000706',company:{code:'A01464742',name:'와이홉'}}]});
  if(url==='/api/supplier-hub/catalog-context')return Response.json({ownerId:'owner',company:f.item.company});
  if(url.endsWith('/result'))return Response.json({jobId:'job',offerId:f.original.offerId,receipt:{result:{...f.original,...(merged?{provider:'chrome-public-mobile-supplement-v1',description:'stored'}:{})},receivedAt:new Date().toISOString()}});
  if(url.endsWith('/source-supplement')){merged=true;return Response.json({jobId:'job',offerId:f.original.offerId,receipt:{result:{...f.original,provider:'chrome-public-mobile-supplement-v1',description:'stored'},receivedAt:new Date().toISOString()}});}
  return Response.json({error:'stop after merge'},{status:503});
 });
 try{
  ui.window.postMessage=()=>{browserCalls++;throw Error('browser capture forbidden');};const Component=ui.load('app/components/product-source-context.tsx').ProductSourceContext;
  await ui.render(Component,{productId:'p',productVersion:uiVersion,sourceUrl:f.h.sourceUrl,step:'SEO',onNavigate(){},onBeforeSupplement:()=>true,onSaved:async()=>{}});assert.equal(calls.some(row=>row.url==='/api/source-inbox'),false);
  await click(ui,'저장된 수집본 선택');assert.equal(calls.filter(row=>row.url==='/api/source-inbox').length,1);assert.doesNotMatch(ui.container.textContent,/8b000000/);
  const confirm=()=>[...ui.container.querySelectorAll('button')].find(node=>node.textContent==='선택한 저장 수집본으로 보완');assert.equal(confirm().disabled,true,'no automatic selection');
  await click(ui,captureId);await click(ui,'선택한 저장 수집본으로 보완');assert.equal(browserCalls,0);const writes=calls.filter(row=>row.url.endsWith('/source-supplement'));assert.equal(writes.length,1);assert.deepEqual(writes[0].body.capture,plain(f.pointer));assert.ok(ui.container.querySelector('[role="status"]'));
 }finally{await ui.close();f.h.close();}
});

test('actual saved-source list ignores a late response through a product-version A-B-A transition',async()=>{
 const f=await fixture();let release,clock=uiVersion;const held=new Promise(resolve=>{release=resolve;});const ui=await stageRefreshDOM(async url=>String(url)==='/api/source-inbox'?held:Response.json({productId:'p',sourceUrl:f.h.sourceUrl,productVersion:clock,jobId:'job',provider:f.original.provider,requestContext:null,sourceGaps:[{fieldId:'noticeMaterial',label:'소재',step:'표시사항'}]}));
 try{
  const Component=ui.load('app/components/product-source-context.tsx').ProductSourceContext,props={productId:'p',productVersion:uiVersion,sourceUrl:f.h.sourceUrl,step:'SEO',onNavigate(){},onBeforeSupplement:()=>true};await ui.render(Component,props);await click(ui,'저장된 수집본 선택');
  clock='2026-11-06T00:00:01.000Z';await ui.render(Component,{...props,productVersion:clock});clock=uiVersion;await ui.render(Component,props);await ui.React.act(async()=>release(Response.json({ownerId:'owner',company:f.item.company,items:[f.item]})));await ui.settle();assert.doesNotMatch(ui.container.textContent,new RegExp(captureId));
 }finally{release(Response.json({}));await ui.close();f.h.close();}
});

test('owned page supplement rejects pointer scope and source-fact tampering without writes',async()=>{
 for(const edit of [p=>p.captureId='8b000000-0000-4000-8000-000000000706',p=>p.revision++,p=>p.fingerprint='a'.repeat(64),p=>p.sourceUrl=p.sourceUrl.replace('813724060928','813724060929'),p=>p.provider='chrome-current-page-v1']){
  const f=await fixture();try{const before=f.state(),pointer=plain(f.pointer);edit(pointer);assert.notEqual((await f.post(pointer)).status,200);assert.equal(f.state(),before);}finally{f.h.close();}
 }
 const f=await fixture();try{
  const merge=f.h.load('app/collection-source-supplement.ts').supplementCollectionSource,good=f.h.load('app/source-inbox.ts').pageSourceCollectionResult(f.snapshot);
  for(const edit of [s=>s.options.pop(),s=>s.options[0].sku='other',s=>s.options[0].unitPriceCny=4.81,s=>s.options[0].minimumOrder=2,s=>s.options[0].name='100*200cm&gt;红0',s=>s.options[0].name='红0&gt;100*2m',s=>s.options[0].color='other',s=>s.options[0].size='other']){const next=plain(good);edit(next);assert.throws(()=>merge(f.original,next,'owned-page'));}
  assert.throws(()=>merge(f.original,good),'provider name alone never grants page-source authority');
  const before=f.state();f.h.setCompany({code:'A01464742',name:'와이홉'});assert.notEqual((await f.post()).status,200);assert.equal(f.state(),before);
 }finally{f.h.close();}
});

test('owned pointer keeps current owner, stored company, archive, job company and product-clock fences',async()=>{
 for(const edit of [
  async f=>{const get=f.h.auth.getChatGPTUser;f.h.auth.getChatGPTUser=async()=>({...await get(),userId:'other-owner'});},
  async f=>{f.h.sqlite.prepare("UPDATE source_inbox SET owner_id='other-owner'").run();},
  async f=>{f.h.sqlite.prepare("UPDATE source_inbox SET company_code='A01464742',company_name='와이홉'").run();},
  async f=>{f.h.sqlite.prepare('UPDATE source_inbox SET archived_at=?').run(new Date().toISOString());},
  async f=>{const context=JSON.parse(f.h.sqlite.prepare('SELECT payload FROM collection_context').get().payload);context.company={code:'A01464742',name:'와이홉'};f.h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(context));},
  async f=>{const context=JSON.parse(f.h.sqlite.prepare('SELECT payload FROM collection_context').get().payload);delete context.company;f.h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(context));},
 ]){
  const f=await fixture();try{await edit(f);const before=f.state();assert.notEqual((await f.post()).status,200);assert.equal(f.state(),before);}finally{f.h.close();}
 }
 const f=await fixture();try{await f.h.intake();const p=f.h.sqlite.prepare('SELECT * FROM products').get();f.h.sqlite.prepare('UPDATE products SET updated_at=?').run(new Date(Date.parse(p.updated_at)+1).toISOString());const before=f.state();assert.equal((await f.post(f.pointer,{expectedProductVersion:p.updated_at})).status,409);assert.equal(f.state(),before);}finally{f.h.close();}
});

test('already supplemented receipt recovery never recaptures or repeats the supplement POST',async()=>{
 const f=await fixture();try{
  const merged={...f.original,provider:'chrome-public-mobile-supplement-v1',description:'stored supplement'},calls=[];
  const client=f.h.load('app/collection-supplement-client.ts');
  const input={jobId:'job',offerId:f.original.offerId,sourceUrl:f.h.sourceUrl,productId:'p',productVersion:new Date().toISOString(),provider:f.original.provider};
  await assert.rejects(()=>client.completeCollectionSupplement(input,{fetcher:async(url,init={})=>{calls.push({url,method:init.method??'GET'});if(url.endsWith('/result'))return Response.json({jobId:'job',offerId:f.original.offerId,receipt:{result:merged,receivedAt:new Date().toISOString()}});return Response.json({error:'stop after receipt read'},{status:503});},signal:new AbortController().signal,captureFromBrowser:async()=>assert.fail('stored supplement must not recapture'),onProgress(){}}),/stop after receipt read/);
  assert.equal(calls[0].url,'/api/collection-jobs/job/result');assert.equal(calls.some(c=>c.url.endsWith('/source-supplement')),false);
 }finally{f.h.close();}
});

test('receipt-only recovery is read-only and an unknown ACK is never retried as another supplement',async()=>{
 const f=await fixture();try{
  const client=f.h.load('app/collection-supplement-client.ts'),merged={...f.original,provider:'chrome-public-mobile-supplement-v1',description:'stored'},calls=[],signal=new AbortController().signal;
  const receipt=result=>({jobId:'job',offerId:f.original.offerId,receipt:{result,receivedAt:new Date().toISOString()}}),input={jobId:'job',offerId:f.original.offerId,sourceUrl:f.h.sourceUrl,productId:'p',productVersion:uiVersion,provider:f.original.provider};
  const notice=await client.completeCollectionSupplement(input,{recoverOnly:true,fetcher:async(url,init={})=>{calls.push({url,method:init.method??'GET'});assert.ok(url.endsWith('/result'),'a read-only confirmation cannot import images or create a draft');return Response.json(receipt(merged));},signal,captureFromBrowser:async()=>assert.fail('read-only recovery must not capture'),onProgress(){}});
  assert.match(notice,/확인/);assert.deepEqual(calls.map(row=>row.method),['GET']);
  for(const mode of ['lost','503','malformed']){
   let posts=0,reads=0;const fetcher=async(url)=>{if(String(url).endsWith('/result')){reads++;return Response.json(receipt(f.original));}posts++;if(mode==='lost')throw Error('lost ACK');return mode==='503'?Response.json({error:'uncertain'},{status:503}):Response.json({});};
   await assert.rejects(()=>client.captureCollectionSupplement('job',f.original.offerId,f.h.sourceUrl,{fetcher,signal,savedCapture:f.pointer,captureFromBrowser:async()=>assert.fail('selected capture must not recapture')}),error=>error.uncertain===true);
   assert.equal(posts,1);assert.equal(reads,1);
   await assert.rejects(()=>client.completeCollectionSupplement(input,{fetcher,signal,recoverOnly:true,captureFromBrowser:async()=>assert.fail('recovery must not capture'),onProgress(){}}),error=>error.uncertain===true);assert.equal(posts,1,'confirmation has zero repeated POSTs');
  }
 }finally{f.h.close();}
});

test('actual recovery UI fences dirty writes but can confirm an unknown result with GET only',async()=>{
 const f=await fixture(),calls=[];let dirty=false,serverMerged=false;
 const context=()=>({productId:'p',sourceUrl:f.h.sourceUrl,productVersion:uiVersion,jobId:'job',provider:f.original.provider,requestContext:null,sourceGaps:[{fieldId:'noticeMaterial',label:'소재',step:'표시사항'}]});
 const ui=await stageRefreshDOM(async(url,init={})=>{url=String(url);calls.push({url,method:init.method??'GET'});if(url.endsWith('/translation-source'))return Response.json(context());if(url==='/api/source-inbox')return Response.json({ownerId:'owner',company:f.item.company,items:[f.item]});if(url==='/api/supplier-hub/catalog-context')return Response.json({ownerId:'owner',company:f.item.company});
  if(url.endsWith('/result'))return Response.json({jobId:'job',offerId:f.original.offerId,receipt:{result:{...f.original,...(serverMerged?{provider:'chrome-public-mobile-supplement-v1'}:{})},receivedAt:new Date().toISOString()}});if(url.endsWith('/source-supplement'))throw Error('lost ACK');assert.fail('read-only recovery cannot import/create');});
 try{
  const Component=ui.load('app/components/product-source-context.tsx').ProductSourceContext;await ui.render(Component,{productId:'p',productVersion:uiVersion,sourceUrl:f.h.sourceUrl,step:'SEO',onNavigate(){},onBeforeSupplement:()=>!dirty});await click(ui,'저장된 수집본 선택');await click(ui,captureId);
  dirty=true;await click(ui,'선택한 저장 수집본으로 보완');assert.equal(calls.some(row=>row.method==='POST'),false);dirty=false;await click(ui,'선택한 저장 수집본으로 보완');assert.equal(calls.filter(row=>row.method==='POST').length,1);
  const primary=[...ui.container.querySelectorAll('button')].find(node=>node.textContent==='Chrome에서 상세 원문 보완');assert.equal(primary.disabled,true,'unknown ACK blocks another write');
  dirty=true;serverMerged=true;const count=calls.length;await click(ui,'보완 저장 결과 확인 · 읽기 전용');assert.equal(calls.filter(row=>row.method==='POST').length,1);assert.ok(calls.slice(count).some(row=>row.url.endsWith('/result')));assert.ok(calls.slice(count).every(row=>row.method==='GET'));
 }finally{await ui.close();f.h.close();}
});
