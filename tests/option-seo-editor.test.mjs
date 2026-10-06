import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import pathTools from 'node:path';
import {createRequire} from 'node:module';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
const native=createRequire(import.meta.url),plain=value=>JSON.parse(JSON.stringify(value));
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const visibleText=value=>Array.isArray(value)?value.map(visibleText).join(''):value&&typeof value==='object'?visibleText(value.props?.children):value==null?'':String(value);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const initialVersion='2026-10-07T00:00:00.000Z',nextVersion=version=>new Date(Date.parse(version)+1).toISOString();

function seoUI(fetcher,{productId='p',optionId='red',version=initialVersion,profileId,refreshToken='0'}={}){
 const slots=[],effects=[],layoutEffects=[],cache=new Map(),calls=[];let cursor=0,saved=0,closed=false,lateWrites=0,saveAckVersion;
 const scheduleEffect=(queue,fn,deps)=>{const index=cursor++;if(!slots[index]||JSON.stringify(slots[index].deps)!==JSON.stringify(deps)){const previous=slots[index],next={deps,cleanup:previous?.cleanup};slots[index]=next;queue.push(()=>{previous?.cleanup?.();next.cleanup=fn();});}};
 const react={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return[slots[index],value=>{if(closed){lateWrites++;return;}slots[index]=typeof value==='function'?value(slots[index]):value;}];},useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useEffect(fn,deps){scheduleEffect(effects,fn,deps);},useLayoutEffect(fn,deps){scheduleEffect(layoutEffects,fn,deps);}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,structuredClone,TextEncoder,fetch:async(url,init)=>{calls.push({url,init});const response=await fetcher(url,init);if(init?.method==='PUT'&&response.ok)saveAckVersion=(await response.clone().json()).productVersion;return response;},require(name){if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};if(name.startsWith('./')||name.startsWith('../'))return load(pathTools.posix.join(pathTools.posix.dirname(file),name)+'.ts');return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);}});return exports;
 }
 const Component=load('app/components/option-seo-editor.tsx').OptionSeoEditor;
 // The host refreshes its product version after a verified onSaved callback,
 // as dashboard sourceSaved/loadWorkspace does. Invalid ACKs never refresh it.
 const render=(flush=true)=>{cursor=0;const tree=Component({productId,optionId,version,profileId,refreshToken,onSaved(){saved++;version=saveAckVersion;}});layoutEffects.splice(0).forEach(effect=>effect());if(flush)effects.splice(0).forEach(effect=>effect());return tree;};
  const idle=async()=>{const deadline=Date.now()+10000;let stable=0,previous='';for(;;){render();await new Promise(resolve=>setImmediate(resolve));const tree=render(),identity=JSON.stringify([version,refreshToken,calls.length]);if(!tree.props['data-workspace-saving']&&!effects.length&&!layoutEffects.length&&identity===previous)stable++;else stable=0;if(stable>=3)return;previous=identity;assert.ok(Date.now()<deadline,'SEO UI request timed out');await new Promise(resolve=>setTimeout(resolve,1));}};
 const input=label=>nodes(render()).find(node=>node.type==='textarea'&&node.props['aria-label']===label),button=label=>nodes(render()).find(node=>node.type==='button'&&visibleText(node)===label);
 render();return{render,input,button,idle,load,calls,get saved(){return saved;},get lateWrites(){return lateWrites;},select(id,nextProduct=productId){optionId=id;productId=nextProduct;render();},source(nextVersion,nextRefresh=refreshToken,flush=true){version=nextVersion;refreshToken=nextRefresh;render(flush);},close(){closed=true;slots.forEach(slot=>slot?.cleanup?.());},async click(label){const selected=button(label);assert.ok(selected&&!selected.props.disabled,'available SEO button '+label);selected.props.onClick();await idle();}};
}

