import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';

const native=createRequire(import.meta.url),cache=new Map();
function load(file,replacements={}){
 const cached=!Object.keys(replacements).length;if(cached&&cache.has(file))return cache.get(file);const exports={};if(cached)cache.set(file,exports);
 const output=ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(output,{exports,Error,TextEncoder,URLSearchParams,structuredClone,AbortController,fetch,document:replacements.document,require(name){
  if(Object.hasOwn(replacements,name))return replacements[name];
  if(name.endsWith('.css'))return{};
  if(name.startsWith('@/')){const base=name.slice(2);return load(base+(fs.existsSync(new URL('../'+base+'.ts',import.meta.url))?'.ts':'.tsx'));}
  return native(name);
 }});return exports;
}
const editor=load('app/components/quotation-fields-editor.tsx'),price=load('app/quotation-price-edits.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
const edit=(fieldKey,value,optionId='red')=>({fieldKey,value,optionId});
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const inputs=['supplyPrice','salePrice','msrp'],wireNames=['purchasePrice','coupangSalePrice','msrp'];
const path=['패션의류잡화','유니섹스/남녀공용 패션','공용 잡화','선글라스','남녀공용패션선글라스'];
function fixture(overrides={common:{},options:{}}){
 const fields=inputs.map(id=>({id,label:id,type:'number',integer:true,min:1,section:'product',visibility:'common',required:false}));
 fields.push(...inputs.map((id,index)=>({...fields[index],id:'wire-'+id,type:'text',numericText:true,hubInput:id,hubWire:{path:['productPage','commonAttributes',wireNames[index]]}})));
 fields.push({...fields[5],id:'wire-osrp',hubWire:{path:['productPage','commonAttributes','osrp']}},{id:'brand',label:'브랜드',section:'product',type:'text',visibility:'common',required:false});
 const schema={fields,categoryId:'69900',categoryPath:path,status:'observed',salePriceMustCoverSupply:true};
 const automaticValues={supplyPrice:'100','wire-supplyPrice':'100',salePrice:'200','wire-salePrice':'200',msrp:'300','wire-msrp':'300','wire-osrp':'700',brand:'브랜드'};
 const rows=state=>[null,'red','blue','excluded'].map(optionId=>({optionId,optionLabel:optionId??'공통',included:optionId!==null&&optionId!=='excluded',fields:Object.fromEntries(fields.map(field=>{
  const specific=state.options[optionId]??{},own=optionId!==null&&Object.hasOwn(specific,field.id),shared=Object.hasOwn(state.common,field.id);
  return[field.id,{value:own?specific[field.id]:shared?state.common[field.id]:automaticValues[field.id],source:own?'manual-option':shared?'manual-common':'pricing',validationIssues:[],issues:[],needsReview:false}];
 }))}));
 return{revision:1,inputFingerprint:'a'.repeat(64),productVersion:'2026-10-08T00:00:00.000Z',contentRevision:1,optionRevision:1,imageKeys:[],overrides,
  resolved:{schema,rows:rows(overrides),issues:[]},automatic:{schema,rows:rows({common:{},options:{}})},categoryContext:{source:'collection',profileId:'p',categoryId:'69900',categoryPath:path}};
}

function renderedEditor(view){
 const states=[],refs=[];let cursor=0,refCursor=0;const focused=[];
 const react={useState(initial){const index=cursor++;if(!(index in states))states[index]=index===0?view:index===3?false:typeof initial==='function'?initial():initial;return[states[index],value=>states[index]=typeof value==='function'?value(states[index]):value];},useRef(initial){const index=refCursor++;return refs[index]??={current:initial};},useEffect(){},useCallback:fn=>fn,useId:()=> 'stage7-price'};
 const loadedForm=load('app/components/quotation-fields-editor.tsx',{react,document:{getElementById(id){focused.push(id);return{scrollIntoView(){},focus(){}};}}});
 const render=()=>{cursor=0;refCursor=0;const root=loadedForm.QuotationFieldsEditor({productId:'p'});return root.type(root.props);};
 const control=id=>nodes(render()).find(node=>node.type==='input'&&node.props.id==='stage7-price-'+id);
 render();return{render,control,focused,get changes(){return states[1];},select(value){nodes(render()).find(node=>node.type==='select').props.onChange({target:{value}});}};
}

for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])test(`stage seven renders one primary price control, keeps separate OSRP and routes canonical issues to it (${company.code})`,()=>{
 const view=fixture({common:{},options:{red:{supplyPrice:'150','wire-supplyPrice':'160'}}});view.company=company;
 for(const field of view.resolved.schema.fields.filter(field=>['supplyPrice','wire-supplyPrice','salePrice','wire-salePrice'].includes(field.id)))field.required=true;
 const before=JSON.stringify(view),ui=renderedEditor(view);ui.select('red');
 for(const input of inputs){assert.equal(ui.control(input),undefined);assert.ok(ui.control('wire-'+input));
  const target=editor.resolveQuotationEditorNavigation(view.resolved,{optionId:'red',fieldId:input,categoryId:'69900'});
  assert.equal(target.ok,true);assert.equal(target.fieldId,'wire-'+input);assert.equal(target.optionId,'red');assert.ok(ui.control(target.fieldId));
  assert.equal(load('app/quotation-field-groups.ts').quotationFieldGroup(view.resolved.schema.fields.find(field=>field.id===target.fieldId),view.resolved.schema.fields),'가격 정보');
 }
 assert.ok(ui.control('wire-osrp'));assert.ok(ui.control('brand'));assert.equal(nodes(ui.render()).filter(node=>node.type==='input'&&/^stage7-price-(?:wire-(?:supplyPrice|salePrice|msrp|osrp))$/.test(node.props.id??'')).length,4);
 assert.match(JSON.stringify(ui.render()),/이전 요약 가격/);assert.match(JSON.stringify(ui.render()),/150/);
 assert.equal(editor.quotationSectionProgress(view,[],'red').find(section=>section.id==='product').required,2);
 const supply=ui.control('wire-supplyPrice');supply.props.onChange({target:{value:'160'}});
 assert.deepEqual(plain(ui.changes),[edit('supplyPrice','160')],'retyping unchanged primary repairs only divergent retained summary through an explicit edit');
 const plan=editor.quotationSavePlan(view,ui.changes,'red',false);assert.equal(plan.changes.length,2);assert.ok(plan.changes.every(change=>change.value==='160'));
 assert.doesNotMatch(JSON.stringify(ui.render()),/이전 요약 가격/);
 ui.control('wire-msrp').props.onChange({target:{value:''}});assert.equal(editor.resolveQuotationEditorCell(view,ui.changes,'red','msrp').value,'');
 ui.control('wire-salePrice').props.onChange({target:{value:'90'}});assert.match(editor.resolveQuotationEditorCell(view,ui.changes,'red','wire-salePrice').validationIssues.join(' '),/공급가보다/);
 const errorButton=nodes(ui.render()).find(node=>node.type==='button'&&node.props.children==='salePrice');assert.ok(errorButton);errorButton.props.onClick();assert.equal(ui.focused.at(-1),'stage7-price-wire-salePrice');
 assert.equal(JSON.stringify(view),before);
});

