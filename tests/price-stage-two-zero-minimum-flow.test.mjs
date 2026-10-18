import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {available,companies,componentUI,json,mode,plain,sha,text,zeroMinimumFixture,zeroMinimumUI} from './helpers/pricing-stage-two-zero-minimum.mjs';

const sourceFiles=['app/pricing.ts','app/components/price-editor.tsx','app/option-editor-tools.ts','app/components/workspace-settings-editor.tsx','app/components/option-price-preview.tsx','app/api/products/[id]/pricing/route.ts','app/api/products/[id]/quotation-fields/route.ts','app/api/products/[id]/quotation/route.ts'];
const sourceHashes=()=>Object.fromEntries(sourceFiles.map(file=>[file,sha(fs.readFileSync(new URL('../'+file,import.meta.url)))]));
const frozen=sourceHashes(),proof=[];
after(()=>{assert.deepEqual(sourceHashes(),frozen,'Application source changed during final test run');fs.writeFileSync(new URL('../outputs/step695-zero-minimum-api-proof.json',import.meta.url),JSON.stringify({format:'local-zero-minimum-api-proof-v1',sourceHashes:frozen,scope:'Synthetic source, actual local handlers/SQLite/R2; recorded Unand Excel contract reused for Waihop, no live browser or Hub verification',companies:proof,requestCount:proof.reduce((n,row)=>n+row.trace.length,0),externalNetworkRequests:0,browserActions:0,supplierHubWrites:0},null,2)+'\n');});

const save=async(f,policy)=>json(await f.h.route(f.base+'/pricing',{method:'POST',body:{policy,expectedVersion:(await f.product()).updated_at}}));
const countTables=f=>f.h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length;
const safety=f=>{assert.equal(f.h.network.length,0);assert.equal(f.h.aiSources.length,0);assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) AS n FROM supplier_hub_receipts').get().n,0);assert.equal(f.objectSnapshot(),f.originalObjects,'Recorded original workbook object remains byte-identical');};

