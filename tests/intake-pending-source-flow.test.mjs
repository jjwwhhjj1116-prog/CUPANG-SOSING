import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {categoryPickerUI} from './helpers/category-picker.mjs';
const native=createRequire(import.meta.url),companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const profileFile=new URL('../outputs/step604-unand-profile-read.json',import.meta.url),originalFile=new URL('../outputs/step603-official-unand-2624.xlsx',import.meta.url),fixtureModuleUrl=new URL('./category-picker-workbook-intake.test.mjs',import.meta.url);
const available=fs.existsSync(profileFile)&&fs.existsSync(originalFile),plain=value=>JSON.parse(JSON.stringify(value)),json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[],text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
const waitFor=async fn=>{const limit=Date.now()+7000;while(!fn()){if(Date.now()>limit)throw Error('Local operation timeout');await new Promise(resolve=>setTimeout(resolve,1));}};
const buttonLabel='공식 파일 기준으로 선택 · URL 입력';

/** Recorded Unand original2624/Single69900; Waihop is an isolated reuse. All
 * sources, IDs, transport and generation replies are synthetic and local. */
export async function pendingIntakeFixture(company=companies[0],{received=false,linked=false,imageCount=2}={}){
 const source=fs.readFileSync(fixtureModuleUrl,'utf8'),ast=ts.createSourceFile('fixture.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),node=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='workbookIntakeFixture');assert.ok(node);
 const setup=vm.runInNewContext('('+node.getText(ast).replace(/^export\s+/u,'').replaceAll('import.meta.url','fixtureModuleUrl')+')',
  {mobileIntakeHarness,categoryPickerUI,fs,vm,ts,createHash,profileFile,originalFile,fixtureModuleUrl,companies,plain,assert:Object.assign({},assert,{deepEqual:(a,b,message)=>assert.deepEqual(plain(a),plain(b),message)}),URL,Uint8Array,Buffer,structuredClone,FormData,File,Request,Response,Date,TextEncoder,TextDecoder,crypto,atob,btoa,Error,nodes,waitFor,buttonLabel});
 const f=await setup(company),{h}=f;await f.picker.chooseLive(f.choice);await f.invoke();const original=f.picker.selected[0];
 const url='https://detail.1688.com/offer/642000000001.html',oldSettings={...h.settings,brand:'기존 브랜드'};await h.load('db/queries.ts').saveSettings('owner',JSON.stringify(oldSettings));
 const sourceJob=(await json(await h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({urls:[url],goal:'collect',profileId:original.id,expectedProfileRevision:original.revision,expectedSettings:oldSettings,features:'기존 특징',keywords:'기존 키워드'})})))).jobs[0];
 const facts={schemaVersion:1,sourceUrl:url,provider:'synthetic-local-642',collectedAt:'2026-10-13T00:00:00.000Z',title:'합성 선글라스',description:'원문 보존용 합성 설명',attributes:[],options:Array.from({length:6},(_,index)=>({sku:'LOCAL642-'+index,name:'합성 옵션 '+index,color:'검정',size:'선글라스',unitPriceCny:5+index,minimumOrder:1,stock:7})),
  images:Array.from({length:imageCount},(_,index)=>({url:'https://cbu01.alicdn.com/img/ibank/synthetic642-'+index+'.png',role:index===0?'main':'detail'}))};
 const receive=()=>h.route(`/api/collection-jobs/${sourceJob.id}/result`,{method:'POST',body:facts});
 if(received||linked)await json(await receive());if(linked)await json(await h.route(`/api/collection-jobs/${sourceJob.id}/product`,{method:'POST'}));
 const target=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{...original,name:'현재 선택 카테고리'}),settings={...h.settings,brand:'현재 브랜드'};await h.load('db/queries.ts').saveSettings('owner',JSON.stringify(settings));
 const email=company.code==='A01526306'?'jwhj1116@kakao.com':'unari8484@gmail.com',role=company.code==='A01526306'?'admin':'member';
 h.sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('owner',email,'fixture-only',role,'approved',company.code,company.name,'2026-10-13','2026-10-13');
 const events=[],collections=[],opened=[],locks=[],modules=new Map(),slots=[],effects=[],layouts=[];let cursor=0,owner='owner',goal='work',pause=null,amend=null;
 let rows=[{...h.load('app/intake-queue.ts').intakeRow(target,'row'),url:url+'?spm=local',features:'현재 특징',keywords:'현재 키워드'}],jobs=[];
 const beforeRequest=JSON.stringify({job:h.sqlite.prepare('SELECT * FROM collection_jobs WHERE id=?').get(sourceJob.id),context:h.sqlite.prepare('SELECT * FROM collection_context WHERE job_id=?').get(sourceJob.id)});
 const originalFiles=JSON.stringify([...h.objects].map(([key,value])=>[key,Buffer.from(value).toString('base64')]));
 const request=async(url,init={})=>{
  const method=init.method??'GET',parsed=new URL(url,'https://app.test');events.push({url,method,body:init.body?JSON.parse(init.body):null,signal:init.signal});if(pause)await pause(url,init);if(amend){const replaced=await amend(url,init);if(replaced)return replaced;}
  if(url==='/api/settings')return h.load('app/api/settings/route.ts').GET();
  if(parsed.pathname==='/api/collection-jobs')return h.load('app/api/collection-jobs/route.ts')[method](new Request(parsed,init));
  if(url.endsWith('/collect'))return receive();
  if(parsed.pathname.endsWith('/new-draft'))return h.load('app/api/collection-jobs/[id]/new-draft/route.ts')[method](new Request(parsed,init),{params:Promise.resolve({id:parsed.pathname.split('/')[3]})});
  return h.route(url,{method,body:init.body});
 };
 const effect=(queue,fn,deps)=>{const index=cursor++,previous=slots[index];if(!previous||!deps||deps.some((value,i)=>!Object.is(value,previous.deps[i]))){const next={deps,cleanup:previous?.cleanup};slots[index]=next;queue.push(()=>{previous?.cleanup?.();next.cleanup=fn();});}};
 const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]={value:typeof initial==='function'?initial():initial};return[slots[index].value,value=>slots[index].value=typeof value==='function'?value(slots[index].value):value];},useRef(value){const index=cursor++;return slots[index]??(slots[index]={current:value});},useEffect(fn,deps){effect(effects,fn,deps);},useLayoutEffect(fn,deps){effect(layouts,fn,deps);}};
 function load(file){if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,Error,URL,URLSearchParams,Date,TextEncoder,TextDecoder,structuredClone,Uint8Array,AbortController,crypto,setTimeout,clearTimeout,fetch:request,require(name){if(name==='react')return hooks;if(name==='@/app/components/category-picker')return{CategoryPicker:()=>null};if(name==='@/app/components/intake-quotation-preview')return{IntakeQuotationPreview:()=>null};if(name==='@/app/browser-product-bridge')return{capture1688FromChrome:()=>assert.fail('source preparation must not call Chrome in this local fixture')};if(name==='@/app/intake-collection')return{collectIntakeProduct:async(job,callbacks)=>{collections.push(job);callbacks.onJob(job);return'합성 새 초안 · 소유자 확인 필요';}};if(name.startsWith('@/'))return load(name.slice(2)+'.ts');if(name.startsWith('./')||name.startsWith('../'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');return native(name);}});return exports;}
 const Component=load('app/components/intake-queue-panel.tsx').IntakeQueuePanel;
 const render=()=>{cursor=0;const tree=Component({rows,onRows:update=>rows=update(rows),profiles:[target],onProfile(){},onAdvanced(){},onJobs:values=>jobs=[...values,...jobs.filter(job=>!values.some(value=>value.id===job.id))],onBusy:value=>locks.push(value),goal,onGoal:value=>goal=value,settings,workspaceOwnerId:owner,onSettingsReloaded(){},jobs,onOpenProduct:async id=>opened.push(id)});layouts.splice(0).forEach(fn=>fn());effects.splice(0).forEach(fn=>fn());return tree;};
 const button=label=>nodes(render()).find(node=>node.type==='button'&&text(node).includes(label));
 const idle=async()=>{const limit=Date.now()+12000;do{render();await new Promise(resolve=>setTimeout(resolve,1));if(Date.now()>limit)throw Error('Pending source React operation timeout');}while(nodes(render()).some(node=>node.type==='button'&&node.props.disabled&&/원문 준비 중|상품정보 가져오는 중/u.test(text(node))));for(let i=0;i<5;i++){render();await new Promise(resolve=>setImmediate(resolve));}};
 const click=async label=>{const selected=button(label);assert.ok(selected&&!selected.props.disabled,label);selected.props.onClick();await idle();};
 const requestPreserved=()=>JSON.stringify({job:h.sqlite.prepare('SELECT * FROM collection_jobs WHERE id=?').get(sourceJob.id),context:h.sqlite.prepare('SELECT * FROM collection_context WHERE job_id=?').get(sourceJob.id)})===beforeRequest;
 const sourceProduct=()=>h.sqlite.prepare('SELECT product_id FROM collection_products WHERE job_id=?').get(sourceJob.id)?.product_id;
 const preserved=()=>JSON.stringify(['products','product_content','product_options','product_quotation_fields','product_price_policy'].map(table=>[table,h.sqlite.prepare(`SELECT * FROM ${table} WHERE ${table==='products'?'id':'product_id'}=?`).all(sourceProduct()??'none')]));
 render();return{f,h,company,url,original,target,settings,sourceJob,facts,events,collections,opened,locks,request,receive,load,render,button,click,idle,requestPreserved,sourceProduct,preserved,originalFiles,get rows(){return rows;},setPause(fn){pause=fn;},setAmend(fn){amend=fn;},setOwner(value){owner=value;render();},edit(patch){rows=rows.map(row=>({...row,...patch}));render();},close(){slots.forEach(slot=>slot?.cleanup?.());f.close();}};
}

for(const company of companies)test(`an unregistered conflicting URL is explicitly reviewed and prepares source only before the current-input fork (${company.code}; ${company.code==='A01526306'?'recorded original':'isolated contract reuse'})`,{skip:!available},async()=>{
 const f=await pendingIntakeFixture(company);try{
  const input=plain({url:f.rows[0].url,profile:f.rows[0].profile,features:f.rows[0].features,keywords:f.rows[0].keywords});await f.click('시작 (');assert.equal(f.rows[0].status,'error');assert.equal(f.rows[0].pendingJobId,f.sourceJob.id);assert.ok(f.button('기존 대기 요청 확인'));assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);
  const before=f.events.length;await f.click('기존 대기 요청 확인');assert.ok(f.button('원문 준비 후 새 초안 검토'),text(f.render()));assert.ok(f.events.slice(before).every(event=>event.method==='GET'));assert.match(text(f.render()),/기존 브랜드/);assert.match(text(f.render()),/번역·이미지 다운로드·등록전송은 실행하지 않으며/);
  const prepare=f.button('원문 준비 후 새 초안 검토').props.onClick;prepare();prepare();await f.idle();assert.ok(f.button('새 초안 생성'),text(f.render()));assert.equal(f.events.filter(event=>event.url.endsWith('/collect')).length,1);assert.equal(f.events.filter(event=>event.url.endsWith('/product')).length,1);assert.equal(f.events.filter(event=>event.url.includes('/new-draft')&&event.method==='POST').length,0);assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);assert.equal(f.collections.length,0);assert.deepEqual(f.opened,[]);
  assert.deepEqual(plain({url:f.rows[0].url,profile:f.rows[0].profile,features:f.rows[0].features,keywords:f.rows[0].keywords}),input);assert.equal(f.requestPreserved(),true);
  const raw=f.h.sqlite.prepare('SELECT * FROM collection_results WHERE job_id=?').get(f.sourceJob.id),source=f.preserved();await f.click('새 초안 생성');assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM products').get().n,2);assert.equal(f.collections.length,1);assert.equal(f.collections[0].goal,'work');assert.equal(f.collections[0].context.category.id,f.target.id);assert.equal(f.collections[0].context.settings.brand,'현재 브랜드');assert.deepEqual(f.opened,[f.rows[0].productId]);assert.notEqual(f.rows[0].productId,f.sourceProduct());assert.equal(f.preserved(),source);assert.deepEqual(f.h.sqlite.prepare('SELECT * FROM collection_results WHERE job_id=?').get(f.sourceJob.id),raw);assert.equal(f.requestPreserved(),true);
  const view=await json(await f.h.route('/api/products/'+f.rows[0].productId+'/quotation-fields'));assert.equal(view.categoryContext.profileId,f.target.id);assert.equal(view.resolved.schema.categoryId,'69900');const preview=await json(await f.h.route('/api/products/'+f.rows[0].productId+'/quotation',{method:'POST',body:{action:'preview'}}));const response=await f.h.route('/api/products/'+f.rows[0].productId+'/quotation',{method:'POST',body:{action:'download',fingerprint:preview.fingerprint}});assert.equal(response.status,200,await response.clone().text());const reader=f.h.load('app/xlsx-template.ts'),book=reader.inspectXlsxArchive(await reader.readXlsxArchive(await response.arrayBuffer()));assert.equal(preview.rows.length,6);for(let i=0;i<6;i++){const cells=reader.xlsxHeaders(book,f.target.template.sheetName,9+i);for(const key of ['category','title','brand']){const column=f.target.mappings.find(mapping=>mapping.field===key).column;assert.equal(cells[column],preview.rows[i][column]);}assert.equal(cells[f.target.mappings.find(mapping=>mapping.field==='brand').column],'현재 브랜드');}
  assert.equal(JSON.stringify([...f.h.objects].map(([key,value])=>[key,Buffer.from(value).toString('base64')])),f.originalFiles);assert.equal(f.h.network.length,0);assert.equal(f.h.aiSources.length,0);assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n,0);
 }finally{f.close();}
});

