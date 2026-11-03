import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {loadComposite} from './helpers/detail-image-composite.mjs';

const companies=[{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}];
const plain=value=>JSON.parse(JSON.stringify(value));
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};

/** The actual intake handlers store only synthetic image bytes in memory. */
async function collectedDetailFixture(company,count=31,{assignToStage=false}={}){
 const urls=Array.from({length:count+1},(_,index)=>`https://cbu01.alicdn.com/synthetic-stage5-${index}.png`);
 const bytes=await Promise.all(urls.map((_,index)=>sharp({create:{width:800,height:1,channels:4,background:{r:index,g:50,b:100,alpha:1}}}).png().toBuffer()));
 const h=mobileIntakeHarness({...company,fixtureImageUrls:urls,fixtureImageBytes:bytes});
 try{
  const now=new Date().toISOString(),email=company.companyCode==='A01526306'?'jwhj1116@kakao.com':'unari8484@gmail.com';
  h.sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at,reviewed_by) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .run('owner',email,'fixture-not-a-password',company.companyCode==='A01526306'?'admin':'member','approved',company.companyCode,company.companyName,now,now,null);
  const fields=h.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field=>field.id),workbook=quotationWorkbook(fields),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'Synthetic raw-detail capacity',categoryId:'80719',categoryPath:h.context.category.categoryPath,
   template:{name:'synthetic-detail-capacity.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  const png=bytes[0];
  const top='owner/synthetic-top.png',bottom='owner/synthetic-bottom.png';h.objects.set(top,png);h.objects.set(bottom,png);
  Object.assign(h.context.settings,{topImageEnabled:true,topImageKey:top,bottomImageEnabled:true,bottomImageKey:bottom});h.context.category=profile;
  h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
  const get=h.bindings.FILES.get;h.bindings.FILES.get=async key=>{const object=await get(key);return object?{...object,body:new ReadableStream({start(controller){controller.enqueue(h.objects.get(key).slice());controller.close();}})}:null;};
  const put=h.bindings.FILES.put;h.bindings.FILES.put=async(key,value,options)=>{const result=await put(key,value,options);return result===null?null:h.bindings.FILES.head(key);};
  const receipt={schemaVersion:1,sourceUrl:h.sourceUrl,provider:'synthetic-stage5-source',collectedAt:new Date().toISOString(),title:'합성 상세 원본 검수',description:'원본 순서 보존 fixture',
   options:[{sku:'synthetic-sku',name:'검정',unitPriceCny:10,minimumOrder:1,stock:10,imageIndex:0}],images:urls.map((url,index)=>({url,role:index?'detail':'main'}))};
  await json(await h.route('/api/collection-jobs/job/result',{method:'POST',body:receipt}));
  const imported=await h.load('app/collection-import.ts').runCollectionImport('job',receipt.images.length,{assignToStage,...(!assignToStage?{imageBatchSize:3}:{}),
   fetcher:(url,init={})=>h.route(url,{method:init.method??'GET',body:init.body})});
  assert.equal(imported.status,'completed',imported.error);assert.equal(imported.completedImages,count+1);
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  const links=h.sqlite.prepare('SELECT image_index,object_key FROM collection_images WHERE product_id=? ORDER BY image_index').all(product.id);
  const bodyKeys=links.filter(row=>row.image_index>0).map(row=>row.object_key),pool=JSON.parse(product.image_keys);
  assert.equal(bodyKeys.length,count);assert.ok(bodyKeys.every(key=>pool.includes(key)&&h.objects.has(key)));assert.equal(new Set(bodyKeys).size,count);
  const content=(await json(await h.route(base+'/content'))).content;
  if(!assignToStage){assert.equal(content.assets.detail.provenance,'unverified');assert.deepEqual(content.assets.detail.value,[]);}
  const fetcher=(url,init={})=>{
   if(url==='/api/files')return h.load('app/api/files/route.ts')[init.method??'GET'](new Request('https://app.test'+url,init));
   if(url.startsWith('/api/files/'))return h.load('app/api/files/[...key]/route.ts').GET(new Request('https://app.test'+url,init),{params:Promise.resolve({key:url.slice('/api/files/'.length).split('/').map(decodeURIComponent)})});
   return h.route(url,{method:init.method??'GET',body:init.body});
  };
  return {h,base,product,bodyKeys,top,bottom,fetcher,imported,content};
 }catch(cause){h.close();throw cause;}
}

