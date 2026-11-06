import test from 'node:test';
import assert from 'node:assert/strict';
import {stageRefreshDOM} from './helpers/stage-refresh-dom.mjs';

const version='2026-11-06T00:00:00.000Z',newVersion='2026-11-06T00:00:01.000Z';
const product={id:'p',title:'original product title',image_keys:'["owner/a.png"]',updated_at:version};
const changedProduct={...product,title:'externally changed title',updated_at:newVersion};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const reactProps=node=>node[Object.keys(node).find(key=>key.startsWith('__reactProps'))];
const marker=(h,step)=>h.container.querySelector(`[data-quotation-source-step="${step}"]`)?.getAttribute('data-workspace-dirty');
const dirty=h=>h.container.firstElementChild.getAttribute('data-workspace-dirty');
async function change(h,selector,value){const node=h.container.querySelector(selector);assert.ok(node,selector);await h.React.act(async()=>reactProps(node).onChange({target:{value}}));await h.settle();}
async function click(h,label){const node=[...h.container.querySelectorAll('button')].find(item=>item.textContent===label);assert.ok(node&&!node.disabled,label);await h.React.act(async()=>node.click());await h.settle();}
const props={product,section:'이미지',focusedAssetRole:'detail',autoFillLabel:false,active:true};

test('actual fresh hidden common editor has no unedited dirty source and leaves the SEO preflight clear',async()=>{
 const calls=[],h=await stageRefreshDOM(async url=>{calls.push(String(url));return Response.json({error:'hidden content must not load'},{status:503});});
 try{
  const Editor=h.load('app/components/product-content-editor.tsx').ProductContentEditor;
  await h.render(Editor,{...props,section:'SEO',focusedAssetRole:undefined,seoLayout:true,active:false});
  assert.deepEqual(calls,[]);assert.equal(dirty(h),'false');assert.equal(marker(h,'상세 이미지'),'false');
  const state=h.load('app/workspace-close.ts').workspaceEditState(h.container);assert.equal(state.dirty,false,'the real saved-source preflight must not detect a fabricated detail edit');assert.equal(state.busy,false);
  await h.render(Editor,{...props,product:changedProduct,section:'SEO',focusedAssetRole:undefined,seoLayout:true,active:false});assert.equal(dirty(h),'false');assert.deepEqual(calls,[]);
 }finally{await h.close();}
});

test('actual read-only title and clock changes do not fabricate an edit or prevent the normal fresh read',async()=>{
 let content,reads=0;const h=await stageRefreshDOM(async()=>{reads++;return Response.json({content});});
 try{
  content=h.load('app/product-content.ts').emptyProductContent('p');content.revision=1;const Editor=h.load('app/components/product-content-editor.tsx').ProductContentEditor;
  await h.render(Editor,props);assert.equal(reads,1);assert.equal(dirty(h),'false');
  await h.render(Editor,{...props,active:false});await h.render(Editor,{...props,product:changedProduct,active:false});assert.equal(reads,1);assert.equal(marker(h,'상세 이미지'),'false');assert.equal(dirty(h),'false');
  await h.render(Editor,{...props,product:changedProduct});assert.equal(reads,2,'a clean source change still verifies the saved content');assert.equal(dirty(h),'false');assert.equal(marker(h,'상세 이미지'),'false');
 }finally{await h.close();}
});

test('actual manual detail clear survives a hidden title/source A-B-A without a new read or false clean state',async()=>{
 let content,reads=0;const h=await stageRefreshDOM(async()=>{reads++;return Response.json({content});});
 try{
  content=h.load('app/product-content.ts').emptyProductContent('p');content.revision=1;content.detail.description={value:'saved description',provenance:'manual',updatedAt:version};const Editor=h.load('app/components/product-content-editor.tsx').ProductContentEditor;
  await h.render(Editor,props);await change(h,'[aria-label="상세페이지 설명"]','');assert.equal(dirty(h),'true');
  await h.render(Editor,{...props,active:false});await h.render(Editor,{...props,product:changedProduct,active:false});await h.render(Editor,{...props,active:false});await h.render(Editor,props);
  assert.equal(reads,1);assert.equal(h.container.querySelector('[aria-label="상세페이지 설명"]').value,'');assert.equal(marker(h,'상세 이미지'),'true');assert.equal(dirty(h),'true');
 }finally{await h.close();}
});

