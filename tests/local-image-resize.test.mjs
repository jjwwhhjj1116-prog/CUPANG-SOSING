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
 const draws=[];const document={createElement(tag){assert.equal(tag,'canvas');let source,crop,rotation=0;return{width:0,height:0,getContext(kind){assert.equal(kind,'2d');return{save(){},restore(){},translate(){},scale(){},rotate(value){rotation=value*180/Math.PI;},drawImage(image,...args){source=image.bytes;if(args.length===4){const [x,y,width,height]=args;draws.push({x,y,width,height});}else{const [x,y,width,height]=args;crop={left:x,top:y,width,height};draws.push({crop,rotation});}}};},toBlob(callback,type){assert.equal(type,'image/png');(async()=>{const cropped=crop?await sharp(source).extract(crop).png().toBuffer():source;let pipeline=sharp(cropped);if(rotation)pipeline=pipeline.rotate(rotation);return pipeline.resize(this.width,this.height,{fit:'fill'}).png().toBuffer();})().then(bytes=>callback(new Blob([bytes],{type})));}};}};
 const states=[],effects=[],cache=new Map();let cursor=0,closed=false,late=0,section='이미지',stage='main';
 const hooks={useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>{if(closed)late++;states[i]=typeof value==='function'?value(states[i]):value;}];},useRef(initial){const i=cursor++;return states[i]??(states[i]={current:initial});},useCallback(fn,deps){const i=cursor++,old=states[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j])))states[i]={fn,deps};return states[i].fn;},useEffect(fn,deps){const i=cursor++,old=states[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){const next={deps};states[i]=next;effects.push(()=>{old?.cleanup?.();next.cleanup=fn();});}}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,Blob,File,FormData,URL,AbortController,Uint8Array,structuredClone,Image:ImageAdapter,document,fetch:request,require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return native(name);if(name.startsWith('@/app/components/'))return load(name.slice(2)+'.tsx');if(name==='@/app/local-image-resize')return load(name.slice(2)+'.ts');if(name.startsWith('@/'))return api.load(name.slice(2)+'.ts');return native(name);}});return exports;}
 const Editor=load('app/components/product-content-editor.tsx').ProductContentEditor;
 const render=()=>{cursor=0;const root=Editor({product,section,focusedAssetRole:stage,onSaved(){product=api.sqlite.prepare('SELECT * FROM products').get();}});const tree=root.type(root.props);effects.splice(0).forEach(fn=>fn());return tree;};
 const settle=async()=>{for(let i=0;i<18;i++){render();await new Promise(resolve=>setTimeout(resolve,1));}};
 const button=label=>nodes(render()).find(n=>n.type==='button'&&(n.props['aria-label']===label||text(n)===label));
 await settle();
 return{api,keys,base,original,calls,draws,render,button,settle,load,get late(){return late;},setIntercept(fn){intercept=fn;},setStage(next){stage=next;},setSection(next){section=next;},async refreshProduct(){product=api.sqlite.prepare('SELECT * FROM products').get();await settle();},
  async click(label){const node=button(label);assert.ok(node&&!node.props.disabled,'available control: '+label);node.props.onClick();await settle();},
  field(label){return nodes(render()).find(n=>n.props['aria-label']===label);},
  close(){if(closed)return;closed=true;states.forEach(state=>state?.cleanup?.());api.close();}};
}

