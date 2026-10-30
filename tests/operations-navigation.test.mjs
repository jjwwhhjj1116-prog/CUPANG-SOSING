import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const visibleNodes=tree=>Array.isArray(tree)?tree.flatMap(visibleNodes):tree&&typeof tree==='object'&&!tree.props?.hidden?[tree,...visibleNodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
const turn=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(initialSearch='',{fetcher}={}){
 const slots=[],effects=[],cache=new Map(),requests=[],pushed=[],events=new Map();let cursor=0,dirty=false,closed=false,tree;
 const location={search:initialSearch},snapshot={document:{records:{jobs:[]}},revision:0,scope:{ownerId:'owner',companyCode:'A01464742',companyName:'와이홉'},accountContext:'scope',derived:{},updatedAt:null};
 const hooks={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{const next=typeof value==='function'?value(slots[i]):value;if(!Object.is(next,slots[i])){slots[i]=next;dirty=true;}}];},
  useRef(value){const i=cursor++;return slots[i]??(slots[i]={current:value});},
  useCallback(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((value,index)=>!Object.is(value,old.deps[index])))slots[i]={deps,value:fn};return slots[i].value;},
  useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((value,index)=>!Object.is(value,old.deps[index]))){const next={deps};slots[i]=next;effects.push(()=>{old?.cleanup?.();next.cleanup=fn();});}}
 };
 function Link(){return null;}
 function SourcingView(){return null;}function SalesView(){return null;}function FinanceView(){return null;}function LogisticsView(){return null;}
 function ActionButton(){return null;}function RecordPanel(){return null;}
 function load(file){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
   {exports,URLSearchParams,Intl,Date,Error,AbortController,location,window:{addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:(name,fn)=>{if(events.get(name)===fn)events.delete(name);},scrollTo(){}},history:{pushState(_state,_unused,url){pushed.push(url);location.search=new URL(url,'https://app.test').search;}},
    fetch:async(url,options)=>{const request={url,options};requests.push(request);if(fetcher)return fetcher(request,requests.length-1,snapshot);assert.equal(options?.method??'GET','GET','view navigation cannot write or collect');return Response.json(snapshot);},
    require(name){if(name.endsWith('.css'))return{};if(name==='react')return hooks;if(name==='next/link')return{default:Link};if(name==='./components/sourcing')return{SourcingView};if(name==='./components/sales')return{SalesView};if(name==='./components/finance')return{FinanceView};if(name==='./components/logistics')return{LogisticsView};if(name==='./components/shared')return{ActionButton,RecordPanel};if(name==='./collector')return{collectorRows:()=>assert.fail('navigation must not ingest'),requestCollector:()=>assert.fail('navigation must not contact external collectors'),supportsCollection:()=>false};if(name.startsWith('.')){const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),name));return load(target+(fs.existsSync(new URL('../'+target+'.tsx',import.meta.url))?'.tsx':'.ts'));}return native(name);}
   },{filename:file});return exports;
 }
 const client=load('app/operations/operations-client.tsx').default,nav=load('app/operations/components/navigation.tsx');
 function render(){assert.equal(closed,false);for(let pass=0;pass<20;pass++){dirty=false;cursor=0;tree=client();effects.splice(0).forEach(fn=>fn());if(!dirty)return tree;}assert.fail('Unstable operations navigation');}
 function sidebar(){const element=nodes(render()).find(node=>node.type===nav.OperationsNavigation);assert.ok(element);return nav.OperationsNavigation(element.props);}
 function button(label){return visibleNodes(sidebar()).find(node=>node.type==='button'&&(node.props['aria-label']===label||text(node).trim()===label));}
 render();
 return {requests,pushed,snapshot,render,sidebar,button,location,Link,
  title:()=>text(nodes(render()).find(node=>node.type==='h1')),
  active:()=>nodes(sidebar()).filter(node=>node.props?.['aria-current']==='page').map(text),
  context:()=>nodes(render()).find(node=>node.props?.ctx)?.props.ctx,
  status:()=>text(nodes(render()).find(node=>node.props?.className?.startsWith('ops-save-state'))),
  refresh(){const target=nodes(render()).find(node=>node.type===ActionButton&&text(node)==='새로고침');assert.ok(target);return target.props.onClick();},
  year(value){nodes(render()).find(node=>node.type==='select'&&node.props['aria-label']==='운영 연도').props.onChange({target:{value:String(value)}});render();},
  click(label){const target=button(label);assert.ok(target,label);target.props.onClick();render();},
  pop(search){location.search=search;events.get('popstate')?.();return render();},
  async settle(){await turn();return render();},
  close(){for(const slot of slots)slot?.cleanup?.();closed=true;}
 };
}

