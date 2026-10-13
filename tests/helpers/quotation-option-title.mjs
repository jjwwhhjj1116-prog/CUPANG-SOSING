import fs from 'node:fs';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './mobile-intake.mjs';

export const titleCompanies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const profileFile=new URL('../../outputs/step604-unand-profile-read.json',import.meta.url),originalFile=new URL('../../outputs/step603-official-unand-2624.xlsx',import.meta.url);
export const originalTitleEvidenceAvailable=fs.existsSync(profileFile)&&fs.existsSync(originalFile);
export const plain=value=>JSON.parse(JSON.stringify(value));
export const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
export async function originalTitleFixture(company=titleCompanies[0]){
 const saved=JSON.parse(JSON.parse(fs.readFileSync(profileFile,'utf8'))[0].results[0].payload),hubSchema=structuredClone(saved.hubSchema);
 assert.deepEqual(hubSchema.company,{code:'A01526306',name:'유앤채'});hubSchema.company={...company};
 // Unand is the captured Single69900/original2624 pair. Waihop reuses that
 // recorded contract in a separate synthetic account, never a live capture.
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name}),bytes=new Uint8Array(fs.readFileSync(originalFile)),form=new FormData();
 form.set('file',new File([bytes],'original-Unand.xlsx'));form.set('schema',JSON.stringify(hubSchema));form.set('action','workbook');
 const linked=await json(await h.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test/api/category-profiles/official-template',{method:'POST',body:form})),201);
 const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'LOCAL OPTION TITLE CONTRACT',categoryId:saved.categoryId,categoryPath:saved.categoryPath,hubSchema,template:linked.template,mappings:linked.mappings},'cat');
 h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));h.sqlite.prepare("UPDATE collection_jobs SET goal='work'").run();await h.intake();
 const product=()=>h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product().id,endpoint=base+'/quotation-fields';
 assert.equal(profile.mappings.find(mapping=>mapping.field==='title').column,2);assert.equal(profile.template.dataStartRow,9);
 const view=()=>h.route(endpoint).then(json),content=()=>h.route(base+'/content').then(json),options=()=>h.route(base+'/options').then(json);
 const save=async changes=>{const before=await view();return json(await h.route(endpoint,{method:'PUT',body:{expectedRevision:before.revision,expectedInputFingerprint:before.inputFingerprint,changes}}));};
 const editContent=async patch=>{const before=await content();return json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:before.content.revision,patch}}));};
 const editOptions=async amend=>{const before=await options(),rows=h.load('app/product-options.ts').optionInputs(before.options);amend(rows);return json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:before.options.revision,expectedProductVersion:product().updated_at,rows}}));};
 const output=async()=>{const fields=await view(),preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}})),response=await h.route(base+'/quotation',{method:'POST',body:{action:'download',fingerprint:preview.fingerprint}});assert.equal(response.status,200,await response.clone().text());const reader=h.load('app/xlsx-template.ts'),book=reader.inspectXlsxArchive(await reader.readXlsxArchive(await response.arrayBuffer())),included=fields.resolved.rows.filter(row=>row.included);return{fields,preview,included,titles:included.map((_,index)=>reader.xlsxHeaders(book,profile.template.sheetName,9+index)[2])};};
 const stable=()=>JSON.stringify({raw:h.sqlite.prepare('SELECT * FROM collection_results').all(),context:h.sqlite.prepare('SELECT * FROM collection_context').all(),profiles:h.sqlite.prepare('SELECT * FROM category_profiles').all(),policy:product().pricing_policy,prices:[product().supply_price,product().sale_price,product().msrp],images:product().image_keys,objects:[...h.objects].map(([key,value])=>[key,Buffer.from(value).toString('base64')])});
 return{h,company,profile,bytes,product,base,endpoint,view,content,options,save,editContent,editOptions,output,stable,close(){h.close();}};
}
