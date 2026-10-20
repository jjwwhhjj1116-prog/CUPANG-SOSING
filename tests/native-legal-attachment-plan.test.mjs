import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {providedOptionFixture,providedOptionModule} from './helpers/provided-option-quotation.mjs';

const model=providedOptionModule('app/native-legal-attachment-plan.ts'),bindingModel=providedOptionModule('app/native-legal-binding.ts'),quotation=providedOptionModule('app/quotation-schema.ts');
const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}],categoryPath=['합성 PDF 제출','분류 확인'];
const plain=value=>JSON.parse(JSON.stringify(value)),object=(properties,required=[])=>({type:'object',properties,required});
const hash=value=>createHash('sha256').update(model.nativeLegalAttachmentCanonical(value)).digest('hex');
const original=(number,name=`직접 확인한 원본 ${number}.pdf`)=>({key:`owner/legal/product/legal-00000000-0000-4000-8000-${String(number).padStart(12,'0')}.pdf`,name,
 byteLength:120+number,sha256:String(number).repeat(64),type:'pdf'});
async function fixture(company=companies[0]){
 const raw=object({startPage:object({productName:{type:'string'},categoryPath:{type:'string'}},['productName','categoryPath']),productPage:object({}),legalPage:object({
  certificates:{type:'array',items:{},allOf:['인증서 A','인증서 B'].map(name=>({contains:object({certificateName:{type:'string',enum:[name]},certificateValue:{type:['string','null']}},['certificateName','certificateValue'])}))},
  msds:{type:'string'},additional:{type:'string'}},['certificates'])},['startPage','productPage','legalPage']);
 raw.metadata='scope:Retail_Categorized_Single;categoryId:756;version:1;productNoticeCategoryId:25';
 const snapshot={format:'supplier-hub-schema-v1',company:{...company},categoryId:'991756',categoryPath:[...categoryPath],observedAt:Date.now(),schemaString:JSON.stringify(raw),
  metadata:{scopeType:'Retail_Categorized_Single',kanCategoryId:756,version:1,noticeNumber:25},draftInitialization:'couplus-required-v1',inputBindings:'couplus-paths-v1'};
 const data=providedOptionFixture({reviewedNames:true});data.options.rows.push({...structuredClone(data.options.rows[0]),id:'second-option'});
 const schema=quotation.getQuotationSchema(snapshot.categoryId,categoryPath,snapshot),common={};
 for(const field of schema.fields)if(field.hubWire?.path[0]==='legalPage')common[field.id]=field.hubWire.name==='인증서 B'?'두 번째 인증번호':'직접 확인한 법적 값';
 const input={snapshot,company:{...company},categoryId:snapshot.categoryId,categoryPath:[...categoryPath],resolved:quotation.resolveQuotationFields({...data,categoryId:snapshot.categoryId,categoryPath,hubSchema:snapshot,overrides:{common,options:{}}})};
 const files=[original(1,'유앤채·와이홉 인증서 (한글) 🇰🇷.pdf'),original(2),original(3),original(4)];
 const initial=await bindingModel.buildNativeLegalContext({...input,documents:{applicability:'required',files}});
 // Deliberately bind the original-list first file to schema row 1 and the
 // second file to row 0; source option/document order never selects a cert row.
 const chosen=[initial.targets[1],initial.targets[0],initial.targets.find(target=>target.binding.nativeType==='msds'),initial.targets.find(target=>target.binding.nativeType==='additional')];
 const documents={applicability:'required',files:files.map((file,index)=>({...file,nativeBinding:bindingModel.resolveNativeLegalBinding(initial,file.key,chosen[index].id,initial.schemaSha256)}))};
 const context=await bindingModel.buildNativeLegalContext({...input,documents});assert.deepEqual(plain(context.issues),[]);
 const identity={ownerId:'owner',productId:'product',company:{...company},categoryId:snapshot.categoryId,categoryPath:[...categoryPath],schemaSha256:context.schemaSha256,
  sourceFingerprint:'a'.repeat(64),inputFingerprint:'b'.repeat(64),source:{productVersion:'2026-10-20T01:00:00.000Z',contentRevision:5,optionRevision:7,quotationRevision:9,profileId:'profile',profileRevision:3},
  members:[{optionId:'second-option',optionLabel:'두 번째 옵션 먼저',documentIndex:0},{optionId:'manual-option-1',optionLabel:'첫 번째 옵션 나중',documentIndex:1}]};
 return {context,identity,applicability:'required'};
}
function valid(plan){assert.equal(plan.metadataValid,true,JSON.stringify(plan.issues));assert.deepEqual(plain(plan.issues),[]);assert.equal(plan.identityDigest,hash(plan.identity));
 const {planSha256,...rest}=plain(plan);assert.equal(planSha256,hash(rest));for(const flag of ['registered','remoteWrites','submissionReady','transportReady','bytesVerified'])assert.equal(plan[flag],false);}