test('visible primary price resets alias-only common and option overrides, including blanks, without resetting inherited aliases or OSRP',()=>{
 for(const optionId of [null,'red'])for(const input of inputs)for(const value of ['175','']){
  const overrides={common:{brand:'공통 보존','wire-osrp':'777'},options:{blue:{brand:'다른 옵션 보존'},excluded:{msrp:'999'}}};
  if(optionId===null)overrides.common[input]=value;else overrides.options.red={[input]:value,brand:'선택 옵션 보존'};
  const view=fixture(overrides),before=JSON.stringify(view),ui=renderedEditor(view);
  const priceField=()=>nodes(ui.render()).find(node=>node.type==='div'&&node.props.className?.startsWith('quotation-field ')
   &&nodes(node).some(child=>child.type==='input'&&child.props.id==='stage7-price-wire-'+input));
  const reset=()=>nodes(priceField()).find(node=>node.type==='button'&&typeof node.props.children==='string'&&node.props.children.startsWith('수정 해제'));
  if(optionId===null){ui.select('blue');assert.equal(reset(),undefined,'an inherited alias is not an override owned by this option');}
  ui.select(optionId??'');
  assert.equal(ui.control(input),undefined);assert.ok(ui.control('wire-'+input));assert.deepEqual(plain(ui.changes),[]);
  assert.equal(editor.resolveQuotationEditorCell(view,[],optionId,input).value,value);
  assert.equal(JSON.stringify(view),before,'rendering and scope selection preserve retained aliases');
  const button=reset();assert.ok(button,`${input} alias-only ${optionId??'common'} override has a direct reset`);button.props.onClick();
  assert.deepEqual(plain(ui.changes),[edit(input,null,optionId)]);
  const plan=editor.quotationSavePlan(view,ui.changes,optionId,false);
  assert.deepEqual(new Set(plan.changes.map(change=>change.fieldKey)),new Set([input,'wire-'+input]));
  assert.ok(plan.changes.every(change=>change.optionId===optionId&&change.value===null));
  for(const key of [input,'wire-'+input])assert.equal(editor.resolveQuotationEditorCell(view,ui.changes,optionId,key).source,'pricing');
  assert.equal(reset(),undefined,'the paired reset removes reset availability from the draft');
  const saved=load('app/quotation-schema.ts').applyQuotationChanges(view.overrides,plan.changes),expected=structuredClone(overrides);
  delete (optionId===null?expected.common:expected.options[optionId])[input];
  assert.deepEqual(plain(saved),expected,'only the explicitly reset price scope changes; OSRP and other options remain exact');
  assert.equal(JSON.stringify(view),before);
 }
});

