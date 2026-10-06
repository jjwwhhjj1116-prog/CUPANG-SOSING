import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import pathTools from 'node:path';
import {createRequire} from 'node:module';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {workbookArchive} from './helpers/quotation-workbook.mjs';
import {submissionPackageUI} from './helpers/submission-package-ui.mjs';
const native=createRequire(import.meta.url);
const initialVersion='2026-10-07T00:00:00.000Z';
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const plain=value=>JSON.parse(JSON.stringify(value));
const path=['패션의류잡화','유니섹스/남녀공용 패션','공용 잡화','선글라스','남녀공용패션선글라스'];
const inputs=['supplyPrice','salePrice','msrp'],keys=['purchasePrice','coupangSalePrice','msrp'];
const snapshot=company=>({format:'supplier-hub-schema-v1',categoryId:'69900',categoryPath:path,company,observedAt:Date.now(),
 metadata:{kanCategoryId:2624,noticeNumber:4,scopeType:'Retail_Categorized_Single',version:188},inputBindings:'couplus-paths-v1',
 schemaString:JSON.stringify({type:'object',properties:{
  startPage:{type:'object',required:['productName','categoryPath'],properties:{productName:{type:'string',title:'상품명'},categoryPath:{type:'string',title:'카테고리'}}},
  productPage:{type:'object',properties:{commonAttributes:{type:'object',properties:{purchasePrice:{type:'string',title:'공급가'},coupangSalePrice:{type:'string',title:'쿠팡 판매가'},msrp:{type:['string','null'],title:'권장소비자가격'},osrp:{type:['string','null'],title:'공식 판매처 가격'}}}}},
  legalPage:{type:'object',properties:{}}
 }})});
const wire=(schema,key)=>schema.fields.find(field=>!field.hubWire?.name&&JSON.stringify(field.hubWire?.path)===JSON.stringify(['productPage','commonAttributes',key]));
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};

function priceUI(fetcher,{productId='p',version=initialVersion,profileId}={}){
 const slots=[],effects=[],cache=new Map(),calls=[];let cursor=0,saved=0;
 const effect=(fn,deps)=>{const index=cursor++;if(!slots[index]||JSON.stringify(slots[index].deps)!==JSON.stringify(deps)){slots[index]?.cleanup?.();slots[index]={deps};effects.push(()=>slots[index].cleanup=fn());}};
 const react={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],value=>slots[index]=typeof value==='function'?value(slots[index]):value];},useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useEffect:effect,useLayoutEffect:effect};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,structuredClone,TextEncoder,fetch:async(url,init)=>{calls.push({url,init});return fetcher(url,init);},require(name){if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};if(name.startsWith('./')||name.startsWith('../'))return load(pathTools.posix.join(pathTools.posix.dirname(file),name)+'.ts');return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);}});return exports;
 }
 const Component=load('app/components/option-quotation-prices.tsx').OptionQuotationPrices;
 const render=()=>{cursor=0;const result=Component({productId,version,profileId,onSaved(){saved++;}});effects.splice(0).forEach(effect=>effect());return result;};
 const idle=async()=>{await Promise.resolve();const deadline=Date.now()+10000;while(render().props['data-workspace-saving']){assert.ok(Date.now()<deadline,'price UI request timed out');await new Promise(resolve=>setTimeout(resolve,1));}};
 const input=label=>nodes(render()).find(node=>node.type==='input'&&node.props['aria-label']===label);
 const button=label=>nodes(render()).find(node=>node.type==='button'&&node.props.children===label);
 const restore=label=>{const field=input(label),cell=nodes(render()).find(node=>node.type==='td'&&nodes(node).includes(field));
  // A render creates new JSX objects; locate the cell by its input label.
  const selected=cell??nodes(render()).find(node=>node.type==='td'&&nodes(node).some(child=>child.props?.['aria-label']===label));
  nodes(selected).find(node=>node.type==='button'&&node.props.children==='복원').props.onClick();};
 render();return{render,input,button,restore,idle,calls,load,get saved(){return saved;},setVersion(next){version=next;render();},close(){slots.forEach(slot=>slot?.cleanup?.());}};
}

