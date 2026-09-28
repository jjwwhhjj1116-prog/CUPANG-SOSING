import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as parse5 from 'parse5';
import {webcrypto} from 'node:crypto';
function load(file) {
 const exports={}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,URL,URLSearchParams,Date,TextEncoder,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,crypto:webcrypto,structuredClone,require(name){if(name==='parse5')return parse5;return load(name.slice(2)+'.ts');}});return exports;
}
const {parseAlibabaProduct:parse}=load('app/alibaba-product-result.ts');
const url='https://detail.1688.com/offer/813724060928.html';
// Synthetic candidate fixture, not a captured response from the user's offer.
const fixture=()=>({result:{success:true,result:{offerId:'813724060928',subject:'原文商品',minOrderQuantity:'2',
 description:'<script>unsafe()</script>',productImage:{images:['https://cbu01.alicdn.com/main.jpg']},
 productSkuInfos:[{skuId:'5627721589407',price:'25.6',amountOnSale:'0',skuAttributes:[{value:'黑色',skuImageUrl:'https://cbu01.alicdn.com/black.jpg'},{value:'M'}]},
 {skuId:'5627721589408',price:'28',amountOnSale:null,skuAttributes:[{value:'黑色',skuImageUrl:'https://cbu01.alicdn.com/black.jpg'},{value:'L'}]}],
 productAttribute:[{attributeName:'材质',value:'尼龙'}]}}});
