import test from 'node:test';
import assert from 'node:assert/strict';
import {companies,workspaceRefreshFixture,workspaceRefreshUI,json,nodes,text} from './helpers/workspace-product-refresh.mjs';

const stages=[['SEO','SEO설정'],['가격','가격설정'],['대표 이미지','대표이미지'],['추가 이미지','추가이미지'],['상세 이미지','상세이미지'],['표시사항','한글표시사항'],['견적서','견적서']];
const element=(ui,label)=>{const node=nodes(ui.render()).find(node=>node.props?.['aria-label']===label);assert.ok(node,label);return node;};
const optionRows=ui=>nodes(ui.render()).filter(node=>node.type==='tr'&&node.props['data-option-id']);
const search=(ui,value)=>element(ui,'상품 옵션 검색').props.onChange({target:{value}});
const select=(ui,id)=>element(ui,'옵션 '+id+' 선택').props.onChange({target:{checked:true}});
async function enterBoard(ui,f){ui.component('registration-board').onOptions(await f.current());await ui.settle();assert.equal(ui.componentVisible('product-option-board'),true);}
async function enterStage(ui,id,label){element(ui,'옵션 '+id+' '+label+' 편집').props.onClick();await ui.settle();assert.equal(ui.componentVisible('product-option-board'),false);assert.equal(ui.component('product-options-editor').focusedOptionId,id);}
const capture=async f=>({raw:f.retained(),files:await f.fileSnapshot()});
async function unchanged(f,before){assert.equal(f.retained(),before.raw);assert.equal(await f.fileSnapshot(),before.files);assert.deepEqual(f.network,[]);}
async function options(f){return(await json(await f.route(f.base+'/options'))).options.rows;}

for(const company of companies)test(`all seven option stages close to the same searched/selected table and continue to the second exact option (${company.code})`,async()=>{
 const f=await workspaceRefreshFixture(company);let ui;try{
  const rows=await options(f);ui=await workspaceRefreshUI(f,{realRegistrationBoard:true,realOptionBoard:true});await ui.settle();await enterBoard(ui,f);
  const mount=ui.componentMount('product-option-board');select(ui,rows[0].id);select(ui,rows[1].id);const before=await capture(f);
  for(const [step,label]of stages){
   search(ui,rows[0].originalName);await ui.settle();const shown=optionRows(ui).map(row=>row.props['data-option-id']);
   const former=ui.component('product-option-board'),formerClose=ui.button('×').props.onClick;
   await enterStage(ui,rows[0].id,label);assert.equal(ui.componentMount('product-option-board'),mount);
   const wrapper=nodes(ui.render()).find(node=>node.props?.className==='option-board-return-context');assert.equal(wrapper.props.hidden,true);assert.equal(wrapper.props.inert,true);
   const reads=ui.requests.length;former.onStage(rows[1].id,step);formerClose();await ui.settle();assert.equal(ui.requests.length,reads);assert.equal(ui.component('product-options-editor').focusedOptionId,rows[0].id);
   await ui.click('×');assert.equal(ui.component('product-content-editor'),undefined);assert.equal(ui.componentVisible('product-option-board'),true);assert.equal(ui.componentMount('product-option-board'),mount);
   assert.equal(element(ui,'상품 옵션 검색').props.value,rows[0].originalName);assert.deepEqual(optionRows(ui).map(row=>row.props['data-option-id']),shown);assert.equal(element(ui,'옵션 '+rows[0].id+' 선택').props.checked,true);
   const returnedReads=ui.requests.length;former.onStage(rows[1].id,step);formerClose();await ui.settle();assert.equal(ui.requests.length,returnedReads);assert.equal(ui.componentVisible('product-option-board'),true);
   search(ui,'');await ui.settle();assert.equal(element(ui,'옵션 '+rows[1].id+' 선택').props.checked,true);
   await enterStage(ui,rows[1].id,label);assert.equal(ui.component('product-options-editor').focusedOptionId,rows[1].id);await ui.click('×');assert.equal(ui.componentMount('product-option-board'),mount);
  }
  await unchanged(f,before);assert.ok(ui.requests.every(request=>request.method==='GET'));
 }finally{ui?.close();f.close();}
});

