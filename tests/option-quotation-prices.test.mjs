import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {submissionPackageUI} from './helpers/submission-package-ui.mjs';
const native=createRequire(import.meta.url);
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));};
const view=()=>({revision:1,inputFingerprint:'a'.repeat(64),productVersion:'v',imageKeys:[],categoryContext:{categoryId:'80719',categoryPath:['주방']},overrides:{common:{},options:{}},resolved:{schema:{fields:['supplyPrice','salePrice','msrp'].map(id=>({id,label:id,type:'number',min:1,integer:true}))},rows:[{optionId:'red',optionLabel:'빨강',included:true,fields:Object.fromEntries(['supplyPrice','salePrice','msrp'].map((id,i)=>[id,{value:String((i+1)*100),source:'pricing'}]))}]},automatic:{rows:[{optionId:'red',fields:{supplyPrice:{value:'100'},salePrice:{value:'200'},msrp:{value:'300'}}}]}});
function harness(fetcher,initial={}){
 const slots=[],effects=[],calls=[];let cursor=0,saved=0,version=initial.version??'v',refreshToken='0',productId=initial.productId??'p',profileId=Object.hasOwn(initial,'profileId')?initial.profileId:'profile';
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect(fn,deps){const i=cursor++;if(!slots[i]||JSON.stringify(slots[i].deps)!==JSON.stringify(deps)){slots[i]?.cleanup?.();slots[i]={deps};effects.push(()=>slots[i].cleanup=fn());}}};
 function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,structuredClone,TextEncoder,fetch:async(url,init)=>{calls.push({url,init});return fetcher(url,init);},require(name){if(name==='react')return react;return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);}});return exports;}
 const Component=load('app/components/option-quotation-prices.tsx').OptionQuotationPrices;
 const render=()=>{cursor=0;const tree=Component({productId,version,refreshToken,profileId,onSaved(){saved++;}});effects.splice(0).forEach(fn=>fn());return tree;};
 const button=text=>nodes(render()).find(n=>n.type==='button'&&n.props.children===text);
 const input=label=>nodes(render()).find(n=>n.props?.['aria-label']===label);
 const idle=async()=>{const deadline=Date.now()+10000;while(render().props['data-workspace-saving']){assert.ok(Date.now()<deadline,'price UI request timed out');await new Promise(resolve=>setTimeout(resolve,1));}};
 render();return {render,button,input,calls,idle,get saved(){return saved;},refresh(v){refreshToken=v;render();},setVersion(v){version=v;render();},select(p,c){productId=p;profileId=c;render();},close(){slots.forEach(s=>s?.cleanup?.());}};
}

test('stage-two direct price saves only the changed option field using the same quotation version',async()=>{
 const h=harness(async(url,init)=>Response.json(view()));await settle();
 h.input('빨강 공급가').props.onChange({target:{value:'150'}});
 const click=h.button('옵션 가격 저장').props.onClick;click();click();await settle();
 const writes=h.calls.filter(c=>c.init.method==='PUT');assert.equal(writes.length,1);
 const body=JSON.parse(writes[0].init.body);assert.deepEqual(body.changes,[{optionId:'red',fieldKey:'supplyPrice',value:'150'}]);assert.equal(body.expectedRevision,1);assert.equal(body.expectedInputFingerprint,'a'.repeat(64));assert.match(writes[0].url,/profileId=profile/);assert.equal(h.saved,1);
});

function failedAutomaticPrices(common={}){
 const h=mobileIntakeHarness();
 try{
  const options=h.load('app/product-options.ts'),model=h.load('app/quotation-schema.ts');
  const source={categoryId:'80719',product:{id:'p',title:'가격 시험',image_keys:'[]',supply_price:100,sale_price:200,msrp:300,
   pricing_policy:JSON.stringify({...h.load('app/pricing.ts').pricePolicy(h.settings),exchangeRate:1e9})},
   settings:h.settings,content:h.load('app/product-content.ts').emptyProductContent('p'),
   options:options.applyOptionRows(options.emptyProductOptions('p'),[{...options.emptyOptionInput('red'),originalName:'빨강',included:true,unitCostCny:1e9,unitsPerPack:1e6}], 'v')};
  const overrides={common,options:{}};
  return {...view(),overrides,resolved:model.resolveQuotationFields({...source,overrides}),automatic:model.resolveQuotationFields(source)};
 }finally{h.close();}
}

