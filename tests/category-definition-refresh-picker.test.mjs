import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {categoryPickerUI} from './helpers/category-picker.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
import {workbookArchive} from './helpers/quotation-workbook.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const row=(number,values)=>`<row r="${number}">${values.map((value,index)=>`<c r="${String.fromCharCode(65+index)}${number}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`;
const deferred=()=>{let resolve;return{promise:new Promise(done=>{resolve=done;}),resolve:value=>resolve(value)};};
async function json(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
async function waitFor(predicate){const deadline=Date.now()+5000;while(!predicate()){if(Date.now()>deadline)throw Error('Picker fixture timed out');await new Promise(resolve=>setTimeout(resolve,1));}}
const pending=ui=>nodes(ui.render()).some(node=>node.props?.className==='category-picker'&&node.props['aria-busy']);
const start=(ui,choice)=>nodes(ui.render()).find(node=>node.type?.name==='SupplierHubCategoryBrowser').props.onChoice(choice);
const savedRows=h=>JSON.stringify(h.sqlite.prepare('SELECT * FROM category_profiles ORDER BY id').all());

// Synthetic Single + owned QF bytes exercise the actual handlers. No Hub,
// collection job or existing product is contacted or changed by these tests.
async function setup(company){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
 try{
  const headers=['상품명','카테고리','공급가','모델명','설치지원방식','소싱채널','소싱채널ID',...Array.from({length:13},(_,index)=>'시험 지원불가 열 '+index)],category=schemaPath.join('>')+' (991234)';
  const bytes=workbookArchive([
   ['[Content_Types].xml','<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
   ['_rels/.rels','<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
   ['xl/workbook.xml','<workbook xmlns:r="relationship"><sheets><sheet name="QF_3000_시험분류" r:id="one"/></sheets></workbook>'],
   ['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
   ['xl/worksheets/sheet1.xml',`<worksheet><sheetData>${row(1,['','Retail_Categorized_Excel:Kan:3000:Notice17:Version190'])}${row(5,headers)}${row(6,headers.map((_value,index)=>index<3?'필수':index===4?'조건부 필수':'선택'))}${row(7,headers.map(()=>'실제 상품 확인'))}${row(8,headers.map((_value,index)=>index===1?category:'예시'))}</sheetData><dataValidations count="3"><dataValidation type="list" allowBlank="true" sqref="B9:B1008"><formula1>"${category}"</formula1></dataValidation><dataValidation type="list" allowBlank="true" sqref="E9:E1008"><formula1>"판매자설치,구매자설치"</formula1></dataValidation><dataValidation type="custom" allowBlank="true" sqref="H9:T1008"><formula1>LEN(H9)&lt;100</formula1></dataValidation></dataValidations></worksheet>`],
  ]);
  const schema={...hubSchemaSnapshot(company),metadata:{displayCategoryCode:'991234',kanCategoryId:3000,scopeType:'Retail_Categorized_Single',noticeNumber:17,version:189}};
  const connected=await h.load('app/official-hub-template.ts').connectOfficialWorkbookTemplate(bytes.buffer,schema),sha256=createHash('sha256').update(bytes).digest('hex'),storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');
  await h.bindings.FILES.put(storageKey,bytes,{customMetadata:{sha256,format:'xlsx'}});
  const model=h.load('app/quotation-schema.ts').getQuotationSchema('991234',schemaPath,schema).fields.find(field=>field.hubWire?.path.join('/')==='productPage/basicAttributes/modelNumber');assert.ok(model);
  const mappings=plain(connected.mappings).filter(mapping=>mapping.column!==3&&mapping.column!==19);
  mappings.push({column:3,field:model.id,required:false},{column:19,field:'constant',constant:'보존할 수동 상수',required:false});
  const api=h.load('app/api/category-profiles/route.ts'),input={name:'합성 Picker 갱신 '+company.name,categoryId:'991234',categoryPath:schemaPath,hubSchema:schema,template:{...plain(connected.template),name:'synthetic-picker-'+company.code+'.xlsx',sha256,storageKey},mappings};
  const {profile}=await json(await api.POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)})),201);
  const raw=JSON.parse(schema.schemaString);raw.properties.productPage.properties.basicAttributes.properties.modelNumber.maxLength=49;
  const current={...schema,schemaString:JSON.stringify(raw),observedAt:schema.observedAt+1};
  const choice={key:'hub:991234:'+JSON.stringify(schemaPath),categoryId:'991234',path:schemaPath,evidence:'observed',isLeaf:true,childrenObserved:false,templateLinked:false,codeEvidence:'supplier-hub',supplierHub:{trail:[{categoryId:'990000',name:schemaPath[0],isLeaf:false}],ownerId:'owner',company:{...company}}};
  const fork=h.load('app/api/category-profiles/[id]/refresh-definition/route.ts');
  const route=(path,init)=>{
   const request=new Request('https://app.test'+path,init);
   if(path.split('?')[0]==='/api/category-profiles')return api[init?.method??'GET'](request);
   assert.equal(path,`/api/category-profiles/${profile.id}/refresh-definition`);assert.equal(init.method,'POST');
   return fork.POST(request,{params:Promise.resolve({id:profile.id})});
  };
  const directFork=key=>route(`/api/category-profiles/${profile.id}/refresh-definition`,{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':key},body:JSON.stringify({expectedRevision:profile.revision,hubSchema:current})});
  const picker=request=>categoryPickerUI(request??route,{catalog:{loadLiveHubCategorySchema:async()=>plain(current)}});
  return{h,api,profile,current,choice,route,directFork,picker};
 }catch(error){h.close();throw error;}
}

for(const company of schemaCompanies){
 test(`Picker replaces the queued category only after the actual fork ACK (${company.code})`,async()=>{
  const f=await setup(company);try{
   const before=savedRows(f.h),release=deferred();let committed;
   const ui=f.picker(async(path,init)=>{const response=await f.route(path,init);if(init?.method==='POST'){committed=await json(response.clone(),201);await release.promise;}return response;});
   const queued={id:'queued-original',url:f.h.sourceUrl,profileId:f.profile.id,features:'원래 설명',keywords:'원래 검색어'},original=plain(queued);
   const append=ui.selected.push.bind(ui.selected);ui.selected.push=profile=>{queued.profileId=profile.id;return append(profile);};
   start(ui,f.choice);await waitFor(()=>Boolean(committed)||!pending(ui));assert.ok(committed,ui.alerts().join(' '));
   assert.equal(ui.selected.length,0);assert.deepEqual(queued,original);assert.ok(pending(ui));
   assert.equal(f.h.sqlite.prepare('SELECT revision FROM category_profiles WHERE id=?').get(f.profile.id).revision,f.profile.revision);
   release.resolve();await waitFor(()=>!pending(ui));
   assert.equal(ui.selected.length,1);assert.equal(ui.selected[0].id,committed.profile.id);assert.notEqual(queued.profileId,original.profileId);
   assert.deepEqual({...queued,profileId:original.profileId},original,'URL and manual intake text survive the verified category replacement');
   assert.deepEqual(ui.selected[0].hubSchema,plain(f.current));
   assert.deepEqual(ui.selected[0].mappings,f.profile.mappings);assert.equal(ui.selected[0].template.sha256,f.profile.template.sha256);
   assert.equal(ui.selected[0].template.storageKey,f.profile.template.storageKey);assert.deepEqual(ui.selected[0].template.workbookFields,f.profile.template.workbookFields);
   assert.notEqual(ui.selected[0].template.workbookEvidence.sourceSchemaSha256,f.profile.template.workbookEvidence.sourceSchemaSha256);
   const rows=f.h.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').all(f.profile.id);assert.ok(before.includes(JSON.stringify(rows[0])));
   assert.deepEqual(ui.calls.map(call=>call.method),['GET','POST']);assert.equal(f.h.sqlite.prepare('SELECT count(*) count FROM products').get().count,0);assert.deepEqual(f.h.network,[]);ui.close();
  }finally{f.h.close();}
 });

 test(`Picker rejects a real server mapping conflict and a forged successful ACK (${company.code})`,async()=>{
  const f=await setup(company);try{
   const before=savedRows(f.h),raw=JSON.parse(f.current.schemaString);raw.properties.productPage.properties.basicAttributes.properties.modelNumber.type='integer';
   f.current.schemaString=JSON.stringify(raw);
   const rejected=f.picker();await rejected.chooseLive(f.choice);
   assert.equal(rejected.selected.length,0);assert.match(rejected.alerts().join(' '),/같은 입력 경로·형식/);assert.equal(savedRows(f.h),before);rejected.close();
   raw.properties.productPage.properties.basicAttributes.properties.modelNumber.type='string';f.current.schemaString=JSON.stringify(raw);
   const forged=f.picker(async(path,init)=>{const response=await f.route(path,init);if(init?.method!=='POST')return response;const body=await json(response,201);body.profile.template.storageKey='owner/category-templates/forged.xlsx';return Response.json(body,{status:201});});
   await forged.chooseLive(f.choice);assert.equal(forged.selected.length,0);assert.match(forged.alerts().join(' '),/원본·매핑·저장 결과/);
   assert.equal(f.h.sqlite.prepare('SELECT count(*) count FROM category_profiles').get().count,2,'a forged delivery cannot undo the valid server fork, but must never select it');
   const original=f.h.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(f.profile.id);assert.ok(before.includes(JSON.stringify(original)));assert.equal(f.h.sqlite.prepare('SELECT count(*) count FROM products').get().count,0);assert.deepEqual(f.h.network,[]);forged.close();
  }finally{f.h.close();}
 });

 test(`Picker closing aborts selection even when a valid committed fork reply arrives late (${company.code})`,async()=>{
  const f=await setup(company);try{
   const release=deferred(),delivered=deferred();let signal;
   const ui=f.picker(async(path,init)=>{const response=await f.route(path,init);if(init?.method==='POST'){assert.equal(response.status,201);signal=init.signal;await release.promise;delivered.resolve();}return response;});
   start(ui,f.choice);await waitFor(()=>Boolean(signal)||!pending(ui));assert.ok(signal,ui.alerts().join(' '));assert.equal(ui.selected.length,0);ui.close();assert.equal(signal.aborted,true);
   release.resolve();await delivered.promise;await new Promise(resolve=>setTimeout(resolve,10));
   assert.equal(ui.selected.length,0,'the late valid result never replaces the original category');assert.equal(f.h.sqlite.prepare('SELECT count(*) count FROM category_profiles').get().count,2);
   assert.deepEqual(f.h.network,[]);assert.equal(f.h.sqlite.prepare('SELECT count(*) count FROM products').get().count,0);
  }finally{f.h.close();}
 });

 test(`Picker chooses one exact live definition among saved revisions and stops on multiple exact matches (${company.code})`,async()=>{
  const f=await setup(company);try{
   const {profile:newProfile}=await json(await f.directFork(randomUUID()),201),before=savedRows(f.h),ui=f.picker();
   await ui.chooseLive(f.choice);assert.equal(ui.selected.length,1);assert.equal(ui.selected[0].id,newProfile.id);assert.deepEqual(ui.calls.map(call=>call.method),['GET']);assert.equal(savedRows(f.h),before);ui.close();
   const {profile:duplicate}=await json(await f.directFork(randomUUID()),201);assert.notEqual(duplicate.id,newProfile.id);
   const after=savedRows(f.h),ambiguous=f.picker();await ambiguous.chooseLive(f.choice);
   assert.equal(ambiguous.selected.length,0);assert.match(ambiguous.alerts().join(' '),/여러 개/);assert.deepEqual(ambiguous.calls.map(call=>call.method),['GET']);assert.equal(savedRows(f.h),after);assert.deepEqual(f.h.network,[]);ambiguous.close();
  }finally{f.h.close();}
 });
}
