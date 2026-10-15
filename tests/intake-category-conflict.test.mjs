import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

const companies=[{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}];
const plain=value=>JSON.parse(JSON.stringify(value));
const snapshot=h=>JSON.stringify(h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,h.sqlite.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));

async function fixture(company,{differentNext=false,stale=true}={}){
 const h=mobileIntakeHarness(company),profiles=h.load('db/category-profiles.ts'),queue=h.load('app/intake-queue.ts');
 const input={name:'수동 선택 바스켓',categoryId:'80719',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓'],mappings:[],template:null};
 const profile=await profiles.createCategoryProfile('owner',input,'00000000-0000-0000-0000-000000000674');
 const other=differentNext?await profiles.createCategoryProfile('owner',{...input,name:'다른 수동 선택 양식'},'00000000-0000-0000-0000-000000000675'):profile;
 const rows=[1,2,3].map((number)=>({...queue.intakeRow(number===1?profile:other,`row-${number}`),url:`https://detail.1688.com/offer/67400000000${number}.html?spm=manual-${number}`,features:`직접 입력 특징 ${number}`,keywords:`수동 검색어${number}`,message:`보관한 초안 ${number}`}));
 if(stale)await profiles.updateCategoryProfile('owner',profile.id,profile.revision,{...input,name:'현재 저장된 새 양식'});
 const posts=[],responses=[],published=[],collected=[],updates=[],selectedIds=new Set(rows.map(row=>row.id));let settingsChanged=0;
 const controller=new AbortController(),api=h.load('app/api/collection-jobs/route.ts');
 const fetcher=async(path,init)=>{assert.equal(path,'/api/collection-jobs');assert.equal(init.method,'POST');const body=JSON.parse(init.body);posts.push(body);const response=await api.POST(new Request('https://app.test'+path,init));responses.push({status:response.status,body:await response.clone().json()});return response;};
 const options={signal:controller.signal,selectedIds,fetcher,onRow(id,patch){updates.push({id,...patch});Object.assign(rows.find(row=>row.id===id),patch);},onJobs(jobs){published.push(...jobs);},onSettingsChanged(){settingsChanged++;},collect:async(job)=>{collected.push(job.id);return '합성 검수 초안 완료';}};
 return {h,queue,rows,profile,other,controller,posts,responses,published,collected,updates,selectedIds,options,fetcher,baseline:snapshot(h),get settingsChanged(){return settingsChanged;},close(){h.close();}};
}

for(const company of companies){
 for(const differentNext of [false,true])test(`actual409 category revision conflict pauses the whole Start with untouched later ${differentNext?'different':'same'} profile rows (${company.companyCode})`,async()=>{
  const f=await fixture(company,{differentNext});try{
   const before=plain(f.rows),profiles=f.rows.map(row=>row.profile),selection=[...f.selectedIds];await f.queue.submitIntakeQueue(f.rows,'work',f.options);
   assert.equal(f.posts.length,1);assert.equal(f.responses[0].status,409);assert.equal(f.responses[0].body.code,'CATEGORY_PROFILE_CHANGED');assert.equal(f.published.length,0);assert.equal(f.collected.length,0);assert.equal(f.settingsChanged,0);
   assert.deepEqual(f.updates.map(update=>[update.id,update.status]),[['row-1','error']]);assert.match(f.rows[0].message,/카테고리.*변경|최신 카테고리/);
   for(const key of ['url','features','keywords','profile'])assert.deepEqual(plain(f.rows[0][key]),before[0][key]);assert.deepEqual(plain(f.rows.slice(1)),before.slice(1));for(let i=0;i<3;i++)assert.equal(f.rows[i].profile,profiles[i]);assert.deepEqual([...f.selectedIds],selection);
   assert.equal(f.posts[0].profileId,f.profile.id);assert.equal(f.posts[0].expectedProfileRevision,1);assert.equal(snapshot(f.h),f.baseline,'category conflict never mutates jobs, existing drafts, options, quotes or settings');assert.equal(f.h.network.length,0);assert.equal(f.h.aiSources.length,0);assert.equal(f.h.objects.size,0);
  }finally{f.close();}
 });
 test(`abort before a late category409 response publishes nothing and sends no later URLs (${company.companyCode})`,async()=>{
  const f=await fixture(company);try{
   const before=plain(f.rows);let release,arrive;const held=new Promise(done=>{release=done;}),started=new Promise(done=>{arrive=done;});
   const run=f.queue.submitIntakeQueue(f.rows,'work',{...f.options,fetcher:async(path,init)=>{const response=await f.fetcher(path,init);arrive();await held;return response;}});await started;f.controller.abort();release();await run;
   assert.equal(f.posts.length,1);assert.equal(f.updates.length,0);assert.equal(f.published.length,0);assert.equal(f.collected.length,0);assert.deepEqual(plain(f.rows),before);assert.equal(snapshot(f.h),f.baseline);assert.equal(f.h.network.length,0);
  }finally{f.close();}
 });
 test(`aborting from the category error callback cannot start another profile or collection (${company.companyCode})`,async()=>{
  const f=await fixture(company,{differentNext:true});try{
   await f.queue.submitIntakeQueue(f.rows,'work',{...f.options,onRow(id,patch){f.options.onRow(id,patch);f.controller.abort();}});assert.equal(f.posts.length,1);assert.equal(f.updates.length,1);assert.equal(f.published.length,0);assert.equal(f.collected.length,0);assert.equal(snapshot(f.h),f.baseline);
  }finally{f.close();}
 });
 test(`actual registration-settings409 keeps its existing callback and whole-queue pause (${company.companyCode})`,async()=>{
  const f=await fixture(company,{stale:false});try{
   const before=plain(f.rows);await f.queue.submitIntakeQueue(f.rows,'work',{...f.options,expectedSettings:f.h.settings});assert.equal(f.posts.length,1);assert.equal(f.responses[0].status,409);assert.equal(f.responses[0].body.code,'REGISTRATION_SETTINGS_CHANGED');assert.equal(f.settingsChanged,1);assert.equal(f.updates.length,1);assert.equal(f.rows[0].status,'error');assert.deepEqual(plain(f.rows.slice(1)),before.slice(1));assert.equal(f.published.length,0);assert.equal(f.collected.length,0);assert.equal(snapshot(f.h),f.baseline);
  }finally{f.close();}
 });
 test(`generic400 validation errors still continue later URLs using their explicitly selected category (${company.companyCode})`,async()=>{
  const f=await fixture(company,{stale:false});try{
   const before=plain(f.rows);await f.queue.submitIntakeQueue(f.rows,'work',{...f.options,fetcher:async(path,init)=>f.posts.length===0?(f.posts.push(JSON.parse(init.body)),Response.json({error:'단일 상품 입력 오류',code:'CATEGORY_CODE_INVALID'},{status:400})):f.fetcher(path,init)});
   assert.equal(f.posts.length,3);assert.equal(f.rows[0].status,'error');assert.deepEqual(f.rows.slice(1).map(row=>row.status),['saved','saved']);assert.equal(f.published.length,2);assert.equal(f.collected.length,2);assert.equal(f.settingsChanged,0);for(let i=0;i<3;i++)for(const key of ['url','features','keywords','profile'])assert.deepEqual(plain(f.rows[i][key]),before[i][key]);assert.equal(f.h.network.length,0);
  }finally{f.close();}
 });
}

for(const [name,status,body]of[
 ['categorycode on400',400,{error:'형식 오류',code:'CATEGORY_PROFILE_CHANGED'}],
 ['categorycode on503',503,{error:'일시 오류',code:'CATEGORY_PROFILE_CHANGED'}],
 ['unrecognized409',409,{error:'다른 충돌',code:'OTHER_CONFLICT'}],
 ['arraycode409',409,{error:'잘못된 코드 형태',code:['CATEGORY_PROFILE_CHANGED']}],
 ['objectcode409',409,{error:'잘못된 코드 형태',code:{name:'CATEGORY_PROFILE_CHANGED'}}],
])test(`${name} does not trust a category-pause instruction outside the exact409/code contract`,async()=>{
 const f=await fixture(companies[0],{stale:false});try{
  await f.queue.submitIntakeQueue(f.rows,'work',{...f.options,fetcher:async(path,init)=>f.posts.length===0?(f.posts.push(JSON.parse(init.body)),Response.json(body,{status})):f.fetcher(path,init)});
  assert.equal(f.posts.length,3);assert.equal(f.rows[0].status,'error');assert.deepEqual(f.rows.slice(1).map(row=>row.status),['saved','saved']);assert.equal(f.published.length,2);assert.equal(f.collected.length,2);assert.equal(f.settingsChanged,0);assert.equal(f.h.network.length,0);
 }finally{f.close();}
});

test('a categorycode embedded in a valid successful response cannot pause later explicitly selected URLs',async()=>{
 const f=await fixture(companies[0],{stale:false});try{
  await f.queue.submitIntakeQueue(f.rows,'work',{...f.options,fetcher:async(path,init)=>{const response=await f.fetcher(path,init);return Response.json({...await response.json(),code:'CATEGORY_PROFILE_CHANGED'},{status:response.status});}});
  assert.equal(f.posts.length,3);assert.ok(f.rows.every(row=>row.status==='saved'));assert.equal(f.published.length,3);assert.equal(f.collected.length,3);assert.equal(f.settingsChanged,0);assert.equal(f.h.network.length,0);
 }finally{f.close();}
});
