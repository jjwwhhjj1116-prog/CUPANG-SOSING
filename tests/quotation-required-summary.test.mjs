import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';

const requireNative=createRequire(import.meta.url),cache=new Map();
function load(file,replacements={}){
 const cached=!Object.keys(replacements).length;
 if(cached&&cache.has(file))return cache.get(file);
 const exports={};
 const source=ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(source,{exports,Error,TextEncoder,URLSearchParams,structuredClone,AbortController,fetch:replacements.fetch,document:replacements.document,window:replacements.window,require(name){
  if(Object.hasOwn(replacements,name))return replacements[name];
  if(name.endsWith('.css'))return{};
  if(name.startsWith('@/app/')){const path=name.slice(2);return load(path+(fs.existsSync(new URL('../'+path+'.ts',import.meta.url))?'.ts':'.tsx'));}
  if(name==='react'||name==='react/jsx-runtime')return requireNative(name);
  throw Error('Unexpected dependency '+name);
 }});
 if(cached)cache.set(file,exports);return exports;
}
const editor=load('app/components/quotation-fields-editor.tsx');
const requiredBlank='필수 값이 비어 있습니다.';
const field=(id,extra={})=>({id,label:id,section:'logistics',type:'text',required:true,visibility:'common',...extra});
const weight=field('packagedWeightG',{type:'number',unit:'g',integer:true,min:1,max:1e9});
const wire=field('live_weight',{unit:'g',numericText:true,hubInput:'packagedWeightG',integer:true,min:1,max:1e9,hubWire:{path:['logisticsPage','skuUnitBoxWeight']}});
const dimensions=field('packagedDimensionsMm',{unit:'mm'});
const cell=(value='',source='empty',validationIssues=[requiredBlank])=>({value,source,validationIssues,issues:[...validationIssues],needsReview:false,reviewMessages:[]});
const clone=value=>JSON.parse(JSON.stringify(value));
function view(fields,rows){
 const schema={version:1,categoryId:'summary',categoryPath:['summary'],status:'observed',evidence:'test',fields,submissionReady:false};
 const resolved={schema,rows,issues:[],validationIssues:[],reviewMessages:[]};
 return{revision:1,inputFingerprint:'test',overrides:{common:{},options:{}},resolved,automatic:clone(resolved),imageKeys:[],submissionReady:false,categoryContext:{source:'collection',profileId:null,categoryId:'summary',categoryPath:['summary']},productVersion:'v1',contentRevision:1,optionRevision:1,updatedAt:null};
}
const row=(id,fields,included=true)=>({optionId:id,optionLabel:id??'common',included,fields});
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

test('required empty N/A is complete in missing summaries while unselected and text blanks remain missing',()=>{
 const lens=field('lens',{section:'product',type:'select',choices:[{value:'',label:'해당사항없음'},{value:'UV',label:'UV'}]});
 const brand=field('brand',{section:'product'});
 const source=freeze(view([lens,brand],[row('selected',{lens:cell('','manual-option',[]),brand:cell()}),row('unselected',{lens:cell(),brand:cell()}),row('excluded',{lens:cell(),brand:cell()},false)])),before=JSON.stringify(source);
 const overview=editor.quotationOptionOverview(source,[]);
 assert.equal(overview[0].missing,1,'an explicitly selected empty enum is not missing');
 assert.equal(overview[1].missing,2);assert.equal(overview.length,2);
 const progress=editor.quotationSectionProgress(source,[],'selected').find(section=>section.id==='product');
 assert.equal(progress.required,2);assert.equal(progress.complete,1);assert.equal(progress.invalid,1);
 assert.equal(JSON.stringify(source),before);
});

test('six SKU missing summaries count the exact required weight pair once and preserve every validation problem',()=>{
 const source=freeze(view([weight,wire,dimensions],[row(null,{packagedWeightG:cell(),live_weight:cell(),packagedDimensionsMm:cell()},false),...Array.from({length:6},(_,index)=>row('sku-'+index,{packagedWeightG:cell(),live_weight:cell(),packagedDimensionsMm:cell()})),row('excluded',{packagedWeightG:cell(),live_weight:cell(),packagedDimensionsMm:cell()},false)])),before=JSON.stringify(source);
 const overview=editor.quotationOptionOverview(source,[]);
 assert.equal(overview.length,6);assert.equal(overview.reduce((total,row)=>total+row.missing,0),12);
 for(const item of overview){assert.equal(item.problems.length,3);assert.deepEqual(Array.from(item.problems,problem=>problem.fieldKey),['packagedWeightG','live_weight','packagedDimensionsMm']);}
 const progress=editor.quotationSectionProgress(source,[],'sku-0').find(section=>section.id==='logistics');
 assert.equal(progress.required,3);assert.equal(progress.complete,0);assert.equal(progress.invalid,3,'validation issues are not collapsed');
 const filled=editor.quotationSectionProgress(source,[{fieldKey:'packagedWeightG',optionId:'sku-0',value:'420'}],'sku-0').find(section=>section.id==='logistics');
 assert.equal(filled.required,progress.required);assert.equal(filled.complete,2);assert.equal(filled.invalid,1);
 assert.equal(JSON.stringify(source),before);
});

