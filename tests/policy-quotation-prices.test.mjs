import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionModule as load} from './helpers/provided-option-quotation.mjs';

const {preparePolicyQuotationPrices}=load('app/policy-quotation-prices.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
const policy={exchangeRate:350,supplyMargin:50,coupangMargin:40,minimumMargin:3000,msrpMultiple:1.5,roundingUnit:10,roundingMode:'up'};
const canonical=['supplyPrice','salePrice','msrp'],paths={supplyPrice:'purchasePrice',salePrice:'coupangSalePrice',msrp:'msrp'};
const fields=[...canonical.map(id=>({id,section:'product',label:id,type:'number',required:false,visibility:'common'})),...canonical.map(input=>({id:'wire-'+input,section:'product',label:input,type:'number',required:false,visibility:'common',numericText:true,hubInput:input,hubWire:{path:['productPage','commonAttributes',paths[input]]}})),{id:'osrp',section:'product',type:'number',numericText:true,hubInput:'msrp',hubWire:{path:['productPage','commonAttributes','osrp']}}];
const marker=value=>({fields:['msrp','wire-msrp'],value});
function fixture(categoryId=null){
 const overrides={common:{brand:'공통 브랜드',supplyPrice:'6000','wire-supplyPrice':'6000'},options:{a:{salePrice:'9000','wire-salePrice':'9000',msrp:'11700','wire-msrp':'11700',title:'직접 제목',osrp:'23000'},b:{msrp:'20000','wire-msrp':'20000',salePrice:'10000','wire-salePrice':'10000'},excluded:{supplyPrice:'8000','wire-supplyPrice':'8000',msrp:'10400','wire-msrp':'10400'},old:{supplyPrice:'99999',salePrice:'99999',msrp:'99999'}}};
 const markers={a:marker('11700'),excluded:marker('10400'),old:marker('99999')};
 const state={schemaVersion:1,productId:'local-698',revision:7,overrides:categoryId?{common:{title:'분류 이전 공통 제목'},options:{legacy:{salePrice:'1'}}}:structuredClone(overrides),updatedAt:'2026-10-18T00:00:00.000Z',detailSaveBackups:{'category:81452':[{local:'untouched'}]},detailEditorInputs:{'category:81452':{local:'untouched'}},packagingBasis:{version:1,common:{},options:{}},categoryOverrides:{'category:81452':{common:{brand:'다른 분류'},options:{a:{salePrice:'777'}}}},categoryStageTwoMsrp:{'category:81452':{a:marker('888')}}};
 if(categoryId){state.categoryOverrides['category:'+categoryId]=structuredClone(overrides);state.categoryStageTwoMsrp['category:'+categoryId]=structuredClone(markers);}else state.stageTwoMsrp=structuredClone(markers);
 const row=(id,included,sale)=>({optionId:id,included,fields:{salePrice:{value:sale,source:'manual-option'},'wire-salePrice':{value:sale,source:'manual-option'}}});
 const view={revision:7,categoryContext:{categoryId},resolved:{schema:{fields:structuredClone(fields)},rows:[row(null,false,'0'),row('a',true,'9000'),row('b',true,'10000'),row('excluded',false,'8000')]},overrides:structuredClone(overrides)};
 return{state,view,scope:categoryId?'category:'+categoryId:null};
}
const selected=f=>f.scope?f.state.categoryOverrides[f.scope]:f.state.overrides;
const markers=(state,scope)=>scope?state.categoryStageTwoMsrp?.[scope]:state.stageTwoMsrp;

test('ordinary policy save updates only included verified sale-derived MSRP and retains all independent manual values',()=>{
 const f=fixture(),before=JSON.stringify(f),result=preparePolicyQuotationPrices(f.view,f.state,policy,false);assert.equal(result.changed,true);
 assert.equal(result.state.overrides.options.a.msrp,'13500');assert.equal(result.state.overrides.options.a['wire-msrp'],'13500');assert.equal(result.state.stageTwoMsrp.a.value,'13500');
 assert.equal(result.state.overrides.options.a.salePrice,'9000');assert.equal(result.state.overrides.options.a.osrp,'23000');assert.equal(result.state.overrides.options.a.title,'직접 제목');assert.deepEqual(plain(result.state.overrides.options.b),f.state.overrides.options.b);assert.deepEqual(plain(result.state.overrides.options.excluded),f.state.overrides.options.excluded);assert.deepEqual(plain(result.state.stageTwoMsrp.excluded),f.state.stageTwoMsrp.excluded);assert.deepEqual(plain(result.state.stageTwoMsrp.old),f.state.stageTwoMsrp.old);assert.equal(result.state.revision,7);assert.equal(result.state.updatedAt,f.state.updatedAt);assert.equal(JSON.stringify(f),before);
});

test('ordinary current effective sale uses the new saved policy and nearest unit without rewriting its notation',()=>{
 const f=fixture();f.view.resolved.rows[1].fields['wire-salePrice'].value='9000.0';const next=preparePolicyQuotationPrices(f.view,f.state,{...policy,msrpMultiple:1.333},false);assert.equal(next.state.overrides.options.a.msrp,'12000');assert.equal(next.state.overrides.options.a.salePrice,'9000');
 f.view.resolved.rows[1].fields['wire-salePrice'].value='10000';assert.equal(preparePolicyQuotationPrices(f.view,f.state,policy,false).state.overrides.options.a.msrp,'15000','effective resolved sale is authoritative, not an older source calculation');
});

test('ordinary policy save preserves real manual MSRP, blanks and any common MSRP priority',()=>{
 for(const value of['20000',''])for(const key of['msrp','wire-msrp']){const f=fixture();selected(f).common[key]=value;f.view.overrides.common[key]=value;const result=preparePolicyQuotationPrices(f.view,f.state,policy,false);assert.equal(result.changed,false);assert.deepEqual(plain(result.state),f.state);}
 const f=fixture();delete f.state.stageTwoMsrp;assert.equal(preparePolicyQuotationPrices(f.view,f.state,policy,false).changed,false);
});

test('malformed or stale origin records cannot turn historical manual prices into automatic ones',()=>{
 for(const marker of[{fields:['msrp'],value:'11700'},{fields:['wire-msrp','msrp'],value:'11700'},{fields:['msrp','wire-msrp'],value:'99999'},{fields:['msrp','wire-msrp'],value:11700}]){const f=fixture();f.state.stageTwoMsrp={a:marker};const result=preparePolicyQuotationPrices(f.view,f.state,policy,false);assert.equal(result.changed,false);assert.deepEqual(plain(result.state),f.state);}
});

test('invalid or empty effective sale is preserved rather than guessed during an ordinary policy save',()=>{
 for(const value of['','0','1.5','+9000','0x2328','NaN','Infinity']){const f=fixture();f.view.resolved.rows[1].fields['wire-salePrice'].value=value;assert.equal(preparePolicyQuotationPrices(f.view,f.state,policy,false).changed,false);}
});

test('explicit recalculation resets only exact common and current-option linked prices, including excluded rows',()=>{
 const f=fixture(),before=JSON.stringify(f),result=preparePolicyQuotationPrices(f.view,f.state,policy,true);assert.equal(result.changed,true);
 assert.deepEqual(plain(result.state.overrides.common),{brand:'공통 브랜드'});assert.deepEqual(plain(result.state.overrides.options.a),{title:'직접 제목',osrp:'23000'});assert.equal(result.state.overrides.options.b,undefined);assert.equal(result.state.overrides.options.excluded,undefined);assert.deepEqual(plain(result.state.overrides.options.old),f.state.overrides.options.old);assert.equal(result.state.stageTwoMsrp,undefined);assert.deepEqual(plain(result.state.categoryOverrides),f.state.categoryOverrides);assert.deepEqual(plain(result.state.categoryStageTwoMsrp),f.state.categoryStageTwoMsrp);assert.equal(JSON.stringify(f),before);
});

test('current-category updates preserve legacy prices, other categories and all detail/packaging metadata',()=>{
 for(const recalculate of[false,true]){const f=fixture('80719'),result=preparePolicyQuotationPrices(f.view,f.state,policy,recalculate);assert.equal(result.changed,true);assert.deepEqual(plain(result.state.overrides),f.state.overrides);assert.deepEqual(plain(result.state.categoryOverrides['category:81452']),f.state.categoryOverrides['category:81452']);assert.deepEqual(plain(result.state.categoryStageTwoMsrp['category:81452']),f.state.categoryStageTwoMsrp['category:81452']);for(const key of['detailSaveBackups','detailEditorInputs','packagingBasis'])assert.deepEqual(plain(result.state[key]),f.state[key]);assert.equal(markers(result.state,f.scope)?.a?.value,recalculate?undefined:'13500');}
});

test('recalculation does not create empty quote scopes or retire unrelated origin records when nothing changes',()=>{
 const f=fixture('80719');f.view.overrides={common:{brand:'공통'},options:{old:{salePrice:'1'}}};f.state.categoryOverrides[f.scope]=structuredClone(f.view.overrides);delete f.state.categoryStageTwoMsrp[f.scope];const before=JSON.stringify(f.state),result=preparePolicyQuotationPrices(f.view,f.state,policy,true);assert.equal(result.changed,false);assert.equal(JSON.stringify(result.state),before);
});

test('unchanged derived amount is a no-op and current quote clocks/values must agree',()=>{
 const f=fixture();assert.equal(preparePolicyQuotationPrices(f.view,f.state,{...policy,msrpMultiple:1.3},false).changed,false);
 assert.throws(()=>preparePolicyQuotationPrices({...f.view,revision:8},f.state,policy,false),/저장 기준/);
 const forged=structuredClone(f.state);forged.overrides.options.a.salePrice='10000';assert.throws(()=>preparePolicyQuotationPrices(f.view,forged,policy,false),/저장 기준/);
});

test('invalid/overflowing policies and oversized quotation payloads fail before any write',()=>{
 const f=fixture(),before=JSON.stringify(f);assert.throws(()=>preparePolicyQuotationPrices(f.view,f.state,{...policy,msrpMultiple:Infinity},false));assert.throws(()=>preparePolicyQuotationPrices(f.view,f.state,{...policy,msrpMultiple:Number.MAX_VALUE},false),/범위/);
 const huge=structuredClone(f.state);huge.detailSaveBackups={local:['x'.repeat(524288)]};assert.throws(()=>preparePolicyQuotationPrices(f.view,huge,policy,true),/한도/);assert.equal(JSON.stringify(f),before);
});

test('MSRP/OSRP ambiguity fails shut while confirmed OSRP-only binding follows the existing target contract',()=>{
 const f=fixture();f.view.resolved.schema.fields.push({...f.view.resolved.schema.fields.find(field=>field.id==='wire-msrp'),id:'duplicate'});assert.throws(()=>preparePolicyQuotationPrices(f.view,f.state,policy,true),/연결/);
 const fallback=fixture();fallback.view.resolved.schema.fields=fallback.view.resolved.schema.fields.filter(field=>field.id!=='wire-msrp');const result=preparePolicyQuotationPrices(fallback.view,fallback.state,policy,true);assert.equal(result.state.overrides.options.a.osrp,undefined);assert.equal(result.state.overrides.options.a['wire-msrp'],'11700','an unbound former field is not guessed or erased');
});
