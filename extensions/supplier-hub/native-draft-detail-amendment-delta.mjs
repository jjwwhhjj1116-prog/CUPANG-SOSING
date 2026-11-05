import {amendmentCopy as copy,amendmentSame as same,amendmentDigest as digest,amendmentFail as fail} from './native-draft-detail-amendment.mjs';

const FORMAT='yoofam-native-draft-detail-amendment-delta-v1',HASH=/^[a-f0-9]{64}$/;
const paths={detailImages:['imagePage','details','detailedImage'],detailHtml:['imagePage','details','htmlProductDetailContent'],altText:['imagePage','details','altText']};
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value),exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const owned=(owner,key)=>typeof owner==='string'&&owner.length>0&&!/[\/\\\u0000-\u0020%?#]/u.test(owner)&&typeof key==='string'&&key.length<=512&&key.startsWith(owner+'/')&&/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(key.slice(owner.length+1));
const stop=part=>fail('DRAFT_DETAIL_AMENDMENT_DELTA','상세 수정 이외의 저장값 또는 원본 연결이 변경됐습니다. ('+part+')');
const requireSame=(a,b,part)=>{if(!same(a,b))stop(part);};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function normalizedIdentity(value){const result=copy(value);delete result.fingerprint;delete result.sourceFingerprint;delete result.inputFingerprint;if(result.source){delete result.source.productVersion;delete result.source.quotationRevision;}return result;}
function targets(fields){
 if(!Array.isArray(fields))stop('schema');
 return Object.entries(paths).map(([id,path])=>{
  const canonical=fields.filter(field=>field.id===id),wires=fields.filter(field=>field.hubWire?.name===undefined&&same(field.hubWire?.path??null,path));
  if(canonical.length!==1||wires.length!==1||wires[0].hubInput!==id||!exact(wires[0].hubWire,['path']))stop('detail-schema');
  const linked=[...new Set([canonical[0].id,wires[0].id])];
  if(linked.some(key=>{const found=fields.filter(field=>field.id===key);return found.length!==1||(id==='detailImages'?found[0].type!=='images':!['text','textarea','select'].includes(found[0].type)||found[0].numericText);}))stop('detail-schema');
  return{id,linked,wire:copy(wires[0].hubWire)};
 });
}
function wireValue(document,wire){let node=document;for(const key of wire.path){if(!object(node)||!Object.hasOwn(node,key))stop('body-wire');node=node[key];}return node;}
function omitWire(document,wire){let node=document;for(const key of wire.path.slice(0,-1)){if(!object(node)||!Object.hasOwn(node,key))stop('body-wire');node=node[key];}if(!object(node)||!Object.hasOwn(node,wire.path.at(-1)))stop('body-wire');delete node[wire.path.at(-1)];}
function withoutDetails(body,allowed){const value=copy(body);for(const doc of value.jsonDocument)for(const target of allowed)omitWire(doc,target.wire);return value;}
function withoutCells(view,ids){
 const value=copy(view);
 for(const name of ['revision','inputFingerprint','productVersion','updatedAt','imageKeys','detailEditorInputs'])delete value[name];
 for(const layer of [value.overrides?.common,...Object.values(value.overrides?.options??{})]){if(!object(layer))stop('overrides');for(const id of ids)delete layer[id];}
 for(const [id,layer]of Object.entries(value.overrides?.options??{}))if(!Object.keys(layer).length)delete value.overrides.options[id];
 if(!Array.isArray(value.resolved?.rows))stop('rows');for(const row of value.resolved.rows){if(!object(row.fields))stop('cells');for(const id of ids)delete row.fields[id];}
 return value;
}
function checkEditor(source){
 const q=source.quotationView,e=q.detailEditorInputs,owner=source.review.identity.ownerId;
 if(!object(e)||!['saved-detail-inputs-v1','saved-detail-inputs-v2'].includes(e.format)||!exact(e,['format','categoryId','origin','output','images',...(e.format==='saved-detail-inputs-v2'?['partsPolicy','parts']:[])])
  ||e.categoryId!==source.review.identity.categoryId||!exact(e.origin,['productId','sourceOptionId','uploadId','revision'])||e.origin.productId!==source.review.identity.productId
  ||!source.review.members.some(row=>row.optionId===e.origin.sourceOptionId)||!HASH.test(e.origin.uploadId||'')||!Number.isSafeInteger(e.origin.revision)||e.origin.revision<1||e.origin.revision>q.revision
  ||!exact(e.output,['key','sha256','bytes'])||e.output.key!==`${owner}/quotation-label-${e.origin.uploadId}.png`||!HASH.test(e.output.sha256||'')||!Number.isSafeInteger(e.output.bytes)||e.output.bytes<1||e.output.bytes>10*1024*1024
  ||!Array.isArray(e.images)||!e.images.length||e.images.length>500||e.images.some(row=>!exact(row,['key','sha256','width','height'])||!owned(owner,row.key)||!q.imageKeys.includes(row.key)||!HASH.test(row.sha256||'')||![row.width,row.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=16000)))stop('detail-publication');
 const parts=e.format==='saved-detail-inputs-v2'?e.parts:[{key:e.output.key,sha256:e.output.sha256,bytes:e.output.bytes}];
 const multipart=e.format==='saved-detail-inputs-v2';
 if(!Array.isArray(parts)||!parts.length||parts.length>30||multipart&&(parts.length<2||e.partsPolicy!=='photo-boundary-parts-v2')||parts[0].key!==e.output.key||parts[0].sha256!==e.output.sha256||parts[0].bytes!==e.output.bytes)stop('detail-parts');
 const metadata=new Map();let height=0;
 for(const image of e.images){
  if(parts.some(part=>part.key===image.key)||image.width*image.height>40000000)stop('detail-inputs');
  const proof=[image.sha256,image.width,image.height];if(metadata.has(image.key)&&!same(metadata.get(image.key),proof))stop('detail-inputs');metadata.set(image.key,proof);
  height+=Math.max(1,Math.round(image.height*800/image.width));
 }
 if(!multipart&&height>16000)stop('detail-inputs');
 if(multipart){let end=0,total=0;const uploads=new Set();for(const part of parts){
  if(!exact(part,['start','end','width','height','sha256','bytes','uploadId','key'])||![part.start,part.end,part.height].every(Number.isSafeInteger)
   ||part.start!==end||part.end<=part.start||part.end>150||part.width!==800||part.height<1||part.height>16000||!HASH.test(part.uploadId||'')
   ||uploads.has(part.uploadId)||part.key!==`${owner}/quotation-label-${part.uploadId}.png`
   ||e.images.slice(part.start,part.end).reduce((sum,image)=>sum+Math.max(1,Math.round(image.height*800/image.width)),0)!==part.height)stop('detail-parts');
  uploads.add(part.uploadId);end=part.end;total+=part.bytes;
 }if(end!==e.images.length||total>30*1024*1024||parts[0].uploadId!==e.origin.uploadId)stop('detail-parts');}
 const files=source.nativePlan.images.filter(file=>file.imageType==='DETAIL');
 if(parts.length!==files.length||parts.some((part,index)=>!owned(owner,part.key)||!HASH.test(part.sha256||'')||!Number.isSafeInteger(part.bytes)||part.bytes<1||part.bytes>10*1024*1024||!files.some(file=>file.key===part.key&&file.sha256===part.sha256&&file.byteLength===part.bytes)
  ||parts.findIndex(other=>other.key===part.key)!==index))stop('detail-parts');
 return{keys:parts.map(part=>part.key),pool:new Set([...parts.map(part=>part.key),...e.images.map(row=>row.key)])};
}
async function checkSource(source){
 if(!exact(source,['review','nativePlan','quotationView','settings']))stop('source');
 const {review:r,nativePlan:p,quotationView:q,settings}=source,i=r?.identity;
 if(!exact(r,['format','type','identity','members','body','originalBodySha256','preparedBodySha256','reviewDigest','registered','remoteWrites','submissionReady'])
  ||r.format!=='yoofam-supplier-hub-product-document-v1'||r.type!=='YOOFAM_PRODUCT_DOCUMENT_REVIEW'||!i||!Array.isArray(r.members)||!r.members.length||r.members.length>200
  ||['registered','remoteWrites','submissionReady'].some(key=>r[key]!==false)||!object(r.body)||!Array.isArray(r.body.jsonDocument)||r.body.jsonDocument.length!==r.members.length
  ||p?.format!=='yoofam-native-asset-source-plan-v1'||p.storageNameSemantics!=='private-key-leaf'||p.metadataValid!==true||!Array.isArray(p.issues)||p.issues.some(issue=>issue.level==='error')
  ||['registered','remoteWrites','submissionReady','transportReady','bytesVerified'].some(key=>p[key]!==false)||!Array.isArray(p.images)||!p.images.length||p.images.length>150||!object(p.identity)
  ||!object(q)||!object(q.overrides)||!object(q.overrides.common)||!object(q.overrides.options)||!Array.isArray(q.imageKeys)||q.imageKeys.length>500||new Set(q.imageKeys).size!==q.imageKeys.length
  ||q.imageKeys.some(key=>!owned(i.ownerId,key))||!exact(settings,['settings','scope'])||!object(settings.settings)||!object(settings.scope)||settings.scope.ownerId!==i.ownerId||!same(settings.scope.company,i.company))stop('source-contract');
 if(!same(p.body,r.body)||p.body.docId!==null||p.body.scope!=='Retail_Categorized_Single'||p.body.displayCategoryCode!==i.categoryId||!same(p.identity.members,r.members)||!same(p.identity.company,i.company)
  ||p.identity.ownerId!==i.ownerId||p.identity.productId!==i.productId||p.identity.categoryId!==i.categoryId||p.identity.schemaSha256!==i.schemaSha256||p.identity.inputFingerprint!==i.inputFingerprint||!same(p.identity.source,i.source)
  ||q.inputFingerprint!==i.inputFingerprint||q.productVersion!==i.source.productVersion||q.revision!==i.source.quotationRevision||q.contentRevision!==i.source.contentRevision||q.optionRevision!==i.source.optionRevision||q.updatedAt!==q.productVersion
  ||q.resolved?.schema?.status!=='observed'||q.categoryContext?.categoryId!==i.categoryId||q.categoryContext?.profileId!==i.profileId||q.resolved.schema.categoryId!==i.categoryId
  ||!Array.isArray(q.resolved.rows)||!same(q.resolved.rows.filter(row=>row.optionId!==null&&row.included).map((row,documentIndex)=>({optionId:row.optionId,optionLabel:row.optionLabel,documentIndex})),r.members))stop('source-identity');
 const {sourcePlanSha256:omitted,...manifest}=p;void omitted;
 if(![r.reviewDigest,r.originalBodySha256,r.preparedBodySha256,i.fingerprint,i.inputFingerprint,i.schemaSha256,p.sourcePlanSha256,p.identityDigest].every(value=>typeof value==='string'&&HASH.test(value))
  ||await digest(manifest)!==p.sourcePlanSha256||p.sourcePlanSha256!==i.fingerprint||await digest(p.identity)!==p.identityDigest||await digest(r.body)!==r.originalBodySha256||p.originalBodySha256!==r.originalBodySha256||p.preparedBodySha256!==r.preparedBodySha256)stop('hash');
 const prepared=copy(r.body);for(const doc of prepared.jsonDocument)if(object(doc.imagePage))for(const key of ['msrpAgree','labelContactAgreed'])if(Object.hasOwn(doc.imagePage,key))doc.imagePage[key]=false;
 if(await digest(prepared)!==r.preparedBodySha256||await digest({format:r.format,type:r.type,identity:i,members:r.members,originalBodySha256:r.originalBodySha256,preparedBodySha256:r.preparedBodySha256})!==r.reviewDigest)stop('review-hash');
 const names=new Set();let total=0;
 for(const file of p.images){
  if(!exact(file,['key','originalName','transportName','imageType','contentType','byteLength','sha256','references'])
   ||!owned(i.ownerId,file.key)||!q.imageKeys.includes(file.key)||file.originalName!==file.key.slice(i.ownerId.length+1)||!['MAIN','ADDITIONAL','SIZECHART','LABEL','DETAIL'].includes(file.imageType)
   ||!['image/png','image/jpeg'].includes(file.contentType)||!HASH.test(file.sha256||'')||!Number.isSafeInteger(file.byteLength)||file.byteLength<1||file.byteLength>10*1024*1024||names.has(file.transportName)||!Array.isArray(file.references)||!file.references.length)stop('files');
  if(file.references.some(reference=>!exact(reference,['optionId','documentIndex','wire','slotIndex'])))stop('file-reference');
  const extension=file.contentType==='image/png'?'png':'jpg',name=`${file.imageType.toLowerCase()}-${file.sha256}-${(await digest(file.key)).slice(0,16)}.${extension}`;
  if(file.transportName!==name||(total+=file.byteLength)>64*1024*1024)stop('files');names.add(name);
 }
 return targets(q.resolved.schema.fields);
}
/** Pure detail-only gate over independently captured authoritative sources.
 * It never reads a browser, edits a parent, uploads a byte or changes a clock. */
export async function validateNativeDraftDetailAmendmentDelta(parentSource,nextSource){
 const parent=copy(parentSource),next=copy(nextSource),allowed=await checkSource(parent),nextAllowed=await checkSource(next);
 requireSame(allowed,nextAllowed,'detail-schema');requireSame(parent.settings,next.settings,'settings');
 requireSame(normalizedIdentity(parent.review.identity),normalizedIdentity(next.review.identity),'identity');requireSame(parent.review.members,next.review.members,'members');
 requireSame(normalizedIdentity(parent.nativePlan.identity),normalizedIdentity(next.nativePlan.identity),'native-identity');
 const a=parent.quotationView,b=next.quotationView;
 if(!Number.isSafeInteger(a.revision)||b.revision!==a.revision+1||!Number.isFinite(Date.parse(a.productVersion))||!Number.isFinite(Date.parse(b.productVersion))||Date.parse(b.productVersion)<=Date.parse(a.productVersion))stop('publication-clock');
 if(b.imageKeys.length<a.imageKeys.length||!same(b.imageKeys.slice(0,a.imageKeys.length),a.imageKeys))stop('image-pool');
 const ids=allowed.flatMap(target=>target.linked);requireSame(withoutCells(a,ids),withoutCells(b,ids),'quotation-non-detail');
 requireSame(withoutDetails(parent.review.body,allowed),withoutDetails(next.review.body,allowed),'body-non-detail');
 if(same(parent.review.body,next.review.body))stop('no-detail-change');
 const publication=checkEditor(next);if(b.detailEditorInputs.origin.revision!==b.revision||b.imageKeys.slice(a.imageKeys.length).some(key=>!publication.pool.has(key)))stop('publication-pool');
 const oldFiles=parent.nativePlan.images.filter(file=>file.imageType!=='DETAIL'),kept=next.nativePlan.images.filter(file=>file.imageType!=='DETAIL');requireSame(oldFiles,kept,'non-detail-files');
 const normalizePlan=plan=>{const value=copy(plan);for(const key of ['sourcePlanSha256','identityDigest','originalBodySha256','preparedBodySha256','images','body'])delete value[key];value.identity=normalizedIdentity(value.identity);
  if(value.nativeLegalAttachmentPlan){const legal=value.nativeLegalAttachmentPlan;delete legal.planSha256;delete legal.identityDigest;if(legal.identity)legal.identity=normalizedIdentity(legal.identity);}return value;};
 requireSame(normalizePlan(parent.nativePlan),normalizePlan(next.nativePlan),'plan-non-detail');
 const detailTarget=allowed.find(target=>target.id==='detailImages'),htmlTarget=allowed.find(target=>target.id==='detailHtml'),altTarget=allowed.find(target=>target.id==='altText'),newFiles=next.nativePlan.images.filter(file=>file.imageType==='DETAIL');
 const counts=new Map();
 for(const file of newFiles)for(const reference of file.references){const member=next.review.members[reference.documentIndex];
  if(!member||reference.optionId!==member.optionId||!Number.isSafeInteger(reference.slotIndex)||reference.slotIndex<0||reference.slotIndex>=publication.keys.length||!same(reference.wire,detailTarget.wire)||file.key!==publication.keys[reference.slotIndex])stop('detail-reference');
  const id=reference.documentIndex+':'+reference.slotIndex;if(counts.has(id))stop('detail-reference');counts.set(id,file.transportName);
 }
 for(const [documentIndex,document]of next.review.body.jsonDocument.entries()){
  const row=b.resolved.rows.find(row=>row.optionId===next.review.members[documentIndex].optionId);if(!row)stop('detail-row');
  const expected=publication.keys.map((_,slotIndex)=>counts.get(documentIndex+':'+slotIndex));if(expected.some(value=>!value)||wireValue(document,detailTarget.wire)!==expected.join(','))stop('detail-body');
  for(const target of [detailTarget,htmlTarget,altTarget]){const field=row.fields[target.linked.at(-1)];if(!field||typeof field.value!=='string'||target.linked.some(id=>row.fields[id]?.value!==field.value))stop('detail-cells');
   if(target.id==='detailImages'?field.value!==publication.keys.join('\n'):field.value!==wireValue(document,target.wire))stop('detail-cells');
  }
 }
 for(const row of b.resolved.rows){if(row.optionId!==null&&!next.review.members.some(member=>member.optionId===row.optionId))continue;for(const id of detailTarget.linked)if(row.fields[id]?.value!==publication.keys.join('\n'))stop('detail-common');}
 for(const id of detailTarget.linked)if(b.overrides.common[id]!==publication.keys.join('\n'))stop('detail-overrides');
 const oldByName=new Map(parent.nativePlan.images.filter(file=>file.imageType==='DETAIL').map(file=>[file.transportName,file]));
 const newDetailFiles=[],retainedDetailFiles=[];for(const file of newFiles){const previous=oldByName.get(file.transportName);if(previous){const before=copy(previous),after=copy(file);delete before.references;delete after.references;requireSame(before,after,'replacement-file');retainedDetailFiles.push(copy(file));}else newDetailFiles.push(copy(file));}
 const allowedPaths=next.review.members.flatMap(member=>allowed.map(target=>({documentIndex:member.documentIndex,wire:copy(target.wire)})));
 const deltaSha256=await digest({format:FORMAT,parentSourceSha256:await digest(parent),nextSourceSha256:await digest(next),allowedPaths,newDetailFiles,retainedDetailFiles});
 // Do not allow an asynchronous digest to label a changed caller object current.
 requireSame(parentSource,parent,'parent-mutated');requireSame(nextSource,next,'next-mutated');
 return freeze({format:FORMAT,deltaSha256,allowedPaths,newDetailFiles,retainedDetailFiles});
}
