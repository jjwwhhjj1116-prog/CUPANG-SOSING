import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
const native=createRequire(import.meta.url),sharp=native('sharp');
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const text=t=>Array.isArray(t)?t.map(text).join(''):t&&typeof t==='object'?text(t.props?.children):t==null?'':String(t);
const json=async response=>{assert.ok(response.ok,await response.clone().text());return response.json();};

/** Actual editor, source/resize helper, authenticated file APIs and SQLite.
 * Canvas draw/toBlob are adapted to sharp pixels because this is not a browser test. */
async function fixture(company={}){
 const api=mobileIntakeHarness(company);await api.intake();
 let product=api.sqlite.prepare('SELECT * FROM products').get();const base='/api/products/'+product.id,keys=JSON.parse(product.image_keys);
 const original=await sharp(Buffer.from([255,0,0,255,0,0,255,255]),{raw:{width:2,height:1,channels:4}}).png().toBuffer();api.objects.set(keys[0],original);
 const content=(await json(await api.route(base+'/content'))).content;
 await json(await api.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{assets:{main:[keys[0]],additional:[keys[1]],detail:[keys[2]],label:[keys[3]]}}}}));
 product=api.sqlite.prepare('SELECT * FROM products').get();
 const get=api.bindings.FILES.get;api.bindings.FILES.get=async(key,options)=>{const object=await get(key);return object?{...object,body:new Response(api.objects.get(key).slice(0,options?.range?.length??object.size)).body}:null;};
 const calls=[];let intercept=null;
 async function request(url,init={}){
  calls.push({url,init});if(intercept){const result=await intercept(url,init);if(result)return result;}
  if(url==='/api/files')return api.load('app/api/files/route.ts').POST(new Request('https://app.test'+url,{method:'POST',body:init.body}));
  if(url.startsWith('/api/files/')){const response=await api.load('app/api/files/[...key]/route.ts').GET(new Request('https://app.test'+url),{params:Promise.resolve({key:url.slice('/api/files/'.length).split('/').map(decodeURIComponent)})});assert.ok(response.ok,await response.clone().text());return response;}
  if(url===base)return api.load('app/api/products/[id]/route.ts').GET(new Request('https://app.test'+url),{params:Promise.resolve({id:product.id})});
  return api.route(url,{method:init.method??'GET',body:init.body});
 }
 class ImageAdapter{set src(url){if(!url)return;fetch(url).then(r=>r.arrayBuffer()).then(async bytes=>{this.bytes=Buffer.from(bytes);const meta=await sharp(this.bytes).metadata();this.naturalWidth=meta.width;this.naturalHeight=meta.height;this.onload?.();}).catch(error=>this.onerror?.(error));}}
 const draws=[];const document={createElement(tag){assert.equal(tag,'canvas');let source;return{width:0,height:0,getContext(kind){assert.equal(kind,'2d');return{drawImage(image,x,y,width,height){draws.push({x,y,width,height});source=image.bytes;}};},toBlob(callback,type){assert.equal(type,'image/png');sharp(source).resize(this.width,this.height,{fit:'fill'}).png().toBuffer().then(bytes=>callback(new Blob([bytes],{type})));}};}};
 const states=[],effects=[],cache=new Map();let cursor=0,closed=false,late=0,section='이미지',stage='main';
 const hooks={useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>{if(closed)late++;states[i]=typeof value==='function'?value(states[i]):value;}];},useRef(initial){const i=cursor++;return states[i]??(states[i]={current:initial});},useCallback(fn,deps){const i=cursor++,old=states[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j])))states[i]={fn,deps};return states[i].fn;},useEffect(fn,deps){const i=cursor++,old=states[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){const next={deps};states[i]=next;effects.push(()=>{old?.cleanup?.();next.cleanup=fn();});}}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,Blob,File,FormData,URL,AbortController,Uint8Array,structuredClone,Image:ImageAdapter,document,fetch:request,require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return native(name);if(name.startsWith('@/app/components/'))return load(name.slice(2)+'.tsx');if(name==='@/app/local-image-resize')return load(name.slice(2)+'.ts');if(name.startsWith('@/'))return api.load(name.slice(2)+'.ts');return native(name);}});return exports;}
 const Editor=load('app/components/product-content-editor.tsx').ProductContentEditor;
 const render=()=>{cursor=0;const root=Editor({product,section,focusedAssetRole:stage,onSaved(){product=api.sqlite.prepare('SELECT * FROM products').get();}});const tree=root.type(root.props);effects.splice(0).forEach(fn=>fn());return tree;};
 const settle=async()=>{for(let i=0;i<18;i++){render();await new Promise(resolve=>setTimeout(resolve,1));}};
 const button=label=>nodes(render()).find(n=>n.type==='button'&&(n.props['aria-label']===label||text(n)===label));
 await settle();
 return{api,keys,base,original,calls,draws,render,button,settle,load,get late(){return late;},setIntercept(fn){intercept=fn;},setStage(next){stage=next;},setSection(next){section=next;},
  async click(label){const node=button(label);assert.ok(node&&!node.props.disabled,'available control: '+label);node.props.onClick();await settle();},
  field(label){return nodes(render()).find(n=>n.props['aria-label']===label);},
  close(){if(closed)return;closed=true;states.forEach(state=>state?.cleanup?.());api.close();}};
}

