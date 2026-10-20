import test from 'node:test';
import assert from 'node:assert/strict';
import {seoWorkspaceHarness} from './helpers/seo-workspace.mjs';
import {seoWorkspaceEditor,nodes,visibleText,deferred,nextVersion,responseJson,plain} from './helpers/seo-workspace-editor.mjs';

const clear='검색태그·견적서 태그 함께 비우기',patches=h=>h.calls.filter(call=>call.method==='PATCH');
function seed(api,{retained=false,overrides=false}={}){
  const content=structuredClone(api.content);content.seo.keywords={value:retained?[]:['이전 견적 태그'],provenance:'manual',updatedAt:api.version};
  if(retained)content.seoKeywordDocument={policy:'couplus-service-v1',sourceKeywords:[],sourceUpdatedAt:api.version,value:'이전 견적 태그'};
  api.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(content),api.id);
  if(overrides){const quotation=JSON.parse(api.stored().quotation.payload);quotation.overrides.common.searchTags='직접 공통 태그';quotation.overrides.options.second.searchTags='';
    api.sqlite.prepare('UPDATE product_quotation_fields SET payload=? WHERE product_id=?').run(JSON.stringify(quotation),api.id);}
}
async function stage7(api){return responseJson(await api.load('app/api/products/[id]/quotation-fields/route.ts').GET(
  new Request('https://app.test/api/products/'+api.id+'/quotation-fields'),{params:Promise.resolve({id:api.id})}));}
const section=h=>nodes(h.render()).find(node=>node.props?.['aria-label']==='견적서 검색태그 반영안');
const detailsFor=(h,node)=>nodes(h.render()).find(parent=>parent.type==='details'&&nodes(parent).some(child=>child.props?.['aria-label']===node));

for(const companyCode of ['A01464742','A01526306'])for(const retained of [false,true])test(`${companyCode}: explicit whole clear reaches Stage7 from ${retained?'retained empty metadata':'prior nonempty tags'} and preserves manual overrides and other dirty edits`,async()=>{
  const api=seoWorkspaceHarness({companyCode});seed(api,{retained,overrides:true});const before=api.stored(),h=seoWorkspaceEditor(api);
  try{
    await h.idle();assert.ok(visibleText(section(h)).includes('이전 견적 태그'));assert.equal(patches(h).length,0);
    assert.equal(detailsFor(h,'견적서 검색태그 반영안').props.open,undefined,'untouched document-tag tools start collapsed without a write');
    h.edit('SEO 상품명','함께 검토한 상품명');h.edit('1번째 한국어 옵션명','함께 검토한 옵션');await h.click(clear);
    assert.equal(patches(h).length,0);assert.equal(h.input('SEO 검색태그').props.value,'');assert.equal(h.input('SEO 상품명').props.value,'함께 검토한 상품명');
    assert.ok(visibleText(section(h)).includes('저장 후 견적서 자동 검색태그: (공란)'));
    assert.ok(visibleText(section(h)).includes('저장하면 검색태그와 견적서 자동 검색태그를 모두 비웁니다'));
    assert.equal(detailsFor(h,'견적서 검색태그 반영안').props.open,true,'explicit clear reveals its document effect before saving');
    await h.click('SEO 설정 저장');assert.equal(patches(h).length,1);
    assert.deepEqual(patches(h)[0].body.seo,{title:'함께 검토한 상품명',keywords:[]});
    assert.equal(Object.hasOwn(patches(h)[0].body.seo,'keywordText'),false,'explicit action uses the existing array-only clear contract');
    const saved=await responseJson(await api.request()),view=await stage7(api);
    assert.deepEqual(saved.content.seo.keywords.value,[]);assert.equal(saved.content.seo.keywords.provenance,'manual');
    assert.equal(saved.content.seo.title.value,'함께 검토한 상품명');assert.equal(saved.options.rows[0].translatedName,'함께 검토한 옵션');
    assert.ok(view.automatic.rows.every(row=>row.fields.searchTags.value===''));
    assert.equal(view.resolved.rows.find(row=>row.optionId===api.options.rows[0].id).fields.searchTags.value,'직접 공통 태그');
    assert.equal(view.resolved.rows.find(row=>row.optionId==='second').fields.searchTags.value,'');
    assert.deepEqual(api.stored().quotation,before.quotation);assert.deepEqual(saved.content.assets,api.content.assets);assert.deepEqual(saved.content.label,api.content.label);
    assert.equal(saved.options.rows[0].unitCostCny,api.options.rows[0].unitCostCny);assert.equal(saved.options.rows[0].packagedWeightG,350);
    assert.equal(h.saved,1);assert.equal(h.render().props['data-workspace-dirty'],false);assert.ok(visibleText(section(h)).includes('현재 견적서 자동 검색태그: (공란)'));
  }finally{h.close();api.close();}
});

