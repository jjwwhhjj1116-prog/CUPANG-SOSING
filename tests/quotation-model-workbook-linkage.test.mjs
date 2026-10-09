import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const h=mobileIntakeHarness();
const coverage=h.load('app/exports/quotation-fields.ts');h.close();
const wireId='live_69900_ec970ce9ec540353';
// Sanitized exact observed wire contract. No company or supplier fact is
// changed to construct these independent coverage tests.
const model={id:'model',section:'product',label:'모델명',type:'text',required:false,visibility:'common',hubInput:'model',hubWire:{path:['productPage','modelNumber']}};
const column={id:wireId,section:'product',label:'모델명/품번',type:'text',required:false,visibility:'hidden',contentField:'model',hubWire:{path:['productPage','unexposedAttributes'],name:'모델명/품번',nameKey:'attributeName',valueKey:'attributeValue'}};
const cell=(value,source='content')=>({value,source,needsReview:false,issues:[]});
const row=(optionId,value,included=true)=>({optionId,included,fields:{model:cell(value),[wireId]:cell(value)}});
const fixture=()=>({resolved:{schema:{categoryId:'69900',fields:structuredClone([model,column])},rows:[row('first','REVIEWED-MODEL'),row('second','REVIEWED-MODEL'),row('excluded','EXCLUDED',false)]},profile:{mappings:[{field:wireId,column:11}]}});
const modelMissing=f=>coverage.quotationMappingCoverage(f.resolved,f.profile).some(field=>field.fieldId==='model');

test('the exact mapped official model column represents the same stage-six model without changing either saved field',()=>{
 const f=fixture(),before=JSON.stringify(f);assert.equal(modelMissing(f),false);
 assert.equal(coverage.quotationMappingIssues(f.resolved,f.profile).some(issue=>issue.fieldId==='model'),false);
 f.resolved.rows[2].fields[wireId]=cell('EXCLUDED-INDEPENDENT','manual-option');assert.equal(modelMissing(f),false,'excluded edits cannot block included output');
 f.resolved.rows[2].fields[wireId]=cell('EXCLUDED');assert.equal(JSON.stringify(f),before);
 for(const source of ['content','manual-common','manual-option']){
  for(const output of f.resolved.rows.filter(item=>item.included)){output.fields.model=cell('',source);output.fields[wireId]=cell('',source);}
  assert.equal(modelMissing(f),false,'the exact same deliberate blank is represented without inventing a value');
 }
});

test('independent model edits or blanks remain blocking when the official output differs in any included option',()=>{
 for(const [fieldId,value]of [['model','INDEPENDENT'],['model',''],[wireId,'INDEPENDENT'],[wireId,'']]){
  const f=fixture();f.resolved.rows[1].fields[fieldId]=cell(value,'manual-option');const before=JSON.stringify(f);
  assert.equal(modelMissing(f),true);assert.equal(JSON.stringify(f),before,'coverage must never repair or erase either override');
 }
 const missingCell=fixture();delete missingCell.resolved.rows[1].fields[wireId];assert.equal(modelMissing(missingCell),true);
 const noneIncluded=fixture();noneIncluded.resolved.rows.forEach(output=>output.included=false);
 assert.ok(!coverage.quotationMappingCoverage(noneIncluded.resolved,noneIncluded.profile).some(field=>field.fieldId==='model'),'no output supplies no automatic coverage claim');
});

test('similar names, foreign wires, ambiguous destinations and missing official mappings never represent modelNumber',()=>{
 const mutations=[
  f=>{f.profile.mappings=[];},
  f=>{f.resolved.schema.fields[0].hubWire.path=['productPage','otherModel'];},
  f=>{f.resolved.schema.fields[0].hubInput='brand';},
  f=>{f.resolved.schema.fields[0].section='start';},
  f=>{f.resolved.schema.fields[0].hubWire.nameKey='attributeName';},
  f=>{f.resolved.schema.fields[0].readOnly=true;},
  f=>{f.resolved.schema.fields[1].hubWire.path=['productPage','commonAttributes'];},
  f=>{f.resolved.schema.fields[1].hubWire.name='Parent Manufacturer Part Number';},
  f=>{f.resolved.schema.fields[1].hubWire.nameKey='otherName';},
  f=>{f.resolved.schema.fields[1].hubWire.valueKey='otherValue';},
  f=>{f.resolved.schema.fields[1].contentField='material';},
  f=>{f.resolved.schema.fields[1].type='select';},
  f=>{f.resolved.schema.fields[1].readOnly=true;},
  f=>{f.resolved.schema.fields.push({...structuredClone(column),id:'ambiguous-model'});},
 ];
 for(const mutate of mutations){const f=fixture();mutate(f);assert.equal(modelMissing(f),true);}
 const direct=fixture();direct.profile.mappings=[{field:'model',column:11}];assert.equal(modelMissing(direct),false,'a real direct model mapping keeps its prior behavior');
});

