import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionFixture,providedOptionModule} from './helpers/provided-option-quotation.mjs';

const model=providedOptionModule('app/native-legal-binding.ts'),legal=providedOptionModule('app/legal-documents.ts'),schema=providedOptionModule('app/quotation-schema.ts');
const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}],path=['합성 법적 정보','원본 연결 시험'];
const plain=value=>JSON.parse(JSON.stringify(value)),object=(properties,required=[])=>({type:'object',properties,required});
const original=(index=1,type='pdf')=>({key:`owner/legal/product/ legal-00000000-0000-4000-8000-${String(index).padStart(12,'0')}.${type}`.replace('/ legal-','/legal-'),name:`직접 첨부한 원본 ${index}.${type}`,byteLength:120+index,sha256:String(index).repeat(64),type});
function fixture({company=companies[0],value='인증번호-A',valueSchema={type:'string',enum:['인증번호-A','인증번호-B']},reverse=false,includeBuckets=true,certificates=['인증 A','인증 B']}={}){
 const certificate=name=>({contains:object(Object.fromEntries((reverse?['certificateValue','certificateName']:['certificateName','certificateValue']).map(key=>[key,key==='certificateName'?{type:'string',enum:[name]}:valueSchema])),['certificateName','certificateValue'])});
 const raw=object({startPage:object({productName:{type:'string'},categoryPath:{type:'string'}},['productName','categoryPath']),productPage:object({}),legalPage:object({
  certificates:{type:'array',items:{},allOf:certificates.map(certificate)},...(includeBuckets?{msds:{type:['string','null'],enum:['Y','N',null]},additional:{type:'string'},import_type:{type:'string'},categoryCert:{type:'boolean'},adCert:{type:'number'}}:{})},['certificates'])},['startPage','productPage','legalPage']);
 raw.metadata='scope:Retail_Categorized_Single;categoryId:754;version:1;productNoticeCategoryId:25';
 const snapshot={format:'supplier-hub-schema-v1',company:{...company},categoryId:'991755',categoryPath:[...path],observedAt:Date.now(),schemaString:JSON.stringify(raw),metadata:{scopeType:'Retail_Categorized_Single',kanCategoryId:754,version:1,noticeNumber:25},draftInitialization:'couplus-required-v1',inputBindings:'couplus-paths-v1'};
 const data=providedOptionFixture({reviewedNames:true});data.options.rows.push({...structuredClone(data.options.rows[0]),id:'manual-option-2'});
 const current=schema.getQuotationSchema(snapshot.categoryId,path,snapshot),common={};
 for(const field of current.fields){const wire=field.hubWire;if(wire?.path.join('.')==='legalPage.certificates')common[field.id]=value===null?'':String(value);
  else if(wire?.path.join('.')==='legalPage.msds')common[field.id]='Y';else if(wire?.path.join('.')==='legalPage.categoryCert')common[field.id]='false';else if(wire?.path.join('.')==='legalPage.adCert')common[field.id]='0';
  else if(wire?.path[0]==='legalPage')common[field.id]='사용자가 확인한 값';}
 const input={snapshot,company:{...company},categoryId:snapshot.categoryId,categoryPath:[...path],resolved:schema.resolveQuotationFields({...data,categoryId:snapshot.categoryId,categoryPath:path,hubSchema:snapshot,overrides:{common,options:{}}})};
 return {input,data,raw,common,current,resolve(overrides={}){return schema.resolveQuotationFields({...data,categoryId:snapshot.categoryId,categoryPath:path,hubSchema:snapshot,overrides:{common,options:overrides}});}};
}

for(const company of companies)for(const reverse of [false,true])test(`${company.code}: saved PDF connects explicitly to schema-ordered certificate and exact bucket targets (reverse=${reverse})`,async()=>{
 const f=fixture({company,reverse}),file=original(),documents={applicability:'required',files:[file]},before=JSON.stringify({input:f.input,documents});
 const context=await model.buildNativeLegalContext({...f.input,documents});
 assert.equal(context.targets.length,7);assert.deepEqual(context.files,[file]);assert.ok(context.issues.some(issue=>issue.code==='NATIVE_LEGAL_UNBOUND'));
 assert.deepEqual(plain(context.targets.slice(0,2).map(target=>[target.binding.certificate.schemaIndex,target.binding.certificate.name])),[[0,'인증 A'],[1,'인증 B']]);
 assert.deepEqual(plain(context.targets.slice(2).map(target=>target.binding.nativeType)),['msds','additional','import_type','categoryCert','adCert']);
 const target=context.targets[1],binding=model.resolveNativeLegalBinding(context,file.key,target.id,context.schemaSha256);
 assert.equal(binding.certificate.schemaIndex,1);assert.equal(binding.certificate.value,'인증번호-A');assert.equal(binding.categoryId,'991755');assert.equal(binding.schemaSha256,context.schemaSha256);
 const saved=legal.readLegalDocuments({applicability:'required',files:[{...file,nativeBinding:binding}]},'owner','product');
 const ready=await model.buildNativeLegalContext({...f.input,documents:saved});assert.deepEqual(plain(ready.issues),[]);assert.deepEqual(ready.files[0],{...file,nativeBinding:binding});
 for(const gate of ['registered','remoteWrites','submissionReady'])assert.equal(ready[gate],false);
 assert.equal(JSON.stringify({input:f.input,documents}),before,'the helper never edits the original file, current quotation or schema');
});

