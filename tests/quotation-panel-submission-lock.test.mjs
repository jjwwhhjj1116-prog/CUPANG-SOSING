import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
const preview={fingerprint:'synthetic-review',filename:'synthetic.xlsx',headers:['상품명'],rows:[['기존 검토 상품']],submissionReview:{synthetic:true},report:{dataStartRow:2,rowCount:1,missingRequired:[],warnings:[],mappingCoverage:[],contentRevision:1,optionRevision:1,profileRevision:1}};

function harness({template=true,prepareOfficial}={}){
 const slots=[],layouts=[],effects=[],requests=[],pending=[],notifications={manage:0,prepare:[],seo:0,saved:0,profile:[]};let cursor=0,closed=false,lateUpdates=0,downloads=0,refresh;
 let props={productId:'synthetic-product',refreshToken:'v1',onManageCategories(){notifications.manage++;},onPrepareSubmission(id){notifications.prepare.push(id);},onEditSeo(){notifications.seo++;},onSaved(){notifications.saved++;},onProfileChange(id){notifications.profile.push(id);}};
 const Editor=()=>null,Mapping=()=>null,PreviewReview=()=>null;
 const profiles=[{id:'saved',name:'합성 회사 양식',categoryId:'80719',categoryPath:['합성 분류'],template:template?{name:'synthetic.xlsx',dataStartRow:2}:null,hubSchema:{metadata:{scopeType:'Retail_Categorized_Single'}}},{id:'other',name:'다른 합성 양식',categoryId:'77442',categoryPath:['다른 합성 분류'],template:{name:'other.xlsx',dataStartRow:4}}];
 const schedule=(queue,fn,deps)=>{const i=cursor++,old=slots[i];if(!old||deps.some((value,j)=>!Object.is(value,old.deps[j]))){const next={kind:queue===layouts?'layout':'effect',deps,fn,cleanup:old?.cleanup};slots[i]=next;queue.push(next);}};
 const memo=(factory,deps)=>{const i=cursor++,old=slots[i];if(!old||deps.some((value,j)=>!Object.is(value,old.deps[j])))slots[i]={deps,value:factory()};return slots[i].value;};
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{if(closed){lateUpdates++;return;}slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useMemo:memo,useCallback:(fn,deps)=>memo(()=>fn,deps),useLayoutEffect(fn,deps){schedule(layouts,fn,deps);},useEffect(fn,deps){schedule(effects,fn,deps);}};
 function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,Error,setTimeout,URL:{createObjectURL(){downloads++;return'blob:synthetic';},revokeObjectURL(){}},document:{createElement(){return{click(){}};}},fetch:async(url,init={})=>{
   assert.ok(url.startsWith('/api/'),'No actual source, Supplier Hub or external request');requests.push({url,init});
   if(init.method==='POST')return new Promise(resolve=>pending.push(resolve));
   if(url==='/api/category-profiles')return refresh?refresh(init):Response.json({profiles});
   return Response.json({categoryContext:{profileId:'saved',categoryId:'80719'}});
  },require(name){
   if(name==='react')return hooks;if(name==='@/app/components/quotation-fields-editor')return{QuotationFieldsEditor:Editor};if(name==='@/app/components/quotation-mapping-review')return{QuotationMappingReview:Mapping};if(name==='@/app/components/quotation-preview-review')return{QuotationPreviewReview:PreviewReview};
   if(name==='@/app/category-profiles')return{quotationStartRow:value=>value?.dataStartRow??2};if(name==='@/app/supplier-hub-catalog')return{prepareOfficialHubProfileTemplate:prepareOfficial??(()=>assert.fail('Unexpected preparation'))};
   if(name.startsWith('@/'))return load(name.slice(2)+'.ts');return native(name);
  }});return exports;}
 const panel=load('app/components/quotation-panel.tsx');let tree;
 const editor=()=>nodes(tree).find(node=>node.type===Editor);
 const render=(updates={},childReport)=>{
  props={...props,...updates};cursor=0;const outer=panel.QuotationPanel(props);tree=outer.type(outer.props);
  // React mutation cleanup precedes child layout setup, which precedes parent
  // layout setup. A synchronous child report must survive this ordering.
  const pendingLayouts=layouts.splice(0);pendingLayouts.forEach(slot=>slot.cleanup?.());childReport?.(editor()?.props);
  pendingLayouts.forEach(slot=>{slot.cleanup=slot.fn();});effects.splice(0).forEach(slot=>{slot.cleanup?.();slot.cleanup=slot.fn();});return tree;
 };
 const settle=async()=>{for(let i=0;i<8;i++){await new Promise(resolve=>setImmediate(resolve));render();}return tree;};
 const button=label=>nodes(tree).find(node=>node.type==='button'&&text(node)===label);
 render();return{render,settle,editor,button,requests,pending,notifications,get tree(){return tree;},get lateUpdates(){return lateUpdates;},get downloads(){return downloads;},setRefresh(fn){refresh=fn;},replayLayouts(childReport){const all=slots.filter(slot=>slot?.kind==='layout');all.forEach(slot=>slot.cleanup?.());childReport(editor()?.props);all.forEach(slot=>{slot.cleanup=slot.fn();});render();},unmount(){slots.forEach(slot=>slot?.cleanup?.());closed=true;}};
}
async function ready(options){const h=harness(options);await h.settle();return h;}
async function showPreview(h){h.button('견적 자료 검토').props.onClick();h.pending.shift()(Response.json(preview));await h.settle();assert.ok(h.button('채운 견적서 파일 다운로드'));}