test('ambiguous, readonly and unbound canonical controls stay visible; OSRP only becomes primary when exact MSRP is absent',()=>{
 const view=fixture(),fields=view.resolved.schema.fields;
 const malformed=[...fields,{...fields.find(field=>field.id==='wire-supplyPrice'),id:'duplicate'}];assert.equal(price.quotationPriceVisibleFields(malformed).length,malformed.length);
 const unbound=fields.filter(field=>field.id!=='wire-msrp');assert.equal(price.quotationPriceDisplayField(unbound,'msrp'),'wire-osrp');
 const noMsrp=unbound.filter(field=>field.id!=='wire-osrp');assert.equal(price.quotationPriceDisplayField(noMsrp,'msrp'),'msrp');
 const readonly=fields.map(field=>field.id==='supplyPrice'?{...field,readOnly:true}:field);assert.equal(price.quotationPriceDisplayField(readonly,'supplyPrice'),'supplyPrice');
 const names=new Set(price.quotationPriceVisibleFields(fields).map(field=>field.id));assert.ok(names.has('wire-osrp'));assert.ok(names.has('brand'));assert.equal(names.has('supplyPrice'),false);
});

test('stage seven does not reconcile saved divergent prices or independent OSRP when reading or saving another field',()=>{
 const view=fixture({common:{supplyPrice:'120','wire-supplyPrice':'130','wire-osrp':''},options:{red:{supplyPrice:'150','wire-supplyPrice':'160',brand:'유지'}}}),before=JSON.stringify(view);
 assert.equal(editor.resolveQuotationEditorCell(view,[],'red','supplyPrice').value,'150');
 assert.equal(editor.resolveQuotationEditorCell(view,[],'red','wire-supplyPrice').value,'160');
 assert.deepEqual(plain(editor.quotationSavePlan(view,[edit('brand','수정')],'red',false).changes),[edit('brand','수정')]);
 assert.deepEqual(plain(price.quotationPriceEditFields(view.resolved.schema.fields,'wire-osrp')),['wire-osrp']);
 assert.equal(JSON.stringify(view),before);
});

test('stage-seven explicit single price edits, blanks and resets pair exact IDs in draft and save for common and SKU scopes',()=>{
 const view=fixture({common:{supplyPrice:'120','wire-supplyPrice':'130'},options:{red:{supplyPrice:'150','wire-supplyPrice':'160'}}}),before=JSON.stringify(view);
 for(const optionId of [null,'red'])for(const fieldKey of ['supplyPrice','wire-supplyPrice'])for(const value of ['170','',null]){
  const change=edit(fieldKey,value,optionId),plan=editor.quotationSavePlan(view,[change],optionId,false);
  assert.deepEqual(new Set(plan.changes.map(change=>change.fieldKey)),new Set(['supplyPrice','wire-supplyPrice']));
  assert.ok(plan.changes.every(change=>change.optionId===optionId&&change.value===value));
  for(const key of ['supplyPrice','wire-supplyPrice']){
   const cell=editor.resolveQuotationEditorCell(view,[change],optionId,key);
   assert.equal(cell.value,value===null?(optionId===null?'100':key==='supplyPrice'?'120':'130'):value);
  }
 }
 const shared=[edit('wire-supplyPrice','180',null)];
 assert.equal(editor.resolveQuotationEditorCell(view,shared,'blue','supplyPrice').value,'180');
 assert.equal(editor.resolveQuotationEditorCell(view,shared,'red','wire-supplyPrice').value,'160');
 const restored=[...shared,edit('supplyPrice',null)];
 assert.equal(editor.resolveQuotationEditorCell(view,restored,'red','wire-supplyPrice').value,'180');
 assert.equal(JSON.stringify(view),before);
});

