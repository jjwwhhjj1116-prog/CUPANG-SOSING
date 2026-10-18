import test from 'node:test';
import assert from 'node:assert/strict';
import {module,plain} from './helpers/supplier-hub-single-size-chart.mjs';
const model=module('app/manual-size-chart.ts'),contentModel=module('app/product-content.ts'),optionsModel=module('app/product-options.ts'),documents=module('app/document-image.ts');
const chart=()=>({sizeType:'직접 작성한 상의',sizeUnits:'cm',sizes:[' S ','M','L'],measurements:[{name:'총장',values:['61','63','']},{name:' ',values:[' ','0','—']},{name:'',values:['','','']}]});
const now='2026-10-18T00:00:00.000Z';
test('manual grid preserves original text/order and blanks without changing product or packaging facts',()=>{
 const input=chart(),before=JSON.stringify(input),value=model.validateManualSizeChart(input);assert.equal(JSON.stringify(input),before);assert.deepEqual(plain(value.sizes),['S','M','L']);assert.equal(value.measurements.length,2);assert.equal(value.measurements[1].name,' ');
 const current=contentModel.emptyProductContent('manual'),options=optionsModel.emptyProductOptions('manual'),source=JSON.stringify({current,options});
 const saved=contentModel.applyContentPatch(current,{manualSizeChart:value},now),plan=documents.documentImagePlan('size',saved,options);
 assert.equal(JSON.stringify({current,options}),source);assert.deepEqual(plain(saved.manualSizeChart),plain(value));assert.equal(plan.format,'manual-size-chart');assert.deepEqual(plain(plan.headers),['측정 부위','S','M','L']);assert.deepEqual(plain(plan.rows),[['총장','61','63','-'],[' ',' ','0','—']]);assert.equal(plan.columnWidths.reduce((a,b)=>a+b,80),plan.width);
 assert.equal(saved.assets.size.provenance,'manual');assert.deepEqual(plain(saved.assets.size.value),[]);assert.equal(saved.label.dimensions.value,'');assert.equal(options.rows.length,0);
});
test('grid validation rejects ambiguous rows, unsupported units/keys, unsafe text and bounded excess instead of inventing cells',()=>{
 for(const change of [x=>{x.extra=true;},x=>{x.sizeUnits='kg';},x=>{x.sizes=[];},x=>{x.sizes=Array(21).fill('S');},x=>{x.measurements=[];},x=>{x.measurements=Array(61).fill({name:'A',values:['1','2','3']});},x=>{x.measurements[0].values=['1'];},x=>{x.measurements[0].values[0]=1;},x=>{x.measurements[0].values[0]='a\u0000b';},x=>{x.measurements[0].values[0]='a'.repeat(201);},x=>{x.sizeType='a'.repeat(81);},x=>{x.measurements[0].derived=true;}]){const input=chart();change(input);assert.throws(()=>model.validateManualSizeChart(input));}
 const big={sizeType:'크기',sizeUnits:'㎡',sizes:Array(20).fill('S'),measurements:Array.from({length:60},()=>({name:'측정',values:Array(20).fill('가'.repeat(100))}))};assert.throws(()=>model.validateManualSizeChart(big),/64KiB/);
 for(const unit of ['cm','mm','inch','㎡'])assert.equal(model.validateManualSizeChart({...chart(),sizeUnits:unit}).sizeUnits,unit);
 assert.equal(model.validateManualSizeChart({...chart(),sizeType:''}).sizeType,'');
});
test('manual grid edits detach only stale active size; unchanged grid saves and cancellation leave the active image intact',()=>{
 const initial=contentModel.applyContentPatch(contentModel.emptyProductContent('manual'),{manualSizeChart:chart()},now);
 const linked=contentModel.applyContentPatch(initial,{assets:{size:['owner/old-size.png'],label:['owner/label.png']}},now),original=JSON.stringify(linked);
 const same=contentModel.applyContentPatch(linked,{manualSizeChart:chart()},now);assert.deepEqual(plain(same.assets),plain(linked.assets));assert.equal(JSON.stringify(linked),original);
 const changed=chart();changed.measurements[0].values[0]='62';const next=contentModel.applyContentPatch(linked,{manualSizeChart:changed},now);assert.deepEqual(plain(next.assets.size.value),[]);assert.deepEqual(plain(next.assets.label),plain(linked.assets.label));
 assert.throws(()=>contentModel.applyContentPatch(linked,{manualSizeChart:changed,assets:{size:['owner/old-size.png']}},now),/새 PNG/);
 const reset=contentModel.applyContentPatch(linked,{manualSizeChart:null},now);assert.equal(Object.hasOwn(reset,'manualSizeChart'),false);assert.deepEqual(plain(reset.assets.size.value),[]);assert.equal(JSON.stringify(linked),original);
});
test('content patch accepts only explicit manual grid or null reset; legacy shape stays absent and source remains immutable',()=>{
 const empty=contentModel.emptyProductContent('manual');assert.equal(Object.hasOwn(empty,'manualSizeChart'),false);
 const valid=contentModel.validateContentInput({expectedRevision:0,patch:{manualSizeChart:chart()}},[],'owner');assert.deepEqual(plain(valid.patch.manualSizeChart),plain(model.validateManualSizeChart(chart())));
 assert.deepEqual(plain(contentModel.validateContentInput({expectedRevision:0,patch:{manualSizeChart:null}},[],'owner').patch),{manualSizeChart:null});
 for(const value of [undefined,false,[],{},'guess'])assert.throws(()=>contentModel.validateContentInput({expectedRevision:0,patch:{manualSizeChart:value}},[],'owner'));
 const seo=contentModel.applyContentPatch(empty,{seo:{title:'수동 제목'}},now);assert.equal(Object.hasOwn(seo,'manualSizeChart'),false);assert.equal(empty.seo.title.value,'');
});
test('absent manual grid preserves fixed six-column legacy measurement plan; manual reset restores that exact fallback',()=>{
 const options=optionsModel.applyOptionRows(optionsModel.emptyProductOptions('manual'),[{...optionsModel.emptyOptionInput('one'),originalName:'원문 옵션',included:true,widthCm:2.5,lengthCm:null,weightKg:1,unitsPerPack:2}],now);
 const empty=contentModel.emptyProductContent('manual'),legacy=documents.documentImagePlan('size',empty,options),saved=contentModel.applyContentPatch(empty,{manualSizeChart:chart()},now),reset=contentModel.applyContentPatch(saved,{manualSizeChart:null},now);
 assert.deepEqual(plain(documents.documentImagePlan('size',reset,options)),plain(legacy));assert.deepEqual(plain(legacy.rows),[['원문 옵션','2.5','[미입력]','[미입력]','1','2']]);assert.equal(legacy.headers.length,6);
 assert.throws(()=>documents.documentImagePlan('size',saved,optionsModel.emptyProductOptions('other')),/일치/);
});
