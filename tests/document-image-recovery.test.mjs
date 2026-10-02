import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64');
const json=async response=>{assert.ok(response.ok,await response.clone().text());return response.json();};
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);

/** Real stage-six component and API handlers; only the browser PNG renderer is a fixture. */
function documentPanel(h,productId,request,section='label'){
 const state=[],effects=[],plans=[];let cursor=0,version=h.sqlite.prepare('SELECT updated_at FROM products').get().updated_at,notifications=0,closed=false;
 const hooks={
  useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return[state[i],value=>state[i]=typeof value==='function'?value(state[i]):value];},
  useRef(initial){const i=cursor++;return state[i]??(state[i]={current:initial});},
  useEffect(fn,deps){const i=cursor++,old=state[i];if(!old||!deps||!old.deps||deps.some((value,index)=>value!==old.deps[index])){state[i]={deps};effects.push(()=>{old?.cleanup?.();state[i].cleanup=fn();});}},
 };
 const jsx=(type,props)=>({type,props}),exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/document-image-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,Error,Blob,File,FormData,URL,fetch:request,require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};
   if(name==='@/app/document-image-render')return{renderDocument:async plan=>{plans.push(plan);return{blob:new Blob([png,JSON.stringify(plan)],{type:'image/png'}),width:1200,height:1200};}};
   return h.load(name.slice(2)+'.ts');}});
 const render=()=>{cursor=0;const wrapper=exports.DocumentImagePanel({productId,version,section,onSaved(){notifications++;version=h.sqlite.prepare('SELECT updated_at FROM products').get().updated_at;}});const tree=wrapper.type(wrapper.props);effects.splice(0).forEach(fn=>fn());return tree;};
 const button=label=>nodes(render()).find(node=>node.type==='button'&&text(node.props.children)===label);
 const idle=async()=>{const deadline=Date.now()+10000;while(!closed&&render().props['aria-busy']){if(Date.now()>deadline)throw Error('Document image UI timed out');await new Promise(resolve=>setTimeout(resolve,1));}if(!closed)render();};
 return{plans,button,get preview(){return state[0];},get notifications(){return notifications;},alerts:()=>nodes(render()).filter(node=>node.props?.role==='alert').map(node=>text(node.props.children)),
  async click(label){const node=button(label);assert.ok(node&&!node.props.disabled,'available button: '+label);node.props.onClick();await idle();},
  updateVersion(value){version=value;render();},close(){closed=true;state.forEach(value=>value?.cleanup?.());},
 };
}

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])for(const lostReply of ['fetch','json'])test(`stage-six label recovers a lost committed attachment reply without duplicate PNGs (${company.companyCode}, ${lostReply})`,async()=>{
 const h=mobileIntakeHarness(company);let ui;
 try{
  // Recorded supplier facts, an observed form contract, synthetic workbook/PNG;
  // no live AI or Supplier Hub transmission takes place in this fixture.
  const fields=['skuId','categoryId',...h.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field=>field.id)];
  const workbook=quotationWorkbook(fields),sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
  await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'표시사항 복구 연동 시험',categoryId:'80719',categoryPath:h.context.category.categoryPath,
   template:{name:'synthetic.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  const images=h.sqlite.prepare('SELECT object_key FROM collection_images ORDER BY image_index').all().map(row=>row.object_key);
  const content=(await json(await h.route(base+'/content'))).content;
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{label:{material:'직접 검토한 재질',model:'검토한 모델'},assets:{main:[images[0]],additional:[images[1]],detailTop:[images[2]],detail:[images[3]],detailBottom:[images[4]],label:[images[5]]}}}}));
  const initial=(await json(await h.route(base+'/content'))).content;
  const get=h.bindings.FILES.get;h.bindings.FILES.get=async(key,options)=>{const object=await get(key);if(!object)return null;const bytes=new Uint8Array(await object.arrayBuffer());return{...object,body:new Response(bytes.slice(0,options?.range?.length??bytes.length)).body};};
  let lost=false,uploads=0;const attachments=[];
  const request=async(path,init={})=>{
   let response;
   if(path==='/api/files'){uploads++;response=await h.load('app/api/files/route.ts').POST(new Request('https://app.test'+path,{method:'POST',body:init.body}));}
   else if(path===base)response=await h.load('app/api/products/[id]/route.ts').GET(new Request('https://app.test'+base),{params:Promise.resolve({id:product.id})});
   else response=await h.route(path,{method:init.method??'GET',...(init.body?{body:init.body}:{})});
   if(path.endsWith('/attachments')){
    attachments.push({body:JSON.parse(init.body),status:response.status});
    if(!lost){lost=true;assert.equal(response.status,200,await response.clone().text());if(lostReply==='fetch')throw Error('fixture committed attachment reply lost');return{ok:true,status:200,json:async()=>{throw Error('fixture committed attachment body lost');}};}
   }
   return response;
  };
  ui=documentPanel(h,product.id,request);
  await ui.click('표시사항 생성·견적 첨부');assert.equal(lost,true);
  if(ui.alerts().length)await ui.click('PNG 업로드·상품 자료에 추가');
  assert.deepEqual(ui.alerts(),[],'a committed attachment must be recoverable from its exact saved reference');
  assert.equal(ui.notifications,1);assert.equal(uploads,1);assert.equal(attachments.length,1);assert.equal(ui.plans.length,1);
  const saved=(await json(await h.route(base+'/content'))).content,key=attachments[0].body.key;
  assert.deepEqual(saved.assets.label.value,[images[5],key]);assert.deepEqual(saved.label,initial.label);
  for(const role of ['main','additional','detailTop','detail','detailBottom'])assert.deepEqual(saved.assets[role],initial.assets[role]);
  assert.ok(ui.button('상품 첨부 완료').props.disabled);
  const view=await json(await h.route(base+'/quotation-fields'));
  assert.ok(view.resolved.rows.every(row=>row.fields.labelImages.value===[images[5],key].join('\n')));
  const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));
  const bundle=await h.route(base+'/quotation',{method:'POST',body:{action:'export',fingerprint:preview.fingerprint}});assert.equal(bundle.status,200,await bundle.clone().text());
  const reader=h.load('app/xlsx-template.ts'),files=await reader.readXlsxArchive(await bundle.arrayBuffer());
  const plan=JSON.parse(new TextDecoder().decode(files.get('supplier-hub-upload-plan.json'))),document=JSON.parse(new TextDecoder().decode(files.get('quotation-fields.json')));
  const sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(files.get(plan.quotation.file.filename)));
  assert.equal(plan.labelImages.length,2);const generated=plan.labelImages.find(image=>image.key===key);assert.ok(generated);
  assert.deepEqual(Buffer.from(files.get(generated.archivePath)),Buffer.from(h.objects.get(key)));
  for(let index=0;index<6;index++){
   const cells=reader.xlsxHeaders(sheet,'견적서',index+2),row=Object.fromEntries(fields.map((field,column)=>[field,cells[column]]));
   assert.equal(row.labelImages,[images[5],key].map(key=>document.uploadFilenames[key]).join('\n'));
   assert.equal(row.detailImages,[images[2],images[3],images[4]].map(key=>document.uploadFilenames[key]).join('\n'));
  }
  assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{ui?.close();h.close();}
});

