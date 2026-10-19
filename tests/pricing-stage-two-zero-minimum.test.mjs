import test from 'node:test';
import assert from 'node:assert/strict';
import {load,mode,observed,plain,zeroMinimumUI,text,componentUI,nodes} from './helpers/pricing-stage-two-zero-minimum.mjs';

const {pricePolicy,calculatePrice,priceMinimumMarginEnabled}=load('app/pricing.ts');
const tools=load('app/option-editor-tools.ts'),model=load('app/product-options.ts');
const zero={...observed,minimumMargin:0,recalculationMode:mode};
const prices=value=>[value.supplyPrice,value.salePrice,value.msrp];

test('explicit enabled zero uses stage-two cost plus zero while absent/disabled zero keep the ratio',()=>{
 assert.deepEqual(prices(calculatePrice(25.6,{...zero,recalculationMinimumEnabled:true})),[8960,14930,19410]);
 assert.equal(calculatePrice(25.6,{...zero,recalculationMinimumEnabled:true}).marginKrw,0);
 for(const policy of[zero,{...zero,recalculationMinimumEnabled:false}])assert.deepEqual(prices(calculatePrice(25.6,policy)),[17920,29870,38830]);
 assert.equal(priceMinimumMarginEnabled(zero),false);assert.equal(priceMinimumMarginEnabled({...zero,recalculationMinimumEnabled:true}),true);
 assert.equal(priceMinimumMarginEnabled(observed),true);
});

test('the optional switch round trips exactly and cannot silently alter initial draft calculations',()=>{
 const legacy=JSON.stringify(pricePolicy(zero));assert.equal(JSON.stringify(pricePolicy({...zero,recalculationMinimumEnabled:undefined})),legacy);
 assert.equal(Object.hasOwn(pricePolicy(zero),'recalculationMinimumEnabled'),false);
 for(const enabled of[true,false]){const normalized=pricePolicy({...zero,recalculationMinimumEnabled:enabled});assert.equal(normalized.recalculationMinimumEnabled,enabled);assert.deepEqual(plain(pricePolicy(JSON.parse(JSON.stringify(normalized)))),plain(normalized));}
 const initial={...observed,minimumMargin:0};assert.deepEqual(prices(calculatePrice(25.6,{...initial,recalculationMinimumEnabled:true})),prices(calculatePrice(25.6,initial)));
 assert.equal(pricePolicy({...initial,recalculationMinimumEnabled:true}).recalculationMode,undefined);
});

test('invalid switches and contradictory disabled positive minimum reject rather than choosing a branch',()=>{
 for(const value of[null,0,1,'true','false',{},[]])assert.throws(()=>pricePolicy({...zero,recalculationMinimumEnabled:value}),/선택 상태/);
 assert.throws(()=>pricePolicy({...observed,recalculationMinimumEnabled:false}),/0원/);
 for(const minimumMargin of[-1,NaN,Infinity])assert.throws(()=>pricePolicy({...zero,minimumMargin,recalculationMinimumEnabled:true}));
});

test('zero-enabled packs and integrated costs retain exact decimal and rounding safeguards',()=>{
 const policy={...zero,recalculationMinimumEnabled:true};assert.deepEqual(prices(calculatePrice(25.6,policy,3)),[26880,44800,58240]);
 const decimal=calculatePrice(5.23,policy);assert.equal(decimal.costKrw,1830.5);assert.equal(decimal.supplyPrice,1830);assert.equal(decimal.marginKrw,-0.5);
 const integrated=calculatePrice(10,{...policy,useIntegratedRate:true,integratedRate:275});assert.equal(integrated.costKrw,3355);assert.equal(integrated.supplyPrice,3360);assert.equal(integrated.marginKrw,5);
 assert.throws(()=>calculatePrice(0.001,policy),/0원/);assert.throws(()=>calculatePrice(25.6,policy,0));
});

