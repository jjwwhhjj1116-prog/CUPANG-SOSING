import test from 'node:test';
import assert from 'node:assert/strict';
import {quotationTitleUI,quotationPresentationFixture} from './helpers/quotation-form-presentation.mjs';
import {quotationAiUI} from './helpers/quotation-ai-ui.mjs';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';

const model=providedOptionModule('app/quotation-text-execution.ts').quotationTextModel();
const plain=value=>JSON.parse(JSON.stringify(value));
async function sharedFixture({optionId='red',outcome='completed'}={}){
 const view=quotationPresentationFixture();
 const field={id:'scope-feature',label:'특징',section:'product',type:'text',required:false,visibility:'hidden',hubWire:{path:['productPage','unexposedAttributes'],name:'특징',nameKey:'attributeName',valueKey:'attributeValue'}};
 for(const data of [view.resolved,view.automatic]){data.schema.fields.push(plain(field));for(const row of data.rows)row.fields[field.id]={value:'',source:'empty',needsReview:false,issues:[],validationIssues:[],reviewMessages:[]};}
 const parent=quotationTitleUI({view,props:optionId?{navigationTarget:{optionId,fieldId:'model'}}:{}}),original=JSON.stringify(view),posts=[],reads=[];
 let child,currentJob=null,recovering=false;
 const state=()=>({configuration:{configured:true,provider:'synthetic-only',model,freeOnly:true,notice:''},fingerprint:'b'.repeat(64),productId:'p1',productVersion:view.productVersion,contentRevision:view.contentRevision,optionRevision:view.optionRevision,quotationRevision:view.revision,profileId:null,jobs:currentJob?[currentJob]:[]});
 const props=()=>parent.nodes().find(node=>node.type?.name==='QuotationAiPanel').props;
 const primary=()=>parent.nodes().find(node=>node.type==='input'&&node.props.role==='switch');
 const request=async(url,init)=>{
  if(init?.method!=='POST'){
   reads.push(String(url));const reply=state();
   if(recovering&&currentJob){currentJob={...currentJob,status:'completed',error:null,result:{changes:[],warnings:[],model,generatedAt:'2026-11-03T00:00:00.000Z'}};reply.jobs=[currentJob];const key=new URL(String(url),'https://fixture.invalid').searchParams.get('idempotencyKey');if(key)reply.idempotencyKey=key;}
   return Response.json(reply);
  }
  const body=JSON.parse(init.body);posts.push(body);
  const status=outcome==='unknown'?'running':outcome;
  currentJob={id:'synthetic-original-job',status,fingerprint:body.expectedFingerprint,quotationRevision:body.expectedQuotationRevision,profileId:null,scope:{optionId:body.optionId,applyToAllOptions:body.applyToAllOptions},
   result:status==='completed'?{changes:(body.applyToAllOptions?['red','blue']:[body.optionId]).map(optionId=>({optionId,fieldKey:field.id,value:'검토한 특징'})),warnings:[],model,generatedAt:'2026-11-03T00:00:00.000Z'}:null,
   error:status==='uncertain'?{code:'fixture',message:'합성 미확정 결과',uncertain:true}:null};
  if(outcome==='unknown')throw Error('Synthetic lost acknowledgement');
  return Response.json({job:currentJob,sourceCurrent:true});
 };
 async function sync(){
  for(let i=0;i<3;i++){await parent.idle();if(!child)child=quotationAiUI(props(),request);else child.render(props());await child.idle();child.flush();}
  await parent.idle();
 }
 await sync();
 return{view,parent,posts,reads,primary,sync,get child(){return child;},get original(){return original;},get job(){return currentJob;},props,
  async clickHeader(){const button=parent.button('AI 처리');assert.equal(button.props.disabled,false);button.props.onClick();await sync();},
  async recover(){recovering=true;await child.click('실행 결과 조회');await sync();},
  close(){child?.unmount();parent.close();}};
}

test('actual header AI uses the visible OFF primary scope, without changing saved fields or excluded options',async()=>{
 const h=await sharedFixture();try{
  assert.equal(h.primary().props.checked,false);assert.equal(h.child.checkbox().props.checked,false);
  await h.clickHeader();assert.equal(h.posts.length,1);assert.equal(h.posts[0].optionId,'red');assert.equal(h.posts[0].applyToAllOptions,false);
  assert.equal(JSON.stringify(h.view),h.original);assert.equal(h.parent.changes.length,0);assert.equal(h.parent.calls.filter(call=>call.init?.method==='PUT').length,0);
 }finally{h.close();}
});

