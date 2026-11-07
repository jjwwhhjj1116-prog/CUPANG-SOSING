import test from 'node:test';
import assert from 'node:assert/strict';
import {seoWorkspaceHarness} from './helpers/seo-workspace.mjs';
import {seoWorkspaceEditor,nodes,visibleText,responseJson} from './helpers/seo-workspace-editor.mjs';

function fixture(){
 const api=seoWorkspaceHarness(),generated=api.load('app/seo-generated-draft.ts');
 const content=structuredClone(api.content),options=structuredClone(api.options);
 for(const field of ['title','keywords','description'])content.seo[field].provenance='collected';
 content.seo.title.value='原文商品';content.seo.keywords.value=[];content.seo.description.value='原文说明';
 options.rows[0].translatedName='';options.rows[0].provenance.translatedName='collected';
 options.rows.push({...structuredClone(options.rows[0]),id:'manual-blank',translatedName:'',provenance:{...options.rows[0].provenance,translatedName:'manual'}});
 const job={id:'completed-seo-job',productId:api.id,productVersion:api.version,contentRevision:content.revision,status:'completed',error:null,
  review:{model:'test-source-bound-ai',fingerprint:'a'.repeat(64),source:{title:'原文商品',description:'原文说明',reference:'exact-source',attributes:options.rows.map(row=>({name:'option:'+row.id,value:row.originalName}))}},
  result:{model:'test-source-bound-ai',draft:{title:'검토할 상품',keywords:['검토 태그'],description:'검토할 상품 설명',attributes:options.rows.map((row,index)=>({sourceIndex:index,name:'옵션',value:index?'다른 옵션':'생성한 한국어 옵션'})),warnings:[]}}};
 api.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(content),api.id);api.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(options),api.id);
 const seed=()=>generated.createSeoGeneratedDraft({ownerId:'owner',productVersion:api.version,content,options,job,brand:'와이홉'});
 return{api,module:generated,content,options,job,seed};
}

test('captured memo composes the first brand, short feature and target noun without rewriting the provider base or raw job',()=>{
 const f=fixture();try{
  const memo={brand:'수정 브랜드, 보조 브랜드',features:'보온',keywords:'바라클라바, 방한 모자'},before=JSON.stringify({content:f.content,options:f.options,job:f.job,memo}),stored=f.api.stored();
  const seed=f.module.createSeoGeneratedDraft({ownerId:'owner',productVersion:f.api.version,content:f.content,options:f.options,job:f.job,brand:'예전 브랜드',memo});
  assert.equal(seed.values.seo.title,'수정 브랜드 보온 검토할 상품 바라클라바 방한 모자');assert.equal(seed.values.seo.keywords,'바라클라바, 방한 모자, 검토 태그');assert.equal(seed.values.seo.description,'검토할 상품 설명');
  assert.equal(JSON.stringify({content:f.content,options:f.options,job:f.job,memo}),before);assert.deepEqual(f.api.stored(),stored);
 }finally{f.api.close();}
});

test('a short Korean brand does not consume a compound noun in a feature or provider title',()=>{
 const f=fixture();try{
  const {seoGuidanceTitle}=f.api.load('app/seo-guidance-composition.ts');
  const memo={brand:'솜',features:'솜털 쿠션',keywords:'쿠션'};
  assert.equal(seoGuidanceTitle({title:''},memo),'솜 솜털 쿠션');
  assert.equal(seoGuidanceTitle({title:'솜털 쿠션'},{...memo,features:''}),'솜 솜털 쿠션');
  assert.equal(seoGuidanceTitle({title:'솜 쿠션'},memo),'솜 솜털 쿠션');
  assert.equal(seoGuidanceTitle({title:'솜쿠션'},memo),'솜 솜털 쿠션');
 }finally{f.api.close();}
});

