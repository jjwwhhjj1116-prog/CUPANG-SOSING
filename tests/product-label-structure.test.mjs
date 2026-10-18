import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {providedOptionModule as module} from './helpers/provided-option-quotation.mjs';

const model=module('app/product-label.ts'),plain=value=>JSON.parse(JSON.stringify(value));
const defaults=model.productLabelStructure(),version='2026-10-18T00:00:00.000Z',next='2026-10-18T00:00:00.001Z';
const custom={id:'custom_1792278000000',label:'추가 표시',required:false};
function inputs(structure,overrides=model.emptyProductLabelOverrides()){
 const productId='structure-test',content=module('app/product-content.ts').emptyProductContent(productId),options=module('app/product-options.ts').emptyProductOptions(productId);
 const rows=[{optionId:null,optionLabel:'상품 공통값',included:false},{optionId:'red',optionLabel:'빨강',included:true},{optionId:'excluded',optionLabel:'제외',included:false}];
 options.rows=rows.filter(row=>row.optionId).map(row=>({...module('app/product-options.ts').emptyOptionInput(row.optionId),included:row.included,originalName:row.optionLabel,provenance:{}}));
 content.label.material={value:'저장 원문 재질',provenance:'collected',updatedAt:version};
 const quotation={resolved:{schema:{fields:[{id:'title',section:'start',label:'상품명',type:'text',visibility:'common'}]},rows:rows.map(row=>({...row,fields:{title:{value:row.optionId?'상품 '+row.optionLabel:'공통 상품',source:'content'}}}))}};
 const state={schemaVersion:1,productId,revision:0,overrides,updatedAt:null,...(structure===undefined?{}:{structure})};
 return {productId,state,content,options,quotation,settings:{manufacturer:'회사 제조원',importer:'회사 수입원',handlingPrecautions:'설정 주의사항'}};
}
function view(structure,overrides){
 const input=inputs(structure,overrides),rows=model.resolveProductLabels(input);
 return {productId:input.productId,revision:0,inputFingerprint:'a'.repeat(64),productVersion:version,contentRevision:0,optionRevision:0,quotationRevision:0,quotationInputFingerprint:'b'.repeat(64),
  categoryContext:{source:'profile',profileId:'cat',categoryId:'80719',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓']},imageKeys:[],overrides:input.state.overrides,rows,updatedAt:null,...(structure===undefined?{}:{structure})};
}
function saved(before,structure,changes=[]){
 const overrides=model.applyProductLabelChanges(before.overrides,changes,structure),out=view(structure,overrides);
 return {...out,revision:before.revision+1,productVersion:next,updatedAt:next};
}

test('legacy absence keeps nine saved definitions and the exact prior plan while new PNGs omit empty values',()=>{
 const legacy=view(),before=JSON.stringify(legacy),plan=model.productLabelPlan(legacy,'red',{includeEmpty:true});
 assert.equal(Object.hasOwn(legacy,'structure'),false);assert.equal(defaults.length,9);
 assert.deepEqual(plain(model.productLabelDefinitions()),plain(model.productLabelFields.map(field=>({...field,required:field.key==='productName'}))));
 assert.deepEqual(plain(plan),plain({format:'product-label',title:'',subtitle:'',width:800,columnWidths:[240,480],headers:[],rows:model.productLabelFields.map(field=>[field.label,legacy.rows.find(row=>row.optionId==='red').values[field.key]]),footer:''}));
 assert.deepEqual(plain(model.productLabelPlan(legacy,'red').rows),plain(plan.rows.filter(row=>row[1]!=='')));
 assert.equal(JSON.stringify(legacy),before);
});

test('shared order, renamed headings and custom fields use independent per-option values while deleted overrides remain archived',()=>{
 const structure=[custom,{id:'material',label:'검토 재질',required:false},defaults[0]],overrides={common:{manufacturer:'삭제된 제조원 보존',[custom.id]:'공통 추가값'},options:{red:{[custom.id]:'',material:'옵션 재질'},excluded:{[custom.id]:'제외 옵션 보존'}}};
 const before=JSON.stringify({structure,overrides}),v=view(structure,overrides);
 model.verifyProductLabelsView(v,'red');assert.deepEqual(Object.keys(v.rows[0].values),structure.map(field=>field.id));
 const common=v.rows.find(row=>row.optionId===null),red=v.rows.find(row=>row.optionId==='red'),excluded=v.rows.find(row=>row.optionId==='excluded');
 assert.equal(common.values[custom.id],'공통 추가값');assert.equal(red.values[custom.id],'');assert.equal(red.sources[custom.id],'manual-option');assert.equal(red.automatic[custom.id],'');assert.equal(excluded.values[custom.id],'제외 옵션 보존');
 assert.deepEqual(plain(model.productLabelPlan(v,'red').rows),[['검토 재질','옵션 재질'],['제품명','상품 빨강']]);
 assert.deepEqual(plain(model.productLabelPlan(v,'red',{includeEmpty:true}).rows),[['추가 표시',''],['검토 재질','옵션 재질'],['제품명','상품 빨강']]);
 assert.equal(v.overrides.common.manufacturer,'삭제된 제조원 보존');assert.throws(()=>model.productLabelPlan(v,'excluded'),/포함/);
 assert.equal(JSON.stringify({structure,overrides}),before);
});

test('structure validation normalizes heading whitespace and rejects missing required names, unknown IDs, duplicates and malformed bounds',()=>{
 const padded=[{...defaults[0],label:'  제품 이름  '},custom];assert.equal(model.validateProductLabelStructure(padded)[0].label,'제품 이름');assert.equal(padded[0].label,'  제품 이름  ');
 const bad=[[],[custom],[{...defaults[0],required:false}],[defaults[0],{...custom,required:true}],[defaults[0],{...custom,id:'arbitrary'}],
  [defaults[0],{...custom,id:'custom_'}],[defaults[0],{...custom,id:'custom_'+ 'a'.repeat(74)}],[defaults[0],custom,{...custom}],
  [defaults[0],{...custom,label:''}],[defaults[0],{...custom,label:' \t '}],[defaults[0],{...custom,label:'가'.repeat(81)}],[defaults[0],{...custom,label:'줄\n바꿈'}],
  [defaults[0],{...custom,label:'제어\u007f'}],[{...defaults[0],extra:true}],[defaults[0],...Array.from({length:39},(_,i)=>({...custom,id:'custom_'+i}))]];
 for(const structure of bad)assert.throws(()=>model.validateProductLabelStructure(structure));
 assert.equal(model.validateProductLabelStructure([defaults[0],...Array.from({length:38},(_,i)=>({...custom,id:'custom_'+i}))]).length,39);
});

test('new input accepts only active IDs while archive validation and restore retain deleted fixed/custom values',()=>{
 const structure=[defaults[0],custom],overrides={common:{manufacturer:'원래 제조원',custom_old:'기존 삭제값'},options:{red:{material:'원래 재질',custom_old:'옵션 삭제값'}}};
 const archived=model.validateProductLabelOverrides(overrides);assert.deepEqual(plain(archived),overrides);
 assert.throws(()=>model.validateProductLabelChanges([{optionId:'red',fieldKey:'material',value:'삭제된 항목 변경'}],['red'],structure));
 assert.throws(()=>model.validateProductLabelChanges([{optionId:'red',fieldKey:'custom_old',value:'삭제된 항목 변경'}],['red'],structure));
 const changes=model.validateProductLabelChanges([{optionId:null,fieldKey:custom.id,value:'공통 추가값'},{optionId:'red',fieldKey:custom.id,value:''}],['red'],structure);
 const nextOverrides=model.applyProductLabelChanges(overrides,changes,structure);assert.equal(nextOverrides.common.custom_old,'기존 삭제값');assert.equal(nextOverrides.options.red.material,'원래 재질');
 const restored=view([...defaults,{id:'custom_old',label:'복원한 항목',required:false}],nextOverrides);
 assert.equal(restored.rows.find(row=>row.optionId==='red').values.material,'원래 재질');assert.equal(restored.rows.find(row=>row.optionId==='red').values.custom_old,'옵션 삭제값');assert.equal(restored.overrides.common[custom.id],'공통 추가값');
});

test('draft custom values, resets and incomplete heading edits remain reviewable without mutating the saved view',()=>{
 const before=view(),original=JSON.stringify(before),structure=[...defaults,custom];
 assert.equal(model.productLabelValue(before,'red',custom.id),'');assert.equal(model.productLabelValue(before,'red',custom.id,{[custom.id]:'작성중 값'}),'작성중 값');assert.equal(model.productLabelValue(before,'red',custom.id,{[custom.id]:null}),'');
 assert.deepEqual(plain(model.productLabelChanges(before,'red',{},structure)),[]);assert.throws(()=>model.productLabelChanges(before,'red',{}));
 const invalid=[...defaults,{...custom,label:''}];assert.equal(model.productLabelDefinitions({structure:invalid}).at(-1).label,'');assert.ok(model.productLabelDraftIssues(before,'red',{[custom.id]:'유지할 값'},invalid).length);
 assert.equal(model.productLabelDraftIssues(before,'red',{[custom.id]:'정상 값'},structure).length,0);assert.equal(JSON.stringify(before),original);
});

test('metadata-only and simultaneous value saves verify exact shared structure and preserve unaffected automatic sources',()=>{
 const before=view(),structure=[custom,...defaults.slice(0,3)],after=saved(before,structure);
 model.verifyProductLabelSave(before,after,'red',{},structure);
 const draft={[custom.id]:'직접 저장'},changes=model.productLabelChanges(before,'red',draft,structure),values=saved(before,structure,changes);
 model.verifyProductLabelSave(before,values,'red',draft,structure);assert.equal(values.rows.find(row=>row.optionId==='red').values[custom.id],'직접 저장');
 for(const mutate of [v=>v.structure.reverse(),v=>v.rows[1].automatic.manufacturer='다른 자동값',v=>v.overrides.common.custom_archived='요청하지 않은 값']){
  const changed=structuredClone(values);mutate(changed);assert.throws(()=>model.verifyProductLabelSave(before,changed,'red',draft,structure));
 }
});

test('refresh accepts an acknowledged same structure but rejects concurrent headings and inactive drafts',()=>{
 const before=view(),structure=[defaults[0],custom],draft={[custom.id]:'추가값'},after=saved(before,structure,model.productLabelChanges(before,'red',draft,structure));
 model.verifyProductLabelRefresh(before,after,'red',draft,structure);
 const concurrent=saved(before,[defaults[0],{...custom,label:'다른 사용자 수정'}]);assert.throws(()=>model.verifyProductLabelRefresh(before,concurrent,'red',draft,structure));
 assert.throws(()=>model.verifyProductLabelRefresh(before,after,'red',{material:'삭제된 항목'}));
});

test('only explicit cancel-and-read accepts a changed stored structure, retaining identity and dirty-draft protections',()=>{
 const before=view(),structure=[defaults[0],custom],after=saved(before,structure);
 assert.throws(()=>model.verifyProductLabelRefresh(before,after,'red',{}));
 model.verifyProductLabelRefresh(before,after,'red',{},undefined,true);
 assert.throws(()=>model.verifyProductLabelRefresh(before,after,'red',{productName:'작성중'},undefined,true));
 assert.throws(()=>model.verifyProductLabelRefresh(before,after,'red',{},structure,true));
 for(const mutate of [v=>v.productId='other',v=>v.categoryContext.profileId='other-profile',v=>v.productVersion='2026-10-17T00:00:00.000Z']){
  const bad=structuredClone(after);mutate(bad);assert.throws(()=>model.verifyProductLabelRefresh(before,bad,'red',{},undefined,true));
 }
});

test('view validation requires exactly active value/automatic/source keys and forbids invented custom automatic facts',()=>{
 const structure=[defaults[0],custom],v=view(structure);model.verifyProductLabelsView(v,'red');
 for(const mutate of [x=>delete x.rows[1].values[custom.id],x=>x.rows[1].automatic.material='inactive',x=>x.rows[1].automatic[custom.id]='자동 사실 위조',x=>x.rows[1].sources[custom.id]='generated',x=>x.rows[1].sources[custom.id]='content',x=>x.structure[1].label=' trimmed ']){
  const bad=structuredClone(v);mutate(bad);assert.throws(()=>model.verifyProductLabelsView(bad,'red'));
 }
});

function renderFixture(){
 const draw=[],loads=[],context={font:'',measureText:text=>({width:[...text].length*10}),fillRect(){},fillText(text,x,y){draw.push({text,x,y,font:this.font});}};
 const canvas={width:300,height:150,getContext:()=>context,toBlob(callback,type){callback(new Blob(['synthetic rendered PNG'],{type}));}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/document-image-render.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,Blob,Error,document:{fonts:{load:async font=>{loads.push(font);},ready:Promise.resolve()},createElement:name=>{assert.equal(name,'canvas');return canvas;}},require:name=>{assert.equal(name,'@/app/document-image');return module('app/document-image.ts');}});
 return {render:exports.renderDocument,draw,loads,canvas};
}
test('actual canvas renderer draws one to 39 ordered heading/value rows and keeps existing width/height and two-column protections',async()=>{
 for(const count of [1,3,9,39]){
  const structure=[defaults[0],...Array.from({length:count-1},(_,i)=>({id:'custom_'+i,label:'항목'+i,required:false}))];
  const h=renderFixture(),v=view(structure,{common:Object.fromEntries(structure.filter(field=>field.id!=='productName').map(field=>[field.id,'저장값'])),options:{}}),plan=model.productLabelPlan(v,'red'),out=await h.render(plan);
  assert.equal(plan.rows.length,count);
  assert.equal(out.width,800);assert.ok(out.height>0);assert.equal(out.blob.type,'image/png');assert.deepEqual(h.draw.filter(item=>item.font.startsWith('bold')).map(item=>item.text),plain(plan.rows.map(row=>row[0]+': ')));assert.equal(h.loads.length,2);
 }
 for(const rows of [[],Array.from({length:40},()=>['항목','값']),[['제목','값','과다 열']]]){
  const h=renderFixture(),plan=model.productLabelPlan(view(),'red');plan.rows=rows;await assert.rejects(h.render(plan));assert.equal(h.canvas.width,300);
 }
 const h=renderFixture(),plan=model.productLabelPlan(view(),'red');plan.width=359;await assert.rejects(h.render(plan));
});

test('valid long headings wrap in their own bold block without clipping values or changing short legacy-row rendering',async()=>{
 const heading='긴'.repeat(80),structure=[defaults[0],{...custom,label:heading}],v=view(structure,{common:{[custom.id]:'보존할 추가 내용'},options:{}}),plan=model.productLabelPlan(v,'red'),h=renderFixture();
 assert.ok(heading.length<=80);const rendered=await h.render(plan),drawnHeading=h.draw.filter(item=>item.font.startsWith('bold')&&item.text!=='제품명: '),value=h.draw.find(item=>item.text==='보존할 추가 내용');
 assert.ok(drawnHeading.length>1);assert.equal(drawnHeading.map(item=>item.text).join(''),heading+': ');assert.equal(value.x,32);assert.ok(value.y>drawnHeading.at(-1).y);assert.ok(rendered.height>150);
 for(const line of drawnHeading)assert.ok(line.x+[...line.text].length*10<=800-32);
 const multiline=renderFixture();await multiline.render({...plan,rows:[['첫 줄\n둘째 줄','본문']]});assert.deepEqual(multiline.draw.filter(item=>item.font.startsWith('bold')).map(item=>item.text),['첫 줄','둘째 줄: ']);assert.ok(multiline.draw.find(item=>item.text==='본문').y>multiline.draw.find(item=>item.text==='둘째 줄: ').y);
});
