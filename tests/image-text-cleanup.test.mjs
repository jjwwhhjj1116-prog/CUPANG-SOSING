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

/** Actual panel and image/content/option APIs with SQLite; only provider output
 * is synthetic. Prompt contracts do not claim a real model's visual accuracy. */
async function fixture(companyCode){
 const api=mobileIntakeHarness({companyCode,companyName:companyCode==='A01464742'?'와이홉':'유앤채'});await api.intake();
 let product=api.sqlite.prepare('SELECT * FROM products').get();const keys=JSON.parse(product.image_keys),base='/api/products/'+product.id;
 const original=await sharp({create:{width:8,height:8,channels:3,background:'#cc0000'}}).png().toBuffer();
 const output=await sharp({create:{width:1024,height:1024,channels:3,background:'#ffffff'}}).png().toBuffer();api.objects.set(keys[0],original);
 const content=(await json(await api.route(base+'/content'))).content;
 await json(await api.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{assets:{main:[keys[0]],additional:[keys[1]],detail:[keys[2]],label:[keys[3]]}}}}));
 const options=await json(await api.route(base+'/options'));
 const rows=api.load('app/product-options.ts').optionInputs(options.options);rows[0].imageKey=keys[0];rows[1].imageKey=null;
 await json(await api.route(base+'/options',{method:'PATCH',body:{expectedRevision:options.options.revision,expectedProductVersion:options.productVersion,rows}}));
 product=api.sqlite.prepare('SELECT * FROM products').get();
 api.sqlite.prepare('INSERT OR REPLACE INTO workspace_settings(owner_id,payload,updated_at) VALUES(?,?,?)').run('owner',JSON.stringify({...api.settings,translateImages:true,removeBackground:false,translationPrompt:'번역 스타일 시험 지침'}),new Date().toISOString());
 Object.assign(api.bindings,{OPENAI_API_KEY:'TEST-NOT-REAL',SOURCEFLOW_IMAGE_MODEL:'gpt-image-1.5'});
 const provider=[];
 function server(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,Error,URL,Date,Response,Request,Blob,FormData,TextEncoder,TextDecoder,Uint8Array,DataView,AbortSignal,crypto,atob,process:{env:{NODE_ENV:'production'}},fetch:async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/images/edits');provider.push(init);return Response.json({data:[{b64_json:output.toString('base64')}],output_format:'png'});},require(name){if(name==='next/server')return{NextResponse:Response};if(name==='cloudflare:workers')return{env:api.bindings};if(name==='@/app/chatgpt-auth')return{getWorkspaceOwnerId:async()=>'owner',getChatGPTUser:async()=>({verifiedAccess:true,userId:'owner'})};if(name==='@/app/automation/image-edit')return imageModel;return api.load(name.slice(2)+'.ts');}});return exports;}
 const imageModel=server('app/automation/image-edit.ts'),route=server('app/api/products/[id]/image-generation/route.ts');
 const calls=[];async function request(url,init={}){calls.push({url,init});if(url.endsWith('/image-generation'))return route[init.method??'GET'](new Request('https://app.test'+url,{method:init.method??'GET',headers:{'content-type':'application/json',origin:'https://app.test'},...(init.body?{body:init.body}:{})}),{params:Promise.resolve({id:product.id})});return api.route(url,{method:init.method??'GET',body:init.body});}
 const slots=[],effects=[],cache=new Map();let index=0;
 const hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=index++;return slots[i]??(slots[i]={current:initial});},useEffect(fn,deps){const i=index++,old=slots[i];if(!old||deps.some((value,j)=>!Object.is(value,old.deps[j]))){const next={deps};slots[i]=next;effects.push(()=>{old?.cleanup?.();next.cleanup=fn();});}}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,crypto,fetch:request,require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return native(name);return api.load(name.slice(2)+'.ts');}});return exports;}
 const Panel=load('app/components/image-generation-panel.tsx').default;
 function render(){index=0;const root=Panel({productId:product.id,version:product.updated_at,imageKeys:JSON.parse(product.image_keys),onProductChanged(){product=api.sqlite.prepare('SELECT * FROM products').get();}});const tree=root.type(root.props);effects.splice(0).forEach(fn=>fn());return tree;}
 async function settle(){for(let i=0;i<20;i++){render();await new Promise(resolve=>setTimeout(resolve,1));}}
 const button=label=>nodes(render()).find(n=>n.type==='button'&&text(n)===label);
 await settle();return{api,keys,base,original,output,provider,calls,imageModel,request,render,settle,button,
  async click(label){const node=button(label);assert.ok(node&&!node.props.disabled,'available '+label);node.props.onClick();await settle();},
  close(){slots.forEach(slot=>slot?.cleanup?.());api.close();}};
}