test('bulk preview identity keeps legacy bytes but rejects ON/OFF changes with the same zero amount',()=>{
 const legacy=JSON.stringify([350,50,40,0,1.3,10,'nearest',false,null,mode]);assert.equal(tools.optionBulkPriceBase(zero),legacy);
 const on={...zero,recalculationMinimumEnabled:true},off={...zero,recalculationMinimumEnabled:false};assert.notEqual(tools.optionBulkPriceBase(on),tools.optionBulkPriceBase(off));
 const rows=[{...model.emptyOptionInput('local'),originalName:'原文',supplierSku:'SKU695',unitCostCny:25.6,unitsPerPack:1,included:true}],before=JSON.stringify(rows);
 const preview=tools.previewOptionBulk(rows,['local'],{type:'unitsPerPack',value:3},on);assert.equal(preview.changes[0].afterPrice,26880);
 assert.throws(()=>tools.applyOptionBulk(rows,preview,off),/가격 정책/);assert.throws(()=>tools.applyOptionBulk(rows,preview,zero),/가격 정책/);
 assert.equal(tools.applyOptionBulk(rows,preview,on)[0].unitsPerPack,3);assert.equal(JSON.stringify(rows),before);
});

test('real editor retains ON and stages cost plus zero directly when the amount changes',async()=>{
 const saved=[],ui=zeroMinimumUI({onSave:async value=>saved.push(plain(value))});ui.field('최소 공급 마진 (원)').props.onChange({target:{value:'0'}});
 assert.equal(ui.field('최소 공급 마진 보장').props.checked,true);assert.equal(ui.policy().recalculationMinimumEnabled,true);assert.equal(ui.policy().recalculationMode,mode);
 assert.match(text(ui.render()),/8,960원/);ui.button('일괄 재계산').props.onClick();assert.match(text(ui.render()),/8,960원/);assert.match(text(ui.render()),/판매 묶음 원가에 최소 공급 마진액/);assert.equal(ui.writes,0);
 await ui.submit();assert.equal(saved[0].minimumMargin,0);assert.equal(saved[0].recalculationMinimumEnabled,true);assert.equal(saved[0].recalculationMode,mode);assert.equal(ui.render().props['data-workspace-dirty'],false);
});

test('real editor restores cached zero through OFF/ON and retains zero on reopen',async()=>{
 const initial={...zero,recalculationMinimumEnabled:true},ui=zeroMinimumUI({initial});assert.equal(ui.field('최소 공급 마진 보장').props.checked,true);
 for(let i=0;i<2;i++){ui.field('최소 공급 마진 보장').props.onChange({target:{checked:false}});assert.equal(ui.policy().recalculationMinimumEnabled,false);assert.equal(ui.field('최소 공급 마진 (원)'),undefined);assert.equal(ui.policy().minimumMargin,0);assert.match(text(ui.render()),/17,920원/);ui.field('최소 공급 마진 보장').props.onChange({target:{checked:true}});assert.equal(ui.policy().recalculationMinimumEnabled,true);assert.equal(ui.field('최소 공급 마진 (원)').props.value,0);assert.match(text(ui.render()),/8,960원/);}
 assert.equal(ui.render().props['data-workspace-dirty'],true,'explicit controls stage recalculation even when the amount returns to zero');assert.equal(ui.writes,0);await ui.submit();assert.equal(ui.render().props['data-workspace-dirty'],false);const reopened=zeroMinimumUI({initial:plain(ui.policy())});assert.equal(reopened.field('최소 공급 마진 보장').props.checked,true);assert.equal(reopened.policy().minimumMargin,0);
});

test('switch-only external updates and dirty drafts use the actual samePolicy comparison',()=>{
 const on={...zero,recalculationMinimumEnabled:true},off={...zero,recalculationMinimumEnabled:false},clean=zeroMinimumUI({initial:off});clean.update({initial:on});assert.equal(clean.field('최소 공급 마진 보장').props.checked,true);assert.equal(clean.render().props['data-workspace-dirty'],false);
 clean.field('최소 공급 마진 보장').props.onChange({target:{checked:false}});assert.equal(clean.render().props['data-workspace-dirty'],true);clean.update({initial:{...on,exchangeRate:400}});assert.equal(clean.policy().exchangeRate,350);assert.equal(clean.policy().recalculationMinimumEnabled,false);assert.match(text(clean.render()),/수정 중인 입력/);
 clean.button('수정 취소·최신 가격 정책 불러오기').props.onClick();assert.equal(clean.policy().exchangeRate,400);assert.equal(clean.policy().recalculationMinimumEnabled,true);assert.equal(clean.render().props['data-workspace-dirty'],false);
});

