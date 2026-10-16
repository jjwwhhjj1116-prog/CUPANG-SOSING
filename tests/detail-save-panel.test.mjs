import test from 'node:test';
import assert from 'node:assert/strict';
import {companies,json,nodes,text} from './helpers/image-download-ui.mjs';
import {makeCompositeFixture,loadComposite} from './helpers/detail-image-composite.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const writes=f=>f.calls.filter(call=>['POST','PUT','PATCH','DELETE'].includes(call.init.method));
function panel(f){
 let cursor=0,epoch=0,closed=false,props={productId:f.product.id,optionId:f.optionId,profileId:f.view.categoryContext.profileId,view:f.view,stageActive:true,disabled:false,beforeApply:()=>true};
 const slots=[],effects=[],layouts=[],saved=[],locks=[];
 const effect=(queue,fn,deps)=>{const index=cursor++,old=slots[index];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps?.[i]))){const slot={deps,cleanup:null};slots[index]=slot;queue.push(()=>{old?.cleanup?.();slot.cleanup=fn();});}};
 const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]={value:typeof initial==='function'?initial():initial};return[slots[index].value,value=>{assert.equal(closed,false,'no late state adoption after unmount');epoch++;slots[index].value=typeof value==='function'?value(slots[index].value):value;}];},useRef(value){const index=cursor++;return slots[index]??(slots[index]={current:value});},useEffect(fn,deps){effect(effects,fn,deps);},useLayoutEffect(fn,deps){effect(layouts,fn,deps);}};
 const runtime=loadComposite(f,{modules:{react:hooks,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}}}),Component=runtime.load('app/components/detail-image-composite-panel.tsx').DetailImageCompositePanel;
 function render(){cursor=0;const tree=Component({...props,onSaved(value){saved.push(value);props={...props,view:value};},onBusyChange(value){locks.push(value);}});layouts.splice(0).forEach(fn=>fn());effects.splice(0).forEach(fn=>fn());return tree;}
 const button=label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label),control=label=>nodes(render()).find(node=>node.props?.['aria-label']===label);
 async function idle(){let quiet=0;const deadline=Date.now()+15000;for(;;){const before=epoch,count=f.calls.length;render();await new Promise(resolve=>setTimeout(resolve,2));const tree=render();if(before===epoch&&count===f.calls.length&&!tree.props['data-workspace-saving'])quiet++;else quiet=0;if(quiet===3)return;if(Date.now()>deadline)throw Error('detail save panel did not settle');}}
 return{render,button,control,idle,saved,locks,view:()=>props.view,update(value){props={...props,...value};render();},review(checked=true){const checkbox=control('전체 옵션 상세 저장 확인');assert.ok(checkbox&&!checkbox.props.disabled,'current whole-scope review');checkbox.props.onChange({target:{checked}});render();},async click(label){const value=button(label);assert.ok(value&&!value.props.disabled,label);value.props.onClick();await idle();},close(){if(closed)return;slots.forEach(slot=>slot?.cleanup?.());closed=true;}};
}
async function fixture(company){
 const f=await makeCompositeFixture(company,{count:4,manualHtml:'<p>직접 검토한 기존 HTML</p>'});try{
  const options=await json(await f.api.route(f.base+'/options')),rows=f.api.load('app/product-options.ts').optionInputs(options.options),excluded=rows.find(row=>row.id!==f.optionId);excluded.included=false;
  await json(await f.api.route(f.base+'/options',{method:'PATCH',body:{expectedRevision:options.options.revision,expectedProductVersion:options.productVersion,rows}}));
  f.view=await json(await f.api.route(f.base+'/quotation-fields?profileId='+f.view.categoryContext.profileId));
  const retainedOthers=()=>JSON.stringify(['product_content','product_options','product_price_policy','collection_context','collection_results'].map(table=>[table,f.api.sqlite.prepare('SELECT * FROM '+table).all()]));
  return{...f,excluded:excluded.id,retainedOthers};
 }catch(error){f.api.close();throw error;}
}
async function waitFor(h,predicate){const deadline=Date.now()+10000;while(!predicate()){h.render();await new Promise(resolve=>setTimeout(resolve,2));assert.ok(Date.now()<deadline,'expected held request was not reached');}}

