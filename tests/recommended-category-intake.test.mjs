import test from 'node:test';
import assert from 'node:assert/strict';
import {categoryPickerUI} from './helpers/category-picker.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';

const sourceTitle='合成保暖护耳帽';
const waitFor=async predicate=>{
 const deadline=Date.now()+5000;
 while(!predicate()){
  if(Date.now()>deadline)throw Error('Recommended category intake fixture timed out');
  await new Promise(resolve=>setTimeout(resolve,1));
 }
};
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];

/** Real CategoryPicker, company-scoped settings/profile handlers and SQLite.
 * Recommendation and live form inputs are inert company-bound fixtures; the
 * resolver itself is exercised separately by category-recommendations-client. */
function setup(company,{resolve}={}){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
 const snapshot={...hubSchemaSnapshot(company),draftInitialization:'couplus-required-v1',inputBindings:'couplus-paths-v1',settingsInitialization:'couplus-options-v1',
  metadata:{displayCategoryCode:'991234',kanCategoryId:3000,scopeType:'Retail_Categorized_Single',noticeNumber:17,version:190}};
 const raw=JSON.parse(snapshot.schemaString);raw.metadata='scope:Retail_Categorized_Single;categoryId:3000;productNoticeCategoryId:17;version:190';snapshot.schemaString=JSON.stringify(raw);
 const choice={key:'recommended-single-'+company.code,categoryId:'991234',path:[...schemaPath],isLeaf:true,evidence:'observed',codeEvidence:'supplier-hub',
  supplierHub:{trail:[{categoryId:'991000',name:schemaPath[0],isLeaf:false}],ownerId:'owner',company:{...company}}};
 const recommendation={id:'synthetic-prediction-'+company.code,code:choice.categoryId,path:[...schemaPath],label:schemaPath.join(' > ')};
 const result={source:'supplier-hub-category-predict-api',ownerId:'owner',company:{...company},productName:sourceTitle,queryProductName:'합성 방한 귀달이 모자',observedAt:Date.now(),items:[recommendation]};
 const profileAPI=h.load('app/api/category-profiles/route.ts'),settingsAPI=h.load('app/api/settings/route.ts');
 let schemaReads=0,excelReads=0;const resolutions=[];
 const request=async(path,init)=>{
  if(path==='/api/settings')return settingsAPI.GET();
  assert.equal(path.split('?')[0],'/api/category-profiles');
  return profileAPI[init?.method??'GET'](new Request('https://app.test'+path,init));
 };
 const picker=categoryPickerUI(request,{workspaceOwnerId:'owner',sourceTitle,recommendationResolver:async(item,envelope,ownerId,signal)=>{
  assert.equal(item,recommendation);assert.equal(envelope,result);assert.equal(ownerId,'owner');assert.equal(signal.aborted,false);
  resolutions.push({item,envelope,ownerId,signal});
  return resolve?resolve({item,envelope,ownerId,signal,choice}):choice;
 },catalog:{loadLiveHubCategorySchema:async(received,signal)=>{
  assert.equal(received,choice);assert.equal(signal.aborted,false);schemaReads++;return snapshot;
 },loadLiveHubCategoryTemplate:async()=>{excelReads++;assert.fail('Normal recommendation intake must not request Excel');}}});
 const retained=()=>JSON.stringify(Object.fromEntries(['products','product_options','product_content','product_quotation_fields','collection_jobs','collection_context','collection_results','workspace_settings']
  .map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));
 const profileCount=()=>h.sqlite.prepare('SELECT COUNT(*) n FROM category_profiles').get().n;
 return {h,picker,snapshot,choice,recommendation,result,resolutions,retained,profileCount,get schemaReads(){return schemaReads;},get excelReads(){return excelReads;},close(){picker.close();h.close();}};
}