test('zero-enabled save locks duplicate callbacks and preserves a failed reviewed draft',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;}),ui=zeroMinimumUI({initial:{...zero,recalculationMinimumEnabled:true},onSave:()=>pending});ui.field('환율 (원/CNY)').props.onChange({target:{value:'400'}});
 const submit=ui.render().props.onSubmit,first=submit({preventDefault(){}});await submit({preventDefault(){}});assert.equal(ui.writes,1);assert.equal(ui.render().props['data-workspace-saving'],true);release();await first;assert.equal(ui.render().props['data-workspace-dirty'],false);
 const failure=zeroMinimumUI({onSave:async()=>{throw Error('local conflict');}});failure.field('최소 공급 마진 (원)').props.onChange({target:{value:'0'}});failure.button('일괄 재계산').props.onClick();await failure.submit();assert.equal(failure.policy().recalculationMinimumEnabled,true);assert.equal(failure.policy().minimumMargin,0);assert.equal(failure.render().props['data-workspace-dirty'],true);assert.match(text(failure.render()),/local conflict/);
});

test('workspace settings hide disabled minimum fields and retain the amount for re-enable and cancellation',()=>{
 const initial=plain(load('app/workspace-settings.ts').defaultSettings);initial.minimumMarginEnabled=true;initial.minimumMargin=4500;const before=JSON.stringify(initial);let closed=0,saves=0;
 const ui=componentUI('app/components/workspace-settings-editor.tsx','WorkspaceSettingsEditor',{props:{value:initial,onSave:async()=>{saves++;},onClose:()=>{closed++;}}});
 const field=label=>nodes(ui.render()).find(node=>node.type==='label'&&nodes(node.props.children).some(child=>child.type==='span'&&child.props.children===label))?.props.children[1];
 assert.equal(field('최소 공급 마진액 (원)').props.value,'4500');field('최소 공급 마진 보장').props.onChange({target:{checked:false}});assert.equal(field('최소 공급 마진액 (원)'),undefined);assert.doesNotMatch(text(nodes(ui.render()).find(node=>node.props?.className==='settings-minimum-margin')),/비율로 계산한 공급가/);
 field('최소 공급 마진 보장').props.onChange({target:{checked:true}});assert.equal(field('최소 공급 마진액 (원)').props.value,'4500');nodes(ui.render()).find(node=>node.type==='button'&&node.props.children==='취소').props.onClick();assert.equal(closed,1);assert.equal(saves,0);assert.equal(JSON.stringify(initial),before);
});

test('workspace settings save explicit enabled zero and disabled retained amount through real validation',async()=>{
 const value={...load('app/workspace-settings.ts').defaultSettings,minimumMarginEnabled:true,minimumMargin:3000},saved=[];
 const ui=componentUI('app/components/workspace-settings-editor.tsx','WorkspaceSettingsEditor',{props:{value,onSave:async value=>saved.push(plain(value)),onClose(){}}});
 const field=label=>nodes(ui.render()).find(node=>node.type==='label'&&nodes(node.props.children).some(child=>child.type==='span'&&child.props.children===label))?.props.children[1];
 field('최소 공급 마진액 (원)').props.onChange({target:{value:'0'}});await ui.render().props.onSubmit({preventDefault(){}});assert.equal(saved[0].minimumMarginEnabled,true);assert.equal(saved[0].minimumMargin,0);
 field('최소 공급 마진액 (원)').props.onChange({target:{value:'4500'}});field('최소 공급 마진 보장').props.onChange({target:{checked:false}});await ui.render().props.onSubmit({preventDefault(){}});assert.equal(saved[1].minimumMarginEnabled,false);assert.equal(saved[1].minimumMargin,4500);assert.equal(field('최소 공급 마진액 (원)'),undefined);assert.equal(value.minimumMargin,3000);
});
