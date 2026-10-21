import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {bannerFixture,bannerCompanies as companies,bannerJson} from './helpers/captured-settings-banners.mjs';

const native=createRequire(import.meta.url),plain=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
const target=(kind='div')=>({isContentEditable:kind==='contenteditable',closest(selector){return ['input','textarea','select','contenteditable','textbox','combobox','spinbutton'].includes(kind)&&selector?this:null;}});
const protectionProof=[];
function transfer(){const values=new Map();return {get types(){return [...values.keys()];},setData(key,value){values.set(key,value);},getData(key){return values.get(key)??'';},clearData(){values.clear();},effectAllowed:'none',dropEffect:'none'};}
function dragEvent(dataTransfer){return {dataTransfer,currentTarget:{},defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};}
function keyEvent(overrides={}){return {key:'Delete',target:target(),defaultPrevented:false,isComposing:false,altKey:false,ctrlKey:false,metaKey:false,shiftKey:false,stopped:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...overrides};}

/** Actual component and real quote API are retained. Only the React scheduler,
 * document event target, authenticated identity and recorded supplier are fixtures. */
function keyboardUI(fetcher,initial){
 const slots=[],effects=[],layouts=[],cache=new Map(),listeners=new Set(),calls=[],props={stage:'detail',active:true,disabled:false,...initial};let cursor=0,epoch=0,closed=false,saved=0;
 const document={activeElement:null,addEventListener(type,listener){assert.equal(type,'keydown');listeners.add(listener);},removeEventListener(type,listener){assert.equal(type,'keydown');listeners.delete(listener);}};
 const effect=(queue,fn,deps)=>{const index=cursor++,old=slots[index];if(deps===undefined||!old||!same(old.deps,deps)){const slot={deps,cleanup:old?.cleanup};slots[index]=slot;queue.push(()=>{old?.cleanup?.();slot.cleanup=fn();});}};
 const react={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],value=>{assert.equal(closed,false,'no state updates after unmount');epoch++;slots[index]=typeof value==='function'?value(slots[index]):value;}];},useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useEffect(fn,deps){effect(effects,fn,deps);},useLayoutEffect(fn,deps){effect(layouts,fn,deps);}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,document,window:{confirm:message=>props.confirmImage?.(message)??true},Error,AbortController,structuredClone,TextEncoder,crypto,fetch:async(url,init={})=>{calls.push({url,method:init.method??'GET',body:init.body?JSON.parse(init.body):undefined});const response=await fetcher(url,init);if(response.ok){const body=await response.clone().json();if(init.method==='PUT')props.version=body.productVersion;}return response;},require(name){if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};if(name.startsWith('./')||name.startsWith('../'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');return name.startsWith('@/')?load(name.slice(2)+(name.includes('/components/')?'.tsx':'.ts')):native(name);}},{filename:file});return exports;}
 const Component=load('app/components/option-image-editor.tsx').OptionImageEditor;
 function render(){cursor=0;const tree=Component({...props,onSaved(){saved++;epoch++;}});layouts.splice(0).forEach(fn=>fn());effects.splice(0).forEach(fn=>fn());return tree;}
 async function idle(){let quiet=0;for(let i=0;i<300;i++){const before=epoch,count=calls.length;render();await new Promise(resolve=>setImmediate(resolve));const tree=render();if(before===epoch&&count===calls.length&&!tree.props['data-workspace-saving'])quiet++;else quiet=0;if(quiet===2)return tree;}throw Error('keyboard component did not settle');}
 const button=label=>nodes(render()).find(node=>node.type==='button'&&(node.props['aria-label']===label||text(node)===label));
 const card=key=>nodes(render()).find(node=>node.type==='figure'&&node.props['data-image-sort-key']===key);
 return{props,calls,document,listeners,render,idle,button,card,get saved(){return saved;},order(){return nodes(render()).filter(node=>node.type==='figure'&&node.props['data-image-sort-key']).map(node=>node.props['data-image-sort-key']);},hover(key){const figure=card(key);assert.ok(figure?.props.onMouseEnter,'selected detail image has hover wiring');figure.props.onMouseEnter();return figure;},press(event=keyEvent()){for(const handler of [...listeners])handler(event);return event;},async click(label){const control=button(label);assert.ok(control&&!control.props.disabled,label);control.props.onClick();await idle();},html(value){nodes(render()).find(node=>node.type==='textarea'&&node.props['aria-label']==='선택 옵션 상세 HTML').props.onChange({target:{value}});},close(){slots.forEach(slot=>slot?.cleanup?.());closed=true;}};
}
async function fixture(company){
 const f=await bannerFixture(company);try{
  const product=f.product(),endpoint='/api/products/'+product.id+'/quotation-fields',read=()=>f.h.route(endpoint).then(bannerJson);let view=await read();const id=view.resolved.rows.find(row=>row.optionId).optionId,other=view.resolved.rows.find(row=>row.optionId&&row.optionId!==id).optionId;
  const body=view.imageKeys.filter(key=>![f.top,f.bottom].includes(key)).slice(0,3);assert.equal(body.length,3);const keys=[f.top,...body,f.bottom],html='<p>검토 중인 수동 HTML &amp; 원문</p>';
  const changes=f.h.load('app/quotation-image-targets.ts').optionImageChanges(view,id,{detailImages:keys.join('\n'),detailHtml:html});view=await bannerJson(await f.h.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));
  const snapshot=()=>JSON.stringify({tables:['products','product_content','product_options','product_price_policy','product_quotation_fields','collection_jobs','collection_context','collection_results'].map(table=>[table,f.h.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]),objects:[...f.h.objects].map(([key,bytes])=>[key,Buffer.from(bytes).toString('base64')])});
  const props={productId:product.id,optionId:id,version:view.productVersion,stage:'detail'};
  const request=(url,init={})=>f.h.route(url,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})});
  return{...f,endpoint,read,id,other,body,keys,html,props,snapshot,request};
 }catch(error){f.close();throw error;}
}

