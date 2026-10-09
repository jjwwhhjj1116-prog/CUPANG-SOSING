import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import {createHash,webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';

const native=createRequire(import.meta.url),plain=value=>JSON.parse(JSON.stringify(value));
const hash=value=>createHash('sha256').update(value).digest('hex');
const sourceId='00000000-0000-0000-0000-000000000001',newId='00000000-0000-4000-8000-000000000002',sha='a'.repeat(64);
function runtime({fetcher=()=>assert.fail('Unexpected request'),react,catalog}={}){
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,
   {exports,Error,Date,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,structuredClone,crypto:{subtle:webcrypto.subtle,randomUUID:()=>newId},fetch:fetcher,require(name){
    if(name==='react'&&react)return react;
    if(name.endsWith('.css'))return{};
    if(name==='@/app/supplier-hub-catalog'&&catalog)return catalog;
    if(name==='@/app/components/supplier-hub-category-browser')return{SupplierHubCategoryBrowser:()=>null};
    if(name.startsWith('../docs/')&&name.endsWith('.json'))return JSON.parse(fs.readFileSync(new URL('../docs/'+name.slice(8),import.meta.url),'utf8'));
    if(name.startsWith('@/')){const stem=name.slice(2);return load(stem+(fs.existsSync(new URL('../'+stem+'.ts',import.meta.url))?'.ts':'.tsx'));}
    if(name.startsWith('./')||name.startsWith('../'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');
    return native(name);
   }});return exports;
 }return{load};
}
const shared=runtime(),client=shared.load('app/category-definition-refresh-client.ts'),carry=shared.load('app/category-definition-refresh.ts').carryCategoryDefinitionMappings;
function fixture(company=schemaCompanies[0],official=true){
 const raw={type:'object',properties:{productPage:{type:'object',properties:{modelNumber:{type:'string',title:'모델 번호',maxLength:50}}},legalPage:{type:'object',properties:{}}}};
 const schema={format:'supplier-hub-schema-v1',categoryId:'991234',categoryPath:schemaPath,company,observedAt:Date.now(),schemaString:JSON.stringify(raw),metadata:{displayCategoryCode:'991234',kanCategoryId:3000,scopeType:'Retail_Categorized_Single',version:189}};
 const fields=shared.load('app/quotation-schema.ts').getQuotationSchema(schema.categoryId,schemaPath,schema).fields,model=fields.find(field=>JSON.stringify(field.hubWire?.path)===JSON.stringify(['productPage','modelNumber']));assert.ok(model);
 const template={name:'synthetic-client.xlsx',format:official?'xlsx':'csv',sheetName:official?'QF_3000_시험':'',headerRow:official?5:1,dataStartRow:official?9:2,headers:['모델 번호','직접 고정값',...(official?['설치지원방식']:[])],sha256:sha,storageKey:`owner/category-templates/${sha}.${official?'xlsx':'csv'}`};
 if(official){template.workbookEvidence={kind:'official-workbook-v1',excelSchemaVerified:false,templateSha256:sha,sourceSchemaSha256:hash(schema.schemaString),companyCode:company.code,companyName:company.name,categoryId:schema.categoryId,categoryPath:schemaPath,kanCategoryId:'3000',noticeNumber:'17',version:'190'};template.workbookFields=[{id:`workbook_991234_${sha}_2`,column:2,label:'설치지원방식',requirement:'conditional',type:'select',choices:['','자가 설치'],help:'해당 조건을 확인하세요.'}];}
 const source={id:sourceId,name:'원본 수동 연결',revision:3,verification:'draft',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',categoryId:schema.categoryId,categoryPath:schemaPath,hubSchema:schema,template,mappings:[{column:0,field:model.id,required:false},{column:1,field:'constant',required:false,constant:'보존할 직접 고정값'},...(official?[{column:2,field:template.workbookFields[0].id,required:false,choiceFormat:'label'}]:[])]};
 raw.properties.productPage.properties.modelNumber.maxLength=49;
 const current={...schema,schemaString:JSON.stringify(raw)},saved={...plain(source),id:newId,revision:1,hubSchema:plain(current)};
 if(official)saved.template.workbookEvidence.sourceSchemaSha256=hash(current.schemaString);
 saved.mappings=plain(carry(source,saved));
 return{source:plain(source),current:plain(current),saved};
}
const ack=f=>({profile:f.saved,sourceProfileId:f.source.id,sourceRevision:f.source.revision});
const response=(body,status=201)=>Response.json(body,{status});
const signal=()=>new AbortController().signal;
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

test('actual definitions fork while observation time, metadata key order and rule-only updates keep the existing path',()=>{
 const f=fixture(),ordered={...f.source.hubSchema,observedAt:f.source.hubSchema.observedAt+1,metadata:Object.fromEntries(Object.entries(f.source.hubSchema.metadata).reverse())};
 assert.equal(client.sameCategoryHubDefinition(f.source.hubSchema,ordered),true);assert.equal(client.categoryDefinitionRequiresFork(f.source,ordered),false);
 assert.equal(client.categoryDefinitionRequiresFork(f.source,{...ordered,draftInitialization:'couplus-required-v1'}),false);
 assert.equal(client.categoryDefinitionRequiresFork(f.source,f.current),true);assert.equal(client.categoryDefinitionRequiresFork(f.source,{...ordered,metadata:{...ordered.metadata,version:191}}),true);
 assert.throws(()=>client.categoryDefinitionRequiresFork(f.source,{...f.current,company:schemaCompanies[1]}),/회사·코드·전체 경로/);
});

for(const company of schemaCompanies)test(`verified fork ACK preserves original bytes, exact maps, constants and blank-code choices (${company.code})`,async()=>{
 const f=fixture(company),before=JSON.stringify(f),requests=[];freeze(f);
 const saved=await client.refreshCategoryDefinition(f.source,f.current,{current:null},{signal:signal(),fetcher:async(url,init)=>{requests.push({url,...init});return response(ack(f));}});
 assert.equal(saved.id,newId);assert.equal(saved.revision,1);assert.equal(saved.template.sha256,f.source.template.sha256);assert.deepEqual(saved.mappings,f.saved.mappings);
 assert.deepEqual(saved.template.workbookFields[0].choices,['','자가 설치']);assert.equal(saved.template.workbookEvidence.excelSchemaVerified,false);
 assert.equal(requests.length,1);assert.equal(requests[0].url,`/api/category-profiles/${sourceId}/refresh-definition`);assert.equal(requests[0].method,'POST');
 assert.deepEqual(Object.keys(JSON.parse(requests[0].body)),['expectedRevision','hubSchema']);assert.equal(JSON.stringify(f),before);
});

test('unknown reply retry keeps the original request key/body despite a newer observation timestamp',async()=>{
 const f=fixture(),cache={current:null},requests=[];let keys=0;
 const options={signal:signal(),newKey:()=>`123e4567-e89b-42d3-a456-${String(++keys).padStart(12,'0')}`,fetcher:async(url,init)=>{requests.push({url,...init});if(requests.length===1)throw Error('lost acknowledgement');return response({...ack(f),profile:{...f.saved,id:init.headers['Idempotency-Key']}});}};
 await assert.rejects(client.refreshCategoryDefinition(f.source,f.current,cache,options),/lost acknowledgement/);
 await client.refreshCategoryDefinition(f.source,{...f.current,observedAt:f.current.observedAt+1,metadata:Object.fromEntries(Object.entries(f.current.metadata).reverse())},cache,options);
 assert.equal(keys,1);assert.equal(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key']);assert.equal(requests[0].body,requests[1].body);
});

test('a changed source revision or changed definition obtains a new request key',async()=>{
 const f=fixture(),cache={current:null},keys=[];let index=0;
 const options={signal:signal(),newKey:()=>`123e4567-e89b-42d3-a456-${String(++index).padStart(12,'0')}`,fetcher:async(_url,init)=>{keys.push(init.headers['Idempotency-Key']);return response({error:'known validation rejection'},400);}};
 await assert.rejects(client.refreshCategoryDefinition(f.source,f.current,cache,options));
 await assert.rejects(client.refreshCategoryDefinition({...f.source,revision:4},f.current,cache,options));
 await assert.rejects(client.refreshCategoryDefinition({...f.source,revision:4},{...f.current,metadata:{...f.current.metadata,version:191}},cache,options));
 assert.equal(new Set(keys).size,3);
});

test('mismatched source, identity, definition, original hash, descriptor and manual mapping ACKs are rejected',async()=>{
 const f=fixture(),before=JSON.stringify(f);
 const corruptions=[body=>{body.sourceProfileId=newId;},body=>{body.sourceRevision=4;},body=>{body.profile.id=sourceId;},body=>{body.profile.revision=2;},body=>{body.profile.name='different';},body=>{body.profile.categoryPath=['different'];},body=>{body.profile.hubSchema.company=schemaCompanies[1];},body=>{body.profile.hubSchema.metadata.version=999;},body=>{body.profile.template.sha256='b'.repeat(64);},body=>{body.profile.template.storageKey='other/category-templates/'+sha+'.xlsx';},body=>{body.profile.template.workbookEvidence.sourceSchemaSha256=f.source.template.workbookEvidence.sourceSchemaSha256;},body=>{body.profile.template.workbookFields[0].choices=['forged'];},body=>{body.profile.mappings[1].constant='changed manual constant';}];
 for(const corrupt of corruptions){const body=plain(ack(f));corrupt(body);await assert.rejects(client.refreshCategoryDefinition(f.source,f.current,{current:null},{signal:signal(),fetcher:async()=>response(body)}));}
 assert.equal(JSON.stringify(f),before);
});

test('validation/conflict/unknown responses and cancelled late ACKs never replace the source',async()=>{
 const f=fixture(),before=JSON.stringify(f);
 for(const status of [400,409,503])await assert.rejects(client.refreshCategoryDefinition(f.source,f.current,{current:null},{signal:signal(),fetcher:async()=>response({error:'original preserved'},status)}),/original preserved/);
 let reply;const controller=new AbortController(),pending=client.refreshCategoryDefinition(f.source,f.current,{current:null},{signal:controller.signal,fetcher:async()=>new Promise(resolve=>{reply=resolve;})});controller.abort();reply(response(ack(f)));await assert.rejects(pending,error=>error.name==='AbortError');
 assert.equal(JSON.stringify(f),before);
});

const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const waitFor=async(predicate)=>{const deadline=Date.now()+5000;while(!predicate()){if(Date.now()>deadline)throw Error('Picker request did not finish within the fixture timeout');await new Promise(resolve=>setTimeout(resolve,1));}};
const settle=h=>waitFor(()=>!h.inFlight);
function picker(f,{profiles=[f.source],write,observe=()=>f.current}={}){
 const slots=[],cleanup=[],requests=[],selected=[],row={url:'https://detail.1688.com/offer/813724060928.html',features:'직접 특징',keywords:'직접 키워드',profile:f.source};let cursor=0,first=true;
 const hooks={useMemo:fn=>fn(),useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useEffect(fn){if(first)cleanup.push(fn());}};
 const fetcher=async(url,init)=>{requests.push({url,...init});return !init?.method?Response.json({profiles}):write(url,init);};
 const component=runtime({fetcher,react:hooks,catalog:{loadLiveHubCategorySchema:async()=>observe()}}).load('app/components/category-picker.tsx').CategoryPicker;
 const render=()=>{cursor=0;const tree=component({profiles:[],selectedId:'',onSelected:profile=>{selected.push(profile);row.profile=profile;},onAdvanced(){}});first=false;return tree;};
 const choose=()=>nodes(render()).find(node=>node.type?.name==='SupplierHubCategoryBrowser').props.onChoice({key:'live',categoryId:f.current.categoryId,path:f.current.categoryPath,isLeaf:true,evidence:'observed',codeEvidence:'supplier-hub',supplierHub:{trail:[],ownerId:'owner',company:f.current.company}});
 return{render,choose,requests,selected,row,get inFlight(){return slots.some(slot=>slot?.current instanceof AbortController);},close:()=>cleanup.forEach(fn=>fn?.()),confirm:()=>nodes(render()).find(node=>node.type==='button'&&node.props.children==='선택 완료 · URL 입력').props.onClick()};
}

test('picker selects the new profile only after the checked fork ACK and preserves the queued URL inputs',async()=>{
 const f=fixture(),before=JSON.stringify(f.source);let reply;
 const h=picker(f,{write:async()=>new Promise(resolve=>{reply=resolve;})});h.choose();h.choose();await waitFor(()=>typeof reply==='function');
 assert.equal(h.requests.filter(request=>request.method==='POST').length,1);assert.equal(h.selected.length,0);assert.equal(h.row.profile.id,sourceId);
 reply(response(ack(f)));await settle(h);assert.equal(h.selected.length,1);assert.equal(h.row.profile.id,newId);
 assert.equal(h.row.url,'https://detail.1688.com/offer/813724060928.html');assert.equal(h.row.features,'직접 특징');assert.equal(h.row.keywords,'직접 키워드');
 assert.ok(h.requests.every(request=>request.method!=='PUT'));assert.equal(JSON.stringify(f.source),before);
});

test('picker lost ACK retries the same fork key and closing rejects a late successful selection',async()=>{
 const f=fixture();let attempts=0;
 const h=picker(f,{write:async()=>{if(++attempts===1)throw Error('unknown result');return response(ack(f));},observe:()=>({...f.current,observedAt:f.current.observedAt+attempts})});
 h.choose();await settle(h);assert.equal(h.selected.length,0);h.confirm();await settle(h);assert.equal(h.selected.length,1);
 const writes=h.requests.filter(request=>request.method==='POST');assert.equal(writes.length,2);assert.equal(writes[0].headers['Idempotency-Key'],writes[1].headers['Idempotency-Key']);assert.equal(writes[0].body,writes[1].body);
 let reply;const closed=picker(f,{write:async()=>new Promise(resolve=>{reply=resolve;})});closed.choose();await waitFor(()=>typeof reply==='function');closed.close();reply(response(ack(f)));await settle(closed);assert.equal(closed.selected.length,0);assert.equal(closed.row.profile.id,sourceId);
});

test('ambiguous saved matches prefer one exact current definition and refuse several exact definitions',async()=>{
 const f=fixture();
 for(const multipleExact of [false,true]){
  const profiles=[f.source,f.saved,...(multipleExact?[{...f.saved,id:'00000000-0000-0000-0000-000000000003'}]:[])],h=picker(f,{profiles,write:async()=>assert.fail('exact existing definition must not fork')});h.choose();await settle(h);
  assert.equal(h.selected.length,multipleExact?0:1);if(!multipleExact)assert.equal(h.selected[0].id,newId);
  assert.ok(h.requests.every(request=>request.method===undefined));
 }
});

test('rule-only definition updates retain the existing PUT rather than fork a new profile',async()=>{
 const f=fixture(),current={...f.source.hubSchema,draftInitialization:'couplus-required-v1'},h=picker({...f,current},{observe:()=>current,write:async(url,init)=>{assert.equal(url,'/api/category-profiles');assert.equal(init.method,'PUT');const body=JSON.parse(init.body);return Response.json({profile:{...body.profile,id:sourceId,revision:4}});}});
 h.choose();await settle(h);assert.equal(h.selected.length,1);assert.equal(h.selected[0].id,sourceId);assert.equal(h.selected[0].revision,4);assert.equal(h.requests.filter(request=>request.method==='POST').length,0);
});