for(const company of companies)test(`${company.companyCode} work-draft preserves all 31 attached raw BODY photos through the actual workspace API`,async()=>{
 const f=await collectedDetailFixture(company);const {h}=f;
 try{
  const prepared=await json(await h.route(f.base+'/work-draft',{method:'POST',body:{expectedVersion:f.product.updated_at,roles:['detail']}}));
  assert.equal(prepared.prepared,true);assert.equal(prepared.changedRoles,1);
  const view=await json(await h.route(f.base+'/quotation-fields?profileId=cat')),optionId=view.resolved.rows.find(row=>row.optionId)?.optionId;
  const reply=await json(await h.route(f.base+`/detail-workspace?profileId=cat&optionId=${optionId}`));
  assert.equal(reply.workspace,null);assert.equal(view.resolved.schema.fields.find(field=>field.id==='detailImages').maxItems,30,'the final quotation attachment cap stays 30');
  const client=h.load('app/detail-workspace-client.ts'),document=h.load('app/detail-workspace-seed.ts').initialDetailWorkspaceDocument(reply,optionId);
  const input=await client.createDetailWorkspaceSave({productId:f.product.id,optionId,profileId:'cat',view},reply,document);
  const saved=await client.saveDetailWorkspace(input,{},new AbortController().signal,f.fetcher);
  const body=saved.workspace.document.photos.filter(photo=>photo.role==='body');
  assert.equal(body.length,f.bodyKeys.length,'all 31 captured and attached BODY photos must survive the actual workspace save');
  assert.deepEqual(plain(body.map(photo=>photo.originKey)),f.bodyKeys,'an imported raw BODY must not silently disappear before Vision or composition');
  assert.deepEqual(plain(saved.workspace.document.photos.map(photo=>photo.key)),[f.top,...f.bodyKeys,f.bottom]);
  assert.equal(h.stats.downloads,32);assert.equal(h.aiSources.length,0);
 }finally{h.close();}
});

test('serial collection image API assigns the 31st raw detail without a missing-assignment warning',async()=>{
 const f=await collectedDetailFixture(companies[0],31,{assignToStage:true});
 try{
  assert.deepEqual(f.content.assets.detail.value,f.bodyKeys);assert.equal(f.content.assets.detail.provenance,'collected');
  assert.deepEqual(plain(f.imported.warnings??[]),[]);
  assert.equal(f.content.assets.main.value.length,1);assert.equal(f.h.stats.downloads,32);
 }finally{f.h.close();}
});

