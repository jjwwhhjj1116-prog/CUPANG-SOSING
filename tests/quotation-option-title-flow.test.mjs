import test from 'node:test';
import assert from 'node:assert/strict';
import {originalTitleFixture,originalTitleEvidenceAvailable,titleCompanies,plain} from './helpers/quotation-option-title.mjs';

function unchanged(f,before,network){assert.equal(f.stable(),before);assert.equal(f.h.network.length,network);assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM supplier_hub_receipts').get().n,0);assert.equal(f.product().supplier_hub_status,'미전송');assert.deepEqual(Buffer.from(f.h.objects.get(f.profile.template.storageKey)),Buffer.from(f.bytes));}
const protectedCells=view=>view.resolved.rows.map(row=>({optionId:row.optionId,fields:Object.fromEntries(Object.entries(row.fields).filter(([key])=>key!=='title'))}));
for(const company of titleCompanies)test(`saved category/URL intake creates six distinct automatic titles in stage seven and original Excel column 2 (${company.code})`,{skip:!originalTitleEvidenceAvailable},async()=>{
 const f=await originalTitleFixture(company);try{const view=await f.view(),content=(await f.content()).content,options=(await f.options()).options,before=f.stable(),network=f.h.network.length;
  assert.equal(view.resolved.schema.categoryId,'69900');assert.deepEqual(view.resolved.schema.categoryPath,plain(f.profile.categoryPath));assert.deepEqual(plain(f.profile.hubSchema.company),company);assert.equal(view.resolved.schema.fields.find(field=>field.id==='title').hubInput,'title');assert.deepEqual(plain(view.resolved.schema.fields.find(field=>field.id==='title').hubWire),{path:['startPage','productName']});
  const expected=options.rows.filter(row=>row.included).map(row=>content.seo.title.value+', '+row.translatedName),result=await f.output();assert.equal(expected.length,6);assert.equal(new Set(expected).size,6);assert.deepEqual(result.titles,expected);assert.equal(view.resolved.rows[0].fields.title.value,content.seo.title.value);
  result.included.forEach((row,index)=>{assert.equal(row.fields.title.value,expected[index]);assert.equal(row.fields.title.source,'content');assert.equal(row.fields.model.value,'');});assert.ok(!result.preview.submissionReview.issues.some(issue=>issue.code==='EXCEL_FIELD_UNMAPPED'&&issue.fieldId==='title'));unchanged(f,before,network);
 }finally{f.close();}
});
for(const company of titleCompanies)test(`explicit quotation common/option titles and blanks remain exact without a hidden suffix (${company.code})`,{skip:!originalTitleEvidenceAvailable},async()=>{
 const f=await originalTitleFixture(company);try{const view=await f.view(),ids=view.resolved.rows.filter(row=>row.included).map(row=>row.optionId),protectedBefore=plain(protectedCells(view)),before=f.stable(),network=f.h.network.length;
  await f.save([{fieldKey:'title',optionId:null,value:'사람이 검토한 공통 제목'},{fieldKey:'title',optionId:ids[0],value:''},{fieldKey:'title',optionId:ids[1],value:'사람이 검토한 옵션 제목'}]);const result=await f.output();assert.deepEqual(result.titles,['','사람이 검토한 옵션 제목',...Array(4).fill('사람이 검토한 공통 제목')]);assert.equal(result.included[0].fields.title.source,'manual-option');assert.equal(result.included[2].fields.title.source,'manual-common');assert.deepEqual(plain(protectedCells(result.fields)),protectedBefore);
  await f.save([{fieldKey:'title',optionId:null,value:''}]);assert.deepEqual((await f.output()).titles,['','사람이 검토한 옵션 제목','','','','']);unchanged(f,before,network);
 }finally{f.close();}
});
for(const company of titleCompanies)test(`explicit SEO/name removals stay empty while automatic names never fall back to seller names or SKU (${company.code})`,{skip:!originalTitleEvidenceAvailable},async()=>{
 const f=await originalTitleFixture(company);try{const before=f.stable(),network=f.h.network.length,base=(await f.content()).content.seo.title.value;
  await f.editOptions(rows=>{rows[0].translatedName='';});const first=await f.output();assert.equal(first.titles[0],base);assert.ok(!first.titles[0].includes(first.included[0].optionLabel));const options=(await f.options()).options;assert.equal(options.rows[0].provenance.translatedName,'manual');assert.equal(options.rows[0].translatedName,'');assert.ok(options.rows[0].originalName);
  await f.editContent({seo:{title:''}});const blank=await f.output();assert.deepEqual(blank.titles,Array(6).fill(''));assert.ok(blank.included.every(row=>row.fields.title.source==='content'));assert.equal((await f.content()).content.seo.title.provenance,'manual');unchanged(f,before,network);
 }finally{f.close();}
});
for(const company of titleCompanies)test(`only included saved options contribute their own edited title and no unrelated notice/model/price/image changes (${company.code})`,{skip:!originalTitleEvidenceAvailable},async()=>{
 const f=await originalTitleFixture(company);try{const original=await f.view(),protectedBefore=plain(protectedCells(original)),before=f.stable(),network=f.h.network.length;
  await f.editOptions(rows=>{rows[0].translatedName='직접 확인한 한글 옵션';rows[5].included=false;rows[5].translatedName='제외 옵션 전용';});const result=await f.output(),base=(await f.content()).content.seo.title.value;assert.equal(result.titles.length,5);assert.equal(result.titles[0],base+', 직접 확인한 한글 옵션');assert.ok(!result.titles.some(value=>value.includes('제외 옵션 전용')));assert.equal(result.fields.resolved.rows.find(row=>row.optionId==='collected-6').included,false);
  const after=plain(protectedCells(result.fields));assert.deepEqual(after.slice(0,6),protectedBefore.slice(0,6));unchanged(f,before,network);
 }finally{f.close();}
});