for(const companyCode of ['A01464742','A01526306'])test(`explicit text cleanup reaches reviewed files and quotation without replacing originals (${companyCode})`,async()=>{
 const h=await fixture(companyCode);try{
  const purpose=nodes(h.render()).find(n=>n.type==='select'&&nodes(n).some(option=>option.type==='option'&&option.props.value==='cleanup'));
  assert.ok(purpose,'the actual image form must offer outside-product text cleanup');purpose.props.onChange({target:{value:'cleanup'}});await h.settle();
  assert.match(text(h.render()),/상품 바깥 설명 문구를 정리합니다/);
  await h.click('이미지 요청 검토하기 · 무료');assert.equal(h.provider.length,0);
  let saved=h.api.sqlite.prepare('SELECT * FROM image_jobs').get(),review=JSON.parse(saved.review);
  assert.equal(review.purpose,'cleanup');assert.equal(review.prompt,'');assert.equal(review.recipe.find(step=>step.key==='translation').status,'skipped');
  assert.equal(review.recipe.find(step=>step.key==='background').status,'skipped');assert.equal(review.recipe.find(step=>step.key==='textCleanup').status,'applied');
  assert.doesNotMatch(review.effectivePrompt,/번역 스타일 시험 지침/);assert.match(review.effectivePrompt,/printed on the product/);
  assert.equal(h.api.sqlite.prepare('SELECT status FROM image_jobs').get().status,'prepared');
  const checkbox=nodes(h.render()).find(n=>n.type==='input'&&n.props.type==='checkbox'&&!n.props.disabled);assert.ok(checkbox);checkbox.props.onChange({target:{checked:true}});
  await h.click('유료 요청 승인 · 아직 호출하지 않음');assert.equal(h.provider.length,0);
  const contentBefore=(await json(await h.api.route(h.base+'/content'))).content;
  await h.click('승인한 이미지 1장 가공 · 비용 발생');assert.equal(h.provider.length,1);assert.equal(h.provider[0].body.get('prompt'),review.effectivePrompt);
  saved=h.api.sqlite.prepare('SELECT * FROM image_jobs').get();const result=JSON.parse(saved.result);assert.equal(saved.status,'completed');assert.equal(result.purpose,'cleanup');assert.equal(result.attached,true);
  assert.deepEqual((await json(await h.api.route(h.base+'/content'))).content,contentBefore,'generation only attaches the result');
  assert.deepEqual(Buffer.from(h.api.objects.get(h.keys[0])),h.original);
  const replay=await h.request(h.base+'/image-generation',{method:'POST',body:JSON.stringify({action:'execute',jobId:saved.id})});assert.equal(replay.status,200);assert.equal(h.provider.length,1);
  await h.click('검토한 결과를 원본의 대표·추가·상세 위치에 적용');
  const contentAfter=(await json(await h.api.route(h.base+'/content'))).content;
  assert.deepEqual(contentAfter.assets.main.value,[result.storageKey]);assert.deepEqual(contentAfter.assets.additional.value,[h.keys[1]]);
  for(const role of ['detail','label','detailTop','detailBottom'])assert.deepEqual(contentAfter.assets[role],contentBefore.assets[role]);
  const beforeOptions=(await json(await h.api.route(h.base+'/options'))).options;
  await h.click('검토한 결과를 같은 원본의 옵션 대표 이미지에 적용');
  const afterOptions=(await json(await h.api.route(h.base+'/options'))).options;
  assert.equal(afterOptions.rows[0].imageKey,result.storageKey);assert.equal(afterOptions.rows[1].imageKey,null);
  assert.deepEqual(afterOptions.rows.map(row=>({...row,imageKey:null,updatedAt:null})),beforeOptions.rows.map(row=>({...row,imageKey:null,updatedAt:null})));
  const quote=await json(await h.api.route(h.base+'/quotation-fields'));assert.equal(quote.resolved.rows[0].fields.mainImage.value,result.storageKey);
  await json(await h.api.route(h.base+'/quotation-fields',{method:'PUT',body:{expectedRevision:quote.revision,expectedInputFingerprint:quote.inputFingerprint,changes:[{fieldKey:'mainImage',optionId:quote.resolved.rows.filter(row=>row.optionId)[1].optionId,value:''}]}}));
  const profile=await h.api.load('db/category-profiles.ts').createCategoryProfile('owner',h.api.context.category,'cat'),exports=h.api.load('app/exports/quotation-source.ts');
  const source=await exports.readQuotationExportSource('owner',h.base.split('/').at(-1),profile.id),resolved=exports.resolveQuotationExport(source);
  const product=h.api.sqlite.prepare('SELECT * FROM products').get(),assets=JSON.parse(product.image_keys).map((key,index)=>({key,name:`assets/${index}.png`}));
  const rows=h.api.load('app/exports/quotation-fields.ts').resolvedQuotationRows(source,resolved,assets),fields=['skuId','mainImage'],workbook=quotationWorkbook(fields),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const output=await h.api.load('app/exports/mapped-quotation.ts').createMappedQuotation({originalBytes:workbook,profile:{...profile,template:{name:'cleanup.xlsx',format:'xlsx',sheetName:'견적서',headerRow:1,headers:fields,sha256},mappings:fields.map((field,column)=>({field,column,required:false}))},rows,dataStartRow:2});
  const reader=h.api.load('app/xlsx-template.ts'),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(output.bytes));
  assert.equal(reader.xlsxHeaders(sheet,'견적서',2)[1],assets.find(asset=>asset.key===result.storageKey).name.split('/').at(-1));assert.equal(reader.xlsxHeaders(sheet,'견적서',3)[1],'');
  assert.equal(h.provider.length,1);
 }finally{h.close();}
});

