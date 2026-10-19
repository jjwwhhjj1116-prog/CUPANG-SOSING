import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {getRecommendations} from '../extensions/supplier-hub/category-predict-page.mjs';
import {readAppSupplierHubCategoryRecommendations} from '../extensions/supplier-hub/category-predict.mjs';

const origin='https://supplier.coupang.com';
const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const plain=value=>JSON.parse(JSON.stringify(value));
const sample=(number=1)=>({internalCategoryId:number,internalCategoryCode:String(10000+number),fullPathName:`패션의류잡화 > 남성패션 > 모자 ${number}`,name:`모자 ${number}`,privateAccount:'never-return'});
function page({company=companies[0],path='/dashboard/KR',rows=[sample(1),sample(2),sample(3),sample(4)],response,after,timeout=false}={}){
  const location={origin,pathname:path,href:origin+path},document={body:{innerText:'Company Code: '+company.code}},calls=[],timers=[];
  const context={company,location,document,Date,URL,Uint8Array,TextDecoder,AbortController,clearTimeout:timer=>clearTimeout(timer),
    setTimeout:(callback,ms)=>{timers.push(ms);return setTimeout(callback,timeout?1:ms);},
    fetch:async(url,init)=>{
      calls.push({url,...init});
      let result=response?await response(url,init):Response.json(rows);
      if(!Object.hasOwn(result,'url'))Object.defineProperty(result,'url',{value:url});
      after?.({location,document,calls});return result;
    }};
  return {location,document,calls,timers,run:(productName='남성 모자')=>vm.runInNewContext(`(${getRecommendations.toString()})(productName,company)`,{...context,productName})};
}

for(const company of companies)test(`official recommendation GET keeps the first three exact display codes and full paths (${company.code})`,async()=>{
  const h=page({company}),result=plain(await h.run('남성 모자 & 겨울/방한'));
  assert.equal(result.source,'supplier-hub-category-predict-api');assert.deepEqual(result.company,company);
  assert.equal(result.productName,'남성 모자 & 겨울/방한');assert.ok(Number.isSafeInteger(result.observedAt));
  assert.deepEqual(result.items,[1,2,3].map(number=>({id:String(number),code:String(10000+number),path:['패션의류잡화','남성패션',`모자 ${number}`],label:`패션의류잡화 > 남성패션 > 모자 ${number}`})));
  assert.deepEqual(h.timers,[14000]);assert.equal(h.calls.length,1);
  const call=h.calls[0];assert.equal(call.url,origin+'/sr/category/api/predict?productName='+encodeURIComponent(result.productName));
  assert.equal(call.method,'GET');assert.equal(call.credentials,'include');assert.equal(call.redirect,'error');assert.equal(call.cache,'no-store');assert.equal(call.body,undefined);
  assert.equal(JSON.stringify(result).includes('privateAccount'),false);
});

test('recommendation empty arrays and observed name fallback are valid, never category auto-selection',async()=>{
  assert.deepEqual(plain((await page({rows:[]}).run()).items),[]);
  const result=await page({rows:[{internalCategoryId:'internal-42',internalCategoryCode:'12345',name:'  단일 분류  '}]}).run();
  assert.deepEqual(plain(result.items),[{id:'internal-42',code:'12345',path:['단일 분류'],label:'단일 분류'}]);
  assert.equal(Object.hasOwn(result,'selection'),false);assert.equal(Object.hasOwn(result,'registered'),false);
});

test('malformed recommendation JSON, wrappers, HTTP replies, redirects and oversized bodies fail closed',async()=>{
  for(const response of [
    ()=>Response.json({data:[sample()]}),()=>Response.json(null),()=>new Response('{broken',{headers:{'content-type':'application/json'}}),
    ()=>new Response('<html>Login</html>',{headers:{'content-type':'text/html'}}),()=>Response.json([],{status:401}),
    ()=>{const response=Response.json([]);Object.defineProperty(response,'redirected',{value:true});return response;},
    ()=>{const response=Response.json([]);Object.defineProperty(response,'url',{value:origin+'/login'});return response;},
    ()=>new Response('x'.repeat(512*1024+1),{headers:{'content-type':'application/json'}}),
    ()=>Response.json([],{headers:{'content-length':String(512*1024+1)}}),
    ()=>new Response(new Uint8Array([0xff,0xfe]),{headers:{'content-type':'application/json'}}),
    ()=>Response.json(Array.from({length:1001},(_,index)=>sample(index+1))),
  ])await assert.rejects(page({response}).run());
});

