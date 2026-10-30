import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {detailStageUI} from './helpers/option-detail-manual-edit.mjs';
import {seoWorkspaceHarness} from './helpers/seo-workspace.mjs';
import {seoWorkspaceEditor,visibleText,nextVersion} from './helpers/seo-workspace-editor.mjs';

const cases=[],sha=file=>createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex');
const sources=['app/components/dashboard-client.tsx','app/components/seo-workspace-editor.tsx','tests/dashboard-option-stages.test.mjs','tests/seo-stage-processing.test.mjs'];
const hashes=()=>Object.fromEntries(sources.map(file=>[file,sha(file)])),frozen=hashes();
after(()=>{assert.deepEqual(hashes(),frozen);fs.writeFileSync(new URL('../outputs/step713-seo-stage-proof.json',import.meta.url),JSON.stringify({sourceHashes:frozen,cases,externalRequests:0,browserActions:0,realProductWrites:0,supplierHubWrites:0,boundary:'Actual DetailPanel and common SEO component/client/API with isolated SQLite. Stage children are stateful JSX fixture components; generation notification is controlled, not a vendor or live AI/browser run.'},null,2)+'\n');});
const options={tab:'SEO',onBeforeSeoGenerate:()=>true};
const generator=h=>h.record('seo-workspace-generator');
const common=h=>h.record('seo-workspace-editor');
const selected=h=>h.record('option-seo-editor');

test('SEO processing hides both forms without remounting buffers or disabling its own generator',()=>{
 const h=detailStageUI(options);try{
  const first=common(h),option=selected(h),source=generator(h),operation={};
  h.edit('seo-workspace-editor','보관할 공통 상품명');h.edit('option-seo-editor','보관할 옵션 공란');
  source.props.onProcessingChange(true,operation);
  for(const child of [common(h),selected(h)]){assert.equal(h.visible(child),false);assert.equal(child.props.disabled,true);assert.ok(child.ancestors.some(node=>node.props?.inert===true));}
  assert.equal(common(h).instance,first.instance);assert.equal(selected(h).instance,option.instance);assert.equal(common(h).draft,'보관할 공통 상품명');assert.equal(selected(h).draft,'보관할 옵션 공란');
  assert.equal(h.visible(generator(h)),true);assert.equal(generator(h).instance,source.instance);assert.notEqual(generator(h).props.disabled,true,'the producer can finish its own operation');
  assert.equal(h.visible(h.record('translation-panel')),false,'advanced mutation controls are hidden with the stage');
  h.render({tab:'가격'});const pricing=h.record('product-options-editor');assert.equal(h.visible(pricing),true,'SEO processing does not hide unrelated stage layouts');assert.equal(pricing.props.pricingView,true);
  h.render({tab:'SEO'});assert.equal(h.visible(common(h)),false);
  source.props.onProcessingChange(false,operation);assert.equal(h.visible(common(h)),true);assert.equal(common(h).props.disabled,false);assert.equal(selected(h).props.disabled,false);assert.equal(common(h).draft,'보관할 공통 상품명');
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),{saved:0,reads:0,uploads:0,submission:0});
  cases.push({name:'stage lock and retained buffers',formsHidden:true,inert:true,instancesRetained:true,producerSelfLock:false,writes:0});
 }finally{h.close();}
});

test('an older processing release cannot unlock its successor',()=>{
 const h=detailStageUI(options);try{
  const callback=generator(h).props.onProcessingChange,first={},second={};
  callback(true,first);assert.equal(common(h).props.disabled,true);callback(true,second);callback(false,first);assert.equal(common(h).props.disabled,true);assert.equal(h.visible(common(h)),false);
  callback(false,second);assert.equal(common(h).props.disabled,false);callback(false,first);assert.equal(common(h).props.disabled,false);
  cases.push({name:'operation token',oldReleaseIgnored:true,writes:0});
 }finally{h.close();}
});