test('all nineteen grouped operations and the studio return remain available without writing a workspace',async()=>{
 const h=fixture();try{
  await h.settle();const groups=nodes(h.sidebar()).filter(node=>node.type==='section'&&node.props.className==='studio-menu-group');assert.equal(groups.length,5);assert.deepEqual(groups.map(group=>nodes(group).filter(node=>node.type==='button'&&!node.props['aria-controls']).length),[0,5,6,4,4]);
  assert.equal(h.title(),'신규상품 발굴');assert.deepEqual(h.active(),['신규상품 발굴']);assert.ok(nodes(h.sidebar()).some(node=>node.type==='a'&&node.props.href==='/'&&text(node)==='AI상품등록'));
  assert.ok(nodes(h.sidebar()).some(node=>node.type==='a'&&node.props.href==='/?view=archive'&&text(node)==='상품관리'));
  for(const group of groups.filter(group=>group.props['aria-label']!=='로켓배송')){const toggle=h.button(group.props['aria-label']);if(!toggle.props['aria-expanded'])h.click(group.props['aria-label']);for(const item of nodes(group).filter(node=>node.type==='button'&&!node.props['aria-controls'])){const label=text(item);h.click(label);assert.equal(h.title(),label);assert.deepEqual(h.active(),[label]);}}
  assert.equal(h.pushed.length,19);assert.equal(h.requests.length,1);assert.ok(h.requests.every(request=>(request.options?.method??'GET')==='GET'));
 }finally{h.close();}
});

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const savedSnapshot=(base,revision=1)=>({...structuredClone(base),revision,updatedAt:'2026-10-30T01:02:03.000Z',document:{records:{jobs:[],skus:[{id:'saved-sku',values:{name:'저장한 상품'}}]}}});

for(const oldResult of ['success','failure','auth rejection'])test(`a deferred pre-save GET ${oldResult} cannot roll back a newer POST acknowledgement`,async()=>{
 const read=deferred(),write=deferred(),h=fixture('',{fetcher:(request,index,base)=>index===0?Response.json(base):request.options?.method==='POST'?write.promise:read.promise});
 try{
  await h.settle();const initial=h.context().snapshot,readWork=h.refresh();h.render();assert.equal(h.context().busy,true);
  const saving=h.context().command({type:'upsert',dataset:'skus',values:{name:'저장한 상품'}});h.render();const post=h.requests.find(request=>request.options?.method==='POST');assert.ok(post);const body=JSON.parse(post.options.body);assert.equal(body.expectedRevision,0);assert.equal(body.accountContext,initial.accountContext);
  const ack=savedSnapshot(initial);write.resolve(Response.json(ack));assert.equal(await saving,true);await h.settle();assert.equal(h.context().snapshot.revision,1);assert.equal(h.context().snapshot.document.records.skus[0].values.name,'저장한 상품');
  if(oldResult==='success')read.resolve(Response.json(initial));else if(oldResult==='auth rejection')read.resolve(Response.json({error:'이전 요청의 인증 오류'},{status:403}));else read.reject(Error('늦게 도착한 이전 조회 오류'));
  await readWork;await h.settle();assert.equal(h.context().snapshot.revision,1);assert.equal(h.context().snapshot.updatedAt,ack.updatedAt);assert.equal(h.context().busy,false);assert.equal(h.context().error,'');assert.equal(h.requests.filter(request=>request.options?.method==='POST').length,1);
 }finally{h.close();}
});

for(const method of ['GET','POST'])for(const rejection of [{status:401},{status:403},{status:409,code:'OPERATIONS_SCOPE_CHANGED'}])test(`${method} ${rejection.status} ${rejection.code??''} removes prior company data until a manual fresh-scope reload`,async()=>{
 let phase='initial',scopeB;const h=fixture('',{fetcher:(request,_index,base)=>{
  if(phase==='initial')return Response.json(savedSnapshot(base,2));
  if(phase==='reject')return rejection.status===401?new Response('<p>로그인 만료</p>',{status:401,headers:{'content-type':'text/html'}}):Response.json({error:'현재 회원의 승인 회사정보를 다시 확인해주세요.',...rejection},{status:rejection.status});
  scopeB??={...structuredClone(base),accountContext:'owner-B-company-B',scope:{ownerId:'owner-B',companyCode:'A01526306',companyName:'유앤채'}};
  if(request.options?.method==='POST'){const body=JSON.parse(request.options.body);assert.equal(body.accountContext,scopeB.accountContext);assert.equal(body.expectedRevision,0);return Response.json(savedSnapshot(scopeB));}
  return Response.json(scopeB);
 }});try{
  await h.settle();const old=h.context();assert.equal(old.snapshot.scope.companyName,'와이홉');phase='reject';
  if(method==='GET'){h.year(old.year-1);await h.settle();}else{assert.equal(await old.command({type:'upsert',dataset:'skus',values:{name:'계정 변경 전 입력'}}),false);await h.settle();}
  assert.equal(h.context(),undefined);assert.doesNotMatch(text(h.render()),/와이홉|저장한 상품|저장 시각/);assert.match(text(h.render()),/현재 회원의 승인 회사정보/);const before=h.requests.length;
  assert.equal(await old.command({type:'upsert',dataset:'skus',values:{name:'retained old account'}}),false);assert.equal(h.requests.length,before,'authentication loss cannot retry a write');
  phase='fresh';await h.refresh();await h.settle();assert.equal(h.context().snapshot.scope.companyName,'유앤채');assert.equal(h.context().snapshot.revision,0);assert.equal(h.status(),'조회 완료 · 저장 이력 없음');
  assert.equal(await old.command({type:'upsert',dataset:'skus',values:{name:'owner A after B reload'}}),false);assert.equal(h.requests.length,before+1);
  assert.equal(await h.context().command({type:'upsert',dataset:'skus',values:{name:'owner B explicit save'}}),true);await h.settle();assert.equal(h.context().snapshot.accountContext,scopeB.accountContext);assert.equal(h.context().snapshot.revision,1);
 }finally{h.close();}
});