test('a sparse signed AI title uses the same deduplicated feature-based example without changing the stored response',()=>{
 const f=fixture();try{
  const memo={brand:'유앤채, 보조 브랜드',features:'100x200cm 반짝이 스트링 장식 실커튼',keywords:'실커튼'};
  f.options.rows[0].originalName='浅紫 / 100*200cm';
  f.options.rows[1].originalName='香槟 / 100*200cm';
  f.job.review.source.title='闪亮线帘';
  f.job.review.source.attributes=f.options.rows.map(row=>({name:'option:'+row.id,value:row.originalName}));
  f.job.review.seoComposition={version:'couplus-current-composition-v1',memo,related:{source:'none',query:'실커튼',keywords:[],warnings:[]}};
  f.job.review.seoCompositionContext=f.api.load('app/seo-composition-context.ts').seoCompositionContext(f.options);
  f.job.result.draft.title='유앤채실커튼';
  f.job.result.draft.attributes=[];
  f.job.result.seoOptions=[{optionId:f.options.rows[0].id,name:'연보라 / 100*200cm'}];
  const before=JSON.stringify(f.job),input={ownerId:'owner',productVersion:f.api.version,content:f.content,options:f.options,job:f.job,brand:'유앤채',memo};
  const seed=f.module.createSeoGeneratedDraft(input);
  assert.equal(seed.values.seo.title,'유앤채 100x200cm 반짝이 스트링 장식 실커튼');
  assert.deepEqual(JSON.parse(JSON.stringify(seed.values.optionNames)),{[f.options.rows[0].id]:'연보라 / 100*200cm'});
  assert.equal(JSON.stringify(f.job),before);
  f.content.seo.title={value:'직접 저장한 제목',provenance:'manual',updatedAt:f.api.version};
  assert.equal(f.module.createSeoGeneratedDraft(input).values.seo.title,undefined);
  f.job.review.seoComposition.memo={...memo,features:'150x200cm 반짝이 실커튼'};
  assert.equal(f.module.createSeoGeneratedDraft({...input,replaceSaved:true}).values.seo.title,'유앤채실커튼');
  f.job.review.seoComposition.memo={...memo,features:'한국산 반짝이 실커튼'};
  f.job.review.source.reference='https://detail.1688.com/offer/1234.html';
  f.job.review.source.attributes.push({name:'产地',value:'中国'});
  assert.equal(f.module.createSeoGeneratedDraft({...input,replaceSaved:true}).values.seo.title,'유앤채실커튼');
 }finally{f.api.close();}
});

test('long or multiline features and a composed title above 100 keep the provider title instead of inserting invalid memo text',()=>{
 const f=fixture();try{for(const memo of [{brand:'수정 브랜드',features:'긴'.repeat(101),keywords:'바라클라바'},{brand:'수정 브랜드',features:'짧은 특징\n둘째 줄',keywords:'바라클라바'},{brand:'수정 브랜드',features:'긴'.repeat(80),keywords:'바라클라바, 방한 모자'}]){
  const seed=f.module.createSeoGeneratedDraft({ownerId:'owner',productVersion:f.api.version,content:f.content,options:f.options,job:f.job,brand:'예전 브랜드',memo});
  assert.equal(seed.values.seo.title,'수정 브랜드 검토할 상품');assert.ok(!seed.values.seo.title.includes(memo.features));assert.ok(seed.values.seo.keywords.startsWith('바라클라바'));assert.ok(seed.warnings.some(value=>value.includes('상품명')&&value.includes('유지')));
 }}finally{f.api.close();}
});

test('oversized target tags preserve provider tags and do not leak a partial target into the composed title',()=>{
 const f=fixture();try{for(const keywords of ['큰'.repeat(21),Array.from({length:10},(_,index)=>'검색어'+index+'가'.repeat(13)).join(', ')]){
  const seed=f.module.createSeoGeneratedDraft({ownerId:'owner',productVersion:f.api.version,content:f.content,options:f.options,job:f.job,brand:'예전 브랜드',memo:{brand:'수정 브랜드',features:'보온',keywords}});
  assert.equal(seed.values.seo.title,'수정 브랜드 보온 검토할 상품');assert.equal(seed.values.seo.keywords,'검토 태그');assert.ok(seed.warnings.some(value=>value.includes('검색태그')&&value.includes('유지')));
 }}finally{f.api.close();}
});

