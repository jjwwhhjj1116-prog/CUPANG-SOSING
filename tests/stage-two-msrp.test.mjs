import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionModule as load} from './helpers/provided-option-quotation.mjs';

const {calculateStageTwoMsrp}=load('app/pricing.ts');
const {stageTwoMsrpEdits,currentStageTwoMsrp,applyStageTwoMsrp,scopedStageTwoMsrp}=load('app/stage-two-msrp.ts');
const {applyQuotationChanges}=load('app/quotation-schema.ts');
const policy={exchangeRate:350,supplyMargin:50,coupangMargin:40,minimumMargin:3000,msrpMultiple:1.3,roundingUnit:10,roundingMode:'up'};
const plain=value=>JSON.parse(JSON.stringify(value));
const priceField=(id,extra={})=>({id,section:'product',label:id,type:'number',required:false,visibility:'common',...extra});
const wire=(id,input,last)=>priceField(id,{numericText:true,hubInput:input,hubWire:{path:['productPage','commonAttributes',last]}});
const fields=[...['supplyPrice','salePrice','msrp'].map(id=>priceField(id)),wire('wire-supply','supplyPrice','purchasePrice'),wire('wire-sale','salePrice','coupangSalePrice'),wire('wire-msrp','msrp','msrp'),wire('independent-osrp','msrp','osrp')];
const msrpFields=['msrp','wire-msrp'];
const view=()=>({resolved:{schema:{fields:structuredClone(fields)},rows:[{optionId:'a',included:true},{optionId:'b',included:true},{optionId:'excluded',included:false},{optionId:null,included:false}]},overrides:{common:{},options:{}}});
const sale=(id,value)=>['salePrice','wire-sale'].map(fieldKey=>({fieldKey,optionId:id,value}));
const saved=(before,result)=>({...before,overrides:applyQuotationChanges(before.overrides,result.changes),stageTwoMsrp:applyStageTwoMsrp(before,result.changes,result.optionIds)});