test('only exact required blank weight peers collapse; distinct errors and ambiguous bindings remain separate',()=>{
 const helper=load('app/quotation-required-summary.ts');
 const variants=[
  {fields:[weight,{...wire,required:false},dimensions],missing:2},
  {fields:[weight,{...wire,unit:'kg'},dimensions],missing:3},
  {fields:[weight,{...wire,readOnly:true},dimensions],missing:3},
  {fields:[weight,{...wire,visibility:'exposed'},dimensions],missing:3},
  {fields:[weight,{...wire,hubWire:{...wire.hubWire,name:'same label'}},dimensions],missing:3},
  {fields:[weight,wire,{...wire,id:'second_wire'},dimensions],missing:4},
  {fields:[weight,wire,dimensions],extraError:true,missing:3},
 ];
 for(const variant of variants){
  const fields=freeze(clone(variant.fields)),cells=freeze(Object.fromEntries(fields.map(field=>[field.id,cell('', 'empty',variant.extraError&&field.id===weight.id?[requiredBlank,'원문 연결 오류']:[requiredBlank])]))),before=JSON.stringify({fields,cells});
  const summary=helper.quotationRequiredSummary(fields,field=>cells[field.id]);
  assert.equal(summary.missing.length,variant.missing);assert.equal(JSON.stringify({fields,cells}),before);
 }
 const fields=freeze(clone([weight,wire,dimensions])),cells=freeze({packagedWeightG:cell(),live_weight:cell(),packagedDimensionsMm:cell()});
 const summary=helper.quotationRequiredSummary(fields,field=>cells[field.id]);
 assert.deepEqual(Array.from(summary.missing,entry=>entry.field.id),['live_weight','packagedDimensionsMm']);
 assert.deepEqual(Array.from(summary.missing[0].fieldIds),['live_weight','packagedWeightG']);
});

test('populated, divergent and invalid weight values keep both required fields and preserve draft values',()=>{
 for(const values of [['420','420'],['420','500'],['','420'],['bad','bad']]){
  const fields=clone([weight,wire,dimensions]),cells={packagedWeightG:cell(values[0],'option',values[0]?[]:[requiredBlank]),live_weight:cell(values[1],'option',values[1]?[]:[requiredBlank]),packagedDimensionsMm:cell()};
  const source=freeze(view(fields,[row('sku',cells)])),before=JSON.stringify(source);
  const summary=editor.quotationEditorRequiredSummary(source,[],'sku');
  assert.equal(summary.required,3);assert.equal(summary.missing.length,values[0]?1:2);
  assert.equal(summary.complete,values[0]==='bad'?0:values[0]?2:1);
  assert.equal(JSON.stringify(source),before);
 }
 const source=freeze(view(clone([weight,wire,dimensions]),[row('sku',{packagedWeightG:cell(),live_weight:cell(),packagedDimensionsMm:cell()})]));
 const changes=freeze([{fieldKey:'packagedWeightG',optionId:'sku',value:'420'}]),before=JSON.stringify({source,changes});
 const summary=editor.quotationEditorRequiredSummary(source,changes,'sku');
 assert.equal(summary.missing.length,1);assert.equal(summary.complete,2);
 assert.equal(JSON.stringify({source,changes}),before);
});

function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return[];return[tree,...nodes(tree.props?.children)];}
test('missing navigation uses the exact Hub weight wire while validation navigation retains both fields',()=>{
 const source=freeze(view(clone([weight,wire,dimensions]),[row('sku',{packagedWeightG:cell(),live_weight:cell(),packagedDimensionsMm:cell()})])),opened=[];
 const tree=editor.QuotationOptionOverview({view:source,changes:[],disabled:false,onOpen:(...target)=>opened.push(target)});
 const buttons=nodes(tree).filter(node=>node.type==='button');
 const missing=buttons.filter(button=>String(button.props.children).endsWith('입력하기'));
 assert.equal(missing.length,2);missing[0].props.onClick();
 assert.deepEqual(opened,[['sku','logistics','live_weight']]);
 assert.equal(buttons.filter(button=>String(button.props.children).endsWith('구역 열기')).length,3);
 const disabled=nodes(editor.QuotationOptionOverview({view:source,changes:[],disabled:true,onOpen(){}})).filter(node=>node.type==='button'&&String(node.props.children).endsWith('입력하기'));
 assert.ok(disabled.every(button=>button.props.disabled));
});

