import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {categoryPickerUI} from './helpers/category-picker.mjs';
import {hubSchemaSnapshot as syntheticHubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';

// These live-choice fixtures represent the SCHEMA command's Single form.
// Generic older schema fixtures deliberately omit scope for unrelated tests.
const hubSchemaSnapshot=(...args)=>{const snapshot=syntheticHubSchemaSnapshot(...args);return{...snapshot,metadata:{...snapshot.metadata,scopeType:'Retail_Categorized_Single'}};};

const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const plain=value=>JSON.parse(JSON.stringify(value));
async function template(h,company,owner='owner'){
 const bytes=new TextEncoder().encode('상품명,회사별 검토값 '+company.code+'\n');
 const sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),storageKey=`${owner}/category-templates/${sha256}.csv`;
 await h.bindings.FILES.put(storageKey,bytes,{customMetadata:{sha256,format:'csv'}});
 const {template,mappings}=h.load('app/category-profiles.ts').validateCategoryProfile({name:'회사 연결 시험',categoryId:'991234',categoryPath:schemaPath,
  template:{name:'synthetic-'+company.code+'.csv',format:'csv',sheetName:'',headerRow:1,headers:['상품명','회사별 검토값 '+company.code],sha256,storageKey},
  mappings:[{column:0,field:'title',required:false},{column:1,field:'constant',constant:company.name+' 수동 검토값',required:false}]});
 return JSON.parse(JSON.stringify({template,mappings}));
}