for(const company of companies)test(`a received source is reused without collection and an already linked product bypasses both preparation POSTs (${company.code})`,{skip:!available},async()=>{
 for(const linked of [false,true]){const f=await pendingIntakeFixture(company,{received:true,linked});try{
  const before=f.preserved();await f.click('시작 (');if(linked){assert.ok(f.button('저장 원문으로 새 초안'));assert.equal(f.button('기존 대기 요청 확인'),undefined);await f.click('저장 원문으로 새 초안');assert.ok(f.button('원문 URL로 새 초안 검토'));assert.equal(f.button('새 초안 생성'),undefined);await f.click('원문 URL로 새 초안 검토');}else{await f.click('기존 대기 요청 확인');await f.click('원문 준비 후 새 초안 검토');}
  assert.ok(f.button('새 초안 생성'),text(f.render()));assert.equal(f.events.filter(event=>event.url.endsWith('/collect')).length,0);assert.equal(f.events.filter(event=>event.url.endsWith('/product')).length,linked?0:1);assert.equal(f.requestPreserved(),true);if(linked)assert.equal(f.preserved(),before);assert.equal(f.h.network.length,0);assert.equal(f.h.aiSources.length,0);
 }finally{f.close();}}
});

test('a product linked after read-only review moves to fork review without collecting or promoting again',{skip:!available},async()=>{
 const f=await pendingIntakeFixture();try{await f.click('시작 (');await f.click('기존 대기 요청 확인');await json(await f.receive());await json(await f.h.route(`/api/collection-jobs/${f.sourceJob.id}/product`,{method:'POST'}));const before=f.preserved(),calls=f.events.length;await f.click('원문 준비 후 새 초안 검토');assert.ok(f.button('새 초안 생성'),text(f.render()));assert.ok(f.events.slice(calls).every(event=>event.method==='GET'));assert.equal(f.preserved(),before);assert.equal(f.h.network.length,0);}finally{f.close();}
});

