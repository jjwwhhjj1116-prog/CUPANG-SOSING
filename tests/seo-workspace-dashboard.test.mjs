import test from 'node:test';
import assert from 'node:assert/strict';
import {detailStageUI} from './helpers/option-detail-manual-edit.mjs';

test('stage one shows one common SEO/name editor and keeps selected quotation SEO independent',()=>{
  const h=detailStageUI({tab:'SEO',onBeforeSeoGenerate:()=>true});try{
    const unified=h.record('seo-workspace-editor'),selected=h.record('option-seo-editor'),generator=h.record('seo-workspace-generator');
    assert.equal(h.visible(unified),true);assert.equal(unified.props.active,true);assert.equal(unified.props.focusedOptionId,'red');assert.equal(unified.props.productId,'product-a');
    assert.equal(h.visible(selected),true);assert.equal(selected.props.optionId,'red');assert.equal(h.visible(generator),true);
    assert.equal(h.all('product-options-editor').some(row=>row.props.seoView===true),false,'old separate Korean-name save UI is removed');
    assert.equal(h.visible(h.record('product-content-editor')),false,'old common SEO controls are hidden');
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),{saved:0,reads:0,uploads:0,submission:0});
  }finally{h.close();}
});

test('hidden common content and unified SEO buffers retain their instances and close guards across stages',()=>{
  const h=detailStageUI({tab:'상세 이미지',onBeforeSeoGenerate:()=>true});try{
    const common=h.record('product-content-editor'),unified=h.record('seo-workspace-editor');
    h.edit('product-content-editor','other-stage unsaved content');h.edit('seo-workspace-editor','unified SEO unsaved name');
    for(const tab of ['SEO','견적서','추가 이미지','표시사항','상세 이미지']){
      h.render({tab});const retainedCommon=h.record('product-content-editor'),retainedSeo=h.record('seo-workspace-editor');
      assert.equal(retainedCommon.instance,common.instance);assert.equal(retainedCommon.draft,'other-stage unsaved content');
      assert.equal(retainedSeo.instance,unified.instance);assert.equal(retainedSeo.draft,'unified SEO unsaved name');assert.equal(retainedSeo.props.active,tab==='SEO');
      assert.equal(h.visible(retainedSeo),tab==='SEO');assert.equal(h.closeResult(),'cancel');
    }
    h.busy('seo-workspace-editor',true);h.render({tab:'가격'});assert.equal(h.closeResult(),'busy');assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),{saved:0,reads:0,uploads:0,submission:0});
  }finally{h.close();}
});