for(const company of schemaCompanies)test(`live category intake never repurposes another company's saved profile (${company.code})`,async()=>{
  const other=schemaCompanies.find(item=>item.code!==company.code),h=mobileIntakeHarness({companyCode:other.code,companyName:other.name});
 try{
  const oldSchema=hubSchemaSnapshot(other),currentSchema={...hubSchemaSnapshot(company),draftInitialization:'couplus-required-v1',inputBindings:'couplus-paths-v1',settingsInitialization:'couplus-options-v1'};
  const previous=await template(h,other);
  // A prior approved-company profile can remain in the same owner's workspace
  // after a membership reassignment. Templates here are synthetic CSV fixtures.
  const old=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'기존 회사 검토 설정',categoryId:oldSchema.categoryId,categoryPath:schemaPath,hubSchema:oldSchema,...previous});
  h.context.category=old;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
  await h.intake();
  const oldProduct=h.sqlite.prepare('SELECT * FROM products').get();
  h.setCompany(company);
  const oldContent=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(oldProduct.id).payload);
  await json(await h.route(`/api/products/${oldProduct.id}/content`,{method:'PATCH',body:{expectedRevision:oldContent.revision,patch:{seo:{keywords:[]},label:{material:''}}}}));
  const existingWork=()=>JSON.stringify({product:h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(oldProduct.id),content:h.sqlite.prepare('SELECT * FROM product_content WHERE product_id=?').get(oldProduct.id),options:h.sqlite.prepare('SELECT * FROM product_options WHERE product_id=?').get(oldProduct.id),context:h.sqlite.prepare('SELECT * FROM collection_context WHERE job_id=?').get('job')});
  const originalWork=existingWork();
  const before=h.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(old.id);
  const api=h.load('app/api/category-profiles/route.ts'),currentConnection=await template(h,company);let downloads=0;
  const picker=categoryPickerUI((path,init)=>api[init?.method??'GET'](new Request('https://app.test'+path,init)),{connectExcel:true,catalog:{
   loadLiveHubCategorySchema:async()=>currentSchema,
   loadLiveHubCategoryTemplate:async()=>{downloads++;return currentConnection;},
  }});
  const choice={key:'current-live',categoryId:currentSchema.categoryId,path:schemaPath,isLeaf:true,supplierHub:{trail:[],ownerId:'owner',company}};
  await picker.chooseLive(choice);
  assert.equal(picker.selected.length,1,JSON.stringify(picker.alerts()));
  const selected=picker.selected[0];
  assert.notEqual(selected.id,old.id,'a live choice cannot relabel the previous company profile and retain its workbook');
  assert.equal(downloads,1);assert.deepEqual(selected.hubSchema.company,company);
  assert.deepEqual(selected.template,currentConnection.template);assert.deepEqual(selected.mappings,currentConnection.mappings);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(old.id),before);
  assert.ok(picker.calls.every(call=>call.method!=='PUT'));
  // Reopening the completed picker with both company profiles present reuses only the
  // current company's profile instead of becoming an ambiguous saved match.
  picker.reopen();await picker.chooseLive(choice);assert.equal(picker.selected.length,2);
  assert.equal(picker.selected[1].id,selected.id);assert.equal(downloads,1);
  const nextUrl='https://detail.1688.com/offer/813724060929.html';
  const queued=await json(await h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({urls:[nextUrl],goal:'price',profileId:selected.id,expectedProfileRevision:selected.revision})})));
  const next=queued.jobs[0];assert.equal(next.context.category.id,selected.id);assert.deepEqual(next.context.category.hubSchema.company,company);assert.deepEqual(next.context.category.template,currentConnection.template);
  // Synthetic second identity of the recorded source, never a live second URL.
  const receipts=h.load('db/collection-results.ts'),receipt=await receipts.readCollectionResult('owner','job');
  await receipts.storeCollectionResult('owner',next.id,{...receipt.result,offerId:'813724060929',sourceUrl:nextUrl});
  const created=await json(await h.load('app/api/collection-jobs/[id]/product/route.ts').POST(new Request(`https://app.test/api/collection-jobs/${next.id}/product`,{method:'POST'}),{params:Promise.resolve({id:next.id})}));
  const draft=await h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(created.productId,(path,init)=>h.route(path,{method:init?.method??'GET',body:init?.body}),new AbortController().signal);
  assert.equal(draft.completed,true,draft.message);
  const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(created.productId).payload);
  const view=await json(await h.route(`/api/products/${created.productId}/quotation-fields`));
  assert.equal(view.categoryContext.profileId,selected.id);const savedOptions=(await json(await h.route(`/api/products/${created.productId}/options`))).options;
  const koreanNames={
   '5627721589405':'유광 검정 / 선글라스','5627721589406':'유광 검정 / 선글라스 + 005 케이스',
   '5627721589409':'무광 검정 / 선글라스','5627721589410':'무광 검정 / 선글라스 + 005 케이스',
   '5627721589407':'무광 회색 / 선글라스','5627721589408':'무광 회색 / 선글라스 + 005 케이스',
  };
  assert.equal(savedOptions.rows.length,6);
  for(const option of savedOptions.rows){assert.equal(option.translatedName,koreanNames[option.supplierSku]);assert.equal(option.provenance.translatedName,'translated');}
  // Canonical intake now saves the existing SEO document. Its exact title is
  // read directly; Korean option-name composition is the absent-document fallback.
  assert.equal(content.seo.title.value,'우드 패턴 다리 선글라스');assert.equal(content.seo.title.provenance,'generated');
  assert.deepEqual(content.seoTitleDocument,{policy:'couplus-seo-save-v1',sourceTitle:'우드 패턴 다리 선글라스',sourceUpdatedAt:content.seo.title.updatedAt,value:'우드 패턴 다리 선글라스'});
  for(const row of view.resolved.rows){assert.equal(row.fields.title.value,'우드 패턴 다리 선글라스');assert.equal(row.fields.title.source,'content');}
  const source=await h.load('app/exports/quotation-source.ts').readMappedQuotationSource('owner',created.productId,null);
  assert.equal(source.profile.id,selected.id);assert.deepEqual(plain(source.profile.template),currentConnection.template);assert.deepEqual(plain(source.profile.mappings),currentConnection.mappings);
  assert.deepEqual(plain(source.hubSchema),selected.hubSchema);assert.deepEqual(plain(source.company),company);
  assert.deepEqual(view.categoryContext,{source:'collection',profileId:selected.id,categoryId:currentSchema.categoryId,categoryPath:schemaPath});
  const legacyContent=plain(content);delete legacyContent.seoTitleDocument;
  const fallback=h.load('app/exports/quotation-source.ts').resolveQuotationExport({...source,content:legacyContent});
  for(const row of fallback.rows){
   const option=savedOptions.rows.find(option=>option.id===row.optionId);
   assert.equal(row.fields.title.value,option?'우드 패턴 다리 선글라스, '+koreanNames[option.supplierSku]:'우드 패턴 다리 선글라스');
   assert.equal(row.fields.title.source,'content');
  }
  const base=`/api/products/${created.productId}`,manual=(await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'직접 검토한 공통 상품명'}}}}))).content;
  assert.equal(manual.seo.title.provenance,'manual');assert.equal(manual.seo.title.value,'직접 검토한 공통 상품명');
  const manualView=await json(await h.route(base+'/quotation-fields'));
  for(const row of manualView.resolved.rows){
   const option=savedOptions.rows.find(option=>option.id===row.optionId);
   assert.equal(row.fields.title.value,option?'직접 검토한 공통 상품명, '+koreanNames[option.supplierSku]:'직접 검토한 공통 상품명');
   assert.equal(row.fields.title.source,'content');
  }
  const named=savedOptions.rows[0].id,blank=savedOptions.rows[1].id;
  const overridden=await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:manualView.revision,expectedInputFingerprint:manualView.inputFingerprint,changes:[
   {fieldKey:'title',optionId:null,value:'직접 견적 공통 제목'},{fieldKey:'title',optionId:named,value:'직접 견적 옵션 제목'},{fieldKey:'title',optionId:blank,value:''},
  ]}}));
  const checkOverrides=value=>{for(const row of value.resolved.rows){
   assert.equal(row.fields.title.value,row.optionId===named?'직접 견적 옵션 제목':row.optionId===blank?'':'직접 견적 공통 제목');
   assert.equal(row.fields.title.source,row.optionId===named||row.optionId===blank?'manual-option':'manual-common');
  }};
  checkOverrides(overridden);assert.deepEqual(overridden.automatic.rows,manualView.automatic.rows);
  // A deliberately cleared common title is not repopulated from the product or
  // option name; separately saved quotation values, including blanks, still win.
  const cleared=(await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:manual.revision,patch:{seo:{title:''}}}}))).content;
  assert.equal(cleared.seo.title.value,'');assert.equal(cleared.seo.title.provenance,'manual');
  const clearedView=await json(await h.route(base+'/quotation-fields'));checkOverrides(clearedView);
  for(const row of clearedView.automatic.rows){assert.equal(row.fields.title.value,'');assert.equal(row.fields.title.source,'content');}
  assert.deepEqual(clearedView.categoryContext,view.categoryContext);
  assert.deepEqual(JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get(next.id).payload).category,next.context.category);
  assert.equal(existingWork(),originalWork);assert.deepEqual(h.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(old.id),before);
 }finally{h.close();}
});