function fixture(){
 const fields=[{id:'title',label:'상품명',type:'text',required:true,maxLength:500,section:'start',visibility:'common'},{id:'searchTags',label:'검색태그',type:'textarea',required:true,maxLength:150,section:'product',visibility:'common'},
  {id:'wire-title',label:'상품명',type:'text',required:true,maxLength:500,section:'start',visibility:'common',hubInput:'title',hubWire:{path:['startPage','productName']}},
  {id:'wire-tags',label:'검색태그',type:'textarea',required:true,maxLength:150,section:'product',visibility:'common',hubInput:'searchTags',hubWire:{path:['productPage','searchTags']}}];
 const overrides={common:{title:'공통 수정 상품명','wire-title':'공통 Hub 상품명',searchTags:'공통태그','wire-tags':'공통Hub태그'},options:{red:{unrelated:'보존'},blue:{title:'다른 옵션 이름','wire-title':'다른 Hub 옵션 이름'}}};
 const rows=values=>['red','blue'].map(optionId=>({optionId,optionLabel:optionId,included:true,fields:Object.fromEntries(fields.map(field=>{const own=values.options[optionId]??{},hasOwn=Object.hasOwn(own,field.id),hasCommon=Object.hasOwn(values.common,field.id);return[field.id,{value:hasOwn?own[field.id]:hasCommon?values.common[field.id]:field.hubInput==='searchTags'||field.id==='searchTags'?'자동태그':'자동 상품명',source:hasOwn?'manual-option':hasCommon?'manual-common':'content',validationIssues:[]}];}))}));
 const view={revision:1,inputFingerprint:'a'.repeat(64),productVersion:initialVersion,contentRevision:2,optionRevision:3,updatedAt:initialVersion,imageKeys:[],categoryContext:{categoryId:'80719',categoryPath:['주방'],profileId:null},overrides,resolved:{schema:{fields},rows:rows(overrides)},automatic:{schema:{fields},rows:rows({common:{},options:{}})}};
 return{view,reply(url,init){if(init?.method==='PUT'){const body=JSON.parse(init.body);if(body.expectedRevision!==view.revision)return Response.json({error:'동시 수정'},{status:409});for(const change of body.changes){const values=view.overrides.options[change.optionId]??={};if(change.value===null)delete values[change.fieldKey];else values[change.fieldKey]=change.value;}view.revision++;view.productVersion=nextVersion(view.productVersion);view.updatedAt=view.productVersion;view.resolved.rows=rows(view.overrides);}return Response.json(view);}};
}

test('SEO targets use only exact primary bindings and reject ambiguous, malformed or similarly labelled paths',()=>{
 const h=seoUI(async()=>Response.json(fixture().view));try{
  const model=h.load('app/quotation-seo-targets.ts'),fields=fixture().view.resolved.schema.fields;
  assert.equal(model.exactPrimaryQuotationTarget(fields,'title').primary,'wire-title');assert.equal(model.exactPrimaryQuotationTarget(fields,'searchTags').primary,'wire-tags');
  assert.deepEqual(plain(model.exactPrimaryQuotationTarget(fields.filter(field=>field.id!=='wire-title'),'title').linked),['title']);
  for(const bad of [[...fields,{...fields[2],id:'duplicate'}],fields.map(field=>field.id==='wire-title'?{...field,hubInput:undefined}:field),fields.map(field=>field.id==='wire-title'?{...field,type:'number'}:field)])assert.throws(()=>model.quotationSeoTargets(bad),/항목/);
  const unrelated=[...fields,{...fields[2],id:'other',hubWire:{path:['legalPage','productName']}}];assert.equal(model.quotationSeoTargets(unrelated).title.primary,'wire-title');
 }finally{h.close();}
});

test('opening and editing selected SEO preserve common content, exact manual blanks, other options and unrelated overrides',async()=>{
 const f=fixture(),before=plain(f.view.overrides),h=seoUI((url,init)=>f.reply(url,init));try{
  await h.idle();assert.equal(h.input('선택 옵션 상품명').props.value,'공통 Hub 상품명');assert.equal(h.calls.filter(call=>call.init?.method==='PUT').length,0);assert.deepEqual(f.view.overrides,before);
  h.input('선택 옵션 상품명').props.onChange({target:{value:'검정 옵션 상품명'}});h.input('선택 옵션 검색태그').props.onChange({target:{value:'검정, 선글라스'}});await h.click('선택 옵션 SEO 저장');
  const put=JSON.parse(h.calls.find(call=>call.init?.method==='PUT').init.body);assert.equal(put.changes.length,4);assert.ok(put.changes.every(change=>change.optionId==='red'));assert.deepEqual(put.changes.map(change=>change.fieldKey),['title','wire-title','searchTags','wire-tags']);
  assert.deepEqual(f.view.overrides.common,before.common);assert.deepEqual(f.view.overrides.options.blue,before.options.blue);assert.equal(f.view.overrides.options.red.unrelated,'보존');
  h.input('선택 옵션 상품명').props.onChange({target:{value:''}});h.input('선택 옵션 검색태그').props.onChange({target:{value:''}});await h.click('선택 옵션 SEO 저장');
  assert.equal(h.input('선택 옵션 상품명').props.value,'');assert.equal(h.input('선택 옵션 검색태그').props.value,'');for(const key of ['title','wire-title','searchTags','wire-tags'])assert.equal(f.view.overrides.options.red[key],'');
  await h.click('상품명 공통·자동값 복원');await h.click('검색태그 공통·자동값 복원');await h.click('선택 옵션 SEO 저장');assert.equal(h.input('선택 옵션 상품명').props.value,'공통 Hub 상품명');assert.equal(h.input('선택 옵션 검색태그').props.value,'공통Hub태그');assert.deepEqual(f.view.overrides.options.red,{unrelated:'보존'});assert.deepEqual(f.view.overrides.common,before.common);
  assert.ok(h.calls.every(call=>call.init?.method==='PUT'||call.init?.cache==='no-store'));
 }finally{h.close();}
});