test('memo composition preserves saved manual fields unless explicit regeneration is requested, and arriving seeds keep dirty edits',()=>{
 const f=fixture();try{
  f.content.seo.title={value:'직접 저장한 제목',provenance:'manual',updatedAt:f.api.version};f.content.seo.keywords={value:[],provenance:'manual',updatedAt:f.api.version};
  const input={ownerId:'owner',productVersion:f.api.version,content:f.content,options:f.options,job:f.job,brand:'예전 브랜드',memo:{brand:'수정 브랜드',features:'보온',keywords:'바라클라바'}};
  const preserved=f.module.createSeoGeneratedDraft(input);assert.equal(preserved.values.seo.title,undefined);assert.equal(preserved.values.seo.keywords,undefined);
  const seed=f.module.createSeoGeneratedDraft({...input,replaceSaved:true});assert.equal(seed.values.seo.title,'수정 브랜드 보온 검토할 상품 바라클라바');assert.equal(seed.values.seo.keywords,'바라클라바, 검토 태그');
  const merged=f.module.mergeSeoGeneratedDraft(seed,{productId:f.content.productId,productVersion:f.api.version,content:f.content,options:f.options},'owner',{seo:{title:'입력 중 제목',keywords:''},optionNames:{}});assert.equal(merged.seo.title,'입력 중 제목');assert.equal(merged.seo.keywords,'');
 }finally{f.api.close();}
});

test('a completed exact-source job seeds editable SEO and names without mutations, then one explicit SEO save adopts the reviewed values',async()=>{
 const f=fixture(),{api}=f,h=seoWorkspaceEditor(api,{props:{workspaceOwnerId:'owner'}});try{
  await h.idle();const before=api.stored(),seed=f.seed();assert.deepEqual(JSON.parse(JSON.stringify(seed.values.optionNames)),{[f.options.rows[0].id]:'생성한 한국어 옵션'});h.patch({generatedDraft:seed});await h.idle();
  assert.equal(h.input('SEO 상품명').props.value,'와이홉 검토할 상품');assert.equal(h.input('SEO 검색태그').props.value,'검토 태그');assert.equal(h.input('1번째 한국어 옵션명').props.value,'생성한 한국어 옵션');assert.equal(h.input('3번째 한국어 옵션명').props.value,'');assert.equal(h.calls.filter(call=>call.method==='PATCH').length,0);assert.deepEqual(api.stored(),before);
  h.edit('SEO 상품명','직접 검토한 상품');h.patch({generatedDraft:seed});await h.idle();assert.equal(h.input('SEO 상품명').props.value,'직접 검토한 상품','the same job cannot overwrite a later manual edit');
  await h.click('SEO 설정 저장');assert.equal(h.calls.filter(call=>call.method==='PATCH').length,1);const saved=await responseJson(await api.request());assert.equal(saved.content.seo.title.value,'직접 검토한 상품');assert.equal(saved.content.seo.title.provenance,'manual');assert.equal(saved.options.rows[0].translatedName,'생성한 한국어 옵션');assert.equal(saved.options.rows[2].translatedName,'');assert.equal(saved.options.rows[2].provenance.translatedName,'manual');assert.equal(api.stored().quotation.payload,before.quotation.payload);
 }finally{h.close();api.close();}
});

test('saved manual values and blanks plus already edited draft fields win over a generated seed',async()=>{
 const f=fixture(),{api}=f;f.content.seo.title={value:'',provenance:'manual',updatedAt:api.version};f.content.seo.keywords={value:['직접 태그'],provenance:'manual',updatedAt:api.version};api.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(f.content),api.id);
 const h=seoWorkspaceEditor(api,{props:{workspaceOwnerId:'owner'}});try{
  await h.idle();h.edit('SEO 상품 설명','');h.edit('1번째 한국어 옵션명','직접 옵션');const seed=f.seed();assert.equal(seed.values.seo.title,undefined);assert.equal(seed.values.seo.keywords,undefined);h.patch({generatedDraft:seed});await h.idle();assert.equal(h.input('SEO 상품명').props.value,'');assert.equal(h.input('SEO 검색태그').props.value,'직접 태그');assert.equal(h.input('SEO 상품 설명').props.value,'');assert.equal(h.input('1번째 한국어 옵션명').props.value,'직접 옵션');assert.equal(h.calls.filter(call=>call.method==='PATCH').length,0);
 }finally{h.close();api.close();}
});