for(const companyCode of ['A01464742','A01526306'])test(`local image dimensions can be edited, saved and resolved without changing originals (${companyCode})`,async()=>{
 const h=await fixture({companyCode,companyName:companyCode==='A01464742'?'와이홉':'유앤채'});try{
  await h.click('이미지 1 크기 조절');
  assert.ok(h.field('이미지 가로 픽셀'),nodes(h.render()).filter(n=>n.props?.role==='alert').map(text).join(' '));h.field('이미지 가로 픽셀').props.onChange({target:{value:'1000'}});await h.settle();
  assert.equal(h.field('이미지 세로 픽셀').props.value,'500');
  await h.click('크기 조절 미리보기');assert.equal(h.calls.filter(c=>c.init.method==='POST').length,0);
  await h.click('새 이미지 추가·현재 선택에 반영');
  const product=h.api.sqlite.prepare('SELECT * FROM products').get(),newKey=JSON.parse(product.image_keys).at(-1);
  assert.notEqual(newKey,h.keys[0]);assert.deepEqual(Buffer.from(h.api.objects.get(h.keys[0])),h.original);
  const metadata=await sharp(h.api.objects.get(newKey)).metadata();assert.equal(metadata.width,1000);assert.equal(metadata.height,500);
  const before=(await json(await h.api.route(h.base+'/content'))).content;assert.deepEqual(before.assets.main.value,[h.keys[0]],'new role remains an explicit editor draft');
  const optionPayload=h.api.sqlite.prepare('SELECT payload FROM product_options').get().payload;
  await h.click('이미지 역할·순서 저장');
  const saved=(await json(await h.api.route(h.base+'/content'))).content;assert.deepEqual(saved.assets.main.value,[newKey]);
  for(const role of ['additional','detail','label'])assert.deepEqual(saved.assets[role],before.assets[role]);
  const quote=await json(await h.api.route(h.base+'/quotation-fields'));assert.ok(quote.resolved.rows.every(row=>row.fields.mainImage.value===newKey));
  const optionId=quote.resolved.rows.find(row=>row.optionId).optionId;
  await json(await h.api.route(h.base+'/quotation-fields',{method:'PUT',body:{expectedRevision:quote.revision,expectedInputFingerprint:quote.inputFingerprint,changes:[{fieldKey:'mainImage',optionId,value:''}]}}));
  const profile=await h.api.load('db/category-profiles.ts').createCategoryProfile('owner',h.api.context.category,'cat');
  const exports=h.api.load('app/exports/quotation-source.ts'),source=await exports.readQuotationExportSource('owner',product.id,profile.id),resolved=exports.resolveQuotationExport(source);
  const assets=JSON.parse(product.image_keys).map((key,index)=>({key,name:`assets/${index}.png`}));
  const rows=h.api.load('app/exports/quotation-fields.ts').resolvedQuotationRows(source,resolved,assets);
  const fields=['skuId','mainImage'],workbook=quotationWorkbook(fields),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const output=await h.api.load('app/exports/mapped-quotation.ts').createMappedQuotation({originalBytes:workbook,profile:{...profile,template:{name:'resized.xlsx',format:'xlsx',sheetName:'견적서',headerRow:1,headers:fields,sha256},mappings:fields.map((field,column)=>({field,column,required:false}))},rows,dataStartRow:2});
  const reader=h.api.load('app/xlsx-template.ts'),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(output.bytes));
  assert.equal(reader.xlsxHeaders(sheet,'견적서',2)[1],'','explicit quotation image blank remains authoritative');
  assert.equal(reader.xlsxHeaders(sheet,'견적서',3)[1],assets.find(asset=>asset.key===newKey).name.split('/').at(-1));
  assert.equal(h.api.sqlite.prepare('SELECT payload FROM product_options').get().payload,optionPayload,'individual SKU image, stock, price and packaging remain unchanged');
  const pixels=await sharp(h.api.objects.get(newKey)).ensureAlpha().raw().toBuffer();assert.deepEqual([...pixels.slice(0,4)],[255,0,0,255]);assert.deepEqual([...pixels.slice(-4)],[0,0,255,255]);
  assert.deepEqual(h.draws,[{x:0,y:0,width:1000,height:500}]);
  assert.equal(h.calls.some(c=>/image-generation|translation|supplier-hub/.test(c.url)),false);
 }finally{h.close();}
});