test('actual content save with a lost acknowledgement retains the dirty draft and never replays on return',async()=>{
 const hold=deferred();let content,writes=0,reads=0,signal,saved=0,model;
 const h=await stageRefreshDOM(async(_url,init={})=>{
  if(init.method==='PATCH'){writes++;signal=init.signal;content=model.applyContentPatch(content,JSON.parse(init.body).patch,newVersion);await hold.promise;throw Error('lost acknowledgement');}
  reads++;return Response.json({content});
 });
 try{
  model=h.load('app/product-content.ts');content=model.emptyProductContent('p');content.revision=1;const Editor=h.load('app/components/product-content-editor.tsx').ProductContentEditor,view={...props,onSaved(){saved++;}};
  await h.render(Editor,view);await change(h,'[aria-label="상세페이지 설명"]','pending manual detail');await click(h,'상세 설명·이미지 저장');assert.equal(writes,1);
  await h.render(Editor,{...view,product:changedProduct,active:false});assert.equal(signal.aborted,false);assert.equal(h.container.firstElementChild.getAttribute('data-workspace-saving'),'true');
  await h.React.act(async()=>hold.resolve());await h.settle();await h.render(Editor,{...view,product:changedProduct});await h.render(Editor,{...view,active:false});await h.render(Editor,view);
  assert.equal(writes,1);assert.equal(reads,1);assert.equal(saved,0);assert.equal(dirty(h),'true');assert.equal(h.container.querySelector('[aria-label="상세페이지 설명"]').value,'pending manual detail');assert.ok(h.container.querySelector('[role="alert"]'));
  await click(h,'입력 버리고 저장본 불러오기');assert.equal(writes,1);assert.equal(reads,2);assert.equal(dirty(h),'false');assert.equal(h.container.querySelector('[aria-label="상세페이지 설명"]').value,'pending manual detail');
 }finally{hold.resolve();await h.close();}
});

for(const editDetail of [false,true])test(`actual image save adopts its new baseline while preserving other-step drafts (manual detail=${editDetail})`,async()=>{
 let content,model,reads=0;const requests=[],h=await stageRefreshDOM(async(_url,init={})=>{if(init.method==='PATCH'){const body=JSON.parse(init.body);requests.push(body);content=model.applyContentPatch(content,body.patch,newVersion);}else reads++;return Response.json({content});});
 try{
  model=h.load('app/product-content.ts');content=model.emptyProductContent('p');content.revision=1;const Editor=h.load('app/components/product-content-editor.tsx').ProductContentEditor;
  await h.render(Editor,{...props,section:'SEO',focusedAssetRole:undefined,seoLayout:true});await change(h,'[aria-label="SEO 상품명"]','retained SEO input');
  await h.render(Editor,props);if(editDetail)await change(h,'[aria-label="상세페이지 설명"]','retained detail input');
  await h.render(Editor,{...props,product:changedProduct,focusedAssetRole:'main'});await click(h,'대표 이미지로 선택');await click(h,'이미지 역할·순서 저장');
  assert.equal(requests.length,1);assert.deepEqual(requests[0].patch,{assets:{main:['owner/a.png']}});assert.equal(marker(h,'대표 이미지'),'false');assert.equal(marker(h,'상세 이미지'),String(editDetail));assert.equal(marker(h,'SEO'),'true');assert.equal(reads,1);
  await h.render(Editor,{...props,product:changedProduct,section:'SEO',focusedAssetRole:undefined,seoLayout:true});assert.equal(h.container.querySelector('[aria-label="SEO 상품명"]').value,'retained SEO input');
  if(editDetail){await h.render(Editor,{...props,product:changedProduct});assert.equal(h.container.querySelector('[aria-label="상세페이지 설명"]').value,'retained detail input');}
 }finally{await h.close();}
});

test('actual successful SEO save adopts one clean baseline and preserves independent detail input',async()=>{
 let content,model;const requests=[],h=await stageRefreshDOM(async(_url,init={})=>{if(init.method==='PATCH'){const body=JSON.parse(init.body);requests.push(body);content=model.applyContentPatch(content,body.patch,newVersion);}return Response.json({content});});
 try{
  model=h.load('app/product-content.ts');content=model.emptyProductContent('p');content.revision=1;const Editor=h.load('app/components/product-content-editor.tsx').ProductContentEditor;
  const seo={...props,section:'SEO',focusedAssetRole:undefined,seoLayout:true};await h.render(Editor,seo);await change(h,'[aria-label="SEO 상품명"]','saved SEO title');await click(h,'SEO 저장');assert.equal(dirty(h),'false');assert.equal(marker(h,'상세 이미지'),'false');
  await h.render(Editor,props);await change(h,'[aria-label="상세페이지 설명"]','independent detail input');await h.render(Editor,seo);await change(h,'[aria-label="SEO 상품명"]','second SEO title');await click(h,'SEO 저장');
  assert.equal(requests.length,2);assert.equal(marker(h,'SEO'),'false');assert.equal(marker(h,'상세 이미지'),'true');await h.render(Editor,props);assert.equal(h.container.querySelector('[aria-label="상세페이지 설명"]').value,'independent detail input');
 }finally{await h.close();}
});
