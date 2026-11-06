import test from 'node:test';
import assert from 'node:assert/strict';
import {stageRefreshDOM} from './helpers/stage-refresh-dom.mjs';
import {seoWorkspaceHarness} from './helpers/seo-workspace.mjs';

const version='2026-11-06T00:00:00.000Z',newVersion='2026-11-06T00:00:01.000Z';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const handlers=node=>node[Object.keys(node).find(key=>key.startsWith('__reactProps'))];
async function change(h,label,value){const input=h.container.querySelector(`[aria-label="${label}"]`);assert.ok(input,label);await h.React.act(async()=>handlers(input).onChange({target:{value}}));await h.settle();}
async function click(h,label){const button=[...h.container.querySelectorAll('button')].find(node=>node.textContent===label);assert.ok(button&&!button.disabled,label);await h.React.act(async()=>button.click());await h.settle();}
function quoteView(h,clock=version){
 const model=h.load('app/quotation-schema.ts'),content=h.load('app/product-content.ts').emptyProductContent('p'),options=h.load('app/product-options.ts'),settings=h.load('app/workspace-settings.ts').defaultSettings;
 content.seo.title.value='제목';content.seo.keywords.value=['태그'];content.assets.main.value=['owner/a.png'];
 const source={categoryId:'80719',product:{id:'p',title:'제목',supply_price:2000,sale_price:3000,msrp:4000,exchange_rate:200,supply_margin:0,coupang_margin:0,image_keys:'["owner/a.png"]'},content,settings,options:options.applyOptionRows(options.emptyProductOptions('p'),[{...options.emptyOptionInput('red'),originalName:'빨강',translatedName:'빨강',included:true,unitCostCny:3}],clock)};
 return {revision:1,inputFingerprint:'a'.repeat(64),overrides:model.emptyQuotationOverrides(),resolved:model.resolveQuotationFields(source),automatic:model.resolveQuotationFields(source),imageKeys:['owner/a.png'],protectedDetailImageKeys:[],categoryContext:{source:'collection',profileId:null,categoryId:'80719',categoryPath:[]},productVersion:clock,updatedAt:clock,contentRevision:0,optionRevision:1};
}
test('actual React inactive automatic readers stay silent through separate counter and product-clock commits',async()=>{
 const requests=[],h=await stageRefreshDOM(async(url)=>{requests.push(String(url));return Response.json({error:'unused inactive response'},{status:500});});
 try{
  const readers=[['option-seo-editor','OptionSeoEditor'],['option-label-editor','OptionLabelEditor'],['option-image-editor','OptionImageEditor'],['product-label-editor','ProductLabelReferenceEditor']];
  const components=readers.map(([file,name])=>h.load('app/components/'+file+'.tsx')[name]);
  function Readers(props){return components.map((Component,index)=>h.React.createElement(Component,{key:index,productId:'p',optionId:'red',stage:'detail',active:false,version, ...props}));}
  await h.render(Readers,{refreshToken:'0'});assert.deepEqual(requests,[],'inactive initial mount');
  await h.render(Readers,{refreshToken:'1'});assert.deepEqual(requests,[],'held parent response: counter commit');
  await h.render(Readers,{refreshToken:'1',version:newVersion});assert.deepEqual(requests,[],'later parent clock commit');
 }finally{await h.close();}
});

test('actual quotation form defers hidden counter/clock reads and window focus; active focus keeps its read policy',async()=>{
 const requests=[];let value;
 const h=await stageRefreshDOM(async url=>{requests.push(String(url));return Response.json(value);});
 try{
  value=quoteView(h);const Form=h.load('app/components/quotation-fields-editor.tsx').QuotationFieldsEditor;
  const props={productId:'p',refreshToken:'0',submissionActive:true};
  await h.render(Form,props);assert.equal(requests.length,1);
  await h.render(Form,{...props,submissionActive:false,refreshToken:'1'});
  await h.React.act(async()=>h.window.dispatchEvent(new h.window.Event('focus')));assert.equal(requests.length,1);
  value=quoteView(h,newVersion);await h.render(Form,{...props,submissionActive:false,refreshToken:'1:'+newVersion});assert.equal(requests.length,1);
  await h.render(Form,{...props,refreshToken:'1:'+newVersion});assert.equal(requests.length,2,'stale activation reads once');
  await h.render(Form,{...props,submissionActive:false,refreshToken:'1:'+newVersion});await h.render(Form,{...props,refreshToken:'1:'+newVersion});assert.equal(requests.length,2,'same-source revisit');
  await h.React.act(async()=>h.window.dispatchEvent(new h.window.Event('focus')));await h.settle();assert.equal(requests.length,3,'active focus refresh remains');
 }finally{await h.close();}
});

