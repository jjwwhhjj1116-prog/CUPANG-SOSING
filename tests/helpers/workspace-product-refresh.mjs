import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './mobile-intake.mjs';
import {quotationWorkbook} from './quotation-workbook.mjs';

const native=createRequire(import.meta.url),testUrl=new URL('../dashboard-account-actions.test.mjs',import.meta.url).href;
export const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
export const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
export const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
export const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const scope=(ownerId='owner',code='A01526306')=>({ownerId,company:{code,name:code==='A01526306'?'유앤채':'와이홉'}});
const digest=async bytes=>Buffer.from(await webcrypto.subtle.digest('SHA-256',bytes)).toString('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64');
function declaration(file,name){
 const source=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const node=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(node,name);return node.getText(ast);
}
// Extract only reusable fixtures; importing complete test modules would also
// register their test cases and obscure this independent regression's count.
const makeFixture=vm.runInNewContext('('+declaration('receipt-summary-transmission-order.test.mjs','fixture')+')',
 {mobileIntakeHarness,quotationWorkbook,assert,json,digest,png,Buffer,Uint8Array,Date,JSON});
const originalHarness=declaration('dashboard-account-actions.test.mjs','harness');

export async function workspaceRefreshFixture(company){
 const f=await makeFixture(company);
 const productResponse=id=>f.load('app/api/products/[id]/route.ts').GET(new Request('https://app.test/api/products/'+id),{params:Promise.resolve({id})});
 const current=async(id=f.product.id)=>(await json(await productResponse(id))).product;
 const savePatch=async(patch,id=f.product.id)=>{
  const base='/api/products/'+id,content=(await json(await f.route(base+'/content'))).content;
  await json(await f.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch}}));return current(id);
 };
 const addSibling=async()=>{
  const product=await current(),id=webcrypto.randomUUID();
  await f.load('db/queries.ts').insertProduct({...product,id,title:'다른 합성 상품',source_url:'https://detail.1688.com/offer/640000000002.html'});
  return current(id);
 };
 return{...f,company,current,savePatch,productResponse,addSibling};
}

/** The existing actual Dashboard/private DetailPanel callback renderer, with
 * only its product fixture transport changed to the real owned local APIs. */
export async function workspaceRefreshUI(f,{initialListDeferred=false,realOptionBoard=false,realRegistrationBoard=false,confirmClose=false}={}){
 const fixtureProducts=(await f.list()).products,plans=[],optionPlans=[];
 const deferredList=()=>{
  const wait=deferred(),arrival=deferred(),plan={wait:wait.promise,fail:false};plans.push(plan);
  plan.arrive=arrival.resolve;
  return{arrived:arrival.promise,release(){wait.resolve();},releaseFailure(){plan.fail=true;wait.resolve();}};
 };
 const initial=initialListDeferred?deferredList():null;
 const actualList=async()=>{
  const plan=plans.shift(),response=await f.load('app/api/products/route.ts').GET();
  if(!plan)return response;plan.arrive();await plan.wait;
  return plan.fail?Response.json({error:'합성 목록 조회 실패'},{status:503}):response;
 };
 const deferOptionBoard=()=>{
  const wait=deferred(),arrival=deferred(),plan={wait:wait.promise,fail:false};optionPlans.push(plan);
  plan.arrive=arrival.resolve;
  return{arrived:arrival.promise,release(){wait.resolve();},releaseFailure(){plan.fail=true;wait.resolve();}};
 };
 const actualProductRequest=async(url,init)=>{
  if(init.signal?.aborted)throw Error('합성 조회 취소');
  const plan=url.endsWith('/options')?optionPlans.shift():null,response=await f.route(url,{method:init.method??'GET',body:init.body});
  if(!plan)return response;plan.arrive();await plan.wait;
  if(init.signal?.aborted)throw Error('합성 조회 취소');
  return plan.fail?Response.json({error:'합성 이전 옵션 조회 실패'},{status:503}):response;
 };
 const source=originalHarness.replaceAll('import.meta.url','testUrl')
  .replace("const products=officialFlow?.products??[product('product-a'),product('product-b')];",'const products=fixtureProducts;')
  .replace("if(url==='/api/products')return Response.json({products});","if(url==='/api/products')return actualList();")
  .replace("if(url.startsWith('/api/products/')){","if(url.endsWith('/pricing')&&init.method==='POST')return actualPricing(url,init);if(realOptionBoard&&url.startsWith('/api/products/')&&url!==productBase)return actualProductRequest(url,init);if(url.startsWith('/api/products/')){");
 assert.ok(source.includes('return actualList()')&&source.includes('const products=fixtureProducts;'));
 const makeHarness=vm.runInNewContext('('+source+')',{fs,vm,ts,native,nodes,text,deferred,scope,assert,Response,Request,AbortController,URLSearchParams,URL,Date,Intl,TextEncoder,TextDecoder,
  structuredClone,crypto:webcrypto,setImmediate,setTimeout,fixtureProducts,actualList,actualPricing:(url,init)=>f.route(url,{method:init.method,body:init.body}),actualProductRequest,productBase:f.base,testUrl});
 const h=makeHarness({workspaceOwnerId:'owner',settingsBody:{settings:f.settings,scope:scope('owner',f.company.code)},profiles:[f.context.category],realOptionBoard,realRegistrationBoard,confirmClose});
 h.setProductReply(f.productResponse);
 const holdDetail=async(id=f.product.id)=>{
  const response=await f.productResponse(id),pending=h.deferProduct(id);
  return{release(){pending.resolve(response);},releaseFailure(){pending.resolve(Response.json({error:'합성 상세 조회 실패'},{status:503}));}};
 };
 const notifySaved=()=>{const editor=h.component('product-content-editor');assert.ok(editor);editor.onSaved();};
 const open=async(id=f.product.id)=>{h.component('registration-board').onOpen(await f.current(id),'SEO');await h.settle();};
 const editor=()=>h.component('product-content-editor')?.product;
 const row=(id=f.product.id)=>h.component('registration-board').products.find(product=>product.id===id);
 const editDraft=value=>{
  const field=nodes(h.render()).find(node=>node.props?.['data-test-editor']==='product-content-editor');assert.ok(field);field.props.onChange({target:{value}});
 };
 const draft=()=>nodes(h.render()).find(node=>node.props?.['data-test-editor']==='product-content-editor')?.props.value;
 return{...h,initial,holdDetail,deferList:deferredList,deferOptionBoard,notifySaved,open,editor,row,editDraft,draft,
  errors:()=>nodes(h.render()).filter(node=>node.props?.role==='alert').map(text)};
}