test('actual primary-wire sale/supply relationship is checked before stage-seven saving, including inherited prices',()=>{
 const view=fixture();
 for(const change of [edit('wire-salePrice','90'),edit('salePrice','90'),edit('wire-supplyPrice','250')]){
  const shown=editor.resolveQuotationEditorCell(view,[change],'red','wire-salePrice');
  assert.match(shown.validationIssues.join(' '),/공급가보다/);
  assert.throws(()=>editor.quotationSavePlan(view,[change],'red',false),/공급가보다/);
 }
 const shared=fixture({common:{supplyPrice:'150','wire-supplyPrice':'150'},options:{}});
 assert.throws(()=>editor.quotationSavePlan(shared,[edit('wire-salePrice','140')],'red',false),/공급가보다/);
 assert.equal(editor.quotationSavePlan(view,[edit('wire-salePrice','')],'red',false).changes.length,2,'a manual blank remains a draft rather than being invented');
 assert.equal(editor.quotationSavePlan(view,[edit('wire-salePrice','90'),edit('wire-supplyPrice','80')],'red',false).changes.length,4);
});

test('common price edits ignore untouched invalid excluded SKU drafts while explicit excluded price edits remain validated',()=>{
 const view=fixture({common:{},options:{excluded:{supplyPrice:'1000','wire-supplyPrice':'1000',salePrice:'100','wire-salePrice':'100'}}}),before=JSON.stringify(view);
 const plan=editor.quotationSavePlan(view,[edit('wire-supplyPrice','150',null)],null,false);
 assert.equal(plan.changes.length,2);assert.ok(plan.changes.every(change=>change.optionId===null));
 assert.throws(()=>editor.quotationSavePlan(view,[edit('wire-supplyPrice','900','excluded')],'excluded',false),/공급가보다/);
 assert.equal(JSON.stringify(view),before);
});

test('stage-seven refresh preserves primary-only repair intent until both peers fulfill and detects peer-only schema or value changes',()=>{
 const before=fixture({common:{},options:{red:{supplyPrice:'150','wire-supplyPrice':'160'}}}),same=structuredClone(before),draft=[edit('wire-supplyPrice','160')];
 const retained=editor.reconcileQuotationEditorDraft(before,same,draft);assert.deepEqual(plain(retained.changes),draft);assert.equal(retained.conflicts.length,0);
 const completed=fixture({common:{},options:{red:{supplyPrice:'160','wire-supplyPrice':'160'}}});assert.equal(editor.reconcileQuotationEditorDraft(before,completed,draft).changes.length,0);
 const concurrent=fixture({common:{},options:{red:{supplyPrice:'180','wire-supplyPrice':'160'}}});
 const pending=[edit('wire-supplyPrice','170')],conflicted=editor.reconcileQuotationEditorDraft(before,concurrent,pending);
 assert.deepEqual(plain(conflicted.changes),pending);assert.equal(conflicted.conflicts.length,1);assert.equal(conflicted.conflicts[0].before,'150');assert.equal(conflicted.conflicts[0].saved,'180');
 const changedRule=structuredClone(before);changedRule.resolved.schema.fields.find(field=>field.id==='supplyPrice').max=155;
 assert.equal(editor.reconcileQuotationEditorDraft(before,changedRule,pending).conflicts[0].schemaChanged,true);
 const reset=editor.reconcileQuotationEditorDraft(before,fixture({common:{},options:{red:{supplyPrice:'150'}}}),[edit('wire-supplyPrice',null)]);assert.equal(reset.changes.length,1,'a primary reset is not fulfilled while its canonical override remains');
 assert.equal(JSON.stringify(before.overrides),JSON.stringify({common:{},options:{red:{supplyPrice:'150','wire-supplyPrice':'160'}}}));
});