test('a legacy profile without a recorded company retains its manually connected workbook during live selection',async()=>{
 const company=schemaCompanies[0],h=mobileIntakeHarness();
 try{
  const connection=await template(h,company),snapshot=hubSchemaSnapshot(company);
  const old=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'회사 미기록 수동 설정',categoryId:snapshot.categoryId,categoryPath:schemaPath,...connection});
  const api=h.load('app/api/category-profiles/route.ts');
  const picker=categoryPickerUI((path,init)=>api[init?.method??'GET'](new Request('https://app.test'+path,init)),{catalog:{
   loadLiveHubCategorySchema:async()=>snapshot,loadLiveHubCategoryTemplate:async()=>{throw Error('Legacy manual workbook must remain connected');},
  }});
  await picker.chooseLive({key:'live',categoryId:snapshot.categoryId,path:schemaPath,isLeaf:true,supplierHub:{trail:[],ownerId:'owner',company}});
  assert.equal(picker.selected.length,1,JSON.stringify(picker.alerts()));
  assert.equal(picker.selected[0].id,old.id);assert.equal(picker.selected[0].revision,old.revision+1);
  assert.deepEqual(picker.selected[0].template,connection.template);assert.deepEqual(picker.selected[0].mappings,connection.mappings);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM category_profiles').get().n,1);
 }finally{h.close();}
});

