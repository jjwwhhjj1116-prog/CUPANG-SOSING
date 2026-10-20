import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assetApiFixture,companies,imageBytes,plain,sha} from './supplier-hub-single-assets.mjs';
export {companies,plain};
export const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
export const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
export const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
export async function nativeReviewFixture(company=companies[0]){
 const f=await assetApiFixture(company),context={params:Promise.resolve({id:f.id})},now=new Date().toISOString();
 f.h.sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('owner',company.code==='A01526306'?'jwhj1116@kakao.com':'unari8484@gmail.com','synthetic-no-password',company.code==='A01526306'?'admin':'member','approved',company.code,company.name,now,now);
 for(const [index,key]of f.keys.entries()){const bytes=imageBytes(index).slice(0,-1);await f.h.bindings.FILES.put(key,bytes,{httpMetadata:{contentType:'image/png'},customMetadata:{sha256:sha(bytes)}});}
 const legal=f.h.load('app/api/products/[id]/legal-documents/route.ts'),path='https://app.test'+f.base+'/legal-documents',listed=await json(await legal.GET(new Request(path),context));
 await json(await legal.PATCH(new Request(path,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:listed.revision,applicability:'not-applicable'})}),context));
 const api=f.h.load('app/api/products/[id]/native-assets/route.ts'),sourcePath=f.base+'/native-assets'+f.query,fieldsPath=f.base+'/quotation-fields'+f.query;
 const source=()=>api.GET(new Request('https://app.test'+sourcePath),context).then(json),fields=()=>f.h.route(fieldsPath).then(json),calls=[];
 const request=async function(url,init){calls.push({url,method:init.method});assert.equal(init.method,'GET');assert.equal(init.cache,'no-store');assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');
  if(url==='/api/supplier-hub/catalog-context')return f.h.load('app/api/supplier-hub/catalog-context/route.ts').GET();
  if(url===sourcePath)return api.GET(new Request('https://app.test'+url,{signal:init.signal}),context);
  throw Error('Unexpected source request '+url);
 };
 const sourcePlan=await source(),quotationView=await fields(),model=f.h.load('app/supplier-hub-native-product-document.ts');
 assert.equal(sourcePlan.metadataValid,true,JSON.stringify(sourcePlan.issues));
 return {...f,context,sourcePath,fieldsPath,source,fields,calls,request,sourcePlan,quotationView,model,scope:{productId:f.id,profileId:f.profile.id,quotationView},
  input:{productId:f.id,profileId:f.profile.id,quotationView,sourcePlan,ownerId:'owner'}};
}
export function syntheticObservation(review,{requestId='76000000-0000-4000-8000-000000000001',docId=760001,qvtRequestId=760101,origin='https://app.test',observedAt=Date.now()}={}){
 const v=review.identity,source=Object.fromEntries(['productVersion','contentRevision','optionRevision','quotationRevision','profileRevision'].map(key=>[key,v.source[key]]));
 const logical={origin,ownerId:v.ownerId,accountContext:digest(['sourceflow-managed-product-account-v1',v.ownerId,v.company.code,v.company.name]),company:plain(v.company),productId:v.productId,profileId:v.profileId,requestedProfileId:v.requestedProfileId,categoryId:v.categoryId,fingerprint:v.fingerprint,inputFingerprint:v.inputFingerprint,schemaSha256:v.schemaSha256,source,members:plain(review.members)};
 const identity={...logical,appTabId:71,windowId:5},identityDigest=digest(identity),packetDigest=digest({identity:logical,bodySha256:review.preparedBodySha256,originalBodySha256:review.originalBodySha256});
 return{format:review.format,requestId,identity,identityDigest,packetDigest,preparedBodySha256:review.preparedBodySha256,originalBodySha256:review.originalBodySha256,state:'pending',docId,registered:false,success:false,needsRecovery:false,
  receipt:{state:'pending',docId,company:plain(v.company),identityDigest,preparedBodySha256:review.preparedBodySha256,observedAt,evidence:'document-receipt',sourceStatus:'SUBMITTED',receiptId:qvtRequestId,qvtRequestId,registered:false}};
}
