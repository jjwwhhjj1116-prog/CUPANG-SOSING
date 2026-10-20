import test from 'node:test';
import assert from 'node:assert/strict';
import {optionPriceTableUI,priceTableCompanies,priceTableNodes as nodes,priceTableText as text} from './helpers/option-price-table-ui.mjs';
const change=(h,label,value)=>h.node(label).props.onChange({target:{value,valueAsNumber:Number(value)}});
const base=h=>'/api/products/'+h.product.id;
const quotation=async h=>{const response=await h.request(base(h)+'/quotation-fields');assert.equal(response.status,200);return response.json();};
const alerts=h=>nodes(h.render()).filter(node=>node.props?.role==='alert').map(text).join(' ');
const plain=value=>JSON.parse(JSON.stringify(value));
const changes=h=>{change(h,'가격 옵션 1 개당 원가','5.99');change(h,'가격 옵션 1 공급가','10000');change(h,'가격 옵션 1 판매가','16000');change(h,'가격 옵션 1 권장소비자가','');};
const stable=h=>JSON.stringify(['collection_jobs','collection_results','collection_context','category_profiles','workspace_settings','product_content'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table).all()]));
for(const company of priceTableCompanies){
 test(`unified DetailPanel policy changes recalculate locally, remain editable, then save reviewed policy/rows/manual prices in one atomic POST (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:2,integrated:true,detail:true});try{
   const before=stable(h);changes(h);change(h,'적용 환율 (CNY → KRW)','400');await h.settle();
   assert.equal(h.writes.length,0);assert.equal(h.node('가격 옵션 1 개당 원가').props.disabled,false);assert.notEqual(h.node('가격 옵션 1 공급가').props.value,'10000','explicit policy update clears earlier manual intent');
   change(h,'가격 옵션 1 공급가','10000');change(h,'가격 옵션 1 판매가','16000');change(h,'가격 옵션 1 권장소비자가','');
   assert.equal(h.button('저장하기').props.disabled,false);h.button('저장하기').props.onClick();await h.settle();
   assert.equal(alerts(h),'');assert.equal(h.saved,1);assert.deepEqual(h.writes.map(write=>write.kind),['stage-two-pricing']);assert.equal(h.writes[0].policy.exchangeRate,400);assert.equal(h.writes[0].recalculate,true);
   const quote=await quotation(h),options=await h.rows();assert.equal(options.rows[0].unitCostCny,5.99);assert.equal(quote.overrides.options['price-001'].supplyPrice,'10000');assert.equal(quote.overrides.options['price-001'].salePrice,'16000');assert.equal(quote.overrides.options['price-001'].msrp,'');assert.equal(quote.optionRevision,options.revision);
   assert.equal(stable(h),before);assert.equal(nodes(h.render()).filter(node=>node.props?.['aria-label']==='가격 옵션 1 공급가').length,1);assert.equal(h.button('저장하기').props.disabled,true);
  }finally{h.close();}
 });
 test(`automatic bundle policy picks final quantity locally and a later manual count wins the same save (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:2,integrated:true,detail:true});try{
   h.node('번들링 활성화').props.onChange({target:{checked:true}});await h.settle();change(h,'번들 최소 공급 마진액 (원)','10000');await h.settle();
   const selected=h.node('가격 옵션 1 구성 수량').props.value;assert.ok(selected>1);assert.equal(h.writes.length,0);
   change(h,'가격 옵션 1 구성 수량','2');h.button('저장하기').props.onClick();await h.settle();assert.equal(alerts(h),'');assert.equal(h.writes.length,1);assert.equal(h.writes[0].rows[0].unitsPerPack,2);assert.equal((await h.rows()).rows[0].unitsPerPack,2);
   const quote=await quotation(h),price=h.load('app/product-options.ts').calculateOptionPrices((await h.rows()).rows,h.writes[0].policy)[0].calculation;assert.equal(quote.resolved.rows.find(row=>row.optionId==='price-001').fields.salePrice.value,String(price.salePrice));
  }finally{h.close();}
 });
 test(`manual price and optional MSRP blank save atomically without changing any option payload (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:2,integrated:true});try{
   const before=plain((await h.rows()).rows);change(h,'가격 옵션 1 공급가','9000');change(h,'가격 옵션 1 판매가','15000');change(h,'가격 옵션 1 권장소비자가','');
   assert.match(text(h.node('전체 옵션 가격 요약')),/평균 공급가6,700원/);const save=h.button('옵션 가격 저장하기').props.onClick;save();save();await h.settle();
   assert.equal(alerts(h),'');assert.equal(h.saved,1);assert.deepEqual(h.writes.map(write=>write.kind),['stage-two-pricing']);assert.deepEqual(plain((await h.rows()).rows),before);const quote=await quotation(h);assert.equal(quote.overrides.options['price-001'].msrp,'');assert.equal(quote.overrides.options['price-001'].salePrice,'15000');
  }finally{h.close();}
 });
 test(`filtered original row commits all ordered rows and the latest same-tick manual intent together (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:73,integrated:true});try{
   const before=plain((await h.rows()).rows);change(h,'가격 옵션 검색','fixture-sku-62');await h.settle();change(h,'가격 옵션 62 개당 원가','5.99');change(h,'가격 옵션 62 구성 수량','3');change(h,'가격 옵션 62 공급가','10000');const save=h.button('옵션 가격 저장하기').props.onClick;change(h,'가격 옵션 62 판매가','16000');change(h,'가격 옵션 62 권장소비자가','');save();save();await h.settle();
   assert.equal(alerts(h),'');assert.equal(h.saved,1);assert.equal(h.writes.length,1);assert.equal(h.writes[0].kind,'stage-two-pricing');assert.equal(h.writes[0].rows.length,73);
   const after=plain((await h.rows()).rows);assert.equal(after[61].unitCostCny,5.99);assert.equal(after[61].unitsPerPack,3);for(let i=0;i<73;i++)if(i!==61)assert.deepEqual(after[i],before[i]);assert.deepEqual(plain((await quotation(h)).overrides.options['price-062']),{supplyPrice:'10000',salePrice:'16000',msrp:''});
  }finally{h.close();}
 });
 test(`committed atomic ACK loss keeps all drafts and blocks duplicate writes until coherent GET acknowledges everything (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:2,integrated:true,detail:true});try{
   let lost=true;h.controls.response=(url,init,response)=>{if(lost&&init.method==='POST'&&url.includes('/stage-two-pricing')){lost=false;return Response.json({error:'atomic ACK lost'},{status:503});}return response;};
   change(h,'적용 환율 (CNY → KRW)','400');await h.settle();changes(h);const save=h.button('옵션 가격 저장하기').props.onClick;save();await h.settle();save();await h.settle();assert.equal(h.writes.length,1);assert.equal(h.saved,0);assert.equal(h.node('가격 옵션 1 개당 원가').props.value,5.99);assert.equal(h.node('가격 옵션 1 공급가').props.value,'10000');assert.equal(h.node('가격 옵션 1 권장소비자가').props.value,'');assert.equal(h.node('가격 옵션 1 공급가').props.disabled,true);
   h.button('입력 유지 · 저장 결과 확인').props.onClick();await h.settle();assert.equal(alerts(h),'');assert.equal(h.saved,1);assert.equal(h.writes.length,1);assert.equal(h.node('적용 환율 (CNY → KRW)').props.value,400);assert.equal(h.node('가격 옵션 1 공급가').props.disabled,false);assert.equal(h.button('저장하기').props.disabled,true);assert.ok(h.apiCalls.some(call=>call.url.endsWith('/stage-two-pricing')&&call.method==='GET'));
  }finally{h.close();}
 });
 test(`uncommitted unknown save only releases after exact unchanged GET and never automatically replays (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:2,integrated:true});try{
   let failed=true;h.controls.before=(url,init)=>{if(failed&&init.method==='POST'&&url.includes('/stage-two-pricing')){failed=false;throw Error('network failed before commit');}};changes(h);h.button('옵션 가격 저장하기').props.onClick();await h.settle();assert.equal(h.writes.length,1);assert.equal((await h.rows()).rows[0].unitCostCny,2.99);h.button('입력 유지 · 저장 결과 확인').props.onClick();await h.settle();assert.equal(h.writes.length,1);assert.equal(h.saved,0);assert.equal(h.node('가격 옵션 1 공급가').props.value,'10000');assert.equal(h.button('옵션 가격 저장하기').props.disabled,false);
   h.button('옵션 가격 저장하기').props.onClick();await h.settle();assert.equal(alerts(h),'');assert.equal(h.writes.length,2);assert.deepEqual(h.writes[1],h.writes[0]);assert.equal(h.saved,1);assert.equal((await h.rows()).rows[0].unitCostCny,5.99);
  }finally{h.close();}
 });
 test(`forged atomic receipt does not discard drafts; independent GET proves the exact committed tuple (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:2,integrated:true});try{
   let forged=true;h.controls.response=async(url,init,response)=>{if(forged&&init.method==='POST'&&url.includes('/stage-two-pricing')&&response.ok){forged=false;const body=await response.json();body.options.options.rows.reverse();return Response.json(body);}return response;};changes(h);h.button('옵션 가격 저장하기').props.onClick();await h.settle();assert.equal(h.saved,0);assert.equal(h.writes.length,1);assert.equal(h.node('가격 옵션 1 공급가').props.disabled,true);assert.equal(h.node('가격 옵션 1 공급가').props.value,'10000');h.button('입력 유지 · 저장 결과 확인').props.onClick();await h.settle();assert.equal(alerts(h),'');assert.equal(h.saved,1);assert.equal(h.writes.length,1);assert.equal((await quotation(h)).overrides.options['price-001'].salePrice,'16000');
  }finally{h.close();}
 });
 test(`policy-only dirty draft survives parent clock refresh and is marked dirty across stages (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:2,integrated:true,detail:true});try{
   change(h,'적용 환율 (CNY → KRW)','400');await h.settle();h.changeProductVersion('2026-10-19T01:00:00.000Z');await h.settle();assert.equal(h.node('적용 환율 (CNY → KRW)').props.value,400);assert.equal(h.writes.length,0);assert.ok(nodes(h.render()).some(node=>node.props?.['data-quotation-source-step']==='가격'&&node.props['data-workspace-dirty']));assert.equal(h.button('저장하기').props.disabled,true);
  }finally{h.close();}
 });
 test(`profile ABA, policy/file locks and edited-row exclusion reject retained writes and preserve source drafts (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:2,integrated:true});try{
   change(h,'가격 옵션 1 개당 원가','5.99');change(h,'가격 옵션 1 공급가','10000');const edit=h.node('가격 옵션 1 판매가').props.onChange,save=h.button('옵션 가격 저장하기').props.onClick;
   for(const locks of [{policy:true},{policy:false,files:true},{files:false,allowed:false}]){h.locks(locks);edit({target:{value:'99000'}});save();await h.settle();assert.equal(h.writes.length,0);assert.equal(h.node('가격 옵션 1 공급가').props.value,'10000');}
   h.locks({policy:false,files:false,allowed:true});await h.settle();h.selectProfile('missing');await h.settle();h.selectProfile(undefined);await h.settle();edit({target:{value:'99000'}});save();await h.settle();assert.equal(h.writes.length,0);assert.equal(h.node('가격 옵션 1 개당 원가').props.value,5.99);change(h,'가격 옵션 1 공급가','10000');h.node('가격 옵션 1 견적 포함').props.onChange({target:{checked:false}});h.button('옵션 가격 저장하기').props.onClick();await h.settle();assert.equal(h.writes.length,0);assert.match(alerts(h),/포함 상태를 유지/);assert.equal((await h.rows()).rows[0].included,true);
  }finally{h.close();}
 });
 test(`inflight atomic profile ABA retains exact pending prices, rejects late ACK and reads committed tuple on the original scope (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:2,integrated:true});try{
   changes(h);const hold=h.holdSave(),save=h.button('옵션 가격 저장하기').props.onClick;save();await hold.arrived;h.selectProfile('missing');await h.settle();assert.equal(h.apiCalls.find(call=>call.method==='POST').signal.aborted,true);hold.release();await h.settle();save();assert.equal(h.writes.length,1);assert.equal(h.saved,0);h.selectProfile(undefined);await h.settle();h.button('입력 유지 · 저장 결과 확인').props.onClick();await h.settle();assert.equal(alerts(h),'');assert.equal(h.saved,1);assert.equal(h.writes.length,1);assert.equal(h.node('가격 옵션 1 개당 원가').props.value,5.99);assert.equal(h.node('가격 옵션 1 공급가').props.value,'10000');assert.equal(h.node('가격 옵션 1 권장소비자가').props.value,'');
  }finally{h.close();}
 });
 test(`parent clock change fences late atomic response and retains recoverable full attempt (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:2,integrated:true});try{
   changes(h);const hold=h.holdSave();h.button('옵션 가격 저장하기').props.onClick();await hold.arrived;h.changeProductVersion('2026-10-19T01:00:00.000Z');await h.settle();hold.release();await h.settle();assert.equal(h.saved,0);assert.equal(h.writes.length,1);assert.equal(h.node('가격 옵션 1 공급가').props.value,'10000');assert.equal(h.node('가격 옵션 1 공급가').props.disabled,true);h.button('입력 유지 · 저장 결과 확인').props.onClick();await h.settle();assert.equal(h.saved,1);assert.equal(h.writes.length,1);assert.equal((await quotation(h)).overrides.options['price-001'].salePrice,'16000');
  }finally{h.close();}
 });
 test(`invalid numeric policy remains editable without losing option and manual drafts; corrected setting recalculates only explicitly (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:2,integrated:true,detail:true});try{
   changes(h);change(h,'적용 환율 (CNY → KRW)','');await h.settle();assert.equal(h.node('적용 환율 (CNY → KRW)').props.value,'');assert.equal(h.node('가격 옵션 1 공급가').props.value,'10000');assert.equal(h.node('가격 옵션 1 개당 원가').props.value,5.99);assert.equal(h.writes.length,0);assert.equal(h.button('저장하기').props.disabled,true);change(h,'적용 환율 (CNY → KRW)','400');await h.settle();assert.notEqual(h.node('가격 옵션 1 공급가').props.value,'10000');assert.equal(h.node('가격 옵션 1 개당 원가').props.disabled,false);h.button('저장하기').props.onClick();await h.settle();assert.equal(alerts(h),'');assert.equal(h.saved,1);assert.equal(h.writes.length,1);assert.equal(h.writes[0].policy.exchangeRate,400);
  }finally{h.close();}
 });

}
