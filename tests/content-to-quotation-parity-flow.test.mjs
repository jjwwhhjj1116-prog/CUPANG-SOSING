import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assetApiFixture,assetSnapshot,companies,plain} from './helpers/supplier-hub-single-assets.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {unzip} from './helpers/image-download-ui.mjs';
import {SINGLE_DOCUMENT_LIVE_VERIFIED} from '../extensions/supplier-hub/single-dispatch.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const title='사용자 검토 상품 & 이미지',description='직접 검토한 설명 <보존>\n두 번째 줄',tags='검토 검색어, 두번째 검색어';
const tables=['products','product_content','product_options','product_quotation_fields','product_price_policy','workspace_settings','collection_jobs','collection_context','collection_results','collection_products','category_profiles','supplier_hub_receipts','supplier_hub_single_receipts'];

/** Starts after intake: existing helpers seed a synthetic product/options and
 * local image bytes; the linked source context and initial description-link
 * flag are fixture state, not a claim that collection/import POST ran here.
 * All user edits, category workbook exports and Single preparation below use
 * actual handlers/SQLite/R2. No collector, provider, browser or Hub is called. */
async function fixture(company){
 const snapshot=assetSnapshot(company),raw=JSON.parse(snapshot.schemaString);
 raw.properties.productPage.properties.searchTags={type:'string',title:'검색태그',maxLength:150};
 raw.properties.imagePage.properties.details.properties.altText={type:'string',title:'대체 텍스트'};
 snapshot.schemaString=JSON.stringify(raw);
 const f=await assetApiFixture(company,snapshot);
 try{
  const {h}=f,requests=[],request=async(path,options={})=>{requests.push({path,method:options.method??'GET',body:options.body});return h.route(path,options);};
  let view=await json(await request(f.base+'/quotation-fields'+f.query));
  const fields=['skuId','categoryId',...view.resolved.schema.fields.map(field=>field.id)],workbook=quotationWorkbook(fields),sha256=sha(workbook);
  const storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
  const profile=await h.load('db/category-profiles.ts').updateCategoryProfile('owner',f.profile.id,f.profile.revision,{...f.profile,
   template:{name:'synthetic-content-flow.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},
   mappings:fields.map((field,column)=>({field,column,required:field==='title'}))});assert.ok(profile);
  // Inert URL identifiers only; no fetch or source handler is invoked.
  const offerId='630000720001',sourceUrl='https://detail.1688.com/offer/'+offerId+'.html';
  h.sqlite.prepare('UPDATE products SET source_url=? WHERE id=?').run(sourceUrl,f.id);
  h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=? WHERE id=?').run(offerId,sourceUrl,'job');
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
  h.sqlite.prepare('INSERT INTO collection_products VALUES(?,?,?,?)').run('job','owner',f.id,new Date().toISOString());
  const row=h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(f.id),startingContent=JSON.parse(row.payload);
  startingContent.detailDescriptionLinked=true;h.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(startingContent),f.id);
  view=await json(await request(f.base+'/quotation-fields'+f.query));const html=f.byWire(['imagePage','details','htmlProductDetailContent']);assert.ok(html);
  // The shared asset helper intentionally seeds a manual HTML blank. Remove
  // only that fixture override to exercise the initial linked-description path.
  view=await json(await request(f.base+'/quotation-fields'+f.query,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:html,optionId:null,value:null}]}}));
  assert.equal(Object.hasOwn(view.overrides.common,html),false,'unset HTML uses the linked content source');
  const sourceTables=['collection_jobs','collection_context','collection_results','collection_products','product_options','category_profiles'];
  const sourceSnapshot=()=>JSON.stringify(sourceTables.map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table).all()])),beforeSources=sourceSnapshot();
  const originalFiles=new Map([...h.objects].map(([key,bytes])=>[key,sha(bytes)]));
  const seo=await json(await request(f.base+'/seo-workspace'));
  const saved=await json(await request(f.base+'/seo-workspace',{method:'PATCH',body:{expectedProductVersion:seo.productVersion,expectedContentRevision:seo.content.revision,expectedOptionRevision:seo.options.revision,
   seo:{title,description,keywordText:tags}}}));
  assert.deepEqual(Array.from(saved.content.seo.keywords.value),['검토 검색어','두번째 검색어']);
  let content=(await json(await request(f.base+'/content'))).content;
  content=(await json(await request(f.base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,
   patch:{assets:{main:[f.keys[2]],additional:[f.keys[1],f.keys[0]],detailTop:[f.keys[3]],detail:[f.keys[5],f.keys[4]],detailBottom:[],label:[f.keys[6]]}}
  }}))).content;
  assert.equal(content.detailDescriptionLinked,true);assert.deepEqual(plain(content.seo),plain(saved.content.seo),'image-only save retains the manual SEO fields and link');
  return {...f,request,requests,fields,profile,sourceSnapshot,beforeSources,originalFiles,storageKey,html,
   dbSnapshot:()=>JSON.stringify(tables.map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table).all()]))};
 }catch(error){f.close();throw error;}
}

