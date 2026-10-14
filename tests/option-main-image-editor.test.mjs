import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {readPackageZip} from '../extensions/supplier-hub/package.mjs';
const native=createRequire(import.meta.url),plain=value=>JSON.parse(JSON.stringify(value));
const visible=value=>Array.isArray(value)?value.flatMap(visible):value&&typeof value==='object'&&!value.props?.hidden?[value,...visible(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):typeof value==='boolean'?'':String(value??'');
const sameDeps=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
async function fixture(company=schemaCompanies[0],withTemplate=false){
 const backend=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const snapshot={...hubSchemaSnapshot(company),inputBindings:'couplus-paths-v1'},schema=JSON.parse(snapshot.schemaString);schema.properties.imagePage.properties.images={type:'object',properties:{mainImage:{type:'string',title:'대표 이미지',requirement:'필수'}}};snapshot.schemaString=JSON.stringify(schema);
  const fields=backend.load('app/quotation-schema.ts').getQuotationSchema(snapshot.categoryId,schemaPath,snapshot).fields.map(field=>field.id);let template=null,mappings=[];
  if(withTemplate){const bytes=new Uint8Array(quotationWorkbook(fields)),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),storageKey=backend.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');backend.objects.set(storageKey,bytes);template={name:'synthetic-main-editor.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields};mappings=fields.map((field,column)=>({field,column,required:false}));
   const get=backend.bindings.FILES.get;backend.bindings.FILES.get=async(key,options)=>{const object=await get(key),original=backend.objects.get(key);if(!object||!original)return object;const offset=options?.range?.offset??0,end=options?.range?.length===undefined?original.byteLength:offset+options.range.length;return{...object,body:new Response(original.slice(offset,end)).body};};}
  const profile=await backend.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'최종 대표이미지 UI 검수',categoryId:snapshot.categoryId,categoryPath:schemaPath,hubSchema:snapshot,template,mappings});backend.context.category=profile;backend.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(backend.context),'job');await backend.intake();
  const product=plain(backend.sqlite.prepare('SELECT * FROM products').get()),endpoint='/api/products/'+product.id+'/quotation-fields?profileId='+profile.id;let view=await json(await backend.route(endpoint));const ids=view.resolved.rows.flatMap(row=>row.optionId?[row.optionId]:[]),id=ids[0],source=view.imageKeys[0],key=view.imageKeys.find(key=>key!==source),options=await json(await backend.route('/api/products/'+product.id+'/options')),rows=backend.load('app/product-options.ts').optionInputs(options.options);rows.find(row=>row.id===id).imageKey=source;
  await json(await backend.route('/api/products/'+product.id+'/options',{method:'PATCH',body:{expectedRevision:options.options.revision,expectedProductVersion:options.productVersion,rows}}));view=await json(await backend.route(endpoint));assert.equal(JSON.parse(backend.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(product.id).payload).rows.find(row=>row.id===id).imageKey,source);
  await json(await backend.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{optionId:id,fieldKey:'mainImage',value:key}]}}));Object.assign(product,plain(backend.sqlite.prepare('SELECT * FROM products').get()));
  const calls=[];let unavailable=false,lose=false;
  const request=async(url,init={})=>{calls.push({url,method:init.method??'GET',body:init.body?JSON.parse(init.body):undefined});if(unavailable&&(init.method??'GET')==='GET')return Response.json({error:'private read unavailable'},{status:503});const response=await backend.route(url,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})});if(lose&&init.method==='PUT'){assert.equal(response.status,200);lose=false;unavailable=true;throw Error('committed main image ACK lost');}return response;};
  return {backend,profile,product,endpoint,id,source,key,fields,nextKey:view.imageKeys.find(value=>value!==key&&value!==source)??source,calls,request,read:()=>backend.route(endpoint).then(json),lost(){lose=true;},recover(){unavailable=false;},close(){backend.close();}};
 }catch(error){backend.close();throw error;}
}
function editor(f,{wrapper=false,focusedOptionId=f.id,imageView=true,onTranslate,onEdit,imageProcessingBusy=false}={}){
 const contexts=new Map(),cache=new Map(),effects=[],saved=[];let active,seen;
 const props={product:f.product,productId:f.product.id,profileId:f.profile.id,focusedOptionId,imageView,version:f.product.updated_at,onTranslate,onEdit,imageProcessingBusy,disabled:imageProcessingBusy,onSaved(){saved.push(1);props.product.updated_at=f.backend.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(f.product.id).updated_at;props.version=props.product.updated_at;}};
 const hookEffect=(fn,deps)=>{const ctx=active,i=ctx.cursor++,old=ctx.slots[i];if(!old||!sameDeps(old.deps,deps)){ctx.slots[i]={deps,cleanup:old?.cleanup};effects.push({ctx,i,fn});}};
 const react={useState(initial){const ctx=active,i=ctx.cursor++;if(!(i in ctx.slots))ctx.slots[i]=typeof initial==='function'?initial():initial;return[ctx.slots[i],value=>{ctx.slots[i]=typeof value==='function'?value(ctx.slots[i]):value;}];},useRef(initial){const ctx=active,i=ctx.cursor++;return ctx.slots[i]??(ctx.slots[i]={current:initial});},useEffect:hookEffect,useLayoutEffect:hookEffect,useMemo(fn,deps){const ctx=active,i=ctx.cursor++,old=ctx.slots[i];if(!old||!sameDeps(old.deps,deps))ctx.slots[i]={deps,value:fn()};return ctx.slots[i].value;},useCallback(fn,deps){return react.useMemo(()=>fn,deps);}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,Date,URL,AbortController,TextEncoder,TextDecoder,structuredClone,crypto,fetch:f.request,require(name){if(name.endsWith('.css'))return{};if(name==='react')return react;if(name.startsWith('@/'))return name.includes('/components/')?load(name.slice(2)+'.tsx'):f.backend.load(name.slice(2)+'.ts');return native(name);}},{filename:file});return exports;}
 const Component=wrapper?load('app/components/product-options-editor.tsx').ProductOptionsEditor:load('app/components/option-main-image-editor.tsx').OptionMainImageEditor;
 function expand(node,path){if(Array.isArray(node))return node.map((child,i)=>expand(child,path+'/'+i));if(!node||typeof node!=='object')return node;if(typeof node.type==='function'){const id=path+'/'+node.type.name+':'+String(node.key??'');seen.add(id);let ctx=contexts.get(id);if(!ctx){ctx={slots:[],cursor:0};contexts.set(id,ctx);}ctx.cursor=0;const previous=active;active=ctx;const rendered=node.type(node.props);active=previous;return expand(rendered,id);}return{...node,props:{...node.props,children:expand(node.props?.children,path+'/children')}};}
 const render=()=>{seen=new Set();const tree=expand({type:Component,key:'editor',props},'root');for(const[id,ctx]of contexts)if(!seen.has(id)){for(const slot of ctx.slots)slot?.cleanup?.();contexts.delete(id);}while(effects.length){const{ctx,i,fn}=effects.shift();ctx.slots[i].cleanup?.();ctx.slots[i].cleanup=fn();}return tree;};
 const idle=async()=>{for(let i=0;i<16;i++){render();await new Promise(resolve=>setImmediate(resolve));}return render();};
 const button=label=>visible(render()).find(node=>node.type==='button'&&(node.props['aria-label']===label||text(node)===label)),input=label=>visible(render()).find(node=>node.props?.['aria-label']===label);
 return {props,saved,render,idle,button,input,async click(label){const node=button(label);assert.ok(node,label);assert.equal(node.props.disabled,false,label);node.props.onClick();await idle();},close(){for(const ctx of contexts.values())for(const slot of ctx.slots)slot?.cleanup?.();}};
}