test('inline source lock synchronously blocks every retained parent source action without disabling/remounting its own editor',async()=>{
 const h=await ready();try{
  await showPreview(h);const before=h.editor(),select=nodes(h.tree).find(node=>node.type==='select'),check=nodes(h.tree).find(node=>node.type==='input'&&node.props.type==='checkbox'),number=nodes(h.tree).find(node=>node.type==='input'&&node.props.type==='number');
  const actions=['견적 자료 검토','채운 견적서 파일 다운로드','채운 견적서 + 첨부 자료 ZIP 다운로드','저장한 양식 새로고침','카테고리·양식 관리','저장한 견적 전송 준비'].map(label=>h.button(label).props.onClick),bundle=nodes(h.tree).find(node=>node.type==='a'&&text(node)==='견적 입력 내용 + 첨부 자료 다운로드');
  const mapping=nodes(h.tree).find(node=>Array.isArray(node.props?.findings)),inspection=nodes(h.tree).find(node=>node.props?.review?.synthetic),requests=h.requests.length,notifications=JSON.stringify(h.notifications);let prevented=0;
  before.props.onSubmissionLockChange(true,true);
  actions.forEach(run=>run());select.props.onChange({target:{value:'other'}});check.props.onChange({target:{checked:false}});number.props.onChange({target:{value:'19'}});bundle.props.onClick({preventDefault(){prevented++;}});mapping.props.onInspect({fieldId:'source-a'});mapping.props.onManage();inspection.props.onInspect({fieldId:'source-b'});before.props.onEditSeo();
  h.render();assert.equal(h.requests.length,requests);assert.equal(JSON.stringify(h.notifications),notifications);assert.equal(prevented,1);assert.equal(h.downloads,0);
  assert.equal(h.tree.props['data-workspace-saving'],true);assert.equal(h.editor().key,before.key);assert.equal(h.editor().props.refreshToken,before.props.refreshToken);assert.equal(h.editor().props.submissionActive,true);assert.equal(h.editor().props.onSubmissionLockChange,before.props.onSubmissionLockChange);
  assert.equal(nodes(h.tree).find(node=>node.type==='select').props.value,'saved');assert.equal(nodes(h.tree).find(node=>node.type==='input'&&node.props.type==='checkbox').props.checked,true);
  for(const label of ['견적 자료 검토','채운 견적서 파일 다운로드','채운 견적서 + 첨부 자료 ZIP 다운로드','저장한 양식 새로고침','카테고리·양식 관리','저장한 견적 전송 준비'])assert.equal(h.button(label).props.disabled,true,label);
  assert.equal(nodes(h.tree).find(node=>node.type==='a'&&text(node)==='견적 입력 내용 + 첨부 자료 다운로드').props.href,undefined);
  before.props.onSubmissionLockChange(true,false);h.render();assert.equal(h.tree.props['data-workspace-saving'],false,'a stored terminal receipt may close, while source editing remains protected');assert.equal(h.button('견적 자료 검토').props.disabled,true);
  before.props.onSubmissionLockChange(false,false);h.render();assert.equal(h.button('견적 자료 검토').props.disabled,false);h.button('저장한 견적 전송 준비').props.onClick();assert.deepEqual(h.notifications.prepare,['saved']);h.editor().props.onEditSeo();assert.equal(h.notifications.seo,1);
 }finally{h.unmount();}
});

