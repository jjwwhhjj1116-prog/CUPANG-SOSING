import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {sizeChartApiFixture,companies,keys} from './helpers/supplier-hub-single-size-chart.mjs';

const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
const sleep=()=>new Promise(resolve=>setTimeout(resolve,1));
const pngSource=fs.readFileSync(new URL('./free-image-text-api.test.mjs',import.meta.url),'utf8');
const pngAst=ts.createSourceFile('fixture.mjs',pngSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const png=vm.runInNewContext('('+pngAst.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='png').getText(pngAst)+')',{Buffer,deflateSync,Uint8Array});
const traces=[];
const files=['app/components/size-chart-extraction-panel.tsx','app/size-chart-extraction-client.ts','app/components/size-chart-workspace.tsx','app/size-chart-extraction.ts','app/api/products/[id]/size-chart-draft/route.ts'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')]));
const beforeHashes=hashes();
test.after(()=>{assert.deepEqual(hashes(),beforeHashes);fs.writeFileSync(new URL('../outputs/step708-extraction-ui-proof.json',import.meta.url),JSON.stringify({sourceHashes:beforeHashes,traces,boundary:'Actual UI/client/OCR parser callbacks and local API/SQLite/R2. Pixel decoder, Tesseract engine, model and translator are synthetic. No browser pixels, real model/OCR quality, network or Hub writes.'},null,2)+'\n');});
const ocrLines=[{text:'尺寸 cm S M',confidence:95,bbox:{x0:10,y0:10,x1:480,y1:40}},{text:'衣长 60 65',confidence:95,bbox:{x0:10,y0:70,x1:480,y1:100}},{text:'胸围 100-105 110.5',confidence:92,bbox:{x0:10,y0:120,x1:480,y1:150}}];
function selection(data){
 const refs=(id,word)=>{const line=data.lines.find(line=>line.id===id),start=line.text.indexOf(word);assert.ok(start>=0);return data.tokens.filter(token=>token.lineId===id&&token.start>=start&&token.end<=start+word.length).map(token=>token.id);};
 return{hasSizeChart:true,unit:refs('ocr-1','cm'),sizes:[refs('ocr-1','S'),refs('ocr-1','M')],measurements:[{name:refs('ocr-2','衣长'),values:[refs('ocr-2','60'),refs('ocr-2','65')]},{name:refs('ocr-3','胸围'),values:[refs('ocr-3','100-105'),refs('ocr-3','110.5')]}]};
}
async function fixture(company=companies[0]){
 const f=await sizeChartApiFixture(company),{h}=f,sourceKey=keys[4];let aiCalls=0,translations=0,aiMode='table',aiWait=null;
 await h.bindings.FILES.put(sourceKey,png(500,300),{httpMetadata:{contentType:'image/png'}});
 Object.assign(h.bindings,{SOURCEFLOW_QUOTATION_AI_PROVIDER:'workers-ai',SOURCEFLOW_QUOTATION_AI_FREE_ONLY:'true'});
 h.bindings.AI={run:async(_model,input)=>{aiCalls++;if(aiWait)await aiWait;const data=JSON.parse(input.messages[1].content),value=selection(data);if(aiMode==='unknown-unit')value.unit=null;return{response:JSON.stringify(aiMode==='none'?{hasSizeChart:false,unit:null,sizes:[],measurements:[]}:value)};}};
 h.load('app/automation/free-image-text.ts').translateImageRegions=async rows=>{translations++;return{regions:rows.map(row=>({id:row.id,original:row.text,translated:row.text==='衣长'?'총장':'가슴둘레',issue:null})),requests:1,stoppedHttpStatus:null,warnings:[]};};
 const calls=[];
 const request=async(path,init={})=>{
  calls.push({path,method:init.method??'GET'});
  if(path.startsWith(f.base+'/size-chart-draft'))return h.load('app/api/products/[id]/size-chart-draft/route.ts')[init.method??'GET'](new Request('https://app.test'+path,{...init,headers:{'content-type':'application/json',...init.headers}}),{params:Promise.resolve({id:f.id})});
  return f.route(path,{method:init.method??'GET',...(init.body?{body:init.body}:{})});
 };
 return{...f,sourceKey,request,calls,get aiCalls(){return aiCalls;},get translations(){return translations;},setAiMode(value){aiMode=value;},waitAi(promise){aiWait=promise;}};
}
function panel(f,{intercept,ocrWait}={}){
 const state=[],effects=[],drafts=[],busyEvents=[],decoded=[],ocr=[];let cursor=0,closed=false,disabled=false;
 const version=f.h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(f.id).updated_at;
 const content=f.h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(f.id),revision=JSON.parse(content.payload).revision;
 const hooks={useState(initial){const at=cursor++;if(!(at in state))state[at]=typeof initial==='function'?initial():initial;return[state[at],value=>state[at]=typeof value==='function'?value(state[at]):value];},useRef(initial){const at=cursor++;return state[at]??(state[at]={current:initial});},useEffect(fn,deps){const at=cursor++,old=state[at];if(!old||!deps||deps.some((value,index)=>value!==old.deps[index])){state[at]={deps};effects.push(()=>{old?.cleanup?.();state[at].cleanup=fn();});}}};
 const request=(path,init)=>intercept?intercept(path,init??{},()=>f.request(path,init)):f.request(path,init);
 const pixelLoader={readFreeImageSourcePixels:async source=>{const image={source,width:source.width,height:source.height,canvas:{width:source.width,height:source.height},blob:new Blob(['synthetic pixels'])};decoded.push(image);return image;}};
 const clientExports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/size-chart-extraction-client.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:clientExports,Error,URLSearchParams,fetch:request,require(name){if(name==='@/app/free-image-translation-client')return pixelLoader;return f.h.load(name.slice(2)+'.ts');}});
 const actualOcr=f.h.load('app/free-image-translation-client.ts'),ocrAdapter={recognizeFreeImage:async(image,language,signal,progress)=>actualOcr.recognizeFreeImage(image,language,signal,progress,async()=>({recognize:async()=>{ocr.push(language);if(ocrWait)await ocrWait;return{data:{blocks:[{paragraphs:[{lines:ocrLines}]}]}};},terminate:async()=>{}}))};
 const jsx=(type,props)=>({type,props}),exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/size-chart-extraction-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,setTimeout,clearTimeout,fetch:request,require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name==='@/app/free-image-translation-client')return ocrAdapter;if(name==='@/app/size-chart-extraction-client')return clientExports;return f.h.load(name.slice(2)+'.ts');}});
 const busyChange=value=>busyEvents.push(value),onDraft=value=>drafts.push(JSON.parse(JSON.stringify(value)));
 const render=()=>{cursor=0;const wrapper=exports.SizeChartExtractionPanel({productId:f.id,version,contentRevision:revision,disabled,onDraft,onBusyChange:busyChange});const tree=wrapper.type(wrapper.props);effects.splice(0).forEach(effect=>effect());return tree;};
 const button=label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label),input=label=>nodes(render()).find(node=>node.props?.['aria-label']===label);
 const idle=async()=>{for(let i=0;i<150;i++){if(closed)return;render();await sleep();if(!render().props['aria-busy']&&(state[0]||state[8]))return;}throw Error('extraction panel did not settle');};
 return{render,button,input,idle,drafts,busyEvents,decoded,ocr,alerts:()=>nodes(render()).filter(node=>node.props?.role==='alert').map(text),async click(label){const node=button(label);assert.ok(node&&!node.props.disabled,label);node.props.onClick();await idle();},disable(){disabled=true;render();},close(){closed=true;state.forEach(value=>value?.cleanup?.());}};
}
for(const company of companies)test(`owned-image OCR to translated reviewed table stays unsaved until manual adoption (${company.code})`,async()=>{
 const f=await fixture(company);let ui;
 try{
  const before=f.h.sqlite.prepare('SELECT * FROM product_content WHERE product_id=?').get(f.id),objects=f.objectState();
  ui=panel(f);await ui.idle();ui.input('사이즈표 원본 사진').props.onChange({target:{value:f.sourceKey}});await ui.click('이미지 문구 읽기');assert.equal(f.aiCalls,0);assert.equal(ui.ocr.length,1);await ui.click('선택한 원문으로 사이즈표 초안 작성');assert.deepEqual(ui.alerts(),[]);assert.equal(f.aiCalls,1);assert.equal(f.translations,1);assert.equal(ui.drafts.length,0);
  assert.equal(ui.input('추출한 사이즈표 단위').props.value,'cm');await ui.click('검토한 표를 편집기에 가져오기');assert.deepEqual(ui.drafts,[{sizeType:'이미지 추출 사이즈표',sizeUnits:'cm',sizes:['S','M'],measurements:[{name:'총장',values:['60','65']},{name:'가슴둘레',values:['100-105','110.5']}]}]);
  assert.deepEqual(f.h.sqlite.prepare('SELECT * FROM product_content WHERE product_id=?').get(f.id),before);assert.equal(f.objectState(),objects);assert.deepEqual(f.h.network,[]);assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_single_receipts').get().n,0);
  traces.push({kind:'reviewed-extraction',company,modelCalls:1,translationCalls:1,drafts:1,measurementsLiteral:true,automaticContentWrites:0,externalRequests:0});
 }finally{ui?.close();f.close();}
});
test('a failed image inventory can be retried without reopening or mutating the saved grid',async()=>{
 const f=await fixture();let ui,inventoryReads=0;
 try{
  ui=panel(f,{intercept(path,init,send){if(path.endsWith('/size-chart-draft')&&!init.method&&++inventoryReads===1)return Promise.resolve(Response.json({error:'일시 조회 실패'},{status:503}));return send();}});await ui.idle();assert.ok(ui.alerts().some(value=>value.includes('일시 조회 실패')));assert.equal(ui.button('이미지 문구 읽기').props.disabled,true);await ui.click('이미지 목록 다시 조회');assert.equal(inventoryReads,2);assert.equal(ui.button('이미지 문구 읽기').props.disabled,false);assert.equal(f.aiCalls,0);assert.equal(ui.drafts.length,0);traces.push({kind:'inventory-retry',reads:2,providerCalls:0});
 }finally{ui?.close();f.close();}
});
test('no detected table leaves the existing grid alone and has no adoption action',async()=>{
 const f=await fixture();let ui;try{
  f.setAiMode('none');ui=panel(f);await ui.idle();ui.input('사이즈표 원본 사진').props.onChange({target:{value:f.sourceKey}});await ui.click('이미지 문구 읽기');await ui.click('선택한 원문으로 사이즈표 초안 작성');assert.deepEqual(ui.alerts(),[]);assert.equal(ui.button('검토한 표를 편집기에 가져오기'),undefined);assert.equal(ui.drafts.length,0);assert.equal(f.translations,0);traces.push({kind:'no-table',drafts:0,fakeCompletion:false});
 }finally{ui?.close();f.close();}
});
test('source bytes changed after review cannot be brought into the editor',async()=>{
 const f=await fixture();let ui;try{
  ui=panel(f);await ui.idle();ui.input('사이즈표 원본 사진').props.onChange({target:{value:f.sourceKey}});await ui.click('이미지 문구 읽기');await ui.click('선택한 원문으로 사이즈표 초안 작성');await f.h.bindings.FILES.put(f.sourceKey,png(500,300,100),{httpMetadata:{contentType:'image/png'}});await ui.click('검토한 표를 편집기에 가져오기');assert.ok(ui.alerts().some(value=>value.includes('변경')));assert.equal(ui.drafts.length,0);traces.push({kind:'changed-image-review',drafts:0});
 }finally{ui?.close();f.close();}
});
test('closing the panel during OCR releases the canvas and ignores its late result',async()=>{
 const f=await fixture();let ui,resolve;
 try{
  const wait=new Promise(done=>{resolve=done;});ui=panel(f,{ocrWait:wait});await ui.idle();ui.input('사이즈표 원본 사진').props.onChange({target:{value:f.sourceKey}});ui.button('이미지 문구 읽기').props.onClick();while(!ui.ocr.length)await sleep();ui.close();resolve();await sleep();await sleep();assert.equal(ui.drafts.length,0);assert.equal(f.aiCalls,0);assert.ok(ui.decoded.every(image=>image.canvas.width===0&&image.canvas.height===0));traces.push({kind:'unmounted-OCR',providerCalls:0,drafts:0});
 }finally{resolve?.();ui?.close();f.close();}
});
test('a missing source unit requires an explicit choice without converting measurements',async()=>{
 const f=await fixture();let ui;try{
  f.setAiMode('unknown-unit');ui=panel(f);await ui.idle();ui.input('사이즈표 원본 사진').props.onChange({target:{value:f.sourceKey}});await ui.click('이미지 문구 읽기');await ui.click('선택한 원문으로 사이즈표 초안 작성');assert.equal(ui.input('추출한 사이즈표 단위').props.value,'');assert.equal(ui.button('검토한 표를 편집기에 가져오기').props.disabled,true);
  ui.input('추출한 사이즈표 단위').props.onChange({target:{value:'mm'}});await ui.click('검토한 표를 편집기에 가져오기');assert.equal(ui.drafts[0].sizeUnits,'mm');assert.deepEqual(ui.drafts[0].measurements[0].values,['60','65']);traces.push({kind:'explicit-unit',automaticallyChosenUnit:false,measurementsUnconverted:true});
 }finally{ui?.close();f.close();}
});
test('a response that forges a measurement outside its token references cannot become a reviewed table',async()=>{
 const f=await fixture();let ui;try{
  ui=panel(f,{async intercept(_path,init,send){const response=await send();if(init.method==='POST'&&response.ok){const body=await response.json();body.chart.measurements[0].values[0]='999';return Response.json(body);}return response;}});await ui.idle();ui.input('사이즈표 원본 사진').props.onChange({target:{value:f.sourceKey}});await ui.click('이미지 문구 읽기');await ui.click('선택한 원문으로 사이즈표 초안 작성');assert.ok(ui.alerts().some(value=>value.includes('OCR')));assert.equal(ui.drafts.length,0);assert.equal(ui.button('검토한 표를 편집기에 가져오기'),undefined);traces.push({kind:'forged-result-rejected',drafts:0});
 }finally{ui?.close();f.close();}
});
test('a disabled parent aborts an in-flight extraction and ignores late model completion',async()=>{
 const f=await fixture();let ui,resolve;try{
  f.waitAi(new Promise(done=>{resolve=done;}));ui=panel(f);await ui.idle();ui.input('사이즈표 원본 사진').props.onChange({target:{value:f.sourceKey}});await ui.click('이미지 문구 읽기');ui.button('선택한 원문으로 사이즈표 초안 작성').props.onClick();while(f.aiCalls===0)await sleep();ui.disable();resolve();await ui.idle();assert.equal(ui.drafts.length,0);assert.equal(ui.button('검토한 표를 편집기에 가져오기'),undefined);assert.deepEqual(ui.alerts(),[]);traces.push({kind:'disabled-model-result',modelCalls:1,drafts:0});
 }finally{resolve?.();ui?.close();f.close();}
});
