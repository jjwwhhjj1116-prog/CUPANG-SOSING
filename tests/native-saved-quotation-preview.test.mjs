import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeReviewFixture,plain,companies,json} from './helpers/native-source-review.mjs';
import {quotationAiUI,nodes} from './helpers/quotation-ai-ui.mjs';

const component='app/components/supplier-hub-native-source-review.tsx',name='SupplierHubNativeSourceReview';
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);

for(const company of companies)test(`${company.code}: unconfirmed documents allow a private saved-value/image preview while every preparation guard remains blocked`,async()=>{
 const f=await nativeReviewFixture(company);let ui;
 try{
  const legal=f.h.load('app/api/products/[id]/legal-documents/route.ts'),url='https://app.test'+f.base+'/legal-documents';
  const before=await json(await legal.GET(new Request(url),f.context));
  await json(await legal.PATCH(new Request(url,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:before.revision,applicability:'unconfirmed'})}),f.context));
  const view=await f.fields(),plan=await f.source();assert.equal(plan.metadataValid,false);assert.ok(plan.body);assert.equal(plan.sourcePlanSha256,null);
  const db=f.state(),objects=f.objectState(),props={productId:f.id,profileId:f.profile.id,view,disabled:false};
  ui=quotationAiUI(props,f.request,component,name);await ui.idle();
  const tree=ui.render();assert.ok(nodes(tree).some(node=>node.props?.['aria-label']==='저장된 견적 미리보기'));
  assert.match(text(tree),/저장된 견적 미리보기 · 2개 옵션/);assert.match(text(tree),/11960/);assert.match(text(tree),/19930/);assert.match(text(tree),/검정/);
  assert.ok(nodes(tree).some(node=>node.props?.role==='alert'));assert.equal(ui.button('견적서·첨부 파일 확인').props.disabled,true);
  assert.equal(nodes(tree).some(node=>node.props?.review),false);
  const images=nodes(tree).filter(node=>node.type==='img');assert.equal(images.length,14);assert.ok(images.every(node=>node.props.src.startsWith('/api/files/owner/')&&node.props.loading==='lazy'));
  assert.ok(plan.images.every(file=>text(tree).includes(file.transportName)));
  const reads=ui.calls.length;ui.button('견적서·첨부 파일 확인').props.onClick();await ui.idle();assert.equal(ui.calls.length,reads,'a retained callback cannot bypass the blocked preparation');
  assert.equal(f.state(),db);assert.equal(f.objectState(),objects);assert.deepEqual(f.h.network,[]);assert.ok(ui.calls.every(call=>call.method==='GET'));
  assert.equal((await json(await legal.GET(new Request(url),f.context))).documents.applicability,'unconfirmed');
  ui.render({...props,disabled:true});ui.flush();assert.equal(nodes(ui.render()).some(node=>node.props?.['aria-label']==='저장된 견적 미리보기'),false,'unsaved edits retire the saved snapshot');
 }finally{ui?.unmount();f.close();}
});

test('preview reads exact body values and units, preserves manual blanks, and never substitutes defaults or invents missing named values',async()=>{
 const f=await nativeReviewFixture();try{
  const model=f.h.load('app/native-saved-quotation-preview.ts'),plan=plain(f.sourcePlan),view=plain(f.quotationView);
  plan.metadataValid=false;plan.sourcePlanSha256=null;plan.issues=[{code:'NATIVE_ASSET_LEGAL_UNCONFIRMED',level:'error',message:'서류 해당 여부 확인'}];
  const field=(id,label,wire,unit)=>({id,label,hubWire:wire,section:'logistics',type:'text',visibility:'common',required:true,...(unit?{unit}:{}),draftDefault:'SHOULD NOT APPEAR'});
  view.resolved.schema.fields.push(field('packagedWeightG','단품 포장 무게',{path:['logisticsPage','skuUnitBoxWeight']},'g'),
   field('packagedDimensionsMm','단품 포장 크기',{path:['logisticsPage','skuUnitBoxDimension']},'mm'),
   field('noticeCountryOfOrigin','제조국',{path:['legalPage','notices'],name:'제조국',nameKey:'noticeItemName',valueKey:'noticeItemValue'}));
  const doc=plan.body.jsonDocument[0];doc.startPage.productName='수동 저장 상품명';doc.productPage.commonAttributes.purchasePrice='0';
  doc.logisticsPage.skuUnitBoxWeight='10';doc.logisticsPage.skuUnitBoxDimension='';doc.legalPage.notices.push({noticeItemName:'제조국',noticeItemValue:'중국'});
  const frozen=JSON.stringify({plan,view}),rows=model.nativeSavedQuotationPreview(plan,view),first=rows[0],values=new Map(first.values.map(value=>[value.label,value.value]));
  assert.equal(first.title,'수동 저장 상품명');assert.equal(values.get('단품 포장 무게'),'10 g');assert.equal(values.get('단품 포장 크기'),'빈 값');assert.equal(values.get('제조국'),'중국');
  assert.ok(first.values.some(value=>value.label==='공급가'&&/^0(?: 원)?$/.test(value.value)));assert.ok(!JSON.stringify(rows).includes('SHOULD NOT APPEAR'));
  assert.equal(rows[1].values.find(value=>value.label==='단품 포장 무게').value,'미입력');
  assert.equal(JSON.stringify({plan,view}),frozen,'rendering never mutates body, manual overrides or defaults');
  doc.legalPage.notices.push({noticeItemName:'제조국',noticeItemValue:'다른 값'});
  assert.equal(model.nativeSavedQuotationPreview(plan,view)[0].values.find(value=>value.label==='제조국').value,'미입력','ambiguous named values are not guessed');
 }finally{f.close();}
});

test('stale sources, reordered members and unowned image references cannot become the current saved preview',async()=>{
 const f=await nativeReviewFixture();try{
  const model=f.h.load('app/native-saved-quotation-preview.ts');
  for(const mutate of [view=>view.inputFingerprint='f'.repeat(64),view=>view.contentRevision++,view=>view.revision++,view=>view.resolved.rows.reverse()]){
   const view=plain(f.quotationView);mutate(view);assert.deepEqual(plain(model.nativeSavedQuotationPreview(f.sourcePlan,view)),[]);
  }
  const plan=plain(f.sourcePlan),view=plain(f.quotationView);plan.images[0].key='other/private.png';view.imageKeys.push('other/private.png');
  const rows=model.nativeSavedQuotationPreview(plan,view);assert.ok(rows[0].images.some(file=>file.key==='other/private.png'&&file.href===null));
  plan.body=null;assert.deepEqual(plain(model.nativeSavedQuotationPreview(plan,view)),[]);
 }finally{f.close();}
});