async function documentFixture(section){
 const h=mobileIntakeHarness();await h.intake();
 const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
 if(section==='size'){
  const state=await json(await h.route(base+'/options')),rows=h.load('app/product-options.ts').optionInputs(state.options);rows[0].widthCm=12;
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:state.options.revision,expectedProductVersion:state.productVersion,rows}}));
 }
 const get=h.bindings.FILES.get;h.bindings.FILES.get=async(key,options)=>{const object=await get(key);if(!object)return null;const bytes=new Uint8Array(await object.arrayBuffer());return{...object,body:new Response(bytes.slice(0,options?.range?.length??bytes.length)).body};};
 const request=async(path,init={})=>path==='/api/files'
  ?h.load('app/api/files/route.ts').POST(new Request('https://app.test'+path,{method:'POST',body:init.body}))
  :path===base?h.load('app/api/products/[id]/route.ts').GET(new Request('https://app.test'+base),{params:Promise.resolve({id:product.id})})
  :h.route(path,{method:init.method??'GET',...(init.body?{body:init.body}:{})});
 const change=async()=>{
  if(section==='label'){
   const {content}=await json(await h.route(base+'/content'));
   await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{label:{material:'PNG 이후 직접 고친 재질'}}}}));
  }else{
   const state=await json(await h.route(base+'/options')),rows=h.load('app/product-options.ts').optionInputs(state.options);rows[0].widthCm=20;
   await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:state.options.revision,expectedProductVersion:state.productVersion,rows}}));
  }
 };
 return{h,product,base,request,change};
}

for(const loss of ['fetch','json'])test(`size PNG recovers its exact option revision after committed ${loss} response loss`,async()=>{
 const {h,product,base,request}=await documentFixture('size');let ui;
 try{
  let uploads=0,attachments=0;
  const fetch=async(path,init)=>{if(path==='/api/files')uploads++;const response=await request(path,init);if(path.endsWith('/attachments')){
   attachments++;assert.equal(response.status,200);if(loss==='fetch')throw Error('size response lost');return{ok:true,json:async()=>{throw Error('size response body lost');}};
  }return response;};
  ui=documentPanel(h,product.id,fetch,'size');await ui.click('사이즈표 생성·견적 첨부');
  assert.deepEqual(ui.alerts(),[]);assert.equal(ui.notifications,1);assert.equal(uploads,1);assert.equal(attachments,1);
  assert.equal((await json(await h.route(base+'/content'))).content.assets.size.value.length,1);
 }finally{ui?.close();h.close();}
});