test('stale save callbacks use the newest synchronous draft and permit only one pending PUT',async()=>{
 const f=fixture(),pending=deferred();let held;
 const h=seoUI((url,init)=>{if(init?.method==='PUT'){held={url,init};return pending.promise;}return f.reply(url,init);});try{
  await h.idle();h.input('선택 옵션 상품명').props.onChange({target:{value:'이전 입력'}});const submit=h.button('선택 옵션 SEO 저장').props.onClick;
  h.input('선택 옵션 상품명').props.onChange({target:{value:'최신 입력'}});submit();submit();
  assert.equal(h.calls.filter(call=>call.init?.method==='PUT').length,1);assert.ok(JSON.parse(held.init.body).changes.every(change=>change.value==='최신 입력'));
  pending.resolve(f.reply(held.url,held.init));await h.idle();assert.equal(h.saved,1);assert.equal(h.input('선택 옵션 상품명').props.value,'최신 입력');
 }finally{h.close();}
});

test('conflicts retain SEO drafts and a conflicting refresh never replaces them without explicit cancellation',async()=>{
 const f=fixture(),h=seoUI((url,init)=>f.reply(url,init));try{
  await h.idle();h.input('선택 옵션 상품명').props.onChange({target:{value:'실패 후 유지할 입력'}});
  f.reply('',{method:'PUT',body:JSON.stringify({expectedRevision:1,changes:[{optionId:'red',fieldKey:'title',value:'다른 저장값'},{optionId:'red',fieldKey:'wire-title',value:'다른 저장값'}]})});
  await h.click('선택 옵션 SEO 저장');assert.equal(h.input('선택 옵션 상품명').props.value,'실패 후 유지할 입력');assert.match(JSON.stringify(h.render()),/동시 수정/);assert.equal(h.saved,0);
  h.source(f.view.productVersion);await h.idle();const writes=h.calls.filter(call=>call.init?.method==='PUT').length;await h.click('입력 유지·최신 SEO 조회');assert.equal(h.input('선택 옵션 상품명').props.value,'실패 후 유지할 입력');assert.match(JSON.stringify(h.render()),/다른 저장값/);assert.equal(h.calls.filter(call=>call.init?.method==='PUT').length,writes);
  await h.click('입력 취소·저장 SEO 다시 조회');assert.equal(h.input('선택 옵션 상품명').props.value,'다른 저장값');assert.equal(h.render().props['data-workspace-dirty'],false);
 }finally{h.close();}
});

test('invalid tags are not truncated and failed reads keep the current draft',async()=>{
 const f=fixture();let offline=false;const h=seoUI((url,init)=>offline&&init?.method!=='PUT'?Response.json({error:'조회 실패'},{status:503}):f.reply(url,init));try{
  await h.idle();h.input('선택 옵션 검색태그').props.onChange({target:{value:'가'.repeat(21)}});assert.equal(h.button('선택 옵션 SEO 저장').props.disabled,true);assert.equal(h.input('선택 옵션 검색태그').props.value,'가'.repeat(21));assert.equal(h.calls.some(call=>call.init?.method==='PUT'),false);
  h.input('선택 옵션 검색태그').props.onChange({target:{value:'유지할태그'}});offline=true;await h.click('입력 유지·최신 SEO 조회');assert.equal(h.input('선택 옵션 검색태그').props.value,'유지할태그');assert.match(JSON.stringify(h.render()),/조회 실패/);
 }finally{h.close();}
});