test('ordinary same-account CAS conflict keeps the saved snapshot and requires an explicit retry',async()=>{
 let writes=0;const h=fixture('',{fetcher:(request,_index,base)=>request.options?.method==='POST'?(writes++,Response.json({error:'다른 창에서 자료가 변경되었습니다.',code:'OPERATIONS_CONFLICT'},{status:409})):Response.json(savedSnapshot(base,2))});try{
  await h.settle();const before=JSON.stringify(h.context().snapshot),values={name:'직접 입력 유지'};assert.equal(await h.context().command({type:'upsert',dataset:'skus',values}),false);await h.settle();assert.equal(JSON.stringify(h.context().snapshot),before);assert.deepEqual(values,{name:'직접 입력 유지'});assert.equal(h.status(),'다른 창 변경 확인');assert.match(h.context().error,/다른 창/);assert.equal(writes,1);assert.equal(h.requests.length,2);
 }finally{h.close();}
});

test('read status uses the server update clock and an empty workspace never claims a new save',async()=>{
 const h=fixture();try{await h.settle();assert.equal(h.status(),'조회 완료 · 저장 이력 없음');assert.equal(h.context().snapshot.updatedAt,null);assert.equal(h.requests.length,1);}finally{h.close();}
 let stored;const existing=fixture('',{fetcher:(_request,_index,base)=>{stored=savedSnapshot(base,4);return Response.json(stored);}});try{
  await existing.settle();const formatted=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(stored.updatedAt));assert.equal(existing.status(),'저장 시각 '+formatted);assert.equal(existing.context().snapshot.revision,4);assert.equal(existing.requests.length,1);
 }finally{existing.close();}
});

test('a save keeps its request year and reloads the current year before enabling another save',async()=>{
 const write=deferred(),read=deferred(),h=fixture('',{fetcher:(request,index,base)=>index===0?Response.json(base):request.options?.method==='POST'?write.promise:read.promise});
 try{
  await h.settle();const old=h.context(),year=old.year,newYear=year-1,saving=old.command({type:'upsert',dataset:'skus',values:{name:'저장한 상품'}});h.render();assert.equal(h.requests[1].url,'/api/operations?year='+year);
  h.year(newYear);assert.equal(h.requests.length,2,'a year change cannot start a read in the middle of a write');
  const ack=savedSnapshot(old.snapshot);ack.derived={pnl:[{year,amount:100}]};write.resolve(Response.json(ack));assert.equal(await saving,true);await h.settle();assert.equal(h.requests.length,3);assert.equal(h.requests[2].url,'/api/operations?year='+newYear);assert.equal(h.context().busy,true);assert.notDeepEqual(h.context().snapshot.derived,ack.derived,'old-year calculation is not adopted into the new year');
  const current={...ack,derived:{pnl:[{year:newYear,amount:200}]}};read.resolve(Response.json(current));await h.settle();assert.equal(h.context().year,newYear);assert.equal(h.context().snapshot.revision,1);assert.deepEqual(JSON.parse(JSON.stringify(h.context().snapshot.derived)),current.derived);assert.equal(h.context().busy,false);
  assert.equal(await old.command({type:'upsert',dataset:'skus',values:{name:'retained old year'}}),false);assert.equal(h.requests.filter(request=>request.options?.method==='POST').length,1);
 }finally{h.close();}
});