function formView(){
 const fields=inputs.map((id,index)=>({id,label:id,type:'number',integer:true,min:1,required:false,section:'product',visibility:'common'}));
 const primary=inputs.map((hubInput,index)=>({id:'wire-'+hubInput,label:hubInput,type:'text',numericText:true,integer:true,min:1,required:false,section:'product',visibility:'common',hubInput,hubWire:{path:['productPage','commonAttributes',keys[index]]}}));
 const osrp={...primary[2],id:'wire-osrp',hubWire:{path:['productPage','commonAttributes','osrp']}};
 const schema={categoryId:'69900',categoryPath:path,fields:[...fields,...primary,osrp],salePriceMustCoverSupply:true};
 const row=overrides=>({optionId:'red',optionLabel:'빨강',included:true,fields:Object.fromEntries(schema.fields.map((field,index)=>{const automatic=String((index%3+1)*100),specific=overrides.options.red??{},value=Object.hasOwn(specific,field.id)?specific[field.id]:overrides.common[field.id]??automatic;return[field.id,{value,source:Object.hasOwn(specific,field.id)?'manual-option':Object.hasOwn(overrides.common,field.id)?'manual-common':'pricing',validationIssues:[]}];}))});
 const overrides={common:{supplyPrice:'120','wire-supplyPrice':'130','wire-osrp':'777'},options:{red:{supplyPrice:'150','wire-supplyPrice':'160',unrelated:'keep'}}};
 const view={revision:1,inputFingerprint:'a'.repeat(64),productVersion:initialVersion,contentRevision:1,optionRevision:1,updatedAt:initialVersion,imageKeys:[],categoryContext:{source:'collection',profileId:null,categoryId:'69900',categoryPath:path},overrides,resolved:{schema,rows:[row(overrides)]},automatic:{schema,rows:[row({common:{},options:{}})]}};
 return{view,resolve(){view.resolved.rows=[row(view.overrides)];return view;}};
}

test('stage-two price targets require exact unique primary paths and use OSRP only when the MSRP path is absent',()=>{
 const ui=priceUI(async()=>Response.json(formView().view));try{
  const target=ui.load('app/quotation-price-targets.ts').quotationPriceTargets,fields=formView().view.resolved.schema.fields;
  assert.deepEqual(plain(target(fields)),Object.fromEntries(inputs.map(input=>[input,{primary:'wire-'+input,linked:[input,'wire-'+input]}])));
  const noPrimary=fields.filter(field=>field.id!=='wire-msrp');assert.deepEqual(plain(target(noPrimary).msrp),{primary:'wire-osrp',linked:['msrp','wire-osrp']});
  assert.deepEqual(plain(target(fields.filter(field=>!['wire-msrp','wire-osrp'].includes(field.id))).msrp),{primary:'msrp',linked:['msrp']});
  const representation=ui.load('app/quotation-mapping.ts').primaryNumericTextFields;
  assert.equal(representation(fields).get('msrp'),'wire-msrp');assert.equal(representation(noPrimary).get('msrp'),'wire-osrp');
  assert.equal(representation([...noPrimary,{...noPrimary.find(field=>field.id==='wire-osrp'),id:'duplicate-osrp'}]).get('msrp'),undefined);
  assert.equal(representation(fields.map(field=>field.id==='wire-msrp'?{...field,numericText:undefined}:field)).get('msrp'),undefined,'an existing MSRP path prevents substitution by OSRP even when its rule is unsupported');
  for(const malformed of [
   [...fields,{...fields.find(field=>field.id==='wire-supplyPrice'),id:'duplicate'}],
   fields.map(field=>field.id==='wire-supplyPrice'?{...field,hubInput:undefined}:field),
   fields.map(field=>field.id==='wire-supplyPrice'?{...field,numericText:undefined,type:'select'}:field),
   [...noPrimary,{...noPrimary.find(field=>field.id==='wire-osrp'),id:'duplicate-osrp'}],
   noPrimary.map(field=>field.id==='wire-osrp'?{...field,hubInput:undefined}:field),
  ])assert.throws(()=>target(malformed),/가격 항목/);
  const unrelated=[...fields,{id:'other',label:'공급가',hubInput:'supplyPrice',type:'text',numericText:true,hubWire:{path:['productPage','otherPrice']}}];
  assert.equal(target(unrelated).supplyPrice.primary,'wire-supplyPrice');
 }finally{ui.close();}
});