test('cleanup uses saved background choice and still requires the exact reviewed purpose, settings and approval',async()=>{
 const h=await fixture('A01464742');try{
  h.api.sqlite.prepare("UPDATE workspace_settings SET payload=json_set(payload,'$.removeBackground',json('true'))").run();
  await h.click('저장된 설정·실행 이력 새로고침 · 무료');
  const select=nodes(h.render()).find(n=>n.type==='select'&&nodes(n).some(option=>option.type==='option'&&option.props.value==='cleanup'));
  assert.ok(select);select.props.onChange({target:{value:'cleanup'}});await h.click('이미지 요청 검토하기 · 무료');
  const saved=h.api.sqlite.prepare('SELECT * FROM image_jobs').get(),review=JSON.parse(saved.review);
  assert.equal(review.recipe.find(step=>step.key==='background').status,'applied');assert.equal(review.recipe.find(step=>step.key==='translation').status,'skipped');
  assert.match(review.effectivePrompt,/plain white/);assert.match(review.effectivePrompt,/existing watermarks/);
  const request=JSON.parse(h.calls.find(call=>call.init?.method==='POST').init.body);
  const changed=await h.request(h.base+'/image-generation',{method:'POST',body:JSON.stringify({...request,purpose:'translate'})});assert.equal(changed.status,409);
  const execute={method:'POST',body:JSON.stringify({action:'execute',jobId:saved.id})};assert.equal((await h.request(h.base+'/image-generation',execute)).status,409);
  const checkbox=nodes(h.render()).find(n=>n.type==='input'&&n.props.type==='checkbox'&&!n.props.disabled);checkbox.props.onChange({target:{checked:true}});await h.click('유료 요청 승인 · 아직 호출하지 않음');
  h.api.sqlite.prepare("UPDATE workspace_settings SET payload=json_set(payload,'$.removeBackground',json('false'))").run();
  assert.equal((await h.request(h.base+'/image-generation',execute)).status,409);assert.equal(h.provider.length,0);
  const unchanged=h.api.sqlite.prepare('SELECT * FROM image_jobs').get();assert.equal(unchanged.status,'approved');assert.equal(unchanged.review,saved.review);
 }finally{h.close();}
});