for(const companyCode of ['A01464742','A01526306'])test(`${companyCode}: ordinary blank save keeps observed document retention and shows its real effect; subsequent explicit clear removes it`,async()=>{
  const api=seoWorkspaceHarness({companyCode});seed(api);const h=seoWorkspaceEditor(api);
  try{
    await h.idle();h.edit('SEO 검색태그','');assert.ok(visibleText(section(h)).includes('저장 후 견적서 자동 검색태그: 이전 견적 태그'));
    assert.ok(visibleText(section(h)).includes('이전 검색태그가 유지됩니다'));
    assert.equal(detailsFor(h,'견적서 검색태그 반영안').props.open,true,'ordinary blank edits cannot conceal retained quotation tags');await h.click('SEO 설정 저장');
    assert.deepEqual(patches(h)[0].body.seo,{keywordText:'',keywords:[]});assert.ok((await stage7(api)).automatic.rows.every(row=>row.fields.searchTags.value==='이전 견적 태그'));
    await h.click(clear);await h.click('SEO 설정 저장');assert.deepEqual(patches(h)[1].body.seo,{keywords:[]});
    assert.ok((await stage7(api)).automatic.rows.every(row=>row.fields.searchTags.value===''));assert.equal(h.saved,2);
  }finally{h.close();api.close();}
});

test('new keyword input replaces the clear intent without losing unrelated SEO/name drafts',async()=>{
  for(const value of ['새 태그','']){const api=seoWorkspaceHarness();seed(api);const h=seoWorkspaceEditor(api);try{
    await h.idle();h.edit('SEO 상품 설명','보존한 설명');await h.click(clear);h.edit('SEO 검색태그',value);await h.click('SEO 설정 저장');
    assert.equal(patches(h).length,1);assert.equal(patches(h)[0].body.seo.keywordText,value);assert.equal(patches(h)[0].body.seo.description,'보존한 설명');
    assert.ok((await stage7(api)).automatic.rows.every(row=>row.fields.searchTags.value===(value||'이전 견적 태그')));
  }finally{h.close();api.close();}}
});

test('uncommitted clear, malformed clear marker and stale identity never become a broader metadata patch',async()=>{
  const api=seoWorkspaceHarness();seed(api);const client=api.load('app/seo-workspace-client.ts'),view=await responseJson(await api.request());
  try{
    for(const draft of [{seo:{},optionNames:{},clearDocumentKeywords:true},{seo:{keywords:'존재하는 태그'},optionNames:{},clearDocumentKeywords:true},
      {seo:{keywords:''},optionNames:{},clearDocumentKeywords:false}])assert.throws(()=>client.seoWorkspaceInput(view,draft),/함께 비울/);
    const input=client.seoWorkspaceInput(view,{seo:{keywords:''},optionNames:{},clearDocumentKeywords:true});assert.deepEqual(plain(input.seo),{keywords:[]});
    const before=api.stored();assert.deepEqual(before,api.stored());assert.equal(api.mutations.length,0);
  }finally{api.close();}
});