test('wire price UI preserves divergent saved values until explicit editing and restores option values without removing common or OSRP values',async()=>{
 const fixture=formView(),before=JSON.stringify(fixture.view.overrides);
 const ui=priceUI(async(url,init)=>{if(init?.method==='PUT'){const changes=JSON.parse(init.body).changes;for(const change of changes){const values=fixture.view.overrides.options[change.optionId]??={};if(change.value===null)delete values[change.fieldKey];else values[change.fieldKey]=change.value;}fixture.view.revision++;fixture.view.productVersion=new Date(Date.parse(fixture.view.productVersion)+1).toISOString();fixture.view.updatedAt=fixture.view.productVersion;fixture.view.inputFingerprint=String(fixture.view.revision%10).repeat(64);fixture.resolve();}return Response.json(fixture.view);});
 try{
  await ui.idle();assert.equal(ui.input('빨강 공급가').props.value,'160');assert.match(JSON.stringify(ui.render()),/이전 공통·직접 수정값/);assert.equal(JSON.stringify(fixture.view.overrides),before);assert.equal(ui.calls.filter(call=>call.init?.method==='PUT').length,0);
  ui.input('빨강 공급가').props.onChange({target:{value:'170'}});ui.button('옵션 가격 저장').props.onClick();await ui.idle();
  assert.deepEqual(JSON.parse(ui.calls.find(call=>call.init?.method==='PUT').init.body).changes,[{optionId:'red',fieldKey:'supplyPrice',value:'170'},{optionId:'red',fieldKey:'wire-supplyPrice',value:'170'}]);
  assert.equal(fixture.view.overrides.options.red.unrelated,'keep');assert.equal(fixture.view.overrides.common['wire-osrp'],'777');
  ui.restore('빨강 공급가');assert.equal(ui.input('빨강 공급가').props.value,'130');ui.button('옵션 가격 저장').props.onClick();await ui.idle();
  assert.deepEqual(JSON.parse(ui.calls.filter(call=>call.init?.method==='PUT').at(-1).init.body).changes,[{optionId:'red',fieldKey:'supplyPrice',value:null},{optionId:'red',fieldKey:'wire-supplyPrice',value:null}]);
  assert.deepEqual(fixture.view.overrides.common,{supplyPrice:'120','wire-supplyPrice':'130','wire-osrp':'777'});assert.deepEqual(fixture.view.overrides.options.red,{unrelated:'keep'});assert.match(JSON.stringify(ui.render()),/이전 공통·직접 수정값/);
  ui.input('빨강 권장소비자가').props.onChange({target:{value:''}});ui.button('옵션 가격 저장').props.onClick();await ui.idle();assert.equal(fixture.view.overrides.options.red.msrp,'');assert.equal(fixture.view.overrides.options.red['wire-msrp'],'');assert.equal(fixture.view.overrides.common['wire-osrp'],'777');
 }finally{ui.close();}
});

test('ambiguous wire paths expose no editable price action or writes',async()=>{
 const fixture=formView();fixture.view.resolved.schema.fields.push({...fixture.view.resolved.schema.fields.find(field=>field.id==='wire-supplyPrice'),id:'ambiguous'});
 const ui=priceUI(async()=>Response.json(fixture.view));try{await ui.idle();assert.equal(ui.input('빨강 공급가'),undefined);assert.equal(ui.button('옵션 가격 저장').props.disabled,true);assert.match(JSON.stringify(ui.render()),/연결을 하나로 확인/);ui.button('옵션 가격 저장').props.onClick();await ui.idle();assert.equal(ui.calls.some(call=>call.init?.method==='PUT'),false);}finally{ui.close();}
});