test('actual quotation failed source refresh retries once on the next activation without an active retry loop',async()=>{
 let reads=0,fail=false,value;
 const h=await stageRefreshDOM(async()=>{reads++;return fail?Response.json({error:'fresh source temporarily unavailable'},{status:503}):Response.json(value);});
 try{
  value=quoteView(h);const Form=h.load('app/components/quotation-fields-editor.tsx').QuotationFieldsEditor,props={productId:'p',refreshToken:'old',submissionActive:true,navigationTarget:{optionId:'red',fieldId:'manufacturer'}};
  await h.render(Form,props);assert.equal(reads,1);const brand=h.container.querySelector('input[id$="-manufacturer"]');assert.ok(brand);await h.React.act(async()=>handlers(brand).onChange({target:{value:'보존할 검토 브랜드'}}));assert.equal(h.container.querySelector('[data-workspace-dirty]').getAttribute('data-workspace-dirty'),'true');await h.render(Form,{...props,submissionActive:false,refreshToken:'new'});
  fail=true;await h.render(Form,{...props,refreshToken:'new'});assert.equal(reads,2);await h.settle();await h.settle();assert.equal(reads,2,'no retry loop while active');assert.match(h.container.textContent,/fresh source temporarily unavailable/);
  fail=false;value=quoteView(h,newVersion);await h.render(Form,{...props,submissionActive:false,refreshToken:'new'});await h.render(Form,{...props,refreshToken:'new'});assert.equal(reads,3,'retry the failed source once at next activation');assert.doesNotMatch(h.container.textContent,/fresh source temporarily unavailable/);assert.equal(h.container.querySelector('input[id$="-manufacturer"]').value,'보존할 검토 브랜드');assert.equal(h.container.querySelector('[data-workspace-dirty]').getAttribute('data-workspace-dirty'),'true');
  await h.render(Form,{...props,submissionActive:false,refreshToken:'new'});await h.render(Form,{...props,refreshToken:'new'});assert.equal(reads,3,'successful source is reused');
 }finally{await h.close();}
});

for(const mode of ['normal','existing','retry'])test(`actual Dashboard common image ${mode} upload refreshes only its product`,async()=>{
 const existing=mode==='existing',api=seoWorkspaceHarness(),requests=[];const key='owner/upload.png';let product={...api.product},content,loseAck=mode==='retry';
 if(existing)product={...product,image_keys:JSON.stringify([...JSON.parse(product.image_keys),key])};
 const h=await stageRefreshDOM(async(url,init={})=>{
  url=String(url);requests.push({url,method:init.method??'GET'});
  if(url==='/api/products')return Response.json({products:[product]});if(url==='/api/settings')return Response.json({settings:null,scope:{ownerId:'owner',company:null}});if(url==='/api/collection-jobs')return Response.json({jobs:[]});if(url==='/api/category-profiles')return Response.json({profiles:[]});
  if(url==='/api/files')return Response.json({key});if(url===`/api/products/${api.id}`)return Response.json({product});if(url===`/api/products/${api.id}/content`)return Response.json({content});
  if(url===`/api/products/${api.id}/attachments`){product={...product,image_keys:JSON.stringify([...JSON.parse(product.image_keys),key]),updated_at:new Date(Date.parse(product.updated_at)+1000).toISOString()};if(loseAck){loseAck=false;throw Error('committed attachment lost ACK');}return Response.json({saved:true});}
  return Response.json({error:'unexpected fixture endpoint'},{status:503});
 });
 try{
  content=h.load('app/product-content.ts').emptyProductContent(api.id);await h.render(h.load('app/components/dashboard-client.tsx').default,{userName:'fixture',workspaceOwnerId:'owner'});await h.React.act(async()=>h.records.get('registration-board').onOpen(product,'대표 이미지'));await h.settle();
  const input=h.container.querySelector('input[type=file]'),before=requests.length;assert.ok(input&&!input.disabled);Object.defineProperty(input,'files',{configurable:true,value:[new File(['fixture'],'upload.png',{type:'image/png'})]});await h.React.act(async()=>input.dispatchEvent(new h.window.Event('change',{bubbles:true})));await h.settle();
  if(mode==='retry'){assert.match(h.container.textContent,/업로드 파일 연결 대기/);assert.equal(requests.slice(before).filter(row=>row.url.endsWith('/attachments')).length,1);await click(h,'보관된 이미지 연결 재시도');assert.doesNotMatch(h.container.textContent,/업로드 파일 연결 대기/);}
  const interval=requests.slice(before);assert.deepEqual(interval.filter(row=>['/api/products','/api/settings','/api/collection-jobs','/api/category-profiles'].includes(row.url)),[]);assert.equal(interval.filter(row=>row.url===`/api/products/${api.id}`).length,mode==='retry'?3:2,'preflight(s) plus one guarded readback');assert.equal(interval.filter(row=>row.url.endsWith('/attachments')).length,existing?0:1);assert.ok(JSON.parse(h.records.get('registration-board').products[0].image_keys).includes(key));
 }finally{await h.close();api.close();}
});