test('existing PDF/PNG/JPG originals remain unbound and only the exact saved PDF can be selected',async()=>{
 const f=fixture(),files=[original(),original(2,'png'),original(3,'jpg')],documents={applicability:'required',files};
 const before=JSON.stringify(documents),context=await model.buildNativeLegalContext({...f.input,documents}),target=context.targets[0];
 assert.equal(context.issues.filter(issue=>issue.code==='NATIVE_LEGAL_UNBOUND').length,3);assert.equal(context.files[0].nativeBinding,undefined);
 for(const key of [files[1].key,files[2].key,'another-owner/legal/product/legal-00000000-0000-4000-8000-000000000001.pdf'])assert.throws(()=>model.resolveNativeLegalBinding(context,key,target.id,context.schemaSha256));
 assert.throws(()=>model.resolveNativeLegalBinding(context,files[0].key,'not-a-current-target',context.schemaSha256));
 assert.equal(JSON.stringify(documents),before);assert.deepEqual(legal.readLegalDocuments(documents,'owner','product'),documents);
 assert.throws(()=>legal.readLegalDocuments(documents,'foreign-owner','product'));
});

test('stale schema, row order, field identity, certificate value or target hash cannot silently rebind a saved PDF',async()=>{
 const f=fixture(),file=original(),base=await model.buildNativeLegalContext({...f.input,documents:{applicability:'required',files:[file]}}),binding=model.resolveNativeLegalBinding(base,file.key,base.targets[0].id,base.schemaSha256);
 assert.throws(()=>model.resolveNativeLegalBinding(base,file.key,base.targets[0].id,'0'.repeat(64)));
 for(const patch of [{schemaSha256:'0'.repeat(64)},{categoryId:'991756'},{certificate:{...binding.certificate,schemaIndex:1}},{certificate:{...binding.certificate,fieldId:'live_wrong'}},{certificate:{...binding.certificate,name:'다른 인증'}},{certificate:{...binding.certificate,value:'인증번호-B'}}]){
  const context=await model.buildNativeLegalContext({...f.input,documents:{applicability:'required',files:[{...file,nativeBinding:{...binding,...patch}}]}});
  assert.ok(context.issues.some(issue=>issue.code==='NATIVE_LEGAL_STALE_BINDING'));
 }
 const changed=fixture({certificates:['인증 B','인증 A']}),context=await model.buildNativeLegalContext({...changed.input,documents:{applicability:'required',files:[{...file,nativeBinding:binding}]}});
 assert.notEqual(context.schemaSha256,base.schemaSha256);assert.ok(context.issues.some(issue=>issue.code==='NATIVE_LEGAL_STALE_BINDING'));
 const reordered=Object.fromEntries(Object.entries(binding).reverse());const equivalent=await model.buildNativeLegalContext({...f.input,documents:{applicability:'required',files:[{...file,nativeBinding:reordered}]}});assert.deepEqual(plain(equivalent.issues),[],'JSON object key order does not change an exact binding');
});

for(const value of [null,false,0,1.25])test(`certificate value retains exact projected primitive ${JSON.stringify(value)} without guessing NA or coercing text`,async()=>{
 const valueSchema=value===null?{type:['string','null'],enum:['직접 선택',null]}:typeof value==='boolean'?{type:'boolean'}:{type:'number'};
 const f=fixture({value,valueSchema,includeBuckets:false,certificates:['인증 A']}),file=original(),context=await model.buildNativeLegalContext({...f.input,documents:{applicability:'required',files:[file]}});
 assert.equal(context.targets.length,1);const binding=model.resolveNativeLegalBinding(context,file.key,context.targets[0].id,context.schemaSha256);
 assert.equal(binding.certificate.value,value);assert.equal(typeof binding.certificate.value,typeof value);assert.deepEqual(legal.readNativeLegalBinding(binding),binding);
 assert.equal(context.submissionReady,false);
});