test('ambiguous bindings and a mismatched successful save response never publish or discard a selected SEO draft',async()=>{
 const bad=fixture();bad.view.resolved.schema.fields.push({...bad.view.resolved.schema.fields[2],id:'duplicate-title'});
 const invalid=seoUI(()=>Response.json(bad.view));try{await invalid.idle();assert.equal(invalid.input('선택 옵션 상품명'),undefined);assert.equal(invalid.button('선택 옵션 SEO 저장').props.disabled,true);assert.match(JSON.stringify(invalid.render()),/연결을 하나로/);assert.equal(invalid.calls.some(call=>call.init?.method==='PUT'),false);}finally{invalid.close();}
 const f=fixture(),h=seoUI((url,init)=>{const response=f.reply(url,init);if(init?.method==='PUT'){const wrong=plain(f.view);wrong.overrides.options.red.title='다른 응답';return Response.json(wrong);}return response;});try{await h.idle();h.input('선택 옵션 상품명').props.onChange({target:{value:'보존할 직접 입력'}});await h.click('선택 옵션 SEO 저장');assert.equal(h.saved,0);assert.equal(h.input('선택 옵션 상품명').props.value,'보존할 직접 입력');assert.equal(h.render().props['data-workspace-dirty'],true);assert.match(JSON.stringify(h.render()),/요청한 값과 다릅니다/);}finally{h.close();}
});

test('same-scope version or refresh changes synchronously reject late writes before effect cleanup and preserve the draft',async()=>{
 for(const change of ['version','refresh']){
  const f=fixture(),pending=deferred();let held;
  const h=seoUI((url,init)=>{if(init?.method==='PUT'){held={url,init};return pending.promise;}return f.reply(url,init);});try{
   await h.idle();h.input('선택 옵션 상품명').props.onChange({target:{value:'유지할 초안'}});h.button('선택 옵션 SEO 저장').props.onClick();
   h.source(change==='version'?nextVersion(initialVersion):initialVersion,change==='refresh'?'1':'0',false);
   assert.equal(held.init.signal.aborted,true,'layout cleanup aborts this request before passive cleanup runs');
   const before=h.saved;pending.resolve(f.reply(held.url,held.init));await new Promise(resolve=>setImmediate(resolve));assert.equal(h.saved,before,'stale source reply cannot publish a save before cleanup');
   h.render();await h.idle();assert.equal(h.input('선택 옵션 상품명').props.value,'유지할 초안');assert.equal(h.render().props['data-workspace-dirty'],true);
   const writes=h.calls.filter(call=>call.init?.method==='PUT').length;h.button('선택 옵션 SEO 저장').props.onClick();await h.idle();assert.equal(h.calls.filter(call=>call.init?.method==='PUT').length,writes,'a changed source must be refreshed before further writes');
  }finally{h.close();}
 }
});

test('save ACK must advance exactly its own quotation and product versions without changing source or binding identity',async()=>{
 const corruptions=[
  ['unchanged quotation revision',body=>body.revision--],['skipped quotation revision',body=>body.revision++],
  ['mismatched updatedAt',body=>body.updatedAt=initialVersion],
  ['unchanged product version',body=>{body.productVersion=initialVersion;body.updatedAt=initialVersion;}],
  ['invalid product version',body=>{body.productVersion='invalid';body.updatedAt='invalid';}],
  ['content revision',body=>body.contentRevision++],['option revision',body=>body.optionRevision++],
  ['owned image keys',body=>body.imageKeys.push('another-owner/image.png')],
  ['category context',body=>body.categoryContext.categoryId='99999'],
  ['primary field constraints',body=>body.resolved.schema.fields.find(field=>field.id==='wire-title').maxLength=499],
 ];
 for(const [name,corrupt] of corruptions){const f=fixture(),h=seoUI((url,init)=>{const response=f.reply(url,init);if(init?.method==='PUT'){const body=plain(f.view);corrupt(body);return Response.json(body);}return response;});try{
  await h.idle();h.input('선택 옵션 상품명').props.onChange({target:{value:'저장 확인 전 유지할 상품명'}});await h.click('선택 옵션 SEO 저장');
  assert.equal(h.saved,0,name);assert.equal(h.input('선택 옵션 상품명').props.value,'저장 확인 전 유지할 상품명',name);assert.equal(h.render().props['data-workspace-dirty'],true,name);assert.match(visibleText(h.render()),/SEO 저장 버전을 확인하지 못했습니다/,name);assert.equal(h.calls.filter(call=>call.init?.method==='PUT').length,1,name);
 }finally{h.close();}}
});

