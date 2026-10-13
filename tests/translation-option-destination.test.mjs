import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
const plain=value=>JSON.parse(JSON.stringify(value)),companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
const h=mobileIntakeHarness(),evidence=h.load('app/translation-attribute-evidence.ts'),model=h.load('app/automation/translation.ts'),google=h.load('app/automation/google-translation-draft.ts'),integrated=h.load('app/translation-integrated-adoption.ts'),contentModel=h.load('app/product-content.ts'),optionsModel=h.load('app/product-options.ts');h.close();
const version='2026-10-13T01:00:00.000Z',after='2026-10-13T01:00:01.000Z';
const rawSource={title:'收纳箱',description:'商品说明',provenance:'manual',reference:'Local synthetic source',attributes:[{name:'option:bad',value:'白色\n大号'},{name:'option:good',value:'黑色'},{name:'상품속성: 材质',value:'棉'}]};
const rawDraft=value=>({title:'수납함',description:'상품 설명',keywords:['수납함'],warnings:[],attributes:[{sourceIndex:0,name:'옵션',value},{sourceIndex:1,name:'옵션',value:'검정'},{sourceIndex:2,name:'재질',value:'면'}]});
function documents(value='흰색\n대형',instructionsVersion='sourceflow-translation-v6'){
 const content=contentModel.emptyProductContent('p');content.seo.title={value:'收纳箱',provenance:'collected',updatedAt:version};content.seo.description={value:'商品说明',provenance:'collected',updatedAt:version};content.label.material={value:'棉',provenance:'collected',updatedAt:version};content.assets.detail={value:['owner/existing.png'],provenance:'manual',updatedAt:version};
 const options=optionsModel.applyOptionRows(optionsModel.emptyProductOptions('p'),[{...optionsModel.emptyOptionInput('bad'),originalName:'白色\n大号',supplierSku:'632100001',unitCostCny:5.5,minimumOrderQuantity:3,stock:0,unitsPerPack:3,included:true,imageKey:'owner/existing.png'},{...optionsModel.emptyOptionInput('good'),originalName:'黑色',supplierSku:'632100002',unitCostCny:6.5,minimumOrderQuantity:2,stock:null,included:true}],version);
 const job={id:'63200000-0000-4000-8000-000000000001',productId:'p',productVersion:version,contentRevision:0,status:'completed',review:{source:plain(rawSource),instructionsVersion,destination:'Google 번역',model:'google-translate-gtx',maxOutputTokens:0},result:{model:'google-translate-gtx',draft:rawDraft(value),appliedToContent:false}};
 return{content,options,job};
}

test('exact option bindings use the existing UTF-16 500/200 and one-line destination contract without rewriting strings',()=>{
 for(const [name,max]of [['option:sku_1',500],['option-color:sku_1',200],['option-size:sku_1',200]]){
  for(const value of ['한'.repeat(max),'😀'.repeat(max/2),'  한국어  '])assert.equal(evidence.invalidOptionTranslationDestination(name,value),false);
  for(const value of ['한'.repeat(max+1),'흰색\n대형','흰색\r대형','흰색\t대형','흰색\u0000대형','흰색\u000b대형',''])assert.equal(evidence.invalidOptionTranslationDestination(name,value),true);
 }
 for(const name of ['상품속성: option-color:sku_1','material','option-color:bad id','option-width:sku_1'])assert.equal(evidence.invalidOptionTranslationDestination(name,'한'.repeat(600)+'\n원문'),false);
 assert.equal(evidence.translationAttributeIssue({name:'option:a',value:'白色'},{name:'옵션',value:'흰색\n대형'}),'invalid-option-destination');
 assert.equal(evidence.translationAttributeIssue({name:'option:a',value:'白色'},{name:'옵션',value:'白色'}),'chinese-copy');assert.equal(evidence.translationAttributeIssue({name:'option:a',value:'白色 3'},{name:'옵션',value:'흰색 4'}),'foreign-number');
});

for(const value of ['흰색\n대형','흰색\t대형','흰색\u0000대형','흰색\u000b대형','한'.repeat(501)])test(`v6 omits one unusable bound option and retains valid SEO and attribute indexes (${JSON.stringify(value).slice(0,35)})`,()=>{
 const source=plain(rawSource),draft=rawDraft(value),before=JSON.stringify({source,draft}),validated=model.validateTranslationDraft(draft,source,'sourceflow-translation-v6');
 assert.deepEqual(plain(validated.attributes.map(row=>row.sourceIndex)),[1,2]);assert.equal(validated.title,'수납함');assert.equal(validated.description,'상품 설명');assert.deepEqual(plain(model.translationAttributeCoverage(source,validated)),{expected:3,returned:2,missingSourceIndexes:[0]});assert.match(validated.warnings.join(' '),/옵션명 500자.*200자.*한 줄/);assert.match(validated.warnings.join(' '),/누락 1개/);assert.equal(JSON.stringify({source,draft}),before);
});