for(const scenario of ['owner','failed-readback'])test(`actual Dashboard upload ${scenario} readback preserves saved-state and publication guards`,async()=>{
 const api=seoWorkspaceHarness(),hold=deferred(),requests=[],key='owner/upload.png';let product={...api.product},content,productReads=0;
 const h=await stageRefreshDOM(async(url,init={})=>{
  url=String(url);requests.push({url,method:init.method??'GET'});
  if(url==='/api/products')return Response.json({products:[product]});if(url==='/api/settings')return Response.json({settings:null,scope:{ownerId:'owner',company:null}});if(url==='/api/collection-jobs')return Response.json({jobs:[]});if(url==='/api/category-profiles')return Response.json({profiles:[]});
  if(url==='/api/files')return Response.json({key});if(url===`/api/products/${api.id}`){productReads++;return productReads===2?hold.promise:Response.json({product});}if(url===`/api/products/${api.id}/content`)return Response.json({content});
  if(url===`/api/products/${api.id}/attachments`){product={...product,image_keys:JSON.stringify([...JSON.parse(product.image_keys),key]),updated_at:new Date(Date.parse(product.updated_at)+1000).toISOString()};return Response.json({saved:true});}
  return Response.json({error:'unexpected fixture endpoint'},{status:503});
 });
 try{
  content=h.load('app/product-content.ts').emptyProductContent(api.id);const Dashboard=h.load('app/components/dashboard-client.tsx').default,props={userName:'fixture',workspaceOwnerId:'owner'};await h.render(Dashboard,props);await h.React.act(async()=>h.records.get('registration-board').onOpen(product,'대표 이미지'));await h.settle();
  const input=h.container.querySelector('input[type=file]');Object.defineProperty(input,'files',{configurable:true,value:[new File(['fixture'],'upload.png',{type:'image/png'})]});await h.React.act(async()=>input.dispatchEvent(new h.window.Event('change',{bubbles:true})));await h.settle();assert.equal(productReads,2);
  if(scenario==='owner'){
   await h.render(Dashboard,{...props,workspaceOwnerId:'other-owner'});await h.render(Dashboard,props);await h.React.act(async()=>hold.resolve(Response.json({product:{...product,title:'오래된 업로드 응답'}})));await h.settle();assert.doesNotMatch(h.container.textContent,/오래된 업로드 응답|이미지를 추가했습니다/);assert.notEqual(h.records.get('registration-board').products[0].title,'오래된 업로드 응답');
  }else{
   await h.React.act(async()=>hold.resolve(Response.json({error:'readback unavailable'},{status:503})));await h.settle();assert.match(h.container.textContent,/저장은 완료됐지만/);assert.doesNotMatch(h.container.textContent,/업로드 파일 연결 대기|이미지를 추가했습니다/);
  }
  assert.equal(requests.filter(row=>row.url.endsWith('/attachments')).length,1);assert.equal(requests.filter(row=>row.url==='/api/files').length,1);
 }finally{await h.close();api.close();}
});

