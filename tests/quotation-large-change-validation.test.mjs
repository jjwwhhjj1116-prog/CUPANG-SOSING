import test from 'node:test';
import assert from 'node:assert/strict';
import {aiFixture,aiModule,mockProvider,plain} from './helpers/quotation-ai.mjs';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';

const schema=providedOptionModule('app/quotation-schema.ts'),client=providedOptionModule('app/quotation-ai-client.ts');
const base=(async()=>{
 const f=aiFixture({count:200}),model=aiModule(),provider=mockProvider(),result=await model.executeQuotationAi(model.buildQuotationAiPlan(f.saved,f.scope),provider);
 const resolved=schema.resolveQuotationFields({...f.saved,categoryId:f.snapshot.categoryId,categoryPath:f.snapshot.categoryPath,hubSchema:f.snapshot,overrides:f.state.overrides});
 const view={revision:0,inputFingerprint:'a'.repeat(64),overrides:f.state.overrides,resolved,automatic:resolved,categoryContext:f.saved.categoryContext,
  productVersion:f.product.updated_at,contentRevision:f.content.revision,optionRevision:f.options.revision,imageKeys:[],submissionReady:false};
 const job={id:'synthetic-large-job',status:'completed',fingerprint:'b'.repeat(64),quotationRevision:0,profileId:f.profile.id,scope:f.scope,model:result.model,result,error:null};
 const state={configuration:{configured:true,model:result.model},fingerprint:job.fingerprint,productId:f.product.id,productVersion:view.productVersion,
  contentRevision:view.contentRevision,optionRevision:view.optionRevision,quotationRevision:0,profileId:f.profile.id,jobs:[job]};
 return plain({view,job,state,productId:f.product.id,optionIds:f.options.rows.map(row=>row.id),providerCalls:provider.calls.length});
})();
const fixture=async()=>structuredClone(await base);
const context=x=>({schema:x.view.resolved.schema,optionIds:x.optionIds,ownedImageKeys:[],overrides:x.view.overrides});

test('actual 200-option generation has 1400 independently validated proposals and fits one existing save',async()=>{
 const x=await fixture(),before=JSON.stringify(x),changes=client.quotationReviewedProposalChanges(x.state,x.view,x.productId,x.job,null,true);
 assert.equal(changes.length,1400);assert.equal(x.providerCalls,23);assert.equal(new Set(changes.map(change=>JSON.stringify([change.optionId,change.fieldKey]))).size,1400);
 assert.equal(schema.validateQuotationChanges(changes,context(x)).length,1400);assert.equal(JSON.stringify(x),before);
 const body={expectedRevision:x.view.revision,expectedInputFingerprint:x.view.inputFingerprint,changes};
 assert.ok(new TextEncoder().encode(JSON.stringify(body)).length<512*1024);
 assert.ok(new TextEncoder().encode(JSON.stringify(schema.applyQuotationChanges(x.view.overrides,changes))).length<500*1024);
});

test('save cardinality follows unique current editable fields and actual option/common targets, including workbook fields',()=>{
 const fields=[{id:'editable',type:'text'},{id:'editable',type:'text'},{id:'locked',type:'text',readOnly:true},
  {id:'workbook',type:'text',workbookWire:{sha256:'a'.repeat(64),column:1,sheetName:'quote',requirement:'optional'}}];
 assert.equal(schema.quotationChangeTargetLimit({fields},['one','one','two']),6);
 const current={schema:{fields:[fields[0],fields[2],fields[3]]},optionIds:['one'],overrides:{common:{},options:{}}};
 const changes=[null,'one'].flatMap(optionId=>['editable','workbook'].map(fieldKey=>({optionId,fieldKey,value:'검토값'})));
 assert.equal(schema.validateQuotationChanges(changes,current).length,4);
 assert.throws(()=>schema.validateQuotationChanges([...changes,changes[0]],current));
 assert.throws(()=>schema.validateQuotationChanges([{optionId:'foreign',fieldKey:'editable',value:'값'}],current));
 assert.throws(()=>schema.validateQuotationChanges([{optionId:'one',fieldKey:'locked',value:'값'}],current));
});