test('changed received source, context, company, owner and cancelled requests stop before preparation writes',{skip:!available},async()=>{
 for(const variant of ['received','context','company','owner','cancelled']){const f=await pendingIntakeFixture();try{
  await f.click('시작 (');await f.click('기존 대기 요청 확인');if(variant==='received')await json(await f.receive());else if(variant==='context'){const context=JSON.parse(f.h.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get(f.sourceJob.id).payload);context.features='다른 화면 변경';f.h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(context),f.sourceJob.id);}else if(variant==='company')f.h.setCompany(companies[1]);else if(variant==='owner')f.setOwner('other-owner');else f.h.sqlite.prepare("UPDATE collection_jobs SET status='cancelled' WHERE id=?").run(f.sourceJob.id);
  const before=f.h.sqlite.prepare('SELECT count(*) n FROM products').get().n,start=f.events.length,button=f.button('원문 준비 후 새 초안 검토');if(button)await f.click('원문 준비 후 새 초안 검토');assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM products').get().n,before);assert.ok(f.events.slice(start).every(event=>event.method==='GET'));assert.equal(f.collections.length,0);assert.equal(f.h.network.length,0);
 }finally{f.close();}}
});

test('URL or input edits and closed/changed-owner views invalidate captured source actions',{skip:!available},async()=>{
 for(const variant of ['url','features','dialog','close','owner']){const f=await pendingIntakeFixture();let closed=false;try{
  await f.click('시작 (');await f.click('기존 대기 요청 확인');const callback=f.button('원문 준비 후 새 초안 검토').props.onClick;if(variant==='close'){f.close();closed=true;}else if(variant==='owner')f.setOwner('other-owner');else if(variant==='dialog')await f.click('닫기 · 현재 입력 유지');else f.edit(variant==='url'?{url:'https://detail.1688.com/offer/642000000002.html'}:{features:'새 수동 입력'});const start=f.events.length;callback();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.events.length,start);assert.equal(f.collections.length,0);
 }finally{if(!closed)f.close();}}
});

