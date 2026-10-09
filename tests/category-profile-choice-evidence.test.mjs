import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {createHash,webcrypto} from 'node:crypto';
import {renderToStaticMarkup} from 'react-dom/server';
import {schemaCompanies} from './helpers/hub-schema.mjs';

const native=createRequire(import.meta.url),modules=new Map();
let hooks;
function load(file,overrides={}){
 const cached=!Object.keys(overrides).length;
 if(cached&&modules.has(file))return modules.get(file);
 const exports={};if(cached)modules.set(file,exports);
 const source=ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 vm.runInNewContext(source,{exports,Error,Date,TextEncoder,TextDecoder,URL,URLSearchParams,AbortController,structuredClone,crypto:webcrypto,fetch:overrides.fetch,require(name){
  if(Object.hasOwn(overrides,name))return overrides[name];
  if(name==='react')return new Proxy({}, {get:(_target,key)=>hooks[key]});
  if(name.endsWith('.css'))return{};
  if(name.startsWith('../docs/')&&name.endsWith('.json'))return JSON.parse(fs.readFileSync(new URL('../docs/'+name.slice(8),import.meta.url),'utf8'));
  if(name.startsWith('@/')){const stem=name.slice(2);return load(stem+(fs.existsSync(new URL('../'+stem+'.ts',import.meta.url))?'.ts':'.tsx'));}
  if(name.startsWith('./')||name.startsWith('../'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');
  return native(name);
 }});return exports;
}
const model=load('app/quotation-schema.ts'),plain=value=>JSON.parse(JSON.stringify(value));
const categoryId='64455',categoryPath=['시험 가구','시험 최종분류'],sha256='a'.repeat(64);
const named=name=>({contains:{type:'object',properties:{name:{type:'string',enum:[name],requirement:'선택'},value:{type:'string'}}}});

// Synthetic saved Single form with 71 fields plus three original-file inputs.
// The field count models the UI regression; it is not a live Hub observation.
function profile(company=schemaCompanies[0],id='saved'){
 const raw={type:'object',properties:{productPage:{type:'object',properties:{modelNumber:{type:'string',title:'모델명',maxLength:50}}},legalPage:{type:'object',properties:{}}}};
 const snapshot={format:'supplier-hub-schema-v1',categoryId,categoryPath,company,observedAt:Date.now(),schemaString:JSON.stringify(raw),metadata:{displayCategoryCode:categoryId,kanCategoryId:3000,scopeType:'Retail_Categorized_Single',version:189}};
 const baseline=model.getQuotationSchema(categoryId,categoryPath,snapshot).fields.length;assert.ok(baseline<=71);
 raw.properties.productPage.properties.commonAttributes={type:'object',properties:{unexposedAttributes:{type:'array',allOf:Array.from({length:71-baseline},(_,index)=>named('저장 양식 전용 항목 '+index))}}};
 snapshot.schemaString=JSON.stringify(raw);
 const labels=['설치지원방식','소싱채널','소싱채널ID'],workbookFields=labels.map((label,column)=>({id:`workbook_${categoryId}_${sha256}_${column}`,column,label,requirement:column?'optional':'conditional',help:'원본에서 확인한 입력 안내',type:column?'text':'select',...(column?{}:{choices:['판매자설치','구매자설치']})}));
 const template={name:'synthetic-preview.xlsx',format:'xlsx',sheetName:'QF_3000_시험분류',headerRow:5,dataStartRow:9,headers:labels,sha256,storageKey:`owner/category-templates/${sha256}.xlsx`,workbookFields,
  workbookEvidence:{kind:'official-workbook-v1',excelSchemaVerified:false,templateSha256:sha256,sourceSchemaSha256:createHash('sha256').update(snapshot.schemaString).digest('hex'),companyCode:company.code,companyName:company.name,categoryId,categoryPath,kanCategoryId:'3000',noticeNumber:'17',version:'190'}};
 const saved={id,name:'저장 설정 '+company.name,revision:3,categoryId,categoryPath,hubSchema:snapshot,template,mappings:workbookFields.map(field=>({column:field.column,field:field.id,required:false}))};
 assert.equal(model.getQuotationSchema(categoryId,categoryPath,snapshot,template).fields.length,74);
 return plain(saved);
}
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
function ui(profiles,{choicePatch,readProfiles,preventLiveConfirm=false}={}){
 const slots=[],calls=[],selected=[],catalog=load('app/category-catalog.ts');let cursor=0;
 hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useMemo:fn=>fn(),useEffect(){},useCallback:fn=>fn};
 const fetcher=async(url,init)=>{calls.push({url,method:init?.method??'GET'});assert.equal(init?.method,undefined,'saved selection reads profiles without writing');return Response.json({profiles:readProfiles??profiles});};
 const component=load('app/components/category-picker.tsx',{
  '@/app/load-category-profiles':load('app/load-category-profiles.ts',{fetch:fetcher}),
  '@/app/components/supplier-hub-category-browser':{SupplierHubCategoryBrowser:()=>null},
  '@/app/supplier-hub-catalog':{loadLiveHubCategorySchema(){assert.fail('saved preview must not read a live Hub schema');}},
  ...(choicePatch||preventLiveConfirm?{'@/app/category-catalog':{...catalog,
   categoryChoices:values=>catalog.categoryChoices(values).map(choice=>choice.profileId&&choicePatch?{...choice,...choicePatch}:choice),
   canConfirmCategory:choice=>preventLiveConfirm&&choice?.supplierHub?false:catalog.canConfirmCategory(choice),
  }}:{}),
  fetch:fetcher,
 }).CategoryPicker;
 const render=(selectedId=profiles[0]?.id??'')=>{cursor=0;return component({profiles,selectedId,onSelected:value=>selected.push(value),onAdvanced(){}});};
 return{render,markup:()=>renderToStaticMarkup(render()),calls,selected};
}

for(const company of schemaCompanies)test(`saved verified form previews all 74 inputs with recorded code/path evidence and company (${company.code})`,()=>{
 const saved=profile(company),before=JSON.stringify(saved),h=ui([saved]),markup=h.markup();
 assert.match(markup,/기본값 미리보기 · 74개/);assert.match(markup,/저장된 Supplier Hub 상세 양식 · 코드·전체 경로 일치/);
 assert.ok(markup.includes(company.name+' ('+company.code+')'));
 for(const label of ['설치지원방식','소싱채널','소싱채널ID','저장 양식 전용 항목'])assert.ok(markup.includes(label));
 assert.doesNotMatch(markup,/이 카테고리의 전체 견적 항목은 아직 대조되지 않았습니다/);
 assert.doesNotMatch(markup,/사용자가 저장한 코드 · Supplier Hub 경로·코드 미확인/);
 assert.equal(h.calls.length,0);assert.equal(h.selected.length,0);assert.equal(JSON.stringify(saved),before);
});

test('manual saved codes retain their unconfirmed static preview rather than borrowing another saved form',()=>{
 const saved=profile(),manual={...saved,id:'manual',name:'수동 코드',hubSchema:undefined,template:null,mappings:[]},h=ui([manual,saved]),markup=h.markup();
 assert.match(markup,/사용자가 저장한 코드 · Supplier Hub 경로·코드 미확인/);
 assert.match(markup,/이 카테고리의 전체 견적 항목은 아직 대조되지 않았습니다/);
 const preview=nodes(h.render()).find(node=>node.type?.name==='IntakeQuotationPreview');assert.equal(preview.props.profile.id,'manual');
 const summary=nodes(h.render()).find(node=>node.props?.className==='category-summary ');assert.match(JSON.stringify(summary),/전체 견적 항목은 아직/);
 assert.equal(h.calls.length,0);
});

test('mismatched codes, complete paths, companies and malformed saved schema fall back without a render crash or verified claim',()=>{
 const variants=[
  value=>{value.hubSchema.categoryId='64456';},
  value=>{value.hubSchema.categoryPath=['다른 시험 가구','시험 최종분류'];},
  value=>{value.hubSchema.metadata.displayCategoryCode='64456';},
  value=>{value.hubSchema.company={code:'A01464742',name:'유앤채'};},
  value=>{value.hubSchema.company=null;},
  value=>{value.hubSchema.schemaString='{invalid';},
  value=>{value.template.workbookEvidence.companyCode='A01526306';value.template.workbookEvidence.companyName='유앤채';},
 ];
 for(const corrupt of variants){
  const saved=profile();corrupt(saved);const before=JSON.stringify(saved),h=ui([saved]);let markup;
  assert.doesNotThrow(()=>{markup=h.markup();});
  assert.match(markup,/저장된 상세 양식의 회사·코드·전체 경로 또는 원본 연결을 확인하지 못했습니다/);
  assert.match(markup,/사용자가 저장한 코드 · Supplier Hub 경로·코드 미확인/);
  assert.doesNotMatch(markup,/저장된 Supplier Hub 상세 양식 · 코드·전체 경로 일치/);
  assert.ok(!nodes(h.render()).some(node=>node.type?.name==='IntakeQuotationPreview'));
  assert.equal(h.calls.length,0);assert.equal(JSON.stringify(saved),before);
 }
});

test('another choice code or complete path cannot borrow the selected saved profile schema',()=>{
 for(const choicePatch of [{categoryId:'64456'},{path:['다른 가구','시험 최종분류']}]){
  const saved=profile(),h=ui([saved],{choicePatch}),markup=h.markup();
  assert.doesNotMatch(markup,/기본값 미리보기 · 74개/);assert.doesNotMatch(markup,/저장된 Supplier Hub 상세 양식 · 코드·전체 경로 일치/);
  assert.match(markup,/저장된 상세 양식의 회사·코드·전체 경로 또는 원본 연결을 확인하지 못했습니다/);assert.equal(h.calls.length,0);
 }
});

test('a stale actual live choice cannot borrow the independently cached saved-choice definition',()=>{
 const saved=profile(),h=ui([saved],{preventLiveConfirm:true});
 nodes(h.render()).find(node=>node.type?.name==='SupplierHubCategoryBrowser').props.onChoice({key:'stale-live',profileId:saved.id,categoryId:saved.categoryId,path:['다른 가구','시험 최종분류'],isLeaf:true,evidence:'observed',codeEvidence:'unconfirmed',codeObservedAt:null,supplierHub:{trail:[],ownerId:'owner',company:saved.hubSchema.company}});
 const markup=h.markup();assert.doesNotMatch(markup,/기본값 미리보기 · 74개/);
 assert.doesNotMatch(markup,/저장된 Supplier Hub 상세 양식 · 코드·전체 경로 일치/);
 assert.match(markup,/저장된 상세 양식의 회사·코드·전체 경로 또는 원본 연결을 확인하지 못했습니다/);assert.equal(h.calls.length,0);
});

test('valid schema without an explicit display code does not claim recorded Hub code verification',()=>{
 const saved=profile();delete saved.hubSchema.metadata.displayCategoryCode;
 const h=ui([saved]),markup=h.markup();assert.match(markup,/기본값 미리보기 · 74개/);
 assert.match(markup,/저장된 공식 Excel · 코드·전체 경로 일치/);assert.doesNotMatch(markup,/저장된 Supplier Hub 상세 양식 · 코드·전체 경로 일치/);assert.equal(h.calls.length,0);
});

test('saved confirmation preserves the existing profile and still uses one read with no Hub fetch or profile write',async()=>{
 const saved=profile(),before=JSON.stringify(saved),h=ui([saved]);
 nodes(h.render()).find(node=>node.type==='button'&&node.props.children==='선택 완료 · URL 입력').props.onClick();
 for(let index=0;index<8;index++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.selected.length,1);assert.equal(h.selected[0].id,saved.id);assert.equal(h.selected[0].revision,3);
 assert.deepEqual(h.calls,[{url:'/api/category-profiles',method:'GET'}]);assert.equal(JSON.stringify(saved),before);
});