test('missing-field navigation focuses the remaining SKU after a removed selection renders and consumes its target',async()=>{
 const brand=field('brand',{section:'product',required:false}),fields=clone([weight,wire,dimensions,brand]);
 const values=name=>({packagedWeightG:cell(),live_weight:cell(),packagedDimensionsMm:cell(),brand:cell(name,'content',[])});
 let responseView=view(fields,[row(null,values('common'),false),row('removed',values('old SKU')),row('remaining',values('remaining SKU'))]);
 const states=[],refs=[],effects=[],callbacks=[],queued=[],reads=[],focuses=[],lookups=[];let stateIndex=0,refIndex=0,effectIndex=0,callbackIndex=0,committed=[];
 const sameDeps=(before,after)=>before&&after&&before.length===after.length&&after.every((value,index)=>Object.is(value,before[index]));
 const react={
  useState(initial){const index=stateIndex++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;return[states[index],value=>states[index]=typeof value==='function'?value(states[index]):value];},
  useRef(initial){const index=refIndex++;return refs[index]??={current:initial};},
  useEffect(run,deps){const index=effectIndex++,previous=effects[index];if(!previous||!sameDeps(previous.deps,deps)){const next={deps,cleanup:previous?.cleanup};effects[index]=next;queued.push(()=>{previous?.cleanup?.();next.cleanup=run();});}},
  useCallback(callback,deps){const index=callbackIndex++,previous=callbacks[index];if(!previous||!sameDeps(previous.deps,deps))callbacks[index]={deps,value:callback};return callbacks[index].value;},
  useId:()=> 'required-navigation',
 };
 const loaded=load('app/components/quotation-fields-editor.tsx',{react,
  fetch:async(url,init={})=>{reads.push({url,method:init.method??'GET'});return Response.json(responseView);},
  window:{addEventListener(){},removeEventListener(){}},
  document:{getElementById(id){const control=committed.find(node=>node.props?.id===id);lookups.push(id);return control?{scrollIntoView(){},focus(){focuses.push({id,option:committed.find(node=>node.type==='select')?.props.value,value:control.props.value});}}:null;}},
 });
 const render=()=>{stateIndex=0;refIndex=0;effectIndex=0;callbackIndex=0;const root=loaded.QuotationFieldsEditor({productId:'p'}),tree=root.type(root.props);committed=nodes(tree);queued.splice(0).forEach(run=>run());return tree;};
 const settle=async()=>{for(let index=0;index<5;index++){render();await new Promise(resolve=>setImmediate(resolve));}return render();};
 const select=value=>committed.find(node=>node.type==='select').props.onChange({target:{value}});
 try{
  render();await settle();select('removed');render();
  committed.find(node=>node.type==='input'&&node.props.id==='required-navigation-brand').props.onChange({target:{value:'retained removed-SKU draft'}});render();
  responseView=clone(responseView);responseView.resolved.rows=responseView.resolved.rows.filter(row=>row.optionId!=='removed');responseView.automatic.rows=responseView.automatic.rows.filter(row=>row.optionId!=='removed');
  committed.find(node=>node.type==='button'&&node.props.children==='기본값 다시 반영').props.onClick();await settle();
  assert.equal(committed.find(node=>node.type==='select').props.value,'removed');assert.equal(committed.filter(node=>node.type==='fieldset').length,0);
  const overview=committed.find(node=>node.type===loaded.QuotationOptionOverview),navigation=nodes(loaded.QuotationOptionOverview(overview.props)).find(node=>node.type==='button'&&[].concat(node.props.children).join('')==='live_weight 입력하기');
  assert.ok(navigation);assert.equal(navigation.props.disabled,false);navigation.props.onClick();
  assert.deepEqual(focuses,[],'the removed selection has no mounted input to focus before commit');
  render();
  assert.deepEqual(focuses,[{id:'required-navigation-live_weight',option:'remaining',value:''}],'focus follows the new option render');
  assert.deepEqual(clone(states[1]),[{fieldKey:'brand',optionId:'removed',value:'retained removed-SKU draft'}]);
  assert.ok(states[2].some(conflict=>conflict.unavailable));
  assert.equal(committed.find(node=>node.type==='button'&&String(node.props.children).startsWith('견적 입력 저장')).props.disabled,true,'navigation cannot bypass the retained conflict');
  committed.find(node=>node.type==='input'&&node.props.id==='required-navigation-brand').props.onChange({target:{value:'remaining draft'}});render();
  select('');render();
  assert.equal(focuses.length,1,'the pending target is consumed rather than repeated on later renders');
  const mountedOverview=committed.find(node=>node.type===loaded.QuotationOptionOverview),mountedNavigation=nodes(loaded.QuotationOptionOverview(mountedOverview.props)).find(node=>node.type==='button'&&[].concat(node.props.children).join('')==='live_weight 입력하기');
  mountedNavigation.props.onClick();assert.equal(focuses.length,1,'a mounted previous-option input is not focused before the next selection commits');render();
  assert.deepEqual(focuses[1],{id:'required-navigation-live_weight',option:'remaining',value:''});
  select('');render();assert.equal(focuses.length,2,'the second queued target is consumed too');
  assert.ok(reads.every(request=>request.method==='GET'));
  assert.ok(lookups.includes('required-navigation-live_weight'));
 }finally{effects.forEach(effect=>effect?.cleanup?.());}
});