test('held read-only or source responses never create a fork or overwrite input after unmount',{skip:!available},async()=>{
 for(const stage of ['review','prepare']){const f=await pendingIntakeFixture();let closed=false,release;try{
  await f.click('시작 (');if(stage==='prepare')await f.click('기존 대기 요청 확인');f.setPause(async(url)=>{if(stage==='review'?url.startsWith('/api/collection-jobs?id='):url.endsWith('/collect'))await new Promise(resolve=>release=resolve);});const callback=f.button(stage==='review'?'기존 대기 요청 확인':'원문 준비 후 새 초안 검토').props.onClick;callback();await waitFor(()=>Boolean(release));const input=JSON.stringify(f.rows),count=f.events.length;f.close();closed=true;release();await new Promise(resolve=>setTimeout(resolve,30));assert.equal(JSON.stringify(f.rows),input);assert.equal(f.events.length,count);assert.equal(f.collections.length,0);
 }finally{if(!closed)f.close();}}
});

test('wrong offer/receipt acknowledgement or an uncertain product save cannot silently publish a fork',{skip:!available},async()=>{
 for(const variant of ['offer','receipt','product']){const f=await pendingIntakeFixture();try{
  await f.click('시작 (');await f.click('기존 대기 요청 확인');f.setAmend(async(url,init)=>{if(variant==='offer'&&url.startsWith('/api/collection-jobs?id=')){const reply=await f.h.load('app/api/collection-jobs/route.ts').GET(new Request('https://app.test'+url)),value=await reply.json();value.job.offer_id='642000000099';return Response.json(value);}if(variant==='receipt'&&url.endsWith('/collect')){const reply=await f.receive(),value=await reply.json();value.offerId='642000000099';return Response.json(value);}if(variant==='product'&&url.endsWith('/product')&&init.method==='POST'){await f.h.route(url,{method:'POST'});throw Error('synthetic product acknowledgement lost');}return null;});
  await f.click('원문 준비 후 새 초안 검토');assert.equal(f.button('새 초안 생성'),undefined);assert.equal(f.collections.length,0);assert.match(text(f.render()),variant==='product'?/acknowledgement lost/:/변경|상품/);if(variant==='product'){f.setAmend(null);const start=f.events.length;await f.click('원문 준비 후 새 초안 검토');assert.ok(f.button('새 초안 생성'),text(f.render()));assert.ok(f.events.slice(start).every(event=>event.method==='GET'));}assert.equal(f.h.network.length,0);assert.equal(f.h.aiSources.length,0);
 }finally{f.close();}}
});