test('actual option readers reuse a loaded source, read a stale activation once and retain dirty drafts',async()=>{
 const requests=[];let value;
 const h=await stageRefreshDOM(async url=>{requests.push(String(url));return Response.json(value);});
 try{
  for(const [file,name,label]of [['option-seo-editor','OptionSeoEditor','선택 옵션 상품명'],['option-image-editor','OptionImageEditor','선택 옵션 상세 HTML'],['option-label-editor','OptionLabelEditor',null]]){
   value=quoteView(h);const Editor=h.load('app/components/'+file+'.tsx')[name],props={productId:'p',optionId:'red',version,refreshToken:'0',active:true,stage:'detail'};
   const before=requests.length;await h.render(Editor,props);assert.equal(requests.length,before+1,name+' initial');
   assert.equal(h.container.querySelector('[data-workspace-dirty]')?.getAttribute('data-workspace-dirty'),'false');
   await h.render(Editor,{...props,active:false});await h.render(Editor,props);assert.equal(requests.length,before+1,name+' unchanged revisit');
   value=quoteView(h,newVersion);await h.render(Editor,{...props,active:false,version:newVersion,refreshToken:'1'});assert.equal(requests.length,before+1,name+' hidden source');
   const fresh={...props,version:newVersion,refreshToken:'1'};await h.render(Editor,fresh);assert.equal(requests.length,before+2,name+' stale activation');
   await h.render(Editor,{...fresh,disabled:true});await h.render(Editor,fresh);assert.equal(requests.length,before+2,name+' unlock cached');
   if(label){await change(h,label,'보존할 입력');assert.equal(h.container.querySelector('[data-workspace-dirty]').getAttribute('data-workspace-dirty'),'true');await h.render(Editor,{...fresh,active:false,refreshToken:'2'});await h.render(Editor,{...fresh,refreshToken:'2'});assert.equal(requests.length,before+2,name+' dirty source retained');assert.equal(h.container.querySelector(`[aria-label="${label}"]`).value,'보존할 입력');}
  }
 }finally{await h.close();}
});

test('actual retained option board defers changed-source reads while covered and refreshes once on return',async()=>{
 const requests=[];let clock=version,content,options;
 const h=await stageRefreshDOM(async url=>{requests.push(String(url));return Response.json(String(url).endsWith('/options')?{productVersion:clock,options,pricing:{rows:[{optionId:'red',calculation:null}]}}:String(url).endsWith('/content')?{content}:quoteView(h,clock));});
 try{
  content=h.load('app/product-content.ts').emptyProductContent('p');const model=h.load('app/product-options.ts');options=model.applyOptionRows(model.emptyProductOptions('p'),[{...model.emptyOptionInput('red'),originalName:'빨강',translatedName:'빨강',included:true,unitCostCny:3}],clock);
  const Board=h.load('app/components/product-option-board.tsx').ProductOptionBoard,props={productId:'p',sourceUrl:'https://example.test/',imageKeys:'[]',refreshToken:clock,active:true,onQuotation(){},onEdit(){}};
  await h.render(Board,props);assert.equal(requests.length,3);assert.doesNotMatch(h.container.textContent,/새로고침해주세요/);
  await h.render(Board,{...props,active:false});clock=newVersion;await h.render(Board,{...props,active:false,refreshToken:clock});assert.equal(requests.length,3);
  await h.render(Board,{...props,refreshToken:clock});assert.equal(requests.length,6);await h.render(Board,{...props,active:false,refreshToken:clock});await h.render(Board,{...props,refreshToken:clock});assert.equal(requests.length,6);
 }finally{await h.close();}
});

