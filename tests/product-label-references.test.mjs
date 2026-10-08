import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
const plain=value=>JSON.parse(JSON.stringify(value));
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'));
async function fixture(companyCode='A01464742',companyName='와이홉'){
 const h=mobileIntakeHarness({companyCode,companyName});try{
  const get=h.bindings.FILES.get;
  h.bindings.FILES.get=async(key,options)=>{const object=await get(key),bytes=h.objects.get(key);if(!object||!bytes)return object;const offset=options?.range?.offset??0,end=options?.range?.length===undefined?bytes.byteLength:offset+options.range.length;return {...object,body:new Response(bytes.slice(offset,end)).body};};
  const schema=h.load('app/quotation-schema.ts').getQuotationSchema('80719'),profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'최종 라벨 연결 시험',categoryId:'80719',categoryPath:schema.categoryPath,template:null,mappings:[]});
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,endpoint=base+'/product-labels?profileId='+profile.id,quotationEndpoint=base+'/quotation-fields?profileId='+profile.id,quote=await json(await h.route(quotationEndpoint));
  const selected=quote.resolved.rows.find(row=>row.optionId).optionId,other=quote.resolved.rows.filter(row=>row.optionId)[1].optionId,input={productId:product.id,optionId:selected,endpoint,quotationEndpoint},calls=[];
  const request=async(url,init={})=>{calls.push({url,method:init.method??'GET',body:init.body});return url==='/api/files'?h.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',body:init.body})):h.route(url,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})});};
  const read=()=>h.load('app/product-label-references.ts').readProductLabelReferences(input,request),label=()=>h.route(endpoint).then(json),quotation=()=>h.route(quotationEndpoint).then(json);
  const saveLabel=async changes=>{const view=await label();return json(await h.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));};
  const saveQuote=async changes=>{const view=await quotation();return json(await h.route(quotationEndpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));};
  const source=()=>Object.fromEntries(['product_content','product_options','product_price_policy','product_labels'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table+' WHERE product_id=?').get(product.id)??null]));
  return {h,product,base,profile,input,selected,other,calls,request,read,label,quotation,saveLabel,saveQuote,source};
 }catch(error){h.close();throw error;}
}

test('explicit selected blank, replacement and common exclusion change only final reference overrides, preserving files and nine-row content',async()=>{
 const f=await fixture();try{
  const helper=f.h.load('app/product-label-references.ts'),keys=(await f.quotation()).imageKeys;
  await f.saveQuote([{optionId:null,fieldKey:'labelImages',value:keys[0]},{optionId:f.selected,fieldKey:'labelImages',value:''},{optionId:f.other,fieldKey:'labelImages',value:keys[2]}]);
  const before=await f.read(),original=plain(before.quotation.overrides),source=plain(f.source()),bytes=[...f.h.objects].map(([key,value])=>[key,Buffer.from(value).toString('hex')]);
  assert.deepEqual(plain(before.keys),[],'manual selected blank must not fall back to the common label');
  const replaced=await helper.saveProductLabelReferences(f.input,before,[keys[1]],f.request);assert.deepEqual(plain(replaced.keys),[keys[1]]);assert.equal(replaced.quotation.overrides.options[f.selected].labelImages,keys[1]);
  assert.deepEqual(plain(replaced.quotation.overrides.common),original.common);assert.deepEqual(plain(replaced.quotation.overrides.options[f.other]),original.options[f.other]);assert.deepEqual(plain(f.source()),source);
  const common={...f.input,optionId:null},commonBefore=await helper.readProductLabelReferences(common,f.request),cleared=await helper.saveProductLabelReferences(common,commonBefore,[],f.request);
  assert.equal(cleared.quotation.overrides.common.labelImages,'');assert.equal(cleared.quotation.overrides.options[f.selected].labelImages,keys[1]);assert.equal(cleared.quotation.overrides.options[f.other].labelImages,keys[2]);
  assert.deepEqual([...f.h.objects].map(([key,value])=>[key,Buffer.from(value).toString('hex')]),bytes);assert.deepEqual(plain(f.source()),source);assert.ok(f.calls.every(call=>call.url!=='/api/files'&&!call.url.endsWith('/attachments')));
 }finally{f.h.close();}
});