test('v6 color and size bounds stay field-specific while general product multiline attributes remain usable',()=>{
 const source={...plain(rawSource),attributes:[{name:'option-color:bad',value:'浅色'},{name:'option-size:bad',value:'大型'},{name:'상품속성: 说明',value:'文字\n文字'}]},draft={...rawDraft('unused'),attributes:[{sourceIndex:0,name:'색상',value:'색'.repeat(201)},{sourceIndex:1,name:'사이즈',value:'형'.repeat(201)},{sourceIndex:2,name:'설명',value:'제품\n설명'}]};
 const validated=model.validateTranslationDraft(draft,source,'sourceflow-translation-v6');assert.deepEqual(plain(validated.attributes),[{sourceIndex:2,name:'설명',value:'제품\n설명'}]);assert.deepEqual(plain(model.translationAttributeCoverage(source,validated).missingSourceIndexes),[0,1]);
});

test('legacy validation and manual legacy application retain their existing rejection rules',()=>{
 for(let index=1;index<=5;index++){
  const version='sourceflow-translation-v'+index,source=plain(rawSource),draft=rawDraft('흰색\n대형');assert.equal(model.validateTranslationDraft(draft,source,version).attributes.length,3);assert.throws(()=>model.validateTranslationDraft(rawDraft('흰색\u0000대형'),source,version));const data=documents('흰색\n대형',version),before=JSON.stringify(data);assert.throws(()=>integrated.integratedTranslationPlan(data.content,data.options,data.job,data.job.productVersion));assert.equal(JSON.stringify(data),before);
 }
});

test('invalid response envelope, general control syntax and source identities remain hard failures',()=>{
 for(const value of [null,33,'한'.repeat(2001)])assert.throws(()=>model.validateTranslationDraft(rawDraft(value),rawSource,'sourceflow-translation-v6'));
 for(const change of [draft=>{draft.attributes[0].sourceIndex=3;},draft=>{draft.attributes.push({...draft.attributes[0]});},draft=>{draft.attributes[0].name='옵션\u0000';},draft=>{draft.attributes[2].value='면\u0000';}]){const draft=rawDraft('흰색\n대형');change(draft);assert.throws(()=>model.validateTranslationDraft(draft,rawSource,'sourceflow-translation-v6'));}
});

test('Google single and marker batches omit unusable options without extra requests or partial text adoption',async()=>{
 const source={...plain(rawSource),attributes:[{name:'option:multiline',value:'红\n型号'},{name:'option:long',value:'绿'},{name:'option-color:color',value:'蓝'},{name:'option-size:size',value:'紫'},{name:'option:control',value:'黄'},{name:'option:good',value:'黑'},{name:'상품속성: 材质',value:'棉'}]},dictionary=new Map([['收纳箱','수납함'],['商品说明','상품 설명'],['红\n型号','빨강\n형식'],['绿','초'.repeat(501)],['蓝','파'.repeat(201)],['紫','자'.repeat(201)],['黄','노\t랑'],['黑','검정'],['材质','재질'],['棉','면']]),queries=[];
 const before=JSON.stringify(source),result=await google.buildGoogleTranslationDraft(source,async target=>{const q=new URL(target).searchParams.get('q');queries.push(q);const translate=value=>{assert.ok(dictionary.has(value));return dictionary.get(value);};const text=q.startsWith('[[YFTR')?q.split('\n').map(line=>{const match=/^(\[\[YFTR\d{6}\]\]) (.+)$/u.exec(line);assert.ok(match);return match[1]+' '+translate(match[2]);}).join('\n'):translate(q);return Response.json([[[text,q]],null,'zh-CN']);});
 assert.equal(queries.length,4);assert.equal(result.requests,4);assert.deepEqual(plain(result.draft.attributes.map(row=>row.sourceIndex)),[5,6]);assert.equal(result.draft.title,'수납함');assert.equal(result.draft.description,'상품 설명');assert.match(result.draft.warnings.join(' '),/번역 5개.*원문/);assert.equal(JSON.stringify(source),before);assert.deepEqual(plain(model.translationAttributeCoverage(source,result.draft).missingSourceIndexes),[0,1,2,3,4]);
});