test('a pending request older than 200 later jobs is recovered by exact owned ID without expanding the recent list',{skip:!available},async()=>{
 const f=await pendingIntakeFixture();try{
  for(let index=0;index<203;index++)f.h.sqlite.prepare('INSERT INTO collection_jobs VALUES(?,?,?,?,?,?,?,?)').run('00000000-0000-4000-8000-'+String(index).padStart(12,'0'),'owner',String(642100000000+index),'https://detail.1688.com/offer/'+(642100000000+index)+'.html','collect','awaiting_connector','2026-10-14T00:00:00.000Z','2026-10-14T00:00:00.000Z');
  const recent=await json(await f.h.load('app/api/collection-jobs/route.ts').GET());assert.equal(recent.jobs.length,200);assert.ok(!recent.jobs.some(job=>job.id===f.sourceJob.id));
  await f.click('시작 (');await f.click('기존 대기 요청 확인');assert.ok(f.button('원문 준비 후 새 초안 검토'));assert.ok(f.events.some(event=>event.url==='/api/collection-jobs?id='+f.sourceJob.id));assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);assert.equal(f.requestPreserved(),true);
 }finally{f.close();}
});

test('exact pending ID lookup rejects malformed, duplicate, foreign and unknown IDs without exposing other work',{skip:!available},async()=>{
 const f=await pendingIntakeFixture();try{
  const otherId='00000000-0000-4000-8000-000000642999';f.h.sqlite.prepare('INSERT INTO collection_jobs VALUES(?,?,?,?,?,?,?,?)').run(otherId,'other-owner','642999999999','https://detail.1688.com/offer/642999999999.html','collect','awaiting_connector','2026-10-13','2026-10-13');
  const api=f.h.load('app/api/collection-jobs/route.ts');for(const [query,status] of [['?id=bad',400],['?id='+f.sourceJob.id+'&id='+f.sourceJob.id,400],['?id='+f.sourceJob.id+'&extra=true',400],['?id='+otherId,404],['?id=00000000-0000-4000-8000-000000642998',404]]){const reply=await api.GET(new Request('https://app.test/api/collection-jobs'+query));assert.equal(reply.status,status);assert.equal((await reply.json()).job,undefined);}const owned=await json(await api.GET(new Request('https://app.test/api/collection-jobs?id='+f.sourceJob.id)));assert.equal(owned.job.id,f.sourceJob.id);assert.equal(f.requestPreserved(),true);assert.equal(f.h.network.length,0);
 }finally{f.close();}
});

