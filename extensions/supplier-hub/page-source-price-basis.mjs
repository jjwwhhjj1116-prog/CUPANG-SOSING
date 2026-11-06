const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const raw=v=>v==null?null:typeof v==='boolean'?v:typeof v==='string'&&v.length<=128?v:typeof v==='number'&&Number.isFinite(v)?v:'[invalid-price]';
const id=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):typeof v==='string'&&/^\d{1,30}$/u.test(v)?v:null;
export const pagePriceNumber=v=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<=1e8?v:typeof v==='string'&&/^\d+(?:\.\d+)?$/u.test(v.trim())&&Number(v)>0&&Number(v)<=1e8?Number(v):null;
const BASE='result.global.globalData.model.tradeModel',MAIN='result.data.mainPrice.fields';
const FLAGS=[BASE+'.tradeWithoutPromotion.offerIsSkuTradeSupported',MAIN+'.finalPriceModel.tradeWithoutPromotion.OfferIsSkuTradeSupported'];
const TIERS=[BASE+'.offerPriceModel.originalPrices',MAIN+'.priceModel.originalPrices',BASE+'.tradeWithoutPromotion.offerPriceRanges',MAIN+'.finalPriceModel.tradeWithoutPromotion.offerPriceRanges'];
const MAPS=[BASE+'.tradeWithoutPromotion.skuMapOriginal',MAIN+'.finalPriceModel.tradeWithoutPromotion.skuMapOriginal'];
const get=(root,path)=>path.split('.').reduce((v,k)=>object(v)&&Object.hasOwn(v,k)?v[k]:undefined,root);
/** Inert browser declarations only. Call after primary context identity/privacy guards. */
export function readPagePriceBasis(root,options){
 const current=get(root,'result.data.Root.fields.dataJson.skuModel.skuInfoMap');
 const rows=options.map(o=>{const r=current[o.key];return {key:o.key,sku:o.supplierSku,specId:typeof r.specId==='string'?r.specId:null,observedPrice:raw(r.discountPrice??r.price??r.skuPrice??r.consignPrice),originalPrice:raw(r.price)};});
 const flags=FLAGS.filter(p=>get(root,p)!==undefined).map(path=>({path,value:typeof get(root,path)==='boolean'?get(root,path):null}));
 const tiers=TIERS.filter(p=>get(root,p)!==undefined).map(path=>({path,rows:Array.isArray(get(root,path))?get(root,path).slice(0,201).map(r=>({beginAmount:raw(r?.beginAmount),price:raw(r?.price)})):null}));
 const originalSkus=MAPS.filter(p=>get(root,p)!==undefined).map(path=>({path,rows:Array.isArray(get(root,path))?get(root,path).slice(0,501).map(row=>{
  // Only the observed exact local reference form; never evaluate arbitrary JSON paths.
  const ref=object(row)&&Object.keys(row).length===1&&typeof row.$ref==='string'?/^\$\.result\.global\.globalData\.model\.tradeModel\.skuMap\[(\d{1,3})\]$/u.exec(row.$ref):null;
  const r=ref?get(root,BASE+'.skuMap')?.[Number(ref[1])]:row;
  return {sku:id(r?.skuId),specId:typeof r?.specId==='string'?r.specId:null,price:raw(r?.price),discountPrice:raw(r?.discountPrice)};
 }):null}));
 const facts={format:'1688-page-price-basis-v1',offerId:id(get(root,'result.global.globalData.model.offerDetail.offerId')),source:'1688-context-primary-v1',rows,flags,tiers,originalSkus};
 return {...facts,selection:selection(facts)};
}
function selection(b){
 const matching=(rows)=>Array.isArray(rows)&&rows.length===b.rows.length&&new Set(rows.map(r=>r.sku)).size===rows.length&&b.rows.every(r=>rows.some(s=>s.sku===r.sku&&s.specId===r.specId));
 const flag=b.flags.find(r=>r.path===FLAGS[0]);if(!flag||b.flags.some(r=>r.value!==flag.value)||flag.value===null)return 'observed-page';
 if(b.originalSkus.some(m=>!matching(m.rows)))return 'observed-page';
 const tiers=b.tiers.map(t=>t.rows),validTiers=tiers.every(t=>Array.isArray(t)&&t.length>0&&t.length<=200&&t.every(r=>Number.isSafeInteger(r.beginAmount)&&r.beginAmount>0&&pagePriceNumber(r.price)!==null));
 if(flag.value===false){
  const primary=b.tiers.find(t=>t.path===TIERS[0]);if(!primary||!validTiers)return 'observed-page';
  const t=primary.rows,first=pagePriceNumber(t[0].price);
  if(tiers.some(m=>JSON.stringify(m.map(r=>[r.beginAmount,pagePriceNumber(r.price)]))!==JSON.stringify(t.map(r=>[r.beginAmount,pagePriceNumber(r.price)]))))return 'observed-page';
  if(b.originalSkus.some(m=>m.rows.some(r=>r.price!==null&&pagePriceNumber(r.price)!==first||r.discountPrice!==null&&pagePriceNumber(r.discountPrice)!==first)))return 'observed-page';
  if(b.rows.some(r=>r.originalPrice!==null&&pagePriceNumber(r.originalPrice)!==first))return 'observed-page';
  return 'common-original-first-tier';
 }
 if(b.originalSkus.length<1||!validTiers)return 'observed-page';
 const first=b.originalSkus[0].rows;
 if(first.some(r=>pagePriceNumber(r.price)===null))return 'observed-page';
 if(b.originalSkus.some(m=>m.rows.some(r=>{const p=pagePriceNumber(first.find(s=>s.sku===r.sku).price);return pagePriceNumber(r.price)!==p||r.discountPrice!==null&&pagePriceNumber(r.discountPrice)!==p;})))return 'observed-page';
 if(b.rows.some(r=>r.originalPrice!==null&&pagePriceNumber(r.originalPrice)!==pagePriceNumber(first.find(s=>s.sku===r.sku).price)))return 'observed-page';
 return 'original-per-sku';
}
export function pagePriceDefault(b,key){const r=b.rows.find(r=>r.key===key);if(!r)return null;return b.selection==='common-original-first-tier'?pagePriceNumber(b.tiers.find(t=>t.path===TIERS[0]).rows[0].price):b.selection==='original-per-sku'?pagePriceNumber(b.originalSkus[0].rows.find(s=>s.sku===r.sku).price):pagePriceNumber(r.observedPrice);}
const fail=()=>{throw Error('페이지 원가 근거·전체 옵션·검토 원가의 연결을 확인해주세요.');};
/** Recompute from full evidence, never from a reviewed subset. Legacy absence is handled by callers. */
export function validatePagePriceBasis(b,options,{reviewed=false,receipt=false,offerId}={}){
 const keys=['format','offerId','source','rows','flags','tiers','originalSkus','selection'];if(!object(b)||Object.keys(b).some(k=>![...keys,'review'].includes(k))||!keys.every(k=>Object.hasOwn(b,k))||b.format!=='1688-page-price-basis-v1'||b.source!=='1688-context-primary-v1'||!id(b.offerId)||offerId!==undefined&&b.offerId!==offerId)fail();
 const str=(s,max)=>typeof s==='string'&&s.length>0&&s.length<=max&&!/[\u0000-\u001f]/u.test(s)&&!['__proto__','prototype','constructor'].includes(s);
 const scalar=v=>v===null||raw(v)===v;
 if(!Array.isArray(b.rows)||!b.rows.length||b.rows.length>500||new Set(b.rows.map(r=>r.key)).size!==b.rows.length||new Set(b.rows.map(r=>r.sku)).size!==b.rows.length)fail();
 for(const r of b.rows)if(!exact(r,['key','sku','specId','observedPrice','originalPrice'])||!str(r.key,200)||!id(r.sku)||r.specId!==null&&!str(r.specId,200)||!scalar(r.observedPrice)||!scalar(r.originalPrice))fail();
 for(const [key,paths]of [['flags',FLAGS],['tiers',TIERS],['originalSkus',MAPS]]){const rows=b[key];if(!Array.isArray(rows)||rows.length>paths.length||new Set(rows.map(r=>r.path)).size!==rows.length)fail();for(const r of rows){if(!exact(r,['path',key==='flags'?'value':'rows'])||!paths.includes(r.path))fail();if(key==='flags'){if(r.value!==null&&typeof r.value!=='boolean')fail();}else if(r.rows!==null){if(!Array.isArray(r.rows)||r.rows.length>(key==='tiers'?201:501))fail();for(const s of r.rows)if(key==='tiers'?!exact(s,['beginAmount','price'])||!scalar(s.beginAmount)||!scalar(s.price):!exact(s,['sku','specId','price','discountPrice'])||s.sku!==null&&!id(s.sku)||s.specId!==null&&!str(s.specId,200)||!scalar(s.price)||!scalar(s.discountPrice))fail();}}}
 if(b.selection!==selection(b))fail();
 let sourceKeys=b.rows.map(r=>r.key),overrides=[];
 if(Object.hasOwn(b,'review')){if(!reviewed||!exact(b.review,['sourceKeys','overrides'])||!Array.isArray(b.review.sourceKeys)||!b.review.sourceKeys.length||b.review.sourceKeys.length>200||!Array.isArray(b.review.overrides)||b.review.overrides.length>b.review.sourceKeys.length)fail();sourceKeys=b.review.sourceKeys;overrides=b.review.overrides;let prev=-1;for(const key of sourceKeys){const i=b.rows.findIndex(r=>r.key===key);if(i<=prev)fail();prev=i;}const seen=new Set();for(const r of overrides){if(!exact(r,['key','unitPriceCny'])||!sourceKeys.includes(r.key)||seen.has(r.key)||pagePriceNumber(r.unitPriceCny)!==r.unitPriceCny||r.unitPriceCny===pagePriceDefault(b,r.key))fail();seen.add(r.key);}}
 if(options.length!==sourceKeys.length)fail();for(const [i,o]of options.entries()){const key=sourceKeys[i],r=b.rows.find(r=>r.key===key);if(!r||(!receipt&&o.key!==key)||(receipt?o.sku:o.supplierSku)!==r.sku||o.unitPriceCny!==(overrides.find(x=>x.key===key)?.unitPriceCny??pagePriceDefault(b,key)))fail();}
 return b;
}
export function reviewPagePriceBasis(b,options){const facts={...b};delete facts.review;const review={sourceKeys:options.map(o=>o.key),overrides:options.filter(o=>o.unitPriceCny!==pagePriceDefault(b,o.key)).map(o=>({key:o.key,unitPriceCny:o.unitPriceCny}))};return validatePagePriceBasis({...facts,review},options,{reviewed:true});}