test('an old scope response and captured callbacks cannot edit the newly selected option, and unmount aborts requests',async()=>{
 const f=fixture(),pending=deferred();let hold=false,held;
 const h=seoUI((url,init)=>{if(hold&&init?.method!=='PUT'){hold=false;held={url,init};return pending.promise;}return f.reply(url,init);});try{
  await h.idle();const oldEdit=h.input('선택 옵션 상품명').props.onChange,oldSave=h.button('선택 옵션 SEO 저장').props.onClick;hold=true;h.button('저장 SEO 다시 조회').props.onClick();h.select('blue');await h.idle();assert.equal(held.init.signal.aborted,true);
  const title=h.input('선택 옵션 상품명').props.value;pending.resolve(f.reply(held.url,held.init));await new Promise(resolve=>setImmediate(resolve));oldEdit({target:{value:'이전 옵션 값'}});oldSave();await h.idle();assert.equal(h.input('선택 옵션 상품명').props.value,title);assert.equal(h.calls.some(call=>call.init?.method==='PUT'),false);
 }finally{h.close();}
 const heldRead=deferred(),closing=seoUI(()=>heldRead.promise);await Promise.resolve();const request=closing.calls[0];closing.close();assert.equal(request.init.signal.aborted,true);heldRead.resolve(Response.json(f.view));await new Promise(resolve=>setImmediate(resolve));assert.equal(closing.lateWrites,0);
});

test('draft recovery after a disjoint source update remains read only until the explicit selected-option save',async()=>{
 const f=fixture(),h=seoUI((url,init)=>f.reply(url,init));try{
  await h.idle();h.input('선택 옵션 상품명').props.onChange({target:{value:'유지할 상품명'}});f.view.productVersion=nextVersion(initialVersion);f.view.updatedAt=f.view.productVersion;h.source(f.view.productVersion);await h.idle();
  assert.equal(h.input('선택 옵션 상품명').props.value,'유지할 상품명');await h.click('입력 유지·최신 SEO 조회');assert.equal(h.calls.some(call=>call.init?.method==='PUT'),false);await h.click('선택 옵션 SEO 저장');assert.equal(h.saved,1);assert.equal(f.view.overrides.options.red['wire-title'],'유지할 상품명');
 }finally{h.close();}
});