test('an OSRP-only price input saves its exact observed wire while preserving unrelated prior MSRP wire overrides',async()=>{
 const fixture=formView();fixture.view.resolved.schema.fields=fixture.view.resolved.schema.fields.filter(field=>field.id!=='wire-msrp');fixture.view.overrides.options.red['wire-msrp']='888';fixture.resolve();
 const ui=priceUI(async(url,init)=>{if(init?.method==='PUT'){for(const change of JSON.parse(init.body).changes){const values=fixture.view.overrides.options[change.optionId];if(change.value===null)delete values[change.fieldKey];else values[change.fieldKey]=change.value;}fixture.view.revision++;fixture.resolve();}return Response.json(fixture.view);});
 try{
  await ui.idle();assert.equal(ui.input('빨강 권장소비자가').props.value,'777');ui.input('빨강 권장소비자가').props.onChange({target:{value:'900'}});ui.button('옵션 가격 저장').props.onClick();await ui.idle();
  assert.deepEqual(JSON.parse(ui.calls.find(call=>call.init?.method==='PUT').init.body).changes,[{optionId:'red',fieldKey:'msrp',value:'900'},{optionId:'red',fieldKey:'wire-osrp',value:'900'}]);assert.equal(fixture.view.overrides.options.red['wire-msrp'],'888');assert.equal(fixture.view.overrides.common['wire-osrp'],'777');
  ui.restore('빨강 권장소비자가');ui.button('옵션 가격 저장').props.onClick();await ui.idle();assert.equal(ui.input('빨강 권장소비자가').props.value,'777');assert.equal(fixture.view.overrides.options.red['wire-msrp'],'888');assert.equal(Object.hasOwn(fixture.view.overrides.options.red,'msrp'),false);assert.equal(Object.hasOwn(fixture.view.overrides.options.red,'wire-osrp'),false);
 }finally{ui.close();}
});