test('old product, owner and source callbacks cannot lock or release the new scope',()=>{
 for(const mode of ['source','product','owner']){
  const h=detailStageUI(options);try{
   const callback=generator(h).props.onProcessingChange,first={},second={},initial=common(h).props;
   callback(true,first);assert.equal(common(h).props.disabled,true);
   if(mode==='source')h.render({product:{id:initial.productId,title:'같은 상품 새 저장본',updated_at:nextVersion(initial.version),image_keys:'[]'}});
   if(mode==='product')h.render({product:{id:'new-product',title:'다른 상품',updated_at:initial.version,image_keys:'[]'}});
   if(mode==='owner')h.render({workspaceOwnerId:'new-approved-owner'});
   assert.equal(common(h).props.disabled,false);callback(true,first);assert.equal(common(h).props.disabled,false);
   generator(h).props.onProcessingChange(true,second);callback(false,first);assert.equal(common(h).props.disabled,true);
   generator(h).props.onProcessingChange(false,second);assert.equal(common(h).props.disabled,false);
   // Return to exactly the first scope. Its captured publisher remains old,
   // even though the product/owner/version strings now equal that old scope.
   if(mode==='owner')h.render({workspaceOwnerId:undefined});
   else h.render({product:{id:initial.productId,title:'같은 이전 범위',updated_at:initial.version,image_keys:'[]'}});
   assert.equal(common(h).props.disabled,false);callback(true,first);assert.equal(common(h).props.disabled,false);
  }finally{h.close();}
 }
 cases.push({name:'source product owner identity',oldCallbackIgnored:true,abaProtected:true,writes:0});
});

for(const companyCode of ['A01464742','A01526306'])test(`common SEO explicit actions respect the processing lock, preserve blanks and resume one real save (${companyCode})`,async()=>{
 const api=seoWorkspaceHarness({companyCode}),h=seoWorkspaceEditor(api);let stage;
 try{
  await h.idle();h.edit('SEO 상품명','');h.edit('SEO 검색태그','직접 태그');h.edit('1번째 한국어 옵션명','검토한 옵션');
  const before=api.stored(),count=h.calls.length,oldEdit=h.input('SEO 상품명').props.onChange,oldName=h.input('1번째 한국어 옵션명').props.onChange;
  const callbacks=['SEO 설정 저장','입력 유지·최신 SEO 조회','입력 취소·저장본 다시 조회'].map(label=>h.button(label).props.onClick);
  stage=detailStageUI({...options,product:before.product,focusedOptionId:api.options.rows[0].id});const operation={};generator(stage).props.onProcessingChange(true,operation);
  h.patch({disabled:common(stage).props.disabled},false);
  oldEdit({target:{value:'차단해야 할 수정'}});oldName({target:{value:'차단된 옵션명'}});for(const callback of callbacks)callback();
  await h.idle();assert.equal(h.calls.length,count);assert.deepEqual(api.stored(),before);assert.equal(h.input('SEO 상품명').props.value,'');assert.equal(h.input('1번째 한국어 옵션명').props.value,'검토한 옵션');assert.equal(h.render().props['data-workspace-dirty'],true);
  for(const label of ['SEO 설정 저장','입력 유지·최신 SEO 조회','입력 취소·저장본 다시 조회'])assert.equal(h.button(label).props.disabled,true);
  generator(stage).props.onProcessingChange(false,operation);h.patch({disabled:common(stage).props.disabled});await h.click('SEO 설정 저장');
  assert.equal(h.saved,1);assert.equal(h.calls.filter(call=>call.method==='PATCH').length,1);assert.equal(h.input('SEO 상품명').props.value,'');assert.match(visibleText(h.render()),/저장 완료/);
  const stored=api.stored(),content=JSON.parse(stored.content.payload),oldContent=JSON.parse(before.content.payload);assert.equal(content.seo.title.provenance,'manual');assert.equal(content.seo.title.value,'');assert.deepEqual(content.assets,oldContent.assets);assert.deepEqual(content.label,oldContent.label);assert.deepEqual(stored.quotation,before.quotation);
  for(const key of ['source_url','source_price_cny','supply_price','sale_price','msrp','image_keys'])assert.equal(stored.product[key],before.product[key],key);
  cases.push({name:'common editor actual local save',companyCode,lockedRequests:0,manualBlankPreserved:true,patches:1,unrelatedDataPreserved:true});
 }finally{stage?.close();h.close();api.close();}
});