test('recommendation DTOs must have genuine IDs, positive display codes and nonempty bounded paths',async()=>{
  for(const invalid of [null,[],{},
    {...sample(),internalCategoryId:0},{...sample(),internalCategoryId:9007199254740992},{...sample(),internalCategoryId:''},{...sample(),internalCategoryId:' 1'},
    {...sample(),internalCategoryCode:'001'},{...sample(),internalCategoryCode:'0'},{...sample(),internalCategoryCode:'123456789012345678901'},{...sample(),internalCategoryCode:Infinity},
    {...sample(),fullPathName:1},{...sample(),fullPathName:'A >> B'},{...sample(),fullPathName:Array(11).fill('분류').join('>')},
    {...sample(),fullPathName:'A>'+ '나'.repeat(241)},{...sample(),fullPathName:'A\nB'},
    {internalCategoryId:'1',internalCategoryCode:'123'},
  ])await assert.rejects(page({rows:[invalid]}).run());
  await assert.rejects(page({rows:[sample(),sample()]}).run());
  assert.equal((await page({rows:[sample(),sample(2),sample(3),null]}).run()).items.length,3,'only the observed first three recommendations are consumed');
});

test('page reader refuses invalid names, unapproved companies, unrelated routes and company/document changes',async()=>{
  for(const name of ['', ' ', 'x'.repeat(501), ' 모자 ', '모자\n다른 상품']){const h=page();await assert.rejects(h.run(name));assert.equal(h.calls.length,0);}
  for(const path of ['/login','/sr/registration/other','/qvt/wims/other']){const h=page({path});await assert.rejects(h.run());assert.equal(h.calls.length,0);}
  const unapproved=page({company:{code:'A1234',name:'다른회사'}});await assert.rejects(unapproved.run());assert.equal(unapproved.calls.length,0);
  for(const after of [
    ({document})=>{document.body.innerText='Company Code: A01464742';},
    ({location})=>{location.pathname='/login';location.href=origin+'/login';},
    ({location})=>{location.href+='?changed=1';},
  ])await assert.rejects(page({after}).run());
});

test('14-second deadline terminates an unresponsive fetch or stream without another endpoint',async()=>{
  for(const response of [()=>new Promise(()=>{}),()=>{const stream=new ReadableStream({start(){}});return new Response(stream,{headers:{'content-type':'application/json'}});}]){
    const h=page({timeout:true,response});await assert.rejects(h.run(),/시간/);assert.equal(h.calls.length,1);assert.deepEqual(h.timers,[14000]);assert.equal(h.calls[0].signal.aborted,true);
  }
});

function adapter({company=companies[0],contexts,tabPatch={},appPatch={},afterRead,serialize=value=>value,documentIds=true}={}){
  const sender={url:'http://localhost:3000/',frameId:0,documentId:'app-document',tab:{id:1,windowId:7}};
  const app={id:1,windowId:7,url:sender.url,...appPatch},hub={id:2,windowId:7,url:origin+'/dashboard/KR',status:'complete',...tabPatch};
  const requests=[],scripts=[],messages=[],mutations=[],h=page({company});let contextReads=0,hubDocumentId='hub-document';
  const api={tabs:{
    get:async id=>({...id===1?app:hub}),
    query:async query=>{assert.equal(query.windowId,7);return [{...hub}];},
    sendMessage:async(id,message,options)=>{messages.push({id,message,options});const context=contexts?.[contextReads++]??{ok:true,ownerId:'owner',company};return context;},
    create:async()=>{mutations.push('create');throw Error('No new tab allowed');},
    update:async()=>{mutations.push('update');throw Error('No navigation allowed');},
  },scripting:{executeScript:async({target,func,args})=>{
    scripts.push({target,func:func.name,args:plain(args)});
    if(target.documentIds&&target.documentIds[0]!==hubDocumentId)throw Error('No document with id');
    let result;
    if(func.name==='verifySupplierHubCompany')result={code:company.code};
    else{
      assert.equal(func.name,'getRecommendations');result=plain(await h.run(args[0]));requests.push(...h.calls);afterRead?.({app,hub,changeDocument:()=>{hubDocumentId='replacement-document';}});
    }
    return [{frameId:0,...documentIds?{documentId:hubDocumentId}:{},result:serialize(result)}];
  }}};
  return {sender,app,hub,api,scripts,messages,requests,mutations,run:(patch={})=>readAppSupplierHubCategoryRecommendations({type:'YOOFAM_RECOMMEND_CATEGORIES',productName:'  남성 모자  ',expectedOwnerId:'owner',...patch},sender,api)};
}