test('sale-driven MSRP uses exact decimal multiplication and nearest unit even when ordinary rounding is up',()=>{
 assert.equal(calculateStageTwoMsrp(9000,policy),11700);assert.equal(calculateStageTwoMsrp(9001,policy),11700);
 assert.equal(calculateStageTwoMsrp(100,{...policy,msrpMultiple:1.05}),110);
 assert.equal(calculateStageTwoMsrp(30,{...policy,msrpMultiple:1.05,roundingUnit:1}),32);
 assert.equal(calculateStageTwoMsrp(101,{...policy,msrpMultiple:1.01}),100,'nearest rounding is not an unrecorded ceiling or clamp');
 assert.equal(calculateStageTwoMsrp(Number.MAX_SAFE_INTEGER,{...policy,msrpMultiple:1,roundingUnit:1}),Number.MAX_SAFE_INTEGER);
 for(const value of[0,-1,NaN,Infinity,1.1,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>calculateStageTwoMsrp(value,policy));
 assert.throws(()=>calculateStageTwoMsrp(Number.MAX_SAFE_INTEGER,policy),/범위/);
 assert.throws(()=>calculateStageTwoMsrp(9000,{...policy,msrpMultiple:0.99}));
});

test('explicit stage-two sale edits append only linked MSRP changes without mutating inputs or independent OSRP',()=>{
 const before=view(),edits=[...sale('a','9000'),{fieldKey:'independent-osrp',optionId:'a',value:'20000'}],snapshot=JSON.stringify({before,edits,policy});
 const result=stageTwoMsrpEdits(before,edits,policy);assert.deepEqual(plain(result.optionIds),['a']);assert.deepEqual(plain(result.changes),[...edits,...msrpFields.map(fieldKey=>({fieldKey,optionId:'a',value:'11700'}))]);assert.equal(JSON.stringify({before,edits,policy}),snapshot);
 assert.equal(result.changes.filter(change=>change.fieldKey==='independent-osrp').length,1);
});

test('server-recorded derivation remains eligible after reload and repeated sales using the current saved policy',()=>{
 const first=stageTwoMsrpEdits(view(),sale('a','9000'),policy),persisted=JSON.parse(JSON.stringify(saved(view(),first)));
 assert.deepEqual(plain(currentStageTwoMsrp(persisted)),{a:{fields:msrpFields,value:'11700'}});
 const second=stageTwoMsrpEdits(persisted,sale('a','10000'),{...policy,msrpMultiple:1.5});assert.deepEqual(plain(second.optionIds),['a']);assert.equal(second.changes.at(-1).value,'15000');
 const again=saved(persisted,second);assert.equal(again.overrides.options.a['wire-msrp'],'15000');assert.equal(again.stageTwoMsrp.a.value,'15000');assert.equal(persisted.overrides.options.a.msrp,'11700');
});

test('any existing own manual MSRP alias including blank is preserved without a valid derivation marker',()=>{
 for(const field of msrpFields)for(const value of['20000','']){const before=view();before.overrides.options.a={[field]:value};const result=stageTwoMsrpEdits(before,sale('a','9000'),policy);assert.deepEqual(plain(result),{changes:sale('a','9000'),optionIds:[]});assert.equal(before.overrides.options.a[field],value);}
});

test('any common manual MSRP alias or pending common MSRP change suppresses derivation for every option',()=>{
 for(const field of msrpFields)for(const value of['20000','']){const before=view();before.overrides.common[field]=value;assert.equal(stageTwoMsrpEdits(before,[...sale('a','9000'),...sale('b','10000')],policy).optionIds.length,0);}
 for(const value of['20000','',null]){const edits=[...sale('a','9000'),{fieldKey:'wire-msrp',optionId:null,value}];assert.equal(stageTwoMsrpEdits(view(),edits,policy).optionIds.length,0);}
});

test('pending explicit option MSRP including identical amount, blank and restore wins and retires its marker',()=>{
 const before=saved(view(),stageTwoMsrpEdits(view(),sale('a','9000'),policy));
 for(const fieldKey of msrpFields)for(const value of['11700','20000','',null]){const edits=[...sale('a','10000'),{fieldKey,optionId:'a',value}];assert.equal(stageTwoMsrpEdits(before,edits,policy).optionIds.length,0);assert.equal(applyStageTwoMsrp(before,edits),undefined);assert.equal(before.stageTwoMsrp.a.value,'11700');}
 const common=[{fieldKey:'msrp',optionId:null,value:'11700'}];assert.equal(applyStageTwoMsrp(before,common),undefined);assert.equal(before.overrides.options.a.msrp,'11700','clearing authority never deletes or copies an override');
});

test('malformed, mismatched or partial markers never authorize recalculation of manual overrides',()=>{
 const original=saved(view(),stageTwoMsrpEdits(view(),sale('a','9000'),policy));
 const markers=[null,[],{a:null},{a:{fields:['wire-msrp','msrp'],value:'11700'}},{a:{fields:['msrp'],value:'11700'}},{a:{fields:['msrp','msrp'],value:'11700'}},{a:{fields:msrpFields,value:11700}},{a:{fields:msrpFields,value:'11701'}},{a:{fields:msrpFields,value:'11700',extra:true}},{a:{fields:msrpFields,value:'011700'}}];
 for(const stageTwoMsrp of markers){const before={...original,stageTwoMsrp};assert.equal(currentStageTwoMsrp(before),undefined);assert.equal(stageTwoMsrpEdits(before,sale('a','10000'),policy).optionIds.length,0);}
 const partial=structuredClone(original);delete partial.overrides.options.a['wire-msrp'];assert.equal(currentStageTwoMsrp(partial),undefined);assert.equal(stageTwoMsrpEdits(partial,sale('a','10000'),policy).optionIds.length,0);
});

test('sale aliases must be complete, agree, and contain a positive integer amount on an included saved option',()=>{
 const edits=[[sale('a','9000')[0]],[...sale('a','9000'),sale('a','9000')[0]],[sale('a','9000')[0],sale('a','8000')[1]],...['','0','-1','1.5','9007199254740992'].map(value=>sale('a',value)),sale(null,'9000'),sale('excluded','9000'),sale('missing','9000')];
 for(const changes of edits)assert.equal(stageTwoMsrpEdits(view(),changes,policy).optionIds.length,0);
 assert.deepEqual(plain(stageTwoMsrpEdits(view(),[],policy)),{changes:[],optionIds:[]});
 for(const changes of[null,{},[null],[{fieldKey:'msrp',optionId:7,value:'1'}]])assert.throws(()=>stageTwoMsrpEdits(view(),changes,policy));
});

test('sale notation uses the existing bound scalar grammar and preserves original paired text',()=>{
 for(const value of['9000','9000.0','9e3','9E+3','0.9e4','09000']){const result=stageTwoMsrpEdits(view(),sale('a',value),policy);assert.deepEqual(plain(result.optionIds),['a']);assert.equal(result.changes[0].value,value);assert.equal(result.changes.at(-1).value,'11700');}
 for(const value of['+9000','0x2328',' 9000','9000 ','NaN','Infinity','1e999','1e-999','9e-3'])assert.equal(stageTwoMsrpEdits(view(),sale('a',value),policy).optionIds.length,0,value);
 const canonicalOnly=view();canonicalOnly.resolved.schema.fields=canonicalOnly.resolved.schema.fields.filter(field=>!field.hubWire);assert.deepEqual(plain(stageTwoMsrpEdits(canonicalOnly,[{fieldKey:'salePrice',optionId:'a',value:'9000.0'}],policy).optionIds),['a']);assert.equal(stageTwoMsrpEdits(canonicalOnly,[{fieldKey:'salePrice',optionId:'a',value:'9e3'}],policy).optionIds.length,0,'canonical-only input retains its pre-existing decimal grammar');
});

test('ambiguous/missing price bindings reject and OSRP is an MSRP target only when no MSRP wire exists',()=>{
 const duplicate=view();duplicate.resolved.schema.fields.push(wire('duplicate-msrp','msrp','msrp'));assert.throws(()=>stageTwoMsrpEdits(duplicate,sale('a','9000'),policy),/연결/);
 const missing=view();missing.resolved.schema.fields=missing.resolved.schema.fields.filter(field=>field.id!=='msrp');assert.throws(()=>stageTwoMsrpEdits(missing,sale('a','9000'),policy),/연결/);
 const fallback=view();fallback.resolved.schema.fields=fallback.resolved.schema.fields.filter(field=>field.id!=='wire-msrp');assert.deepEqual(plain(stageTwoMsrpEdits(fallback,sale('a','9000'),policy).changes.slice(-2).map(change=>change.fieldKey)),['msrp','independent-osrp']);
});

test('scoped origin metadata stays separate and unrelated edits preserve derived values and authority',()=>{
 const a=saved(view(),stageTwoMsrpEdits(view(),sale('a','9000'),policy)),b=saved(view(),stageTwoMsrpEdits(view(),sale('b','10000'),policy));
 const state={stageTwoMsrp:a.stageTwoMsrp,categoryStageTwoMsrp:{'category:80719':b.stageTwoMsrp}};assert.deepEqual(plain(scopedStageTwoMsrp(state,null)),plain(a.stageTwoMsrp));assert.deepEqual(plain(scopedStageTwoMsrp(state,'80719')),plain(b.stageTwoMsrp));assert.equal(scopedStageTwoMsrp(state,'81452'),undefined);
 const before=JSON.stringify(a),unchanged=applyStageTwoMsrp(a,[{fieldKey:'title',optionId:'a',value:'수동 제목'}]);assert.deepEqual(plain(unchanged),plain(a.stageTwoMsrp));assert.equal(JSON.stringify(a),before);
});

test('prototype-named option cannot borrow another option marker to rewrite its explicit manual MSRP',()=>{
 const before=saved(view(),stageTwoMsrpEdits(view(),sale('a','9000'),policy));before.resolved.rows.push({optionId:'constructor',included:true});Object.defineProperty(before.overrides.options,'constructor',{value:{msrp:'99999'},enumerable:true});
 assert.equal(stageTwoMsrpEdits(before,sale('constructor','9000'),policy).optionIds.length,0);
});