test('primary and mounted AI-tool scope switches share both directions; old header actions cannot cross a scope change',async()=>{
 const h=await sharedFixture();try{
  h.primary().props.onChange({target:{checked:true}});await h.sync();assert.equal(h.child.checkbox().props.checked,true);
  const oldHeader=h.parent.button('AI 처리').props.onClick;
  h.child.checkbox().props.onChange({target:{checked:false}});await h.sync();assert.equal(h.primary().props.checked,false);
  oldHeader();assert.equal(h.posts.length,0);await h.clickHeader();assert.equal(h.posts.length,1);assert.equal(h.posts[0].applyToAllOptions,false);
 }finally{h.close();}
});

test('same-tick and OFF/ON/OFF primary changes reject old capabilities before the child republishes',async()=>{
 const h=await sharedFixture();try{
  const old=h.parent.button('AI 처리').props.onClick;
  h.primary().props.onChange({target:{checked:true}});old();assert.equal(h.posts.length,0);
  h.primary().props.onChange({target:{checked:false}});old();assert.equal(h.posts.length,0);
  await h.sync();await h.clickHeader();assert.equal(h.posts[0].applyToAllOptions,false);
 }finally{h.close();}
});

test('a retained AI apply cannot cross controlled-scope ABA; a fresh scoped apply stages only the selected option',async()=>{
 const h=await sharedFixture();try{
  h.primary().props.onChange({target:{checked:true}});await h.sync();await h.clickHeader();
  const oldApply=h.child.button('검토한 초안 입력란에 적용').props.onClick;
  h.primary().props.onChange({target:{checked:false}});await h.sync();
  h.primary().props.onChange({target:{checked:true}});await h.sync();oldApply();assert.equal(h.parent.changes.length,0);
  h.primary().props.onChange({target:{checked:false}});await h.sync();h.child.button('검토한 초안 입력란에 적용').props.onClick();await h.parent.idle();
  assert.deepEqual(plain(h.parent.changes),[{fieldKey:'scope-feature',optionId:'red',value:'검토한 특징'}]);assert.equal(h.posts.length,1);assert.equal(JSON.stringify(h.view),h.original);
 }finally{h.close();}
});

for(const outcome of ['running','uncertain','unknown'])test(`${outcome}: shared switches retain the original job/UUID and recover before any new scope request`,async()=>{
 const h=await sharedFixture({outcome});try{
  const retainedPrimary=h.primary().props.onChange;await h.clickHeader();const uuid=h.posts[0].idempotencyKey;
  assert.equal(h.posts.length,1);assert.equal(h.primary().props.disabled,true);assert.equal(h.child.checkbox().props.disabled,true);
  retainedPrimary({target:{checked:true}});h.primary().props.onChange({target:{checked:true}});await h.sync();assert.equal(h.primary().props.checked,false);assert.equal(h.posts.length,1);
  assert.equal(h.job.id,'synthetic-original-job');await h.recover();assert.equal(h.posts.length,1);
  if(outcome==='unknown')assert.ok(h.reads.some(url=>url.includes('idempotencyKey='+uuid)),'lost ACK recovery must read the original UUID');
  h.primary().props.onChange({target:{checked:true}});await h.sync();assert.equal(h.primary().props.checked,true);assert.equal(h.child.checkbox().props.checked,true);
 }finally{h.close();}
});

test('common scope with OFF cannot infer a first option or all options and links to the existing option selector',async()=>{
 const h=await sharedFixture({optionId:null});try{
  assert.equal(h.child.checkbox().props.checked,false);assert.equal(h.parent.button('AI 처리').props.disabled,true);
  const context=h.parent.nodes().find(node=>node.type==='details'&&node.props.className==='quotation-fields-context'),opened={open:false,scrollIntoView(){}};
  context.props.ref.current=opened;let focused=false;h.parent.nodes().find(node=>node.type==='select'&&node.props.ref).props.ref.current={focus(){focused=true;}};
  h.parent.button('AI 작성할 옵션 선택').props.onClick();assert.equal(opened.open,true);assert.equal(focused,true);assert.equal(h.posts.length,0);
  h.parent.select('blue');await h.sync();await h.clickHeader();assert.equal(h.posts[0].optionId,'blue');assert.equal(h.posts[0].applyToAllOptions,false);
 }finally{h.close();}
});

test('standalone AI panel retains its historical all-included default and local scope switch',async()=>{
 const view=quotationPresentationFixture(),state={configuration:{configured:true,provider:'synthetic',model,freeOnly:true,notice:''},fingerprint:'b'.repeat(64),productId:'p1',productVersion:view.productVersion,contentRevision:view.contentRevision,optionRevision:view.optionRevision,quotationRevision:view.revision,profileId:null,jobs:[]};
 const child=quotationAiUI({productId:'p1',view,optionId:'red',disabled:false,onApply(){}},async()=>Response.json(state));
 try{await child.idle();child.flush();assert.equal(child.checkbox().props.checked,true);child.checkbox().props.onChange({target:{checked:false}});child.flush();assert.equal(child.checkbox().props.checked,false);assert.equal(child.calls.filter(call=>call.method==='POST').length,0);}finally{child.unmount();}
});