function invalid(plan,code){assert.equal(plan.metadataValid,false);assert.equal(plan.planSha256,null);assert.equal(plan.identityDigest,null);assert.deepEqual(plain(plan.files),[]);assert.deepEqual(plain(plan.groups),[]);assert.deepEqual(plain(plan.targets),[]);assert.ok(plan.issues.length);if(code)assert.ok(plan.issues.some(issue=>issue.code===code),JSON.stringify(plan.issues));}

for(const company of companies)test(`${company.code}: exact current PDF metadata yields a private, source-bound plan without upload or byte claims`,async()=>{
 const input=await fixture(company),before=JSON.stringify(input),plan=await model.buildNativeLegalAttachmentPlan(input);valid(plan);
 assert.equal(plan.format,'yoofam-native-legal-attachment-plan-v1');assert.equal(plan.files.length,4);
 assert.equal(plan.files[0].transportName,'cert1-'+input.context.files[0].name);assert.equal(plan.files[1].transportName,'cert0-'+input.context.files[1].name);
 assert.equal(plan.files[0].originalName,input.context.files[0].name);assert.equal(plan.files[0].targetId,'certificate:'+input.context.files[0].nativeBinding.certificate.fieldId);
 assert.deepEqual(plain(plan.groups.map(group=>group.nativeType)),['certificate','additional','msds']);
 for(const file of plan.files){const original=input.context.files.find(value=>value.key===file.key);assert.equal(file.sha256,original.sha256);assert.equal(file.byteLength,original.byteLength);
  assert.equal(file.type,'pdf');assert.equal(file.contentType,'application/pdf');assert.equal(file.downloadPath,'/api/products/product/legal-documents?key='+encodeURIComponent(file.key));
  const url=new URL(file.downloadPath,'https://same-origin.test');assert.equal(url.origin,'https://same-origin.test');assert.equal(url.searchParams.get('key'),file.key);assert.equal(file.binding.categoryId,plan.identity.categoryId);
  assert.equal(Object.hasOwn(file,'s3Link'),false);assert.equal(Object.hasOwn(file,'url'),false);assert.equal(Object.hasOwn(file,'data'),false);}
 assert.equal(JSON.stringify(input),before);plan.files[0].binding.certificate.value='별도 복사본';assert.equal(JSON.stringify(input),before,'returned alias and metadata cannot mutate the saved original');
});

test('every saved source clock, included member order, category path and file digest participates in the plan hash',async()=>{
 const input=await fixture(),before=await model.buildNativeLegalAttachmentPlan(input);valid(before);
 const changes=[value=>value.identity.source.contentRevision++,value=>value.identity.source.optionRevision++,value=>value.identity.source.quotationRevision++,value=>value.identity.source.profileRevision++,
  value=>value.identity.source.productVersion='2026-10-20T01:00:00.001Z',value=>value.identity.sourceFingerprint='c'.repeat(64),value=>value.identity.inputFingerprint='d'.repeat(64),
  value=>value.identity.categoryPath[0]='다른 분류 경로',value=>{value.identity.members.reverse();value.identity.members.forEach((row,index)=>row.documentIndex=index);},
  value=>value.context.files[0].sha256='e'.repeat(64),value=>value.context.files[0].byteLength++,value=>value.context.files[0].name='명시적으로 바꾼 원본명.pdf'];
 for(const change of changes){const altered=plain(input);change(altered);const next=await model.buildNativeLegalAttachmentPlan(altered);valid(next);assert.notEqual(next.planSha256,before.planSha256);}
 const reordered=Object.fromEntries(Object.entries(input).reverse()),equivalent=await model.buildNativeLegalAttachmentPlan(reordered);valid(equivalent);assert.equal(equivalent.planSha256,before.planSha256);
 const nullProfile=plain(input);nullProfile.identity.source.profileId=null;nullProfile.identity.source.profileRevision=null;valid(await model.buildNativeLegalAttachmentPlan(nullProfile));
});

