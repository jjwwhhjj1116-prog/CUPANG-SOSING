import test from 'node:test';
import assert from 'node:assert/strict';
import {companies,downloadFixture,downloadUI,json,nodes,text} from './helpers/image-download-ui.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const allRoles=['main','additional','detailTop','detail','detailBottom','label','size'];
async function fixture(company,stage){
 const f=await downloadFixture(company);
 const content=(await json(await f.api.route(f.base+'/content'))).content,shared=f.keys[3];
 // A persisted legacy role pair is legitimate. Excluding one occurrence must
 // not become an unsaved removal of its occurrence in the other stage.
 content.assets.main={...content.assets.main,value:[shared]};
 f.api.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(content),f.product.id);
 const ui=downloadUI('app/components/product-content-editor.tsx','ProductContentEditor',{product:f.product,section:'이미지',focusedAssetRole:stage},f.request);
 await ui.idle();
 const raw=()=>JSON.stringify(['collection_results','collection_context','product_options','collection_images','category_profiles'].map(table=>f.api.sqlite.prepare('SELECT * FROM '+table).all()));
 const rawBefore=raw(),objects=f.originals(),pool=f.product.image_keys,network=f.api.network.length;
 const quoteBefore=(await json(await f.api.route(f.base+'/quotation-fields'))).resolved;
 return{...f,ui,content,shared,raw,rawBefore,objects,pool,network,quoteBefore};
}
function stageState(ui){
 const tree=ui.render(),elements=nodes(tree).filter(n=>n.props['data-quotation-source-step']).map(n=>({getAttribute(key){const value=n.props[key];return value==null?null:String(value);},querySelector(){return null;}}));
 return ui.load('app/workspace-close.ts').quotationSourceState({querySelector(selector){return nodes(tree).find(n=>selector.startsWith('[data-workspace-saving')?n.props['data-workspace-saving']===true:n.props['data-workspace-dirty']===true)??null;},querySelectorAll(){return elements;}});
}
function focusedButton(ui,key){
 const card=nodes(ui.render()).find(n=>n.type==='div'&&n.props.className?.startsWith('image-asset-card')&&nodes(n).some(v=>v.type==='img'&&v.props.src==='/api/files/'+key));
 assert.ok(card,'actual image card');
 const button=nodes(card).find(n=>n.type==='button'&&typeof n.props['aria-pressed']==='boolean');
 assert.ok(button,'focused stage selection button');return button;
}
const saved=async f=>(await json(await f.api.route(f.base+'/content'))).content;
async function assertPreserved(f,current,stage){
 for(const role of allRoles.filter(role=>role!==stage))assert.deepEqual(current.assets[role],f.content.assets[role],'unrelated saved role: '+role);
 assert.deepEqual(current.seo,f.content.seo);assert.deepEqual(current.detail,f.content.detail);assert.deepEqual(current.label,f.content.label);
 assert.equal(f.raw(),f.rawBefore);assert.equal(f.originals(),f.objects);assert.equal(f.api.sqlite.prepare('SELECT image_keys FROM products').get().image_keys,f.pool);
 assert.equal(f.api.network.length,f.network);assert.equal(f.api.sqlite.prepare('SELECT COUNT(*) AS n FROM supplier_hub_receipts').get().n,0);
 const final=(await json(await f.api.route(f.base+'/quotation-fields'))).resolved;
 for(const row of final.rows.filter(row=>row.included)){
  const before=f.quoteBefore.rows.find(value=>value.optionId===row.optionId);
  if(stage==='detail')assert.equal(row.fields.mainImage.value,before.fields.mainImage.value,'option main selection retained');
  else assert.equal(row.fields.detailImages.value,before.fields.detailImages.value,'saved shared detail/order retained');
 }
}