test('31 saved raw BODY photos compose and commit as one final quotation attachment with their originals retained',async()=>{
 const f=await collectedDetailFixture(companies[0]);const {h}=f;
 try{
  await json(await h.route(f.base+'/work-draft',{method:'POST',body:{expectedVersion:f.product.updated_at,roles:['detail']}}));
  const view=await json(await h.route(f.base+'/quotation-fields?profileId=cat')),optionId=view.resolved.rows.find(row=>row.optionId)?.optionId;
  const reply=await json(await h.route(f.base+`/detail-workspace?profileId=cat&optionId=${optionId}`)),client=h.load('app/detail-workspace-client.ts');
  const selection={productId:f.product.id,optionId,profileId:'cat',view},document=h.load('app/detail-workspace-seed.ts').initialDetailWorkspaceDocument(reply,optionId);
  const saved=await client.saveDetailWorkspace(await client.createDetailWorkspaceSave(selection,reply,document),{},new AbortController().signal,f.fetcher);
  const runtime=loadComposite({request:f.fetcher}),composite=runtime.load('app/detail-workspace-composite-client.ts'),signal=new AbortController().signal;
  const prepared=await composite.prepareDetailWorkspaceComposite(selection,saved,signal,f.fetcher),attempt={};
  assert.equal(prepared.sources.length,33);assert.equal(prepared.height,33);assert.equal(runtime.draws.length,33);
  const final=await composite.applyDetailWorkspaceComposite(prepared,attempt,signal,f.fetcher);
  for(const row of final.resolved.rows){assert.equal(row.fields.detailImages.value,attempt.key);assert.equal(row.fields.detailHtml.value,'');}
  assert.equal(final.resolved.schema.fields.find(field=>field.id==='detailImages').maxItems,30);
  assert.ok(f.bodyKeys.every(key=>final.imageKeys.includes(key)&&h.objects.has(key)));
  const retained=await json(await h.route(f.base+`/detail-workspace?profileId=cat&optionId=${optionId}`));
  assert.deepEqual(retained.workspace.document.photos.filter(photo=>photo.role==='body').map(photo=>photo.originKey),f.bodyKeys);
  assert.equal(h.stats.downloads,32);assert.equal(h.aiSources.length,0);
 }finally{h.close();}
});

test('raw detail capacity retains existing owner, duplicate, role, manual and pool boundaries',async()=>{
 const f=await collectedDetailFixture(companies[0]);const {h}=f;
 try{
  const model=h.load('app/product-content.ts'),draft=h.load('app/collection-image-draft.ts').collectedImageDraft;
  const links=h.sqlite.prepare('SELECT image_index AS imageIndex,object_key AS key FROM collection_images ORDER BY image_index').all();
  const receipt=JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload),options=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload),pool=JSON.parse(f.product.image_keys),now=new Date().toISOString();
  for(const [provenance,value] of [['manual',[]],['manual',f.bodyKeys.slice(0,2).reverse()],['generated',[f.bodyKeys[0]]],['translated',[f.bodyKeys[0]]]]){
   const content=structuredClone(f.content);content.assets.detail={provenance,value,updatedAt:now};
   const result=draft('owner',receipt,links,pool,content,options,now,new Map(),['detail']);
   assert.equal(result.changedRoles,0);assert.deepEqual(plain(result.content),content);
  }
  const crossRole=structuredClone(f.content);crossRole.assets.additional={value:[f.bodyKeys[0]],provenance:'manual',updatedAt:now};
  const crossed=draft('owner',receipt,links,pool,crossRole,options,now,new Map(),['detail']);
  assert.deepEqual(plain(crossed.content.assets.detail.value),f.bodyKeys.slice(1));assert.deepEqual(plain(crossed.content.assets.additional),crossRole.assets.additional);
  assert.throws(()=>draft('owner',receipt,[...links,links[0]],pool,f.content,options,now,new Map(),['detail']));
  assert.throws(()=>draft('owner',receipt,[{...links[0],key:'other/foreign.png'}],pool,f.content,options,now,new Map(),['detail']));
  const missing=structuredClone(f.content);missing.assets.detail={value:[f.bodyKeys.at(-1)],provenance:'collected',updatedAt:now};
  const incomplete=draft('owner',receipt,links,pool.filter(key=>key!==f.bodyKeys.at(-1)),missing,options,now,new Map(),['detail']);
  assert.equal(incomplete.changedRoles,0,'a missing saved source does not authorize replacing that role with a successful partial draft');
  assert.deepEqual(plain(incomplete.content.assets.detail),missing.assets.detail);
  const keys=Array.from({length:151},(_,index)=>`owner/boundary-${index}.png`),input=values=>({expectedRevision:0,patch:{assets:values}});
  const full=model.validateContentInput(input({detail:keys.slice(0,150)}),keys.slice(0,150),'owner');
  assert.equal(full.patch.assets.detail.length,150);
  assert.throws(()=>model.validateContentInput(input({detail:keys}),keys,'owner'));
  for(const role of ['additional','label','size'])assert.throws(()=>model.validateContentInput(input({[role]:keys.slice(0,31)}),keys,'owner'));
  for(const role of ['main','detailTop','detailBottom'])assert.throws(()=>model.validateContentInput(input({[role]:keys.slice(0,2)}),keys,'owner'));
  assert.throws(()=>model.validateContentInput(input({detail:['other/foreign.png']}),keys,'owner'));
  const empty=model.emptyProductContent('product'),duplicate=model.validateContentInput(input({detail:[keys[0],keys[0]]}),keys,'owner');
  assert.throws(()=>model.applyContentPatch(empty,duplicate.patch,now));
  assert.throws(()=>model.applyContentPatch(empty,{assets:{detail:keys.slice(0,150),main:[keys[150]]}},now),'all raw roles still share the existing 150 pool bound');
  const beforeProduct=h.sqlite.prepare('SELECT * FROM products').get();
  const rejected=await h.load('app/api/products/[id]/route.ts').PATCH(new Request('https://app.test'+f.base,{method:'PATCH',headers:{'content-type':'application/json'},
   body:JSON.stringify({expectedVersion:beforeProduct.updated_at,image_keys:JSON.stringify(keys)})}),{params:Promise.resolve({id:f.product.id})});
  assert.equal(rejected.status,400,'the actual product-pool boundary rejects 151 before work-draft can consume it');
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM products').get(),beforeProduct);
  assert.throws(()=>h.load('app/collection-import.ts').collectionImageSelection(151),'the existing import selection bound is unchanged');
 }finally{h.close();}
});