test('real editor ON-zero preview, explicit save, stage seven and original Excel agree for both isolated companies',{skip:!available},async()=>{
 const fixtures=[];
 try{
  for(const company of companies)for(const integrated of[false,true])fixtures.push(await zeroMinimumFixture(company,{integrated}));
  for(const f of fixtures){
   const other=fixtures.find(value=>value.company.code!==f.company.code),otherBefore=other.allTables(),before=f.immutable(),original=await f.product(),policy=JSON.parse(original.pricing_policy),writes=[],enabledPrices=f.integrated?['8780','14630','19020']:['8960','14930','19410'],disabledPrices=f.integrated?['17560','29270','38050']:['17920','29870','38830'];
   const ui=zeroMinimumUI({loader:f.h.load,sourcePrice:original.source_price_cny,initial:policy,onSave:async value=>{writes.push(plain(value));await save(f,value);}});
   ui.field('최소 공급 마진 (원)').props.onChange({target:{value:'0'}});assert.equal(ui.field('최소 공급 마진 보장').props.checked,true);ui.button('일괄 재계산').props.onClick();assert.equal(writes.length,0);assert.equal(f.immutable(),before);assert.equal((await f.product()).pricing_policy,original.pricing_policy);
   const initialOptions=await json(await f.h.route(f.base+'/options')),preview=componentUI('app/components/option-price-preview.tsx','OptionPricePreview',{loader:f.h.load,props:{productId:f.productId,version:initialOptions.productVersion,policy:ui.policy()},fetcher:path=>f.h.route(path)});
   const previewTree=await preview.flush();assert.equal(previewTree.props['aria-busy'],false);assert.ok(text(previewTree).includes(Number(enabledPrices[0]).toLocaleString('ko-KR')+'원'));if(!f.integrated)assert.match(text(previewTree),/0원/);assert.equal(f.immutable(),before);
   await ui.submit();assert.equal(writes.length,1);const stored=await f.product(),storedPolicy=JSON.parse(stored.pricing_policy);assert.equal(storedPolicy.recalculationMinimumEnabled,true);assert.equal(storedPolicy.minimumMargin,0);assert.equal(storedPolicy.recalculationMode,mode);
   const fields=await f.read(),options=await json(await f.h.route(f.base+'/options')),book=await f.workbook();assert.deepEqual(book.preview.report.company,f.company);
   const targets=f.h.load('app/quotation-price-targets.ts').quotationPriceTargets(fields.resolved.schema.fields),columns=['supplyPrice','salePrice','msrp'].map(key=>f.profile.mappings.find(mapping=>mapping.field===targets[key].primary).column);assert.deepEqual(columns,[29,30,31]);
   for(const [index,row] of options.options.rows.entries()){
    const calculation=f.h.load('app/pricing.ts').calculatePrice(row.unitCostCny,storedPolicy,row.unitsPerPack),resolved=fields.resolved.rows.find(value=>value.optionId===row.id).fields;
    assert.deepEqual(plain(options.pricing.rows[index].calculation),plain(calculation));for(const [j,key] of['supplyPrice','salePrice','msrp'].entries()){assert.equal(resolved[key].value,String(calculation[key]));assert.equal(resolved[targets[key].primary].value,String(calculation[key]));assert.equal(book.cells[index][columns[j]],String(calculation[key]));}
   }
   assert.deepEqual(plain(book.cells[0].slice(29,32)),enabledPrices);assert.equal(options.pricing.rows[0].calculation.marginKrw,f.integrated?2:0);
   const reopened=zeroMinimumUI({loader:f.h.load,initial:storedPolicy});assert.equal(reopened.field('최소 공급 마진 보장').props.checked,true);assert.equal(reopened.policy().minimumMargin,0);
   ui.field('최소 공급 마진 보장').props.onChange({target:{checked:false}});ui.button('일괄 재계산').props.onClick();await ui.submit();assert.equal(JSON.parse((await f.product()).pricing_policy).recalculationMinimumEnabled,false);const off=await f.workbook();assert.deepEqual(plain(off.cells[0].slice(29,32)),disabledPrices);
   ui.field('최소 공급 마진 보장').props.onChange({target:{checked:true}});assert.equal(ui.policy().minimumMargin,0);ui.button('일괄 재계산').props.onClick();await ui.submit();assert.equal(JSON.parse((await f.product()).pricing_policy).recalculationMinimumEnabled,true);const back=await f.workbook();assert.deepEqual(plain(back.cells[0].slice(29,32)),enabledPrices);
   assert.equal(f.immutable(),before);assert.equal(other.allTables(),otherBefore);assert.equal(sha(f.bytes),'58335f443503cc386521b6d2a78fa46c63b0735e68ec21cf7c9a156c0aa9bee6');assert.equal(stored.supplier_hub_status,'미전송');safety(f);
   proof.push({case:'editor-preview-save-reopen-on-zero-off-zero-on-zero',company:f.company,integrated:f.integrated,sourceOfferId:'90000000695',localOnly:true,tableCount:countTables(f),originalWorkbookSha256:sha(f.bytes),originalObjectCount:f.h.objects.size,objectsBeforeSha256:sha(f.originalObjects),objectsAfterSha256:sha(f.objectSnapshot()),sourceAndSettingsBefore:sha(before),sourceAndSettingsAfter:sha(f.immutable()),otherCompanyBefore:sha(otherBefore),otherCompanyAfter:sha(other.allTables()),includedOptions:options.options.rows.length,zeroEnabledFirstPrices:plain(book.cells[0].slice(29,32)),zeroDisabledFirstPrices:plain(off.cells[0].slice(29,32)),restoredFirstPrices:plain(back.cells[0].slice(29,32)),marginKrw:options.pricing.rows[0].calculation.marginKrw,roundingNote:'Enabled zero selects cost plus zero before currency rounding; integrated high option rounds 8778 to 8780, actual margin 2 won.',saveCount:writes.length,trace:plain(f.trace),receiptCount:0,registered:false,externalRequests:0});
  }
  const snapshots=fixtures.map(f=>f.allTables());for(const [index,f] of fixtures.entries()){const other=fixtures.find(value=>value.company.code!==f.company.code);await json(await f.h.route(other.base+'/pricing',{method:'POST',body:{policy:JSON.parse((await f.product()).pricing_policy),expectedVersion:(await f.product()).updated_at}}),404);assert.equal(f.allTables(),snapshots[index]);proof[index].trace=plain(f.trace);proof[index].foreignProductSaveStatus=404;}
 }finally{for(const f of fixtures)f.h.close();}
});