for(const company of companies)for(const stage of ['main','detail'])for(const action of ['strip','focused-card'])test(`${company.companyCode}: ${stage} ${action} exclusion saves only that shared occurrence and allows final quotation navigation`,async()=>{
 const f=await fixture(company,stage);try{
  if(action==='strip')await f.ui.click('선택 이미지 1 제외');
  else{const button=focusedButton(f.ui,f.shared);assert.equal(button.props['aria-pressed'],true);assert.equal(text(button),'선택 해제');button.props.onClick();await f.ui.idle();}
  assert.equal(f.calls.filter(call=>call.init?.method==='PATCH').length,0,'selection remains a draft until save');
  assert.deepEqual((await saved(f)).assets,f.content.assets);
  assert.deepEqual(plain(stageState(f.ui).steps),[stage==='main'?'대표 이미지':'상세 이미지']);
  await f.ui.click(stage==='main'?'이미지 역할·순서 저장':'상세 설명·이미지 저장');
  const current=await saved(f),expected=f.content.assets[stage].value.filter(key=>key!==f.shared),writes=f.calls.filter(call=>call.init?.method==='PATCH');
  assert.equal(writes.length,1);assert.deepEqual(JSON.parse(writes[0].init.body).patch,{assets:{[stage]:expected}});
  assert.deepEqual(current.assets[stage].value,expected);assert.deepEqual(plain(stageState(f.ui)),{busy:false,steps:[]},'no phantom draft in the other stage');
  f.ui.props({focusedAssetRole:stage==='main'?'detail':'main'});await f.ui.idle();
  const strip=nodes(f.ui.render()).find(n=>n.props['aria-label']==='현재 선택 이미지 순서');
  assert.deepEqual(nodes(strip).filter(n=>n.type==='img').map(n=>decodeURIComponent(n.props.src.slice('/api/files/'.length))),f.content.assets[stage==='main'?'detail':'main'].value);
  assert.equal(f.ui.button(stage==='main'?'상세 설명·이미지 저장':'이미지 역할·순서 저장').props.disabled,true);
  await assertPreserved(f,current,stage);
  const exported=await f.exportQuote(),mainColumn=exported.fields.indexOf('mainImage'),detailColumn=exported.fields.indexOf('detailImages');
  assert.ok(mainColumn>=0&&detailColumn>=0);
  for(let index=0;index<exported.document.rows.length;index++){
   const row=exported.document.rows[index],cells=exported.cells(index),filenames=value=>String(value).split('\n').filter(Boolean).map(key=>exported.document.uploadFilenames[key]).join('\n');
   assert.equal(cells[mainColumn],filenames(row.fields.mainImage.value),'actual XLSX keeps final option main');
   assert.equal(cells[detailColumn],filenames(row.fields.detailImages.value),'actual XLSX keeps final detail order');
   if(stage==='detail')assert.ok(!row.fields.detailImages.value.split('\n').includes(f.shared));
   else assert.ok(row.fields.detailImages.value.split('\n').includes(f.shared));
  }
  assert.equal(f.raw(),f.rawBefore);assert.equal(f.api.network.length,f.network);
 }finally{f.ui.close();f.api.close();}
});

for(const company of companies)test(`${company.companyCode}: explicit role dropdown still moves a legacy shared file to its reviewed new role`,async()=>{
 const f=await fixture(company,'detail');try{
  const index=f.keys.indexOf(f.shared)+1,selector=nodes(f.ui.render()).find(n=>n.props['aria-label']===`이미지 ${index} 역할`);assert.ok(selector);
  selector.props.onChange({target:{value:'detailTop'}});await f.ui.idle();await f.ui.click('상세 설명·이미지 저장');
  const current=await saved(f);assert.deepEqual(current.assets.main.value,[]);assert.deepEqual(current.assets.detailTop.value,[f.shared]);assert.deepEqual(current.assets.detail.value,[f.keys[4],f.keys[5]]);
  assert.equal(allRoles.filter(role=>current.assets[role].value.includes(f.shared)).length,1,'explicit transfer retains the exclusive new role');
  assert.deepEqual(plain(stageState(f.ui)),{busy:false,steps:[]});
  const quote=(await json(await f.api.route(f.base+'/quotation-fields'))).resolved;
  assert.ok(quote.rows.filter(row=>row.included).every(row=>row.fields.detailImages.value.startsWith(f.shared+'\n')));
  assert.equal(f.raw(),f.rawBefore);assert.equal(f.originals(),f.objects);assert.equal(f.api.sqlite.prepare('SELECT image_keys FROM products').get().image_keys,f.pool);
 }finally{f.ui.close();f.api.close();}
});