test('direct regeneration may replace saved reviewed values in the buffer while pending edits and blanks still win',async()=>{
 const f=fixture(),{api}=f;f.content.seo.title={value:'이전 직접 저장 제목',provenance:'manual',updatedAt:api.version};f.content.seo.keywords={value:[],provenance:'manual',updatedAt:api.version};f.options.rows[0].translatedName='이전 직접 저장 옵션';f.options.rows[0].provenance.translatedName='manual';
 api.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(f.content),api.id);api.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(f.options),api.id);
 const h=seoWorkspaceEditor(api,{props:{workspaceOwnerId:'owner'}});try{
  await h.idle();h.edit('SEO 검색태그','');const before=api.stored(),batch=f.module.seoRegenerationOptionBatch(f.options,50);assert.ok(batch.attributes.some(pair=>pair.name==='option:'+f.options.rows[0].id));assert.ok(batch.attributes.some(pair=>pair.name==='option:manual-blank'));assert.ok(!batch.attributes.some(pair=>pair.name==='option:second'));assert.equal(f.module.seoRegenerationOptionBatch(f.options,1).remaining,1);
  const seed=f.module.createSeoGeneratedDraft({ownerId:'owner',productVersion:api.version,content:f.content,options:f.options,job:f.job,brand:'와이홉',replaceSaved:true});assert.equal(seed.intent,'explicit-regeneration');h.patch({generatedDraft:seed});await h.idle();assert.equal(h.input('SEO 상품명').props.value,'와이홉 검토할 상품');assert.equal(h.input('1번째 한국어 옵션명').props.value,'생성한 한국어 옵션');assert.equal(h.input('3번째 한국어 옵션명').props.value,'다른 옵션');assert.equal(h.input('SEO 검색태그').props.value,'','the explicit unsaved blank wins');assert.deepEqual(api.stored(),before);assert.equal(h.calls.filter(call=>call.method==='PATCH').length,0);
 }finally{h.close();api.close();}
});

test('owner product clocks and exact option bindings fence late seeds without losing current user edits',async()=>{
 for(const change of [s=>{s.ownerId='other';},s=>{s.productId='other';},s=>{s.productVersion='2026-10-01T00:00:00.000Z';},s=>{s.contentRevision++;},s=>{s.optionRevision++;},s=>{s.source.options[0].originalName='另一原文';}]){
  const f=fixture(),{api}=f,h=seoWorkspaceEditor(api,{props:{workspaceOwnerId:'owner'}});try{
   await h.idle();h.edit('SEO 상품명','작성 중인 상품');const before=api.stored(),seed=f.seed();change(seed);h.patch({generatedDraft:seed});await h.idle();assert.equal(h.input('SEO 상품명').props.value,'작성 중인 상품');assert.equal(h.input('1번째 한국어 옵션명').props.value,'');assert.equal(h.calls.filter(call=>call.method==='PATCH').length,0);assert.deepEqual(api.stored(),before);
  }finally{h.close();api.close();}
 }
});

test('incomplete or wrong-version provider jobs cannot create an editable seed and warning text stays visible',async()=>{
 const f=fixture(),{api}=f;try{
  for(const change of [j=>{j.status='running';},j=>{j.productVersion='2026-10-01T00:00:00.000Z';},j=>{j.contentRevision++;},j=>{j.result.model='other';}]){const job=structuredClone(f.job);change(job);assert.throws(()=>f.module.createSeoGeneratedDraft({ownerId:'owner',productVersion:api.version,content:f.content,options:f.options,job,brand:'와이홉'}),/완료 SEO 초안/);}
  f.job.result.draft.warnings=['일부 원문은 직접 확인해주세요.'];const h=seoWorkspaceEditor(api,{props:{workspaceOwnerId:'owner',generatedDraft:f.seed()}});try{await h.idle();const visible=nodes(h.render()).filter(node=>node.props?.role==='status').map(visibleText).join(' ');assert.match(visible,/일부 원문은 직접 확인/);assert.equal(h.calls.filter(call=>call.method==='PATCH').length,0);}finally{h.close();}
 }finally{api.close();}
});