test('competing staged literals or reset/literal pairs block without erasing either input; duplicate exact paths cannot acquire a price binding',()=>{
 const view=fixture();
 for(const changes of [[edit('supplyPrice','120'),edit('wire-supplyPrice','130')],[edit('msrp',null),edit('wire-msrp','')]]){
  const before=JSON.stringify(changes);assert.throws(()=>editor.quotationSavePlan(view,changes,'red',false),/수정값이 다릅니다/);
  assert.match(editor.resolveQuotationEditorCell(view,changes,'red',changes[0].fieldKey).validationIssues.join(' '),/수정값이 다릅니다/);
  assert.equal(JSON.stringify(changes),before);
 }
 const malformed=structuredClone(view);malformed.resolved.schema.fields.push({...malformed.resolved.schema.fields.find(field=>field.id==='wire-supplyPrice'),id:'duplicate-price'});
 assert.throws(()=>editor.quotationSavePlan(malformed,[edit('wire-supplyPrice','120')],'red',false),/연결을 하나로/);
});

test('stage-seven copy and restore previews include exact peers, preserve excluded SKU/common/OSRP and reject selecting divergent saved peers',()=>{
 const view=fixture({common:{msrp:'300','wire-msrp':'300','wire-osrp':''},options:{blue:{supplyPrice:'110','wire-supplyPrice':'110',brand:'보존'},excluded:{msrp:'999','wire-msrp':'999'}}}),before=JSON.stringify(view);
 const copied=editor.previewQuotationEditorBulk(view,[],'red',['wire-supplyPrice'],true);
 assert.deepEqual(new Set(copied.rows.map(row=>row.fieldKey)),new Set(['supplyPrice','wire-supplyPrice']));
 assert.ok(copied.rows.every(row=>row.optionId==='blue'));
 const applied=editor.applyQuotationEditorBulk(view,[],copied),plan=editor.quotationSavePlan(view,applied,'red',false);
 assert.equal(plan.changes.length,2);assert.ok(plan.changes.every(change=>change.optionId==='blue'&&change.value==='100'));
 const restore=editor.previewQuotationEditorRestore(view,[],['wire-supplyPrice'],true);
 assert.equal(restore.rows.length,2);assert.ok(restore.changes.every(change=>change.optionId==='blue'&&change.value===null));
 assert.equal(editor.quotationSavePlan(view,editor.applyQuotationEditorBulk(view,[],restore),'blue',false).changes.length,2);
 const all=editor.quotationSavePlan(view,[edit('wire-msrp','400')],'red',true);
 assert.equal(all.changes.length,4);assert.ok(all.changes.every(change=>['red','blue'].includes(change.optionId)&&['msrp','wire-msrp'].includes(change.fieldKey)));
 const divergent=fixture({common:{},options:{red:{supplyPrice:'110','wire-supplyPrice':'120'}}});
 assert.throws(()=>editor.previewQuotationEditorBulk(divergent,[],'red',['supplyPrice','wire-supplyPrice'],true),/수정값이 다릅니다/);
 assert.equal(JSON.stringify(view),before);
});

const sourceSnapshot=company=>({format:'supplier-hub-schema-v1',categoryId:'69900',categoryPath:path,company,observedAt:Date.now(),inputBindings:'couplus-paths-v1',
 metadata:{kanCategoryId:2624,noticeNumber:4,scopeType:'Retail_Categorized_Single',version:188},schemaString:JSON.stringify({type:'object',properties:{
  startPage:{type:'object',properties:{productName:{type:'string',title:'상품명'},categoryPath:{type:'string',title:'카테고리'}}},
  productPage:{type:'object',properties:{commonAttributes:{type:'object',properties:{purchasePrice:{type:'string',title:'공급가'},coupangSalePrice:{type:'string',title:'쿠팡 판매가'},msrp:{type:['string','null'],title:'권장소비자가격'},osrp:{type:['string','null'],title:'공식 판매처 가격'}}}}},
  legalPage:{type:'object',properties:{}}
 }})});
const exactWire=(fields,name)=>fields.find(field=>!field.hubWire?.name&&JSON.stringify(field.hubWire?.path)===JSON.stringify(['productPage','commonAttributes',name]));
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};