test('main translation toolbar uses final quotation A with exact saved binding and blocks stale drafts, focus and stage callbacks',async()=>{
 const f=await fixture(),targets=[];let h;
 try{
  let view=await f.read();const model=f.backend.load('app/quotation-main-image.ts'),binding=model.verifyMainImageView(view);
  const changed=await json(await f.backend.route(f.endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:model.mainImageChanges(view,f.id,f.key)}}));
  Object.assign(f.product,plain(f.backend.sqlite.prepare('SELECT * FROM products').get()));view=changed;
  h=editor(f,{wrapper:true,onTranslate(...args){targets.push(args);}});await h.idle();
  assert.equal(targets.length,0);assert.equal(f.calls.filter(call=>call.method!=='GET').length,0);
  await h.click('최종 대표이미지 중국어 한국어 번역');await h.click('최종 대표이미지 영어 한국어 번역');
  assert.deepEqual(plain(targets[0]),[f.key,'main','zh',{kind:'quotation',profileId:f.profile.id,optionId:f.id,input:'mainImage',fieldKey:binding.primary,slotIndex:0,revision:view.revision,inputFingerprint:view.inputFingerprint,optionRevision:view.optionRevision,value:f.key}]);
  assert.notEqual(targets[0][0],f.source,'translation must use final A rather than source option B');assert.equal(targets[1][2],'en');
  const old=h.button('최종 대표이미지 중국어 한국어 번역').props.onClick,index=view.imageKeys.indexOf(f.nextKey)+1;
  await h.click(`최종 대표이미지 ${index} 선택`);old();await h.idle();assert.equal(targets.length,2);assert.equal(h.button('최종 대표이미지 영어 한국어 번역').props.disabled,true);
  await h.click('선택 취소·저장 대표이미지 조회');const previousStage=h.button('최종 대표이미지 중국어 한국어 번역').props.onClick;
  h.props.imageView=false;await h.idle();previousStage();await h.idle();assert.equal(targets.length,2,'hidden main toolbar cannot start translation');
  h.props.imageView=true;await h.idle();const previousFocus=h.button('최종 대표이미지 중국어 한국어 번역').props.onClick;
  h.props.focusedOptionId=view.resolved.rows.filter(row=>row.optionId)[1].optionId;await h.idle();previousFocus();await h.idle();assert.equal(targets.length,2);
  h.props.focusedOptionId=f.id;await h.idle();const previousClock=h.button('최종 대표이미지 중국어 한국어 번역').props.onClick;
  f.product.updated_at=new Date(Date.parse(f.product.updated_at)+1).toISOString();h.render();previousClock();await h.idle();assert.equal(targets.length,2,'captured clock callback cannot use an older saved proof');
  assert.equal(f.calls.some(call=>call.url.includes('/image-text')),false);assert.equal(f.calls.filter(call=>call.method!=='GET').length,0);
 }finally{h?.close();f.close();}
});

