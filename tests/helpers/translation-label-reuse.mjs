import {collectionSingleNewDraftFixture,forkCompanies,json,plain} from './collection-single-new-draft.mjs';
export {forkCompanies as companies,json,plain};
export async function translationLabelReuseFixture(company=forkCompanies[0]){
 const f=await collectionSingleNewDraftFixture(company),{api:h}=f;
 h.sqlite.prepare('UPDATE members SET email=?,role=? WHERE id=?').run(company.code==='A01526306'?'jwhj1116@kakao.com':'unari8484@gmail.com',company.code==='A01526306'?'admin':'member','owner');
 const stored=h.sqlite.prepare('SELECT payload FROM collection_results WHERE job_id=?').get(f.oldJobId),receipt=JSON.parse(stored.payload);receipt.attributes=[{name:'材质',value:'硅胶'},{name:'用途',value:'运动'}];h.sqlite.prepare('UPDATE collection_results SET payload=? WHERE job_id=?').run(JSON.stringify(receipt),f.oldJobId);
 let aiCalls=0;h.bindings.AI.run=async(_model,input)=>{aiCalls++;const source=JSON.parse(input.messages[1].content);return{response:{title:'합성 번역 상품',description:'합성 상품 설명',keywords:['합성'],warnings:[],attributes:source.attributes.map((pair,sourceIndex)=>({sourceIndex,name:pair.name.replaceAll('材质','재질').replaceAll('用途','용도'),value:pair.value==='硅胶'?'실리콘':pair.value==='运动'?'운동용':pair.value}))}};};
 const protectedOriginal=f.originalSnapshot(),created=await f.create(await f.preview());await h.intake(created.job.id);const id=created.productId,base='/api/products/'+id,jobs=await h.load('db/translation-jobs.ts').listTranslationJobs('owner',id),job=jobs.find(job=>job.status==='completed'&&job.result?.draft.attributes.some(attribute=>attribute.name.includes('용도')));
 if(!job)throw Error('Completed synthetic attribute translation is absent');const requests=[],endpoint=base+'/translation-labels?'+new URLSearchParams({jobId:job.id,profileId:f.target.id});
 const route=async(url=endpoint,options={})=>{const response=await h.route(url,options);requests.push({url,method:options.method??'GET',status:response.status});return response;};
 const read=()=>route().then(json),apply=(view,mappings)=>route(endpoint,{method:'POST',body:{expectedProductVersion:view.productVersion,expectedContentRevision:view.contentRevision,expectedInputFingerprint:view.inputFingerprint,mappings}});
 const productState=()=>JSON.stringify(['products','product_content','product_options','product_quotation_fields','product_price_policy','product_labels','translation_jobs','collection_products'].map(table=>[table,h.sqlite.prepare(`SELECT * FROM ${table} WHERE ${table==='products'?'id':'product_id'}=? ORDER BY rowid`).all(id)]));
 return{...f,h,id,base,job,endpoint,requests,read,apply,route,productState,protectedOriginal,get aiCalls(){return aiCalls;}};
}