for(const [code,name] of [['A01464742','와이홉'],['A01526306','유앤채']])test(`nine-row edit, regenerate and explicit old-reference exclusion remove the stale issue without deleting history (${code})`,async()=>{
 const f=await fixture(code,name);try{
  const attachment=f.h.load('app/product-label-attachment.ts'),helper=f.h.load('app/product-label-references.ts');
  const attach=async()=>attachment.attachProductLabel({...f.input,renderedView:await f.label(),blob:new Blob([png],{type:'image/png'}),uploadedKey:null,onUploaded(){}},f.request);
  await f.saveLabel([{optionId:f.selected,fieldKey:'material',value:'직접 확인한 최초 원료'}]);const old=await attach();await f.saveLabel([{optionId:f.selected,fieldKey:'material',value:'직접 확인한 수정 원료'}]);const fresh=await attach();assert.notEqual(old.key,fresh.key);
  const report=()=>f.h.route(f.base+'/submission-review?profileId='+f.profile.id).then(json),stale=value=>value.issues.filter(issue=>issue.code==='GENERATED_PRODUCT_LABEL_STALE');
  assert.equal(stale(await report()).length,1);const before=await f.read(),source=plain(f.source()),overrides=plain(before.quotation.overrides);assert.ok(before.keys.includes(old.key));assert.ok(before.keys.includes(fresh.key));
  const saved=await helper.saveProductLabelReferences(f.input,before,before.keys.filter(key=>key!==old.key),f.request);assert.deepEqual(plain(saved.keys),[fresh.key]);assert.equal(stale(await report()).length,0);
  assert.deepEqual(plain(f.source()),source);assert.deepEqual(plain(saved.quotation.overrides.common),overrides.common);for(const [id,values] of Object.entries(overrides.options))if(id!==f.selected)assert.deepEqual(plain(saved.quotation.overrides.options[id]),values);
  assert.deepEqual(f.h.objects.get(old.key),png);assert.deepEqual(f.h.objects.get(fresh.key),png);assert.equal((await f.h.bindings.FILES.head(old.key)).customMetadata.productLabelRecipe,'product-label-png-v1');assert.ok(!f.h.network.includes('supplier.coupang.com'));
 }finally{f.h.close();}
});

test('lost reference PUT acknowledgement is confirmed read-first on explicit retry without another write',async()=>{
 const f=await fixture();try{
  const helper=f.h.load('app/product-label-references.ts'),before=await f.read(),chosen=[before.view.imageKeys[0]];let lose=true,unavailable=false;
  const request=async(url,init={})=>{if(unavailable&&init.method!=='PUT')return Response.json({error:'private recovery read failure'},{status:503});const response=await f.request(url,init);if(lose&&init.method==='PUT'){lose=false;unavailable=true;throw Error('committed acknowledgement lost');}return response;};
  await assert.rejects(helper.saveProductLabelReferences(f.input,before,chosen,request),error=>error instanceof helper.ProductLabelReferenceSaveError&&error.uncertain);
  assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);unavailable=false;const recovered=await helper.saveProductLabelReferences(f.input,before,chosen,request);assert.deepEqual(plain(recovered.keys),chosen);assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);
 }finally{f.h.close();}
});

test('foreign keys, stale whole-scope CAS and unchanged malformed success acknowledgements cannot claim reference save success',async()=>{
 const f=await fixture();try{
  const helper=f.h.load('app/product-label-references.ts'),before=await f.read(),chosen=[before.view.imageKeys[0]],original=plain(before.quotation.overrides);const calls=f.calls.length;
  await assert.rejects(helper.saveProductLabelReferences(f.input,before,['foreign/private.png'],f.request),/저장된 이미지/);assert.equal(f.calls.length,calls);
  await assert.rejects(helper.saveProductLabelReferences(f.input,before,chosen,async(url,init={})=>init.method==='PUT'?Response.json(before.quotation):f.request(url,init)),/다릅니다/);assert.deepEqual(plain((await f.quotation()).overrides),original);
  let raced=false;await assert.rejects(helper.saveProductLabelReferences(f.input,before,chosen,async(url,init={})=>{if(init.method==='PUT'&&!raced){raced=true;await f.saveQuote([{optionId:f.other,fieldKey:'searchTags',value:'동시 검토값'}]);}return f.request(url,init);}),/변경|바뀌|다릅니다/);
  const latest=await f.quotation();assert.equal(latest.overrides.options[f.selected]?.labelImages,undefined);assert.equal(latest.overrides.options[f.other].searchTags,'동시 검토값');assert.deepEqual(plain(latest.overrides.common),original.common);
 }finally{f.h.close();}
});

test('explicit refresh accepts unchanged label references after nine-row save and rejects a competing reference edit',async()=>{
 const f=await fixture();try{
  const helper=f.h.load('app/product-label-references.ts');await f.saveQuote([{optionId:f.selected,fieldKey:'labelImages',value:(await f.quotation()).imageKeys[0]}]);const before=await f.read();
  await f.saveLabel([{optionId:f.selected,fieldKey:'manufacturer',value:'새로 검토한 제조원'}]);const latest=await f.read();helper.verifyProductLabelReferenceRefresh(f.input,before,latest);
  await f.saveQuote([{optionId:f.selected,fieldKey:'labelImages',value:latest.view.imageKeys[1]}]);await assert.rejects(async()=>helper.verifyProductLabelReferenceRefresh(f.input,latest,await f.read()),/다른 변경/);
 }finally{f.h.close();}
});