for(const company of companies)test(`busy work and declined dirty close keep the exact option editor; confirmed close returns its unchanged table (${company.code})`,async()=>{
 const f=await workspaceRefreshFixture(company);let ui;let discard=false,confirmations=0;try{
  const rows=await options(f);ui=await workspaceRefreshUI(f,{realOptionBoard:true,confirmClose:()=>{confirmations++;return discard;}});await ui.settle();await enterBoard(ui,f);
  select(ui,rows[0].id);search(ui,rows[0].originalName);await ui.settle();const mount=ui.componentMount('product-option-board');await enterStage(ui,rows[0].id,'SEO설정');
  const editor=ui.componentMount('product-content-editor');ui.editDraft('저장하지 않은 검토 메모');ui.setWorkspaceEdits({dirty:true});const before=await capture(f);
  await ui.click('×');assert.equal(confirmations,1);assert.equal(ui.componentMount('product-content-editor'),editor);assert.equal(ui.draft(),'저장하지 않은 검토 메모');assert.equal(ui.componentVisible('product-option-board'),false);
  ui.setWorkspaceEdits({busy:true});discard=true;await ui.click('×');assert.equal(confirmations,1);assert.equal(ui.componentMount('product-content-editor'),editor);assert.equal(ui.componentVisible('product-option-board'),false);
  ui.setWorkspaceEdits({busy:false});await ui.click('×');assert.equal(confirmations,2);assert.equal(ui.component('product-content-editor'),undefined);assert.equal(ui.componentMount('product-option-board'),mount);
  assert.equal(ui.componentVisible('product-option-board'),true);assert.equal(element(ui,'상품 옵션 검색').props.value,rows[0].originalName);assert.equal(element(ui,'옵션 '+rows[0].id+' 선택').props.checked,true);await unchanged(f,before);
 }finally{ui?.close();f.close();}
});

for(const company of companies)test(`reviewed option prices and main image reload into the same table while other options, source and files stay intact (${company.code})`,async()=>{
 const f=await workspaceRefreshFixture(company);let ui;try{
  const rows=await options(f);ui=await workspaceRefreshUI(f,{realOptionBoard:true});await ui.settle();await enterBoard(ui,f);select(ui,rows[0].id);search(ui,rows[0].originalName);await ui.settle();
  const mount=ui.componentMount('product-option-board'),originalOptions=JSON.stringify(rows),source=f.sqlite.prepare('SELECT payload FROM collection_context').get().payload,files=await f.fileSnapshot();
  await enterStage(ui,rows[0].id,'가격설정');let view=await json(await f.route(f.base+'/quotation-fields'));const priceTargets=f.load('app/quotation-price-targets.ts').quotationPriceTargets(view.resolved.schema.fields);
  await json(await f.route(f.base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[
   {fieldKey:priceTargets.supplyPrice.primary,optionId:rows[0].id,value:'6410'},{fieldKey:priceTargets.salePrice.primary,optionId:rows[0].id,value:'10100'}]}}));
  ui.component('price-editor').onQuotationSaved();await ui.settle();await ui.click('×');assert.equal(ui.componentMount('product-option-board'),mount);
  let row=optionRows(ui).find(row=>row.props['data-option-id']===rows[0].id);assert.match(text(row),/6,410원 \(견적 공급가\)/);assert.match(text(row),/10,100원 \(견적 판매가\)/);
  await enterStage(ui,rows[0].id,'대표이미지');view=await json(await f.route(f.base+'/quotation-fields'));const target=f.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(view.resolved.schema.fields,'mainImage').primary;
  await json(await f.route(f.base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:target,optionId:rows[0].id,value:'owner/synthetic639-additional.png'}]}}));
  ui.component('product-options-editor').onSaved();await ui.settle();await ui.click('×');assert.equal(ui.componentMount('product-option-board'),mount);
  row=optionRows(ui).find(row=>row.props['data-option-id']===rows[0].id);assert.equal(nodes(row).find(node=>node.type==='img').props.src,'/api/files/owner/synthetic639-additional.png');
  search(ui,'');await ui.settle();const current=await json(await f.route(f.base+'/quotation-fields'));
  assert.equal(current.resolved.rows.find(row=>row.optionId===rows[0].id).fields[target].value,'owner/synthetic639-additional.png');assert.notEqual(current.resolved.rows.find(row=>row.optionId===rows[1].id).fields[target].value,'owner/synthetic639-additional.png');
  assert.equal(JSON.stringify(await options(f)),originalOptions);assert.equal(f.sqlite.prepare('SELECT payload FROM collection_context').get().payload,source);assert.equal(await f.fileSnapshot(),files);assert.deepEqual(f.network,[]);
  const after=await capture(f);await enterStage(ui,rows[1].id,'가격설정');await ui.click('×');await unchanged(f,after);
 }finally{ui?.close();f.close();}
});

