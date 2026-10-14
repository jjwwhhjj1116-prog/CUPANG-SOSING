import test from 'node:test';
import assert from 'node:assert/strict';
import { optionPriceTableUI, priceTableCompanies, priceTableNodes as nodes, priceTableText as text } from './helpers/option-price-table-ui.mjs';
const change=(h,label,value)=>h.node(label).props.onChange({target:{value,valueAsNumber:Number(value)}});
const base=h=>'/api/products/'+h.product.id;
const quotation=async h=>{const response=await h.request(base(h)+'/quotation-fields');assert.equal(response.status,200);return response.json();};
const alerts=h=>nodes(h.render()).filter(node=>node.props?.role==='alert').map(text).join(' ');
const writes=(h,kind)=>h.writes.filter(value=>value.kind===kind);

for(const company of priceTableCompanies){
 test(`actual DetailPanel policy edits synchronously lock the single grid and saved policy rebases both source and manual drafts (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:2,integrated:true,detail:true});try{
   change(h,'가격 옵션 1 개당 원가','5.99');change(h,'가격 옵션 1 공급가','10000');change(h,'가격 옵션 1 판매가','16000');change(h,'가격 옵션 1 권장소비자가','');
   const retained=h.button('옵션 저장·가격 계산').props.onClick,form=nodes(h.render()).find(value=>value.type==='form'&&value.props['data-quotation-source-step']==='가격'),rate=nodes(form).find(value=>value.type==='input'&&value.props.type==='number');
   rate.props.onChange({target:{value:'400'}});retained();assert.equal(h.writes.length,0,'same-tick policy draft lock precedes a parent render');
   const updated=nodes(h.render()).find(value=>value.type==='form'&&value.props['data-quotation-source-step']==='가격');const save=updated.props.onSubmit({preventDefault(){}});retained();await save;await h.settle();assert.equal(writes(h,'pricing').length,1);assert.equal(writes(h,'options').length,0);assert.equal(writes(h,'quotation-fields').length,0);
   assert.equal(h.node('가격 옵션 1 개당 원가').props.value,5.99);assert.equal(h.node('가격 옵션 1 공급가').props.value,'10000');assert.equal(h.node('가격 옵션 1 권장소비자가').props.value,'');
   h.button('입력 유지 · 최신 가격 적용').props.onClick();await h.settle();h.button('입력 유지·최신 가격 조회').props.onClick();await h.settle();h.button('옵션 저장·가격 계산').props.onClick();await h.settle();
   assert.equal(alerts(h),'');assert.equal(writes(h,'pricing').length,1);assert.equal(writes(h,'options').length,1);assert.equal(writes(h,'quotation-fields').length,1);assert.equal((await h.rows()).rows[0].unitCostCny,5.99);assert.equal((await quotation(h)).overrides.options['price-001'].msrp,'');
   assert.equal(nodes(h.render()).filter(value=>value.props?.['aria-label']==='가격 옵션 1 공급가').length,1,'one price editor in the actual workspace');
  }finally{h.close();}
 });
 test(`in-flight source save during profile replacement remains recoverable without repeating the old write (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:2,integrated:true});try{
   change(h,'가격 옵션 1 개당 원가','5.99');change(h,'가격 옵션 1 공급가','10000');change(h,'가격 옵션 1 판매가','16000');const hold=h.holdSave(),save=h.button('옵션 저장·가격 계산').props.onClick;save();await Promise.race([hold.arrived,new Promise((_,reject)=>setTimeout(()=>reject(Error('source PATCH did not start')),5000))]);
   h.selectProfile('missing');await h.settle();const source=h.apiCalls.find(value=>value.method==='PATCH');assert.equal(source.signal.aborted,true);hold.release();await h.settle();save();assert.equal(writes(h,'options').length,1);assert.equal(writes(h,'quotation-fields').length,0);
   h.button('입력 유지 · 저장 결과 확인').props.onClick();await h.settle();h.selectProfile(undefined);await h.settle();assert.equal((await h.rows()).rows[0].unitCostCny,5.99);assert.equal(h.node('가격 옵션 1 개당 원가').props.disabled,false);assert.equal(writes(h,'options').length,1);assert.equal(writes(h,'quotation-fields').length,0);
  }finally{h.close();}
 });
 test(`one price grid edits saved quotation prices and optional MSRP blank without rewriting source rows (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:2,integrated:true});try{
   const before=JSON.stringify(await h.rows());change(h,'가격 옵션 1 공급가','9000');change(h,'가격 옵션 1 판매가','15000');change(h,'가격 옵션 1 권장소비자가','');
   const summary=text(h.node('전체 옵션 가격 요약'));assert.match(summary,/평균 공급가6,700원/);assert.match(summary,/평균 판매가11,165원/);
   const save=h.button('옵션 저장·가격 계산').props.onClick;save();save();await h.settle();assert.equal(h.saved,1);assert.equal(writes(h,'options').length,0);assert.equal(writes(h,'quotation-fields').length,1);
   const result=await quotation(h);assert.equal(result.overrides.options['price-001'].supplyPrice,'9000');assert.equal(result.overrides.options['price-001'].salePrice,'15000');assert.equal(result.overrides.options['price-001'].msrp,'');
   assert.equal(JSON.stringify(await h.rows()),before);assert.equal(h.protectedSnapshot(),h.before);assert.equal(h.node('가격 옵션 1 권장소비자가').props.value,'');
  }finally{h.close();}
 });
 test(`filtered original row saves whole source rows then exact latest quotation and synchronous price intent (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:73,integrated:true});try{
   const before=await h.rows();change(h,'가격 옵션 검색','fixture-sku-62');await h.settle();
   change(h,'가격 옵션 62 개당 원가','5.99');change(h,'가격 옵션 62 구성 수량','3');change(h,'가격 옵션 62 공급가','10000');
   const retained=h.button('옵션 저장·가격 계산').props.onClick;change(h,'가격 옵션 62 판매가','16000');change(h,'가격 옵션 62 권장소비자가','');retained();retained();await h.settle();
   assert.equal(alerts(h),'');assert.equal(h.saved,1);assert.equal(h.writes.length,2);assert.deepEqual(h.writes.map(value=>value.kind),['options','quotation-fields']);assert.equal(h.writes[0].rows.length,73);
   const callKinds=h.apiCalls.map(value=>value.method+' '+new URL(value.url,'https://app.test').pathname.split('/').at(-1));assert.ok(callKinds.slice(callKinds.indexOf('PATCH options')+1,callKinds.indexOf('PUT quotation-fields')).includes('GET quotation-fields'));
   const after=await h.rows();assert.equal(after.rows[61].unitCostCny,5.99);assert.equal(after.rows[61].unitsPerPack,3);for(let i=0;i<73;i++)if(i!==61)assert.deepEqual(after.rows[i],before.rows[i]);
   const result=await quotation(h);assert.equal(result.optionRevision,after.revision);assert.deepEqual(JSON.parse(JSON.stringify(result.overrides.options['price-062'])),{supplyPrice:'10000',salePrice:'16000',msrp:''});assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
 });
 test(`committed option ACK 503 blocks duplicate source write and recovers by explicit reads before price save (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:2,integrated:true});try{
   let lost=true;h.controls.response=(url,init,response)=>{if(lost&&init.method==='PATCH'){lost=false;return Response.json({error:'committed source ACK lost'},{status:503});}return response;};
   change(h,'가격 옵션 1 개당 원가','5.99');change(h,'가격 옵션 1 공급가','10000');change(h,'가격 옵션 1 판매가','16000');change(h,'가격 옵션 1 권장소비자가','');
   const save=h.button('옵션 저장·가격 계산').props.onClick;save();await h.settle();save();await h.settle();assert.equal(writes(h,'options').length,1);assert.equal(writes(h,'quotation-fields').length,0);assert.equal(h.saved,0);assert.equal(h.node('가격 옵션 1 개당 원가').props.disabled,true);
   h.button('입력 유지 · 저장 결과 확인').props.onClick();await h.settle();assert.equal(writes(h,'options').length,1);assert.equal(h.node('가격 옵션 1 공급가').props.value,'10000');assert.equal(h.node('가격 옵션 1 권장소비자가').props.value,'');
   h.button('입력 유지·최신 가격 조회').props.onClick();await h.settle();h.button('옵션 저장·가격 계산').props.onClick();await h.settle();assert.equal(writes(h,'options').length,1);assert.equal(writes(h,'quotation-fields').length,1);assert.equal((await quotation(h)).overrides.options['price-001'].salePrice,'16000');
  }finally{h.close();}
 });
 test(`committed manual price ACK 503 keeps blank intent and recovers exactly once without a second PUT (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:2,integrated:true,detail:true});try{
   const policy=nodes(h.render()).find(value=>value.type==='form'&&value.props['data-quotation-source-step']==='가격').props.onSubmit;
   let lost=true;h.controls.response=(url,init,response)=>{if(lost&&init.method==='PUT'){lost=false;return Response.json({error:'committed price ACK lost'},{status:503});}return response;};
   change(h,'가격 옵션 1 공급가','10000');change(h,'가격 옵션 1 판매가','16000');change(h,'가격 옵션 1 권장소비자가','');const save=h.button('옵션 저장·가격 계산').props.onClick;save();await h.settle();save();await h.settle();
   assert.equal(writes(h,'quotation-fields').length,1);assert.equal(h.saved,0);assert.equal(h.node('가격 옵션 1 공급가').props.disabled,true);assert.equal(h.node('가격 옵션 1 권장소비자가').props.value,'');await policy({preventDefault(){}});assert.equal(writes(h,'pricing').length,0,'unknown price ACK locks a retained policy submit');
   h.button('입력 유지·최신 가격 조회').props.onClick();await h.settle();assert.equal(h.saved,1);assert.equal(writes(h,'quotation-fields').length,1);assert.equal(h.button('옵션 저장·가격 계산').props.disabled,true);assert.equal((await quotation(h)).overrides.options['price-001'].msrp,'');
   const form=nodes(h.render()).find(value=>value.type==='form'&&value.props['data-quotation-source-step']==='가격');assert.equal(nodes(form).find(value=>value.type==='fieldset').props.disabled,false,'exact read recovery releases the policy lock');
  }finally{h.close();}
 });
 test(`source ACK succeeds but latest quotation fails; retry preserves price draft and sends no second source PATCH (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:2,integrated:true});try{
   let failed=false;h.controls.response=(url,init,response)=>{if(!failed&&writes(h,'options').length&&init.method===undefined&&url.endsWith('/quotation-fields')){failed=true;return Response.json({error:'latest quotation unavailable'},{status:503});}return response;};
   change(h,'가격 옵션 1 개당 원가','5.99');change(h,'가격 옵션 1 공급가','10000');change(h,'가격 옵션 1 판매가','16000');change(h,'가격 옵션 1 권장소비자가','');h.button('옵션 저장·가격 계산').props.onClick();await h.settle();
   assert.equal(writes(h,'options').length,1);assert.equal(writes(h,'quotation-fields').length,0);assert.equal(h.saved,1);assert.match(alerts(h),/옵션은 저장됐지만/);assert.equal(h.node('가격 옵션 1 권장소비자가').props.value,'');assert.equal((await h.rows()).rows[0].unitCostCny,5.99);
   h.button('입력 유지·최신 가격 조회').props.onClick();await h.settle();h.button('옵션 저장·가격 계산').props.onClick();await h.settle();assert.equal(h.saved,2);assert.equal(writes(h,'options').length,1);assert.equal(writes(h,'quotation-fields').length,1);
  }finally{h.close();}
 });
 test(`profile ABA, policy/file locks and edited-row exclusion reject retained writes and preserve owned source drafts (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:2,integrated:true});try{
   change(h,'가격 옵션 1 개당 원가','5.99');change(h,'가격 옵션 1 공급가','10000');const edit=h.node('가격 옵션 1 판매가').props.onChange,save=h.button('옵션 저장·가격 계산').props.onClick;
   for(const locks of [{policy:true},{policy:false,files:true},{files:false,allowed:false}]){h.locks(locks);edit({target:{value:'99000'}});save();await h.settle();assert.equal(h.writes.length,0);assert.equal(h.node('가격 옵션 1 공급가').props.value,'10000');}
   h.locks({policy:false,files:false,allowed:true});await h.settle();h.selectProfile('missing');await h.settle();h.selectProfile(undefined);await h.settle();edit({target:{value:'99000'}});save();await h.settle();assert.equal(h.writes.length,0);assert.notEqual(h.node('가격 옵션 1 공급가').props.value,'10000');assert.equal(h.node('가격 옵션 1 개당 원가').props.value,5.99);
   change(h,'가격 옵션 1 공급가','10000');h.node('가격 옵션 1 견적 포함').props.onChange({target:{checked:false}});h.button('옵션 저장·가격 계산').props.onClick();await h.settle();assert.equal(h.writes.length,0);assert.match(alerts(h),/포함 상태를 유지/);assert.equal((await h.rows()).rows[0].included,true);
  }finally{h.close();}
 });
}