for(const company of companies){
 test(`whole-detail save requires exact review, includes excluded options and atomically backs up before clearing HTML (${company.companyCode})`,async()=>{
  const f=await fixture(company),h=panel(f);try{
   const before=f.retained(),source=f.retainedOthers(),originals=new Map([...f.api.objects].map(([key,bytes])=>[key,Buffer.from(bytes)]));await h.click('상세 이미지 합치기');assert.equal(f.retained(),before);assert.equal(writes(f).length,0);const count=f.view.resolved.rows.filter(row=>row.optionId).length;assert.match(text(h.render()),new RegExp(`모든 옵션 ${count}개`));assert.match(text(h.render()),/견적 제외 옵션도 포함/);assert.match(text(h.render()),/백업.*HTML 입력을 비웁니다/);
   assert.match(text(h.render()),/대체 텍스트 미리보기/);assert.match(text(h.render()),/대체 텍스트는 SEO 설명과 한국어 옵션명/);
   const basis=f.view.detailSaveTextBasis,base=basis.metaDescription||basis.productName+' 상세 설명';
   assert.ok(text(h.render()).includes(base));
   assert.equal(h.button('상세 저장').props.disabled,true);h.button('상세 저장').props.onClick();await h.idle();assert.equal(writes(f).length,0);h.review();const save=h.button('상세 저장').props.onClick;save();save();await h.idle();assert.equal(h.saved.length,1);assert.equal(f.calls.filter(call=>call.url.includes('/detail-save')&&call.init.method==='POST').length,1);assert.equal(f.calls.filter(call=>call.url==='/api/files'&&call.init.method==='POST').length,1);
   const saved=h.saved[0],key=saved.overrides.common.detailImages;assert.ok(saved.imageKeys.includes(key));assert.equal(saved.overrides.common.detailHtml,'');for(const row of saved.resolved.rows){assert.equal(row.fields.detailImages.value,key);assert.equal(row.fields.detailHtml.value,'');}assert.equal(saved.resolved.rows.find(row=>row.optionId===f.excluded).included,false);assert.equal(f.retainedOthers(),source);
   for(const row of saved.resolved.rows.filter(row=>row.optionId))assert.equal(row.fields.altText.value,base+(basis.optionNames[row.optionId]?' - '+basis.optionNames[row.optionId]:''));
   const state=JSON.parse(f.api.sqlite.prepare('SELECT payload FROM product_quotation_fields').get().payload),history=Object.values(state.detailSaveBackups).flat();assert.equal(history.length,1);assert.equal(history[0].before.find(change=>change.optionId===f.optionId&&change.fieldKey==='detailHtml').value,'<p>직접 검토한 기존 HTML</p>');assert.equal(history[0].before.find(change=>change.optionId===f.excluded&&change.fieldKey==='detailHtml').value,'<p>다른 옵션의 직접 HTML</p>');for(const [key,bytes]of originals)assert.deepEqual(Buffer.from(f.api.objects.get(key)),bytes);assert.equal(f.api.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');assert.equal(h.button('합친 이미지 선택 옵션에 적용').props.disabled,true);
  }finally{h.close();f.api.close();}
 });
 test(`old review and save callbacks reject exact-view, stage and profile ABA without accepting a different preview (${company.companyCode})`,async()=>{
  const f=await fixture(company),h=panel(f);try{
   await h.click('상세 이미지 합치기');const frozen=f.retained(),view=h.view();
   for(const [field,value,previous]of [['stageActive',false,true],['disabled',true,false],['view',structuredClone(view),view],['profileId','foreign-profile',view.categoryContext.profileId],['optionId',f.excluded,f.optionId]]){
    const old=h.control('전체 옵션 상세 저장 확인').props.onChange,save=h.button('상세 저장').props.onClick;h.update({[field]:value});old({target:{checked:true}});save();h.update({[field]:previous});await h.idle();old({target:{checked:true}});save();await h.idle();assert.equal(h.control('전체 옵션 상세 저장 확인').props.checked,false,field+' stale checkbox cannot reapprove');assert.equal(writes(f).length,0);
   }
   const old=h.control('전체 옵션 상세 저장 확인').props.onChange;await h.click('상세 이미지 합치기');old({target:{checked:true}});await h.idle();assert.equal(h.control('전체 옵션 상세 저장 확인').props.checked,false);h.review();old({target:{checked:false}});await h.idle();assert.equal(h.control('전체 옵션 상세 저장 확인').props.checked,true);assert.equal(f.retained(),frozen);assert.equal(writes(f).length,0);
  }finally{h.close();f.api.close();}
 });
 test(`whole-save upload ACK loss locks the competing mode and recovers reads before an explicit retry (${company.companyCode})`,async()=>{
  const f=await fixture(company);let lost=true;const request=f.request;f.request=async(url,init={})=>{const response=await request(url,init);if(url==='/api/files'&&init.method==='POST'&&lost){lost=false;throw Error('fixture whole-save upload ACK lost');}return response;};const h=panel(f);try{
   await h.click('상세 이미지 합치기');const oldSelected=h.button('합친 이미지 선택 옵션에 적용').props.onClick;h.review();await h.click('상세 저장');assert.equal(h.saved.length,0);assert.equal(h.button('합친 이미지 선택 옵션에 적용').props.disabled,true);assert.equal(h.button('상세 이미지 합치기').props.disabled,true);assert.equal(h.button('통합 이미지 다운로드').props.disabled,true);assert.equal(h.button('미리보기 닫기').props.disabled,true);const count=writes(f).length;oldSelected();await h.idle();assert.equal(writes(f).length,count);
   await h.click('상세 저장 결과 확인');assert.equal(writes(f).length,count);assert.equal(h.saved.length,0);assert.equal(h.control('전체 옵션 상세 저장 확인').props.checked,false);h.review();await h.click('상세 저장');assert.equal(h.saved.length,1);assert.equal(f.calls.filter(call=>call.url==='/api/files'&&call.init.method==='POST').length,1);assert.equal(f.calls.filter(call=>call.url.includes('/detail-save')&&call.init.method==='POST').length,1);
  }finally{h.close();f.api.close();}
 });
 test(`atomic save ACK loss confirms only the durable receipt and never submits a second save (${company.companyCode})`,async()=>{
  const f=await fixture(company);let lost=true;const request=f.request;f.request=async(url,init={})=>{const response=await request(url,init);if(url.includes('/detail-save')&&init.method==='POST'&&lost){lost=false;assert.equal(response.status,200,await response.clone().text());throw Error('fixture atomic detail ACK lost');}return response;};const h=panel(f);try{
   await h.click('상세 이미지 합치기');h.review();await h.click('상세 저장');assert.equal(h.saved.length,0);const count=writes(f).length;await h.click('상세 저장 결과 확인');assert.equal(writes(f).length,count);assert.equal(h.saved.length,1);assert.equal(f.calls.filter(call=>call.url.includes('/detail-save')&&call.init.method==='POST').length,1);assert.equal(h.locks.at(-1),false);
  }finally{h.close();f.api.close();}
 });
 test(`a completed write returning after stage change waits for current explicit read-only verification (${company.companyCode})`,async()=>{
  const f=await fixture(company),gate=deferred();let held,signal;const request=f.request;f.request=async(url,init={})=>{const response=await request(url,init);if(url.includes('/detail-save')&&init.method==='POST'){held=response;signal=init.signal;await gate.promise;}return response;};const h=panel(f);try{
   await h.click('상세 이미지 합치기');h.review();h.button('상세 저장').props.onClick();await waitFor(h,()=>!!held);h.update({stageActive:false});assert.equal(signal.aborted,false,'dispatched write is not aborted on hidden stage');gate.resolve();await h.idle();assert.equal(h.saved.length,0);h.update({stageActive:true});await h.idle();const count=writes(f).length;await h.click('상세 저장 결과 확인');assert.equal(writes(f).length,count);assert.equal(h.saved.length,1);
  }finally{gate.resolve();h.close();f.api.close();}
 });
 test(`a dispatched whole save survives unmount without late UI callbacks or a competing selected save (${company.companyCode})`,async()=>{
  const f=await fixture(company),gate=deferred();let held,signal;const request=f.request;f.request=async(url,init={})=>{const response=await request(url,init);if(url.includes('/detail-save')&&init.method==='POST'){held=response;signal=init.signal;await gate.promise;}return response;};const h=panel(f);try{
   await h.click('상세 이미지 합치기');const old=h.button('합친 이미지 선택 옵션에 적용').props.onClick;h.review();h.button('상세 저장').props.onClick();await waitFor(h,()=>!!held);h.close();assert.equal(signal.aborted,false);old();gate.resolve();for(let index=0;index<25;index++)await new Promise(resolve=>setTimeout(resolve,2));assert.equal(h.saved.length,0);assert.equal(f.calls.filter(call=>call.url.includes('/detail-save')&&call.init.method==='POST').length,1);assert.equal(f.calls.filter(call=>call.init.method==='PUT').length,0);
  }finally{gate.resolve();h.close();f.api.close();}
 });
 test(`legacy selected-option pending save prevents switching to whole-save mode (${company.companyCode})`,async()=>{
  const f=await fixture(company);let lost=true;const request=f.request;f.request=async(url,init={})=>{const response=await request(url,init);if(url==='/api/files'&&init.method==='POST'&&lost){lost=false;throw Error('fixture selected upload ACK lost');}return response;};const h=panel(f);try{await h.click('상세 이미지 합치기');const oldReview=h.control('전체 옵션 상세 저장 확인').props.onChange,oldAll=h.button('상세 저장').props.onClick;await h.click('합친 이미지 선택 옵션에 적용');const count=writes(f).length;oldReview({target:{checked:true}});oldAll();await h.idle();assert.equal(writes(f).length,count);assert.equal(h.button('상세 저장').props.disabled,true);assert.equal(h.control('전체 옵션 상세 저장 확인').props.disabled,true);assert.ok(h.button('상세 이미지 저장 결과 확인'));assert.equal(f.calls.some(call=>call.url.includes('/detail-save')),false);}finally{h.close();f.api.close();}
 });
}

test('a legacy response without authoritative text sources keeps selected apply available but blocks whole-save review',async()=>{
 const f=await fixture(companies[0]);let h;try{
  delete f.view.detailSaveTextBasis;const request=f.request;
  f.request=async(url,init={})=>{const response=await request(url,init);if(url.includes('/quotation-fields')&&response.ok){const value=await response.json();delete value.detailSaveTextBasis;return Response.json(value);}return response;};
  h=panel(f);await h.click('상세 이미지 합치기');assert.match(text(h.render()),/대체 텍스트 원천/);assert.equal(h.button('상세 저장').props.disabled,true);
  const checkbox=nodes(h.render()).find(node=>node.type==='input'&&node.props['aria-label']==='전체 옵션 상세 저장 확인');assert.equal(checkbox.props.disabled,true);checkbox.props.onChange({target:{checked:true}});h.button('상세 저장').props.onClick();await h.idle();assert.equal(writes(f).length,0);assert.equal(h.button('합친 이미지 선택 옵션에 적용').props.disabled,false);
 }finally{h?.close();f.api.close();}
});

test('whole-save review explicitly retains ordered photos and literal HTML, and a downgraded ACK requires GET-only confirmation', async () => {
 const f=await fixture(companies[0]);let h;
 try{
  const request=f.request;let downgraded=false;
  f.request=async(url,init={})=>{const response=await request(url,init);if(url.includes('/detail-save')&&init.method==='POST'&&response.ok&&!downgraded){
   downgraded=true;const body=await response.json();assert.equal(JSON.parse(init.body).editorPolicy,'ordered-inputs-html-v1');
   assert.ok(body.editor);delete body.editor;delete body.receipt.editorPolicy;delete body.receipt.editorSha256;return Response.json(body);
  }return response;};
  h=panel(f);await h.click('상세 이미지 합치기');
  assert.match(text(h.render()),/개별 사진 4장의 순서와 선택 옵션의 저장 전 HTML/);
  assert.match(text(h.render()),/개별 사진 순서·저장 전 HTML 보관/);
  assert.equal(writes(f).length,0);h.review();await h.click('상세 저장');assert.equal(h.saved.length,0);
  assert.equal(h.control('전체 옵션 상세 저장 확인').props.disabled,true);assert.equal(h.button('합친 이미지 선택 옵션에 적용').props.disabled,true);
  const count=writes(f).length,start=f.calls.length;await h.click('상세 저장 결과 확인');
  assert.equal(h.saved.length,1);assert.equal(writes(f).length,count);assert.ok(f.calls.slice(start).every(call=>(call.init.method??'GET')==='GET'));
  const state=JSON.parse(f.api.sqlite.prepare('SELECT payload FROM product_quotation_fields').get().payload),backup=Object.values(state.detailSaveBackups).flat()[0];
  assert.equal(backup.receipt.editorPolicy,'ordered-inputs-html-v1');assert.equal(backup.editor.html.effective,'<p>직접 검토한 기존 HTML</p>');
  assert.equal(f.calls.filter(call=>call.url.includes('/detail-save')&&call.init.method==='POST').length,1);
 }finally{h?.close();f.api.close();}
});

for(const mode of ['missing','readOnly','differentAliases'])test(`unavailable ${mode} source HTML blocks new whole-save review before uploads and keeps selected apply independent`,async()=>{
 const f=await fixture(companies[0]);let h;
 try{
  function unavailable(view){
   const target=f.api.load('app/quotation-image-targets.ts').optionImageTargets(view.resolved.schema.fields).detailHtml,
    row=view.resolved.rows.find(row=>row.optionId===f.optionId);
   if(mode==='missing')delete row.fields[target.primary];
   if(mode==='readOnly')view.resolved.schema.fields.find(field=>field.id===target.primary).readOnly=true;
   if(mode==='differentAliases'){
    const canonical=view.resolved.schema.fields.find(field=>field.id==='detailHtml');
    const wire={...canonical,id:'exact-html-editor-test',hubInput:'detailHtml',hubWire:{path:['imagePage','details','htmlProductDetailContent']}};
    view.resolved.schema.fields.push(wire);row.fields[wire.id]={...row.fields[canonical.id],value:'다른 공식 HTML'};
   }
   return view;
  }
  f.view=unavailable(f.view);const request=f.request;
  f.request=async(url,init={})=>{const response=await request(url,init);if(url.includes('/quotation-fields')&&response.ok){const body=await response.json();return Response.json(unavailable(body));}return response;};
  h=panel(f);await h.click('상세 이미지 합치기');assert.equal(h.button('상세 저장').props.disabled,true);
  assert.equal(h.control('전체 옵션 상세 저장 확인').props.disabled,true);assert.equal(h.button('합친 이미지 선택 옵션에 적용').props.disabled,false);
  h.control('전체 옵션 상세 저장 확인').props.onChange({target:{checked:true}});h.button('상세 저장').props.onClick();await h.idle();
  assert.equal(writes(f).length,0);assert.equal(h.saved.length,0);assert.equal(h.control('전체 옵션 상세 저장 확인').props.checked,false);
 }finally{h?.close();f.api.close();}
});