function officialPriceWorkbook(schema){
 const msrp=wire(schema,'msrp'),osrp=wire(schema,'osrp'),primary=[wire(schema,'purchasePrice'),wire(schema,'coupangSalePrice'),msrp??osrp],separateOsrp=msrp&&osrp?[osrp]:[],ordered=[schema.fields.find(field=>field.id==='title'),schema.fields.find(field=>field.id==='category'),...primary,...separateOsrp,
  ...schema.fields.filter(field=>!['title','category',...inputs,...primary.map(field=>field.id),...separateOsrp.map(field=>field.id)].includes(field.id))];
 const headers=ordered.map(field=>field.label),category=path.join('>')+' (69900)';
 const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;'),column=index=>{let name='';for(let n=index+1;n;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name;};
 const row=(r,values)=>`<row r="${r}">${values.map((value,index)=>`<c r="${column(index)}${r}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join('')}</row>`;
 const bytes=workbookArchive([['[Content_Types].xml','<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],['_rels/.rels','<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],['xl/workbook.xml','<workbook xmlns:r="relationship"><sheets><sheet name="QF_2624_price_ui" r:id="one"/></sheets></workbook>'],['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],['xl/worksheets/sheet1.xml',`<worksheet><sheetData>${row(1,['','Retail_Categorized_Excel:Kan:2624:Notice4:Version190'])}${row(5,headers)}${row(6,headers.map((_,i)=>i<4?'필수':'선택'))}${row(7,headers.map(()=>'작성 안내'))}${row(8,headers.map((_,i)=>i===1?category:'예시'))}${row(9,headers.map(()=>''))}</sheetData><dataValidations count="1"><dataValidation type="list" allowBlank="true" sqref="B9:B1008"><formula1>"${category}"</formula1></dataValidation></dataValidations></worksheet>`]]);
 return{bytes,headers,ordered};
}

// Recorded source fixture, real component callbacks/APIs/SQLite/generated XLSX;
// the workbook mimics an official layout and transport is captured, not sent.
for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])for(const osrpOnly of [false,true])test(`stage-two price edits, blanks and resets reach primary Hub wires and XLSX (${company.code}, ${osrpOnly?'OSRP-only':'MSRP and separate OSRP'})`,async()=>{
 const api=mobileIntakeHarness({companyCode:company.code,companyName:company.name});let ui;
 try{
  const snap=snapshot(company);if(osrpOnly){const raw=JSON.parse(snap.schemaString);delete raw.properties.productPage.properties.commonAttributes.properties.msrp;snap.schemaString=JSON.stringify(raw);}
  const schema=api.load('app/quotation-schema.ts').getQuotationSchema('69900',path,snap),original=officialPriceWorkbook(schema),excel={...snap,metadata:{...snap.metadata,scopeType:'Retail_Categorized_Excel',version:190}},connected=await api.load('app/official-hub-template.ts').connectOfficialHubTemplate(original.bytes.buffer,snap,excel),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',original.bytes)).toString('hex'),storageKey=`owner/category-templates/${sha256}.xlsx`;
  await api.bindings.FILES.put(storageKey,original.bytes,{customMetadata:{sha256,format:'xlsx'}});
  const profile=await api.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'단계별 가격 연결 시험',categoryId:'69900',categoryPath:path,hubSchema:snap,...connected,template:{...connected.template,name:'price-ui.xlsx',sha256,storageKey}},'cat');
  api.context.category=profile;api.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(api.context),'job');await api.intake();
  const product=api.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,qurl=base+'/quotation-fields';
  let current=await json(await api.route(qurl));const target=current.resolved.rows.find(row=>row.optionId),other=current.resolved.rows.filter(row=>row.optionId)[1],osrp=wire(current.resolved.schema,'osrp'),priceFields=[wire(current.resolved.schema,'purchasePrice'),wire(current.resolved.schema,'coupangSalePrice'),wire(current.resolved.schema,'msrp')??osrp];
  const write=async changes=>{current=await json(await api.route(qurl,{method:'PUT',body:{expectedRevision:current.revision,expectedInputFingerprint:current.inputFingerprint,changes}}));return current;};
  await write([{optionId:null,fieldKey:osrp.id,value:'77777'},...(osrpOnly?[{optionId:null,fieldKey:'msrp',value:'77777'}]:[]),{optionId:null,fieldKey:'taxType',value:'과세'},{optionId:null,fieldKey:'kcMarkType',value:'해당사항없음'},{optionId:null,fieldKey:'handlingReason',value:'해당사항없음'},{optionId:null,fieldKey:'shelfLifeDays',value:'0'},{optionId:null,fieldKey:'packagedWeightG',value:'420'},{optionId:null,fieldKey:'packagedDimensionsMm',value:'100*200*300'}]);
  const content=JSON.parse(api.sqlite.prepare('SELECT payload FROM product_content').get().payload),images=api.sqlite.prepare('SELECT object_key FROM collection_images ORDER BY image_index').all().map(row=>row.object_key);
  await json(await api.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{label:{model:'PRICE-UI-MODEL',material:'검토 재질'},assets:{main:[images[0]],additional:[images[1]],detail:[images[2]],label:[images[3]]}}}}));
  current=await json(await api.route(qurl));const untouched=plain(current.resolved.rows.find(row=>row.optionId===other.optionId).fields),optionsBefore=api.sqlite.prepare('SELECT payload FROM product_options').get().payload;
  if(osrpOnly){const mismatched=structuredClone(current.resolved);mismatched.rows.find(row=>row.optionId===target.optionId).fields.msrp={...mismatched.rows.find(row=>row.optionId===target.optionId).fields.msrp,value:'11111',source:'manual-option'};assert.ok(api.load('app/exports/quotation-fields.ts').quotationMappingCoverage(mismatched,profile).some(field=>field.fieldId==='msrp'),'OSRP-only representation still rejects a divergent canonical manual price');}
  ui=priceUI((url,init)=>api.route(url,{method:init?.method??'GET',...(init?.body?{body:JSON.parse(init.body)}:{})}),{productId:product.id,version:current.productVersion,profileId:profile.id});await ui.idle();
  for(const [label,value] of [['공급가','12345'],['판매가','23456'],['권장소비자가','']])ui.input(target.optionLabel+' '+label).props.onChange({target:{value}});
  ui.button('옵션 가격 저장').props.onClick();await ui.idle();assert.equal(ui.saved,1);
  const first=JSON.parse(ui.calls.find(call=>call.init?.method==='PUT').init.body);assert.equal(first.changes.length,6);assert.ok(first.changes.every(change=>change.optionId===target.optionId));assert.equal(first.changes.some(change=>change.fieldKey===osrp.id),osrpOnly);
  current=await json(await api.route(qurl));let saved=current.resolved.rows.find(row=>row.optionId===target.optionId);
  for(const [index,value]of ['12345','23456',''].entries()){assert.equal(saved.fields[inputs[index]].value,value);assert.equal(saved.fields[priceFields[index].id].value,value);assert.equal(saved.fields[priceFields[index].id].source,'manual-option');}
  assert.deepEqual(plain(current.resolved.rows.find(row=>row.optionId===other.optionId).fields),untouched);assert.equal(saved.fields[osrp.id].value,osrpOnly?'':'77777');assert.equal(current.overrides.common[osrp.id],'77777');assert.equal(api.sqlite.prepare('SELECT payload FROM product_options').get().payload,optionsBefore);
  let preview=await json(await api.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}}));
  assert.equal(preview.report.mappingCoverage.some(field=>inputs.includes(field.fieldId)),false);assert.deepEqual(plain(preview.rows[0].slice(2,5)),['12345','23456','']);if(!osrpOnly)assert.equal(preview.rows[0][5],'77777');
  const download=await api.route(base+'/quotation',{method:'POST',body:{action:'download',profileId:profile.id,fingerprint:preview.fingerprint}});assert.equal(download.status,200,await download.clone().text());
  const reader=api.load('app/xlsx-template.ts'),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(await download.arrayBuffer()));assert.deepEqual(plain(reader.xlsxHeaders(sheet,'QF_2624_price_ui',9).slice(2,5)),['12345','23456','']);if(!osrpOnly)assert.equal(reader.xlsxHeaders(sheet,'QF_2624_price_ui',9)[5],'77777');
  // Restore this option's sale price and explicitly keep its supply below the
  // restored automatic sale. Its independent MSRP blank and OSRP stay intact.
  ui.restore(target.optionLabel+' 판매가');ui.input(target.optionLabel+' 공급가').props.onChange({target:{value:'1000'}});ui.button('옵션 가격 저장').props.onClick();await ui.idle();assert.equal(ui.saved,2);
  current=await json(await api.route(qurl));saved=current.resolved.rows.find(row=>row.optionId===target.optionId);assert.equal(saved.fields.salePrice.source,'pricing');assert.equal(saved.fields[priceFields[1].id].source,'pricing');assert.equal(saved.fields.msrp.value,'');assert.equal(saved.fields[priceFields[2].id].value,'');assert.equal(saved.fields[osrp.id].value,osrpOnly?'':'77777');assert.equal(current.overrides.common[osrp.id],'77777');
  // Same-value input remains a deliberate manual price on both linked fields.
  ui.input(target.optionLabel+' 공급가').props.onChange({target:{value:'1000'}});ui.button('옵션 가격 저장').props.onClick();await ui.idle();assert.equal(ui.saved,3);
  const packageUI=submissionPackageUI({route:api.route,productId:product.id,categoryId:'69900',profileId:profile.id});await packageUI.click('견적서 + 첨부 파일 준비');assert.deepEqual(plain(packageUI.alerts()),[]);
  await packageUI.click('확장에 첨부 파일 준비');packageUI.choose();await packageUI.click('등록 전송');
  const handoff=packageUI.calls.find(call=>call.action==='transmit');assert.ok(handoff,JSON.stringify(packageUI.alerts()));assert.deepEqual(plain(handoff.files.company),company);
  const transferred=reader.inspectXlsxArchive(await reader.readXlsxArchive(Buffer.from(handoff.files.quotation[0].base64,'base64')));assert.equal(reader.xlsxHeaders(transferred,'QF_2624_price_ui',9)[2],'1000');assert.equal(reader.xlsxHeaders(transferred,'QF_2624_price_ui',9)[4],'');if(!osrpOnly)assert.equal(reader.xlsxHeaders(transferred,'QF_2624_price_ui',9)[5],'77777');
  assert.equal(api.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');ui.close();ui=null;
 }finally{ui?.close();api.close();}
});