for(const section of ['label','size'])test(`${section} recovery preserves changed inputs and cannot publish after unmount or a newer dashboard snapshot`,async()=>{
 for(const mode of ['changed-input','removed-role','read-outage','unmount','newer-prop']){
  const {h,product,base,request,change}=await documentFixture(section);let ui;
  try{
   let committed=false,uploads=0,attachments=0,unavailable=false;
   const fetch=async(path,init)=>{
    if(path==='/api/files')uploads++;
    if(committed&&path===base&&unavailable)return Response.json({error:'fixture recovery unavailable'},{status:503});
    const response=await request(path,init);
    if(path.endsWith('/attachments')){
     attachments++;assert.equal(response.status,200);committed=true;
     if(mode==='changed-input')await change();
     if(mode==='removed-role'){
      const {content}=await json(await h.route(base+'/content'));
      await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{assets:{[section]:[]}}}}));
     }
     if(mode==='read-outage')unavailable=true;
     if(mode==='unmount')ui.close();
     if(mode==='newer-prop')ui.updateVersion(new Date(Date.now()+60000).toISOString());
     throw Error('fixture attachment response lost');
    }
    return response;
   };
   ui=documentPanel(h,product.id,fetch,section);await ui.click((section==='label'?'표시사항':'사이즈표')+' 생성·견적 첨부');
   assert.equal(ui.notifications,0);assert.equal(uploads,1);assert.equal(attachments,1);
   if(mode==='unmount')continue;
   assert.ok(ui.alerts().length);
   const before=(await json(await h.route(base+'/content'))).content;
   if(mode==='read-outage'){
    unavailable=false;ui.updateVersion(h.sqlite.prepare('SELECT updated_at FROM products').get().updated_at);
   }
   await ui.click('PNG 업로드·상품 자료에 추가');
   assert.equal(ui.notifications,mode==='read-outage'?1:0);assert.equal(uploads,1);assert.equal(attachments,1);
   assert.deepEqual((await json(await h.route(base+'/content'))).content,before,'recovery performs no content writes');
   if(mode==='removed-role')assert.deepEqual(before.assets[section].value,[]);
   if(mode==='changed-input')assert.ok(section==='label'?before.label.material.value==='PNG 이후 직접 고친 재질':(await json(await h.route(base+'/options'))).options.rows[0].widthCm===20);
  }finally{ui?.close();h.close();}
 }
});

for(const section of ['label','size'])test(`${section} acknowledgement checks revisions even when a concurrent save retains the product timestamp`,async()=>{
 const {h,product,base,request}=await documentFixture(section);let ui;
 try{
  ui=documentPanel(h,product.id,request,section);await ui.click((section==='label'?'표시사항':'사이즈표')+' 생성·견적 첨부');assert.equal(ui.notifications,1);
  const {content}=await json(await h.route(base+'/content')),key=content.assets[section].value[0];
  const version=h.sqlite.prepare('SELECT updated_at FROM products').get().updated_at;let productReads=0,changed=false;
  const fetch=async(path,init)=>{
   if(path===base&&++productReads===2){
    if(section==='label'){
     const current=await h.load('db/product-content.ts').readProductContent('owner',product.id);
     const next=h.load('app/product-content.ts').applyContentPatch(current,{label:{material:'동일 시각 수정'}},version);
     assert.ok(await h.load('db/product-content.ts').saveProductContent('owner',next,current.revision));
    }else{
     const current=await h.load('db/product-options.ts').readProductOptions('owner',product.id),model=h.load('app/product-options.ts'),rows=model.optionInputs(current);rows[0].widthCm=33;
     assert.ok(await h.load('db/product-options.ts').saveProductOptions('owner',model.applyOptionRows(current,rows,version),current.revision,version));
    }
    changed=true;assert.equal(h.sqlite.prepare('SELECT updated_at FROM products').get().updated_at,version);
   }
   return request(path,init);
  };
  await assert.rejects(()=>h.load('app/document-image-recovery.ts').recoverDocumentImageAttachment({productId:product.id,section,key,...ui.preview},fetch),/콘텐츠가 변경|옵션이 변경/);
  assert.equal(changed,true);assert.equal(ui.notifications,1);
 }finally{ui?.close();h.close();}
});