test('main manual editing uses its exact final slot and live lock blocks retained edit/blank/save/translation callbacks',async()=>{
 const f=await fixture(),targets=[];let h;
 try{const view=await f.read(),binding=f.backend.load('app/quotation-main-image.ts').verifyMainImageView(view);h=editor(f,{wrapper:true,onEdit(...args){targets.push(args);},onTranslate(...args){targets.push(args);}});await h.idle();
  await h.click('최종 대표이미지 편집하기');assert.deepEqual(plain(targets[0]),[f.key,'main',{kind:'quotation',profileId:f.profile.id,optionId:f.id,input:'mainImage',fieldKey:binding.primary,slotIndex:0,revision:view.revision,inputFingerprint:view.inputFingerprint,optionRevision:view.optionRevision,value:f.key}]);
  const manual=h.button('최종 대표이미지 편집하기').props.onClick,translate=h.button('최종 대표이미지 중국어 한국어 번역').props.onClick,blank=h.button('최종 대표이미지 비우기').props.onClick,candidate=h.button(`최종 대표이미지 ${view.imageKeys.indexOf(f.nextKey)+1} 선택`).props.onClick;
  h.props.imageProcessingBusy=true;await h.idle();manual();translate();blank();candidate();await h.idle();assert.equal(targets.length,1);assert.equal(h.button('최종 대표이미지 편집하기').props.disabled,true);assert.equal(h.button('최종 견적 대표이미지 저장').props.disabled,true);assert.equal(f.calls.filter(call=>call.method!=='GET').length,0);
  h.props.imageProcessingBusy=false;await h.idle();candidate();await h.idle();manual();assert.equal(targets.length,1);const save=h.button('최종 견적 대표이미지 저장').props.onClick;
  h.props.imageProcessingBusy=true;await h.idle();save();await h.idle();assert.equal(f.calls.filter(call=>call.method!=='GET').length,0);assert.equal(h.button('최종 견적 대표이미지 저장').props.disabled,true);
  h.props.imageProcessingBusy=false;await h.idle();await h.click('선택 취소·저장 대표이미지 조회');h.props.imageView=false;await h.idle();manual();assert.equal(targets.length,1);
 }finally{h?.close();f.close();}
});

test('a manual final main-image blank offers no translation target and never falls back to raw source',async()=>{
 const f=await fixture(),targets=[],h=editor(f,{wrapper:true,onTranslate(...args){targets.push(args);}});
 try{await h.idle();const old=h.button('최종 대표이미지 중국어 한국어 번역').props.onClick;
  await h.click('최종 대표이미지 비우기');old();await h.idle();assert.equal(targets.length,0);assert.equal(h.button('최종 대표이미지 영어 한국어 번역'),undefined);
  await h.click('최종 견적 대표이미지 저장');assert.equal((await f.read()).resolved.rows.find(row=>row.optionId===f.id).fields.mainImage.value,'');
  assert.equal(targets.length,0);assert.equal(h.button('최종 대표이미지 중국어 한국어 번역'),undefined);assert.equal(f.calls.some(call=>call.url.includes('/image-text')),false);
 }finally{h.close();f.close();}
});