for(const company of companies){
 test(`settings cards cannot remove, move, drag, translate or edit banners while body edits still save (${company.code})`,async()=>{
  const f=await fixture(company),translated=[],edited=[],h=keyboardUI(f.request,{...f.props,onTranslate:(...args)=>translated.push(args),onEdit:(...args)=>edited.push(args)});try{
   await h.idle();const before=await f.read(),frozen=f.snapshot(),reads=h.calls.length;
   for(const index of [1,f.keys.length]){
    const key=f.keys[index-1];assert.equal(h.card(key).props.draggable,false);
    for(const suffix of ['선택 제거','위로 이동','아래로 이동','중국어 한국어 번역','영어 한국어 번역','편집하기']){const button=h.button(`상세 이미지 ${index} ${suffix}`);assert.ok(button?.props.disabled,suffix);button.props.onClick();}
    const candidate=nodes(h.render()).find(node=>node.type==='input'&&node.props['aria-label']===`선택 옵션 상세 이미지 후보 ${before.imageKeys.indexOf(key)+1}`);assert.ok(candidate?.props.disabled);candidate.props.onChange();
    const event=dragEvent(transfer());h.card(key).props.onDragStart(event);assert.equal(event.defaultPrevented,true);
   }
   const boundary=h.button('상세 이미지 2 위로 이동');assert.ok(boundary.props.disabled);boundary.props.onClick();
   const data=transfer();h.card(f.body[1]).props.onDragStart(dragEvent(data));h.card(f.top).props.onDrop(dragEvent(data));h.card(f.body[1]).props.onDragEnd(dragEvent(data));
   await h.idle();assert.deepEqual(h.order(),f.keys);assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(h.calls.length,reads);assert.deepEqual(translated,[]);assert.deepEqual(edited,[]);assert.equal(f.snapshot(),frozen);
   await h.click('상세 이미지 3 중국어 한국어 번역');await h.click('상세 이미지 3 영어 한국어 번역');await h.click('상세 이미지 3 편집하기');
   assert.deepEqual(translated.map(args=>[args[0],args[1],args[2],args[3].slotIndex]),[[f.body[1],'detail','zh',2],[f.body[1],'detail','en',2]]);assert.equal(edited[0][0],f.body[1]);assert.equal(edited[0][2].slotIndex,2);
   await h.click('상세 이미지 3 위로 이동');assert.deepEqual(h.order(),[f.top,f.body[1],f.body[0],f.body[2],f.bottom]);await h.click('상세 이미지 4 선택 제거');await h.click('선택 옵션 이미지 저장');
   const after=await f.read(),own=after.resolved.rows.find(row=>row.optionId===f.id);assert.deepEqual(own.fields.detailImages.value.split('\n'),[f.top,f.body[1],f.body[0],f.bottom]);assert.equal(own.fields.detailHtml.value,f.html);assert.deepEqual(plain(after.overrides.common),plain(before.overrides.common));assert.deepEqual(plain(after.overrides.options[f.other]),plain(before.overrides.options[f.other]));assert.equal(h.calls.filter(call=>call.method==='PUT').length,1);
   protectionProof.push({kind:'cards-and-body-save',company,bannerCallbacksBlocked:true,bodyTranslationTargets:translated.length,bodyEditTargets:edited.length,explicitWrites:1,htmlAndOtherScopesPreserved:true});
  }finally{h.close();f.close();}
 });
 test(`body clear retains settings and captured card callbacks cannot survive hidden/source scope ABA (${company.code})`,async()=>{
  const f=await fixture(company),translated=[],edited=[],h=keyboardUI(f.request,{...f.props,onTranslate:(...args)=>translated.push(args),onEdit:(...args)=>edited.push(args)});try{
   await h.idle();const frozen=f.snapshot();
   for(const [field,value]of [['active',false],['stage','additional'],['version',new Date(Date.parse(f.props.version)+1).toISOString()],['refreshToken','another-source'],['profileId','foreign-profile'],['optionId',f.other],['disabled',true]]){
    const controls=['선택 제거','위로 이동','중국어 한국어 번역','영어 한국어 번역','편집하기'].map(suffix=>h.button(`상세 이미지 3 ${suffix}`)),old=h.card(f.body[1]),previous=h.props[field];
    h.props[field]=value;h.render();for(const control of controls)control.props.onClick();old.props.onDragStart(dragEvent(transfer()));h.props[field]=previous;h.render();await h.idle();for(const control of controls)control.props.onClick();old.props.onDragStart(dragEvent(transfer()));await h.idle();
    assert.deepEqual(h.order(),f.keys,field);assert.equal(h.render().props['data-workspace-dirty'],false,field);
   }
   assert.deepEqual(translated,[]);assert.deepEqual(edited,[]);assert.equal(f.snapshot(),frozen);await h.click('본문 이미지 선택 비우기');assert.deepEqual(h.order(),[f.top,f.bottom]);assert.equal(f.snapshot(),frozen);await h.click('선택 옵션 이미지 저장');
   const after=await f.read();assert.deepEqual(after.resolved.rows.find(row=>row.optionId===f.id).fields.detailImages.value.split('\n'),[f.top,f.bottom]);assert.equal(after.resolved.rows.find(row=>row.optionId===f.id).fields.detailHtml.value,f.html);
   protectionProof.push({kind:'clear-and-stale-callbacks',company,staleScopes:7,bodyClearedWithBannersRetained:true,explicitWrites:1});
  }finally{h.close();f.close();}
 });
 test(`missing role proof blocks detail card edits but additional image controls keep their original behavior (${company.code})`,async()=>{
  const f=await fixture(company);try{
   for(const metadata of [undefined,['foreign/file.png'],[f.top,f.top],'not-an-array']){
    const h=keyboardUI(async(url,init)=>{const response=await f.request(url,init),body=await response.json();if(metadata===undefined)delete body.protectedDetailImageKeys;else body.protectedDetailImageKeys=metadata;return Response.json(body,{status:response.status});},{...f.props,onTranslate:()=>assert.fail('unknown banner proof must not translate'),onEdit:()=>assert.fail('unknown banner proof must not edit')});try{
     await h.idle();const frozen=f.snapshot();for(const suffix of ['선택 제거','위로 이동','중국어 한국어 번역','편집하기']){const control=h.button(`상세 이미지 3 ${suffix}`);assert.ok(control.props.disabled);control.props.onClick();}assert.equal(h.card(f.body[1]).props.draggable,false);await h.idle();assert.deepEqual(h.order(),f.keys);assert.equal(h.render().props['data-workspace-dirty'],false);h.html('<p>HTML 직접 입력은 유지</p>');await h.idle();assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(f.snapshot(),frozen);
    }finally{h.close();}
   }
   const before=await f.read(),model=f.h.load('app/quotation-image-targets.ts'),changes=model.optionImageChanges(before,f.id,{additionalImages:f.keys.join('\n')});const after=await bannerJson(await f.h.route(f.endpoint,{method:'PUT',body:{expectedRevision:before.revision,expectedInputFingerprint:before.inputFingerprint,changes}}));
   const translated=[],h=keyboardUI(f.request,{...f.props,version:after.productVersion,stage:'additional',onTranslate:(...args)=>translated.push(args)});try{
    await h.idle();assert.equal(h.card(f.top).props.draggable,true);await h.click('추가 이미지 1 중국어 한국어 번역');assert.equal(translated[0][0],f.top);await h.click('추가 이미지 1 선택 제거');assert.deepEqual(h.order(),f.keys.slice(1));
   }finally{h.close();}
   protectionProof.push({kind:'unknown-proof-and-additional-scope',company,unknownProofVariants:4,additionalBannerKeyEditable:true,automaticWrites:0});
  }finally{f.close();}
 });
 test(`detail image endpoint rejects protected source and forged translate/apply while allowing body and additional proofs (${company.code})`,async()=>{
  const f=await fixture(company);try{
   let view=await f.read();const imageTargets=f.h.load('app/quotation-image-targets.ts'),changes=imageTargets.optionImageChanges(view,f.id,{additionalImages:f.keys.join('\n')});await bannerJson(await f.h.route(f.endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));view=await f.read();
   // Intake fixtures append an identity byte after IEND for pool tests. This
   // image API case instead uses a complete, unmodified synthetic PNG file.
   const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64');for(const key of view.imageKeys)f.h.objects.set(key,new Uint8Array(png));
   const route=f.h.load('app/api/products/[id]/image-text/route.ts'),id=f.product().id,base=`/api/products/${id}/image-text`,context={params:Promise.resolve({id})},statuses=[];
   async function source(key,input,slotIndex,editor){const target=f.h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(view.resolved.schema.fields,input),query=new URLSearchParams({sourceKey:key,role:input==='detailImages'?'detail':'additional',target:'quotation',optionId:f.id,fieldKey:target.primary,slotIndex:String(slotIndex),...(editor?{editor}:{})});const response=await route.GET(new Request('https://app.test'+base+'?'+query),context);statuses.push(response.status);return response;}
   const frozen=f.snapshot(),requests=f.h.network.length;
   const body=await bannerJson(await source(f.body[0],'detailImages',1));assert.equal(body.source.sourceKey,f.body[0]);await bannerJson(await source(f.top,'additionalImages',0));
   for(const [key,slot]of [[f.top,0],[f.bottom,f.keys.length-1]])for(const editor of [undefined,'saved','saved-current-target-v1']){const reply=await bannerJson(await source(key,'detailImages',slot,editor),409);assert.match(reply.error,/설정 이미지/);}
   const forged={...body.source,sourceKey:f.top,sourceSha256:createHash('sha256').update(f.h.objects.get(f.top)).digest('hex'),quotationTarget:{...body.source.quotationTarget,slotIndex:0}};
   const translated=await route.POST(new Request('https://app.test'+base,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'translate',source:forged,sourceLanguage:'zh',regions:[{id:'r1',text:'中文'}]})}),context);statuses.push(translated.status);assert.match((await bannerJson(translated,409)).error,/설정 이미지/);
   const form=new FormData();form.set('action','apply');form.set('source',JSON.stringify(forged));form.set('file',new File([f.h.objects.get(f.top)],'result.png',{type:'image/png'}));const applied=await route.POST(new Request('https://app.test'+base,{method:'POST',body:form}),context);statuses.push(applied.status);assert.match((await bannerJson(applied,409)).error,/설정 이미지/);
   assert.equal(f.snapshot(),frozen);assert.equal(f.h.network.length,requests);assert.equal(f.h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
   protectionProof.push({kind:'actual-local-image-api',company,statuses,providerCalls:0,productFilesAndQuotationUnchanged:true});
  }finally{f.close();}
 });
 test(`Delete removes only the hovered content image locally; explicit save preserves HTML, banners and other scopes (${company.code})`,async()=>{
  const f=await fixture(company),h=keyboardUI(f.request,f.props);try{
   await h.idle();const before=await f.read(),frozen=f.snapshot(),calls=h.calls.length;assert.deepEqual(plain(before.protectedDetailImageKeys),[f.top,f.bottom]);
   h.hover(f.body[1]);const event=h.press();await h.idle();assert.equal(event.defaultPrevented,true);assert.equal(event.stopped,true);assert.deepEqual(h.order(),f.keys.filter(key=>key!==f.body[1]));assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(h.calls.length,calls);assert.equal(h.saved,0);assert.equal(f.snapshot(),frozen);assert.deepEqual(plain(await f.read()),plain(before));
   h.press();await h.idle();assert.deepEqual(h.order(),f.keys.filter(key=>key!==f.body[1]),'held Delete cannot erase the next image');
   await h.click('선택 옵션 이미지 저장');const after=await f.read(),own=after.resolved.rows.find(row=>row.optionId===f.id);assert.equal(h.saved,1);assert.equal(h.calls.filter(call=>call.method==='PUT').length,1);assert.deepEqual(own.fields.detailImages.value.split('\n'),f.keys.filter(key=>key!==f.body[1]));assert.equal(own.fields.detailHtml.value,f.html);assert.deepEqual(plain(after.overrides.common),plain(before.overrides.common));assert.deepEqual(plain(after.overrides.options[f.other]),plain(before.overrides.options[f.other]));assert.equal(f.h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
  }finally{h.close();f.close();}
 });
 test(`single detail button and hovered Delete share confirmation; cancelling preserves clean and dirty inputs (${company.code})`,async()=>{
  const f=await fixture(company),prompts=[],h=keyboardUI(f.request,{...f.props,confirmImage:message=>{prompts.push(message);return false;}});try{
   await h.idle();const before=f.snapshot(),reads=h.calls.length;
   for(const dirty of [false,true]){
    if(dirty){h.html('');await h.idle();}
    const order=h.order();await h.click('상세 이미지 3 선택 제거');h.hover(f.body[1]);const event=h.press();await h.idle();
    assert.equal(event.defaultPrevented,false);assert.deepEqual(h.order(),order);assert.equal(h.render().props['data-workspace-dirty'],dirty);
    if(dirty)assert.equal(nodes(h.render()).find(node=>node.type==='textarea').props.value,'');
    assert.equal(h.calls.length,reads);assert.equal(h.saved,0);assert.equal(f.snapshot(),before);
   }
   assert.deepEqual(prompts,Array(4).fill('이 이미지를 삭제하시겠습니까?'));
   h.props.confirmImage=message=>{prompts.push(message);return true;};h.hover(f.body[1]);assert.equal(h.press().defaultPrevented,true);await h.idle();
   assert.deepEqual(h.order(),f.keys.filter(key=>key!==f.body[1]));assert.equal(h.calls.length,reads);assert.equal(f.snapshot(),before);
   assert.equal(nodes(h.render()).find(node=>node.type==='textarea').props.value,'','confirmation never fills manual blank HTML');
  }finally{h.close();f.close();}
 });
 test(`scope and hidden-stage ABA during native detail confirmation cannot mutate either option (${company.code})`,async()=>{
  const f=await fixture(company),h=keyboardUI(f.request,f.props);try{
   await h.idle();const before=f.snapshot(),reads=h.calls.length;
   for(const trigger of ['button','keyboard'])for(const [field,value]of [['active',false],['stage','additional'],['version',new Date(Date.parse(f.props.version)+1).toISOString()],['refreshToken','changed'],['profileId','different'],['optionId',f.other],['disabled',true]]){
    let prompts=0;h.props.confirmImage=message=>{prompts++;assert.equal(message,'이 이미지를 삭제하시겠습니까?');const previous=h.props[field];h.props[field]=value;h.render();h.props[field]=previous;h.render();return true;};
    if(trigger==='button')await h.click('상세 이미지 3 선택 제거');else{h.hover(f.body[1]);h.press();await h.idle();}
    assert.equal(prompts,1,trigger+' '+field);assert.deepEqual(h.order(),f.keys);assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(f.snapshot(),before);
   }
   assert.equal(h.calls.filter(call=>call.method==='PUT').length,0);assert.equal(h.saved,0);assert.ok(h.calls.length>=reads);
  }finally{h.close();f.close();}
 });
 test(`manual input changes or unmount during confirmation are retained without applying the captured deletion (${company.code})`,async()=>{
  const f=await fixture(company),h=keyboardUI(f.request,f.props);let closed=false;try{
   await h.idle();const before=f.snapshot(),reads=h.calls.length;
   h.props.confirmImage=()=>{h.html('<p>확인창 사이에 직접 수정한 HTML</p>');return true;};
   await h.click('상세 이미지 3 선택 제거');assert.deepEqual(h.order(),f.keys);assert.equal(h.render().props['data-workspace-dirty'],true);
   assert.equal(nodes(h.render()).find(node=>node.type==='textarea').props.value,'<p>확인창 사이에 직접 수정한 HTML</p>');assert.equal(h.calls.length,reads);assert.equal(f.snapshot(),before);
   await h.click('입력 취소·저장 이미지 다시 조회');h.props.confirmImage=()=>{h.close();closed=true;return true;};
   h.hover(f.body[1]);h.press();assert.equal(h.listeners.size,0);assert.equal(h.calls.filter(call=>call.method==='PUT').length,0);assert.equal(f.snapshot(),before);
  }finally{if(!closed)h.close();f.close();}
 });
 test(`settings banners, native text Delete, modifiers and pointer leave never remove a detail selection (${company.code})`,async()=>{
  const f=await fixture(company),h=keyboardUI(f.request,f.props);try{
   await h.idle();const frozen=f.snapshot(),calls=h.calls.length;
   for(const key of [f.top,f.bottom]){h.hover(f.body[0]);h.hover(key);assert.equal(h.press().defaultPrevented,false);assert.deepEqual(h.order(),f.keys);}
   h.hover(f.body[0]);for(const kind of ['input','textarea','select','contenteditable','textbox','combobox','spinbutton']){assert.equal(h.press(keyEvent({target:target(kind)})).defaultPrevented,false);assert.deepEqual(h.order(),f.keys);}
   h.document.activeElement=target('textarea');assert.equal(h.press().defaultPrevented,false);h.document.activeElement=null;
   for(const flags of [{ctrlKey:true},{altKey:true},{metaKey:true},{shiftKey:true},{isComposing:true},{defaultPrevented:true},{key:'Backspace'}]){h.press(keyEvent(flags));assert.deepEqual(h.order(),f.keys);}
   h.hover(f.body[0]).props.onMouseLeave();assert.equal(h.press().defaultPrevented,false);assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(h.calls.length,calls);assert.equal(f.snapshot(),frozen);
  }finally{h.close();f.close();}
 });
 test(`an in-flight save and an unknown save acknowledgement block keyboard deletion until explicit recovery (${company.code})`,async()=>{
  for(const mode of ['busy','uncertain']){
   const f=await fixture(company);let release,held,lose=true;const gate=new Promise(resolve=>{release=resolve;}),h=keyboardUI(async(url,init)=>{
    if(init.method==='PUT'&&mode==='busy'){held={url,init};return gate;}
    const response=await f.request(url,init);if(init.method==='PUT'&&mode==='uncertain'&&lose){lose=false;assert.equal(response.status,200);throw Error('committed keyboard fixture acknowledgement lost');}return response;
   },f.props);try{
    await h.idle();h.html('<p>수정 중 HTML 보존</p>');await h.idle();h.hover(f.body[0]);const handler=[...h.listeners][0];h.button('선택 옵션 이미지 저장').props.onClick();handler(keyEvent());assert.deepEqual(h.order(),f.keys);
    if(mode==='busy'){assert.ok(held);h.hover(f.body[1]);h.press();assert.deepEqual(h.order(),f.keys);release(await f.request(held.url,held.init));await h.idle();assert.equal(h.saved,1);}else{await h.idle();assert.equal(h.saved,0);assert.equal(h.render().props['data-workspace-dirty'],true);h.hover(f.body[1]);h.press();assert.deepEqual(h.order(),f.keys);await h.click('입력 유지·최신 이미지 조회');assert.equal(h.saved,1);}
    assert.equal(h.calls.filter(call=>call.method==='PUT').length,1);const saved=await f.read(),own=saved.resolved.rows.find(row=>row.optionId===f.id);assert.deepEqual(own.fields.detailImages.value.split('\n'),f.keys);assert.equal(own.fields.detailHtml.value,'<p>수정 중 HTML 보존</p>');
   }finally{h.close();f.close();}
  }
 });
 test(`hidden-stage ABA, source/profile/option changes and old handlers cannot retarget a hovered image (${company.code})`,async()=>{
  const f=await fixture(company),h=keyboardUI(f.request,f.props);try{
   await h.idle();const frozen=f.snapshot();
   for(const [field,value]of [['active',false],['stage','additional'],['version',new Date(Date.parse(f.props.version)+1).toISOString()],['refreshToken','new-source'],['profileId','foreign-profile'],['optionId',f.other],['disabled',true]]){
    h.hover(f.body[0]);const handler=[...h.listeners][0],oldCard=h.card(f.body[0]),previous=h.props[field];h.props[field]=value;h.render();handler(keyEvent());oldCard.props.onMouseEnter();h.props[field]=previous;h.render();await h.idle();handler(keyEvent());h.press();await h.idle();assert.deepEqual(h.order(),f.keys,field+' old hover does not survive return');assert.equal(h.render().props['data-workspace-dirty'],false);
   }
   assert.equal(h.calls.some(call=>call.method!=='GET'),false);assert.equal(f.snapshot(),frozen);
   h.hover(f.body[1]);const old=[...h.listeners][0];h.close();old(keyEvent());assert.equal(h.listeners.size,0);
  }finally{if(h.listeners.size)h.close();f.close();}
 });
 test(`same-tick reorder/removal, dirty manual HTML and missing role metadata retain exact user intent (${company.code})`,async()=>{
  const f=await fixture(company),h=keyboardUI(f.request,f.props);try{
   await h.idle();const frozen=f.snapshot();h.hover(f.body[1]);const handler=[...h.listeners][0];h.button('상세 이미지 3 위로 이동').props.onClick();handler(keyEvent());await h.idle();assert.deepEqual(h.order(),[f.top,f.body[1],f.body[0],f.body[2],f.bottom]);
   await h.click('입력 취소·저장 이미지 다시 조회');h.html('');await h.idle();h.hover(f.body[0]);h.press();await h.idle();const textarea=nodes(h.render()).find(node=>node.type==='textarea');assert.equal(textarea.props.value,'','explicit blank HTML remains blank');assert.equal(h.calls.some(call=>call.method==='PUT'),false);assert.equal(f.snapshot(),frozen);
  }finally{h.close();f.close();}
  for(const metadata of [undefined,['foreign/file.png'],[f.top,f.top],'not-an-array']){
   const g=await fixture(company),ui=keyboardUI(async(url,init)=>{const response=await g.request(url,init),body=await response.json();if(metadata===undefined)delete body.protectedDetailImageKeys;else body.protectedDetailImageKeys=metadata;return Response.json(body,{status:response.status});},g.props);try{await ui.idle();const before=g.snapshot();ui.hover(g.body[0]);ui.press();await ui.idle();assert.deepEqual(ui.order(),g.keys);assert.equal(ui.render().props['data-workspace-dirty'],false);assert.equal(g.snapshot(),before);}finally{ui.close();g.close();}
  }
 });
}

test.after(()=>{
 const files=['app/components/option-image-editor.tsx','app/api/products/[id]/image-text/route.ts','tests/option-detail-keyboard.test.mjs','tests/option-image-editor.test.mjs'];
 const proof={format:'step709-detail-banner-protection-v1',sourceHashes:Object.fromEntries(files.map(file=>[file,createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')])),traces:protectionProof,boundary:'Actual component callbacks and isolated quotation/image APIs with SQLite/R2. React scheduler, auth/company and previously retained intake facts/images are synthetic. No browser, live OCR/translator, external requests, real product or Supplier Hub writes.'};
 fs.writeFileSync(new URL('../outputs/step709-detail-banner-protection-proof.json',import.meta.url),JSON.stringify(proof,null,2)+'\n');
});
