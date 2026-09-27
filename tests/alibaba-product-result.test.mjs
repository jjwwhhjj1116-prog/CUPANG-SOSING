import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file) {
 const exports={}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,URL,Date,TextEncoder,structuredClone,require(name){return load(name.slice(2)+'.ts');}});return exports;
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
 context:{category:{id:'80719'},settings:{...settings,manufacturer:'입력 제조사'},keywords:'사용자 키워드'}},receipt,'product',now);
 assert.equal(draft.content.seo.title.value,'原文商品');assert.equal(draft.content.seo.title.provenance,'collected');
 assert.equal(draft.content.label.manufacturer.value,'입력 제조사');assert.equal(draft.options.rows[0].supplierSku,'5627721589407');
 assert.equal(draft.options.rows[0].unitCostCny,25.6);assert.equal(draft.options.rows[1].unitCostCny,28);
});
