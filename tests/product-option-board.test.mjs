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
 const signal=new AbortController().signal;let request;
 assert.equal(await model.readOptionBoard('p1',signal,async(url,init)=>{request={url,...init};return {ok:true,json:async()=>data};}),data);
 assert.equal(request.url,'/api/products/p1/options');assert.equal(request.signal,signal);assert.equal(request.cache,'no-store');
 for(const bad of [null,{}, {...data,options:{...data.options,productId:'p2'}}])await assert.rejects(model.readOptionBoard('p1',signal,async()=>({ok:true,json:async()=>bad})),/응답/);
 await assert.rejects(model.readOptionBoard('p1',signal,async()=>({ok:false,json:async()=>({error:'인증 필요'})})),/인증 필요/);
});
function tree(query='',sourceUrl='https://detail.1688.com/offer/813724060928.html'){
 let slot=0;const selected=[];const edited=[];const images=[];const states=[data,'',0,query];
 const hooks={useState(initial){const i=slot++;return[i<states.length?states[i]:initial,()=>{}];},useEffect(){}};
 const {ProductOptionBoard}=load('app/components/product-option-board.tsx',{react:hooks});
 return {selected,edited,images,tree:ProductOptionBoard({productId:'p1',sourceUrl,imageKeys:JSON.stringify(['owner/red.png']),onQuotation:id=>selected.push(id),onImage:id=>images.push(id),onEdit:id=>edited.push(id)})};
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
