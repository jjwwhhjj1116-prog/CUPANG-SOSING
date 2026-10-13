import test from 'node:test';
import assert from 'node:assert/strict';
import {barcodeCompanies,barcodeFixture,barcodeUI,deferred,nodes,plain,text} from './helpers/managed-product-barcode-ui.mjs';

const enabled=(panel,label)=>panel.button(label)&&!panel.button(label).props.disabled;
const sameReadOnly=(f,before)=>{assert.equal(f.snapshot(),before);assert.ok(f.requests.every(request=>request.method==='GET'));};

for(const company of barcodeCompanies)test(`owned saved barcode preview and explicit verified PNG/print preserve source and exact leading zeros (${company.code})`,async()=>{
 const f=await barcodeFixture(company,{mutate(rows){rows[0]['구매정보']=JSON.stringify([{'상품명':rows[0]['상품명'],'바코드':rows[0]['바코드'],'한글표시사항':{'제품명':'<저장한 상품> & 원문','내용량':0,'수량':0,'kc인증':false,'식품용':true,'확장객체':{neverPrint:'private'}}}]);}}),panel=barcodeUI(f);try{
  const before=f.snapshot();await panel.idle();assert.deepEqual(panel.outputs,[]);assert.equal(panel.requests.length,1);const view=await f.view();assert.equal(view.product.barcode,'001234567890');assert.equal(view.labelInfo[0].fields['수량'],0);assert.equal(view.labelInfo[0].fields['kc인증'],false);assert.equal(view.labelInfo[0].fields['식품용'],true);
  assert.deepEqual(['바코드 폭(px)','바코드 높이(px)','인쇄 수량','라벨 간격(px)'].map(label=>panel.field(label).props.value),[300,50,1,0]);assert.equal(panel.field('한글표시사항 선택').props.value,'none');
  const image=panel.field(`SKU ${f.skuId} 바코드 미리보기`);assert.ok(image.props.dangerouslySetInnerHTML.__html.includes('001234567890'));assert.ok(!image.props.dangerouslySetInnerHTML.__html.includes('private'));assert.ok(!image.props.dangerouslySetInnerHTML.__html.includes('kc인증'));
  panel.edit('바코드 폭(px)',420);panel.edit('바코드 높이(px)',70);panel.edit('인쇄 수량',3);panel.edit('라벨 간격(px)',8);panel.edit('한글표시사항 선택',0);assert.equal(panel.requests.length,1);assert.equal(panel.outputs.length,0);
  const selected=panel.field(`SKU ${f.skuId} 바코드 미리보기`).props.dangerouslySetInnerHTML.__html;assert.match(selected,/&lt;저장한 상품&gt; &amp; 원문/u);assert.match(selected,/내용량: 0/u);assert.doesNotMatch(selected,/수량:|kc인증:|식품용:|private|확장객체/u);
  await panel.click('PNG 다운로드');assert.equal(panel.outputs.length,1);const downloaded=panel.outputs[0];assert.equal(downloaded.action,'download');assert.equal(downloaded.filename,`yoofam-plus-${company.code}-sku-${f.skuId}-barcode.png`);assert.equal(downloaded.output.barcode,view.product.barcode);assert.equal(downloaded.output.width,420);assert.equal(downloaded.output.copies,3);assert.equal(downloaded.output.gap,8);assert.equal(downloaded.signal.aborted,false);
  const verified=new URL(panel.requests.at(-1).url,'https://app.test');assert.equal(verified.searchParams.get('expectedSourceVersion'),view.sourceVersion);assert.equal(verified.searchParams.get('expectedAccountContext'),f.accountContext);assert.deepEqual(plain(panel.builds.at(-1).view),plain(view));
  await panel.click('인쇄');assert.equal(panel.outputs.length,2);assert.equal(panel.outputs[1].action,'print');assert.deepEqual(panel.outputs[1].output,downloaded.output);assert.equal(panel.requests.length,3);sameReadOnly(f,before);
 }finally{panel.close();f.close();}
});

test('strict initial response validation refuses wrong SKU/company/account, malformed source and invented label fields before preview or output',async()=>{
 const f=await barcodeFixture();try{const original=await f.view(),before=f.snapshot(),changes=[
  view=>{view.skuId='1000000001';},view=>{view.company.code='A01526306';},view=>{view.company.name='다른 회사';},view=>{view.accountContext='f'.repeat(64);},view=>{view.sourceVersion='bad';},view=>{view.product.barcode='';},view=>{view.product.barcode='한글';},view=>{view.sourceRow=1;},view=>{view.importedAt='not a date';},view=>{view.extra='unverified';},view=>{view.labelInfo[0].fields.extra={invented:'mark'};},view=>{view.labelInfo.push(plain(view.labelInfo[0]));}];
  for(const change of changes){const value=plain(original);change(value);const panel=barcodeUI(f,{fetcher:async()=>Response.json(value)});try{await panel.idle();assert.equal(panel.field(`SKU ${f.skuId} 바코드 미리보기`),undefined);assert.equal(enabled(panel,'인쇄'),false);assert.equal(enabled(panel,'PNG 다운로드'),false);assert.ok(nodes(panel.render()).some(node=>node.props?.role==='alert'));assert.equal(panel.outputs.length,0);}finally{panel.close();}}
  sameReadOnly(f,before);
 }finally{f.close();}
});