for(const company of schemaCompanies)test(`malformed cached category identities cannot create replacement profiles or new URL jobs (${company.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const snapshot={...hubSchemaSnapshot(company),draftInitialization:'couplus-required-v1',inputBindings:'couplus-paths-v1',settingsInitialization:'couplus-options-v1'},connection=await template(h,company);
  const original=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'원래 검토 설정',categoryId:snapshot.categoryId,categoryPath:schemaPath,hubSchema:snapshot,...connection});
  const api=h.load('app/api/category-profiles/route.ts'),choice={key:'selected-live',categoryId:snapshot.categoryId,path:schemaPath,isLeaf:true,supplierHub:{trail:[],ownerId:'owner',company}};
  const stored=()=>JSON.stringify({profiles:h.sqlite.prepare('SELECT * FROM category_profiles').all(),jobs:h.sqlite.prepare('SELECT * FROM collection_jobs').all(),context:h.sqlite.prepare('SELECT * FROM collection_context').all(),objects:[...h.objects].map(([key,bytes])=>[key,Array.from(bytes)])});
  const before=stored();
  for(const corrupt of [value=>{value.hubSchema.categoryPath=['다른 시험 분류'];},value=>{value.hubSchema.metadata.displayCategoryCode='991235';},value=>{value.hubSchema.company={code:company.code,name:'잘못된 회사명'};},value=>{value.categoryPath=null;}]){
   const picker=categoryPickerUI(async(path,init)=>{
    const response=await api[init?.method??'GET'](new Request('https://app.test'+path,init));
    if(init?.method)return response;const result=await response.json();result.profiles=result.profiles.map(profile=>profile.id===original.id?structuredClone(original):profile);corrupt(result.profiles[0]);return Response.json(result);
   },{catalog:{loadLiveHubCategorySchema:async()=>snapshot}});
   await picker.chooseLive(choice);assert.equal(picker.selected.length,0,JSON.stringify(picker.alerts()));assert.ok(picker.calls.every(call=>call.method==='GET'));
   assert.equal(stored(),before,'malformed list data cannot overwrite or replace the owned profile, company context or original template bytes');picker.close();
  }
  const picker=categoryPickerUI((path,init)=>api[init?.method??'GET'](new Request('https://app.test'+path,init)),{catalog:{loadLiveHubCategorySchema:async()=>snapshot}});
  await picker.chooseLive(choice);assert.equal(picker.selected.length,1,JSON.stringify(picker.alerts()));assert.equal(picker.selected[0].id,original.id);assert.equal(stored(),before);
 }finally{h.close();}
});

for(const company of schemaCompanies)test(`manual saved category without Hub evidence retains its template and captured company when entering URL draft (${company.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const connection=await template(h,company),categoryPath=['주방용품','주방수납/정리','주방수납바구니/바스켓'];
  const original=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'직접 연결한 수동 설정',categoryId:'80719',categoryPath,...connection});
  const before=JSON.stringify(h.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(original.id)),objects=JSON.stringify([...h.objects].map(([key,bytes])=>[key,Array.from(bytes)])),api=h.load('app/api/category-profiles/route.ts'),settingsApi=h.load('app/api/settings/route.ts');
  const picker=categoryPickerUI((path,init)=>path==='/api/settings'?settingsApi.GET():api[init?.method??'GET'](new Request('https://app.test'+path,init)),{workspaceOwnerId:'owner',catalog:{loadLiveHubCategorySchema:async()=>assert.fail('a manually saved choice does not invent live Hub evidence')}});
  await picker.chooseCode('80719');assert.equal(picker.selected.length,1,JSON.stringify(picker.alerts()));const selected=picker.selected[0];assert.equal(selected.id,original.id);assert.equal(selected.hubSchema,undefined);assert.deepEqual(selected.template,connection.template);assert.deepEqual(selected.mappings,connection.mappings);assert.ok(picker.calls.every(call=>call.method==='GET'));
  const queued=await json(await h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({urls:['https://detail.1688.com/offer/813724060929.html'],goal:'price',profileId:selected.id,expectedProfileRevision:selected.revision})})));
  const context=queued.jobs[0].context;assert.equal(context.category.id,original.id);assert.equal(context.category.categoryId,'80719');assert.deepEqual(context.category.categoryPath,categoryPath);assert.deepEqual(context.company,company);assert.equal(context.category.hubSchema,undefined);assert.deepEqual(context.category.template,connection.template);assert.deepEqual(context.category.mappings,connection.mappings);
  assert.equal(picker.calls.filter(call=>call.path==='/api/settings').length,2,'manual drafts remain usable with a verified current owner and approved company');
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(original.id)),before);assert.equal(JSON.stringify([...h.objects].map(([key,bytes])=>[key,Array.from(bytes)])),objects);picker.close();
 }finally{h.close();}
});