test('clear selection obeys disabled and busy boundaries even through captured callbacks',async()=>{
  const api=seoWorkspaceHarness();seed(api);const waiting=deferred();let held;
  const h=seoWorkspaceEditor(api,{fetcher:(url,init,route)=>{if(init?.method==='PATCH'){held={url,init,route};return waiting.promise;}return route(url,init);}});
  try{
    await h.idle();const callback=h.button(clear).props.onClick;h.patch({disabled:true});callback();assert.equal(h.render().props['data-workspace-dirty'],false);
    h.patch({disabled:false});await h.click(clear);h.button('SEO 설정 저장').props.onClick();assert.equal(patches(h).length,1);callback();
    assert.equal(h.button(clear).props.disabled,true);assert.equal(h.input('SEO 검색태그').props.value,'');
    waiting.resolve(await held.route(held.url,held.init));await h.idle();assert.equal(patches(h).length,1);assert.equal(h.saved,1);
  }finally{waiting.resolve(Response.json({error:'fixture end'},{status:503}));h.close();api.close();}
});

for(const boundary of ['version','scope','inactive'])test(`whole-clear captured actions reject ${boundary} changes while the draft requires review`,async()=>{
  const api=seoWorkspaceHarness();seed(api);const h=seoWorkspaceEditor(api);
  try{
    await h.idle();const callback=h.button(clear).props.onClick;await h.click(clear);const save=h.button('SEO 설정 저장').props.onClick;
    h.patch(boundary==='version'?{version:nextVersion(api.version)}:boundary==='scope'?{productId:'foreign-product'}:{active:false},false);
    callback();save();assert.equal(patches(h).length,0);assert.equal(api.mutations.length,0);
    if(boundary!=='scope')assert.equal(h.input('SEO 검색태그',h.render(false)).props.value,'');
  }finally{h.close();api.close();}
});

test('lost clear-save ACK recovers by GET only and keeps manual quotation fields unchanged',async()=>{
  const api=seoWorkspaceHarness();seed(api,{retained:true,overrides:true});const before=api.stored().quotation;
  const h=seoWorkspaceEditor(api,{fetcher:async(url,init,route)=>{const response=await route(url,init);if(init?.method==='PATCH')throw Error('synthetic ACK lost');return response;}});
  try{
    await h.idle();await h.click(clear);await h.click('SEO 설정 저장');assert.equal(h.saved,0);assert.ok(h.button('SEO 저장 결과 확인'));
    assert.equal(detailsFor(h,'SEO 상품 설명').props.open,true,'an uncertain save exposes the saved-state recovery tools automatically');
    assert.equal(h.button(clear).props.disabled,true);await h.click('SEO 저장 결과 확인');assert.equal(patches(h).length,1);assert.equal(h.saved,1);
    assert.ok((await stage7(api)).automatic.rows.every(row=>row.fields.searchTags.value===''));assert.deepEqual(api.stored().quotation,before);
  }finally{h.close();api.close();}
});

test('ownership loss before a clear save is rejected by the actual API without clearing metadata or manual quotation fields',async()=>{
  const api=seoWorkspaceHarness();seed(api,{retained:true,overrides:true});const h=seoWorkspaceEditor(api);
  try{
    await h.idle();await h.click(clear);
    api.sqlite.prepare('UPDATE products SET owner_id=? WHERE id=?').run('foreign-owner',api.id);
    const before=api.stored();await h.click('SEO 설정 저장');
    assert.equal(patches(h).length,1);assert.equal(h.saved,0);assert.deepEqual(api.stored(),before);
    assert.equal(h.input('SEO 검색태그').props.value,'');assert.equal(h.render().props['data-workspace-dirty'],true);
    assert.ok(nodes(h.render()).some(node=>node.props?.role==='alert'));
  }finally{h.close();api.close();}
});