test('late initial success/failure cannot publish another SKU/company/account or update an unmounted barcode dialog',async()=>{
 const f=await barcodeFixture();try{const body=await f.view(),before=f.snapshot();for(const outcome of ['success','failure'])for(const boundary of ['sku','company','account','close']){
  const wait=deferred();let first=true;const panel=barcodeUI(f,{fetcher:async(url,init)=>{if(first){first=false;return wait.promise;}return f.request(url,init);}});await panel.idle();const originalRequest=panel.requests[0];
  if(boundary==='sku')panel.props({skuId:'1000000001'});if(boundary==='company')panel.props({company:barcodeCompanies[1]});if(boundary==='account')panel.props({accountContext:'f'.repeat(64)});if(boundary==='close')panel.close();
  assert.equal(originalRequest.init.signal.aborted,true);if(outcome==='success')wait.resolve(Response.json(body));else wait.reject(Error('late private error'));await panel.idle();
  assert.equal(panel.outputs.length,0);assert.equal(panel.lateUpdates,0);if(boundary!=='close')assert.ok(!text(panel.render()).includes(body.product.barcode));panel.close();
 }sameReadOnly(f,before);}finally{f.close();}
});

test('an explicit output revalidates every saved field and a changed source or label requires a separate refresh',async()=>{
 for(const company of barcodeCompanies){const f=await barcodeFixture(company),panel=barcodeUI(f);try{
  await panel.idle();const stalePrint=panel.button('인쇄').props.onClick,sourceBefore=f.snapshot();f.h.sqlite.prepare("UPDATE managed_products SET source_payload=json_set(source_payload,'$.\"바코드\"','000987654321') WHERE sku_id=?").run(f.skuId);const changed=f.snapshot();assert.notEqual(changed,sourceBefore);
  await panel.click('PNG 다운로드');assert.equal(panel.outputs.length,0);assert.equal(enabled(panel,'인쇄'),false);assert.equal(enabled(panel,'PNG 다운로드'),false);assert.ok(nodes(panel.render()).some(node=>node.props?.role==='alert'));
  stalePrint();await panel.idle();assert.equal(panel.outputs.length,0);assert.equal(panel.requests.length,2,'stale output handler must not issue another verification');
  await panel.click('다시 조회');assert.equal(panel.field('한글표시사항 선택').props.value,'none');assert.match(text(panel.render()),/000987654321/u);await panel.click('PNG 다운로드');assert.equal(panel.outputs.length,1);assert.equal(panel.outputs[0].output.barcode,'000987654321');sameReadOnly(f,changed);
 }finally{panel.close();f.close();}}
});

test('same-version but changed validated response content is refused before physical output',async()=>{
 const f=await barcodeFixture();try{for(const change of ['title','barcode','label','provenance']){const view=await f.view(),before=f.snapshot();let count=0;const panel=barcodeUI(f,{fetcher:async()=>{const value=plain(view);if(++count>1){if(change==='title')value.product.title='다른 저장 상품명';if(change==='barcode')value.product.barcode='0000000123';if(change==='label')value.labelInfo[0].fields['제조국']='다른 원문';if(change==='provenance')value.sourceName='changed.xlsx';}return Response.json(value);}});try{await panel.idle();await panel.click('인쇄');assert.equal(panel.outputs.length,0);assert.equal(enabled(panel,'인쇄'),false);assert.match(text(panel.render()),/다시 조회|변경/u);sameReadOnly(f,before);}finally{panel.close();}}
 }finally{f.close();}
});

test('pending verification locks settings and retained print/download/refresh/close handlers; aborts keep physical output at zero',async()=>{
 const f=await barcodeFixture();try{for(const boundary of ['success','sku','company','account','close']){
  const wait=deferred();let count=0;const panel=barcodeUI(f,{fetcher:async(url,init)=>++count===2?wait.promise:f.request(url,init)});await panel.idle();const before=f.snapshot(),print=panel.button('인쇄').props.onClick,download=panel.button('PNG 다운로드').props.onClick,refresh=panel.button('다시 조회').props.onClick,close=panel.button('닫기').props.onClick,width=panel.field('바코드 폭(px)').props.onChange;
  print();download();print();refresh();close();width({target:{value:'900'}});await panel.idle();assert.equal(panel.requests.length,2);assert.equal(panel.field('바코드 폭(px)').props.value,300);assert.equal(panel.closes.length,0);assert.ok(nodes(panel.render()).some(node=>node.type==='fieldset'&&node.props.disabled));assert.equal(panel.outputs.length,0);
  if(boundary==='sku')panel.props({skuId:'1000000001'});if(boundary==='company')panel.props({company:barcodeCompanies[1]});if(boundary==='account')panel.props({accountContext:'f'.repeat(64)});if(boundary==='close')panel.close();
  wait.resolve(await f.request(f.endpoint()));await panel.idle();assert.equal(panel.outputs.length,boundary==='success'?1:0);assert.equal(panel.lateUpdates,0);sameReadOnly(f,before);panel.close();
 }}finally{f.close();}
});