test('focused main editing keeps one SKU while unfocused global editing can select and save another SKU',async()=>{
 const f=await fixture(),h=editor(f);try{
  await h.idle();const initial=await f.read(),other=initial.resolved.rows.filter(row=>row.optionId)[1].optionId,selector=h.input('최종 대표이미지 옵션');
  assert.equal(selector.props.disabled,true);assert.deepEqual(visible(selector).filter(node=>node.type==='option').map(node=>node.props.value),['',f.id]);
  selector.props.onChange({target:{value:other}});await h.idle();assert.equal(h.input('최종 대표이미지 옵션').props.value,f.id,'programmatic disabled selector callbacks cannot change the focused row');
  assert.equal(f.calls.filter(call=>call.method!=='GET').length,0);
  h.props.focusedOptionId=undefined;await h.idle();assert.equal(h.input('최종 대표이미지 옵션').props.disabled,false);
  h.input('최종 대표이미지 옵션').props.onChange({target:{value:other}});await h.idle();assert.equal(h.input('최종 대표이미지 옵션').props.value,other);
  assert.equal(h.button('최종 대표이미지 중국어 한국어 번역'),undefined,'global editing does not display a translation callback without focused context');
  await h.click('최종 대표이미지 비우기');await h.click('최종 견적 대표이미지 저장');const saved=await f.read();
  assert.equal(saved.resolved.rows.find(row=>row.optionId===other).fields.mainImage.value,'');
  assert.equal(saved.resolved.rows.find(row=>row.optionId===f.id).fields.mainImage.value,initial.resolved.rows.find(row=>row.optionId===f.id).fields.mainImage.value);
  assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);assert.equal(f.calls.filter(call=>call.method==='PATCH').length,0);
 }finally{h.close();f.close();}
});

test('stage three edits final quotation A rather than source B; hidden normal drafts survive stage navigation and image-only product clocks',async()=>{
 const f=await fixture(),h=editor(f,{wrapper:true,imageView:false});try{
  await h.idle();assert.ok(f.calls.every(call=>call.url.endsWith('/options')));const fields=f.backend.load('app/product-options.ts').optionFieldNames,name='옵션 1 '+fields.originalName,cost='옵션 1 '+fields.unitCostCny;
  h.input(name).props.onChange({target:{value:'저장 전 옵션 원문 편집'}});h.input(cost).props.onChange({target:{value:'12.5',valueAsNumber:12.5}});h.render();const sourceTables=JSON.stringify(['product_options','product_content','product_price_policy'].map(table=>f.backend.sqlite.prepare('SELECT * FROM '+table+' WHERE product_id=?').get(f.product.id))),files=[...f.backend.objects.keys()];
  h.props.imageView=true;await h.idle();const selected=()=>visible(h.render()).filter(node=>node.type==='img'&&node.props.alt==='최종 견적 대표이미지');assert.equal(selected()[0].props.src,'/api/files/'+f.key);assert.notEqual(f.source,f.key);assert.equal(h.input('옵션 1 포장 무게 g'),undefined);assert.equal(f.calls.filter(call=>call.method!=='GET').length,0);
  const view=await f.read(),index=view.imageKeys.indexOf(f.nextKey)+1;await h.click(`최종 대표이미지 ${index} 선택`);assert.equal(selected()[0].props.src,'/api/files/'+f.nextKey);await h.click('최종 견적 대표이미지 저장');assert.equal(h.saved.length,1);assert.equal((await f.read()).resolved.rows.find(row=>row.optionId===f.id).fields.mainImage.value,f.nextKey);assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);assert.equal(f.calls.filter(call=>call.method==='PATCH').length,0);
  h.props.imageView=false;await h.idle();assert.equal(h.input(name).props.value,'저장 전 옵션 원문 편집');assert.equal(h.input(cost).props.value,12.5);assert.match(text(h.render()),/옵션 입력은 유지했습니다/);assert.equal(JSON.stringify(['product_options','product_content','product_price_policy'].map(table=>f.backend.sqlite.prepare('SELECT * FROM '+table+' WHERE product_id=?').get(f.product.id))),sourceTables);assert.deepEqual([...f.backend.objects.keys()],files);assert.equal(h.saved.length,1,'hidden normal editor only reads and never reports a save');
  h.props.imageView=true;await h.idle();await h.click('최종 대표이미지 비우기');await h.click('최종 견적 대표이미지 저장');assert.equal(visible(h.render()).filter(node=>node.type==='img'&&node.props.alt==='최종 견적 대표이미지').length,0);assert.match(text(h.render()),/최종 대표이미지는 공란/);assert.equal((await f.read()).resolved.rows.find(row=>row.optionId===f.id).fields.mainImage.value,'');
 }finally{h.close();f.close();}
});

