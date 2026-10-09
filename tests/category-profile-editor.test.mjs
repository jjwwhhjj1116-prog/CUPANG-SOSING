import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {webcrypto,createHash} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {workbookArchive} from './helpers/quotation-workbook.mjs';
const nativeRequire=createRequire(import.meta.url);
function load(file,dependencies={},cache=new Map()){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  const output=ts.transpileModule(fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(output,{exports,Error,AbortController,structuredClone,TextEncoder,TextDecoder,FormData,crypto:webcrypto,fetch:dependencies.fetch,require(name){
    if(name in dependencies)return dependencies[name];if(name==='react/jsx-runtime')return nativeRequire(name);
    if(name.startsWith('@/'))return load(name.slice(2)+'.ts',dependencies,cache);if(name.startsWith('./'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts',dependencies,cache);throw Error(name);
  }});return exports;
}
const stamp='2026-09-22T00:00:00.000Z';
const profile={id:'profile',revision:1,name:'시험 분류',categoryId:'80719',categoryPath:['주방용품'],verification:'draft',createdAt:stamp,updatedAt:stamp,
  template:{name:'saved.csv',format:'csv',sha256:'a'.repeat(64),sheetName:'',headerRow:1,headers:['상품명','뚜껑 포함여부','공급가'],storageKey:'owner/category-templates/saved.csv'},
  mappings:[{column:0,field:'constant',required:true,constant:'수동 연결'},{column:2,field:'supplyPrice',required:false}]};
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return[];return[tree,...nodes(tree.props?.children)];}
function harness(value=profile,getSaved=async()=>new Response('상품명,뚜껑 포함여부,공급가\n'),saveRequest,onSave=()=>{},dependencies={}){
  const states=[],refs=[],effects=[],cleanups=[],saved=[],uploads=[];let index=0,refIndex=0,first=true;const hooks={
    useState(initial){const slot=index++;if(slot>=states.length)states.push(typeof initial==='function'?initial():initial);return[states[slot],next=>{states[slot]=typeof next==='function'?next(states[slot]):next;}];},
    useRef(initial){const slot=refIndex++;if(slot>=refs.length)refs.push({current:initial});return refs[slot];},useEffect(effect){if(first)effects.push(effect);},
  };
  const editor=load('app/components/category-profile-editor.tsx',{react:hooks,
    '@/app/xlsx-template':{inspectXlsx:async()=>({sheets:[{name:'old-sheet',rows:[{rowNumber:1}]}],warnings:[]}),xlsxHeaders:()=>['옛 필드']},
    '@/app/supplier-hub-catalog':{prepareOfficialHubProfileTemplate:async()=>{throw Error('Unexpected official preparation');}},
    fetch:async(url,options)=>{
      if(url.startsWith('/api/category-profiles/template?'))return getSaved();
      if(url==='/api/category-profiles/template'&&options?.method==='POST'){
        const file=options.body.get('file');uploads.push(file.name);const bytes=new Uint8Array(await file.arrayBuffer());const hash=createHash('sha256').update(bytes).digest('hex');
        return Response.json({template:{sha256:hash,storageKey:`owner/category-templates/${hash}.${file.name.endsWith('.xlsx')?'xlsx':'csv'}`}});
      }
      if(url==='/api/category-profiles'){if(saveRequest)return saveRequest(options);const body=JSON.parse(options.body);saved.push(body.profile);return Response.json({profile:{...value,...body.profile}});}
      throw Error(url);
    },...dependencies});
  const render=()=>{index=0;refIndex=0;const tree=editor.CategoryProfileEditor({value,initialDraft:dependencies.initialDraft??profile,onSave,onClose(){}});first=false;return tree;};render();
  const find=predicate=>{const node=nodes(render()).find(predicate);assert.ok(node,'Expected editor element');return node;};
  return{render,find,saved,uploads,startEffects:()=>effects.splice(0).forEach(effect=>cleanups.push(effect())),close:()=>cleanups.forEach(cleanup=>cleanup?.()),async upload(text,name='replacement.csv'){find(node=>node.type==='input'&&node.props.type==='file').props.onChange({target:{files:[new File([text],name,{type:name.endsWith('.xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/csv'})],value:'chosen'}});for(let i=0;i<200;i++){await new Promise(resolve=>setTimeout(resolve,1));if(!find(node=>node.type==='input'&&node.props.type==='file').props.disabled)return;}throw Error('upload did not complete');},async save(){await render().props.onSubmit({preventDefault(){}});assert.equal(saved.length,1);return saved[0];}};
}

const officialPath=['패션의류잡화','유니섹스/남녀공용 패션','공용 잡화','선글라스','남녀공용패션선글라스'];
const officialSnapshot={format:'supplier-hub-schema-v1',categoryId:'69900',categoryPath:officialPath,company:{code:'A01464742',name:'와이홉'},observedAt:Date.now(),
 metadata:{kanCategoryId:2624,scopeType:'Retail_Categorized_Single',noticeNumber:4,version:188},schemaString:JSON.stringify({type:'object',properties:{
 startPage:{type:'object',properties:{productName:{type:'string',title:'상품명'},categoryPath:{type:'string',title:'카테고리'}}},
 productPage:{type:'object',properties:{commonAttributes:{type:'object',properties:{purchasePrice:{type:'string',title:'공급가'}}}}},legalPage:{type:'object',properties:{}}}})};
const officialProfile={...profile,name:'선글라스 원본 연결',categoryId:'69900',categoryPath:officialPath,hubSchema:officialSnapshot,template:null,mappings:[]};
function officialWorkbook({allowed=officialPath.join('>')+' (69900)',kan='2624',scope='Retail_Categorized_Excel'}={}){
 const headers=['상품명','카테고리','공급가',...Array.from({length:22},(_,i)=>`추가 열 ${i}`)],column=index=>{let result='';for(let value=index+1;value;value=Math.floor((value-1)/26))result=String.fromCharCode(65+(value-1)%26)+result;return result;};
 const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;'),row=(number,values)=>`<row r="${number}">${values.map((value,index)=>`<c r="${column(index)}${number}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join('')}</row>`,sheetName=`QF_${kan}_시험분류`;
 const sheet=`<worksheet><sheetData>${row(1,['',`${scope}:Kan:${kan}:Notice4:Version191`])}${row(5,headers)}${row(6,headers.map(()=> '필수'))}${row(7,headers.map(()=> '작성 안내'))}${row(8,headers.map((_,i)=>i===1?officialPath.slice(0,-1).join('>')+'>남녀공용스포츠선글라스 (69901)':'예시'))}${row(9,headers.map(()=>''))}</sheetData><dataValidations><dataValidation type="list" sqref="B9:B1008"><formula1>"${allowed}"</formula1></dataValidation></dataValidations></worksheet>`;
 return workbookArchive([['[Content_Types].xml','<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],['_rels/.rels','<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],['xl/workbook.xml',`<workbook xmlns:r="relationship"><sheets><sheet name="${sheetName}" r:id="one"/></sheets></workbook>`],['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],['xl/worksheets/sheet1.xml',sheet]]);
}

test('advanced official upload accepts allowed 69900 even when row eight illustrates 69901 and preserves the original example',async()=>{
 const api=mobileIntakeHarness();try{
  const bytes=officialWorkbook(),xlsx=api.load('app/xlsx-template.ts'),h=harness(officialProfile,undefined,undefined,undefined,{'@/app/xlsx-template':xlsx});
  await h.upload(bytes,'official.xlsx');assert.doesNotMatch(JSON.stringify(h.render()),/예시의 카테고리.*다릅니다/);
  const saved=await h.save();assert.equal(saved.categoryId,'69900');assert.equal(saved.template.headerRow,5);assert.equal(saved.template.dataStartRow,9);
  assert.equal(saved.mappings.filter(mapping=>mapping.field==='category').length,1);
  assert.match(xlsx.xlsxHeaders(xlsx.inspectXlsxArchive(await xlsx.readXlsxArchive(bytes)),saved.template.sheetName,8)[1],/69901/);
 }finally{api.close();}
});

test('a clean existing advanced profile prepares its official file directly without product actions and locks repeated clicks',async()=>{
 let finish,calls=0,received;const pending=new Promise(resolve=>{finish=resolve;});
 const saved={...officialProfile,revision:2,template:{name:'official.xlsx',format:'xlsx',sha256:'b'.repeat(64),storageKey:'owner/category-templates/official.xlsx',sheetName:'QF_2624_시험분류',headerRow:5,dataStartRow:9,headers:['상품명','카테고리','공급가']},mappings:[{column:0,field:'title',required:true}]};
 const h=harness(officialProfile,undefined,()=>{throw Error('No generic profile or product write');},value=>{received=value;},{'@/app/supplier-hub-catalog':{prepareOfficialHubProfileTemplate:async(value,signal,mode)=>{calls++;assert.deepEqual(value,officialProfile);assert.equal(signal.aborted,false);assert.equal(mode,'schema');return pending;}}});
 const button=h.find(node=>node.type==='button'&&node.props.children==='공식 견적 양식 준비');assert.equal(button.props.disabled,false);
 const click=button.props.onClick,first=click();click();assert.equal(calls,1);finish(saved);await first;assert.deepEqual(received,saved);assert.equal(h.saved.length,0);
});

test('advanced official upload rejects foreign codes, full paths, Kan and scope before storing the file',async()=>{
 const api=mobileIntakeHarness();try{
  const xlsx=api.load('app/xlsx-template.ts');
  for(const options of [{allowed:officialPath.join('>')+' (69901)'},{allowed:'다른 분류>다른 하위 분류 (69900)'},{kan:'6269'},{scope:'Retail_Categorized_Single'}]){
   const h=harness(officialProfile,undefined,undefined,undefined,{'@/app/xlsx-template':xlsx});await h.upload(officialWorkbook(options),'foreign.xlsx');
   assert.equal(h.uploads.length,0);assert.ok(nodes(h.render()).some(node=>node.props.role==='alert'));assert.equal(h.saved.length,0);
   assert.equal(h.find(node=>node.type==='input'&&node.props.value===officialProfile.name).props.value,officialProfile.name);
  }
 }finally{api.close();}
});

test('advanced save rechecks original dropdown against a later changed category path',async()=>{
 const api=mobileIntakeHarness();try{
  const h=harness(officialProfile,undefined,undefined,undefined,{'@/app/xlsx-template':api.load('app/xlsx-template.ts')});await h.upload(officialWorkbook(),'official.xlsx');
  h.find(node=>node.type==='input'&&node.props.value===officialPath.join(' > ')).props.onChange({target:{value:'다른 분류 > 다른 하위 분류'}});
  await h.render().props.onSubmit({preventDefault(){}});assert.equal(h.saved.length,0);assert.ok(nodes(h.render()).some(node=>node.props.role==='alert'));
 }finally{api.close();}
});

test('profile-only official preparation blocks new or dirty forms, including old handlers before rerender',async()=>{
 let calls=0;const dependency={'@/app/supplier-hub-catalog':{prepareOfficialHubProfileTemplate:async()=>{calls++;throw Error('Must remain blocked');}}};
 const h=harness(officialProfile,undefined,undefined,undefined,dependency),button=h.find(node=>node.type==='button'&&node.props.children==='공식 견적 양식 준비'),oldClick=button.props.onClick;
 h.find(node=>node.type==='input'&&node.props.value===officialProfile.name).props.onChange({target:{value:'입력 중인 설정 이름'}});
 await oldClick();assert.equal(calls,0);assert.equal(h.find(node=>node.type==='button'&&node.props.children==='공식 견적 양식 준비').props.disabled,true);
 const fresh=harness(null,undefined,undefined,undefined,{...dependency,initialDraft:officialProfile});const unavailable=fresh.find(node=>node.type==='button'&&node.props.children==='공식 견적 양식 준비');assert.equal(unavailable.props.disabled,true);await unavailable.props.onClick();assert.equal(calls,0);
});

test('restoring the saved input permits a fresh official action while an earlier input handler remains stale',async()=>{
 let calls=0;
 const h=harness(officialProfile,undefined,undefined,()=>{},{'@/app/supplier-hub-catalog':{prepareOfficialHubProfileTemplate:async(value)=>{calls++;return{...value,revision:value.revision+1};}}});
 const oldClick=h.find(node=>node.type==='button'&&node.props.children==='공식 견적 양식 준비').props.onClick;
 h.find(node=>node.type==='input'&&node.props.value===officialProfile.name).props.onChange({target:{value:'입력 중인 설정 이름'}});
 await oldClick();assert.equal(calls,0);
 h.find(node=>node.type==='input'&&node.props.value==='입력 중인 설정 이름').props.onChange({target:{value:officialProfile.name}});
 await oldClick();assert.equal(calls,0);
 const fresh=h.find(node=>node.type==='button'&&node.props.children==='공식 견적 양식 준비');assert.equal(fresh.props.disabled,false);await fresh.props.onClick();assert.equal(calls,1);
});

test('profile-only official connection preserves company-bound input after failure and exposes explicit workbook mode',async()=>{
 const seen=[];let saved;
 const h=harness(officialProfile,undefined,()=>{throw Error('No generic write');},value=>{saved=value;},{'@/app/supplier-hub-catalog':{prepareOfficialHubProfileTemplate:async(value,signal,mode)=>{
  seen.push(mode);assert.equal(signal.aborted,false);assert.deepEqual(value.hubSchema.company,officialSnapshot.company);
  if(mode==='schema')throw Error('선택한 양식의 회사와 현재 Supplier Hub 회사가 다릅니다.');return{...value,revision:value.revision+1,template:{connected:'fixture'}};
 }}});
 await h.find(node=>node.type==='button'&&node.props.children==='공식 견적 양식 준비').props.onClick();assert.equal(saved,undefined);assert.match(JSON.stringify(h.render()),/회사가 다릅니다/);
 assert.equal(h.find(node=>node.type==='input'&&node.props.value===officialProfile.name).props.value,officialProfile.name);
 await h.find(node=>node.type==='button'&&node.props.children==='공식 파일 기준으로 연결').props.onClick();assert.deepEqual(seen,['schema','workbook']);assert.equal(saved.revision,2);assert.deepEqual(saved.hubSchema.company,officialSnapshot.company);assert.equal(h.saved.length,0);
});

test('closing profile-only official preparation aborts its request and cannot publish into another editor',async()=>{
 let finish,signal,saved=0;const pending=new Promise(resolve=>{finish=resolve;});
 const h=harness(officialProfile,undefined,undefined,()=>{saved++;},{'@/app/supplier-hub-catalog':{prepareOfficialHubProfileTemplate:async(_value,controller)=>{signal=controller;return pending;}}});h.startEffects();
 const work=h.find(node=>node.type==='button'&&node.props.children==='공식 견적 양식 준비').props.onClick();h.close();assert.equal(signal.aborted,true);
 finish({...officialProfile,revision:2});await work;assert.equal(saved,0);
});

test('auto-fill preserves existing manual columns while a new template discards stale positions',async()=>{
  const h=harness();h.find(node=>node.type==='button'&&node.props.children==='미연결 열 자동 연결').props.onClick();
  assert.equal(h.find(node=>node.type==='select'&&node.props['aria-label']==='1열 연결').props.value,'constant');
  assert.equal(h.find(node=>node.type==='select'&&node.props['aria-label']==='2열 연결').props.value,'lidIncluded');
  assert.equal(h.find(node=>node.type==='input'&&node.props['aria-label']==='1열 고정값').props.value,'수동 연결');
  await h.upload('상품명\n');const saved=await h.save();
  assert.equal(saved.template.headers.length,1);assert.deepEqual(saved.mappings,[{column:0,field:'title',required:true}]);
});

test('changing a CSV header row reparses the actual source and leaves unchanged row manual mappings intact',async()=>{
  const h=harness();await h.upload('원본 안내,값\n상품명,공급가\n');
  h.find(node=>node.type==='input'&&node.props.type==='number').props.onChange({target:{value:'2'}});
  assert.equal(h.find(node=>node.type==='select'&&node.props['aria-label']==='1열 연결').props.value,'title');
  assert.equal(h.find(node=>node.type==='select'&&node.props['aria-label']==='2열 연결').props.value,'supplyPrice');
  h.find(node=>node.type==='select'&&node.props['aria-label']==='1열 연결').props.onChange({target:{value:'constant'}});
  h.find(node=>node.type==='input'&&node.props['aria-label']==='1열 고정값').props.onChange({target:{value:'보존'}});
  h.find(node=>node.type==='input'&&node.props.type==='number').props.onChange({target:{value:'2'}});
  const saved=await h.save();assert.equal(saved.template.headerRow,2);assert.deepEqual(saved.template.headers,['상품명','공급가']);assert.equal(saved.mappings[0].constant,'보존');
});

test('a late saved-XLSX fetch cannot replace a newly uploaded CSV source or reintroduce old columns',async()=>{
  let finish;const pending=new Promise(resolve=>{finish=resolve;});
  const h=harness({...profile,template:{...profile.template,format:'xlsx',name:'old.xlsx',sheetName:'old-sheet'}},()=>pending);h.startEffects();
  await h.upload('안내\n상품명,공급가\n');finish(new Response(new Uint8Array([1,2,3])));await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(nodes(h.render()).filter(node=>node.type==='option'&&node.props.value==='old-sheet').length,0);
  h.find(node=>node.type==='input'&&node.props.type==='number').props.onChange({target:{value:'2'}});
  const saved=await h.save();assert.equal(saved.template.name,'replacement.csv');assert.equal(saved.template.format,'csv');assert.equal(saved.template.sheetName,'');assert.deepEqual(saved.template.headers,['상품명','공급가']);
});

test('changing actual header rows keeps manual constants and explicit disconnections at their new positions',async()=>{
  const h=harness();await h.upload('상품명,공급가,판매가\n판매가,상품명,공급가\n');
  h.find(node=>node.type==='select'&&node.props['aria-label']==='1열 연결').props.onChange({target:{value:'constant'}});
  h.find(node=>node.type==='input'&&node.props['aria-label']==='1열 고정값').props.onChange({target:{value:'그대로 저장'}});
  h.find(node=>node.type==='select'&&node.props['aria-label']==='3열 연결').props.onChange({target:{value:''}});
  h.find(node=>node.type==='input'&&node.props.type==='number').props.onChange({target:{value:'2'}});
  const saved=await h.save();
  assert.deepEqual(saved.mappings,[{column:1,field:'constant',required:true,constant:'그대로 저장'},{column:2,field:'supplyPrice',required:true}]);
  assert.equal(saved.template.headerRow,2);
});

test('template guidance records inspected Excel category correspondence without claiming submission success',()=>{
 const h=harness();let tree=JSON.stringify(h.render());
 assert.match(tree,/건조대\/진열대\/정리대/);assert.match(tree,/주방수납\/잡화/);assert.match(tree,/칸 카테고리 6269/);assert.match(tree,/실제 제출 검증은 별도/);assert.match(tree,/원본 양식은 연결/);
 const input=h.find(node=>node.type==='input'&&node.props.value==='80719');input.props.onChange({target:{value:'81452'}});
 tree=JSON.stringify(h.render());assert.doesNotMatch(tree,/건조대\/진열대\/정리대/);assert.match(tree,/공식 다운로드 경로는 아직 대조하지/);
 const observation=load('app/supplier-template-observation.ts').supplierTemplateObservation('80719');
 assert.equal(observation.excelVerified,true);assert.equal(observation.downloadCategoryId,'6269');
 assert.equal(load('app/supplier-template-observation.ts').supplierTemplateObservation('81467').excelVerified,false);
 assert.equal(load('app/supplier-template-observation.ts').supplierTemplateObservation('unknown'),null);
});

test('saved input start rows survive editing and reset when the source header changes', async () => {
  const h = harness({ ...profile, template: { ...profile.template, dataStartRow: 12 } });
  assert.equal(h.find(node => node.props?.['aria-label'] === '저장할 상품 입력 시작 행').props.value, 12);
  h.find(node => node.props?.['aria-label'] === '저장할 상품 입력 시작 행').props.onChange({ target: { value: '15' } });
  assert.equal((await h.save()).template.dataStartRow, 15);
  await h.upload('원본 안내,값\n상품명,공급가\n');
  assert.equal(h.find(node => node.props?.['aria-label'] === '저장할 상품 입력 시작 행').props.value, 2);
  h.find(node => node.type === 'input' && node.props.type === 'number' && !node.props['aria-label']).props.onChange({ target: { value: '2' } });
  assert.equal(h.find(node => node.props?.['aria-label'] === '저장할 상품 입력 시작 행').props.value, 3);
});

test('category editor saves explicit choice label output and clears it when the connected field changes',async()=>{
 const configured={...profile,mappings:[...profile.mappings,{column:1,field:'lidIncluded',required:false}]};
 const h=harness(configured);h.find(n=>n.type==='select'&&n.props['aria-label']==='2열 선택값 출력').props.onChange({target:{value:'label'}});
 const saved=await h.save();assert.equal(saved.mappings.find(m=>m.column===1).choiceFormat,'label');
 const next=harness({...configured,mappings:saved.mappings});next.find(n=>n.type==='select'&&n.props['aria-label']==='2열 연결').props.onChange({target:{value:'title'}});
 const changed=await next.save();assert.equal(changed.mappings.find(m=>m.column===1).choiceFormat,undefined);
});

test('legacy invalid label formatting can be corrected without erasing mappings and cannot save before correction',async()=>{
 const invalid={...profile,mappings:[{column:0,field:'title',required:true,choiceFormat:'label'}]};
 const h=harness(invalid);assert.match(JSON.stringify(h.render()),/현재 분류의 선택형 항목이 아닙니다/);
 await h.render().props.onSubmit({preventDefault(){}});assert.equal(h.saved.length,0);assert.match(JSON.stringify(h.render()),/1열/);
 h.find(n=>n.type==='select'&&n.props['aria-label']==='1열 선택값 출력').props.onChange({target:{value:'value'}});
 const saved=await h.save();assert.equal(saved.mappings[0].field,'title');assert.equal(saved.mappings[0].required,true);assert.equal(saved.mappings[0].choiceFormat,'value');
 assert.equal(invalid.mappings[0].choiceFormat,'label');
});

test('new category editor retries the same content with the same key and changes key for edited drafts',async()=>{
 const calls=[];
 const h=harness(null,undefined,async options=>{calls.push(options);throw new Error('response lost');});
 const submit=()=>h.render().props.onSubmit({preventDefault(){}});
 await submit();await submit();
 assert.equal(calls.length,2);assert.equal(calls[0].method,'POST');
 assert.match(calls[0].headers['Idempotency-Key'],/^[0-9a-f-]{36}$/);
 assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);assert.equal(calls[0].body,calls[1].body);
 h.find(n=>n.type==='input'&&n.props.value==='시험 분류').props.onChange({target:{value:'수정한 분류'}});
 await submit();assert.notEqual(calls[2].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);
 assert.equal(JSON.parse(calls[2].body).name,'수정한 분류');
 assert.equal(JSON.parse(calls[2].body).mappings[0].constant,'수동 연결');
});

test('category editor blocks simultaneous saves before React rerenders and retains revision guard for updates',async()=>{
 let finish;const waiting=new Promise(resolve=>{finish=resolve;});const calls=[];
 const h=harness(profile,undefined,options=>{calls.push(options);return waiting;});
 const submit=h.render().props.onSubmit;
 const first=submit({preventDefault(){}});await submit({preventDefault(){}});
 assert.equal(calls.length,1);assert.equal(calls[0].method,'PUT');assert.equal(calls[0].headers['Idempotency-Key'],undefined);
 assert.equal(JSON.parse(calls[0].body).expectedRevision,1);
 finish(Response.json({error:'conflict'},{status:409}));await first;
 assert.match(JSON.stringify(h.render()),/conflict/);
 assert.equal(h.find(n=>n.props['aria-label']==='1열 고정값').props.value,'수동 연결');
});

test('closing a saving category editor prevents its late response from closing a newly opened draft',async()=>{
 for(const value of [profile,null]){
  let finish,request;const waiting=new Promise(resolve=>{finish=resolve;});
  let workspace={categoryOpen:true,addOpen:false,manualValue:'처음 수동 연결'};
  const h=harness(value,undefined,options=>{request=options;return waiting;},()=>{workspace={categoryOpen:false,addOpen:true,manualValue:null};});
  h.startEffects();const pending=h.render().props.onSubmit({preventDefault(){}});
  assert.equal(request.method,value?'PUT':'POST');
  h.close();workspace={categoryOpen:true,addOpen:false,manualValue:'새 분류에서 직접 입력한 고정값'};
  finish(Response.json({profile:{...profile,id:value?profile.id:'new-profile',revision:value?2:1}}));await pending;
  assert.deepEqual(workspace,{categoryOpen:true,addOpen:false,manualValue:'새 분류에서 직접 입력한 고정값'});
  assert.equal(request.signal.aborted,true);
 }
});