// Synthetic workbook + recorded sourcing fixture + real SQLite/API/exporter.
// No live Supplier Hub request or production merchant data is changed.
for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])for(const osrpOnly of [false,true])test(`stage-seven primary edits/clear/reset reach resolved values and generated XLSX (${company.code}, ${osrpOnly?'OSRP only':'independent OSRP'})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
 try{
  const snapshot=sourceSnapshot(company);if(osrpOnly){const value=JSON.parse(snapshot.schemaString);delete value.properties.productPage.properties.commonAttributes.properties.msrp;snapshot.schemaString=JSON.stringify(value);}
  const schema=h.load('app/quotation-schema.ts').getQuotationSchema('69900',path,snapshot),fields=schema.fields.filter(field=>!inputs.includes(field.id));
  const bytes=quotationWorkbook(fields.map(field=>field.label)),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),storageKey=`owner/category-templates/${sha256}.xlsx`;
  await h.bindings.FILES.put(storageKey,bytes,{customMetadata:{sha256,format:'xlsx'}});
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'7단계 가격 연결 검수',categoryId:'69900',categoryPath:path,hubSchema:snapshot,
   template:{name:'stage7-price.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields.map(field=>field.label)},mappings:fields.map((field,column)=>({field:field.id,column,required:field.required}))},'cat');
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,qurl=base+'/quotation-fields';
  let view=await json(await h.route(qurl));const ids=view.resolved.rows.filter(row=>row.optionId).map(row=>row.optionId),target=ids[0],other=ids[1],primary=wireNames.map(name=>exactWire(view.resolved.schema.fields,name)),osrp=exactWire(view.resolved.schema.fields,'osrp');
  primary[2]??=osrp;
  const write=async changes=>view=await json(await h.route(qurl,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));
  if(!osrpOnly)await write([{optionId:null,fieldKey:osrp.id,value:'77777'}]);
  const optionsBefore=h.sqlite.prepare('SELECT payload FROM product_options').get().payload,contentBefore=h.sqlite.prepare('SELECT payload FROM product_content').get().payload,otherBefore=plain(view.resolved.rows.find(row=>row.optionId===other));
  const drafts=[{optionId:target,fieldKey:primary[0].id,value:'12345'},{optionId:target,fieldKey:primary[1].id,value:'23456'},{optionId:target,fieldKey:primary[2].id,value:''}],plan=editor.quotationSavePlan(view,drafts,target,false);
  assert.equal(plan.changes.length,6);await write(plan.changes);
  const current=view.resolved.rows.find(row=>row.optionId===target);
  for(const [index,value]of ['12345','23456',''].entries()){assert.equal(current.fields[inputs[index]].value,value);assert.equal(current.fields[primary[index].id].value,value);}
  assert.deepEqual(plain(view.resolved.rows.find(row=>row.optionId===other)),otherBefore);
  let preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}}));
  assert.equal(preview.report.mappingCoverage.some(field=>inputs.includes(field.fieldId)),false);
  for(const [index,value]of ['12345','23456',''].entries())assert.equal(preview.rows[0][fields.findIndex(field=>field.id===primary[index].id)],value);
  if(!osrpOnly)assert.equal(preview.rows[0][fields.findIndex(field=>field.id===osrp.id)],'77777');
  const download=await h.route(base+'/quotation',{method:'POST',body:{action:'download',profileId:profile.id,fingerprint:preview.fingerprint}});assert.equal(download.status,200,await download.clone().text());
  const reader=h.load('app/xlsx-template.ts'),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(await download.arrayBuffer())),actual=reader.xlsxHeaders(sheet,'견적서',2);
  assert.equal(actual[fields.findIndex(field=>field.id===primary[0].id)],'12345');assert.equal(actual[fields.findIndex(field=>field.id===primary[2].id)],'');
  const restored=editor.quotationSavePlan(view,[{optionId:target,fieldKey:primary[0].id,value:'1000'},{optionId:target,fieldKey:primary[1].id,value:null}],target,false);
  await write(restored.changes);assert.equal(view.resolved.rows.find(row=>row.optionId===target).fields.salePrice.source,'pricing');assert.equal(view.resolved.rows.find(row=>row.optionId===target).fields[primary[1].id].source,'pricing');
  assert.equal(view.resolved.rows.find(row=>row.optionId===target).fields.msrp.value,'');
  assert.equal(h.sqlite.prepare('SELECT payload FROM product_options').get().payload,optionsBefore);assert.equal(h.sqlite.prepare('SELECT payload FROM product_content').get().payload,contentBefore);
  preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}}));assert.equal(preview.report.mappingCoverage.some(field=>inputs.includes(field.fieldId)),false);
  assert.equal(preview.rows[0][fields.findIndex(field=>field.id===primary[0].id)],'1000');
 }finally{h.close();}
});