test('large AI proposals keep exact source, scope, field, duplicate, manual and included-option fences',async()=>{
 for(const mutate of [
  x=>x.job.result.changes.push({...x.job.result.changes[0]}),
  x=>x.job.result.changes[0].optionId='foreign',
  x=>x.job.result.changes[0].fieldKey='foreign',
  x=>x.job.quotationRevision++,
  x=>x.job.fingerprint='c'.repeat(64),
  x=>x.job.profileId='foreign',
  x=>x.job.scope={optionId:x.optionIds[0],applyToAllOptions:false},
  x=>x.view.resolved.rows.find(row=>row.optionId===x.job.result.changes[0].optionId).included=false,
  x=>x.view.resolved.rows.find(row=>row.optionId===x.job.result.changes[0].optionId).fields[x.job.result.changes[0].fieldKey].source='manual-option',
  x=>x.view.resolved.rows.find(row=>row.optionId===x.job.result.changes[0].optionId).fields[x.job.result.changes[0].fieldKey].source='manual-common',
  x=>x.view.resolved.schema.fields.find(field=>field.id===x.job.result.changes[0].fieldKey).readOnly=true,
  x=>x.view.resolved.schema.fields.find(field=>field.id===x.job.result.changes[0].fieldKey).hubWire.name='원산지',
  x=>x.job.result.model='unapproved-model',
 ]){const x=await fixture();mutate(x);assert.throws(()=>client.quotationAiProposalChanges(x.view,x.job,x.state.fingerprint));}
 const x=await fixture();x.job.result.changes[1]={...x.job.result.changes[0]};
 assert.throws(()=>schema.validateQuotationChanges(x.job.result.changes,context(x)),'duplicate targets remain invalid below the semantic count bound');
});

test('AI result limit measures UTF8 bytes and accepts the exact existing 256KiB boundary',async()=>{
 const x=await fixture();x.job.result.changes=[];x.job.result.warnings=[''];
 const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length,limit=256*1024;
 const overhead=bytes(x.job.result);x.job.result.warnings[0]='x'.repeat(limit-overhead);
 assert.equal(bytes(x.job.result),limit);assert.equal(client.quotationAiProposalChanges(x.view,x.job,x.state.fingerprint).length,0);
 x.job.result.warnings[0]+='x';assert.throws(()=>client.quotationAiProposalChanges(x.view,x.job,x.state.fingerprint));
 x.job.result.warnings[0]='가'.repeat(90_000);assert.ok(JSON.stringify(x.job.result).length<limit);assert.ok(bytes(x.job.result)>limit);
 assert.throws(()=>client.quotationAiProposalChanges(x.view,x.job,x.state.fingerprint));
});

test('multiple option rows cannot enlarge the generator support beyond 300 distinct AI fields',async()=>{
 const x=await fixture(),fields=Array.from({length:301},(_,index)=>({id:'synthetic-ai-'+index,label:'속성 '+index,type:'text',section:'product',visibility:'hidden',
  hubWire:{path:['productPage','unexposedAttributes'],name:'속성 '+index,nameKey:'attributeName',valueKey:'attributeValue'}}));
 const rows=x.view.resolved.rows.filter(row=>row.included).slice(0,2).map(row=>({...row,fields:Object.fromEntries(fields.map(field=>[field.id,{value:'',source:'empty'}]))}));
 x.view.resolved.schema.fields=fields;x.view.resolved.rows=rows;
 x.job.result.changes=fields.slice(0,300).map((field,index)=>({optionId:rows[index%2].optionId,fieldKey:field.id,value:'검토값'}));
 assert.equal(client.quotationAiProposalChanges(x.view,x.job,x.state.fingerprint).length,300);
 x.job.result.changes.push({optionId:rows[0].optionId,fieldKey:fields[300].id,value:'검토값'});
 assert.throws(()=>client.quotationAiProposalChanges(x.view,x.job,x.state.fingerprint));
});
