import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {seoWorkspaceHarness} from './helpers/seo-workspace.mjs';
import {seoWorkspaceEditor,nodes,visibleText,responseJson} from './helpers/seo-workspace-editor.mjs';
const row=JSON.parse(fs.readFileSync(new URL('./fixtures/ten-category-seo-tags.json',import.meta.url),'utf8')).find(value=>value.keywords.length===108);
const section=(h,label)=>nodes(h.render()).find(node=>node.type==='section'&&node.props['aria-label']===label);
function fixture(){
 const api=seoWorkspaceHarness(),content=structuredClone(api.content);content.seo.keywords.provenance='collected';
 api.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(content),api.id);
 const job={id:'synthetic-job',productId:api.id,productVersion:api.version,contentRevision:content.revision,status:'completed',error:null,review:{model:'synthetic',fingerprint:'a'.repeat(64),seoKeywordPolicy:'couplus-generated-v1',source:{reference:'synthetic',attributes:[]}},result:{model:'synthetic',draft:{title:'',description:'',keywords:row.keywords,attributes:[],warnings:[]}}};
 const seed=api.load('app/seo-generated-draft.ts').createSeoGeneratedDraft({ownerId:'owner',productVersion:api.version,content,options:api.options,job,brand:''});
 const h=seoWorkspaceEditor(api,{props:{workspaceOwnerId:'owner',generatedDraft:seed}});return {api,h};
}
test('actual editor previews and saves all108 generated metadata terms with the native document prefix',async()=>{
 const {api,h}=fixture();try{
  await h.idle();assert.match(visibleText(section(h,'검색태그 최종 저장안')),new RegExp('최종 저장 검색태그: '+row.keywords.join(', ')));
  assert.equal(section(h,'검색태그 저장안'),undefined,'intact generated metadata has no manual shortening notice');
  assert.ok(visibleText(section(h,'견적서 검색태그 반영안')).includes('저장 후 견적서 자동 검색태그: '+row.searchTags[0]));
  assert.equal(h.calls.filter(call=>call.method==='PATCH').length,0);
  await h.click('SEO 설정 저장');const saved=await responseJson(await api.request());assert.equal(saved.content.seo.keywords.value.length,108);assert.equal(saved.content.seoKeywordDocument.value,row.searchTags[0]);
 }finally{h.close();api.close();}
});
test('editing a generated keyword seed retires its candidate processing and previews the manual whole-tag prefix',async()=>{
 const {api,h}=fixture();try{
  await h.idle();const raw=row.keywords.join(', ')+', 직접 태그';h.edit('SEO 검색태그',raw);await h.idle();
  const tags=api.load('app/seo-keyword-text.ts'),expected=tags.cleanSeoKeywordCandidates(tags.prepareSeoKeywordText(raw).keywords);
  assert.ok(visibleText(section(h,'검색태그 최종 저장안')).includes('최종 저장 검색태그: '+expected.join(', ')));
  assert.ok(section(h,'검색태그 저장안'));await h.click('SEO 설정 저장');const saved=await responseJson(await api.request());assert.deepEqual(saved.content.seo.keywords.value,Array.from(expected));
 }finally{h.close();api.close();}
});
test('invalid edited input never previews candidate adoption or sends a save',async()=>{
 const {api,h}=fixture();try{
  await h.idle();const before=api.stored();h.edit('SEO 검색태그','잘못된\u0000입력');await h.idle();
  assert.equal(section(h,'검색태그 최종 저장안'),undefined);assert.equal(h.button('SEO 설정 저장').props.disabled,true);assert.equal(h.calls.filter(call=>call.method==='PATCH').length,0);assert.deepEqual(api.stored(),before);
 }finally{h.close();api.close();}
});