test('51 unstored source images remain exact raw URLs and collectedAt in the separately reviewed new draft',{skip:!available},async()=>{
 const f=await pendingIntakeFixture(companies[0],{imageCount:51});try{
  await f.click('시작 (');await f.click('기존 대기 요청 확인');await f.click('원문 준비 후 새 초안 검토');assert.ok(f.button('새 초안 생성'));assert.match(text(f.render()),/저장 안 된 사진 51개는 새 초안에서 가져옵니다/);
  const source=(await f.h.load('db/collection-results.ts').readCollectionResult('owner',f.sourceJob.id)).result,before=f.preserved();await f.click('새 초안 생성');const next=f.collections[0];assert.equal(next.context.forkedFrom.sourceMode,'pending-source-urls-v1');const received=(await f.h.load('db/collection-results.ts').readCollectionResult('owner',next.id)).result;assert.deepEqual(received,source);assert.equal(received.collectedAt,f.facts.collectedAt);assert.equal(received.images.length,51);assert.equal(f.preserved(),before);assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM collection_images').get().n,0);assert.equal(f.h.network.length,0);assert.equal(f.h.aiSources.length,0);
 }finally{f.close();}
});

test('source-only acknowledgement failure and a reopened linked row require the server typed candidate and explicit URL-mode review',{skip:!available},async()=>{
 const f=await pendingIntakeFixture();try{
  await f.click('시작 (');await f.click('기존 대기 요청 확인');let failed=false;f.setAmend(async url=>{if(!failed&&url.includes('/new-draft')){failed=true;throw Error('synthetic preview acknowledgement lost');}return null;});await f.click('원문 준비 후 새 초안 검토');assert.equal(f.button('새 초안 생성'),undefined);assert.ok(f.button('저장 원문으로 새 초안'));
  f.edit({pendingSourceMode:undefined,pendingSourceHash:undefined});f.setAmend(null);const before=f.preserved(),start=f.events.length;await f.click('저장 원문으로 새 초안');assert.ok(f.button('원문 URL로 새 초안 검토'));assert.equal(f.button('새 초안 생성'),undefined);assert.ok(f.events.slice(start).every(event=>event.method==='GET'));const cancelled=f.button('원문 URL로 새 초안 검토').props.onClick;await f.click('닫기 · 현재 입력 유지');const closedCount=f.events.length;cancelled();await f.idle();assert.equal(f.events.length,closedCount);await f.click('저장 원문으로 새 초안');const action=f.button('원문 URL로 새 초안 검토').props.onClick;action();action();await f.idle();assert.ok(f.button('새 초안 생성'));assert.equal(f.preserved(),before);assert.ok(f.events.slice(start).every(event=>event.method==='GET'));assert.equal(f.h.network.length,0);assert.equal(f.h.aiSources.length,0);
 }finally{f.close();}
});