const profileFile=new URL('../outputs/step604-unand-profile-read.json',import.meta.url);
const originalFile=new URL('../outputs/step603-official-unand-2624.xlsx',import.meta.url);
const available=fs.existsSync(profileFile)&&fs.existsSync(originalFile);
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};

test('actual Unand Single and downloaded original XLSX export a reviewed model while absent packaging remains a precise error',{skip:!available},async()=>{
 const recorded=JSON.parse(fs.readFileSync(profileFile,'utf8'))[0].results[0],saved=JSON.parse(recorded.payload),snapshot=saved.hubSchema;
 assert.deepEqual(snapshot.company,{code:'A01526306',name:'유앤채'});assert.equal(snapshot.categoryId,'69900');
 let calls=0;const api=mobileIntakeHarness({companyCode:snapshot.company.code,companyName:snapshot.company.name,translationFetcher:async()=>{calls++;return new Response('offline quota fixture',{status:429});}});
 try{
  const original=new Uint8Array(fs.readFileSync(originalFile)),form=new FormData();form.set('file',new File([original],'original-Unand.xlsx'));form.set('schema',JSON.stringify(snapshot));form.set('action','workbook');
  const connected=await json(await api.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test/api/category-profiles/official-template',{method:'POST',body:form})),201);
  const profile=await api.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'ISOLATED UNAND MODEL CONTRACT',categoryId:saved.categoryId,categoryPath:saved.categoryPath,hubSchema:snapshot,template:connected.template,mappings:connected.mappings});
  api.context.category=profile;api.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(api.context));api.sqlite.prepare("UPDATE collection_jobs SET goal='work'").run();
  api.bindings.SOURCEFLOW_TEXT_PROVIDER='google-free';delete api.bindings.AI;assert.match(await api.intake(),/HTTP 429/);assert.equal(calls,1);
  const product=api.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  const content=(await json(await api.route(base+'/content'))).content;
  await json(await api.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{label:{model:'OFFLINE-REVIEWED-MODEL'}}}}));
  const retained=()=>JSON.stringify(['products','product_content','product_options','translation_jobs'].map(table=>api.sqlite.prepare('SELECT * FROM '+table).all())),before=retained();
  const view=await json(await api.route(base+'/quotation-fields'));
  const modelColumn=view.resolved.schema.fields.find(field=>field.contentField==='model');assert.ok(modelColumn);
  const preview=await json(await api.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}}));
  assert.equal(preview.submissionReview.issues.some(issue=>issue.kind==='error'&&issue.fieldId==='model'),false);
  for(const output of view.resolved.rows.filter(row=>row.included))assert.equal(output.fields[modelColumn.id].value,'OFFLINE-REVIEWED-MODEL');
  const weight=view.resolved.schema.fields.find(field=>JSON.stringify(field.hubWire?.path)===JSON.stringify(['logisticsPage','skuUnitBoxWeight']));
  for(const id of [weight.id,'packagedDimensionsMm'])assert.ok(preview.submissionReview.issues.some(issue=>issue.kind==='error'&&issue.code==='EXCEL_REQUIRED_MISSING'&&issue.fieldId===id));
  const download=await api.route(base+'/quotation',{method:'POST',body:{action:'download',profileId:profile.id,fingerprint:preview.fingerprint}});assert.equal(download.status,200);
  const reader=api.load('app/xlsx-template.ts'),inspection=reader.inspectXlsxArchive(await reader.readXlsxArchive(await download.arrayBuffer()));
  const column=id=>profile.mappings.find(mapping=>mapping.field===id).column;
  for(let index=0;index<6;index++){
   const cells=reader.xlsxHeaders(inspection,profile.template.sheetName,9+index);assert.equal(cells[column(modelColumn.id)],'OFFLINE-REVIEWED-MODEL');assert.equal(cells[column(weight.id)],'');assert.equal(cells[column('packagedDimensionsMm')],'');
  }
  assert.equal(retained(),before);assert.equal(calls,1);assert.deepEqual(api.objects.get(profile.template.storageKey),original);
  assert.equal(api.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{api.close();}
});
