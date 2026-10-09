import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';

const native=createRequire(import.meta.url),plain=value=>JSON.parse(JSON.stringify(value));
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const initialVersion='2026-10-07T00:00:00.000Z',advance=version=>new Date(Date.parse(version)+1).toISOString();
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'));
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const contractModules=new Map();
function contract(file){if(contractModules.has(file))return contractModules.get(file);const exports={};contractModules.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,TextEncoder,Uint8Array,crypto:webcrypto,require:name=>name.startsWith('@/')?contract(name.slice(2)+'.ts'):native(name)});return exports;}

function labelUI(fetcher,{productId='p',optionId='red',version=initialVersion,profileId,refreshToken='0',renderDocument}={}){
 const slots=[],effects=[],layouts=[],cache=new Map(),calls=[],plans=[],created=[],revoked=[];
 let cursor=0,saved=0,closed=false,lateWrites=0,lastReplyVersion=version;
 const effect=(queue,fn,deps)=>{const i=cursor++,old=slots[i];if(!old||JSON.stringify(old.deps)!==JSON.stringify(deps)){const next={deps,cleanup:old?.cleanup};slots[i]=next;queue.push(()=>{old?.cleanup?.();next.cleanup=fn();});}};
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{if(closed){lateWrites++;return;}slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect(fn,deps){effect(effects,fn,deps);},useLayoutEffect(fn,deps){effect(layouts,fn,deps);}};
 class ObjectURL extends URL{static createObjectURL(){const value='blob:test-'+created.length;created.push(value);return value;}static revokeObjectURL(value){revoked.push(value);}}
 const request=async(url,init)=>{calls.push({url,init});const result=await fetcher(url,init);if(result.ok&&url.includes('/quotation-fields')){const body=await result.clone().json();if(body.productVersion)lastReplyVersion=body.productVersion;}return result;};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,Error,AbortController,URL:ObjectURL,TextEncoder,Uint8Array,File,Blob,FormData,structuredClone,crypto:webcrypto,fetch:request,require(name){if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};if(name==='@/app/document-image-render')return{renderDocument:async plan=>{plans.push(plain(plan));return renderDocument?renderDocument(plan):{blob:new Blob([png],{type:'image/png'}),width:1,height:1};}};if(name.startsWith('./')||name.startsWith('../'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);}});return exports;
 }
 const Component=load('app/components/option-label-editor.tsx').OptionLabelEditor;
 const render=(flush=true)=>{cursor=0;const tree=Component({productId,optionId,version,profileId,refreshToken,onSaved(){saved++;version=lastReplyVersion;}});layouts.splice(0).forEach(fn=>fn());if(flush)effects.splice(0).forEach(fn=>fn());return tree;};
 const idle=async()=>{const limit=Date.now()+10000;let stable=0,last='';for(;;){render();await new Promise(resolve=>setImmediate(resolve));const tree=render(),identity=JSON.stringify([version,refreshToken,calls.length]);stable=!tree.props['data-workspace-saving']&&!effects.length&&!layouts.length&&identity===last?stable+1:0;if(stable>=3)return;last=identity;assert.ok(Date.now()<limit,'option label UI timed out');await new Promise(resolve=>setTimeout(resolve,1));}};
 const input=label=>nodes(render()).find(node=>['textarea','select'].includes(node.type)&&node.props['aria-label']===label),button=label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label);
 render();return{render,idle,input,button,load,calls,plans,created,revoked,get saved(){return saved;},get lateWrites(){return lateWrites;},source(next,nextRefresh=refreshToken,flush=true){version=next;refreshToken=nextRefresh;render(flush);},select(id,nextProduct=productId){optionId=id;productId=nextProduct;render();},close(){closed=true;slots.forEach(slot=>slot?.cleanup?.());},async click(label){const selected=button(label);assert.ok(selected&&!selected.props.disabled,'available label button '+label);selected.props.onClick();await idle();}};
}