for(const company of schemaCompanies)test(`saved category belonging to the other approved company cannot open a URL draft (${company.code})`,async()=>{
 const other=schemaCompanies.find(item=>item.code!==company.code),h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const old=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'기존 회사 저장 양식',categoryId:'991234',categoryPath:schemaPath,hubSchema:hubSchemaSnapshot(other),...await template(h,other)});
  const profilesApi=h.load('app/api/category-profiles/route.ts'),settingsApi=h.load('app/api/settings/route.ts'),before=JSON.stringify(h.sqlite.prepare('SELECT * FROM category_profiles').all());
  assert.deepEqual((await json(await settingsApi.GET())).scope,{ownerId:'owner',company},'this failure case must have a valid current approved account, not an authentication failure');
  const picker=categoryPickerUI((path,init)=>path==='/api/settings'?settingsApi.GET():profilesApi[init?.method??'GET'](new Request('https://app.test'+path,init)),{profiles:[old],selectedId:old.id,workspaceOwnerId:'owner'});
  await picker.confirm();assert.equal(picker.selected.length,0,'a valid stored schema from the old company cannot be selected under the current approved company');
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM category_profiles').all()),before);assert.ok(picker.calls.every(call=>call.method==='GET'));picker.close();
 }finally{h.close();}
});

function scopedRoutes(h,state){
 const auth={getWorkspaceOwnerId:async()=>state.owner,getChatGPTUser:async()=>{const email=state.company.code==='A01526306'?'jwhj1116@kakao.com':'unari8484@gmail.com';return{userId:state.owner,email,verifiedAccess:true,membership:{id:state.owner,email,status:'approved',role:state.company.code==='A01526306'?'admin':'member',companyCode:state.company.code,companyName:state.company.name}};}};
 function route(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,URLSearchParams,Response,Request,Date,TextEncoder,TextDecoder,Uint8Array,crypto,process:{env:{NODE_ENV:'production'}},require(name){if(name==='@/app/chatgpt-auth')return auth;if(name==='next/server')return{NextResponse:Response};if(name==='cloudflare:workers')return{env:h.bindings};assert.ok(name.startsWith('@/'),name);return h.load(name.slice(2)+'.ts');}});return exports;}
 return{profiles:route('app/api/category-profiles/route.ts'),settings:route('app/api/settings/route.ts'),fork:route('app/api/category-profiles/[id]/refresh-definition/route.ts')};
}
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const waitFor=async predicate=>{const deadline=Date.now()+5000;while(!predicate()){if(Date.now()>deadline)throw Error('Scoped category request timeout');await new Promise(resolve=>setTimeout(resolve,1));}};

