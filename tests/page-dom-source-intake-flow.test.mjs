import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFragment} from 'parse5';
import {extractPageSource,readPageSourceDomOptions} from '../extensions/supplier-hub/page-source.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {companies,syntheticSnapshot,plain} from './helpers/supplier-hub-single-projection.mjs';

const offerId='700000000768',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
const images=['gallery','black','gray','detail'].map(name=>`https://cbu01.alicdn.com/synthetic-step768-${name}.png`);
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};

// This inert HTML adapter implements only the production reader's bounded DOM
// selectors. It executes no page script and performs no resource request.
function documentFromHtml(html){
 const matches=(node,selector)=>selector.split(',').some(part=>{
  part=part.trim();if(/^[a-z]+$/u.test(part))return node.tagName===part;
  if(part==='a[href]')return node.tagName==='a'&&node.getAttribute('href')!==null;
  const attr=/^\[(class|id)\*="([^"]+)"( i)?\]$/u.exec(part);assert.ok(attr,part);
  const actual=node.getAttribute(attr[1])??'';return attr[3]?actual.toLowerCase().includes(attr[2].toLowerCase()):actual.includes(attr[2]);
 });
 const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
 const wrap=(raw,parent=null)=>{
  const element={tagName:raw.tagName,parentElement:parent,children:[],getAttribute(name){return raw.attrs?.find(attr=>attr.name===name)?.value??null;},
   contains(other){for(let node=other;node;node=node.parentElement)if(node===element)return true;return false;},
   closest(selector){for(let node=element;node;node=node.parentElement)if(node.tagName&&matches(node,selector))return node;return null;},
   querySelectorAll(selector){return descendants(element).filter(child=>matches(child,selector));},querySelector(selector){return element.querySelectorAll(selector)[0]??null;}};
  Object.defineProperties(element,{textContent:{get(){const text=node=>node.value??(node.childNodes??[]).map(text).join('');return text(raw);}},
   currentSrc:{get(){return element.getAttribute('src')??'';}},nextElementSibling:{get(){return parent?.children[parent.children.indexOf(element)+1]??null;}}});
  element.children=(raw.childNodes??[]).filter(child=>child.tagName).map(child=>wrap(child,element));return element;
 };
 const root=wrap(parseFragment(html));return {querySelectorAll:selector=>root.querySelectorAll(selector),querySelector:selector=>root.querySelector(selector)};
}
function capturedPage(){
 const scripts=[JSON.stringify({globalData:{offerBaseInfo:{offerId,subject:'合成测试商品'},tempModel:{offerId}}})];
 const html=`<section class="offer-sku"><span>颜色</span><ul>
  <li>黑色 <img src="${images[1]}"><span>¥5.30</span> 库存8</li>
  <li>灰色 <img src="${images[2]}"><span>¥6.10</span> 库存8</li>
 </ul><span>尺码</span><ul><li>均码 ¥999.00 库存9</li></ul></section>`;
 const domOptions=readPageSourceDomOptions(documentFromHtml(html),sourceUrl,scripts);
 return extractPageSource({sourceUrl,scripts,domOptions,title:'Synthetic shop heading',description:'合成检验说明',gallery:[images[0]],detailImages:[images[3]],priceText:'¥999.00',minimumOrderText:'100件起批'});
}
function retainedProduct(h,id){return JSON.stringify(['products','product_content','product_options','product_labels','product_quotation_fields'].map(table=>
 [table,h.sqlite.prepare(`SELECT * FROM ${table} WHERE ${table==='products'?'id':'product_id'}=?`).all(id)]));}