test('implicit captured-category identity preserves nonnull profile ID with unknown profile revision',async()=>{
 const input=await fixture();input.identity.source.profileId='captured-category-756';input.identity.source.profileRevision=null;
 const before=JSON.stringify(input),plan=await model.buildNativeLegalAttachmentPlan(input);valid(plan);
 assert.equal(plan.identity.source.profileId,'captured-category-756');assert.equal(plan.identity.source.profileRevision,null);assert.equal(JSON.stringify(input),before);
 const changed=plain(input);changed.identity.sourceFingerprint='f'.repeat(64);const next=await model.buildNativeLegalAttachmentPlan(changed);valid(next);assert.notEqual(next.planSha256,plan.planSha256);
 for(const value of [-1,0.5,'0',undefined]){const invalidClock=plain(input);invalidClock.identity.source.profileRevision=value;invalid(await model.buildNativeLegalAttachmentPlan(invalidClock));}
 const missingId=plain(input);missingId.identity.source.profileId=null;missingId.identity.source.profileRevision=0;invalid(await model.buildNativeLegalAttachmentPlan(missingId));
});

test('owner, product, profile and member IDs share the native transport first-character rule',async()=>{
 const input=await fixture();
 for(const change of [value=>value.identity.ownerId='-owner',value=>value.identity.productId='-product',value=>value.identity.source.profileId='-profile',value=>value.identity.members[0].optionId='-option']){
  const altered=plain(input);change(altered);invalid(await model.buildNativeLegalAttachmentPlan(altered));}
 const underscored=plain(input);underscored.identity.source.profileId='_profile-756';valid(await model.buildNativeLegalAttachmentPlan(underscored));
});

test('legacy nullable option identity returns a blocked plan without fabricating an ID or throwing into the package',async()=>{
 const input=await fixture();input.identity.members[0].optionId=null;const before=JSON.stringify(input);
 const plan=await model.buildNativeLegalAttachmentPlan(input);invalid(plan,'NATIVE_LEGAL_PLAN_INVALID');assert.equal(plan.identity,null);assert.equal(JSON.stringify(input),before);
});

test('foreign company/product/owner, stale schema/category/row/value and unbound originals cannot yield file plans',async()=>{
 const input=await fixture();
 const changes=[value=>value.identity.ownerId='foreign',value=>value.identity.productId='other-product',value=>value.identity.company={...companies[1]},
  value=>value.identity.company.name='유앤채 ',value=>value.identity.schemaSha256='0'.repeat(64),value=>value.identity.categoryId='991757',value=>value.context.company={...companies[1]},
  value=>value.context.schemaSha256='0'.repeat(64),value=>value.context.files[0].nativeBinding.schemaSha256='0'.repeat(64),value=>value.context.files[0].nativeBinding.certificate.schemaIndex=0,
  value=>value.context.files[0].nativeBinding.certificate.value='다른 인증번호',value=>delete value.context.files[0].nativeBinding,
  value=>value.context.files[0].key=value.context.files[0].key.replace('/legal/','/private/'),value=>value.context.files[0].type='png',value=>value.context.issues.push({code:'STALE',message:'현재 검토 오류'}),
  value=>value.context.targets[0].id='guessed-row-index',value=>value.context.targets.push(plain(value.context.targets[0]))];
 for(const change of changes){const altered=plain(input);change(altered);invalid(await model.buildNativeLegalAttachmentPlan(altered));}
});

