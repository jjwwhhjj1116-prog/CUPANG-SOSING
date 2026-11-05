import {amendmentCopy as copy,amendmentDigest as digest} from '../../extensions/supplier-hub/native-draft-detail-amendment.mjs';

const hash='a'.repeat(64),company={code:'A01526306',name:'유앤채'},detailPath=['imagePage','details','detailedImage'];
const fields=[{id:'detailImages',type:'images',hubInput:'detailImages',hubWire:{path:detailPath}},
 {id:'detailHtml',type:'textarea',hubInput:'detailHtml',hubWire:{path:['imagePage','details','htmlProductDetailContent']}},
 {id:'altText',type:'text',hubInput:'altText',hubWire:{path:['imagePage','details','altText']}},
 {id:'title',type:'text',hubInput:'title',hubWire:{path:['startPage','productName']}},{id:'model',type:'text'}];
const cell=(value,source='manual-common')=>({value,source,needsReview:false,issues:[],validationIssues:[],reviewMessages:[]});
const members=[{optionId:'one',optionLabel:'베이지',documentIndex:0},{optionId:'two',optionLabel:'검정',documentIndex:1}];
async function image(key,sha256,imageType,wire){return{key,originalName:key.slice(6),transportName:`${imageType.toLowerCase()}-${sha256}-${(await digest(key)).slice(0,16)}.png`,imageType,contentType:'image/png',byteLength:100,sha256,
 references:members.map(member=>({optionId:member.optionId,documentIndex:member.documentIndex,wire:copy(wire),slotIndex:0}))};}