for(const company of schemaCompanies)test(`an owner prop change aborts the previous category request and excludes its retained callbacks (${company.code})`,async()=>{
 const other=schemaCompanies.find(value=>value.code!==company.code),h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const store=h.load('db/category-profiles.ts'),first=await store.createCategoryProfile('first-owner',{name:'첫 회사 설정',categoryId:'991234',categoryPath:schemaPath,hubSchema:hubSchemaSnapshot(company),...await template(h,company,'first-owner')}),second=await store.createCategoryProfile('second-owner',{name:'두 번째 회사 설정',categoryId:'991234',categoryPath:schemaPath,hubSchema:hubSchemaSnapshot(other),...await template(h,other,'second-owner')});
  const state={owner:'first-owner',company},api=scopedRoutes(h,state),before=JSON.stringify(h.sqlite.prepare('SELECT * FROM category_profiles ORDER BY id').all());let held,oldSignal,pause=true;
  const choice=(owner,company)=>({key:'live-'+owner,categoryId:'991234',path:schemaPath,isLeaf:true,supplierHub:{trail:[],ownerId:owner,company}});
  const picker=categoryPickerUI(async(path,init)=>{
   if(path==='/api/settings'){const result=await api.settings.GET();if(pause){pause=false;oldSignal=init.signal;return new Promise(resolve=>{held=()=>resolve(result);});}return result;}
   return api.profiles[init?.method??'GET'](new Request('https://app.test'+path,init));
  },{workspaceOwnerId:'first-owner',profiles:[first],selectedId:first.id,catalog:{loadLiveHubCategorySchema:async value=>value.supplierHub.company.code===company.code?first.hubSchema:second.hubSchema}});
  const oldTree=nodes(picker.render()),oldConfirm=oldTree.find(node=>node.type==='button'&&node.props.children==='선택 완료 · URL 입력').props.onClick,oldChoose=oldTree.find(node=>node.type?.name==='SupplierHubCategoryBrowser').props.onChoice;
  const pending=picker.chooseLive(choice('first-owner',company));await waitFor(()=>Boolean(held));state.owner='second-owner';state.company=other;picker.setProps({workspaceOwnerId:'second-owner',profiles:[second],selectedId:second.id});
  assert.equal(oldSignal.aborted,true);held();await pending;assert.equal(picker.selected.length,0);
  const count=picker.calls.length;oldConfirm();oldChoose(choice('first-owner',company));await new Promise(resolve=>setImmediate(resolve));assert.equal(picker.calls.length,count);
  await picker.chooseLive(choice('second-owner',other));assert.equal(picker.selected.length,1,JSON.stringify(picker.alerts()));assert.equal(picker.selected[0].id,second.id);assert.deepEqual(picker.selected[0].hubSchema.company,other);
  state.owner='first-owner';state.company=company;picker.setProps({workspaceOwnerId:'first-owner',profiles:[first],selectedId:first.id});const backCount=picker.calls.length;oldConfirm();oldChoose(choice('first-owner',company));await new Promise(resolve=>setImmediate(resolve));assert.equal(picker.calls.length,backCount,'returning to the previous owner cannot reactivate its older selection epoch');
  await picker.chooseLive(choice('first-owner',company));assert.equal(picker.selected.length,2);assert.equal(picker.selected[1].id,first.id);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM category_profiles ORDER BY id').all()),before);picker.close();
 }finally{h.close();}
});

for(const company of schemaCompanies)test(`the approved company is rechecked after a delayed saved-profile lookup (${company.code})`,async()=>{
 const other=schemaCompanies.find(value=>value.code!==company.code),h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'저장된 현재 회사 양식',categoryId:'991234',categoryPath:schemaPath,hubSchema:hubSchemaSnapshot(company),...await template(h,company)}),state={owner:'owner',company},api=scopedRoutes(h,state),before=JSON.stringify(h.sqlite.prepare('SELECT * FROM category_profiles').all());let release;
  const picker=categoryPickerUI(async(path,init)=>{if(path==='/api/settings')return api.settings.GET();const result=await api.profiles.GET(new Request('https://app.test'+path,init));return new Promise(resolve=>{release=()=>resolve(result);});},{profiles:[profile],selectedId:profile.id,workspaceOwnerId:'owner'});
  const pending=picker.confirm();await waitFor(()=>Boolean(release));state.company=other;release();await pending;
  assert.equal(picker.selected.length,0);assert.ok(picker.alerts().some(message=>String(message).includes('승인 회사가 변경')));assert.equal(picker.calls.filter(call=>call.path==='/api/settings').length,2);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM category_profiles').all()),before);picker.close();
 }finally{h.close();}
});

