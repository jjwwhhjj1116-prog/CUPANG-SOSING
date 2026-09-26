import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
const native=createRequire(import.meta.url);
function load(file,overrides={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,URL,fetch,AbortController,require(name){if(name in overrides)return overrides[name];if(name.startsWith('@/'))return load(name.slice(2)+'.ts');return native(name);}});return exports;}
const model=load('app/components/product-option-board.tsx');
const data={options:{schemaVersion:1,productId:'p1',revision:1,rows:[{id:'red',originalName:'Red',translatedName:'빨강',supplierSku:'sku-red',unitCostCny:4.5,unitsPerPack:2,stock:0,included:true,imageKey:'owner/red.png',provenance:{}},{id:'blue',originalName:'Blue',translatedName:'',supplierSku:'sku-blue',unitCostCny:null,unitsPerPack:1,stock:null,included:false,imageKey:'other/private.png',provenance:{translatedName:'manual'}}]},pricing:{rows:[{optionId:'red',calculation:{supplyPrice:4000,salePrice:6000},error:null}]}};
test('option board fetch checks product identity and propagates abort signal',async()=>{
 const signal=new AbortController().signal;const requests=[];
 const received=await model.readOptionBoard('p1',signal,async(url,init)=>{requests.push({url,...init});return {ok:true,json:async()=>url.endsWith('/options')?data:{content:{productId:'p1',schemaVersion:1,assets:{main:{value:['owner/shared.png']}}}}};});assert.equal(received.options,data.options);assert.deepEqual(Array.from(received.commonImageKeys),['owner/shared.png']);const request=requests[0];assert.equal(requests[1].signal,signal);assert.equal(requests[1].url,'/api/products/p1/content');
 assert.equal(request.url,'/api/products/p1/options');assert.equal(request.signal,signal);assert.equal(request.cache,'no-store');
 for(const bad of [null,{}, {...data,options:{...data.options,productId:'p2'}}])await assert.rejects(model.readOptionBoard('p1',signal,async()=>({ok:true,json:async()=>bad})),/응답/);
 await assert.rejects(model.readOptionBoard('p1',signal,async()=>({ok:false,json:async()=>({error:'인증 필요'})})),/인증 필요/);
});
function tree(query='',sourceUrl='https://detail.1688.com/offer/813724060928.html',boardData=data,owned=['owner/red.png']){
 let slot=0;const selected=[];const edited=[];const images=[];const contentSteps=[];const states=[boardData,'',0,query];
 const hooks={useState(initial){const i=slot++;return[i<states.length?states[i]:initial,()=>{}];},useEffect(){}};
 const {ProductOptionBoard}=load('app/components/product-option-board.tsx',{react:hooks});
 return {selected,edited,images,contentSteps,tree:ProductOptionBoard({productId:'p1',sourceUrl,imageKeys:JSON.stringify(owned),onQuotation:id=>selected.push(id),onContent:step=>contentSteps.push(step),onImage:id=>images.push(id),onEdit:id=>edited.push(id)})};
}
function nodes(value){if(!value||typeof value!=='object')return[];if(Array.isArray(value))return value.flatMap(nodes);return[value,...nodes(value.props?.children)];}
test('option list opens the clicked option and preserves zero, unknown and deliberately blank names',()=>{
 const result=tree();const html=renderToStaticMarkup(result.tree);
 assert.match(html,/재고 0개/);assert.match(html,/재고 미확인/);assert.match(html,/옵션명 공란/);assert.match(html,/4,000원/);assert.match(html,/6,000원/);
 assert.match(html,/813724060928/);assert.ok(!html.includes('/api/files/other/private.png'));
 const buttons=nodes(result.tree).filter(n=>n.type==='button'&&n.props.children==='견적서 열기');buttons[1].props.onClick();assert.deepEqual(result.selected,['blue']);
 const filtered=tree('sku-red');assert.equal(nodes(filtered.tree).filter(n=>n.type==='button'&&n.props.children==='견적서 열기').length,1);
 const unsafe=renderToStaticMarkup(tree('','javascript:alert(1)').tree);assert.ok(!unsafe.includes('href="javascript:'));
});