test('stage-two restoration retains a real automatic calculation failure on an optional price',async()=>{
 const initial=failedAutomaticPrices({supplyPrice:'100',salePrice:'200'});
 const automatic=initial.automatic.rows.find(row=>row.optionId==='red').fields.msrp;
 assert.ok(automatic.validationIssues.some(issue=>issue.includes('계산 가능한 가격 범위')));
 const h=harness(async()=>Response.json(initial));await settle();
 assert.match(JSON.stringify(h.render()),/계산 가능한 가격 범위/);
 h.input('빨강 공급가').props.onChange({target:{value:'150'}});
 assert.equal(h.button('옵션 가격 저장').props.disabled,true);
 h.input('빨강 권장소비자가').props.onChange({target:{value:'400'}});
 assert.equal(h.button('옵션 가격 저장').props.disabled,false);
 nodes(h.render()).filter(n=>n.type==='button'&&n.props.children==='복원')[2].props.onClick();
 assert.equal(h.input('빨강 권장소비자가').props.value,'');
 assert.match(JSON.stringify(h.render()),/계산 가능한 가격 범위/);
 assert.equal(h.button('옵션 가격 저장').props.disabled,true);
 h.button('옵션 가격 저장').props.onClick();await settle();
 assert.equal(h.calls.filter(call=>call.init.method==='PUT').length,0);h.close();
});

test('reviewed common prices replace calculation diagnostics, and deliberate optional blanks remain editable',async()=>{
 const initial=failedAutomaticPrices({supplyPrice:'100',salePrice:'200',msrp:'300'});
 const h=harness(async()=>Response.json(initial));await settle();
 assert.doesNotMatch(JSON.stringify(h.render()),/계산 가능한 가격 범위/);
 h.input('빨강 권장소비자가').props.onChange({target:{value:''}});
 assert.equal(h.button('옵션 가격 저장').props.disabled,false);
 nodes(h.render()).filter(n=>n.type==='button'&&n.props.children==='복원')[2].props.onClick();
 assert.equal(h.input('빨강 권장소비자가').props.value,'300');
 assert.equal(h.button('옵션 가격 저장').props.disabled,false);h.close();
});

test('price relationship errors use current edits rather than stale automatic diagnostics',async()=>{
 const initial=view();initial.resolved.schema.salePriceMustCoverSupply=true;
 initial.resolved.rows[0].fields.salePrice.value='50';initial.automatic.rows[0].fields.salePrice.value='50';
 initial.automatic.rows[0].fields.salePrice.validationIssues=['판매가는 공급가보다 작을 수 없습니다.'];
 const h=harness(async()=>Response.json(initial));await settle();
 assert.match(JSON.stringify(h.render()),/빨강 · 판매가: 판매가는 공급가보다 작을 수 없습니다/);
 h.input('빨강 공급가').props.onChange({target:{value:'40'}});
 assert.equal(h.button('옵션 가격 저장').props.disabled,false);
 assert.doesNotMatch(JSON.stringify(h.render()),/공급가보다 작을/);
 h.input('빨강 공급가').props.onChange({target:{value:'60'}});
 assert.equal(h.button('옵션 가격 저장').props.disabled,true);h.close();
});

test('price conflicts preserve entered values and reload is explicit; invalid prices cannot save',async()=>{
 const h=harness(async(url,init)=>init.method==='PUT'?Response.json({error:'동시 수정'},{status:409}):Response.json(view()));await settle();
 h.input('빨강 판매가').props.onChange({target:{value:'250'}});h.button('옵션 가격 저장').props.onClick();await settle();
 assert.equal(h.input('빨강 판매가').props.value,'250');assert.match(JSON.stringify(h.render()),/동시 수정/);assert.equal(h.saved,0);
 h.input('빨강 공급가').props.onChange({target:{value:'-1'}});assert.equal(h.button('옵션 가격 저장').props.disabled,true);
 h.button('입력 취소·저장 가격 다시 조회').props.onClick();await settle();assert.equal(h.input('빨강 판매가').props.value,'200');
});