test('manual source edits, blanks, image descriptors and source activity deny URL-mode permission and normal working fork requirements stay strict',{skip:!available},async()=>{
 for(const variant of ['blank','option','image']){const f=await pendingIntakeFixture(companies[0],{received:true,linked:true});try{
  await f.click('시작 (');await f.click('저장 원문으로 새 초안');assert.ok(f.button('원문 URL로 새 초안 검토'));
  const base='/api/products/'+f.sourceProduct();if(variant==='blank'){const content=await json(await f.h.route(base+'/content'));await json(await f.h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.content.revision,patch:{label:{material:''}}}}));}
  else if(variant==='option'){const stored=f.h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.sourceProduct()),value=JSON.parse(stored.payload);value.rows[0].color='직접 확인한 색상';f.h.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(value),f.sourceProduct());}
  else f.h.sqlite.prepare('INSERT INTO collection_images(job_id,image_index,owner_id,product_id,object_key,operation_id,created_at) VALUES(?,?,?,?,?,?,?)').run(f.sourceJob.id,0,'owner',f.sourceProduct(),'owner/synthetic642-existing.png',crypto.randomUUID(),'2026-10-13');
  const actor=f.preserved(),start=f.events.length;await f.click('원문 URL로 새 초안 검토');assert.equal(f.button('새 초안 생성'),undefined);assert.ok(f.events.slice(start).every(event=>event.method==='GET'));assert.equal(f.preserved(),actor);await f.click('저장 원문으로 새 초안');assert.equal(f.button('원문 URL로 새 초안 검토'),undefined);assert.equal(f.button('새 초안 생성'),undefined);assert.equal(f.h.network.length,0);
 }finally{f.close();}}
});

test('raw URL review fingerprint, receipt hash, target revision and atomic source payload CAS prevent creation after changes',{skip:!available},async()=>{
 for(const variant of ['receipt','target','atomic']){const f=await pendingIntakeFixture();try{
  await f.click('시작 (');await f.click('기존 대기 요청 확인');await f.click('원문 준비 후 새 초안 검토');assert.ok(f.button('새 초안 생성'));
  if(variant==='receipt'){const row=f.h.sqlite.prepare('SELECT payload FROM collection_results WHERE job_id=?').get(f.sourceJob.id),value=JSON.parse(row.payload);value.images[0].url='https://cbu01.alicdn.com/img/ibank/changed642.png';f.h.sqlite.prepare('UPDATE collection_results SET payload=? WHERE job_id=?').run(JSON.stringify(value),f.sourceJob.id);}
  else if(variant==='target')await f.h.load('db/category-profiles.ts').updateCategoryProfile('owner',f.target.id,f.target.revision,{...f.target,name:'다른 화면 변경'});
  else{const db=f.h.bindings.DB,prepare=db.prepare.bind(db),batch=db.batch.bind(db);db.prepare=sql=>Object.assign(prepare(sql),{sql});let armed=true;db.batch=async statements=>{if(armed&&statements.some(value=>value.sql?.startsWith('INSERT INTO collection_jobs(id'))){armed=false;const row=f.h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(f.sourceProduct()),value=JSON.parse(row.payload);value.label.material.value='원자 생성 직전 직접 변경';f.h.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(value),f.sourceProduct());}return batch(statements);};}
  const products=f.h.sqlite.prepare('SELECT count(*) n FROM products').get().n;await f.click('새 초안 생성');assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM products').get().n,products);assert.equal(f.collections.length,0);assert.equal(f.h.network.length,0);assert.equal(f.requestPreserved(),true);
 }finally{f.close();}}
});