test('cancel is local, explicit stretched dimensions are visible and a cleared role is never restored',async()=>{
 const h=await fixture();try{
  await h.click('이미지 1 크기 조절');h.field('이미지 가로 픽셀').props.onChange({target:{value:'8'}});await h.click('크기 조절 미리보기');
  await h.click('크기 조절 취소');assert.equal(h.calls.filter(c=>c.init.method==='POST').length,0);
  await h.click('이미지 1 크기 조절');
  nodes(h.render()).find(n=>n.type==='input'&&n.props.type==='checkbox'&&n.props.checked===true).props.onChange({target:{checked:false}});
  h.field('이미지 가로 픽셀').props.onChange({target:{value:'8'}});h.field('이미지 세로 픽셀').props.onChange({target:{value:'8'}});
  assert.match(text(h.render()),/늘어나거나 눌릴/);await h.click('크기 조절 미리보기');
  h.setSection('SEO');nodes(h.render()).find(n=>n.type==='input'&&n.props.maxLength===500).props.onChange({target:{value:'미저장 상품명'}});
  h.setSection('이미지');h.field('이미지 1 역할').props.onChange({target:{value:''}});
  await h.click('새 이미지 추가·현재 선택에 반영');await h.click('이미지 역할·순서 저장');
  const content=(await json(await h.api.route(h.base+'/content'))).content;assert.deepEqual(content.assets.main.value,[]);assert.equal(content.assets.main.provenance,'manual');
  h.setSection('SEO');assert.equal(nodes(h.render()).find(n=>n.type==='input'&&n.props.maxLength===500).props.value,'미저장 상품명');
  const lastKey=JSON.parse(h.api.sqlite.prepare('SELECT image_keys FROM products').get().image_keys).at(-1),metadata=await sharp(h.api.objects.get(lastKey)).metadata();
  assert.equal(metadata.width,8);assert.equal(metadata.height,8);
 }finally{h.close();}
});

test('invalid dimensions make no upload and newer saved image roles stop stale attachment',async()=>{
 const h=await fixture();try{
  await h.click('이미지 1 크기 조절');h.field('이미지 가로 픽셀').props.onChange({target:{value:'16001'}});await h.click('크기 조절 미리보기');
  assert.match(text(h.render()),/4,000만 픽셀/);assert.equal(h.draws.length,0);
  h.field('이미지 가로 픽셀').props.onChange({target:{value:'8'}});await h.click('크기 조절 미리보기');
  const before=(await json(await h.api.route(h.base+'/content'))).content;
  await json(await h.api.route(h.base+'/content',{method:'PATCH',body:{expectedRevision:before.revision,patch:{assets:{main:[]}}}}));
  await h.click('새 이미지 추가·현재 선택에 반영');
  assert.match(text(h.render()),/이미지 자료가 변경/);assert.equal(h.calls.filter(c=>c.init.method==='POST').length,0);
  assert.deepEqual((await json(await h.api.route(h.base+'/content'))).content.assets.main.value,[]);
 }finally{h.close();}
});

test('lost committed attachment reply retries the same uploaded PNG and does not change a role twice',async()=>{
 const h=await fixture();try{
  await h.click('이미지 1 크기 조절');h.field('이미지 가로 픽셀').props.onChange({target:{value:'8'}});await h.click('크기 조절 미리보기');
  let lost=false;h.setIntercept(async(url,init)=>{if(url.endsWith('/attachments')&&!lost){lost=true;const saved=await h.api.route(url,{method:'POST',body:init.body});assert.equal(saved.status,200);throw Error('시험: 첨부 응답 유실');}});
  const apply=h.button('새 이미지 추가·현재 선택에 반영').props.onClick;apply();apply();await h.settle();assert.match(text(h.render()),/첨부 응답 유실/);
  await h.click('새 이미지 추가·현재 선택에 반영');
  assert.equal(h.calls.filter(c=>c.url==='/api/files').length,1);assert.equal(h.calls.filter(c=>c.url.endsWith('/attachments')).length,1);
  const before=(await json(await h.api.route(h.base+'/content'))).content;assert.deepEqual(before.assets.main.value,[h.keys[0]]);
  await h.click('이미지 역할·순서 저장');assert.equal((await json(await h.api.route(h.base+'/content'))).content.revision,before.revision+1);
 }finally{h.close();}
});

test('closing during original loading cancels the operation before any upload or late editor state',async()=>{
 const h=await fixture();try{
  let finish,signal;const pending=new Promise(resolve=>{finish=resolve;});
  h.setIntercept((url,init)=>{if(url.startsWith('/api/files/')){signal=init.signal;return pending;}});
  await h.click('이미지 1 크기 조절');assert.ok(signal);h.close();assert.equal(signal.aborted,true);
  finish(new Response(h.original,{headers:{'content-type':'image/png'}}));await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(h.late,0);assert.equal(h.calls.filter(c=>c.init.method==='POST').length,0);
 }finally{h.close();}
});