test('invalid size/copies/label settings and pending physical output preserve the saved code and cannot emit a second result',async()=>{
 const f=await barcodeFixture(),panel=barcodeUI(f);try{
  await panel.idle();const before=f.snapshot();for(const[label,value]of [['바코드 폭(px)',99],['바코드 폭(px)',1601],['바코드 높이(px)',19],['인쇄 수량',0],['라벨 간격(px)',101],['한글표시사항 선택',100]]){
   const old=panel.field(label).props.value;panel.edit(label,value);assert.equal(enabled(panel,'인쇄'),false);assert.equal(enabled(panel,'PNG 다운로드'),false);assert.ok(nodes(panel.render()).some(node=>node.props?.role==='alert'));panel.edit(label,old==='none'?'none':old);
  }
  const wait=deferred();panel.output('download',()=>wait.promise);const download=panel.button('PNG 다운로드').props.onClick,print=panel.button('인쇄').props.onClick,close=panel.button('닫기').props.onClick;download();await panel.idle();assert.equal(panel.outputs.length,1);print();download();close();await panel.idle();assert.equal(panel.outputs.length,1);assert.equal(panel.closes.length,0);assert.equal(enabled(panel,'인쇄'),false);
  wait.resolve();await panel.idle();assert.equal(enabled(panel,'인쇄'),true);assert.equal(panel.outputs[0].output.barcode,'001234567890');sameReadOnly(f,before);
 }finally{panel.close();f.close();}
});

test('same-tick setting edits invalidate retained output handlers before any verification or physical output',async()=>{
 const f=await barcodeFixture();try{for(const[label,value]of [['바코드 폭(px)',99],['바코드 폭(px)',420],['바코드 높이(px)',70],['인쇄 수량',3],['라벨 간격(px)',8],['한글표시사항 선택','0']]){
  const panel=barcodeUI(f);try{await panel.idle();const before=f.snapshot(),oldPrint=panel.button('인쇄').props.onClick,oldDownload=panel.button('PNG 다운로드').props.onClick;
   panel.field(label).props.onChange({target:{value:String(value)}});oldPrint();oldDownload();await panel.idle();assert.equal(panel.requests.length,1);assert.equal(panel.outputs.length,0);
   if(value!==99){await panel.click('PNG 다운로드');assert.equal(panel.outputs.length,1);const latest=panel.builds.at(-1);assert.ok(latest);assert.deepEqual(panel.outputs[0].output,plain(f.runtime.load('app/managed-product-barcode-output.ts').buildManagedBarcodeOutput(latest.view,latest.settings)));}
   sameReadOnly(f,before);
  }finally{panel.close();}
 }}finally{f.close();}
});

test('only an existing saved product label is selected by default and refresh preserves explicit purchase-label choice only until reread',async()=>{
 for(const company of barcodeCompanies){const f=await barcodeFixture(company,{productLabel:{'제품명':'원문 제품명','제조국':'저장된 나라','내용량':0,'수량':0,'kc인증':false,'식품용':false}}),panel=barcodeUI(f);try{
  const before=f.snapshot();await panel.idle();const view=await f.view();assert.equal(view.labelInfo[0].source,'product');assert.equal(view.labelInfo[1].source,'purchase-info-original');assert.equal(panel.field('한글표시사항 선택').props.value,'0');
  const svg=()=>panel.field(`SKU ${f.skuId} 바코드 미리보기`).props.dangerouslySetInnerHTML.__html;assert.match(svg(),/제조국: 저장된 나라/u);assert.match(svg(),/내용량: 0/u);assert.doesNotMatch(svg(),/수량:|kc인증:|식품용:|제조국: 중국/u);assert.equal(panel.outputs.length,0);
  panel.edit('한글표시사항 선택',1);assert.match(svg(),/제조국: 중국/u);assert.equal(panel.requests.length,1);await panel.click('다시 조회');assert.equal(panel.field('한글표시사항 선택').props.value,'0');assert.match(svg(),/제조국: 저장된 나라/u);assert.equal(panel.outputs.length,0);sameReadOnly(f,before);
 }finally{panel.close();f.close();}}
});
