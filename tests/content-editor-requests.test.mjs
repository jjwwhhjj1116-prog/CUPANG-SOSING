import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
function harness(handle, focusedAssetRole, lifecycle=false){
 const slots=[],effects=[],cleanups=[],cache=new Map(), dependencies=[],callbacks=[];let ei=0,ci=0;let index=0,first=true,notices=0,content;
 const hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(initial){const i=index++;return slots[i]??(slots[i]={current:initial});},useCallback(fn,deps){if(!lifecycle)return fn;const i=ci++;if(!callbacks[i]||deps.some((v,j)=>!Object.is(v,callbacks[i].deps[j])))callbacks[i]={fn,deps};return callbacks[i].fn;},useEffect(fn,deps){const i=ei++;if(lifecycle){if(!dependencies[i]||deps.some((v,j)=>!Object.is(v,dependencies[i][j]))){dependencies[i]=deps;effects.push(()=>{cleanups[i]?.();cleanups[i]=fn();});}}else if(first)effects.push(fn);}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,structuredClone,TextEncoder,crypto,fetch:async(url,init)=>handle(url,init,content)??Response.json({content}),require(name){if(name==='react')return hooks;if(name.startsWith('@/'))return load(name.slice(2)+(name.includes('/components/')?'.tsx':'.ts'));return native(name);}});return exports;}
 const model=load('app/product-content.ts');content=model.emptyProductContent('p');
 const component=load('app/components/product-content-editor.tsx').ProductContentEditor;
 const render=(section='이미지')=>{index=0;ei=0;ci=0;const root=component({product:{id:'p',title:'상품',image_keys:'["owner/a.png"]'},section,focusedAssetRole,onSaved(){notices++;}});const tree=root.type(root.props);first=false;return tree;};
 const button=(name,section)=>nodes(render(section)).find(n=>n.type==='button'&&n.props.children===name);
 return{render,button,model,load,async flush(){effects.splice(0).forEach(fn=>fn());await settle();},get notices(){return notices;},async start(){render();if(lifecycle)effects.splice(0).forEach(fn=>fn());else effects.forEach(fn=>cleanups.push(fn()));await settle();},unmount(){cleanups.forEach(fn=>fn?.());}};
}

test('image save sends once, retains another tab draft and reaches resolved quotation image cells',async()=>{
 let finish,saved;const pending=new Promise(resolve=>{finish=resolve;});const calls=[];
 const h=harness((url,init,content)=>{if(init?.method!=='PATCH')return;calls.push(JSON.parse(init.body));return pending.then(()=>{saved=h.model.applyContentPatch(content,calls[0].patch,'2026-09-24T01:00:00Z');return Response.json({content:saved});});});
 await h.start();nodes(h.render('SEO')).find(n=>n.type==='input'&&n.props.maxLength===500).props.onChange({target:{value:'미저장 SEO'}});
 nodes(h.render()).find(n=>n.props?.['aria-label']==='이미지 1 역할').props.onChange({target:{value:'main'}});
 const click=h.button('이미지 역할·순서 저장').props.onClick;click();click();assert.equal(calls.length,1);finish();await settle();assert.equal(h.notices,1);
 assert.equal(nodes(h.render('SEO')).find(n=>n.type==='input'&&n.props.maxLength===500).props.value,'미저장 SEO');
 const resolved=h.load('app/quotation-schema.ts').resolveQuotationFields({categoryId:'80719',product:{id:'p',title:'상품',image_keys:'["owner/a.png"]',source_price_cny:1,supply_price:1,sale_price:2,msrp:3},content:saved,options:h.load('app/product-options.ts').emptyProductOptions('p'),settings:h.load('app/workspace-settings.ts').defaultSettings});
 assert.equal(resolved.rows[0].fields.mainImage.value,'owner/a.png');assert.equal(calls[0].patch.seo,undefined);
});

test('label fill and save cannot overlap; unmount ignores late fill and write responses',async()=>{
 for(const operation of ['fill','save']){
  let finish,signal;const pending=new Promise(resolve=>{finish=resolve;});let count=0;
  const h=harness((url,init,content)=>{if(url.endsWith('/registration-settings')||init?.method==='PATCH'){count++;signal=init.signal;return pending.then(()=>Response.json(url.endsWith('/registration-settings')?{settings:{manufacturer:'제조사'}}:{content}));}});
  await h.start();const fill=h.button('상품명·저장 기본설정으로 빈 표시사항 채우기','표시사항').props.onClick;
  const save=h.button('표시사항 저장','표시사항').props.onClick;
  if(operation==='fill'){fill();fill();save();}else{save();save();fill();}
  assert.equal(count,1);h.unmount();assert.equal(signal.aborted,true);finish();await settle();assert.equal(h.notices,0);assert.doesNotMatch(JSON.stringify(h.render('표시사항')),/저장 완료|입력을 채웠습니다/);
 }
});