async function seal(source){
 const q=source.quotationView,p=source.nativePlan,r=source.review;
 q.inputFingerprint=await digest({overrides:q.overrides,revision:q.revision});
 const clocks={productVersion:q.productVersion,contentRevision:q.contentRevision,optionRevision:q.optionRevision,quotationRevision:q.revision,profileId:'profile',profileRevision:1};
 p.identity.source=clocks;p.identity.inputFingerprint=q.inputFingerprint;p.identity.sourceFingerprint=await digest(q.overrides);
 r.identity.source=copy(clocks);r.identity.inputFingerprint=q.inputFingerprint;
 p.identityDigest=await digest(p.identity);p.originalBodySha256=await digest(p.body);const prepared=copy(p.body);
 for(const doc of prepared.jsonDocument){doc.imagePage.msrpAgree=false;doc.imagePage.labelContactAgreed=false;}
 p.preparedBodySha256=await digest(prepared);const {sourcePlanSha256:omitted,...manifest}=p;void omitted;p.sourcePlanSha256=await digest(manifest);
 r.identity.fingerprint=p.sourcePlanSha256;r.body=copy(p.body);r.originalBodySha256=p.originalBodySha256;r.preparedBodySha256=p.preparedBodySha256;
 r.reviewDigest=await digest({format:r.format,type:r.type,identity:r.identity,members:r.members,originalBodySha256:r.originalBodySha256,preparedBodySha256:r.preparedBodySha256});return source;
}
async function fixture(){
 const oldUpload='1'.repeat(64),newUpload='2'.repeat(64),oldKey=`owner/quotation-label-${oldUpload}.png`,newKey=`owner/quotation-label-${newUpload}.png`;
 const oldImage=await image(oldKey,'3'.repeat(64),'DETAIL',{path:detailPath}),newImage=await image(newKey,'4'.repeat(64),'DETAIL',{path:detailPath}),main=await image('owner/main.png','5'.repeat(64),'MAIN',{path:['imagePage','images','mainImage']});
 const rows=[{optionId:null,optionLabel:'공통',included:false},...members.map(({optionId,optionLabel})=>({optionId,optionLabel,included:true}))].map(row=>({...row,fields:{title:cell('상품'),'model':cell('원래 모델'),detailImages:cell(oldKey),detailHtml:cell(''),altText:cell('원래 설명')}}));
 const q={revision:18,inputFingerprint:hash,overrides:{common:{title:'상품',model:'원래 모델',detailImages:oldKey,detailHtml:'',altText:'원래 설명'},options:{one:{title:'상품'},two:{title:'상품'}}},legacyOverrides:{common:{retainedBlank:''},options:{}},
  resolved:{schema:{status:'observed',categoryId:'103689',fields:copy(fields)},rows:copy(rows),issues:[],validationIssues:[],reviewMessages:[],customLabels:{}},
  automatic:{schema:{status:'observed',categoryId:'103689',fields:copy(fields)},rows:copy(rows),issues:[],validationIssues:[],reviewMessages:[],customLabels:{}},
  categoryContext:{source:'collection',profileId:'profile',categoryId:'103689',categoryPath:['스포츠','양말']},optionRegistrationNumbers:{one:'1',two:'2'},protectedDetailImageKeys:['owner/banner.png'],registrationBrandChoices:['유앤채'],
  detailSaveTextBasis:{policy:'seo-name-description-v1',productName:'상품',metaDescription:'원래 설명',optionNames:{one:'베이지',two:'검정'}},productVersion:'2026-11-05T01:00:00.000Z',contentRevision:60,optionRevision:4,imageKeys:['owner/main.png','owner/banner.png',oldKey],updatedAt:'2026-11-05T01:00:00.000Z',submissionReady:false,optionPackQuantities:{one:1,two:1},packagingBasis:{}};
 const body={docId:null,productName:'상품',categoryPath:'스포츠>양말 (103689)',categoryId:1,displayCategoryCode:'103689',productNoticeNumber:1,version:1,scope:'Retail_Categorized_Single',jsonDocument:members.map(()=>({startPage:{productName:'상품',categoryPath:'스포츠>양말 (103689)'},productPage:{model:'원래 모델',supplyPrice:3710},imagePage:{images:{mainImage:main.transportName},details:{detailedImage:oldImage.transportName,htmlProductDetailContent:'',altText:'원래 설명'},msrpAgree:false,labelContactAgreed:false},legalPage:{certification:'해당없음'}}))};
 const review={format:'yoofam-supplier-hub-product-document-v1',type:'YOOFAM_PRODUCT_DOCUMENT_REVIEW',identity:{ownerId:'owner',company:copy(company),productId:'product',profileId:'profile',requestedProfileId:null,categoryId:'103689',fingerprint:hash,inputFingerprint:hash,schemaSha256:hash,source:{}},members:copy(members),body,originalBodySha256:hash,preparedBodySha256:hash,reviewDigest:hash,registered:false,remoteWrites:false,submissionReady:false};
 const editor=(upload,key,sha256,revision)=>({format:'saved-detail-inputs-v1',categoryId:'103689',origin:{productId:'product',sourceOptionId:'one',uploadId:upload,revision},output:{key,sha256,bytes:100},images:[{key:'owner/banner.png',sha256:hash,width:800,height:200}]});
 q.detailEditorInputs=editor(oldUpload,oldKey,oldImage.sha256,8);
 const source={review,nativePlan:{format:'yoofam-native-asset-source-plan-v1',storageNameSemantics:'private-key-leaf',identity:{ownerId:'owner',productId:'product',company:copy(company),categoryId:'103689',categoryPath:['스포츠','양말'],schemaSha256:hash,sourceFingerprint:hash,inputFingerprint:hash,source:{},members:copy(members)},identityDigest:hash,images:[main,oldImage],nativeLegalAttachmentPlan:null,body,originalBodySha256:hash,preparedBodySha256:hash,sourcePlanSha256:hash,issues:[],metadataValid:true,registered:false,remoteWrites:false,submissionReady:false,transportReady:false,bytesVerified:false},quotationView:q,settings:{settings:{brand:'유앤채',translateImages:true,imageVisionModel:'@cf/qwen/qwen3.8-27b'},scope:{ownerId:'owner',company:copy(company)}}};
 await seal(source);const next=copy(source);next.quotationView.revision++;next.quotationView.productVersion=next.quotationView.updatedAt='2026-11-05T02:00:00.000Z';next.quotationView.imageKeys.push(newKey);next.quotationView.detailEditorInputs=editor(newUpload,newKey,newImage.sha256,19);
 next.quotationView.overrides.common.detailImages=newKey;next.quotationView.overrides.common.altText='새 설명';
 for(const row of next.quotationView.resolved.rows){row.fields.detailImages=cell(newKey);row.fields.altText=cell('새 설명');}
 next.nativePlan.images[1]=newImage;for(const doc of next.nativePlan.body.jsonDocument){doc.imagePage.details.detailedImage=newImage.transportName;doc.imagePage.details.altText='새 설명';}
 await seal(next);return{source,next,oldImage,newImage,seal};
}

async function multipartFixture(){
 const f=await fixture(),q=f.next.quotationView,e=q.detailEditorInputs;
 q.imageKeys.push('owner/new-source.png');e.format='saved-detail-inputs-v2';e.partsPolicy='photo-boundary-parts-v2';
 e.images.push({key:'owner/new-source.png',sha256:hash,width:800,height:100});
 e.parts=[{start:0,end:1,width:800,height:200,sha256:f.newImage.sha256,bytes:100,uploadId:e.origin.uploadId,key:f.newImage.key},
  {start:1,end:2,width:800,height:100,sha256:f.oldImage.sha256,bytes:100,uploadId:f.source.quotationView.detailEditorInputs.origin.uploadId,key:f.oldImage.key}];
 const retained=copy(f.oldImage);retained.references.forEach(reference=>reference.slotIndex=1);f.next.nativePlan.images.push(retained);
 const keys=[f.newImage.key,f.oldImage.key].join('\n'),names=[f.newImage.transportName,f.oldImage.transportName].join(',');q.overrides.common.detailImages=keys;
 for(const row of q.resolved.rows)row.fields.detailImages=cell(keys);for(const doc of f.next.nativePlan.body.jsonDocument)doc.imagePage.details.detailedImage=names;
 await seal(f.next);return f;
}

export {fixture,multipartFixture,seal,cell,hash,detailPath};