test('unknown committed final-image save keeps its exact choice and explicit retry confirms with no second PUT',async()=>{
 const f=await fixture(),h=editor(f);try{
  await h.idle();const index=(await f.read()).imageKeys.indexOf(f.nextKey)+1;await h.click(`최종 대표이미지 ${index} 선택`);f.lost();await h.click('최종 견적 대표이미지 저장');assert.equal(h.saved.length,0);assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(h.button('최종 대표이미지 비우기').props.disabled,true);assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);
  f.recover();await h.click('대표이미지 저장 결과 확인·재시도');assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);assert.equal(h.saved.length,1);assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal((await f.read()).resolved.rows.find(row=>row.optionId===f.id).fields.mainImage.value,f.nextKey);
 }finally{h.close();f.close();}
});

test('missing focus does not select another SKU and retained callbacks cannot save into a changed option scope',async()=>{
 const f=await fixture(),missing=editor(f,{focusedOptionId:'missing'});try{await missing.idle();assert.match(text(missing.render()),/현재 견적서에 없습니다/);assert.equal(missing.button('최종 대표이미지 1 선택').props.disabled,true);assert.equal(f.calls.filter(call=>call.method!=='GET').length,0);}finally{missing.close();}
 const h=editor(f);try{await h.idle();await h.click('최종 대표이미지 비우기');const old=h.button('최종 견적 대표이미지 저장').props.onClick;h.props.focusedOptionId=(await f.read()).resolved.rows.filter(row=>row.optionId)[1].optionId;await h.idle();old();await h.idle();assert.equal(f.calls.filter(call=>call.method!=='GET').length,0);assert.equal((await f.read()).resolved.rows.find(row=>row.optionId===f.id).fields.mainImage.value,f.key);assert.equal(h.render().props['data-workspace-dirty'],false);}finally{h.close();f.close();}
});