test('candidate mapping preserves SKU prices, zero versus unknown stock and shared image identity',()=>{
 const result=parse(fixture(),url);assert.equal(result.offerId,'813724060928');assert.equal(result.options.length,2);
 assert.equal(result.options[0].sku,'5627721589407');assert.equal(result.options[0].unitPriceCny,25.6);
 assert.equal(result.options[0].minimumOrder,2);assert.equal(result.options[0].stock,0);assert.equal(result.options[1].stock,null);
 assert.equal(result.options[0].name,'黑色 / M');assert.equal(result.options[0].imageIndex,result.options[1].imageIndex);
 assert.equal(result.images.length,2);assert.equal(result.images[0].role,'main');assert.equal(result.attributes[0].value,'尼龙');
 assert.equal(result.description,'');
});
test('wrong identity, missing prices/MOQ, duplicate SKU and non-CDN images cannot create draft input',()=>{
 for(const mutate of [p=>p.offerId='999',p=>delete p.minOrderQuantity,p=>p.productSkuInfos[0].price=null,
 p=>p.productSkuInfos[0].price='25-30',p=>p.productSkuInfos[0].skuId=Number.MAX_SAFE_INTEGER+1,
 p=>p.productSkuInfos[1].skuId=p.productSkuInfos[0].skuId,p=>p.productSkuInfos[0].amountOnSale='bad',
 p=>p.productSkuInfos[0].skuAttributes=[],p=>p.productImage.images=['https://localhost/image'],
 p=>p.productImage.images=['https://alicdn.com.attacker.test/image']]) {const f=fixture();mutate(f.result.result);assert.throws(()=>parse(f,url));}
 const f=fixture();f.result.result.productSkuInfos[0].price=null;f.result.result.productSkuInfos[0].jxhyPrice='1';
 f.result.result.productSaleInfo={priceRangeList:[{startQuantity:1,price:'2'}]};assert.throws(()=>parse(f,url),/원가/);
});
test('candidate receipt feeds the existing captured category/settings draft preparation without sending',()=>{
 const settings=load('app/observed-price-preset.ts').applyObservedPricePreset(load('app/workspace-settings.ts').defaultSettings);
 const now=new Date().toISOString();const receipt=parse(fixture(),url);
 const draft=load('app/collection-product.ts').prepareCollectionProduct('owner',{offer_id:receipt.offerId,source_url:url,
 context:{category:{id:'80719',categoryId:'80719',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓']},settings:{...settings,manufacturer:'입력 제조사'},keywords:'사용자 키워드'}},receipt,'product',now);
 assert.equal(draft.content.seo.title.value,'原文商品');assert.equal(draft.content.seo.title.provenance,'collected');
 assert.equal(draft.content.label.manufacturer.value,'입력 제조사');assert.equal(draft.options.rows[0].supplierSku,'5627721589407');
 assert.equal(draft.options.rows[0].unitCostCny,25.6);assert.equal(draft.options.rows[1].unitCostCny,28);
});

test('detail HTML supplies original text, ordered images and explicit color/size to draft fields',()=>{
 const f=fixture();f.result.result.description='<p>원문 &amp; 설명</p><p><img src="//cbu01.alicdn.com/detail.jpg?a=1&amp;b=2"></p><img data-src="https://cbu01.alicdn.com/detail2.jpg" src="data:image/gif;base64,placeholder">';
 f.result.result.productSkuInfos[0].skuAttributes[0].attributeName='颜色';f.result.result.productSkuInfos[0].skuAttributes[1].attributeName='尺码';
 const result=parse(f,url);assert.equal(result.description,'원문 & 설명');assert.equal(result.options[0].color,'黑色');assert.equal(result.options[0].size,'M');
 assert.deepEqual(JSON.parse(JSON.stringify(result.images.slice(2))),[{url:'https://cbu01.alicdn.com/detail.jpg?a=1&b=2',role:'detail'},{url:'https://cbu01.alicdn.com/detail2.jpg',role:'detail'}]);
 assert.equal(result.options[0].imageIndex,1);
 const settings=load('app/workspace-settings.ts').defaultSettings;
 const draft=load('app/collection-product.ts').prepareCollectionProduct('owner',{offer_id:result.offerId,context:{category:{id:'80719',categoryId:'80719',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓']},settings}},result,'p',new Date().toISOString());
 assert.equal(draft.content.seo.description.value,'원문 & 설명');assert.equal(draft.options.rows[0].color,'黑色');assert.equal(draft.options.rows[0].size,'M');
 assert.equal(draft.options.rows[0].provenance.color,'collected');
});

test('markup is inert, entity-decoded once, bounded and unsupported image sources fail explicitly',()=>{
 const parseDescription=load('app/alibaba-description.ts').parseAlibabaDescription;
 const d=parseDescription('<script><img src="https://evil.test/a"></script><style>bad</style><template><img src="https://evil.test/a"></template><p>safe &lt;img&gt;</p><!-- ignore --><svg><image href="https://evil.test/a"/></svg>');
 assert.equal(d.text,'safe <img>');assert.equal(d.images.length,0);
 for(const html of ['<img src="https://alicdn.com.evil.test/a">','<img src="javascript:alert(1)">','<img src="/relative.jpg">','<img>','x'.repeat(20001),'x'.repeat(2*1024*1024+1)])assert.throws(()=>parseDescription(html));
 const f=fixture();f.result.result.description='<img src="https://cbu01.alicdn.com/main.jpg">';
 const shared=parse(f,url);assert.equal(shared.images.filter(image=>image.url==='https://cbu01.alicdn.com/main.jpg').length,2);
 assert.equal(shared.images.at(-1).role,'detail');assert.equal(shared.options[0].imageIndex,1);
 const repeated=parseDescription('<img src="https://cbu01.alicdn.com/a.jpg"><img src="https://cbu01.alicdn.com/a.jpg">');assert.equal(repeated.images.length,1);
});

test('candidate collector combines signed request with validated receipt and refuses other products',async()=>{
 const collect=load('app/alibaba-product-collector.ts').collectAlibabaProduct;
 let calls=0;const options={fetcher:async(target)=>{calls++;assert.equal(new URL(target).hostname,'gw.open.1688.com');return Response.json(fixture());}};
 const credentials={appKey:'12345',appSecret:'test-secret',accessToken:'test-token'};
 const receipt=await collect(url,credentials,options);assert.equal(calls,1);assert.equal(receipt.options.length,2);assert.equal(receipt.offerId,'813724060928');
 const wrong=fixture();wrong.result.result.offerId='999';await assert.rejects(collect(url,credentials,{fetcher:async()=>Response.json(wrong)}),/상품번호/);
});


test('single explicit SKU without variant attributes preserves source facts through draft creation',()=>{
 const f=fixture();const product=f.result.result;product.productSkuInfos=product.productSkuInfos.slice(0,1);
 product.productSkuInfos[0].skuAttributes=[];
 const receipt=parse(f,url);const option=receipt.options[0];
 assert.equal(option.name,product.subject);assert.equal(option.sku,'5627721589407');
 assert.equal(option.unitPriceCny,25.6);assert.equal(option.stock,0);assert.equal(option.minimumOrder,2);
 assert.equal(option.color,undefined);assert.equal(option.size,undefined);assert.equal(option.imageIndex,undefined);
 const settings=load('app/workspace-settings.ts').defaultSettings;
 const draft=load('app/collection-product.ts').prepareCollectionProduct('owner',{offer_id:receipt.offerId,source_url:url,
 context:{category:{id:'80719',categoryId:'80719',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓']},settings}},receipt,'single',new Date().toISOString());
 assert.equal(draft.options.rows.length,1);assert.equal(draft.options.rows[0].supplierSku,option.sku);
 assert.equal(draft.options.rows[0].unitCostCny,25.6);assert.equal(draft.content.seo.title.value,product.subject);
 for(const mutate of [p=>delete p.productSkuInfos[0].skuAttributes,p=>p.productSkuInfos[0].skuAttributes=null,
 p=>delete p.productSkuInfos[0].skuId,p=>delete p.productSkuInfos[0].price,p=>p.subject='',
 p=>p.productSkuInfos.push({...p.productSkuInfos[0],skuId:'5627721589408'})]){
 const invalid=structuredClone(f);mutate(invalid.result.result);assert.throws(()=>parse(invalid,url));
 }
});