for(const company of companies)test(`same-window adapter verifies member/company before and after, preserving original tabs (${company.code})`,async()=>{
  const h=adapter({company}),original={...h.hub},result=await h.run();
  assert.deepEqual(result,{...plain(await page({company}).run()),observedAt:result.observedAt,ownerId:'owner'});
  assert.deepEqual(h.hub,original);assert.deepEqual(h.mutations,[]);assert.equal(h.requests.length,1);
  assert.deepEqual(h.scripts.map(script=>script.func),['verifySupplierHubCompany','getRecommendations','verifySupplierHubCompany']);
  assert.deepEqual(h.scripts[0].target,{tabId:2,frameIds:[0]});
  assert.deepEqual(h.scripts.slice(1).map(script=>script.target),[{tabId:2,documentIds:['hub-document']},{tabId:2,documentIds:['hub-document']}]);
  assert.equal(h.messages.length,2);assert.ok(h.messages.every(message=>message.id===1&&message.message.type==='YOOFAM_READ_CATALOG_CONTEXT'&&message.options.documentId==='app-document'));
  assert.equal(Object.hasOwn(result,'privateAccount'),false);
});

test('adapter rejects cross-frame/origin/window requests, mismatched expected owner and unapproved company before fetching',async()=>{
  for(const patch of [{frameId:1},{url:'https://other.test/'},{documentId:''},{tab:{id:1,windowId:-1}}]){const h=adapter();Object.assign(h.sender,patch);await assert.rejects(h.run());assert.equal(h.requests.length,0);}
  for(const patch of [{type:'other'},{expectedOwnerId:'other'},{expectedOwnerId:''},{productName:'x'.repeat(501)},{productName:'\n모자'}]){const h=adapter();await assert.rejects(h.run(patch));assert.equal(h.requests.length,0);}
  for(const tabPatch of [{windowId:8},{pendingUrl:origin+'/login'},{url:origin+'/login'},{url:'https://other.test/dashboard/KR'},{url:origin+'/dashboard/KR-other'}]){const h=adapter({tabPatch});await assert.rejects(h.run());assert.equal(h.requests.length,0);assert.deepEqual(h.mutations,[]);}
  const h=adapter({contexts:[{ok:true,ownerId:'owner',company:{code:'A123',name:'미승인'}}]});await assert.rejects(h.run());assert.equal(h.requests.length,0);
});

test('owner, company, original app URL, Hub URL and same-URL document changes discard recommendations',async()=>{
  for(const latest of [{ok:true,ownerId:'other',company:companies[0]},{ok:true,ownerId:'owner',company:companies[1]},{ok:false}])await assert.rejects(adapter({contexts:[{ok:true,ownerId:'owner',company:companies[0]},latest]}).run());
  for(const afterRead of [
    ({app})=>{app.url+='?other=1';},({app})=>{app.windowId=8;},
    ({hub})=>{hub.url+='?other=1';},({hub})=>{hub.pendingUrl=hub.url;},
    ({changeDocument})=>changeDocument(),
  ]){const h=adapter({afterRead});await assert.rejects(h.run());assert.deepEqual(h.mutations,[]);}
});

test('serialized result shape, timestamp, member company and label/path identity are revalidated without leaking extra payloads',async()=>{
  for(const patch of [{observedAt:Date.now()-60000},{observedAt:Date.now()+60000},{productName:'다른 상품'},{company:companies[1]},{items:[{id:'1',code:'123',path:['A'],label:'B'}]},{items:[{id:'1',code:'123',path:['A>B'],label:'A>B'}]}]){
    const h=adapter({serialize:result=>result.source?{...result,...patch}:result});await assert.rejects(h.run());
  }
  const h=adapter({serialize:result=>result.source?{...result,secret:'private',items:result.items.map(item=>({...item,privateValue:'private'}))}:result});
  const result=await h.run();assert.equal(JSON.stringify(result).includes('private'),false);
});
