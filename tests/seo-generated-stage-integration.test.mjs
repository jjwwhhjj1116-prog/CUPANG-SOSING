import test from 'node:test';
import assert from 'node:assert/strict';
import {detailStageUI} from './helpers/option-detail-manual-edit.mjs';
import {nextVersion} from './helpers/seo-workspace-editor.mjs';

const generator=h=>h.record('seo-workspace-generator');
const editor=h=>h.record('seo-workspace-editor');
const seedFor=(h,overrides={})=>({format:'yoofam-seo-generated-draft-v1',ownerId:'owner-a',productId:generator(h).props.productId,
  productVersion:generator(h).props.version,jobId:'completed-job',values:{seo:{title:'생성한 검토 초안'},optionNames:{}},...overrides});

test('completed SEO input is handed to the same active editor without persisting or submitting',()=>{
 const h=detailStageUI({tab:'SEO',workspaceOwnerId:'owner-a'});try{
  const seed=seedFor(h);generator(h).props.onDraft(seed);
  assert.equal(editor(h).props.generatedDraft,seed);assert.equal(editor(h).props.workspaceOwnerId,'owner-a');
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),{saved:0,reads:0,uploads:0,submission:0});
 }finally{h.close();}
});

test('late generated drafts cannot enter another owner, product or saved source version, including ABA',()=>{
 for(const changed of ['owner','product','source']){
  const h=detailStageUI({tab:'SEO',workspaceOwnerId:'owner-a'});try{
   const first=generator(h).props,callback=first.onDraft,seed=seedFor(h);
   const original={id:first.productId,title:'원래 검수 상품',updated_at:first.version,image_keys:'[]'};
   if(changed==='owner')h.render({workspaceOwnerId:'owner-b'});
   else h.render({product:{...original,...(changed==='product'?{id:'other-product'}:{updated_at:nextVersion(first.version)})}});
   callback(seed);assert.equal(editor(h).props.generatedDraft,null);
   if(changed==='owner')h.render({workspaceOwnerId:'owner-a'});else h.render({product:original});
   callback(seed);assert.equal(editor(h).props.generatedDraft,null,'retired callback stays retired after returning');
   const current=seedFor(h);generator(h).props.onDraft(current);assert.equal(editor(h).props.generatedDraft,current);
  }finally{h.close();}
 }
});

test('stage leave retires the draft publisher and rejects mismatched current job binding',()=>{
 const h=detailStageUI({tab:'SEO',workspaceOwnerId:'owner-a'});try{
  const callback=generator(h).props.onDraft,seed=seedFor(h);h.render({tab:'가격'});callback(seed);assert.equal(editor(h).props.generatedDraft,null);
  h.render({tab:'SEO'});callback(seed);assert.equal(editor(h).props.generatedDraft,null);
  for(const override of [{ownerId:'owner-b'},{productId:'another'},{productVersion:nextVersion(seed.productVersion)}]){
   generator(h).props.onDraft({...seed,...override});assert.equal(editor(h).props.generatedDraft,null);
  }
  generator(h).props.onDraft(seed);assert.equal(editor(h).props.generatedDraft,seed);
 }finally{h.close();}
});