test('restoring an option price sends null and uses the common override before automatic calculation',async()=>{
 const initial=view();initial.overrides.common.salePrice='220';initial.resolved.rows[0].fields.salePrice.value='250';initial.overrides.options.red={salePrice:'250'};
 const h=harness(async()=>Response.json(initial));await settle();
 nodes(h.render()).filter(n=>n.type==='button'&&n.props.children==='복원')[1].props.onClick();assert.equal(h.input('빨강 판매가').props.value,'220');
 h.button('옵션 가격 저장').props.onClick();await settle();assert.equal(JSON.parse(h.calls.at(-1).init.body).changes[0].value,null);
});

test('version changes retain edits and unmount aborts an in-flight write',async()=>{
 let finish;const pending=new Promise(resolve=>finish=resolve);
 const h=harness(async(url,init)=>init.method==='PUT'?pending:Response.json(view()));await settle();
 h.input('빨강 판매가').props.onChange({target:{value:'270'}});h.setVersion('new');assert.equal(h.input('빨강 판매가').props.value,'270');assert.equal(h.calls.length,1);
 h.button('옵션 가격 저장').props.onClick();h.close();assert.equal(h.calls.at(-1).init.signal.aborted,true);finish(Response.json(view()));await settle();assert.equal(h.saved,0);
});

test('quotation saves refresh clean stage-two prices without changing product version and retain unsaved edits',async()=>{
 const latest=view();const h=harness(async()=>Response.json(latest));await settle();
 latest.resolved.rows[0].fields.salePrice.value='260';h.refresh('1');await settle();
 assert.equal(h.input('빨강 판매가').props.value,'260');assert.equal(h.calls.length,2);
 h.input('빨강 판매가').props.onChange({target:{value:'280'}});
 latest.resolved.rows[0].fields.salePrice.value='290';h.refresh('2');await settle();
 assert.equal(h.input('빨강 판매가').props.value,'280');assert.equal(h.calls.length,2);
});


