import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {deflateSync} from 'node:zlib';
import {bannerFixture,bannerCompanies as companies,bannerJson} from './helpers/captured-settings-banners.mjs';

const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const plain=value=>JSON.parse(JSON.stringify(value)),same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
function png(){
 const chunk=(name,data)=>{const joined=Buffer.concat([Buffer.from(name),data]);let crc=0xffffffff;for(const byte of joined){crc^=byte;for(let bit=0;bit<8;bit++)crc=crc>>>1^((crc&1)?0xedb88320:0);}const size=Buffer.alloc(4),check=Buffer.alloc(4);size.writeUInt32BE(data.length);check.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([size,joined,check]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(3,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=6;const rows=Buffer.alloc(26,200);rows[0]=0;rows[13]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}

/** Real component, batch model, owned-source API and SQLite are used. OCR,
 * translated text and canvas output are narrow local provider fixtures. */
async function fixture(company,{stage='detail',onlyBanners=false,metadata='normal',recognitionGate}={}){
 const f=await bannerFixture(company);try{
  const endpoint='/api/products/'+f.product().id+'/quotation-fields';let view=await bannerJson(await f.h.route(endpoint));const optionId=view.resolved.rows.find(row=>row.optionId).optionId;
  // Valid synthetic PNGs exercise the actual image parser; no seller media is used.
  for(const key of view.imageKeys)f.h.objects.set(key,new Uint8Array(png()));
  const body=view.imageKeys.filter(key=>![f.top,f.bottom].includes(key)).slice(0,2),keys=onlyBanners?[f.top,f.bottom]:[f.top,...body,f.bottom],input=stage==='detail'?'detailImages':'additionalImages';
  const changes=f.h.load('app/quotation-image-targets.ts').optionImageChanges(view,optionId,{[input]:keys.join('\n'),detailHtml:'<p>수동 HTML 보존</p>'});
  view=await bannerJson(await f.h.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));
  const operations=[],apiCalls=[],preparations=[];
  const request=async(url,init={})=>{apiCalls.push({url,method:init.method??'GET'});const response=await f.h.route(url,{method:init.method??'GET',...(init.body?{body:init.body}:{})});if(metadata==='normal'||!url.includes('/quotation-fields'))return response;const value=await response.json();if(metadata==='missing')delete value.protectedDetailImageKeys;else value.protectedDetailImageKeys=['foreign/banner.png'];return Response.json(value,{status:response.status});};
  const model=f.h.load('app/detail-image-batch.ts');
  const deps={fetcher:request,readSource:async(productId,version,key,role,signal,_fetch,target)=>{
   signal.throwIfAborted();operations.push(['source',key,target.slotIndex]);const query=new URLSearchParams({sourceKey:key,role,target:'quotation',optionId:target.optionId,fieldKey:target.fieldKey,slotIndex:String(target.slotIndex),...(target.profileId?{profileId:target.profileId}:{})});
   const {source}=await bannerJson(await request(`/api/products/${productId}/image-text?${query}`,{signal}));assert.equal(source.productVersion,version);assert.equal(source.quotationTarget.slotIndex,target.slotIndex);return{source,blob:new Blob([f.h.objects.get(key)],{type:'image/png'}),canvas:{},width:source.width,height:source.height};
  },recognize:async(image,language,signal)=>{signal.throwIfAborted();operations.push(['ocr',image.source.sourceKey,language]);await recognitionGate?.promise;signal.throwIfAborted();return[{id:'line',text:language==='zh'?'中文':'English',confidence:99,selected:true,box:{x:0,y:0,width:1,height:1},translated:'',issue:null,translationProvenance:'empty',background:'#fff',foreground:'#000',fontSize:1}];},
  translate:async(source,language,regions,signal)=>{signal.throwIfAborted();operations.push(['translate',source.sourceKey,language]);return{source,regions:regions.map(region=>({...region,original:region.text,translated:'한국어 검토 문구',issue:null})),warnings:[],requests:1,stoppedHttpStatus:null};},
  render:async(image,_regions,signal)=>{signal.throwIfAborted();operations.push(['render',image.source.sourceKey]);return{source:image.source,output:new Blob([f.h.objects.get(image.source.sourceKey)],{type:'image/png'}),width:image.width,height:image.height};}};
  const helpers={...model,readDetailBatchView:(input,signal)=>model.readDetailBatchView(input,signal,request),prepareDetailImageBatch:(input,signal,progress)=>{preparations.push(input.language);return model.prepareDetailImageBatch(input,signal,progress,deps);},applyDetailBatchResult:async()=>{throw Error('No unreviewed or protected item may be applied by this fixture.');}};
  const stable=()=>JSON.stringify({tables:['products','product_content','product_options','product_price_policy','product_quotation_fields','collection_jobs','collection_context','collection_results'].map(table=>[table,f.h.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]),objects:[...f.h.objects].map(([key,bytes])=>[key,Buffer.from(bytes).toString('base64')])});
  return{...f,view,body,keys,optionId,operations,apiCalls,preparations,helpers,stable,props:{productId:f.product().id,optionId,version:view.productVersion,stage,active:true,disabled:false}};
 }catch(error){f.close();throw error;}
}
function panel(f){
 const props={...f.props},slots=[],effects=[],layouts=[],busy=[],saved=[];let cursor=0,epoch=0,closed=false,allowed=true;
 const enqueue=(queue,fn,deps)=>{const index=cursor++,old=slots[index];if(deps===undefined||!old||!same(old.deps,deps)){const slot={deps,cleanup:null};slots[index]=slot;queue.push(()=>{old?.cleanup?.();slot.cleanup=fn();});}};
 const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],value=>{assert.equal(closed,false,'unmounted batch must not adopt late results');epoch++;slots[index]=typeof value==='function'?value(slots[index]):value;}];},useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useEffect(fn,deps){enqueue(effects,fn,deps);},useLayoutEffect(fn,deps){enqueue(layouts,fn,deps);}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/detail-image-batch-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,Blob,URL,require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};if(name==='@/app/detail-image-batch')return f.helpers;throw Error(name);}});
 function render(){cursor=0;const tree=exports.DetailImageBatchPanel({...props,beforeApply:()=>allowed,onSaved(){saved.push(true);},onBusyChange(value){busy.push(value);}});layouts.splice(0).forEach(fn=>fn());effects.splice(0).forEach(fn=>fn());return tree;}
 async function idle(){let quiet=0;for(let index=0;index<400;index++){const before=epoch,calls=f.apiCalls.length;render();await new Promise(resolve=>setImmediate(resolve));const tree=render();if(before===epoch&&calls===f.apiCalls.length&&!tree.props['data-workspace-saving'])quiet++;else quiet=0;if(quiet===2)return tree;}throw Error('batch panel did not settle');}
 const button=label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label),control=label=>nodes(render()).find(node=>node.props?.['aria-label']===label);
 return{props,busy,saved,render,idle,button,control,permission(value){allowed=value;},async click(label){const value=button(label);assert.ok(value&&!value.props.disabled,label+' '+text(render()));value.props.onClick();await idle();},close(){if(closed)return;slots.forEach(slot=>slot?.cleanup?.());closed=true;}};
}