for(const company of companies)test(`${company.code}: two-colour DOM capture becomes one selected, categorized, editable draft without source requests or Hub writes`,async()=>{
 let sourceRequests=0;const aiSources=[];
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,fixtureImageUrls:images,
  sourceFetcher:()=>{sourceRequests++;assert.fail('A selected saved DOM source must never request the supplier');}});
 try{
  // Provider output is deliberately synthetic, not a claim about live AI or
  // Google translation quality. Real routes validate and save this output.
  const translations=new Map([['黑色 / 均码','검정 / 프리'],['灰色 / 均码','회색 / 프리'],['黑色','검정'],['灰色','회색'],['均码','프리']]);
  h.bindings.AI.run=async(model,input)=>{assert.equal(model,h.bindings.SOURCEFLOW_TEXT_MODEL);const source=JSON.parse(input.messages[1].content);aiSources.push(source);
   return {response:{title:'합성 테스트 상품',description:'합성 검수 설명',keywords:['검수 상품'],warnings:[],
    attributes:source.attributes.map((pair,sourceIndex)=>({sourceIndex,name:pair.name,value:translations.get(pair.value)??pair.value}))}};};
  const oldId='synthetic-existing-work-768',policy=h.load('app/pricing.ts').pricePolicy(h.settings),birth=new Date().toISOString();
  await h.load('db/queries.ts').insertProduct({id:oldId,owner_id:'owner',source_url:'synthetic://existing-work-step768',title:'기존 검토 상품 유지',source_price_cny:8,
   exchange_rate:policy.exchangeRate,supply_margin:policy.supplyMargin,coupang_margin:policy.coupangMargin,supply_price:5600,sale_price:9340,msrp:12150,options_count:1,
   seo_status:'완료',image_status:'대기',quote_status:'대기',registration_status:'대기',supplier_hub_status:'미전송',image_keys:'[]',goal_stage:'work',created_at:birth,updated_at:birth},policy);
  const oldBefore=retainedProduct(h,oldId),snapshot=syntheticSnapshot(company);
  const category=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'SYNTHETIC-DOM-768',categoryId:snapshot.categoryId,
   categoryPath:snapshot.categoryPath,template:null,mappings:[],hubSchema:snapshot},'synthetic-profile-768');
  const context={...h.context,category,settings:{...h.settings,brand:company.name},keywords:''};
  h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=?,goal=? WHERE id=?').run(offerId,sourceUrl,'work','job');
  h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(context),'job');

  const source=capturedPage();assert.deepEqual(source.options.map(row=>[row.key,row.name,row.unitPriceCny]),[
   ['dom-row:1','黑色 / 均码',5.3],['dom-row:2','灰色 / 均码',6.1]]);
  assert.ok(source.options.every(row=>row.supplierSku===null&&row.minimumOrder===null&&row.stock===null));
  const fingerprint=await h.load('app/source-inbox.ts').pageSourceFingerprint(source),captureId='00000000-0000-4000-8000-000000000768';
  const added=await json(await h.load('app/api/source-inbox/route.ts').POST(new Request('https://app.test/api/source-inbox',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({expectedOwnerId:'owner',expectedCompany:company,id:captureId,fingerprint,snapshot:source})})));
  assert.equal(added.storedId,captureId);assert.equal(added.storedFingerprint,fingerprint);assert.equal(added.duplicate,false);
  const ready=await json(await h.load('app/api/source-inbox/ready/route.ts').GET(new Request('https://app.test/api/source-inbox/ready?'+new URLSearchParams({sourceUrl,captureId,fingerprint,revision:'1'}))));
  assert.deepEqual(ready.capture,{sourceUrl,format:'yoofam-saved-page-capture-v1',captureId,fingerprint,revision:1});
  const inboxBefore=h.sqlite.prepare('SELECT * FROM source_inbox WHERE id=?').get(captureId),reports=[],requests=[];
  const run=async()=>h.load('app/intake-collection.ts').collectIntakeProduct(await h.load('db/collection-jobs.ts').findCollectionJob('owner','job'),{
   selectedCapture:ready.capture,signal:new AbortController().signal,fetcher:(path,init)=>{requests.push({path,method:init?.method??'GET'});return h.route(path,{method:init?.method??'GET',body:init?.body});},
   captureFromBrowser:()=>assert.fail('Saved selection must not reopen Chrome'),probeExistingFromBrowser:()=>assert.fail('Explicit selection must not probe a different capture'),onJob:value=>reports.push(value),onProgress(){}});
  assert.match(await run(),/상품 초안 저장됨/);
  const linked=await h.load('db/collection-jobs.ts').findCollectionJob('owner','job');assert.ok(linked.product_id);assert.notEqual(linked.product_id,oldId);
  assert.ok(reports.some(value=>value.product_id===linked.product_id));
  const receipt=await h.load('db/collection-results.ts').readCollectionResult('owner','job'),base='/api/products/'+linked.product_id;
  assert.equal(receipt.result.provider,'chrome-current-page-v1');assert.equal(receipt.result.sourceUrl,sourceUrl);
  assert.deepEqual(plain(receipt.result.pageOptionIdentity),{format:'yoofam-page-option-identity-v1',offerId,sourceKeys:['dom-row:1','dom-row:2']});
  assert.deepEqual(plain(receipt.result.options).map(row=>[row.name,row.unitPriceCny,row.sku,row.minimumOrder]),[['黑色 / 均码',5.3,'',null],['灰色 / 均码',6.1,'',null]]);
  const original=await json(await h.route(base+'/translation-source'));assert.equal(original.requestContext.categoryId,snapshot.categoryId);
  assert.deepEqual(original.requestContext.categoryPath,snapshot.categoryPath);
  let seo=await json(await h.route(base+'/seo-workspace'));
  assert.equal(seo.content.seo.title.value,company.name+' 합성 테스트 상품');
  const generated=h.sqlite.prepare("SELECT status,result FROM translation_jobs WHERE product_id=? AND idempotency_key='intake-auto-v1'").get(linked.product_id);
  assert.equal(generated.status,'completed');assert.equal(JSON.parse(generated.result).provenance,'generated');assert.equal(JSON.parse(generated.result).draft.title,'합성 테스트 상품');
  assert.equal(seo.content.seo.title.provenance,'generated','source-bound automatic provider output retains generated provenance');
  assert.deepEqual(seo.options.rows.map(row=>[row.originalName,row.translatedName,row.unitCostCny,row.supplierSku,row.minimumOrderQuantity]),
   [['黑色 / 均码','검정 / 프리',5.3,'',null],['灰色 / 均码','회색 / 프리',6.1,'',null]]);
  assert.ok(seo.content.assets.main.value.length);assert.ok(seo.content.assets.detail.value.length);
  const labels=await h.load('db/product-labels.ts').readProductLabels('owner',linked.product_id);
  assert.equal(labels.revision,1);assert.deepEqual(plain(labels.overrides),{common:{},options:{}});
  assert.deepEqual(Array.from(labels.structure,field=>field.id),['productName','importer','manufacturer','countryOfOrigin','netContents','material','productType','precautions','usageStandard']);
  const product=h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(linked.product_id);assert.equal(labels.updatedAt,product.created_at);
  const quote=await json(await h.route(base+'/quotation-fields'));assert.equal(quote.categoryContext.profileId,category.id);
  assert.equal(quote.resolved.schema.categoryId,snapshot.categoryId);

  // The imported draft remains freely editable without rewriting its source.
  seo=await json(await h.route(base+'/seo-workspace',{method:'PATCH',body:{expectedProductVersion:seo.productVersion,expectedContentRevision:seo.content.revision,
   expectedOptionRevision:seo.options.revision,seo:{title:'직접 검토한 합성 상품',keywordText:'검토 태그'},optionNames:[{optionId:seo.options.rows[0].id,value:'직접 검정 / 프리'}]}}));
  assert.equal(seo.content.seo.title.value,'직접 검토한 합성 상품');assert.equal(seo.content.seo.title.provenance,'manual','an explicit owner edit stays manual');assert.equal(seo.options.rows[0].translatedName,'직접 검정 / 프리');
  const edited=h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(linked.product_id).payload,aiCount=aiSources.length,downloadCount=h.stats.downloads;
  assert.match(await run(),/기존 상품 열기/);assert.equal(aiSources.length,aiCount);assert.equal(h.stats.downloads,downloadCount);
  assert.equal(h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(linked.product_id).payload,edited);
  assert.equal((await json(await h.route(base+'/seo-workspace'))).content.seo.title.value,'직접 검토한 합성 상품');
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM source_inbox WHERE id=?').get(captureId),inboxBefore);
  assert.equal(JSON.stringify(await h.load('db/collection-results.ts').readCollectionResult('owner','job')),JSON.stringify(receipt));
  assert.equal(retainedProduct(h,oldId),oldBefore,'existing synthetic work is byte-for-byte untouched');
  assert.equal(sourceRequests,0);assert.ok(h.network.length>0);assert.ok(h.network.every(host=>host==='cbu01.alicdn.com'));
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM supplier_hub_receipts').get().n,0);
  assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products WHERE id=?').get(linked.product_id).supplier_hub_status,'미전송');
  assert.ok(requests.every(item=>!item.path.includes('dispatch')&&!item.path.includes('submit')));assert.ok(aiSources.length>0);
 }finally{h.close();}
});