test('actual DetailPanel holds the parent clock after a normal SEO save while visited hidden readers remain silent',async()=>{
 const api=seoWorkspaceHarness(),requests=[],parent=deferred();let product={...api.product},saved=0;
 const components={'seo-workspace-editor':true,'option-image-editor':true,'option-seo-editor':true,'option-label-editor':true,'product-label-editor':true};
 const h=await stageRefreshDOM(async(url,init={})=>{requests.push({url:String(url),method:init.method??'GET'});if(String(url).endsWith('/seo-workspace'))return api.request(init.method??'GET',init.body?JSON.parse(init.body):undefined);if(String(url).includes('quotation-fields'))return Response.json(quoteView(h,product.updated_at));return Response.json({error:'non-provider fixture'},{status:503});},{components});
 components['quotation-panel']={QuotationPanel:props=>h.React.createElement(h.load('app/components/quotation-fields-editor.tsx').QuotationFieldsEditor,props)};
 try{
  const Detail=h.load('app/components/dashboard-client.tsx').DetailPanel;
  const props={product,focusedOptionId:api.options.rows[0].id,settings:h.load('app/workspace-settings.ts').defaultSettings,onSaved(){saved++;void parent.promise.then(value=>{product=value;});},onUpload(){},onSavePrice:async()=>{},onManageCategories(){},onProfileSelected(){},onBeforeFreeImageApply:()=>true,onBeforeSeoGenerate:()=>true,onPrepareSubmission(){},onReviewPackaging(){}};
  for(const tab of ['SEO','가격','대표 이미지','추가 이미지','상세 이미지','사이즈표','표시사항','견적서','SEO'])await h.render(Detail,{...props,tab});
  const before=requests.length;await change(h,'SEO 상품명','검토한 성능 제목');await click(h,'SEO 설정 저장');assert.equal(saved,1);
  const afterCounter=requests.slice(before);assert.equal(afterCounter.filter(row=>row.url.includes('quotation-fields')).length,1,'only the active option SEO reader runs at the immediate counter');
  const clockBefore=requests.length;await h.React.act(async()=>parent.resolve(api.stored().product));await h.render(Detail,{...props,product,tab:'SEO'});
  assert.equal(requests.slice(clockBefore).filter(row=>row.url.includes('quotation-fields')).length,1,'only the active option SEO reader runs at the parent clock');
  assert.equal(requests.some(row=>['/api/products','/api/settings','/api/collection-jobs','/api/category-profiles'].includes(row.url)),false);
 }finally{await h.close();api.close();}
});

test('actual clean SEO reentry uses the saved source while dirty and unknown-save drafts survive hiding',async()=>{
 const api=seoWorkspaceHarness(),requests=[];let failWrite=false;
 const h=await stageRefreshDOM(async(url,init={})=>{requests.push(init.method??'GET');if(failWrite&&init.method==='PATCH')throw Error('lost acknowledgement');return api.request(init.method??'GET',init.body?JSON.parse(init.body):undefined);});
 try{
  const Editor=h.load('app/components/seo-workspace-editor.tsx').SeoWorkspaceEditor,props={productId:api.id,version:api.version,active:true};
  await h.render(Editor,props);assert.equal(requests.length,1);await h.render(Editor,{...props,active:false});await h.render(Editor,props);assert.equal(requests.length,1);
  await change(h,'SEO 상품명','유지할 입력');await h.render(Editor,{...props,active:false});await h.render(Editor,props);assert.equal(requests.length,1);assert.equal(h.container.querySelector('[aria-label="SEO 상품명"]').value,'유지할 입력');
  failWrite=true;await click(h,'SEO 설정 저장');assert.equal(requests.filter(method=>method==='PATCH').length,1);const before=requests.length;
  await h.render(Editor,{...props,active:false,version:newVersion});await h.render(Editor,{...props,version:newVersion});assert.equal(requests.length,before,'uncertain save requires explicit recovery');assert.equal(h.container.querySelector('[aria-label="SEO 상품명"]').value,'유지할 입력');
 }finally{await h.close();api.close();}
});

test('actual hidden SEO save retains its uncertain attempt for explicit read recovery and failed reads are not cached',async()=>{
 const api=seoWorkspaceHarness(),hold=deferred(),requests=[];let signal,saved=0,failRead=true;
 const h=await stageRefreshDOM(async(url,init={})=>{
  requests.push(init.method??'GET');
  if(!init.method&&failRead)return Response.json({error:'fixture read failure'},{status:503});
  const result=await api.request(init.method??'GET',init.body?JSON.parse(init.body):undefined);
  if(init.method==='PATCH'){signal=init.signal;await hold.promise;}
  return result;
 });
 try{
  const Editor=h.load('app/components/seo-workspace-editor.tsx').SeoWorkspaceEditor,props={productId:api.id,version:api.version,active:true,onSaved(){saved++;}};
  await h.render(Editor,props);assert.match(h.container.textContent,/SEO 저장본 조회 실패/);
  failRead=false;await h.render(Editor,{...props,active:false});await h.render(Editor,props);assert.equal(requests.length,2,'failed read is not cached');
  await change(h,'SEO 상품명','진행 중인 저장');await click(h,'SEO 설정 저장');assert.ok(signal&&!signal.aborted);
  await h.render(Editor,{...props,active:false});assert.equal(signal.aborted,true,'original SEO hide policy retires its network receipt');assert.equal(h.container.querySelector('[data-workspace-saving]').getAttribute('data-workspace-saving'),'false');
  await h.React.act(async()=>hold.resolve());await h.settle();assert.equal(saved,0);assert.equal(requests.filter(method=>method==='PATCH').length,1);assert.equal(h.container.querySelector('[data-workspace-dirty]').getAttribute('data-workspace-dirty'),'true');
  const before=requests.length;await h.render(Editor,props);assert.equal(requests.length,before,'unknown save waits for explicit recovery');await click(h,'SEO 저장 결과 확인');assert.equal(saved,1);assert.equal(requests.filter(method=>method==='PATCH').length,1);
 }finally{await h.close();api.close();}
});