// Actual selected-option callbacks, native APIs/SQLite, source snapshots, label
// plans and generated XLSX. All source/auth/model/template values are fixtures.
for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`selected SEO reaches only its quotation, label and XLSX row (${company.companyCode})`,async()=>{
 const api=mobileIntakeHarness(company);let h;try{
  const live={format:'supplier-hub-schema-v1',categoryId:'80719',categoryPath:api.context.category.categoryPath,company:{code:company.companyCode,name:company.companyName},observedAt:Date.now(),inputBindings:'couplus-paths-v1',metadata:{kanCategoryId:80719,noticeNumber:1,scopeType:'Retail_Categorized_Single',version:1},schemaString:JSON.stringify({type:'object',properties:{startPage:{type:'object',properties:{productName:{type:'string',title:'상품명',maxLength:500}}},productPage:{type:'object',properties:{searchTags:{type:'string',title:'검색태그',maxLength:150}}},legalPage:{type:'object',properties:{}}}})};
  const schema=api.load('app/quotation-schema.ts').getQuotationSchema('80719',live.categoryPath,live),fields=schema.fields.map(field=>field.id),workbook=quotationWorkbook(fields),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',workbook)).toString('hex'),storageKey=api.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');api.objects.set(storageKey,workbook);
  const profile=await api.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'선택 SEO 연결 시험',categoryId:'80719',categoryPath:live.categoryPath,hubSchema:live,template:{name:'synthetic-option-seo.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  api.context.category=profile;api.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(api.context),'job');await api.intake();
  const product=api.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,qurl=base+'/quotation-fields';let current=await json(await api.route(qurl));
  current=await json(await api.route(qurl,{method:'PUT',body:{expectedRevision:current.revision,expectedInputFingerprint:current.inputFingerprint,changes:[{optionId:null,fieldKey:'title',value:'보존할 공통 상품명'},{optionId:null,fieldKey:'searchTags',value:'공통검색어'}]}}));
  const target=current.resolved.rows.find(row=>row.optionId),other=current.resolved.rows.filter(row=>row.optionId)[1],common=plain(current.overrides.common),otherFields=plain(other.fields),contentBefore=api.sqlite.prepare('SELECT payload FROM product_content').get().payload,optionsBefore=api.sqlite.prepare('SELECT payload FROM product_options').get().payload,policyBefore=api.sqlite.prepare('SELECT payload FROM product_price_policy').get().payload;
  h=seoUI((url,init)=>api.route(url,{method:init?.method??'GET',...(init?.body?{body:JSON.parse(init.body)}:{})}),{productId:product.id,optionId:target.optionId,version:current.productVersion,profileId:profile.id});await h.idle();assert.equal(h.calls.some(call=>call.init?.method==='PUT'),false);
  h.input('선택 옵션 상품명').props.onChange({target:{value:'선택한 검정 선글라스'}});h.input('선택 옵션 검색태그').props.onChange({target:{value:'선글라스, 검정'}});await h.click('선택 옵션 SEO 저장');assert.equal(h.saved,1,JSON.stringify(h.render()));
  current=await json(await api.route(qurl));let selected=current.resolved.rows.find(row=>row.optionId===target.optionId);assert.equal(selected.fields.title.value,'선택한 검정 선글라스');assert.equal(selected.fields.searchTags.value,'선글라스, 검정');assert.equal(selected.fields.title.source,'manual-option');assert.deepEqual(plain(current.overrides.common),common);assert.deepEqual(plain(current.resolved.rows.find(row=>row.optionId===other.optionId).fields),otherFields);
  const plan=api.load('app/quotation-label-plan.ts').quotationLabelPlan(current.resolved,target.optionId);assert.equal(plan.rows.find(row=>row[0]==='상품명')[1],'선택한 검정 선글라스');
  const preview=await json(await api.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}}));assert.equal(preview.rows[0][fields.indexOf('title')],'선택한 검정 선글라스');assert.equal(preview.rows[1][fields.indexOf('title')],'보존할 공통 상품명');assert.equal(preview.rows[0][fields.indexOf('searchTags')],'선글라스, 검정');
  const download=await api.route(base+'/quotation',{method:'POST',body:{action:'download',profileId:profile.id,fingerprint:preview.fingerprint}});assert.equal(download.status,200,await download.clone().text());const reader=api.load('app/xlsx-template.ts'),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(await download.arrayBuffer()));assert.equal(reader.xlsxHeaders(sheet,'견적서',2)[fields.indexOf('title')],'선택한 검정 선글라스');assert.equal(reader.xlsxHeaders(sheet,'견적서',3)[fields.indexOf('title')],'보존할 공통 상품명');
  h.input('선택 옵션 상품명').props.onChange({target:{value:''}});h.input('선택 옵션 검색태그').props.onChange({target:{value:''}});await h.click('선택 옵션 SEO 저장');assert.equal(h.saved,2,JSON.stringify(h.render()));current=await json(await api.route(qurl));selected=current.resolved.rows.find(row=>row.optionId===target.optionId);assert.equal(selected.fields.title.value,'');assert.equal(selected.fields.title.source,'manual-option');assert.equal(api.load('app/quotation-label-plan.ts').quotationLabelPlan(current.resolved,target.optionId).rows.find(row=>row[0]==='상품명')[1],'[공란]');
  const blankPreview=await json(await api.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}}));assert.equal(blankPreview.rows[0][fields.indexOf('title')],'');assert.equal(blankPreview.rows[1][fields.indexOf('title')],'보존할 공통 상품명');
  await h.click('상품명 공통·자동값 복원');await h.click('검색태그 공통·자동값 복원');await h.click('선택 옵션 SEO 저장');current=await json(await api.route(qurl));selected=current.resolved.rows.find(row=>row.optionId===target.optionId);assert.equal(selected.fields.title.value,'보존할 공통 상품명');assert.equal(selected.fields.searchTags.value,'공통검색어');assert.deepEqual(plain(current.overrides.common),common);
  assert.equal(api.sqlite.prepare('SELECT payload FROM product_content').get().payload,contentBefore);assert.equal(api.sqlite.prepare('SELECT payload FROM product_options').get().payload,optionsBefore);assert.equal(api.sqlite.prepare('SELECT payload FROM product_price_policy').get().payload,policyBefore);assert.equal(api.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{h?.close();api.close();}
});
