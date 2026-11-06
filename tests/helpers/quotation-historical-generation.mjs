import assert from 'node:assert/strict';
/** Prepare a real persisted historical review; never stub the route's current policy. */
export function historicalGeneration(f,policy){
 const request=f.request;
 f.request=async(body,method='POST',query=f.query)=>{
  if(method==='POST'&&body?.action==='generate'&&!f.jobs().some(job=>job.id===body.idempotencyKey)){
   const h=f.h,saved=await h.load('app/exports/quotation-source.ts').readMappedQuotationSource('owner',f.id,body.profileId),selected=h.load('app/quotation-text-execution.ts').quotationTextConfiguration(h.bindings),user=await f.user();
   const scope={optionId:body.optionId,applyToAllOptions:body.applyToAllOptions},plan=h.load('app/quotation-ai.ts').buildQuotationAiPlan(saved,scope,undefined,policy),member={id:user.membership.id,email:user.membership.email,role:user.membership.role};
   const review={fingerprint:body.expectedFingerprint,quotationRevision:saved.state.revision,profileId:saved.categoryContext.profileId,source:structuredClone(saved.source),company:saved.company,member,scope,plan,...(selected.executionPolicy?{executionPolicy:selected.executionPolicy}:{})};
   const fingerprint=await h.load('app/automation/model.ts').fingerprint({owner:'owner',productId:f.id,company:saved.company,member,profileId:review.profileId,currentFingerprint:review.fingerprint,scope,plan:{...plan,createdAt:null},model:selected.model,...(selected.executionPolicy?{executionPolicy:selected.executionPolicy}:{})});
   assert.ok(await h.load('db/quotation-ai-jobs.ts').createQuotationAiJob('owner',f.id,body.idempotencyKey,fingerprint,review));
  }
  return request(body,method,query);
 };
 return f;
}