test('an older read revision, a retained prior-account writer and a wrong-scope acknowledgement cannot replace current data',async()=>{
 let next,base;const h=fixture('',{fetcher:(request,index,initial)=>{base??=initial;if(index===0)return Response.json(savedSnapshot(initial,2));if(request.options?.method==='POST')return Response.json({...savedSnapshot(base,4),accountContext:'wrong',scope:{...base.scope,companyCode:'OTHER'}});return Response.json(next);}});
 try{
  await h.settle();const previous=h.context();next=savedSnapshot(base,1);await h.refresh();await h.settle();assert.equal(h.context().snapshot.revision,2);assert.match(h.context().error,/이전 버전/);
  next={...savedSnapshot(base,3),accountContext:'new-scope',scope:{ownerId:'second-owner',companyCode:'A01526306',companyName:'유앤채'}};await h.refresh();await h.settle();assert.equal(h.context().snapshot.accountContext,'new-scope');const before=h.requests.length;assert.equal(await previous.command({type:'upsert',dataset:'skus',values:{name:'old account'}}),false);assert.equal(h.requests.length,before);
  assert.equal(await h.context().command({type:'upsert',dataset:'skus',values:{name:'current account'}}),false);await h.settle();assert.equal(h.context().snapshot.accountContext,'new-scope');assert.equal(h.context().snapshot.revision,3);assert.match(h.context().error,/계정 범위/);
 }finally{h.close();}
});

test('settings deep links and browser back/forward keep the heading, breadcrumb and one active menu synchronized',async()=>{
 const h=fixture('?view=settings');try{
  await h.settle();assert.equal(h.title(),'공통 SKU·데이터 연결');assert.deepEqual(h.active(),['공통 SKU·데이터 연결']);
  const toggles=()=>nodes(h.sidebar()).filter(node=>node.type==='button'&&node.props.className?.startsWith('studio-menu-toggle'));
  assert.equal(toggles().length,5);assert.ok(toggles().every(node=>node.props['aria-expanded']===false));assert.equal(h.button('손익계산서'),undefined,'collapsed children cannot receive a menu click');
  h.click('손익계산');assert.equal(h.button('손익계산').props['aria-expanded'],true);assert.equal(h.button('손익계산').props['aria-controls'],'studio-menu-finance');assert.ok(h.button('손익계산서'));
  h.click('손익계산');assert.equal(h.button('손익계산').props['aria-expanded'],false);assert.equal(h.button('손익계산서'),undefined);assert.equal(h.title(),'공통 SKU·데이터 연결');assert.equal(h.pushed.length,0);assert.equal(h.requests.length,1);
  const breadcrumb=()=>nodes(h.render()).find(node=>node.type==='nav'&&node.props['aria-label']==='현재 위치');assert.match(text(breadcrumb()),/운영관리\/설정\/공통 SKU·데이터 연결/);
  h.click('손익계산');
  h.click('손익계산서');assert.equal(h.location.search,'?view=pnl');assert.equal(h.title(),'손익계산서');
  h.pop('?view=settings');assert.equal(h.title(),'공통 SKU·데이터 연결');assert.deepEqual(h.active(),['공통 SKU·데이터 연결']);
  assert.ok(toggles().every(node=>node.props['aria-expanded']===false));
  h.pop('?view=inventory');assert.equal(h.title(),'쿠팡 재고 현황');assert.deepEqual(h.active(),['쿠팡 재고 현황']);assert.equal(h.button('판매/분석').props['aria-expanded'],true);assert.equal(toggles().filter(node=>node.props['aria-expanded']).length,1);
  h.click('판매/분석');h.render();assert.equal(h.button('판매/분석').props['aria-expanded'],false,'same-view rerender preserves a manual collapse');
  h.pop('?view=invalid');assert.equal(h.title(),'신규상품 발굴');assert.equal(h.requests.length,1);
 }finally{h.close();}
});

test('mobile navigation announces its state and closes after a selection or its explicit close action',async()=>{
 const h=fixture();try{
  await h.settle();const toggle=()=>nodes(h.render()).find(node=>node.type==='button'&&node.props['aria-controls']==='operations-navigation');assert.equal(toggle().props['aria-expanded'],false);
  toggle().props.onClick();h.render();assert.equal(toggle().props['aria-expanded'],true);assert.match(h.sidebar().props.className,/open/);
  h.click('판매/분석');assert.equal(toggle().props['aria-expanded'],true,'expanding a category keeps the mobile menu open');h.click('매출 관리');assert.equal(toggle().props['aria-expanded'],false);assert.equal(h.title(),'매출 관리');
  toggle().props.onClick();h.render();nodes(h.sidebar()).find(node=>node.props?.['aria-label']==='메뉴 닫기').props.onClick();h.render();assert.equal(toggle().props['aria-expanded'],false);assert.equal(h.requests.length,1);
 }finally{h.close();}
});
