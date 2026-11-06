import assert from 'node:assert/strict';
import React from 'react';
import {mobileIntakeHarness} from './mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './hub-schema.mjs';
import {stageRefreshDOM} from './stage-refresh-dom.mjs';

export async function generalMainEntry(){
 const backend=mobileIntakeHarness({companyCode:schemaCompanies[0].code,companyName:schemaCompanies[0].name});let ui;
 const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
 try{
  const snapshot={...hubSchemaSnapshot(schemaCompanies[0]),inputBindings:'couplus-paths-v1'},schema=JSON.parse(snapshot.schemaString);
  schema.properties.imagePage.properties.images={type:'object',properties:{mainImage:{type:'string',title:'대표 이미지',requirement:'필수'}}};snapshot.schemaString=JSON.stringify(schema);
  const profile=await backend.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'일반 대표 편집 진입',categoryId:snapshot.categoryId,categoryPath:schemaPath,hubSchema:snapshot,template:null,mappings:[]});
  backend.context.category=profile;backend.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(backend.context),'job');await backend.intake();
  const product=JSON.parse(JSON.stringify(backend.sqlite.prepare('SELECT * FROM products').get())),base='/api/products/'+product.id,endpoint=base+'/quotation-fields?profileId='+profile.id;
  let view=await json(await backend.route(endpoint));const ids=view.resolved.rows.flatMap(row=>row.optionId?[row.optionId]:[]);assert.ok(ids.length>=2);
  const source=view.imageKeys[0],options=await json(await backend.route(base+'/options')),rows=backend.load('app/product-options.ts').optionInputs(options.options);rows.forEach(row=>{row.imageKey=source;});
  await json(await backend.route(base+'/options',{method:'PATCH',body:{expectedRevision:options.options.revision,expectedProductVersion:options.productVersion,rows}}));
  view=await json(await backend.route(endpoint));await json(await backend.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:ids.map(optionId=>({optionId,fieldKey:'mainImage',value:source}))}}));
  view=await json(await backend.route(endpoint));Object.assign(product,JSON.parse(JSON.stringify(backend.sqlite.prepare('SELECT * FROM products').get())));
  const calls=[];
  const fetcher=async(url,init={})=>{calls.push({url:String(url),method:init.method??'GET',body:init.body});return backend.route(String(url),{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})});};
  let ProductOptions,card;
  const CaptureOptions=props=>{card=props;return React.createElement(ProductOptions,props);};
  ui=await stageRefreshDOM(fetcher,{components:{'product-options-editor':{ProductOptionsEditor:CaptureOptions},'option-main-image-editor':true,'detail-image-edit-dialog':true}});
  ProductOptions=ui.load('app/components/product-options-editor.tsx').ProductOptionsEditor;
  const Detail=ui.load('app/components/dashboard-client.tsx').DetailPanel;
  let props={workspaceOwnerId:'owner',product,settings:{},tab:'대표 이미지',preferredProfileId:profile.id,onSaved(){},onUpload(){},onBeforeFreeImageApply:()=>true};
  const render=async patch=>{props={...props,...patch};await ui.render(Detail,props);};
  const wait=async predicate=>{const deadline=Date.now()+5000;while(!predicate()){assert.ok(Date.now()<deadline,'actual main entry did not settle: '+ui.container.textContent.slice(-1200));await ui.settle();}};
  await render();await wait(()=>!!ui.container.querySelector('[aria-label="최종 대표이미지 옵션"]')&&!ui.container.querySelector('[aria-label="옵션 최종 견적 대표이미지 편집"]')?.getAttribute('aria-busy'));
  await wait(()=>!!ui.container.querySelector('[aria-label="최종 대표이미지 크게 보기"]'));
  const input=()=>ui.container.querySelector('[aria-label="최종 대표이미지 옵션"]');
  const select=async id=>{await ui.React.act(async()=>{input().value=id;input().dispatchEvent(new ui.window.Event('change',{bubbles:true}));});await ui.settle();};
  const button=label=>ui.container.querySelector('button[aria-label="'+label+'"]');
  const click=async label=>{const node=button(label);assert.ok(node,label);assert.equal(node.disabled,false,label);await ui.React.act(async()=>node.click());await ui.settle();};
  const record=name=>ui.records.get(name);
  const configure=async()=>{await ui.React.act(async()=>record('image-generation-panel').onAvailabilityChange({productId:props.product.id,productVersion:props.product.updated_at,configured:true}));await ui.settle();};
  return{backend,ui,product,profile,view,ids,calls,input,select,button,click,record,render,wait,configure,card:()=>card,async close(){await ui.close();backend.close();}};
 }catch(cause){await ui?.close();backend.close();throw cause;}
}