test('a newly missing BODY file prevents the actual workspace save from acknowledging a partial source',async()=>{
 const f=await collectedDetailFixture(companies[1]);const {h}=f;
 try{
  await json(await h.route(f.base+'/work-draft',{method:'POST',body:{expectedVersion:f.product.updated_at,roles:['detail']}}));
  const view=await json(await h.route(f.base+'/quotation-fields?profileId=cat')),optionId=view.resolved.rows.find(row=>row.optionId)?.optionId;
  const reply=await json(await h.route(f.base+`/detail-workspace?profileId=cat&optionId=${optionId}`)),client=h.load('app/detail-workspace-client.ts');
  const selection={productId:f.product.id,optionId,profileId:'cat',view},document=h.load('app/detail-workspace-seed.ts').initialDetailWorkspaceDocument(reply,optionId);
  assert.equal(document.photos.filter(photo=>photo.role==='body').length,31);
  const input=await client.createDetailWorkspaceSave(selection,reply,document),attempt={};h.objects.delete(f.bodyKeys.at(-1));
  await assert.rejects(client.saveDetailWorkspace(input,attempt,new AbortController().signal,f.fetcher),/작업공간 사진과 원본의 저장 파일/u);
  assert.equal(attempt.pending,false);assert.equal(attempt.completed,undefined);
  assert.equal(h.sqlite.prepare('SELECT count(*) AS count FROM product_detail_workspaces').get().count,0);
 }finally{h.close();}
});

test('manual raw-detail role saves accept 31 originals independently of the 30 final quotation attachments',async()=>{
 const f=await collectedDetailFixture(companies[0]);
 try{
  const before=await json(await f.h.route(f.base+'/content'));
  const saved=await json(await f.h.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:before.content.revision,patch:{assets:{detail:f.bodyKeys}}}}));
  assert.deepEqual(saved.content.assets.detail.value,f.bodyKeys);assert.equal(saved.content.assets.detail.provenance,'manual');
 }finally{f.h.close();}
});