for(const company of schemaCompanies)test(`a captured global main-image candidate cannot edit the previous SKU after selection changes; current choice/blank/reset reach exact XLSX and ZIP (${company.code})`,async()=>{
 const f=await fixture(company,true),h=editor(f,{focusedOptionId:undefined});try{
  h.props.focusedOptionId=undefined;await h.idle();const before=await f.read(),other=before.resolved.rows.filter(row=>row.optionId)[1].optionId,index=before.imageKeys.indexOf(f.nextKey)+1,oldCandidate=h.button(`최종 대표이미지 ${index} 선택`).props.onClick,oldSave=h.button('최종 견적 대표이미지 저장').props.onClick,oldCancel=h.button('최종 대표이미지 저장본 조회').props.onClick;
  const source=JSON.stringify(['product_content','product_options','product_price_policy'].map(table=>f.backend.sqlite.prepare('SELECT * FROM '+table+' WHERE product_id=?').get(f.product.id))),bytes=[...f.backend.objects].map(([key,value])=>[key,Buffer.from(value).toString('hex')]);
  h.input('최종 대표이미지 옵션').props.onChange({target:{value:other}});await h.idle();assert.equal(h.input('최종 대표이미지 옵션').props.value,other);
  oldCandidate();await h.idle();if(h.render().props['data-workspace-dirty'])await h.click('최종 견적 대표이미지 저장');
  const protectedView=await f.read();assert.deepEqual(plain(protectedView),plain(before),'the stale A callback must neither create a hidden A draft nor send an A PUT from the B screen');assert.equal(f.calls.filter(call=>call.method==='PUT').length,0);
  const sourceBefore=plain(protectedView.overrides),currentSelector=h.input('최종 대표이미지 옵션').props.onChange;await h.click(`최종 대표이미지 ${index} 선택`);oldCancel();oldSave();currentSelector({target:{value:f.id}});await h.idle();assert.equal(h.input('최종 대표이미지 옵션').props.value,other);assert.equal(h.render().props['data-workspace-dirty'],true,'stale A cancel cannot clear B selection, and a clean selector callback cannot bypass the newly dirty B draft');assert.equal(f.calls.filter(call=>call.method==='PUT').length,0);
  await h.click('최종 견적 대표이미지 저장');let current=await f.read();assert.equal(current.resolved.rows.find(row=>row.optionId===other).fields.mainImage.value,f.nextKey);assert.equal(current.resolved.rows.find(row=>row.optionId===f.id).fields.mainImage.value,f.key);assert.deepEqual(plain(current.overrides.common),sourceBefore.common);assert.deepEqual(plain(current.overrides.options[f.id]),sourceBefore.options[f.id]);
  const exportSaved=async()=>{const preview=await json(await f.backend.route('/api/products/'+f.product.id+'/quotation',{method:'POST',body:{action:'preview',profileId:f.profile.id}})),response=await f.backend.route('/api/products/'+f.product.id+'/quotation',{method:'POST',body:{action:'export',profileId:f.profile.id,fingerprint:preview.fingerprint}});assert.equal(response.status,200,await response.clone().text());const zip=readPackageZip(new Uint8Array(await response.arrayBuffer())),document=JSON.parse(new TextDecoder().decode(zip.get('quotation-fields.json'))),plan=JSON.parse(new TextDecoder().decode(zip.get('supplier-hub-upload-plan.json'))),workbook=zip.get(plan.quotation.file.filename),reader=f.backend.load('app/xlsx-template.ts'),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(workbook.buffer.slice(workbook.byteOffset,workbook.byteOffset+workbook.byteLength)));return{zip,document,plan,reader,sheet};};
  let exported=await exportSaved(),rowIndex=exported.document.rows.findIndex(row=>row.optionId===other);assert.equal(exported.plan.company.code,company.code);assert.equal(exported.reader.xlsxHeaders(exported.sheet,'견적서',rowIndex+2)[f.fields.indexOf('mainImage')],exported.document.uploadFilenames[f.nextKey]);const image=exported.plan.productImages.find(image=>image.key===f.nextKey);assert.ok(image.references.some(ref=>ref.optionId===other&&ref.fieldId==='mainImage'));assert.ok(!image.references.some(ref=>ref.optionId===f.id&&ref.fieldId==='mainImage'));assert.deepEqual(Buffer.from(exported.zip.get(image.archivePath)),Buffer.from(f.backend.objects.get(f.nextKey)));
  await h.click('최종 대표이미지 비우기');await h.click('최종 견적 대표이미지 저장');current=await f.read();assert.equal(current.resolved.rows.find(row=>row.optionId===other).fields.mainImage.value,'');exported=await exportSaved();assert.equal(exported.reader.xlsxHeaders(exported.sheet,'견적서',rowIndex+2)[f.fields.indexOf('mainImage')],'');assert.ok(exported.plan.productImages.every(image=>!image.references.some(ref=>ref.optionId===other&&ref.fieldId==='mainImage')));
  await h.click('공통·원본 대표이미지 복원');await h.click('최종 견적 대표이미지 저장');current=await f.read();assert.equal(current.resolved.rows.find(row=>row.optionId===other).fields.mainImage.value,current.automatic.rows.find(row=>row.optionId===other).fields.mainImage.value);assert.equal(Object.hasOwn(current.overrides.options[other]??{},'mainImage'),false);exported=await exportSaved();const restored=current.resolved.rows.find(row=>row.optionId===other).fields.mainImage.value;assert.equal(exported.reader.xlsxHeaders(exported.sheet,'견적서',rowIndex+2)[f.fields.indexOf('mainImage')],restored?exported.document.uploadFilenames[restored]:'');
  assert.equal(JSON.stringify(['product_content','product_options','product_price_policy'].map(table=>f.backend.sqlite.prepare('SELECT * FROM '+table+' WHERE product_id=?').get(f.product.id))),source);assert.deepEqual([...f.backend.objects].map(([key,value])=>[key,Buffer.from(value).toString('hex')]),bytes);assert.equal(f.backend.sqlite.prepare('SELECT supplier_hub_status FROM products WHERE id=?').get(f.product.id).supplier_hub_status,'미전송');assert.ok(!f.backend.network.some(host=>/supplier\.coupang|couplus/.test(host)));
 }finally{h.close();f.close();}
});