for(const company of companies)for(const phase of ['selected','cleared'])test(`${company.code}: saved manual SEO and ${phase} image/label selections match current XLSX and Single review`,async()=>{
 const f=await fixture(company);try{
  const {h,request}=f,cleared=phase==='cleared';
  if(cleared){
   const seo=await json(await request(f.base+'/seo-workspace'));
   // The direct keyword-array API has an explicit empty-list contract. The
   // current UI keywordText service's empty-cleaned-list retains old document
   // tags by the separately tested Step663 policy; do not conflate the branches.
   await json(await request(f.base+'/seo-workspace',{method:'PATCH',body:{expectedProductVersion:seo.productVersion,expectedContentRevision:seo.content.revision,expectedOptionRevision:seo.options.revision,seo:{title:'',description:'',keywords:[]}}}));
   const content=(await json(await request(f.base+'/content'))).content;
   await json(await request(f.base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{assets:{main:[],additional:[],label:[]}}}}));
  }
  const expectedTitle=cleared?'':title,expectedTags=cleared?'':tags,detailKeys=[f.keys[3],f.keys[5],f.keys[4]],at=id=>f.fields.indexOf(id);
  const storedContent=(await json(await request(f.base+'/content'))).content;
  assert.equal(storedContent.seo.title.provenance,'manual');assert.equal(storedContent.seo.description.provenance,'manual');
  assert.equal(storedContent.seo.title.value,expectedTitle);assert.equal(storedContent.seo.description.value,cleared?'':description);
  assert.equal(storedContent.detailDescriptionLinked,true);assert.equal(f.sourceSnapshot(),f.beforeSources);
  const before=f.dbSnapshot(),view=await json(await request(f.base+'/quotation-fields'+f.query)),included=view.resolved.rows.filter(row=>row.included);
  assert.deepEqual(included.map(row=>row.optionId),['synthetic-one','synthetic-two']);assert.equal(view.resolved.rows.find(row=>row.optionId==='synthetic-excluded').included,false);
  assert.equal(Object.hasOwn(view.overrides.common,f.html),false,'no manual HTML masks the linked SEO description');
  for(const row of included){assert.equal(row.fields.title.value,expectedTitle);assert.equal(row.fields.searchTags.value,expectedTags);assert.equal(row.fields.mainImage.value,cleared?'':f.keys[2]);assert.equal(row.fields.labelImages.value,cleared?'':f.keys[6]);assert.equal(row.fields.detailImages.value,detailKeys.join('\n'));}
  const preview=await json(await request(f.base+'/quotation',{method:'POST',body:{action:'preview',profileId:f.profile.id}}));
  assert.deepEqual(plain(preview.report.company),company);assert.equal(preview.report.rowCount,2);assert.equal(preview.report.submissionReady,false);
  for(const row of preview.rows){assert.equal(row[at('title')],expectedTitle);assert.equal(row[at('searchTags')],expectedTags);
   if(cleared)assert.ok(!row[at('detailHtml')].includes('직접 검토한 설명'));else assert.ok(row[at('detailHtml')].includes('직접 검토한 설명 &lt;보존&gt;<br>두 번째 줄'));
  }
  if(cleared)assert.deepEqual(preview.report.missingRequired.filter(item=>item.column===at('title')+1).map(item=>item.row),[2,3]);
  const exported=await request(f.base+'/quotation',{method:'POST',body:{action:'export',profileId:f.profile.id,fingerprint:preview.fingerprint}});assert.equal(exported.status,200,await exported.clone().text());
  const archive=unzip(await exported.arrayBuffer()),plan=JSON.parse(archive.get('supplier-hub-upload-plan.json')),document=JSON.parse(archive.get('quotation-fields.json'));
  const reader=h.load('app/xlsx-template.ts'),book=reader.inspectXlsxArchive(await reader.readXlsxArchive(archive.get(plan.quotation.file.filename)));
  const planImages=[...plan.productImages,...plan.labelImages];
  for(let index=0;index<2;index++){
   const row=reader.xlsxHeaders(book,'견적서',index+2);assert.equal(row[at('title')],expectedTitle);assert.equal(row[at('searchTags')],expectedTags);
   assert.equal(row[at('detailHtml')],String(preview.rows[index][at('detailHtml')]));assert.equal(row[at('mainImage')],cleared?'':document.uploadFilenames[f.keys[2]]);
   assert.equal(row[at('labelImages')],cleared?'':document.uploadFilenames[f.keys[6]]);assert.equal(row[at('additionalImages')],cleared?'':[f.keys[1],f.keys[0]].map(key=>document.uploadFilenames[key]).join('\n'));
   assert.equal(row[at('detailImages')],detailKeys.map(key=>document.uploadFilenames[key]).join('\n'));
   // Follow the actual XLSX filename through the plan and physical ZIP entry
   // to the immutable source bytes; two independently wrong output maps must
   // not satisfy the filename and byte assertions separately.
   for(const[fieldId,keys]of [['mainImage',cleared?[]:[f.keys[2]]],['labelImages',cleared?[]:[f.keys[6]]],['additionalImages',cleared?[]:[f.keys[1],f.keys[0]]],['detailImages',detailKeys]]){
    const filenames=String(row[at(fieldId)]).split('\n').filter(Boolean);assert.equal(filenames.length,keys.length,fieldId);
    for(const[position,key]of keys.entries()){
     const filename=filenames[position],archivePath='assets/'+filename,item=planImages.find(image=>image.key===key);
     assert.equal(filename,document.uploadFilenames[key]);assert.equal(document.assets[key],archivePath);assert.ok(item,key);
     assert.equal(item.filename,filename);assert.equal(item.archivePath,archivePath);assert.equal(item.sha256,f.originalFiles.get(key));
     assert.ok(item.references.some(reference=>reference.optionId===included[index].optionId&&reference.fieldId===fieldId&&reference.position===position+1),key+' reference');
     assert.equal(sha(archive.get(archivePath)),f.originalFiles.get(key),fieldId+' XLSX filename resolves to selected source bytes');
    }
   }
  }
  const selectedKeys=cleared?detailKeys:[f.keys[2],f.keys[6],f.keys[1],f.keys[0],...detailKeys];
  for(const key of selectedKeys)assert.equal(sha(archive.get(document.assets[key])),sha(h.objects.get(key)),key);
  assert.equal(document.rows.length,2);assert.ok(!plan.productImages.some(image=>image.key===f.keys[7]));
  const candidate=await json(await request(f.endpoint));assert.equal(candidate.inputFingerprint,view.inputFingerprint);assert.equal(candidate.options.length,2);
  if(cleared){assert.equal(candidate.review.canPrepare,false);assert.ok(candidate.review.issues.some(issue=>issue.code==='TYPE_OR_CONSTRAINT'&&issue.fieldId==='title'));}
  else assert.equal(candidate.review.canPrepare,true,JSON.stringify(candidate.review.issues.filter(issue=>issue.level==='error')));
  const prepared=cleared?candidate:await json(await request(f.endpoint,{method:'POST',body:{action:'prepare',expectedFingerprint:candidate.fingerprint}}));
  assert.deepEqual(plain(prepared.company),company);assert.equal(prepared.fingerprint,candidate.fingerprint);
  assert.equal(prepared.inputFingerprint,view.inputFingerprint);assert.equal(prepared.prepared,!cleared);assert.equal(prepared.registered,false);assert.equal(prepared.remoteWrites,false);
  for(const[index,row]of prepared.payload.jsonDocument.entries()){
   assert.equal(row.startPage.productName,expectedTitle);assert.equal(row.productPage.searchTags,expectedTags);
   assert.equal(row.imagePage.details.htmlProductDetailContent,cleared?'':'<p>직접 검토한 설명 &lt;보존&gt;<br>두 번째 줄</p>');
   assert.equal(row.imagePage.images.mainImage==='',cleared);assert.equal(row.imagePage.images.labelImages[0].labelImageFiles==='',cleared);
   if(!cleared)for(const[role,keys,value]of [['main',[f.keys[2]],row.imagePage.images.mainImage],['label',[f.keys[6]],row.imagePage.images.labelImages[0].labelImageFiles],['additional',[f.keys[1],f.keys[0]],row.imagePage.images.additionalImage],['detail',detailKeys,row.imagePage.details.detailedImage]]){
    const item=prepared.manifest.find(item=>item.optionId===prepared.options[index].optionId&&item.role===role);assert.ok(item,role);assert.deepEqual(item.files.map(file=>file.key),keys);
    assert.equal(value,item.files.map(file=>file.url).join(','));for(const file of item.files)assert.equal(file.sha256,sha(h.objects.get(file.key)));
   }
  }
  assert.ok(prepared.manifest.filter(item=>item.role==='detail').every(item=>JSON.stringify(item.files.map(file=>file.key))===JSON.stringify(detailKeys)));
  assert.ok(!prepared.manifest.some(item=>item.optionId==='synthetic-excluded'||item.files.some(file=>file.key===f.keys[7])));
  assert.deepEqual(prepared.excludedOptions.map(row=>row.optionId),['synthetic-excluded']);
  assert.equal(f.requests.filter(request=>request.path===f.endpoint&&request.method==='POST').length,cleared?0:1);
  assert.equal(f.dbSnapshot(),before,'final review/export/preparation do not rewrite saved product, content, source, option, company or quotation state');
  assert.equal(f.sourceSnapshot(),f.beforeSources);for(const[key,digest]of f.originalFiles)assert.equal(sha(h.objects.get(key)),digest,key);
  assert.equal(sha(h.objects.get(f.storageKey)),f.profile.template.sha256);assert.deepEqual(h.network,[]);assert.equal(h.aiSources.length,0);assert.equal(SINGLE_DOCUMENT_LIVE_VERIFIED,false);
 }finally{f.close();}
});