for(const company of companies)test(`late previous table reads cannot replace the restored latest table or its selection (${company.code})`,async()=>{
 for(const failed of [false,true]){
  const f=await workspaceRefreshFixture(company);let ui;try{
   const rows=await options(f);ui=await workspaceRefreshUI(f,{realOptionBoard:true});await ui.settle();const pending=ui.deferOptionBoard();ui.component('registration-board').onOptions(await f.current());await ui.settle();await pending.arrived;
   // The parent navigation is available while the old table request is held.
   ui.component('product-option-board').onStage(rows[0].id,'SEO');await ui.settle();const oldView=await json(await f.route(f.base+'/quotation-fields')),titleTarget=f.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(oldView.resolved.schema.fields,'title').primary,title=company.name+' 최신 검토 옵션 이름';
   await json(await f.route(f.base+'/quotation-fields',{method:'PUT',body:{expectedRevision:oldView.revision,expectedInputFingerprint:oldView.inputFingerprint,changes:[{fieldKey:titleTarget,optionId:rows[0].id,value:title}]}}));
   ui.component('option-seo-editor').onSaved();await ui.settle();await ui.click('×');
   select(ui,rows[0].id);search(ui,rows[0].originalName);await ui.settle();const before=await capture(f),mount=ui.componentMount('product-option-board'),view=await json(await f.route(f.base+'/quotation-fields'));
   const target=f.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(view.resolved.schema.fields,'title').primary,latestTitle=view.resolved.rows.find(row=>row.optionId===rows[0].id).fields[target].value;
   if(failed)pending.releaseFailure();else pending.release();await ui.settle();assert.equal(ui.componentVisible('product-option-board'),true);assert.equal(ui.componentMount('product-option-board'),mount);
   assert.equal(element(ui,'옵션 '+rows[0].id+' 선택').props.checked,true);assert.equal(element(ui,'상품 옵션 검색').props.value,rows[0].originalName);assert.equal(nodes(optionRows(ui)[0]).find(node=>node.type==='img').props.alt,latestTitle);assert.equal(latestTitle,title);assert.deepEqual(ui.errors(),[]);await unchanged(f,before);
  }finally{ui?.close();f.close();}
 }
});

for(const company of companies)test(`other product, owner, category management, transmission and unmount discard the prior option return scope (${company.code})`,async()=>{
 for(const action of ['product','owner','category','transmission','unmount']){
  const f=await workspaceRefreshFixture(company);let ui;try{
   const rows=await options(f),sibling=await f.addSibling();ui=await workspaceRefreshUI(f,{realOptionBoard:true});await ui.settle();await enterBoard(ui,f);const oldBoard=ui.component('product-option-board');await enterStage(ui,rows[0].id,'견적서');const oldClose=ui.button('×').props.onClick,before=await capture(f);
   if(action==='product'){ui.component('registration-board').onOpen(sibling,'SEO');await ui.settle();oldClose();await ui.settle();assert.equal(ui.component('product-content-editor').product.id,sibling.id);await ui.click('×');}
   if(action==='owner'){ui.switchOwner('another-owner');oldClose();oldBoard.onStage(rows[1].id,'SEO');await ui.settle();assert.equal(ui.component('product-content-editor'),undefined);assert.equal(ui.component('product-option-board'),undefined);}
   if(action==='category'){ui.component('quotation-panel').onManageCategories();await ui.settle();assert.ok(ui.component('intake-queue-panel'));}
   if(action==='transmission'){ui.component('quotation-panel').onPrepareSubmission(f.context.category.id);await ui.settle();assert.ok(ui.component('submission-review-panel'));}
   if(action==='unmount'){const reads=ui.requests.length;ui.close();oldClose();oldBoard.onStage(rows[1].id,'SEO');assert.equal(ui.requests.length,reads);assert.equal(ui.lateWrites,0);}
   if(action!=='unmount')assert.equal(ui.componentVisible('product-option-board'),false);await unchanged(f,before);
  }finally{ui?.close();f.close();}
 }
});
