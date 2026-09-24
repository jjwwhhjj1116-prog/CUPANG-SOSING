import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
function load(file,dependencies){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,Error,fetch:dependencies.fetch,URL:dependencies.URL,document:dependencies.document,setTimeout,require(name){if(name in dependencies)return dependencies[name];return require(name);}});return exports;}
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return[];return[tree,...nodes(tree.props?.children)];}

test('deleted inspection profile keeps quotation editor and explicit replacement available without writes',async()=>{
 const states=[],effects=[],calls=[];let index=0,first=true;
 const Editor=()=>null;
 const profiles=[{id:'saved',name:'수집 설정',categoryId:'80719',categoryPath:['바스켓'],template:{name:'원본',headerRow:1}},{id:'replacement',name:'대체 설정',categoryId:'80719',categoryPath:['바스켓'],template:{name:'새 원본',headerRow:2}}];
 const selector=load('app/quotation-profile-selection.ts',{});
 const panel=load('app/components/quotation-panel.tsx',{
  react:{useState(initial){const slot=index++;if(slot>=states.length)states.push(initial);return[states[slot],next=>{states[slot]=typeof next==='function'?next(states[slot]):next;}];},useRef(){return{current:null};},useEffect(fn){if(first)effects.push(fn);}},
  '@/app/category-profiles':{quotationStartRow:template=>(template?.headerRow??1)+1},
  '@/app/quotation-profile-selection':selector,
  '@/app/components/quotation-fields-editor':{QuotationFieldsEditor:Editor},
  '@/app/components/quotation-preview-review':{QuotationPreviewReview:()=>null},
  '@/app/components/quotation-mapping-review':{QuotationMappingReview:()=>null},
  fetch:async(url,init)=>{calls.push([url,init?.method??'GET']);return Response.json(url==='/api/category-profiles'?{profiles}:{categoryContext:{profileId:'saved',categoryId:'80719',categoryPath:['수집 당시']}});},
 });
 const render=()=>{index=0;const outer=panel.QuotationPanel({productId:'p',preferredProfileId:'deleted',onManageCategories(){}});const tree=outer.type(outer.props);first=false;return tree;};
 render();effects.forEach(fn=>fn());for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));
 let tree=render();assert.match(JSON.stringify(tree),/삭제되었습니다/);
 assert.equal(nodes(tree).find(n=>n.type===Editor).props.profileId,undefined);
 const select=nodes(tree).find(n=>n.type==='select');assert.equal(select.props.value,'');assert.equal(select.props.disabled,false);
 assert.equal(nodes(tree).find(n=>n.type==='button'&&n.props.children==='견적 자료 검토').props.disabled,true);
 select.props.onChange({target:{value:'replacement'}});tree=render();
 assert.equal(nodes(tree).find(n=>n.type===Editor).props.profileId,'replacement');
 assert.equal(nodes(tree).find(n=>n.type==='button'&&n.props.children==='견적 자료 검토').props.disabled,false);
 assert.match(nodes(tree).find(n=>n.type==='a'&&String(n.props.href).includes('/bundle')).props.href,/profileId=replacement/);
 assert.doesNotMatch(JSON.stringify(tree),/삭제되었습니다/);
 assert.deepEqual(calls.map(([,method])=>method),['GET','GET']);
});

async function requestHarness(){
 const slots=[],effects=[],pending=[],calls=[];let index=0;let props={productId:'p',refreshToken:'v1',onManageCategories(){}};let downloads=0;
 const Editor=()=>null;
 let profileReads=0;let refreshResponse;
 const panel=load('app/components/quotation-panel.tsx',{
  react:{useState(initial){const slot=index++;if(!(slot in slots))slots[slot]=initial;return[slots[slot],next=>{slots[slot]=typeof next==='function'?next(slots[slot]):next;}];},useRef(initial){const slot=index++;return slots[slot]??(slots[slot]={current:initial});},useEffect(fn,deps){const slot=index++;const old=slots[slot];if(!old||deps.some((dep,i)=>!Object.is(dep,old.deps[i])))effects.push(()=>{old?.cleanup?.();slots[slot]={deps,cleanup:fn()};});}},
  '@/app/category-profiles':{quotationStartRow:template=>template?.dataStartRow??2},
  '@/app/quotation-profile-selection':load('app/quotation-profile-selection.ts',{}),
  '@/app/components/quotation-fields-editor':{QuotationFieldsEditor:Editor},
  '@/app/components/quotation-preview-review':{QuotationPreviewReview:()=>null},
  '@/app/components/quotation-mapping-review':{QuotationMappingReview:()=>null},
  URL:{createObjectURL(){downloads++;return'blob:test';},revokeObjectURL(){}},document:{createElement(){return{click(){}};}},
  fetch:async(url,init)=>{if(init?.method==='POST'){calls.push(init);return await new Promise(resolve=>pending.push(resolve));}if(url==='/api/category-profiles'&&profileReads++>0&&refreshResponse)return await refreshResponse(init);return Response.json(url==='/api/category-profiles'?{profiles:[{id:'saved',name:'원본',categoryId:'80719',categoryPath:['바스켓'],template:{name:'원본',headerRow:1}}]}:{categoryContext:{profileId:'saved',categoryId:'80719'}});},
 });
 const render=(updates={})=>{props={...props,...updates};index=0;const outer=panel.QuotationPanel(props);const tree=outer.type(outer.props);effects.splice(0).forEach(fn=>fn());return tree;};
 const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
 render();await settle();
 return{render,settle,calls,pending,Editor,setRefresh(fn){refreshResponse=fn;},downloads:()=>downloads,unmount(){slots.forEach(slot=>slot?.cleanup?.());}};
}
const previewBody={fingerprint:'f',filename:'quote.csv',headers:['상품명'],rows:[['이전 상품']],report:{dataStartRow:2,rowCount:1,missingRequired:[],warnings:[],contentRevision:1,optionRevision:1,profileRevision:1}};
const button=(tree,label)=>nodes(tree).find(n=>n.type==='button'&&n.props.children===label);