test('bounded PDF originals reject unsafe names, duplicate transport names and duplicate target mappings',async()=>{
 const input=await fixture();
 for(const name of ['../certificate.pdf','a\\b.pdf',' 서류.pdf','서류.pdf ','서류.pdf\u0000','서류\u202e.pdf','서류:원본.pdf','x.png','a'.repeat(181)+'.pdf']){
  const altered=plain(input);altered.context.files[0].name=name;invalid(await model.buildNativeLegalAttachmentPlan(altered));}
 for(const patch of [{byteLength:0},{byteLength:5*1024*1024+1},{sha256:'unknown'}, {key:input.context.files[0].key.replace('owner/','foreign/')}]){
  const altered=plain(input);Object.assign(altered.context.files[0],patch);invalid(await model.buildNativeLegalAttachmentPlan(altered));}
 const collision=plain(input);collision.context.files[1]={...original(5,collision.context.files[0].name),nativeBinding:plain(collision.context.files[0].nativeBinding)};
 invalid(await model.buildNativeLegalAttachmentPlan(collision),'NATIVE_LEGAL_TRANSPORT_NAME_COLLISION');
 const duplicateTarget=plain(collision);duplicateTarget.context.files[1].name='다른 이름.pdf';invalid(await model.buildNativeLegalAttachmentPlan(duplicateTarget),'NATIVE_LEGAL_DUPLICATE_TARGET');
 const total=plain(input);total.context.files.forEach(file=>file.byteLength=3*1024*1024);invalid(await model.buildNativeLegalAttachmentPlan(total));
 const many=plain(input);many.context.files=Array.from({length:11},(_,index)=>({...original(index+1),nativeBinding:plain(input.context.files[0].nativeBinding)}));invalid(await model.buildNativeLegalAttachmentPlan(many));
});

test('native includes-based certificate lookup cannot confuse reserved row tokens inside original filenames',async()=>{
 const input=await fixture();assert.equal(input.context.files[0].nativeBinding.certificate.schemaIndex,1);
 for(const name of ['cert0-proof.pdf','cert1-proof.pdf','원본-CERT009-확인.pdf']){
  const altered=plain(input);altered.context.files[0].name=name;const before=JSON.stringify(altered),plan=await model.buildNativeLegalAttachmentPlan(altered);
  invalid(plan,'NATIVE_LEGAL_RESERVED_CERTIFICATE_NAME');assert.equal(JSON.stringify(altered),before,'reject ambiguous names without renaming originals');}
 const otherBucket=plain(input);otherBucket.context.files[2].name='cert0-proof.pdf';assert.equal(otherBucket.context.files[2].nativeBinding.nativeType,'msds');
 const plan=await model.buildNativeLegalAttachmentPlan(otherBucket);valid(plan);assert.equal(plan.files[2].transportName,'cert0-proof.pdf','non-certificate bucket filenames are not schema row markers');
});

test('missing context, malformed clocks/member arrays and accessor metadata return visible issues without reading getters',async()=>{
 const input=await fixture(),changes=[value=>value.context=null,value=>value.context.registered=true,value=>value.context.files=[],value=>value.identity.source=null,
  value=>value.identity.source.productVersion='not-a-clock',value=>value.identity.source.contentRevision=-1,value=>value.identity.source.optionRevision=1.25,value=>value.identity.source.profileId=null,
  value=>value.identity.members[1].documentIndex=0,value=>value.identity.members[1].optionId=value.identity.members[0].optionId,value=>value.identity.members=[],
  value=>value.identity.categoryPath=[],value=>value.identity.categoryPath=[''],value=>value.identity.source.extra='hidden',value=>value.context.files[0].extra='hidden'];
 for(const change of changes){const altered=plain(input);change(altered);invalid(await model.buildNativeLegalAttachmentPlan(altered));}
 let reads=0;const accessor=plain(input);Object.defineProperty(accessor.context.files[0],'sha256',{enumerable:true,get(){reads++;return 'a'.repeat(64);}});
 invalid(await model.buildNativeLegalAttachmentPlan(accessor));assert.equal(reads,0);
 const hole=plain(input);delete hole.identity.members[0];invalid(await model.buildNativeLegalAttachmentPlan(hole));
});

test('unconfirmed applicability remains blocked and explicit empty not-applicable plan never claims uploaded or ready',async()=>{
 const input=await fixture();invalid(await model.buildNativeLegalAttachmentPlan({...input,applicability:'unconfirmed'}),'NATIVE_LEGAL_APPLICABILITY_UNCONFIRMED');
 invalid(await model.buildNativeLegalAttachmentPlan({...input,applicability:'not-applicable'}),'NATIVE_LEGAL_APPLICABILITY_CONFLICT');
 const empty=plain(input);empty.applicability='not-applicable';empty.context.files=[];const plan=await model.buildNativeLegalAttachmentPlan(empty);valid(plan);
 assert.equal(plan.applicability,'not-applicable');assert.deepEqual(plain(plan.files),[]);assert.deepEqual(plain(plan.groups),[]);assert.equal(plan.bytesVerified,false);assert.equal(plan.transportReady,false);
});
