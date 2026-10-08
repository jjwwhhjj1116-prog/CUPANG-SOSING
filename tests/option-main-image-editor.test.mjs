import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
const native=createRequire(import.meta.url),plain=value=>JSON.parse(JSON.stringify(value));
const visible=value=>Array.isArray(value)?value.flatMap(visible):value&&typeof value==='object'&&!value.props?.hidden?[value,...visible(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):typeof value==='boolean'?'':String(value??'');
const sameDeps=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
async function fixture(){
 const backend=mobileIntakeHarness();try{
  const snapshot={...hubSchemaSnapshot(schemaCompanies[0]),inputBindings:'couplus-paths-v1'},schema=JSON.parse(snapshot.schemaString);schema.properties.imagePage.properties.images={type:'object',properties:{mainImage:{type:'string',title:'대표 이미지',requirement:'필수'}}};snapshot.schemaString=JSON.stringify(schema);
  const profile=await backend.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'최종 대표이미지 UI 검수',categoryId:snapshot.categoryId,categoryPath:schemaPath,hubSchema:snapshot,template:null,mappings:[]});backend.context.category=profile;backend.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(backend.context),'job');await backend.intake();
  const product=plain(backend.sqlite.prepare('SELECT * FROM products').get()),endpoint='/api/products/'+product.id+'/quotation-fields?profileId='+profile.id;let view=await json(await backend.route(endpoint));const ids=view.resolved.rows.flatMap(row=>row.optionId?[row.optionId]:[]),id=ids[0],source=view.imageKeys[0],key=view.imageKeys.find(key=>key!==source),options=await json(await backend.route('/api/products/'+product.id+'/options')),rows=backend.load('app/product-options.ts').optionInputs(options.options);rows.find(row=>row.id===id).imageKey=source;
  await json(await backend.route('/api/products/'+product.id+'/options',{method:'PATCH',body:{expectedRevision:options.options.revision,expectedProductVersion:options.productVersion,rows}}));view=await json(await backend.route(endpoint));assert.equal(JSON.parse(backend.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(product.id).payload).rows.find(row=>row.id===id).imageKey,source);
  await json(await backend.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{optionId:id,fieldKey:'mainImage',value:key}]}}));Object.assign(product,plain(backend.sqlite.prepare('SELECT * FROM products').get()));
  const calls=[];let unavailable=false,lose=false;
  const request=async(url,init={})=>{calls.push({url,method:init.method??'GET',body:init.body?JSON.parse(init.body):undefined});if(unavailable&&(init.method??'GET')==='GET')return Response.json({error:'private read unavailable'},{status:503});const response=await backend.route(url,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})});if(lose&&init.method==='PUT'){assert.equal(response.status,200);lose=false;unavailable=true;throw Error('committed main image ACK lost');}return response;};
  return {backend,profile,product,endpoint,id,source,key,nextKey:view.imageKeys.find(value=>value!==key&&value!==source)??source,calls,request,read:()=>backend.route(endpoint).then(json),lost(){lose=true;},recover(){unavailable=false;},close(){backend.close();}};
 }catch(error){backend.close();throw error;}
}
function editor(f,{wrapper=false,focusedOptionId=f.id,imageView=true}={}){
 const contexts=new Map(),cache=new Map(),effects=[],saved=[];let active,seen;
 const props={product:f.product,productId:f.product.id,profileId:f.profile.id,focusedOptionId,imageView,version:f.product.updated_at,onSaved(){saved.push(1);props.product.updated_at=f.backend.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(f.product.id).updated_at;props.version=props.product.updated_at;}};
 const hookEffect=(fn,deps)=>{const ctx=active,i=ctx.cursor++,old=ctx.slots[i];if(!old||!sameDeps(old.deps,deps)){ctx.slots[i]={deps,cleanup:old?.cleanup};effects.push({ctx,i,fn});}};
 const react={useState(initial){const ctx=active,i=ctx.cursor++;if(!(i in ctx.slots))ctx.slots[i]=typeof initial==='function'?initial():initial;return[ctx.slots[i],value=>{ctx.slots[i]=typeof value==='function'?value(ctx.slots[i]):value;}];},useRef(initial){const ctx=active,i=ctx.cursor++;return ctx.slots[i]??(ctx.slots[i]={current:initial});},useEffect:hookEffect,useLayoutEffect:hookEffect,useMemo(fn,deps){const ctx=active,i=ctx.cursor++,old=ctx.slots[i];if(!old||!sameDeps(old.deps,deps))ctx.slots[i]={deps,value:fn()};return ctx.slots[i].value;},useCallback(fn,deps){return react.useMemo(()=>fn,deps);}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,Date,URL,AbortController,TextEncoder,TextDecoder,structuredClone,crypto,fetch:f.request,require(name){if(name==='react')return react;if(name.startsWith('@/'))return name.includes('/components/')?load(name.slice(2)+'.tsx'):f.backend.load(name.slice(2)+'.ts');return native(name);}},{filename:file});return exports;}
 const Component=wrapper?load('app/components/product-options-editor.tsx').ProductOptionsEditor:load('app/components/option-main-image-editor.tsx').OptionMainImageEditor;
 function expand(node,path){if(Array.isArray(node))return node.map((child,i)=>expand(child,path+'/'+i));if(!node||typeof node!=='object')return node;if(typeof node.type==='function'){const id=path+'/'+node.type.name+':'+String(node.key??'');seen.add(id);let ctx=contexts.get(id);if(!ctx){ctx={slots:[],cursor:0};contexts.set(id,ctx);}ctx.cursor=0;const previous=active;active=ctx;const rendered=node.type(node.props);active=previous;return expand(rendered,id);}return{...node,props:{...node.props,children:expand(node.props?.children,path+'/children')}};}
 const render=()=>{seen=new Set();const tree=expand({type:Component,key:'editor',props},'root');for(const[id,ctx]of contexts)if(!seen.has(id)){for(const slot of ctx.slots)slot?.cleanup?.();contexts.delete(id);}while(effects.length){const{ctx,i,fn}=effects.shift();ctx.slots[i].cleanup?.();ctx.slots[i].cleanup=fn();}return tree;};
 const idle=async()=>{for(let i=0;i<16;i++){render();await new Promise(resolve=>setImmediate(resolve));}return render();};
 const button=label=>visible(render()).find(node=>node.type==='button'&&(node.props['aria-label']===label||text(node)===label)),input=label=>visible(render()).find(node=>node.props?.['aria-label']===label);
 return {props,saved,render,idle,button,input,async click(label){const node=button(label);assert.ok(node,label);assert.equal(node.props.disabled,false,label);node.props.onClick();await idle();},close(){for(const ctx of contexts.values())for(const slot of ctx.slots)slot?.cleanup?.();}};
}

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