for(const companyCode of ['A01464742','A01526306'])test(`local image dimensions can be edited, saved and resolved without changing originals (${companyCode})`,async()=>{
 const h=await fixture({companyCode,companyName:companyCode==='A01464742'?'와이홉':'유앤채'});try{
  await h.click('이미지 1 편집하기');
  assert.ok(h.field('이미지 가로 픽셀'),nodes(h.render()).filter(n=>n.props?.role==='alert').map(text).join(' '));h.field('이미지 가로 픽셀').props.onChange({target:{value:'1000'}});await h.settle();
  assert.equal(h.field('이미지 세로 픽셀').props.value,'500');
  await h.click('편집 미리보기');assert.equal(h.calls.filter(c=>c.init.method==='POST').length,0);
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

for(const companyCode of ['A01464742','A01526306'])test(`manual crop and rotation create new pixels while keeping originals, other roles and source facts (${companyCode})`,async()=>{
 const h=await fixture({companyCode,companyName:companyCode==='A01464742'?'와이홉':'유앤채'});try{
  const before=(await json(await h.api.route(h.base+'/content'))).content,options=h.api.sqlite.prepare('SELECT payload FROM product_options').get().payload;
  await h.click('이미지 1 편집하기');h.field('이미지 회전').props.onChange({target:{value:'90'}});await h.settle();
  assert.equal(h.field('이미지 가로 픽셀').props.value,'1');assert.equal(h.field('이미지 세로 픽셀').props.value,'2');
  await h.click('편집 미리보기');assert.equal(h.calls.filter(call=>call.init.method==='POST').length,0);
  await h.click('새 이미지 추가·현재 선택에 반영');const rotatedKey=JSON.parse(h.api.sqlite.prepare('SELECT image_keys FROM products').get().image_keys).at(-1);
  const rotated=await sharp(h.api.objects.get(rotatedKey)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(rotated.info.width,1);assert.equal(rotated.info.height,2);assert.deepEqual([...rotated.data],[255,0,0,255,0,0,255,255]);
  await h.click('이미지 역할·순서 저장');assert.deepEqual((await json(await h.api.route(h.base+'/content'))).content.assets.main.value,[rotatedKey]);
  await h.click('이미지 1 편집하기');h.field('이미지 자르기 사용').props.onChange({target:{checked:true}});await h.settle();
  h.field('자르기 x').props.onChange({target:{value:'1'}});await h.settle();h.field('자르기 width').props.onChange({target:{value:'1'}});await h.settle();
  h.field('이미지 가로 픽셀').props.onChange({target:{value:'1'}});await h.settle();await h.click('편집 미리보기');
  await h.click('새 이미지 추가·현재 선택에 반영');const croppedKey=JSON.parse(h.api.sqlite.prepare('SELECT image_keys FROM products').get().image_keys).at(-1);
  const cropped=await sharp(h.api.objects.get(croppedKey)).ensureAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(cropped.info.width,1);assert.equal(cropped.info.height,1);assert.deepEqual([...cropped.data],[0,0,255,255]);
  assert.equal(h.button('이미지 역할·순서 저장').props.disabled,true,'unselected crop makes no role changes to save');const saved=(await json(await h.api.route(h.base+'/content'))).content;
  assert.deepEqual(saved.assets.main.value,[rotatedKey],'editing an unselected original never restores its old role');
  for(const role of ['additional','detail','label'])assert.deepEqual(saved.assets[role],before.assets[role]);
  assert.deepEqual(Buffer.from(h.api.objects.get(h.keys[0])),h.original);assert.equal(h.api.sqlite.prepare('SELECT payload FROM product_options').get().payload,options);
  assert.ok((await json(await h.api.route(h.base+'/quotation-fields'))).resolved.rows.every(row=>row.fields.mainImage.value===rotatedKey));
  assert.equal(h.calls.some(call=>/image-generation|translation|supplier-hub/.test(call.url)),false);
 }finally{h.close();}
});

for(const mode of ['rotation-180','square-90','crop'])test(`unpreviewed ${mode} edit survives a background product refresh with unchanged output dimensions`,async()=>{
 const h=await fixture();try{
  if(mode==='square-90')h.api.objects.set(h.keys[0],await sharp({create:{width:2,height:2,channels:4,background:'#ff0000'}}).png().toBuffer());
  await h.click('이미지 1 편집하기');
  if(mode==='crop'){
   nodes(h.render()).find(n=>n.type==='input'&&n.props.type==='checkbox'&&n.props.checked===true).props.onChange({target:{checked:false}});
   h.field('이미지 자르기 사용').props.onChange({target:{checked:true}});await h.settle();h.field('자르기 width').props.onChange({target:{value:'1'}});
  }else h.field('이미지 회전').props.onChange({target:{value:mode==='square-90'?'90':'180'}});
  await h.settle();const width=h.field('이미지 가로 픽셀').props.value,height=h.field('이미지 세로 픽셀').props.value;
  h.api.sqlite.prepare('UPDATE products SET updated_at=?').run('2029-01-01T00:00:00.000Z');await h.refreshProduct();
  assert.ok(h.field('이미지 회전'),'pending editor must remain open');assert.equal(h.field('이미지 가로 픽셀').props.value,width);assert.equal(h.field('이미지 세로 픽셀').props.value,height);
  if(mode==='crop')assert.equal(h.field('자르기 width').props.value,'1');else assert.equal(h.field('이미지 회전').props.value,mode==='square-90'?90:180);
  assert.match(text(h.render()),/현재 입력은 유지/);assert.equal(h.calls.filter(call=>call.init.method==='POST').length,0);assert.equal(h.draws.length,0);
 }finally{h.close();}
});

test('invalid or empty crop bounds do not render/upload, and cancelling preserves the role draft',async()=>{
 const h=await fixture();try{
  await h.click('이미지 1 편집하기');h.field('이미지 자르기 사용').props.onChange({target:{checked:true}});await h.settle();
  for(const value of ['2','','0.5']){h.field('자르기 x').props.onChange({target:{value}});await h.settle();await h.click('편집 미리보기');assert.match(text(h.render()),/자를 영역/);assert.equal(h.draws.length,0);}
  assert.equal(h.calls.filter(call=>call.init.method==='POST').length,0);await h.click('편집 취소');
  assert.deepEqual((await json(await h.api.route(h.base+'/content'))).content.assets.main.value,[h.keys[0]]);
 }finally{h.close();}
});

test('cancel is local, explicit stretched dimensions are visible and a cleared role is never restored',async()=>{
 const h=await fixture();try{
  await h.click('이미지 1 편집하기');h.field('이미지 가로 픽셀').props.onChange({target:{value:'8'}});await h.click('편집 미리보기');
  await h.click('편집 취소');assert.equal(h.calls.filter(c=>c.init.method==='POST').length,0);
  await h.click('이미지 1 편집하기');
  nodes(h.render()).find(n=>n.type==='input'&&n.props.type==='checkbox'&&n.props.checked===true).props.onChange({target:{checked:false}});
  h.field('이미지 가로 픽셀').props.onChange({target:{value:'8'}});h.field('이미지 세로 픽셀').props.onChange({target:{value:'8'}});
  assert.match(text(h.render()),/늘어나거나 눌릴/);await h.click('편집 미리보기');
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
  await h.click('이미지 1 편집하기');h.field('이미지 가로 픽셀').props.onChange({target:{value:'16001'}});await h.click('편집 미리보기');
  assert.match(text(h.render()),/4,000만 픽셀/);assert.equal(h.draws.length,0);
  h.field('이미지 가로 픽셀').props.onChange({target:{value:'8'}});await h.click('편집 미리보기');
  const before=(await json(await h.api.route(h.base+'/content'))).content;
  await json(await h.api.route(h.base+'/content',{method:'PATCH',body:{expectedRevision:before.revision,patch:{assets:{main:[]}}}}));
  await h.click('새 이미지 추가·현재 선택에 반영');
  assert.match(text(h.render()),/이미지 자료가 변경/);assert.equal(h.calls.filter(c=>c.init.method==='POST').length,0);
  assert.deepEqual((await json(await h.api.route(h.base+'/content'))).content.assets.main.value,[]);
 }finally{h.close();}
});

test('lost committed attachment reply retries the same uploaded PNG and does not change a role twice',async()=>{
 const h=await fixture();try{
  await h.click('이미지 1 편집하기');h.field('이미지 가로 픽셀').props.onChange({target:{value:'8'}});await h.click('편집 미리보기');
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
  await h.click('이미지 1 편집하기');assert.ok(signal);h.close();assert.equal(signal.aborted,true);
  finish(new Response(h.original,{headers:{'content-type':'image/png'}}));await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(h.late,0);assert.equal(h.calls.filter(c=>c.init.method==='POST').length,0);
 }finally{h.close();}
});