test('price buttons retain the chosen option ID and general editing does not pass a click event',()=>{
 const result=tree();const buttons=nodes(result.tree).filter(n=>n.type==='button');
 buttons.filter(n=>n.props.children==='가격 편집')[1].props.onClick();
 buttons.find(n=>n.props.children==='옵션·번들·가격 수정').props.onClick({type:'click'});
 assert.deepEqual(result.edited,['blue',undefined]);
});

test('image editing passes the clicked option identity even when it has no individual image',()=>{
 const result=tree();const buttons=nodes(result.tree).filter(n=>n.type==='button'&&n.props.children==='이미지 편집');
 assert.equal(buttons.length,2);buttons[1].props.onClick();assert.deepEqual(result.images,['blue']);assert.deepEqual(result.edited,[]);assert.deepEqual(result.selected,[]);
});

test('option list uses the common main image only for null individual selection',()=>{
 const shared={...data,commonImageKeys:['owner/shared.png'],options:{...data.options,rows:data.options.rows.map(row=>({...row,imageKey:null}))}};
 const html=renderToStaticMarkup(tree('',undefined,shared,['owner/shared.png']).tree);assert.match(html,/공통 대표 이미지/);assert.match(html,/src="\/api\/files\/owner\/shared.png"/);
 shared.options.rows[0].imageKey='missing.png';const html2=renderToStaticMarkup(tree('sku-red',undefined,shared,['owner/shared.png']).tree);assert.match(html2,/이미지 연결 확인 필요/);assert.ok(!html2.includes('src='));
 assert.ok(!renderToStaticMarkup(tree('',undefined,shared,[]).tree).includes('src='));
});
test('common content fetch rejects mismatched product or failed response',async()=>{
 const signal=new AbortController().signal;
 for(const content of [null,{productId:'other',schemaVersion:1,assets:{main:{value:[]}}},{productId:'p1',schemaVersion:1,assets:{main:{value:[1]}}}]){
  await assert.rejects(model.readOptionBoard('p1',signal,async url=>({ok:true,json:async()=>url.endsWith('/options')?data:{content}})),/이미지 응답/);
 }
 await assert.rejects(model.readOptionBoard('p1',signal,async url=>({ok:url.endsWith('/options'),json:async()=>url.endsWith('/options')?data:{error:'조회 실패'}})),/조회 실패/);
});

test('shared content columns count only saved product images and open their matching stages',()=>{
 const shared={...data,commonAssets:{additional:['owner/a.png','other/x.png'],detail:['owner/top.png','owner/detail.png','owner/bottom.png'],label:[]}};
 const result=tree('sku-red',undefined,shared,['owner/a.png','owner/top.png','owner/detail.png','owner/bottom.png']);const html=renderToStaticMarkup(result.tree);
 assert.match(html,/1장.*연결 확인 필요/);assert.match(html,/3장/);assert.match(html,/0장/);
 for(const text of ['추가 이미지 편집','상세 이미지 편집','표시사항 편집'])nodes(result.tree).find(n=>n.type==='button'&&[n.props.children].flat().join('')===text).props.onClick();
 assert.deepEqual(result.contentSteps,['추가 이미지','상세 이미지','표시사항']);assert.deepEqual(result.images,[]);
});

 test('shared image roles preserve detail ordering and reject malformed references',async()=>{
 const signal=new AbortController().signal;
 const content={productId:'p1',schemaVersion:1,assets:{main:{value:[]},additional:{value:['a']},detailTop:{value:['top']},detail:{value:['body']},detailBottom:{value:['bottom']},label:{value:['label']}}};
 const fetcher=async url=>({ok:true,json:async()=>url.endsWith('/options')?data:{content}});
 const result=await model.readOptionBoard('p1',signal,fetcher);
 assert.deepEqual(Array.from(result.commonAssets.detail),['top','body','bottom']);
 assert.deepEqual(Array.from(result.commonAssets.additional),['a']);
 assert.deepEqual(Array.from(result.commonAssets.label),['label']);
 content.assets.label.value=[42];
 await assert.rejects(model.readOptionBoard('p1',signal,fetcher),/이미지 응답/);
 });