test('quotation requests lock immediate duplicate clicks and discard preview body after refresh',async()=>{
 const h=await requestHarness();const click=button(h.render(),'견적 자료 검토').props.onClick;
 click();click();assert.equal(h.calls.length,1);
 let finishBody;h.pending.shift()({ok:true,json:()=>new Promise(resolve=>{finishBody=resolve;})});await h.settle();
 h.render({refreshToken:'v2'});assert.equal(h.calls[0].signal.aborted,true);
 finishBody(previewBody);await h.settle();assert.doesNotMatch(JSON.stringify(h.render()),/출력 미리보기/);
 button(h.render(),'견적 자료 검토').props.onClick();assert.equal(h.calls.length,2);
 h.pending.shift()(Response.json(previewBody));await h.settle();assert.match(JSON.stringify(h.render()),/출력 미리보기/);
});

test('quotation export cannot download a late blob after editor unmount',async()=>{
 const h=await requestHarness();button(h.render(),'견적 자료 검토').props.onClick();h.pending.shift()(Response.json(previewBody));await h.settle();
 const click=button(h.render(),'채운 견적서 + 첨부 자료 ZIP 다운로드').props.onClick;click();click();assert.equal(h.calls.length,2);
 let finishBlob;h.pending.shift()({ok:true,blob:()=>new Promise(resolve=>{finishBlob=resolve;})});await h.settle();
 h.unmount();assert.equal(h.calls[1].signal.aborted,true);finishBlob(new Blob(['old quotation']));await h.settle();assert.equal(h.downloads(),0);
});

test('saved profile refresh updates template and automatic row without replacing editor or manual row',async()=>{
 const h=await requestHarness();let tree=h.render();const before=nodes(tree).find(n=>n.type===h.Editor);
 h.setRefresh(async()=>Response.json({profiles:[{id:'saved',name:'갱신 양식',categoryId:'80719',categoryPath:['바스켓'],template:{name:'새 원본',dataStartRow:7}}]}));
 button(tree,'견적 자료 검토').props.onClick();h.pending.shift()(Response.json(previewBody));await h.settle();
 button(h.render(),'저장한 양식 새로고침').props.onClick();await h.settle();tree=h.render();
 assert.equal(nodes(tree).find(n=>n.type==='select').props.value,'saved');assert.match(JSON.stringify(tree),/새 원본/);assert.doesNotMatch(JSON.stringify(tree),/출력 미리보기/);
 assert.equal(nodes(tree).find(n=>n.type==='input'&&n.props.type==='number').props.value,7);
 const after=nodes(tree).find(n=>n.type===h.Editor);assert.equal(after.key,before.key);assert.notEqual(after.props.refreshToken,before.props.refreshToken);
 nodes(tree).find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:false}});
 nodes(h.render()).find(n=>n.type==='input'&&n.props.type==='number').props.onChange({target:{value:'9'}});
 button(h.render(),'저장한 양식 새로고침').props.onClick();await h.settle();assert.equal(nodes(h.render()).find(n=>n.type==='input'&&n.props.type==='number').props.value,9);
});

test('refresh does not silently apply a recategorized profile and preserves dirty edits during a pending read',async()=>{
 const h=await requestHarness();let resolveRead,signal;
 h.setRefresh(init=>{signal=init.signal;return new Promise(resolve=>{resolveRead=resolve;});});
 const click=button(h.render(),'저장한 양식 새로고침').props.onClick;click();click();
 const editor=nodes(h.render()).find(n=>n.type===h.Editor);editor.props.onDirtyChange(true);assert.equal(signal.aborted,true);
 resolveRead(Response.json({profiles:[]}));await h.settle();assert.equal(nodes(h.render()).find(n=>n.type==='select').props.value,'saved');
 assert.equal(button(h.render(),'저장한 양식 새로고침').props.disabled,true);
 nodes(h.render()).find(n=>n.type===h.Editor).props.onDirtyChange(false);
 h.setRefresh(async()=>Response.json({profiles:[{id:'saved',name:'다른 분류',categoryId:'other',categoryPath:['다름'],template:{name:'다른 원본'}}]}));
 button(h.render(),'저장한 양식 새로고침').props.onClick();await h.settle();
 const tree=h.render();assert.equal(nodes(tree).find(n=>n.type==='select').props.value,'');assert.match(JSON.stringify(tree),/카테고리가 변경/);assert.equal(button(tree,'견적 자료 검토').props.disabled,true);
});

test('failed profile refresh keeps selection and supports retry',async()=>{
 const h=await requestHarness();h.setRefresh(async()=>Response.json({error:'일시 오류'},{status:503}));
 button(h.render(),'저장한 양식 새로고침').props.onClick();await h.settle();assert.match(JSON.stringify(h.render()),/일시 오류/);assert.equal(nodes(h.render()).find(n=>n.type==='select').props.value,'saved');
 h.setRefresh(async()=>Response.json({profiles:[]}));button(h.render(),'저장한 양식 새로고침').props.onClick();await h.settle();assert.equal(nodes(h.render()).find(n=>n.type==='select').props.value,'');assert.doesNotMatch(JSON.stringify(h.render()),/일시 오류/);
});