test('source lock aborts a pending preview and ignores its late body after unlock',async()=>{
 const h=await ready();try{
  h.button('견적 자료 검토').props.onClick();const request=h.requests.at(-1);let release;
  h.pending.shift()({ok:true,json:()=>new Promise(resolve=>{release=resolve;})});await h.settle();h.editor().props.onSubmissionLockChange(true,true);assert.equal(request.init.signal.aborted,true);
  h.editor().props.onSubmissionLockChange(false,false);release(preview);await h.settle();assert.equal(h.button('채운 견적서 파일 다운로드'),undefined);assert.equal(h.downloads,0);
 }finally{h.unmount();}
});

test('template preparation and refresh cannot start under lock or apply their stale result when lock begins',async()=>{
 let release,signal,prepares=0,prepared=0;
 const h=await ready({template:false,prepareOfficial:async(_profile,current)=>{prepares++;signal=current;return new Promise(resolve=>{release=resolve;});}});try{
  h.render({onProfilePrepared(){prepared++;}});const editor=h.editor(),prepare=h.button('공식 파일 기준으로 연결').props.onClick,refresh=h.button('저장한 양식 새로고침').props.onClick,reads=h.requests.length;
  editor.props.onSubmissionLockChange(true,true);prepare();refresh();assert.equal(prepares,0);assert.equal(h.requests.length,reads);
  editor.props.onSubmissionLockChange(false,false);prepare();assert.equal(prepares,1);editor.props.onSubmissionLockChange(true,true);assert.equal(signal.aborted,true);release({id:'saved',template:{name:'late.xlsx',dataStartRow:10}});await h.settle();assert.equal(prepared,0);assert.ok(h.button('공식 파일 기준으로 연결'));
  editor.props.onSubmissionLockChange(false,false);await h.settle();let resolveRefresh,refreshSignal;h.setRefresh(init=>{refreshSignal=init.signal;return new Promise(resolve=>{resolveRefresh=resolve;});});h.button('저장한 양식 새로고침').props.onClick();h.editor().props.onSubmissionLockChange(true,true);assert.equal(refreshSignal.aborted,true);resolveRefresh(Response.json({profiles:[]}));await h.settle();assert.equal(nodes(h.tree).find(node=>node.type==='select').props.value,'saved');assert.ok(h.button('공식 파일 기준으로 연결'));
 }finally{h.unmount();}
});

test('scope, ABA, child-first layout replay and unmount cannot clear another active lock or invoke retained source handlers',async()=>{
 const h=await ready();
 const original=h.editor().props.onSubmissionLockChange,oldPrepare=h.button('저장한 견적 전송 준비').props.onClick;
 h.render({refreshToken:'v2'},editor=>editor.onSubmissionLockChange(true,true));original(false,false);oldPrepare();assert.equal(h.notifications.prepare.length,0,'child-first report protects retained handlers before the state commit');await h.settle();assert.equal(h.button('저장한 견적 전송 준비').props.disabled,true);
 h.render({refreshToken:'v1'});h.render();const current=h.editor().props.onSubmissionLockChange;assert.notEqual(current,original);current(true,true);original(false,false);h.render();assert.equal(h.button('견적 자료 검토').props.disabled,true);
 h.replayLayouts(editor=>editor.onSubmissionLockChange(true,true));assert.equal(h.button('견적 자료 검토').props.disabled,true);assert.equal(h.tree.props['data-workspace-saving'],true);
 current(false,false);h.render();const handler=h.button('견적 자료 검토').props.onClick,dirty=h.editor().props.onDirtyChange,readCount=h.requests.length;h.unmount();current(true,true);handler();oldPrepare();dirty(true);assert.equal(h.requests.length,readCount);assert.equal(h.notifications.prepare.length,0);assert.equal(h.lateUpdates,0);
});