for(const company of companies){
 for(const [action,language,opposite]of [['영어→한국어 번역','en','zh'],['모든 이미지 AI 처리','zh','en']])test(`detail ${action} translates only body slots and retains skipped banners without writes (${company.code})`,async()=>{
  const f=await fixture(company),h=panel(f);try{
   await h.idle();const frozen=f.stable();assert.match(text(h.render()),/본문 이미지 2장/);assert.match(text(h.render()),/설정 배너 2장/);assert.equal(h.button('모든 상세 이미지 번역 준비'),undefined);
   h.control('일괄 상세 이미지 원문 언어').props.onChange({target:{value:opposite}});h.button(action).props.onClick();await h.idle();assert.deepEqual(f.preparations,[language],'explicit button overrides a pending dropdown update');
   for(const operation of ['source','ocr','translate','render'])assert.deepEqual(f.operations.filter(row=>row[0]===operation).map(row=>row[1]),f.body,operation+' excludes both banner keys: '+text(h.render()));
   assert.ok(f.operations.filter(row=>['ocr','translate'].includes(row[0])).every(row=>row[2]===language));assert.deepEqual(f.operations.filter(row=>row[0]==='source').map(row=>row[2]),[1,2],'original slot indices are not compacted');
   for(const slot of [1,4]){const card=h.control(`일괄 상세 이미지 ${slot}`);assert.ok(card);assert.match(text(card),/설정 배너.*원본 유지/);assert.equal(h.control(`상세 이미지 ${slot} 번역 결과 검토 완료`),undefined);assert.equal(nodes(card).some(node=>node.props?.role==='alert'),false);}
   assert.ok(h.control('상세 이미지 2 번역 결과 검토 완료'));assert.ok(h.control('상세 이미지 3 번역 결과 검토 완료'));assert.match(text(h.render()),/2개 미리보기 준비 · 설정 배너 2개 원본 유지/);assert.equal(h.button('검토한 상세 이미지 0개 적용').props.disabled,true);assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(h.saved.length,0);assert.equal(f.apiCalls.some(call=>call.method!=='GET'),false);assert.equal(f.stable(),frozen);
  }finally{h.close();f.close();}
 });
 test(`banner-only and unproved-role detail selections cannot start provider work (${company.code})`,async()=>{
  for(const options of [{onlyBanners:true},{metadata:'missing'},{metadata:'foreign'}]){
   const f=await fixture(company,options),h=panel(f);try{await h.idle();const frozen=f.stable();assert.equal(h.button('영어→한국어 번역').props.disabled,true);assert.equal(h.button('모든 이미지 AI 처리').props.disabled,true);assert.equal(f.operations.length,0);if(options.metadata)assert.ok(nodes(h.render()).some(node=>node.props?.role==='alert'&&/상단|하단|조회/.test(text(node))));else assert.match(text(h.render()),/본문 이미지 0장.*설정 배너 2장/);assert.equal(f.stable(),frozen);}finally{h.close();f.close();}
  }
 });
 test(`additional batch retains its original action and includes every selected slot even when banner metadata is absent (${company.code})`,async()=>{
  const f=await fixture(company,{stage:'additional',metadata:'missing'}),h=panel(f);try{await h.idle();const frozen=f.stable();assert.equal(h.button('영어→한국어 번역'),undefined);assert.equal(h.button('모든 이미지 AI 처리'),undefined);await h.click('모든 이미지 일괄 처리');assert.deepEqual(f.preparations,['zh']);assert.deepEqual(f.operations.filter(row=>row[0]==='source').map(row=>row[1]),f.keys);assert.equal(f.apiCalls.some(call=>call.method!=='GET'),false);assert.equal(f.stable(),frozen);}finally{h.close();f.close();}
 });
 test(`permission, hidden-stage ABA and stale prepare callbacks cannot initiate detail provider work (${company.code})`,async()=>{
  const f=await fixture(company),h=panel(f);try{await h.idle();const frozen=f.stable();h.permission(false);await h.click('모든 이미지 AI 처리');assert.equal(f.preparations.length,0);h.permission(true);
   for(const [field,value]of [['active',false],['disabled',true],['version',new Date(Date.parse(f.props.version)+1).toISOString()],['refreshToken','new-clock'],['optionId','foreign-option']]){const old=h.button('영어→한국어 번역').props.onClick,previous=h.props[field];h.props[field]=value;h.render();old();h.props[field]=previous;h.render();await h.idle();old();await h.idle();assert.equal(f.preparations.length,0,field+' captured callback is obsolete');}
   assert.equal(f.operations.length,0);assert.equal(f.apiCalls.some(call=>call.method!=='GET'),false);assert.equal(f.stable(),frozen);
  }finally{h.close();f.close();}
 });
 test(`a retained English review checkbox cannot approve or unapprove a newly prepared Chinese result (${company.code})`,async()=>{
  const f=await fixture(company),h=panel(f);try{await h.idle();const frozen=f.stable();await h.click('영어→한국어 번역');const oldReview=h.control('상세 이미지 2 번역 결과 검토 완료').props.onChange;await h.click('모든 이미지 AI 처리');oldReview({target:{checked:true}});await h.idle();assert.equal(h.control('상세 이미지 2 번역 결과 검토 완료').props.checked,false);assert.equal(h.button('검토한 상세 이미지 0개 적용').props.disabled,true);
   h.control('상세 이미지 2 번역 결과 검토 완료').props.onChange({target:{checked:true}});await h.idle();assert.equal(h.control('상세 이미지 2 번역 결과 검토 완료').props.checked,true);oldReview({target:{checked:false}});await h.idle();assert.equal(h.control('상세 이미지 2 번역 결과 검토 완료').props.checked,true);assert.deepEqual(f.preparations,['en','zh']);assert.equal(f.apiCalls.some(call=>call.method!=='GET'),false);assert.equal(h.saved.length,0);assert.equal(f.stable(),frozen);
  }finally{h.close();f.close();}
 });
 test(`held body OCR aborts on hidden, disabled or source changes without further provider work after return (${company.code})`,async()=>{
  for(const [field,value]of [['active',false],['disabled',true],['version','2027-01-01T00:00:00.000Z'],['refreshToken','new-source-clock']]){
   const gate=deferred(),f=await fixture(company,{recognitionGate:gate}),h=panel(f);try{await h.idle();const frozen=f.stable();h.button('모든 이미지 AI 처리').props.onClick();for(let index=0;index<50&&!f.operations.some(row=>row[0]==='ocr');index++){h.render();await new Promise(resolve=>setImmediate(resolve));}assert.equal(f.operations.filter(row=>row[0]==='ocr').length,1);const previous=h.props[field];h.props[field]=value;h.render();h.props[field]=previous;h.render();gate.resolve();await h.idle();assert.equal(f.operations.filter(row=>row[0]==='source').length,1,field+' prevents the next image read');assert.equal(f.operations.some(row=>row[0]==='translate'||row[0]==='render'),false,field+' abort reaches pending OCR');assert.equal(h.busy.at(-1),false);assert.equal(f.apiCalls.some(call=>call.method!=='GET'),false);assert.equal(f.stable(),frozen);}finally{gate.resolve();h.close();f.close();}
  }
 });
}