function fixture(){
 const fields=[{id:'title',label:'상품명',type:'text',section:'start',visibility:'common',required:true,maxLength:500},
  {id:'labelImages',label:'제품 한글 표시사항 라벨 또는 도안 이미지',type:'images',section:'image',visibility:'common',required:false,maxLength:16000,maxItems:30},
  {id:'wire-material',label:'재질',type:'text',section:'legal',visibility:'common',required:false,maxLength:100,hubWire:{path:['legalPage','notices'],name:'재질',nameKey:'noticeName',valueKey:'noticeValue'}},
  {id:'wire-country',label:'제조국',type:'select',section:'legal',visibility:'common',required:false,choices:[{value:'CN',label:'중국'},{value:'KR',label:'한국'}],hubWire:{path:['legalPage','notices'],name:'제조국',nameKey:'noticeName',valueKey:'noticeValue'}},
  {id:'unrelated-material',label:'재질',type:'text',section:'product',visibility:'hidden',required:false,hubWire:{path:['productPage','commonAttributes','unexposedAttributes'],name:'재질',nameKey:'name',valueKey:'value'}},
  {id:'scalar-material',label:'재질',type:'text',section:'legal',visibility:'common',required:false,hubWire:{path:['legalPage','material']}},
  {id:'wrong-name-material',label:'재질',type:'text',section:'legal',visibility:'common',required:false,hubWire:{path:['legalPage','notices'],name:'소재',nameKey:'noticeName',valueKey:'noticeValue'}},
  {id:'kcMarkType',label:'KC 인증 마크 타입',type:'text',section:'legal',visibility:'common',required:false},
 ];
 const overrides={common:{'wire-material':'공통 소재','wire-country':'CN',title:'공통 상품명',labelImages:'owner/old.png'},options:{red:{unrelated:'보존'},blue:{'wire-material':'다른 옵션 소재'}}};
 const automaticValue=id=>id==='wire-material'?'자동 소재':id==='wire-country'?'CN':id==='title'?'자동 상품명':id==='labelImages'?'owner/old.png':'';
 const rows=values=>[null,'red','blue'].map(optionId=>({optionId,optionLabel:optionId??'공통',included:optionId!==null,fields:Object.fromEntries(fields.map(field=>{const own=values.options[optionId]??{},hasOwn=Object.hasOwn(own,field.id),hasCommon=Object.hasOwn(values.common,field.id);return[field.id,{value:hasOwn?own[field.id]:hasCommon?values.common[field.id]:automaticValue(field.id),source:hasOwn?'manual-option':hasCommon?'manual-common':'content',needsReview:false,issues:[],validationIssues:[]}];}))}));
 const schema={categoryId:'80719',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓'],fields};
 const view={revision:1,inputFingerprint:'a'.repeat(64),productVersion:initialVersion,contentRevision:2,optionRevision:3,updatedAt:initialVersion,imageKeys:['owner/old.png'],categoryContext:{source:'profile',categoryId:'80719',categoryPath:schema.categoryPath,profileId:null},overrides,resolved:{schema,rows:rows(overrides)},automatic:{schema,rows:rows({common:{},options:{}})}};
 const uploads=new Map();let uploadCount=0;
 async function seed(id,proof=contract('app/quotation-label-proof.ts').quotationLabelProofRequest({productId:'p',endpoint:'/api/products/p/quotation-fields',view,optionId:'red'})){
  const metadata=await contract('app/quotation-label-proof.ts').verifiedQuotationLabelMetadata(proof,view,id),key=`owner/quotation-label-${id}.png`;
  const receipt={key,contentType:'image/png',size:png.length,sha256:'a'.repeat(64),quotationLabelProof:contract('app/quotation-label-proof.ts').quotationLabelReceiptFromMetadata({...metadata,labelUploadId:id,labelBlobSha256:'a'.repeat(64)})};uploads.set(id,receipt);return receipt;
 }
 return{view,uploads,seed,get generated(){return[...uploads.values()].map(value=>value.key);},get uploadCount(){return uploadCount;},async reply(url,init){
  if(url.startsWith('/api/files?labelUploadId='))return Response.json(uploads.get(url.split('=')[1])??{key:null});
  if(url==='/api/files'){const id=init.body.get('labelUploadId'),proof=JSON.parse(init.body.get('quotationLabelProof'));uploadCount++;const receipt=await seed(id,proof);return Response.json({key:receipt.key,contentType:'image/png',size:init.body.get('file').size,quotationLabelProof:receipt.quotationLabelProof},{status:201});}
  if(url.endsWith('/attachments')){const body=JSON.parse(init.body);assert.equal(body.role,null);assert.equal(body.expectedVersion,view.productVersion);assert.equal(body.expectedContentRevision,view.contentRevision);view.imageKeys.push(body.key);view.productVersion=advance(view.productVersion);view.inputFingerprint='b'.repeat(64);return Response.json({productVersion:view.productVersion});}
  if(init?.method==='PUT'){const body=JSON.parse(init.body);if(body.expectedRevision!==view.revision)return Response.json({error:'동시 수정'},{status:409});assert.equal(body.expectedInputFingerprint,view.inputFingerprint);for(const change of body.changes){const values=view.overrides.options[change.optionId]??={};if(change.value===null)delete values[change.fieldKey];else values[change.fieldKey]=change.value;if(!Object.keys(values).length)delete view.overrides.options[change.optionId];}view.revision++;view.productVersion=advance(view.productVersion);view.updatedAt=view.productVersion;view.resolved.rows=rows(view.overrides);}
  return Response.json(view);
 }};
}

test('notice identities use complete live named wires and exact recorded category additions, excluding lookalike labels',()=>{
 const f=fixture(),h=labelUI(()=>Response.json(f.view));try{
  const helper=h.load('app/option-label-fields.ts');assert.deepEqual(plain(helper.optionLabelFields(f.view).map(field=>field.id)),['wire-material','wire-country']);
  const staticView=plain(f.view);staticView.resolved.schema=h.load('app/quotation-schema.ts').getQuotationSchema('80719');
  const selected=helper.optionLabelFields(staticView);assert.equal(selected.length,10);assert.ok(selected.every(field=>field.id.startsWith('notice')));assert.ok(!selected.some(field=>field.id==='kcMarkType'));
  for(const change of [field=>field.hubWire.name='유사 재질',field=>field.hubWire.path=['legalPage','notices','nested'],field=>delete field.hubWire.valueKey]){const copy=plain(f.view);change(copy.resolved.schema.fields[2]);assert.deepEqual(plain(helper.optionLabelFields(copy).map(field=>field.id)),['wire-country']);}
  const duplicated=plain(f.view);duplicated.resolved.schema.fields.push({...duplicated.resolved.schema.fields[2]});assert.throws(()=>helper.optionLabelFields(duplicated),/연결을 하나로/);
  assert.throws(()=>helper.optionLabelChanges(f.view,'red',{'scalar-material':'잘못된 연결'}),/상품고시 항목/);
 }finally{h.close();}
});

test('selected notice save preserves common values, other SKUs, unrelated fields, manual blanks and exact choice tokens',async()=>{
 const f=fixture(),before=plain(f.view.overrides),h=labelUI((url,init)=>f.reply(url,init));try{
  await h.idle();assert.equal(h.calls.filter(call=>call.init?.method==='PUT').length,0);assert.equal(h.input('선택 옵션 재질').props.value,'공통 소재');assert.equal(h.input('선택 옵션 KC 인증 마크 타입'),undefined);
  h.input('선택 옵션 재질').props.onChange({target:{value:'선택 옵션 소재'}});h.input('선택 옵션 제조국').props.onChange({target:{value:'KR'}});await h.click('선택 옵션 상품고시 저장');
  const put=JSON.parse(h.calls.find(call=>call.init?.method==='PUT').init.body);assert.deepEqual(put.changes,[{fieldKey:'wire-material',optionId:'red',value:'선택 옵션 소재'},{fieldKey:'wire-country',optionId:'red',value:'KR'}]);
  assert.equal(h.saved,1);assert.deepEqual(f.view.overrides.common,before.common);assert.deepEqual(f.view.overrides.options.blue,before.options.blue);assert.equal(f.view.overrides.options.red.unrelated,'보존');
  h.input('선택 옵션 재질').props.onChange({target:{value:''}});await h.click('선택 옵션 상품고시 저장');assert.equal(f.view.overrides.options.red['wire-material'],'');assert.equal(h.input('선택 옵션 재질').props.value,'');
  await h.click('재질 공통·자동값 복원');await h.click('제조국 공통·자동값 복원');await h.click('선택 옵션 상품고시 저장');
  assert.equal(h.input('선택 옵션 재질').props.value,'공통 소재');assert.equal(h.input('선택 옵션 제조국').props.value,'CN');assert.deepEqual(f.view.overrides.options.red,{unrelated:'보존'});assert.deepEqual(f.view.overrides.common,before.common);assert.deepEqual(f.view.overrides.options.blue,before.options.blue);
 }finally{h.close();}
});

test('captured save callbacks use the newest synchronous notice draft and never start duplicate writes',async()=>{
 const f=fixture(),hold=deferred();let sent;const h=labelUI((url,init)=>{if(init?.method==='PUT'){sent={url,init};return hold.promise;}return f.reply(url,init);});try{
  await h.idle();h.input('선택 옵션 재질').props.onChange({target:{value:'이전 입력'}});const callback=h.button('선택 옵션 상품고시 저장').props.onClick;
  h.input('선택 옵션 재질').props.onChange({target:{value:'최신 입력'}});callback();callback();assert.equal(h.calls.filter(call=>call.init?.method==='PUT').length,1);assert.equal(JSON.parse(sent.init.body).changes[0].value,'최신 입력');hold.resolve(f.reply(sent.url,sent.init));await h.idle();assert.equal(h.saved,1);
 }finally{h.close();}
});

test('notice constraints and conflicts preserve drafts without truncation or generating an unsaved PNG',async()=>{
 const f=fixture(),h=labelUI((url,init)=>f.reply(url,init));try{
  await h.idle();h.input('선택 옵션 재질').props.onChange({target:{value:'가'.repeat(101)}});assert.equal(h.button('선택 옵션 상품고시 저장').props.disabled,true);assert.equal(h.input('선택 옵션 재질').props.value.length,101);
  assert.equal(h.button('선택 옵션 상품고시 PNG 미리보기').props.disabled,true);assert.equal(h.plans.length,0);
  h.input('선택 옵션 재질').props.onChange({target:{value:'보존할 입력'}});f.reply('',{method:'PUT',body:JSON.stringify({expectedRevision:1,expectedInputFingerprint:f.view.inputFingerprint,changes:[{optionId:'red',fieldKey:'wire-material',value:'다른 저장값'}]})});
  await h.click('선택 옵션 상품고시 저장');assert.equal(h.input('선택 옵션 재질').props.value,'보존할 입력');assert.equal(h.saved,0);assert.match(text(h.render()),/동시 수정/);
  h.source(f.view.productVersion);await h.idle();const writes=h.calls.filter(call=>call.init?.method==='PUT').length;await h.click('입력 유지·최신 상품고시 조회');assert.equal(h.input('선택 옵션 재질').props.value,'보존할 입력');assert.match(text(h.render()),/다른 저장값/);assert.equal(h.calls.filter(call=>call.init?.method==='PUT').length,writes);
  await h.click('입력 취소·저장 상품고시 다시 조회');assert.equal(h.input('선택 옵션 재질').props.value,'다른 저장값');assert.equal(h.render().props['data-workspace-dirty'],false);
 }finally{h.close();}
});

test('a lost committed notice PUT acknowledgement is recovered by an explicit read without a second save',async()=>{
 const f=fixture();let lost=true;const h=labelUI((url,init)=>{const response=f.reply(url,init);if(init?.method==='PUT'&&lost){lost=false;throw Error('저장 응답 유실');}return response;});try{
  await h.idle();h.input('선택 옵션 재질').props.onChange({target:{value:'서버에 저장된 소재'}});await h.click('선택 옵션 상품고시 저장');assert.equal(h.saved,0);assert.equal(h.input('선택 옵션 재질').props.value,'서버에 저장된 소재');assert.equal(h.render().props['data-workspace-dirty'],true);
  await h.click('입력 유지·최신 상품고시 조회');assert.equal(h.saved,1);assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(h.input('선택 옵션 재질').props.value,'서버에 저장된 소재');assert.equal(h.calls.filter(call=>call.init?.method==='PUT').length,1);
 }finally{h.close();}
});

test('notice save acknowledgement rejects changed clocks, source identities, constraints, unrelated fields and selected cells',async()=>{
 for(const [name,change] of [
  ['revision',view=>view.revision++],['clock',view=>view.productVersion=initialVersion],['updatedAt',view=>view.updatedAt=initialVersion],
  ['content',view=>view.contentRevision++],['options',view=>view.optionRevision++],['library',view=>view.imageKeys.push('other/file.png')],
  ['category',view=>view.categoryContext.profileId='other'],['binding',view=>view.resolved.schema.fields[2].maxLength=99],
  ['other SKU',view=>view.overrides.options.blue['wire-material']='다른 변경'],['common',view=>view.overrides.common['wire-material']='다른 변경'],
  ['unrelated',view=>view.overrides.options.red.unrelated='다른 변경'],['selected cell',view=>view.resolved.rows.find(row=>row.optionId==='red').fields['wire-material'].value='다른 셀'],
 ]){const f=fixture(),h=labelUI((url,init)=>{const response=f.reply(url,init);if(init?.method==='PUT'){const body=plain(f.view);change(body);return Response.json(body);}return response;});try{
   await h.idle();h.input('선택 옵션 재질').props.onChange({target:{value:'응답 확인 전 보존할 소재'}});await h.click('선택 옵션 상품고시 저장');assert.equal(h.saved,0,name);assert.equal(h.render().props['data-workspace-dirty'],true,name);assert.equal(h.input('선택 옵션 재질').props.value,'응답 확인 전 보존할 소재',name);assert.match(text(h.render()),/확인하지 못했습니다|다릅니다/,name);
  }finally{h.close();}}
});

test('source changes synchronously abort notice saves and old option callbacks cannot write to a newly selected SKU',async()=>{
 for(const kind of ['version','refresh','option']){
  const f=fixture(),hold=deferred();let sent;const h=labelUI((url,init)=>{if(init?.method==='PUT'){sent={url,init};return hold.promise;}return f.reply(url,init);});try{
   await h.idle();h.input('선택 옵션 재질').props.onChange({target:{value:'보존할 초안'}});const oldEdit=h.input('선택 옵션 재질').props.onChange,oldSave=h.button('선택 옵션 상품고시 저장').props.onClick;oldSave();
   if(kind==='option')h.select('blue');else h.source(kind==='version'?advance(initialVersion):initialVersion,kind==='refresh'?'1':'0',false);
   assert.equal(sent.init.signal.aborted,true);hold.resolve(f.reply(sent.url,sent.init));await h.idle();assert.equal(h.saved,0);
   oldEdit({target:{value:'이전 옵션 입력'}});oldSave();await h.idle();assert.equal(h.calls.filter(call=>call.init?.method==='PUT').length,1);
   if(kind!=='option')assert.equal(h.input('선택 옵션 재질').props.value,'보존할 초안');
  }finally{h.close();}
 }
});

test('saved label preview uses selected final notices, manual blanks and exact choice display; edits revoke it and block old attachment callbacks',async()=>{
 const f=fixture(),h=labelUI((url,init)=>f.reply(url,init));try{
  await h.idle();h.input('선택 옵션 재질').props.onChange({target:{value:''}});h.input('선택 옵션 제조국').props.onChange({target:{value:'KR'}});await h.click('선택 옵션 상품고시 저장');
  await h.click('선택 옵션 상품고시 PNG 미리보기');assert.equal(h.plans.length,1);assert.equal(h.plans[0].rows.find(row=>row[0]==='재질')[1],'[공란]');assert.equal(h.plans[0].rows.find(row=>row[0]==='제조국')[1],'한국');
  const old=h.button('PNG 업로드·선택 옵션 견적에 연결').props.onClick,url=h.created[0];h.input('선택 옵션 재질').props.onChange({target:{value:'새 초안'}});h.render();old();await h.idle();
  assert.equal(h.button('PNG 업로드·선택 옵션 견적에 연결'),undefined);assert.ok(h.revoked.includes(url));assert.equal(f.uploadCount,0);assert.equal(h.calls.some(call=>call.url==='/api/files'),false);
  assert.equal(h.button('선택 옵션 상품고시 PNG 미리보기').props.disabled,true);
 }finally{h.close();}
});

test('a pending PNG render is cancelled on source change or unmount without leaking URLs or enabling attachment',async()=>{
 for(const mode of ['source','option','unmount']){
  const f=fixture(),hold=deferred(),h=labelUI((url,init)=>f.reply(url,init),{renderDocument:()=>hold.promise});
  try{await h.idle();h.button('선택 옵션 상품고시 PNG 미리보기').props.onClick();if(mode==='source')h.source(initialVersion,'1',false);else if(mode==='option')h.select('blue');else h.close();
   hold.resolve({blob:new Blob([png],{type:'image/png'}),width:1,height:1});await new Promise(resolve=>setImmediate(resolve));if(mode!=='unmount')await h.idle();assert.equal(h.created.length,0);assert.equal(h.lateWrites,0);assert.equal(f.uploadCount,0);
  }finally{if(mode!=='unmount')h.close();}
 }
});

test('single label attachment preserves all old labels and other SKU/common overrides, and retry recovers a lost final acknowledgement without duplicate PNGs',async()=>{
 const f=fixture(),before=plain(f.view.overrides);let lost=true,recoveryUnavailable=false;const h=labelUI(async(url,init)=>{if(recoveryUnavailable&&!init?.method){recoveryUnavailable=false;return Response.json({error:'저장본 확인 일시 실패'},{status:503});}const response=await f.reply(url,init);if(init?.method==='PUT'&&JSON.parse(init.body).changes[0].fieldKey==='labelImages'&&lost){lost=false;recoveryUnavailable=true;throw Error('라벨 저장 응답 유실');}return response;});try{
  await h.idle();await h.click('선택 옵션 상품고시 PNG 미리보기');await h.click('PNG 업로드·선택 옵션 견적에 연결');assert.equal(h.saved,0);assert.equal(f.uploadCount,1);assert.match(text(h.render()),/기존 파일/);
  assert.equal(f.view.overrides.options.red.labelImages,'owner/old.png\n'+f.generated[0]);assert.deepEqual(f.view.overrides.common,before.common);assert.deepEqual(f.view.overrides.options.blue,before.options.blue);
  await h.click('PNG 업로드·선택 옵션 견적에 연결');assert.equal(h.saved,1);assert.equal(f.uploadCount,1);assert.equal(h.calls.filter(call=>call.init?.method==='PUT').length,1);assert.equal(h.plans.length,1);
  assert.deepEqual(f.view.overrides.common,before.common);assert.deepEqual(f.view.overrides.options.blue,before.options.blue);assert.equal(f.view.overrides.options.red.unrelated,'보존');
 }finally{h.close();}
});

test('explicit single-label retry recovers durable upload and product-attachment acknowledgements without generating or uploading again',async()=>{
 for(const failedStage of ['upload','attachment']){
  const f=fixture();let lost=true,recoveryUnavailable=false;const h=labelUI(async(url,init)=>{if(recoveryUnavailable&&!init?.method){recoveryUnavailable=false;return Response.json({error:'저장본 확인 일시 실패'},{status:503});}const response=await f.reply(url,init);if(lost&&(failedStage==='upload'?url==='/api/files':url.endsWith('/attachments'))){lost=false;recoveryUnavailable=true;throw Error('연결 응답 유실');}return response;});try{
   await h.idle();await h.click('선택 옵션 상품고시 PNG 미리보기');await h.click('PNG 업로드·선택 옵션 견적에 연결');assert.equal(h.saved,0);assert.equal(f.uploadCount,1);
   await h.click('PNG 업로드·선택 옵션 견적에 연결');assert.equal(h.saved,1,text(h.render()));assert.equal(f.uploadCount,1);assert.equal(h.plans.length,1);assert.equal(h.calls.filter(call=>call.init?.method==='PUT').length,1);
   assert.equal(f.view.overrides.options.red.labelImages,'owner/old.png\n'+f.generated[0]);assert.equal(f.view.imageKeys.filter(key=>key===f.generated[0]).length,1);
  }finally{h.close();}
 }
});

test('an identical reviewed PNG already inherited through a common label is acknowledged without creating a selected override or uploading again',async()=>{
 const f=fixture(),h=labelUI((url,init)=>f.reply(url,init));try{
  await h.idle();const helper=h.load('app/quotation-label-upload.ts'),id=await helper.quotationLabelUploadId({productId:'p',endpoint:'/api/products/p/quotation-fields',view:f.view,optionId:'red'}),{key}=await f.seed(id);
  f.view.imageKeys.push(key);f.view.overrides.common.labelImages=key;
  for(const row of f.view.resolved.rows)row.fields.labelImages={...row.fields.labelImages,value:key,source:'manual-common'};
  const before=plain(f.view.overrides);await h.click('저장 상품고시 다시 조회');await h.click('선택 옵션 상품고시 PNG 미리보기');await h.click('PNG 업로드·선택 옵션 견적에 연결');
  assert.equal(h.saved,1,text(h.render()));assert.equal(f.uploadCount,0);assert.deepEqual(f.view.overrides,before);assert.equal(Object.hasOwn(f.view.overrides.options.red,'labelImages'),false);
  assert.equal(h.calls.some(call=>call.init?.method==='POST'||call.init?.method==='PUT'),false);
 }finally{h.close();}
});

test('failed latest notice and durable label reads preserve the draft or preview instead of creating a fallback upload',async()=>{
 const f=fixture();let offline=false;const h=labelUI((url,init)=>offline?Response.json({error:'저장본 조회 실패'},{status:503}):f.reply(url,init));try{
  await h.idle();h.input('선택 옵션 재질').props.onChange({target:{value:'조회 실패 뒤 유지할 소재'}});offline=true;await h.click('입력 유지·최신 상품고시 조회');assert.equal(h.input('선택 옵션 재질').props.value,'조회 실패 뒤 유지할 소재');assert.equal(h.render().props['data-workspace-dirty'],true);assert.match(text(h.render()),/조회 실패/);assert.equal(h.calls.some(call=>call.init?.method==='PUT'),false);
 }finally{h.close();}
 const source=fixture(),labels=labelUI((url,init)=>url.startsWith('/api/files?')?Response.json({error:'라벨 파일 조회 실패'},{status:503}):source.reply(url,init));try{
  await labels.idle();await labels.click('선택 옵션 상품고시 PNG 미리보기');await labels.click('PNG 업로드·선택 옵션 견적에 연결');assert.equal(source.uploadCount,0);assert.equal(labels.saved,0);assert.ok(labels.button('PNG 업로드·선택 옵션 견적에 연결'));assert.match(text(labels.render()),/라벨 파일 조회 실패/);assert.equal(labels.calls.some(call=>call.init?.method==='POST'||call.init?.method==='PUT'),false);
 }finally{labels.close();}
});

test('an existing preview is hidden immediately on source or SKU change and its retained callback cannot attach',async()=>{
 for(const mode of ['source','option']){
  const f=fixture(),h=labelUI((url,init)=>f.reply(url,init));try{
   await h.idle();await h.click('선택 옵션 상품고시 PNG 미리보기');const attach=h.button('PNG 업로드·선택 옵션 견적에 연결').props.onClick,url=h.created[0];
   if(mode==='source')h.source(initialVersion,'1',false);else h.select('blue');assert.equal(h.button('PNG 업로드·선택 옵션 견적에 연결'),undefined);attach();await h.idle();assert.equal(f.uploadCount,0);assert.ok(h.revoked.includes(url));assert.equal(h.calls.some(call=>call.init?.method==='POST'||call.init?.method==='PUT'),false);
  }finally{h.close();}
 }
});

test('changed selected notice or exclusion during preview refuses attachment before any upload or mutation',async()=>{
 for(const mutate of [view=>view.resolved.rows.find(row=>row.optionId==='red').fields['wire-material'].value='변경된 소재',view=>view.resolved.rows.find(row=>row.optionId==='red').included=false]){
  const f=fixture(),h=labelUI((url,init)=>f.reply(url,init));try{await h.idle();await h.click('선택 옵션 상품고시 PNG 미리보기');mutate(f.view);await h.click('PNG 업로드·선택 옵션 견적에 연결');assert.equal(h.saved,0);assert.equal(f.uploadCount,0);assert.equal(h.calls.some(call=>call.init?.method==='PUT'||call.url.endsWith('/attachments')),false);assert.match(text(h.render()),/변경|포함된 옵션/);}finally{h.close();}
 }
});

// Actual UI callbacks → quotation API/SQLite → selected PNG library/overrides →
// observed category XLSX/manifest. All media, source, auth and template fixtures
// remain local; this does not contact or write to a live Supplier Hub record.
for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`selected notices, manual blanks and generated label reach only their final SKU XLSX cells (${company.companyCode})`,async()=>{
 const api=mobileIntakeHarness(company);let h;try{
  // The shared intake fixture has an arrayBuffer reader. R2's attachment path
  // also exposes a range-limited readable body; model that exact contract here.
  const get=api.bindings.FILES.get;
  api.bindings.FILES.get=async(key,options)=>{
   const object=await get(key),bytes=api.objects.get(key);if(!object||!bytes)return object;
   const start=options?.range?.offset??0,end=options?.range?.length===undefined?bytes.byteLength:start+options.range.length;
   return{...object,body:new Response(new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength).slice(start,end)).body};
  };
  const model=api.load('app/quotation-schema.ts'),schema=model.getQuotationSchema('80719'),fields=schema.fields.map(field=>field.id),workbook=new Uint8Array(quotationWorkbook(fields)),sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const storageKey=api.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');api.objects.set(storageKey,workbook);
  const profile=await api.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'선택 표시사항 시험',categoryId:'80719',categoryPath:schema.categoryPath,template:{name:'synthetic-option-label.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  api.context.category=profile;api.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(api.context),'job');await api.intake();
  const product=api.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,endpoint=base+'/quotation-fields?profileId='+profile.id;let current=await json(await api.route(endpoint));
  const selected=current.resolved.rows.find(row=>row.optionId),other=current.resolved.rows.filter(row=>row.optionId)[1];
  current=await json(await api.route(endpoint,{method:'PUT',body:{expectedRevision:current.revision,expectedInputFingerprint:current.inputFingerprint,changes:[{optionId:null,fieldKey:'noticeMaterial',value:'공통 소재'},{optionId:other.optionId,fieldKey:'noticeMaterial',value:'다른 옵션 소재'}]}}));
  const common=plain(current.overrides.common),otherOverrides=plain(current.overrides.options[other.optionId]),content=api.sqlite.prepare('SELECT payload FROM product_content').get().payload,options=api.sqlite.prepare('SELECT payload FROM product_options').get().payload,policy=api.sqlite.prepare('SELECT payload FROM product_price_policy').get().payload;
  const request=(url,init)=>url==='/api/files'?api.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',body:init.body})):api.route(url,{method:init?.method??'GET',...(init?.body?{body:JSON.parse(init.body)}:{})});
  h=labelUI(request,{productId:product.id,optionId:selected.optionId,version:current.productVersion,profileId:profile.id});await h.idle();assert.equal(h.input('선택 옵션 재질').props.value,'공통 소재');
  h.input('선택 옵션 재질').props.onChange({target:{value:''}});h.input('선택 옵션 제조국').props.onChange({target:{value:'한국'}});await h.click('선택 옵션 상품고시 저장');assert.equal(h.saved,1,text(h.render()));
  await h.click('선택 옵션 상품고시 PNG 미리보기');assert.equal(h.plans[0].rows.find(row=>row[0]==='재질')[1],'[공란]');assert.equal(h.plans[0].rows.find(row=>row[0]==='제조국')[1],'한국');await h.click('PNG 업로드·선택 옵션 견적에 연결');assert.equal(h.saved,2,text(h.render()));
  current=await json(await api.route(endpoint));const selectedRow=current.resolved.rows.find(row=>row.optionId===selected.optionId),key=current.overrides.options[selected.optionId].labelImages.split('\n').at(-1);
  assert.equal(selectedRow.fields.noticeMaterial.value,'');assert.equal(selectedRow.fields.noticeMaterial.source,'manual-option');assert.equal(selectedRow.fields.noticeCountryOfOrigin.value,'한국');assert.ok(current.imageKeys.includes(key));assert.deepEqual(api.objects.get(key),png);
  assert.deepEqual(plain(current.overrides.common),common);assert.deepEqual(plain(current.overrides.options[other.optionId]),otherOverrides);assert.ok(!current.resolved.rows.find(row=>row.optionId===other.optionId).fields.labelImages.value.split('\n').includes(key));
  const preview=await json(await api.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}})),download=await api.route(base+'/quotation',{method:'POST',body:{action:'download',profileId:profile.id,fingerprint:preview.fingerprint}});assert.equal(download.status,200,await download.clone().text());
  const reader=api.load('app/xlsx-template.ts'),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(await download.arrayBuffer())),row=reader.xlsxHeaders(sheet,'견적서',2),next=reader.xlsxHeaders(sheet,'견적서',3);
  assert.equal(row[fields.indexOf('noticeMaterial')],'');assert.equal(row[fields.indexOf('noticeCountryOfOrigin')],'한국');assert.equal(next[fields.indexOf('noticeMaterial')],'다른 옵션 소재');assert.ok(row[fields.indexOf('labelImages')].endsWith('.png'));assert.ok(!next[fields.indexOf('labelImages')].includes(row[fields.indexOf('labelImages')]));
  const exported=await api.route(base+'/quotation',{method:'POST',body:{action:'export',profileId:profile.id,fingerprint:preview.fingerprint}});assert.equal(exported.status,200,await exported.clone().text());
  const archive=api.load('app/exports/zip.ts');assert.ok(archive.zipFiles);const zip=(await import('../extensions/supplier-hub/package.mjs')).readPackageZip(new Uint8Array(await exported.arrayBuffer())),plan=JSON.parse(new TextDecoder().decode(zip.get('supplier-hub-upload-plan.json'))),entry=plan.labelImages.find(item=>item.filename===row[fields.indexOf('labelImages')]);assert.ok(entry);assert.deepEqual(zip.get(entry.archivePath),png);assert.equal(plan.company.code,company.companyCode);assert.equal(plan.categoryId,'80719');
  assert.equal(api.sqlite.prepare('SELECT payload FROM product_content').get().payload,content);assert.equal(api.sqlite.prepare('SELECT payload FROM product_options').get().payload,options);assert.equal(api.sqlite.prepare('SELECT payload FROM product_price_policy').get().payload,policy);assert.equal(api.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');assert.ok(!api.network.includes('supplier.coupang.com'));
 }finally{h?.close();api.close();}
});