test('detail step saves explanation and image roles together while preserving an unsaved title',async()=>{
 let saved,patch;
 const h=harness((url,init,content)=>{if(init?.method==='PATCH'){patch=JSON.parse(init.body).patch;saved=h.model.applyContentPatch(saved??content,patch,'2026-09-25T03:00:00Z');return Response.json({content:saved});}},'detail');
 await h.start();
 nodes(h.render('SEO')).find(n=>n.type==='input'&&n.props.maxLength===500).props.onChange({target:{value:'미저장 상품명'}});
 const edit=nodes(h.render()).find(n=>n.props?.['aria-label']==='상세페이지 설명');
 edit.props.onChange({target:{value:'번역 설명\n<script>실행 금지</script>'}});
 nodes(h.render()).find(n=>n.props?.['aria-label']==='이미지 1 역할').props.onChange({target:{value:'detail'}});
 const save=h.button('상세 설명·이미지 저장');assert.equal(save.props.disabled,false);save.props.onClick();await settle();
 assert.deepEqual(patch.seo,{description:'번역 설명\n<script>실행 금지</script>'});assert.deepEqual(patch.assets.detail,['owner/a.png']);
 assert.equal(nodes(h.render('SEO')).find(n=>n.type==='input'&&n.props.maxLength===500).props.value,'미저장 상품명');
 assert.equal(h.button('상세 설명·이미지 저장').props.disabled,true);
 const resolved=h.load('app/quotation-schema.ts').resolveQuotationFields({categoryId:'80719',product:{id:'p',title:'상품',image_keys:'["owner/a.png"]',source_price_cny:1,supply_price:1,sale_price:2,msrp:3},content:saved,options:h.load('app/product-options.ts').emptyProductOptions('p'),settings:h.load('app/workspace-settings.ts').defaultSettings});
 assert.equal(resolved.rows[0].fields.detailImages.value,'owner/a.png');assert.equal(resolved.rows[0].fields.detailHtml.value,'<p>번역 설명<br>&lt;script&gt;실행 금지&lt;/script&gt;</p>');
 nodes(h.render()).find(n=>n.props?.['aria-label']==='상세페이지 설명').props.onChange({target:{value:''}});
 assert.equal(h.button('상세 설명·이미지 저장').props.disabled,false);h.button('상세 설명·이미지 저장').props.onClick();await settle();assert.equal(patch.seo.description,'');assert.equal(saved.seo.description.provenance,'manual');
});

test('entering labels prepares saved defaults once and preserves a later manual clear across steps',async()=>{
 let fills=0,writes=0;
 const h=harness((url,init)=>{if(url.endsWith('/registration-settings')){fills++;return Response.json({settings:{manufacturer:'저장 제조사',importer:'저장 수입원',serviceContact:'연락처'}});}if(init?.method==='PATCH')writes++;},undefined,true);
 await h.start();h.render('SEO');await h.flush();assert.equal(fills,0);
 h.render('표시사항');await h.flush();assert.equal(fills,1);assert.equal(writes,0);
 const fields=nodes(h.render('표시사항')).filter(n=>n.type==='textarea');
 assert.ok(fields.some(n=>n.props.value==='상품'));assert.ok(fields.some(n=>n.props.value==='저장 제조사'));
 fields.find(n=>n.props.value==='저장 제조사').props.onChange({target:{value:''}});
 h.render('SEO');await h.flush();h.render('표시사항');await h.flush();
 assert.equal(fills,1);assert.ok(!nodes(h.render('표시사항')).some(n=>n.type==='textarea'&&n.props.value==='저장 제조사'));
 h.unmount();
});
test('label auto draft waits for existing edits and ignores late settings after unmount',async()=>{
 let finish,signal,fills=0;const pending=new Promise(resolve=>finish=resolve);
 const h=harness((url,init)=>{if(url.endsWith('/registration-settings')){fills++;signal=init.signal;return pending.then(()=>Response.json({settings:{manufacturer:'늦은 제조사'}}));}},undefined,true);
 await h.start();const title=nodes(h.render('SEO')).find(n=>n.type==='input'&&n.props.maxLength===500);title.props.onChange({target:{value:'수정 중'}});
 h.render('표시사항');await h.flush();assert.equal(fills,0);
 nodes(h.render('SEO')).find(n=>n.type==='input'&&n.props.maxLength===500).props.onChange({target:{value:''}});
 h.render('표시사항');await h.flush();assert.equal(fills,1);h.unmount();assert.equal(signal.aborted,true);finish();await settle();
 assert.ok(!JSON.stringify(h.render('표시사항')).includes('늦은 제조사'));
});

test('retained source markers identify unsaved SEO and images across stage navigation and clear after save',async()=>{
 const h=harness((_url,init,content)=>init?.method==='PATCH'?Response.json({content:h.model.applyContentPatch(content,JSON.parse(init.body).patch,'now')}):undefined);
 await h.start();
 nodes(h.render('SEO')).find(n=>n.type==='input'&&n.props.maxLength===500).props.onChange({target:{value:'새 상품명'}});
 nodes(h.render()).find(n=>n.props?.['aria-label']==='이미지 1 역할').props.onChange({target:{value:'additional'}});
 const pending=()=>nodes(h.render()).filter(n=>n.props?.['data-quotation-source-step']&&n.props['data-workspace-dirty']).map(n=>n.props['data-quotation-source-step']);
 assert.deepEqual(pending(),['SEO','추가 이미지']);
 h.button('이미지 역할·순서 저장').props.onClick();await settle();assert.deepEqual(pending(),['SEO']);
});