for(const company of schemaCompanies)test(`explicit recommendation selection verifies the Single form and opens intake without changing existing work (${company.code})`,async()=>{
 const f=setup(company);
 try{
  await f.h.intake();
  const memberSettings={...f.h.settings,brand:company.name,manufacturer:company.name+' 합성 제조사'};
  await f.h.load('db/queries.ts').saveSettings('owner',JSON.stringify(memberSettings));
  const before=f.retained(),objects=JSON.stringify([...f.h.objects]),network=[...f.h.network];
  const initial=f.picker.render(),panel=nodes(initial).find(node=>node.type?.name==='CategoryRecommendationsPanel');
  assert.equal(panel.props.initialTitle,sourceTitle);assert.equal(panel.props.workspaceOwnerId,'owner');
  assert.equal(nodes(initial).some(node=>node.type?.name==='SupplierHubCategoryBrowser'),false);
  assert.equal(f.profileCount(),0);assert.equal(f.schemaReads,0);assert.equal(f.resolutions.length,0);
  assert.equal(f.picker.calls.some(call=>call.method!=='GET'),false,'merely displaying source-title recommendations must never create a profile');
  await f.picker.chooseRecommendation(f.recommendation,f.result);
  assert.equal(f.resolutions.length,1);assert.equal(f.schemaReads,1);assert.equal(f.excelReads,0);
  assert.equal(f.picker.selected.length,1,JSON.stringify(f.picker.alerts()));assert.equal(f.profileCount(),1);
  const selected=f.picker.selected[0];
  assert.equal(selected.categoryId,f.recommendation.code);assert.deepEqual(selected.categoryPath,schemaPath);
  assert.deepEqual(selected.hubSchema.company,company);assert.equal(selected.hubSchema.schemaString,f.snapshot.schemaString);
  assert.equal(selected.hubSchema.metadata.scopeType,'Retail_Categorized_Single');assert.equal(selected.template,null);assert.deepEqual(selected.mappings,[]);
  const persisted=await f.h.load('db/category-profiles.ts').listCategoryProfiles('owner');
  assert.equal(persisted.length,1);assert.equal(persisted[0].id,selected.id);assert.equal(persisted[0].revision,selected.revision);
  assert.equal(f.picker.calls.filter(call=>call.method==='POST').length,1);assert.equal(f.picker.calls.some(call=>['PUT','DELETE'].includes(call.method)),false);
  assert.equal(f.retained(),before,'recommendation selection preserves existing products, source snapshots, queue and member settings');
  assert.equal(JSON.stringify([...f.h.objects]),objects);assert.deepEqual(f.h.network,network);
  assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM supplier_hub_receipts').get().n,0);
  assert.equal(f.result.productName,sourceTitle);assert.equal(f.result.queryProductName,'합성 방한 귀달이 모자');
 }finally{f.close();}
});

test('double-clicking a recommendation while it resolves creates only one verified profile and one intake callback',async()=>{
 let release;const f=setup(schemaCompanies[0],{resolve:({choice})=>new Promise(resolve=>{release=()=>resolve(choice);})});
 try{
  const before=f.retained(),first=f.picker.chooseRecommendation(f.recommendation,f.result);
  await waitFor(()=>Boolean(release));
  const second=f.picker.chooseRecommendation(f.recommendation,f.result);
  assert.equal(f.resolutions.length,1);assert.equal(f.profileCount(),0);assert.equal(f.schemaReads,0);
  release();await Promise.all([first,second]);
  assert.equal(f.picker.selected.length,1,JSON.stringify(f.picker.alerts()));assert.equal(f.profileCount(),1);
  assert.equal(f.schemaReads,1);assert.equal(f.picker.calls.filter(call=>call.method==='POST').length,1);
  await f.picker.chooseRecommendation(f.recommendation,f.result);
  assert.equal(f.resolutions.length,1);assert.equal(f.picker.selected.length,1);assert.equal(f.profileCount(),1);
  assert.equal(f.retained(),before);
 }finally{f.close();}
});

test('a failed recommendation resolver never reads a form, saves a profile or opens intake',async()=>{
 const f=setup(schemaCompanies[1],{resolve:()=>{throw Error('추천 전체 경로·회사 불일치');}});
 try{
  const before=f.retained();await f.picker.chooseRecommendation(f.recommendation,f.result);
  assert.equal(f.resolutions.length,1);assert.equal(f.schemaReads,0);assert.equal(f.excelReads,0);assert.equal(f.profileCount(),0);
  assert.equal(f.picker.selected.length,0);assert.equal(f.picker.calls.length,0);assert.match(f.picker.alerts().join(' '),/전체 경로·회사 불일치/);
  assert.equal(f.retained(),before);
 }finally{f.close();}
});

test('closing the picker aborts a pending recommendation and ignores its late verified choice',async()=>{
 let release;const f=setup(schemaCompanies[0],{resolve:({choice})=>new Promise(resolve=>{release=()=>resolve(choice);})});
 try{
  const before=f.retained(),pending=nodes(f.picker.render()).find(node=>node.type?.name==='CategoryRecommendationsPanel').props.onChoose(f.recommendation,f.result);
  await waitFor(()=>Boolean(release));f.picker.close();
  assert.equal(f.resolutions[0].signal.aborted,true);release();await pending;
  assert.equal(f.picker.selected.length,0);assert.equal(f.schemaReads,0);assert.equal(f.profileCount(),0);assert.equal(f.picker.calls.length,0);
  assert.equal(f.retained(),before);
 }finally{f.close();}
});