for(const company of companies)test(`${company.companyCode}: reselecting a legacy shared card restores only its focused role and never creates another-stage draft`,async()=>{
 for(const stage of ['main','detail']){
  const f=await fixture(company,stage);try{
   focusedButton(f.ui,f.shared).props.onClick();await f.ui.idle();
   const excluded=focusedButton(f.ui,f.shared);assert.equal(excluded.props['aria-pressed'],false);excluded.props.onClick();await f.ui.idle();
   assert.equal(focusedButton(f.ui,f.shared).props['aria-pressed'],true);
   if(stage==='main')assert.deepEqual(plain(stageState(f.ui)),{busy:false,steps:[]});
   else{assert.deepEqual(plain(stageState(f.ui).steps),['상세 이미지'],'only the reviewed detail order changed');await f.ui.click('상세 설명·이미지 저장');assert.deepEqual(plain(stageState(f.ui)),{busy:false,steps:[]});}
   const current=await saved(f);
   for(const role of allRoles.filter(role=>role!==stage))assert.deepEqual(current.assets[role],f.content.assets[role]);
   assert.deepEqual(current.assets[stage].value,stage==='main'?[f.shared]:[f.keys[4],f.keys[5],f.shared]);
   assert.equal(f.raw(),f.rawBefore);assert.equal(f.originals(),f.objects);
  }finally{f.ui.close();f.api.close();}
 }
});

for(const company of companies)test(`${company.companyCode}: shared detail exclusion preserves a genuine unsaved main edit across a failed save and retry`,async()=>{
 const f=await fixture(company,'detail');try{
  let fail=true;const request=f.request;
  f.ui.close();
  // The owner intentionally adds a different main image before returning to
  // detail. This genuine unsaved draft must survive the scoped detail save.
  f.ui=downloadUI('app/components/product-content-editor.tsx','ProductContentEditor',{product:f.product,section:'이미지',focusedAssetRole:'detail'},async(url,init={})=>{
   if(fail&&init.method==='PATCH'){fail=false;return Response.json({error:'local transient failure'},{status:503});}return request(url,init);
  });await f.ui.idle();
  f.ui.props({focusedAssetRole:'main'});await f.ui.idle();focusedButton(f.ui,f.keys[9]).props.onClick();await f.ui.idle();f.ui.props({focusedAssetRole:'detail'});await f.ui.idle();await f.ui.click('선택 이미지 1 제외');
  await f.ui.click('상세 설명·이미지 저장');assert.deepEqual((await saved(f)).assets,f.content.assets);assert.deepEqual(plain(stageState(f.ui).steps),['대표 이미지','상세 이미지']);
  await f.ui.click('상세 설명·이미지 저장');assert.deepEqual(plain(stageState(f.ui).steps),['대표 이미지'],'retain only the genuine other-stage draft');
  f.ui.props({focusedAssetRole:'main'});await f.ui.idle();const strip=nodes(f.ui.render()).find(n=>n.props['aria-label']==='현재 선택 이미지 순서');assert.deepEqual(nodes(strip).filter(n=>n.type==='img').map(n=>decodeURIComponent(n.props.src.slice('/api/files/'.length))),[f.keys[9]]);
  await assertPreserved(f,await saved(f),'detail');
 }finally{f.ui.close();f.api.close();}
});