for(const lostAck of [false,true])test(`actual admitted option SEO PUT survives a stage exit (${lostAck?'lost ACK':'normal ACK'}) without a replay`,async()=>{
 const hold=deferred(),requests=[];let value,signal,saved=0;
 const h=await stageRefreshDOM(async(url,init={})=>{
  requests.push(init.method??'GET');
  if(init.method==='PUT'){
   signal=init.signal;const changes=JSON.parse(init.body).changes,model=h.load('app/quotation-schema.ts');
   value=structuredClone(value);value.overrides=model.applyQuotationChanges(value.overrides,changes);value.revision++;value.productVersion=newVersion;value.updatedAt=newVersion;
   for(const change of changes){const cell=value.resolved.rows.find(row=>row.optionId===change.optionId).fields[change.fieldKey];cell.value=change.value;cell.source='manual-option';}
   await hold.promise;if(lostAck)throw Error('lost ACK');
  }
  return Response.json(value);
 });
 try{
  value=quoteView(h);const Editor=h.load('app/components/option-seo-editor.tsx').OptionSeoEditor,props={productId:'p',optionId:'red',version,active:true,onSaved(){saved++;}};
  await h.render(Editor,props);await change(h,'선택 옵션 상품명','저장 중인 옵션 제목');await click(h,'선택 옵션 SEO 저장');assert.ok(signal&&!signal.aborted);
  await h.render(Editor,{...props,active:false});assert.equal(signal.aborted,false);assert.equal(h.container.querySelector('[data-workspace-saving]').getAttribute('data-workspace-saving'),'true');
  await h.React.act(async()=>hold.resolve());await h.settle();
  assert.equal(saved,lostAck?0:1);assert.equal(requests.filter(method=>method==='PUT').length,1);
  const before=requests.length;await h.render(Editor,props);assert.equal(requests.length,before,'reentry does not replay or overwrite an unknown save');
  if(lostAck){assert.equal(h.container.querySelector('[data-workspace-dirty]').getAttribute('data-workspace-dirty'),'true');await click(h,'SEO 저장 결과 확인');assert.equal(saved,1);assert.equal(requests.filter(method=>method==='PUT').length,1);}
 }finally{await h.close();}
});

test('actual unmounted editor cannot publish a late committed SEO response or replay the save',async()=>{
 const api=seoWorkspaceHarness(),hold=deferred(),requests=[];let saved=0,signal,closed=false;
 const h=await stageRefreshDOM(async(url,init={})=>{requests.push(init.method??'GET');const response=await api.request(init.method??'GET',init.body?JSON.parse(init.body):undefined);if(init.method==='PATCH'){signal=init.signal;await hold.promise;}return response;});
 try{
  const Editor=h.load('app/components/seo-workspace-editor.tsx').SeoWorkspaceEditor;
  await h.render(Editor,{productId:api.id,version:api.version,onSaved(){saved++;}});await change(h,'SEO 상품명','서버에서 저장한 제목');await click(h,'SEO 설정 저장');
  assert.ok(signal&&!signal.aborted);await h.close();closed=true;assert.equal(signal.aborted,true);
  await h.React.act(async()=>hold.resolve());assert.equal(saved,0);assert.equal(requests.filter(method=>method==='PATCH').length,1);assert.equal(api.stored().product.title,api.product.title,'SEO display title uses the linked content source');
 }finally{if(!closed)await h.close();api.close();}
});