for(const company of schemaCompanies)test(`strict effect replay retains current owner selection while rejecting callbacks from the previous mount (${company.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'현재 회사 검토 설정',categoryId:'991234',categoryPath:schemaPath,hubSchema:hubSchemaSnapshot(company),...await template(h,company)}),state={owner:'owner',company},api=scopedRoutes(h,state),before=JSON.stringify(h.sqlite.prepare('SELECT * FROM category_profiles').all());
  const picker=categoryPickerUI((path,init)=>path==='/api/settings'?api.settings.GET():api.profiles[init?.method??'GET'](new Request('https://app.test'+path,init)),{workspaceOwnerId:'owner',profiles:[profile],selectedId:profile.id});
  const oldConfirm=nodes(picker.render()).find(node=>node.type==='button'&&node.props.children==='선택 완료 · URL 입력').props.onClick;
  picker.replayEffects();oldConfirm();await new Promise(resolve=>setImmediate(resolve));assert.equal(picker.calls.length,0,'cleanup invalidates a retained callback even when the owner does not change');
  await picker.confirm();assert.equal(picker.selected.length,1,JSON.stringify(picker.alerts()));assert.equal(picker.selected[0].id,profile.id);assert.deepEqual(picker.selected[0].hubSchema.company,company);
  assert.equal(picker.calls.filter(call=>call.path==='/api/settings').length,2);assert.ok(picker.calls.every(call=>call.method==='GET'));assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM category_profiles').all()),before);picker.close();
 }finally{h.close();}
});

for(const company of schemaCompanies)test(`missing or malformed account scope cannot promote a saved Hub form into a URL draft (${company.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'보존할 현재 회사 양식',categoryId:'991234',categoryPath:schemaPath,hubSchema:hubSchemaSnapshot(company),...await template(h,company)}),state={owner:'owner',company},api=scopedRoutes(h,state),before=JSON.stringify(h.sqlite.prepare('SELECT * FROM category_profiles').all());
  for(const scope of [undefined,{ownerId:'other-owner',company},{ownerId:'owner',company:{code:company.code,name:'잘못된 회사명'}},{ownerId:'owner',company:null}]){
   let corrupt=true;
   const picker=categoryPickerUI(async(path,init)=>{if(path==='/api/settings'){const response=await api.settings.GET();if(!corrupt)return response;return Response.json({...await response.json(),scope});}return api.profiles[init?.method??'GET'](new Request('https://app.test'+path,init));},{workspaceOwnerId:'owner',profiles:[profile],selectedId:profile.id});
   await picker.confirm();assert.equal(picker.selected.length,0,JSON.stringify(scope));assert.ok(picker.calls.every(call=>call.method==='GET'));assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM category_profiles').all()),before);
   corrupt=false;await picker.confirm();assert.equal(picker.selected.length,1,JSON.stringify(picker.alerts()));assert.equal(picker.selected[0].id,profile.id);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM category_profiles').all()),before);picker.close();
  }
 }finally{h.close();}
});