for(const company of companies)test(`manual option values and common blanks survive ON-zero/OFF-zero Excel recalculation (${company.code})`,{skip:!available},async()=>{
 const f=await zeroMinimumFixture(company,{pack:3});try{
  const view=await f.read(),targets=f.h.load('app/quotation-price-targets.ts').quotationPriceTargets(view.resolved.schema.fields),changes=[...targets.salePrice.linked.map(fieldKey=>({fieldKey,optionId:'collected-1',value:'98765'})),...targets.supplyPrice.linked.map(fieldKey=>({fieldKey,optionId:'collected-2',value:''})),...targets.msrp.linked.map(fieldKey=>({fieldKey,optionId:null,value:''}))];
  await json(await f.h.route(f.base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));const overrides=f.h.sqlite.prepare('SELECT payload FROM product_quotation_fields').get().payload,before=f.immutable(),initial=JSON.parse((await f.product()).pricing_policy),outputs=[];
  for(const enabled of[true,false,true]){await save(f,{...initial,minimumMargin:0,recalculationMode:mode,recalculationMinimumEnabled:enabled});const result=await f.read(),first=result.resolved.rows.find(row=>row.optionId==='collected-1').fields,second=result.resolved.rows.find(row=>row.optionId==='collected-2').fields,book=await f.workbook();
   assert.equal(first.supplyPrice.value,enabled?'26880':'53760');assert.equal(first.salePrice.value,'98765');assert.equal(first.salePrice.source,'manual-option');assert.equal(first.msrp.value,'');assert.equal(first.msrp.source,'manual-common');assert.equal(second.supplyPrice.value,'');assert.equal(second.supplyPrice.source,'manual-option');assert.equal(second.salePrice.value,enabled?'3050':'6100');
   assert.deepEqual(plain(book.cells[0].slice(29,32)),[enabled?'26880':'53760','98765','']);assert.deepEqual(plain(book.cells[1].slice(29,32)),['',enabled?'3050':'6100','']);assert.equal(f.h.sqlite.prepare('SELECT payload FROM product_quotation_fields').get().payload,overrides);assert.equal(f.immutable(),before);outputs.push({enabled,first:plain(book.cells[0].slice(29,32)),second:plain(book.cells[1].slice(29,32))});
  }
  safety(f);proof.push({case:'manual-values-blanks-pack-three',company,integrated:false,tableCount:countTables(f),immutableBefore:sha(before),immutableAfter:sha(f.immutable()),originalWorkbookSha256:sha(f.bytes),originalObjectCount:f.h.objects.size,objectsBeforeSha256:sha(f.originalObjects),objectsAfterSha256:sha(f.objectSnapshot()),quotationOverridesSha256:sha(overrides),outputs,trace:plain(f.trace),receiptCount:0,registered:false});
 }finally{f.h.close();}
});

test('invalid switch and stale versions cannot mutate the stored policy or any table',{skip:!available},async()=>{
 const f=await zeroMinimumFixture();try{
  const initial=await f.product(),policy=JSON.parse(initial.pricing_policy),before=f.allTables();for(const value of[null,0,'true',{},[]])await json(await f.h.route(f.base+'/pricing',{method:'POST',body:{policy:{...policy,minimumMargin:0,recalculationMode:mode,recalculationMinimumEnabled:value},expectedVersion:initial.updated_at}}),400);
  await json(await f.h.route(f.base+'/pricing',{method:'POST',body:{policy:{...policy,recalculationMinimumEnabled:false},expectedVersion:initial.updated_at}}),400);assert.equal(f.allTables(),before);
  await save(f,{...policy,minimumMargin:0,recalculationMinimumEnabled:true});assert.equal(JSON.parse((await f.product()).pricing_policy).recalculationMode,undefined);assert.equal((await f.product()).supply_price,f.h.load('app/pricing.ts').calculatePrice(initial.source_price_cny,{...policy,minimumMargin:0}).supplyPrice,'marker alone keeps initial draft ratio using actual representative source cost');
  const after=f.allTables();await json(await f.h.route(f.base+'/pricing',{method:'POST',body:{policy:{...policy,minimumMargin:0,recalculationMode:mode,recalculationMinimumEnabled:true},expectedVersion:initial.updated_at}}),409);assert.equal(f.allTables(),after);safety(f);proof.push({case:'invalid-switches-manual-save-marker-stale-version',company:f.company,invalidRequestCount:6,staleStatus:409,initialFormulaPreserved:true,trace:plain(f.trace),receiptCount:0,registered:false});
 }finally{f.h.close();}
});