test('included-option certificate or bucket disagreement blocks that shared target; excluded options cannot supply a value',async()=>{
 const f=fixture(),cert=f.current.fields.find(field=>field.hubWire?.name==='인증 A'),msds=f.current.fields.find(field=>field.hubWire?.path.join('.')==='legalPage.msds');
 const changed=f.resolve({'manual-option-2':{[cert.id]:'인증번호-B',[msds.id]:'N'}}),context=await model.buildNativeLegalContext({...f.input,resolved:changed});
 assert.ok(context.issues.some(issue=>issue.code==='NATIVE_LEGAL_OPTION_DISAGREEMENT'&&issue.fieldId===cert.id));
 assert.ok(context.issues.some(issue=>issue.code==='NATIVE_LEGAL_OPTION_DISAGREEMENT'&&issue.fieldId===msds.id));
 assert.ok(!context.targets.some(target=>target.binding.certificate?.fieldId===cert.id||target.binding.nativeType==='msds'));
 f.data.options.rows[1].included=false;const excluded=await model.buildNativeLegalContext({...f.input,resolved:f.resolve({'manual-option-2':{[cert.id]:'인증번호-B'}})});
 assert.ok(excluded.targets.some(target=>target.binding.certificate?.fieldId===cert.id));
});

test('duplicate schema rows, duplicate PDF identities and multiple originals for one native target remain ambiguous',async()=>{
 await assert.rejects(model.buildNativeLegalContext(fixture({certificates:['동일 인증','동일 인증']}).input));
 const f=fixture(),one=original(),two=original(2),base=await model.buildNativeLegalContext({...f.input,documents:{applicability:'required',files:[one,two]}}),target=base.targets[0],binding=model.resolveNativeLegalBinding(base,one.key,target.id,base.schemaSha256);
 const single=await model.buildNativeLegalContext({...f.input,documents:{applicability:'required',files:[{...one,nativeBinding:binding},two]}});
 assert.throws(()=>model.resolveNativeLegalBinding(single,two.key,target.id,single.schemaSha256));
 const duplicate=await model.buildNativeLegalContext({...f.input,documents:{applicability:'required',files:[{...one,nativeBinding:binding},{...two,nativeBinding:binding}]}});
 assert.ok(duplicate.issues.some(issue=>issue.code==='NATIVE_LEGAL_DUPLICATE_TARGET'));
 await assert.rejects(model.buildNativeLegalContext({...f.input,documents:{applicability:'required',files:[one,{...one,name:'이름만 바뀐 중복.pdf'}]}}));
});

test('wrong company, category or resolved wire cannot be used as the current legal context',async()=>{
 const f=fixture();await assert.rejects(model.buildNativeLegalContext({...f.input,company:companies[1]}));
 await assert.rejects(model.buildNativeLegalContext({...f.input,categoryId:'991756'}));
 const resolved=structuredClone(f.input.resolved);resolved.schema.fields.find(field=>field.hubWire?.name==='인증 A').hubWire.valueKey='guessedValue';
 await assert.rejects(model.buildNativeLegalContext({...f.input,resolved}));
});

test('stored binding metadata has an exact, bounded shape and cannot hide identity, upload or agreement fields',async()=>{
 const f=fixture(),file=original(),context=await model.buildNativeLegalContext({...f.input,documents:{applicability:'required',files:[file]}}),binding=model.resolveNativeLegalBinding(context,file.key,context.targets[0].id,context.schemaSha256);
 const invalid=[null,{...binding,uploaded:true},{...binding,schemaSha256:'bad'},{...binding,certificate:undefined},{...binding,nativeType:'certificate/other'},
  {...binding,certificate:{...binding.certificate,optionIndex:0}},{...binding,certificate:{...binding.certificate,schemaIndex:-1}},{...binding,certificate:{...binding.certificate,path:['legalPage','notices']}},
  {...binding,certificate:{...binding.certificate,value:{text:'인증번호-A'}}},{...binding,certificate:{...binding.certificate,value:NaN}},{...binding,nativeType:'msds'}];
 for(const nativeBinding of invalid)assert.throws(()=>legal.readLegalDocuments({applicability:'required',files:[{...file,nativeBinding}]},'owner','product'));
 for(const patch of [{uploaded:true},{sha256:'not-a-sha'},{key:file.key.replace('owner/','foreign/')},{name:'../certificate.pdf'},{byteLength:0},{type:'png',key:file.key.replace('.pdf','.png')}])assert.throws(()=>legal.readLegalDocuments({applicability:'required',files:[{...file,...patch,nativeBinding:binding}]},'owner','product'));
 let reads=0;const accessor={...file};Object.defineProperty(accessor,'nativeBinding',{enumerable:true,get(){reads++;return binding;}});
 assert.throws(()=>legal.readLegalDocuments({applicability:'required',files:[accessor]},'owner','product'));assert.equal(reads,0);
 assert.throws(()=>legal.readLegalDocuments({applicability:'required',files:[file],nativeUploadVerified:true},'owner','product'));
 const copy=legal.readLegalDocuments({applicability:'required',files:[{...file,nativeBinding:binding}]},'owner','product');copy.files[0].nativeBinding.certificate.value='별도 복사본';assert.equal(binding.certificate.value,'인증번호-A');
 assert.equal(context.registered,false);assert.equal(context.remoteWrites,false);assert.equal(context.submissionReady,false);
});