for(const company of schemaCompanies)test(`a changed auth scope after the lookup cannot create a generic profile in another workspace (${company.code})`,async()=>{
 const other=schemaCompanies.find(value=>value.code!==company.code),h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const state={owner:'first-owner',company},api=scopedRoutes(h,state),before=JSON.stringify(h.sqlite.prepare('SELECT * FROM category_profiles').all());let release;
  const picker=categoryPickerUI(async(path,init)=>{if(path==='/api/settings')return api.settings.GET();if(!init?.method){const result=await api.profiles.GET(new Request('https://app.test'+path,init));return new Promise(resolve=>{release=()=>resolve(result);});}assert.equal(init.headers['X-YOOFAM-Workspace-Owner'],'first-owner');return api.profiles[init.method](new Request('https://app.test'+path,init));},{workspaceOwnerId:'first-owner'});
  const pending=picker.chooseCode('80719');await waitFor(()=>Boolean(release));state.owner='second-owner';state.company=other;release();await pending;
  assert.equal(picker.selected.length,0);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM category_profiles').all()),before,'the server must reject a changed owner before a category write as well as before URL intake');assert.deepEqual(picker.calls.filter(call=>call.method!=='GET').map(call=>call.method),['POST']);picker.close();
 }finally{h.close();}
});

for(const company of schemaCompanies)for(const operation of ['PUT','fork'])test(`picker ${operation} carries the selected owner through an auth change at mutation dispatch (${company.code})`,async()=>{
 const other=schemaCompanies.find(value=>value.code!==company.code),h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const snapshot={...hubSchemaSnapshot(company),metadata:{displayCategoryCode:'991234',kanCategoryId:3000,scopeType:'Retail_Categorized_Single',version:190}},raw=JSON.parse(snapshot.schemaString);raw.properties.productPage.properties.basicAttributes.properties.modelNumber.maxLength=12;
  const target=operation==='PUT'?{...snapshot,draftInitialization:'couplus-required-v1',inputBindings:'couplus-paths-v1',settingsInitialization:'couplus-options-v1'}:{...snapshot,schemaString:JSON.stringify(raw),metadata:{...snapshot.metadata,version:191}};
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('first-owner',{name:'원래 회사 수동 검토 설정',categoryId:'991234',categoryPath:schemaPath,hubSchema:snapshot,...await template(h,company,'first-owner')}),state={owner:'first-owner',company},api=scopedRoutes(h,state);
  const stored=()=>JSON.stringify({profiles:h.sqlite.prepare('SELECT * FROM category_profiles ORDER BY id').all(),jobs:h.sqlite.prepare('SELECT * FROM collection_jobs').all(),context:h.sqlite.prepare('SELECT * FROM collection_context').all()}),before=stored();let release,pause=true;
  const picker=categoryPickerUI(async(path,init)=>{
   if(path==='/api/settings')return api.settings.GET();if(!init?.method)return api.profiles.GET(new Request('https://app.test'+path,init));
   assert.equal(init.headers['X-YOOFAM-Workspace-Owner'],'first-owner','both refresh paths must send the scope captured before reading the form');
   if(pause){pause=false;await new Promise(resolve=>{release=resolve;});}
   const request=new Request('https://app.test'+path,init);return operation==='PUT'?api.profiles.PUT(request):api.fork.POST(request,{params:Promise.resolve({id:profile.id})});
  },{workspaceOwnerId:'first-owner',profiles:[profile],catalog:{loadLiveHubCategorySchema:async()=>target}});
  const choice={key:'live-current',categoryId:'991234',path:schemaPath,isLeaf:true,supplierHub:{trail:[],ownerId:'first-owner',company}},pending=picker.chooseLive(choice);await waitFor(()=>Boolean(release));state.owner='second-owner';state.company=other;release();await pending;
  assert.equal(picker.selected.length,0);assert.equal(stored(),before,'owner mismatch must preserve both companies and original queued contexts');
  state.owner='first-owner';state.company=company;await picker.chooseLive(choice);assert.equal(picker.selected.length,1,JSON.stringify(picker.alerts()));assert.deepEqual(picker.selected[0].hubSchema.company,company);assert.equal(picker.selected[0].hubSchema.schemaString,target.schemaString);
  assert.equal(picker.selected[0].id===profile.id,operation==='PUT');if(operation==='fork')assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(profile.id)),JSON.stringify(JSON.parse(before).profiles[0]));
  assert.equal(h.sqlite.prepare("SELECT count(*) n FROM category_profiles WHERE owner_id='second-owner'").get().n,0);picker.close();
 }finally{h.close();}
});