test('changing category or product clears old prices even when the new lookup fails',async()=>{
 const h=harness(async(url)=>url.includes('profileId=other')?Response.json({error:'조회 실패'},{status:500}):Response.json(view()));await settle();
 h.input('빨강 판매가').props.onChange({target:{value:'270'}});
 h.select('p','other');await settle();
 assert.equal(h.input('빨강 판매가'),undefined);assert.equal(h.button('옵션 가격 저장').props.disabled,true);
 assert.equal(h.calls.filter(c=>c.init.method==='PUT').length,0);
 h.select('second','profile');await settle();assert.equal(h.input('빨강 판매가').props.value,'200');
 assert.match(h.calls.at(-1).url,/products\/second\//);
});

test('switching category aborts an old save and ignores its late response',async()=>{
 let finish;const pending=new Promise(resolve=>finish=resolve);
 const h=harness(async(url,init)=>init.method==='PUT'?pending:Response.json(view()));await settle();
 h.input('빨강 판매가').props.onChange({target:{value:'270'}});h.button('옵션 가격 저장').props.onClick();
 const write=h.calls.at(-1);h.select('p','other');await settle();assert.equal(write.init.signal.aborted,true);
 const stale=view();stale.resolved.rows[0].fields.salePrice.value='270';finish(Response.json(stale));await settle();
 assert.equal(h.saved,0);assert.equal(h.input('빨강 판매가').props.value,'200');
});

// Recorded source facts and real APIs/SQLite/React/XLSX. Auth, AI, image bytes,
// and the 80719 workbook are fixtures; the final Hub transport is captured.
for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`stage-two and stage-seven price edits survive repricing, retry and handoff (${company.companyCode})`,async()=>{
 const h=mobileIntakeHarness(company),json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
 let prices;
 try{
  const schema=h.load('app/quotation-schema.ts'),fields=['skuId','categoryId',...schema.getQuotationSchema('80719').fields.map(field=>field.id)];
  const workbook=quotationWorkbook(fields),sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'합성 가격 연동 시험',categoryId:'80719',categoryPath:h.context.category.categoryPath,
   template:{name:'synthetic-prices.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},
   mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  h.context.category=profile;h.sqlite.prepare("UPDATE collection_context SET payload=? WHERE job_id='job'").run(JSON.stringify(h.context));
  await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  const options=await json(await h.route(base+'/options')),rows=h.load('app/product-options.ts').optionInputs(options.options);
  rows[0].unitsPerPack=2;rows[5].included=false;
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:options.options.revision,expectedProductVersion:options.productVersion,rows}}));
  const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
  const images=h.sqlite.prepare('SELECT object_key FROM collection_images ORDER BY image_index').all().map(row=>row.object_key);
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{label:{model:'REVIEWED-MODEL',material:'검토 재질'},
   assets:{main:[images[0]],additional:[images[1]],detail:[images[2]],label:[images[3]]}}}}));
  const read=()=>h.route(base+'/quotation-fields').then(json);
  const write=async changes=>{const current=await read();return json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:current.revision,expectedInputFingerprint:current.inputFingerprint,changes}}));};
  let current=await write([
   {fieldKey:'supplyPrice',optionId:null,value:'5000'},{fieldKey:'salePrice',optionId:null,value:'9000'},{fieldKey:'msrp',optionId:null,value:'12000'},
   {fieldKey:'taxType',optionId:null,value:'과세'},{fieldKey:'handlingReason',optionId:null,value:'해당사항없음'},
   {fieldKey:'packagedWeightG',optionId:null,value:'420'},{fieldKey:'packagedDimensionsMm',optionId:null,value:'100*200*300'},
   // This basket schema is a form test contract, not the sunglasses' classification.
   {fieldKey:'storageMaterial',optionId:null,value:''},
  ]);
  const included=current.resolved.rows.filter(row=>row.included),label=id=>included.find(row=>row.optionId===id).optionLabel;
  prices=harness((path,init)=>h.route(path,{method:init?.method??'GET',...(init?.body?{body:JSON.parse(init.body)}:{})}),{productId:product.id,profileId:undefined,version:current.productVersion});
  await prices.idle();
  for(const [key,value] of [['공급가','6000'],['판매가','10000'],['권장소비자가','13000']])prices.input(label('collected-1')+' '+key).props.onChange({target:{value}});
  assert.equal(prices.button('옵션 가격 저장').props.disabled,false);prices.button('옵션 가격 저장').props.onClick();await prices.idle();
  assert.equal(prices.saved,1);
  const initialWrite=JSON.parse(prices.calls.find(call=>call.init.method==='PUT').init.body);
  assert.equal(initialWrite.changes.length,3);assert.ok(initialWrite.changes.every(change=>change.optionId==='collected-1'));
  current=await write([{fieldKey:'salePrice',optionId:'collected-2',value:'11000'},{fieldKey:'msrp',optionId:'collected-2',value:''},
   {fieldKey:'model',optionId:'collected-3',value:'SKU-MODEL'},{fieldKey:'brand',optionId:'collected-3',value:'SKU-BRAND'},
   {fieldKey:'noticeDimensions',optionId:'collected-3',value:'검토 크기'}]);
  prices.setVersion(current.productVersion);await prices.idle();
  assert.equal(prices.input(label('collected-2')+' 판매가').props.value,'11000');
  assert.equal(prices.input(label('collected-2')+' 권장소비자가').props.value,'');
  const saleInput=prices.input(label('collected-2')+' 판매가'),targetCell=nodes(prices.render()).find(node=>node.type==='td'&&nodes(node).some(child=>child.props?.['aria-label']===saleInput.props['aria-label']));
  nodes(targetCell).find(node=>node.type==='button'&&node.props.children==='복원').props.onClick();
  assert.equal(prices.input(label('collected-2')+' 판매가').props.value,'9000');
  prices.button('옵션 가격 저장').props.onClick();await prices.idle();assert.equal(prices.saved,2);
  const old=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));assert.equal(old.submissionReview.errorCount,0,JSON.stringify(old.submissionReview.issues.filter(issue=>issue.kind==='error')));
  const latest=h.sqlite.prepare('SELECT * FROM products').get(),policy={...h.load('app/pricing.ts').pricePolicy(h.settings),exchangeRate:400};
  await json(await h.route(base+'/pricing',{method:'POST',body:{expectedVersion:latest.updated_at,policy}}));
  current=await write(['supplyPrice','salePrice','msrp'].map(fieldKey=>({fieldKey,optionId:null,value:null})));
  prices.setVersion(current.productVersion);await prices.idle();
  const expected=rows.slice(0,5).map(row=>h.load('app/pricing.ts').calculatePrice(h.load('app/product-options.ts').optionSourceCostCny(row.unitCostCny,row.unitsPerPack),policy));
  for(const [index,row] of current.resolved.rows.filter(row=>row.included).entries())for(const [key,fieldLabel] of [['supplyPrice','공급가'],['salePrice','판매가'],['msrp','권장소비자가']]){
   const value=index===0?{supplyPrice:'6000',salePrice:'10000',msrp:'13000'}[key]:index===1&&key==='msrp'?'':String(expected[index][key]);
   assert.equal(row.fields[key].value,value);assert.equal(prices.input(row.optionLabel+' '+fieldLabel).props.value,value);
   assert.equal(row.fields[key].source,index===0||index===1&&key==='msrp'?'manual-option':'pricing');
  }
  assert.equal(current.resolved.rows.find(row=>row.optionId==='collected-3').fields.model.value,'SKU-MODEL');
  const stale=await h.route(base+'/quotation',{method:'POST',body:{action:'export',fingerprint:old.fingerprint}});assert.equal(stale.status,409);
  const requests=h.network.length,beforeRetry=JSON.stringify(current.overrides);
  assert.match(await h.intake(),/저장된 SEO·옵션값/);assert.equal(h.network.length,requests);assert.equal(h.aiSources.length,1);
  current=await read();assert.equal(JSON.stringify(current.overrides),beforeRetry);
  const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));
  assert.equal(preview.submissionReview.errorCount,0,JSON.stringify(preview.submissionReview.issues.filter(issue=>issue.kind==='error')));assert.equal(preview.rows.length,5);
  const bundle=await h.route(base+'/quotation',{method:'POST',body:{action:'export',fingerprint:preview.fingerprint}});assert.equal(bundle.status,200);
  const reader=h.load('app/xlsx-template.ts'),files=await reader.readXlsxArchive(await bundle.arrayBuffer());
  const plan=JSON.parse(new TextDecoder().decode(files.get('supplier-hub-upload-plan.json'))),fieldFile=JSON.parse(new TextDecoder().decode(files.get('quotation-fields.json')));
  const sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(files.get(plan.quotation.file.filename)));
  assert.deepEqual(plan.company,{code:company.companyCode,name:company.companyName});assert.equal(plan.categoryId,'80719');
  for(let index=0;index<5;index++){
   const cells=reader.xlsxHeaders(sheet,'견적서',index+2),row=Object.fromEntries(fields.map((field,column)=>[field,cells[column]]));
   assert.equal(row.categoryId,'80719');assert.equal(row.quantity,index===0?'2':'1');
   for(const key of ['supplyPrice','salePrice','msrp']){const final=current.resolved.rows.find(row=>row.optionId==='collected-'+(index+1)).fields[key];
    assert.equal(row[key],final.value);assert.equal(fieldFile.rows[index].fields[key].value,final.value);}
   if(index===2){assert.equal(row.model,'SKU-MODEL');assert.equal(row.brand,'SKU-BRAND');assert.equal(row.noticeDimensions,'검토 크기');}
  }
  assert.deepEqual(fieldFile.excludedOptions.map(row=>row.optionId),['collected-6']);
  const ui=submissionPackageUI({route:h.route,productId:product.id});await ui.click('견적서 + 첨부 파일 준비');
  assert.equal(ui.button('등록 전송').props.disabled,true);await ui.click('확장에 첨부 파일 준비');ui.choose();await ui.click('등록 전송');
  const handoff=ui.calls.find(call=>call.action==='transmit');assert.ok(handoff);assert.equal(handoff.files.includedOptions,5);
  assert.deepEqual(handoff.files.company,plan.company);assert.deepEqual(ui.alerts(),[]);
  assert.equal(handoff.files.quotation[0].name,plan.quotation.file.filename);
  assert.deepEqual(Buffer.from(handoff.files.quotation[0].base64,'base64'),Buffer.from(files.get(plan.quotation.file.filename)));
  assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{prices?.close();h.close();}
});