test('old completed v6 replay keeps raw provider evidence and valid fields while unusable option fields remain pending',()=>{
 const data=documents(),before=JSON.stringify(data),plan=integrated.integratedTranslationPlan(data.content,data.options,data.job,version),next=integrated.applyIntegratedOptions(data.options,plan,after);assert.equal(plan.patch.seo.title,'수납함');assert.equal(plan.patch.seo.description,'상품 설명');assert.equal(plan.patch.label.material,'면');assert.equal(next.rows[0].translatedName,'');assert.equal(next.rows[0].provenance.translatedName,'unverified');assert.equal(next.rows[1].translatedName,'검정');assert.equal(next.rows[1].provenance.translatedName,'translated');assert.match(plan.skipped.join(' '),/번역 1개.*원문/);assert.deepEqual(plain(model.translationAttributeCoverage(data.job.review.source,data.job.result.draft).missingSourceIndexes),[0]);assert.equal(JSON.stringify(data),before);
 for(const key of ['supplierSku','unitCostCny','unitsPerPack','minimumOrderQuantity','stock','imageKey'])for(let i=0;i<2;i++)assert.equal(next.rows[i][key],data.options.rows[i][key]);
 data.content.seo.title={value:'',provenance:'manual',updatedAt:version};data.options.rows[1].translatedName='직접 수정';data.options.rows[1].provenance.translatedName='manual';const manual=integrated.integratedTranslationPlan(data.content,data.options,data.job,version);assert.equal(manual.patch.seo.title,undefined);assert.equal(manual.rows[1].translatedName,'직접 수정');assert.equal(manual.rows[0].translatedName,'');
});

for(const company of companies)test(`owned API previews and atomically applies stored v6 valid fields without changing raw result/source, price or image references (${company.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const data=documents(),product={id:'p',owner_id:'owner',source_url:'https://detail.1688.com/offer/632010000022.html',title:'原文',source_price_cny:5.5,exchange_rate:350,supply_margin:50,coupang_margin:40,supply_price:3850,sale_price:6420,msrp:8340,image_keys:'["owner/existing.png"]',created_at:version,updated_at:version};data.content.revision=1;data.job.contentRevision=1;const entries=Object.entries(product);h.sqlite.prepare(`INSERT INTO products(${entries.map(([key])=>key).join(',')}) VALUES(${entries.map(()=>'?').join(',')})`).run(...entries.map(([,value])=>value));
  h.sqlite.prepare('INSERT INTO product_content VALUES(?,?,?,?,?)').run('p','owner',1,JSON.stringify(data.content),version);h.sqlite.prepare('INSERT INTO product_options VALUES(?,?,?,?,?)').run('p','owner',data.options.revision,JSON.stringify(data.options),version);h.sqlite.prepare('INSERT INTO translation_jobs(id,owner_id,product_id,idempotency_key,request_fingerprint,product_version,content_revision,status,review_fingerprint,review,expires_at,result,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(data.job.id,'owner','p','local-replay','a'.repeat(64),version,1,'completed','a'.repeat(64),JSON.stringify(data.job.review),'2099-01-01T00:00:00.000Z',JSON.stringify(data.job.result),version);
  const raw=h.sqlite.prepare('SELECT * FROM translation_jobs').get(),beforeProduct=h.sqlite.prepare("SELECT * FROM products WHERE id='p'").get(),request=body=>h.route('/api/products/p/translation-apply',{method:'POST',body:{jobId:data.job.id,expectedVersion:version,...body}}),preview=await request({action:'preview'});assert.equal(preview.status,200,await preview.clone().text());const proof=await preview.json();assert.match(proof.skipped.join(' '),/옵션명 500자/);assert.equal(h.sqlite.prepare("SELECT revision FROM product_content WHERE product_id='p'").get().revision,1);
  const applied=await request({action:'apply',fingerprint:proof.fingerprint});assert.equal(applied.status,200,await applied.clone().text());const content=JSON.parse(h.sqlite.prepare("SELECT payload FROM product_content WHERE product_id='p'").get().payload),options=JSON.parse(h.sqlite.prepare("SELECT payload FROM product_options WHERE product_id='p'").get().payload),current=h.sqlite.prepare("SELECT * FROM products WHERE id='p'").get();assert.equal(content.seo.title.value,'수납함');assert.equal(content.seo.description.value,'상품 설명');assert.equal(content.label.material.value,'면');assert.equal(options.rows[0].translatedName,'');assert.equal(options.rows[1].translatedName,'검정');assert.deepEqual(h.sqlite.prepare('SELECT * FROM translation_jobs').get(),raw);for(const key of ['title','source_url','source_price_cny','exchange_rate','supply_margin','coupang_margin','supply_price','sale_price','msrp','image_keys'])assert.equal(current[key],beforeProduct[key]);assert.deepEqual(content.assets.detail.value,['owner/existing.png']);assert.equal((await request({action:'apply',fingerprint:proof.fingerprint})).status,409);assert.deepEqual(h.network,[]);
 }finally{h.close();}
});