test('actual Dashboard stage-save callback reads only the current product and rejects older, navigation and owner results',async()=>{
 const api=seoWorkspaceHarness(),requests=[],pending=[];let product={...api.product};
 const h=await stageRefreshDOM(async(url,init={})=>{
  url=String(url);requests.push({url,method:init.method??'GET'});
  if(url==='/api/products')return Response.json({products:[product]});
  if(url==='/api/settings')return Response.json({settings:null,scope:{ownerId:'owner',company:null}});
  if(url==='/api/collection-jobs')return Response.json({jobs:[]});
  if(url==='/api/category-profiles')return Response.json({profiles:[]});
  if(url.endsWith('/seo-workspace'))return api.request(init.method??'GET',init.body?JSON.parse(init.body):undefined);
  if(/^\/api\/products\/[^/]+$/.test(url)){const response=deferred();pending.push(response);return response.promise;}
  return Response.json({error:'unexpected fixture endpoint'},{status:503});
 },{components:{'seo-workspace-editor':true}});
 try{
  const Dashboard=h.load('app/components/dashboard-client.tsx').default,props={userName:'fixture',workspaceOwnerId:'owner'};
  await h.render(Dashboard,props);const board=()=>h.records.get('registration-board');assert.equal(board().products.length,1);
  await h.React.act(async()=>board().onOpen(product,'SEO'));await h.settle();
  const before=requests.length;await change(h,'SEO 상품명','대시보드 검토 제목');await click(h,'SEO 설정 저장');
  const interval=requests.slice(before);assert.deepEqual(interval.map(row=>row.url),[`/api/products/${api.id}/seo-workspace`,`/api/products/${api.id}`]);assert.equal(pending.length,1);
  const fresh=api.stored().product;await h.React.act(async()=>pending.shift().resolve(Response.json({product:fresh})));await h.settle();
  assert.equal(board().products[0].updated_at,fresh.updated_at);assert.equal(h.container.querySelector('[aria-label="SEO 상품명"]').value,'대시보드 검토 제목');
  const callback=h.records.get('product-source-context')?.onSaved;
  // The real DetailPanel sourceSaved is also passed to the retained source editor.
  const save=h.records.get('product-content-editor')?.onSaved??h.records.get('translation-panel')?.onContentSaved??callback;assert.equal(typeof save,'function');
  await h.React.act(async()=>{save();save();});assert.equal(pending.length,2);
  const [older,later]=pending.splice(0),newest={...fresh,title:'최신 응답',updated_at:new Date(Date.parse(fresh.updated_at)+1000).toISOString()};
  await h.React.act(async()=>later.resolve(Response.json({product:newest})));await h.settle();
  await h.React.act(async()=>older.resolve(Response.json({product:{...fresh,title:'늦은 이전 응답'}})));await h.settle();assert.equal(board().products[0].title,'최신 응답');
  await h.React.act(async()=>save());await h.React.act(async()=>pending.shift().resolve(Response.json({product:fresh})));await h.settle();assert.equal(board().products[0].title,'최신 응답','an older clock cannot replace the current row');
  await h.React.act(async()=>{save();save();});const navigationResponse=pending.shift(),staleFailure=pending.shift();
  const other={...newest,id:'other',title:'다른 상품'};await h.React.act(async()=>board().onOpen(other,'SEO'));await h.settle();
  await h.React.act(async()=>navigationResponse.resolve(Response.json({product:{...newest,title:'목록 전용',updated_at:new Date(Date.parse(newest.updated_at)+1000).toISOString()}})));await h.settle();assert.match(h.container.textContent,/다른 상품/);
  await h.React.act(async()=>staleFailure.resolve(Response.json({error:'stale failure'},{status:503})));await h.settle();assert.doesNotMatch(h.container.textContent,/저장은 완료됐지만/);
  const staleOwnerSave=h.records.get('product-content-editor')?.onSaved??h.records.get('translation-panel')?.onContentSaved;
  await h.React.act(async()=>staleOwnerSave());const ownerResponse=pending.shift();assert.ok(ownerResponse);
  await h.render(Dashboard,{...props,workspaceOwnerId:'other-owner'});await h.render(Dashboard,props);
  await h.React.act(async()=>ownerResponse.resolve(Response.json({product:{...other,title:'오래된 계정 응답',updated_at:new Date(Date.parse(other.updated_at)+1000).toISOString()}})));await h.settle();assert.doesNotMatch(h.container.textContent,/오래된 계정 응답/);
  const requestCount=requests.length;await h.React.act(async()=>staleOwnerSave());assert.equal(requests.length,requestCount,'old owner callback cannot request');
 }finally{await h.close();api.close();}
});
