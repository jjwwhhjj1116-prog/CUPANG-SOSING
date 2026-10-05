import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import ts from 'typescript';
import {readSupplierHubCategoryBranch} from '../extensions/supplier-hub/catalog-page.mjs';
import {readAppSupplierHubCatalog} from '../extensions/supplier-hub/catalog.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}],origin='https://supplier.coupang.com';
const root={categoryId:'100',name:'시험 대분류',isLeaf:false},parent={categoryId:'200',name:'시험 중분류',isLeaf:false},leaf={categoryId:'300',name:'시험 최종분류',isLeaf:true};
const dto=node=>({leaf:node.isLeaf,displayItemCategoryDto:{displayItemCategoryCode:Number(node.categoryId),name:node.name}});
const plain=value=>JSON.parse(JSON.stringify(value));
const sortedKeys=value=>Array.isArray(value)?value.map(sortedKeys):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sortedKeys(value[key])])):value;
function page(company,{response,after,path='/qvt/registration'}={}){
  const calls=[],document={body:{innerText:'Company Code: '+company.code}},location={origin,pathname:path};
  const fetcher=async(url,init)=>{
    calls.push({url,...init});const code=new URL(url).searchParams.get('categoryCode');
    const body=code==='200'?[dto(leaf)]:code==='100'?[dto(parent)]:[dto(root)];
    const result=response?response(url,body):Response.json(body);Object.defineProperty(result,'url',{value:url});after?.(calls.length,document,location);return result;
  };
  return {calls,run:(trail=[])=>vm.runInNewContext(`(${readSupplierHubCategoryBranch.toString()})(trail,company)`,{location,document,trail,company,fetch:fetcher,URL,AbortController,Uint8Array,TextDecoder,setTimeout,clearTimeout,Date})};
}
test('official category reader verifies every ancestor and preserves display codes and complete breadcrumbs for both companies',async()=>{
  for(const company of companies){const h=page(company),result=await h.run([root,parent]);
    assert.deepEqual(plain(result.children),[leaf]);assert.deepEqual(plain(result.trail),[root,parent]);assert.deepEqual(plain(result.company),company);
    assert.equal(result.fullCatalogVerified,false);assert.equal(result.source,'supplier-hub-category-api');assert.equal(h.calls.length,3);
    assert.deepEqual(h.calls.map(call=>new URL(call.url).pathname),['/sr/category/api/','/sr/category/api/find-by-parent-category-code','/sr/category/api/find-by-parent-category-code']);
    assert.ok(h.calls.every(call=>call.method==='GET'&&call.credentials==='same-origin'&&call.redirect==='error'&&call.body===undefined));
  }
});
test('forged parent names, leaf ancestors and changed company or page never yield a category',async()=>{
  for(const trail of [[{...root,name:'다른 이름'}],[{...root,isLeaf:true}],[root,root]])await assert.rejects(page(companies[0]).run(trail));
  await assert.rejects(page(companies[0],{after:(i,doc)=>{if(i===2)doc.body.innerText='Company Code: A01526306';}}).run([root]));
  await assert.rejects(page(companies[0],{after:(i,doc,location)=>{location.pathname='/settings';}}).run());
  await assert.rejects(page(companies[0],{path:'/settings'}).run());
});
test('login HTML, failed responses, malformed DTOs and oversized streams are rejected',async()=>{
  for(const response of [()=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}}),()=>Response.json({data:[]}),()=>Response.json([]),()=>Response.json([dto(root),dto(root)]),()=>Response.json([{...dto(root),leaf:'false'}]),()=>Response.json([{leaf:false,displayItemCategoryDto:{displayItemCategoryCode:9007199254740992,name:'unsafe'}}]),()=>Response.json([{leaf:true,displayItemCategoryDto:{displayItemCategoryCode:'001',name:'leading zero'}}]),()=>new Response('x'.repeat(512*1024+1),{headers:{'content-type':'application/json'}}),()=>Response.json([],{status:401})])await assert.rejects(page(companies[0],{response}).run());
});
function dispatcher({company=companies[0],contexts,tabs,changeTab,serialize=value=>value}={}){
  const calls=[],sender={url:'http://localhost:3000/',frameId:0,tab:{id:1,windowId:7}},app={id:1,windowId:7,url:sender.url};
  const hub={id:2,windowId:7,url:origin+'/qvt/registration'};let reads=0;
  const api={tabs:{async get(id){calls.push(['get',id]);return changeTab?.(id,calls)??(id===1?app:hub);},async query(query){calls.push(['query',query]);return tabs??[hub];},async sendMessage(id,message,options){calls.push(['context',id,message,options]);return contexts?.[reads++]??{ok:true,ownerId:'owner',company};}},scripting:{async executeScript({target,func,args}){calls.push(['script',target.tabId,func.name]);return[{result:serialize(func.name==='verifySupplierHubCompany'?{code:company.code}:await page(company).run(args[0]))}];}}};
  return {calls,sender,run:trail=>readAppSupplierHubCatalog({type:'YOOFAM_READ_CATEGORY_BRANCH',trail:trail??[]},sender,api)};
}
test('extension catalog requests use only this app window and approved company without creating tabs or changing forms',async()=>{
  for(const company of companies){const h=dispatcher({company}),result=await h.run([root,parent]);assert.equal(result.ownerId,'owner');assert.deepEqual(plain(result.children),[leaf]);
    const query=h.calls.find(call=>call[0]==='query')[1];assert.equal(query.windowId,7);assert.deepEqual(query.url,[origin+'/dashboard/KR*',origin+'/qvt/registration*',origin+'/qvt/wims*',origin+'/sr/registration*']);
    assert.deepEqual(h.calls.filter(call=>call[0]==='script').map(call=>[call[1],call[2]]),[[2,'verifySupplierHubCompany'],[2,'readSupplierHubCategoryBranch']]);assert.equal(h.calls.filter(call=>call[0]==='context').length,2);
  }
});
test('wrong app frame, other windows and changed member/company reject catalog replies',async()=>{
  const h=dispatcher();h.sender.frameId=1;await assert.rejects(h.run());assert.equal(h.calls.length,0);
  await assert.rejects(dispatcher({tabs:[{id:3,windowId:9,url:origin+'/qvt/registration'}]}).run());
  for(const latest of [{ok:true,ownerId:'other',company:companies[0]},{ok:true,ownerId:'owner',company:companies[1]},{ok:false},{ok:true,ownerId:'owner',company:{}}])await assert.rejects(dispatcher({contexts:[{ok:true,ownerId:'owner',company:companies[0]},latest]}).run());
  await assert.rejects(dispatcher({changeTab:id=>id===2?{id:2,windowId:7,url:origin+'/qvt/registration',pendingUrl:origin+'/login'}:undefined}).run());
});
const exchangeCalls=[];let catalogReply;
const client={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/supplier-hub-catalog.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:client,Date,Error,require:()=>({exchange:async(type,payload,signal)=>{if(signal.aborted)throw Error('cancelled');exchangeCalls.push({type,payload:plain(payload)});return type==='PING'?{categoryCatalog:true}:{branch:catalogReply};}})});
for(const company of companies)test(`Chrome object-key reordering preserves exact root and multi-level category navigation (${company.code})`,async()=>{
 for(const trail of [[],[root],[root,parent]]){
  const h=dispatcher({company,serialize:sortedKeys});catalogReply=await h.run(trail);
  const branch=await client.loadSupplierHubCategoryBranch(trail,new AbortController().signal);
  assert.deepEqual(plain(branch.trail),plain(trail));assert.deepEqual(plain(branch.children),[trail.length===0?root:trail.length===1?parent:leaf]);assert.deepEqual(plain(branch.company),company);
  if(trail.length)assert.notEqual(JSON.stringify(branch.trail),JSON.stringify(trail),'serialization must actually reorder keys');
  const choice=client.hubCategoryChoice(branch,branch.children[0]);assert.deepEqual(plain(choice.path),[...trail.map(node=>node.name),branch.children[0].name]);
 }
});
test('app branch validation accepts independently reordered requested and returned node keys',async()=>{
 const branch={...plain(await page(companies[0]).run([root,parent])),ownerId:'owner'};
 for(const [actual,expected] of [[sortedKeys(branch),[root,parent]],[branch,sortedKeys([root,parent])]])assert.deepEqual(plain(client.validateHubCategoryBranch(actual,expected).trail),plain(branch.trail));
});
test('semantic trail comparison still rejects wrong order, values, missing fields and unobserved extra fields',async()=>{
 const original={...plain(await page(companies[0]).run([root,parent])),ownerId:'owner'};
 for(const trail of [[parent,root],[root],[root,parent,parent],[{...root,categoryId:'999'},parent],[{...root,name:'다른 이름'},parent],[{...root,isLeaf:true},parent],[{...root,isLeaf:'false'},parent],[{categoryId:root.categoryId,name:root.name},parent],[{...root,guessedKanCategoryId:'999'},parent],null]){
  const response={...sortedKeys(original),trail:sortedKeys(trail)};
  assert.throws(()=>client.validateHubCategoryBranch(response,[root,parent]));
  await assert.rejects(dispatcher({serialize:value=>value.source?response:value}).run([root,parent]),/상위 경로/);
 }
 assert.throws(()=>client.validateHubCategoryBranch(original,[{...root,guessedKanCategoryId:'999'},parent]));
});
test('live leaf selection carries the exact display code and full path, never a guessed kan ID or confirmed schema',async()=>{
  const branch={...plain(await page(companies[0]).run([root,parent])),ownerId:'owner'};
  const choice=client.hubCategoryChoice(branch,leaf);assert.equal(choice.categoryId,'300');assert.deepEqual(plain(choice.path),['시험 대분류','시험 중분류','시험 최종분류']);assert.equal(choice.codeEvidence,'supplier-hub');assert.equal(choice.templateLinked,false);
  for(const patch of [{fullCatalogVerified:true},{company:{}},{trail:[parent]},{children:[leaf,leaf]},{children:[root]},{observedAt:Date.now()+120000}])assert.throws(()=>client.validateHubCategoryBranch({...branch,...patch},[root,parent]));
  assert.throws(()=>client.hubCategoryChoice(branch,{...leaf,categoryId:'301'}));
});
test('catalog context API exposes only the authenticated member approved company',async()=>{
  let user;const api={};const companyModule={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/supplier-hub-company.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:companyModule});
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/api/supplier-hub/catalog-context/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:api,require:name=>name==='next/server'?{NextResponse:Response}:name.includes('chatgpt-auth')?{getChatGPTUser:async()=>user}:companyModule});
  for(const company of companies){user={userId:'owner',verifiedAccess:true,email:'private@example.test',membership:{role:'admin',status:'approved',companyCode:company.code,companyName:company.name}};const response=await api.GET();assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),{ownerId:'owner',company});}
  user={userId:'owner',verifiedAccess:true,membership:{status:'pending',companyCode:companies[0].code,companyName:companies[0].name}};assert.equal((await api.GET()).status,403);
  user={userId:'owner',membership:{status:'approved',companyCode:companies[0].code,companyName:companies[0].name}};assert.equal((await api.GET()).status,401);
});
test('confirming a live leaf rechecks its current code, ancestors and member before writing a profile',async()=>{
  const branch={...plain(await page(companies[0]).run([root,parent])),ownerId:'owner'},choice=client.hubCategoryChoice(branch,leaf);
  catalogReply=branch;exchangeCalls.length=0;await client.verifyLiveHubCategoryChoice(choice,new AbortController().signal);
  assert.deepEqual(exchangeCalls.map(call=>call.type),['PING','CATEGORIES']);assert.deepEqual(exchangeCalls[1].payload.trail,[root,parent]);
  for(const patch of [{ownerId:'other'},{company:companies[1]},{children:[{...leaf,name:'변경된 최종분류'}]},{children:[{...leaf,categoryId:'301'}]}]){catalogReply={...branch,...patch};await assert.rejects(client.verifyLiveHubCategoryChoice(choice,new AbortController().signal));}
  exchangeCalls.length=0;await client.verifyLiveHubCategoryChoice({...choice,supplierHub:undefined},new AbortController().signal);assert.equal(exchangeCalls.length,0);
  await assert.rejects(client.verifyLiveHubCategoryChoice(choice,AbortSignal.abort()));
});
test('a newly read leaf keeps its exact category through profile creation, URL intake and editable quotation without claiming an unknown schema',async()=>{
  for(const company of companies){const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
    try{
      const branch={trail:[root],children:[{...leaf,categoryId:'991234'}],ownerId:'owner',company,source:'supplier-hub-category-api',fullCatalogVerified:false,observedAt:Date.now()},choice=client.hubCategoryChoice(branch,branch.children[0]);
      const catalog={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/category-catalog.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports:catalog,require:name=>name==='@/app/category-profiles'?h.load('app/category-profiles.ts'):JSON.parse(fs.readFileSync(new URL('../docs/'+name.slice(8),import.meta.url),'utf8'))});
      const input=catalog.categoryProfileForChoice(choice),created=await h.load('app/api/category-profiles/route.ts').POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(input)}));
      assert.equal(created.status,201,await created.clone().text());const {profile}=await created.json();assert.equal(profile.categoryId,'991234');assert.deepEqual(profile.categoryPath,[root.name,leaf.name]);assert.equal(profile.template,null);
      h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
      assert.match(await h.intake(),/상품 초안 저장됨/);const product=h.sqlite.prepare('SELECT * FROM products').get(),path='/api/products/'+product.id+'/quotation-fields',view=await (await h.route(path)).json();
      assert.equal(view.categoryContext.categoryId,'991234');assert.deepEqual(view.categoryContext.categoryPath,[root.name,leaf.name]);assert.equal(view.resolved.schema.status,'unconfirmed');assert.equal(view.resolved.rows.filter(row=>row.optionId!==null).length,6);
      const saved=await h.route(path,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:'title',optionId:null,value:'사용자 검토 상품명'}]}});assert.equal(saved.status,200,await saved.clone().text());
      const updated=await (await h.route(path)).json();assert.equal(updated.categoryContext.categoryId,'991234');assert.equal(updated.resolved.rows[0].fields.title.value,'사용자 검토 상품명');assert.equal(updated.resolved.rows[0].fields.title.source,'manual-common');
      assert.ok(h.calls.every(path=>!path.includes('/supplier-hub-receipt')));
    }finally{h.close();}
  }
});
