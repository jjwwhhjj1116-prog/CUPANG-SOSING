import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as parse5 from 'parse5';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

function load(file,cache=new Map()){
 if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,crypto,URL,URLSearchParams,Response,TextEncoder,TextDecoder,AbortController,setTimeout,clearTimeout,fetch:()=>{throw Error('Live HTTP forbidden');},require(name){if(name==='parse5')return parse5;assert.ok(name.startsWith('@/app/'),name);return load(name.slice(2)+'.ts',cache);}});return exports;
}
const model=load('app/automation/translation.ts'),drafts=load('app/automation/google-translation-draft.ts'),plain=value=>JSON.parse(JSON.stringify(value));
const source={title:'纯棉收纳袋 ABC-005',description:'尺寸 10 cm',attributes:[{name:'材质',value:'棉'},{name:'option-color:sku_1',value:'黑色'},{name:'option-size:sku_1',value:'10 cm'},{name:'第二材质',value:'棉'}],provenance:'manual',reference:'Local fixture only',category:{id:'69900',path:['패션','선글라스']},guidance:{features:'인증 999 추가 금지',keywords:'unsupported term'}};
const translated=new Map([['纯棉收纳袋 ABC-005','면 수납 주머니 ABC-005'],['尺寸 10 cm','크기 10 cm'],['材质','소재'],['棉','면'],['黑色','검정'],['第二材质','보조 소재']]);
const googleReply=value=>Response.json([[[value,'原文']],null,'zh-CN']);
const config=model.requireTranslationConfig({SOURCEFLOW_TEXT_PROVIDER:'google-free'});

test('Google is keyless and reviewed as direct translation without AI tokens or a paid pricing link',async()=>{
 const status=model.translationConfiguration({SOURCEFLOW_TEXT_PROVIDER:'google-free',SOURCEFLOW_TEXT_MODEL:'old-paid-model',SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS:'9999'});
 assert.equal(status.configured,true);assert.equal(status.model,'google-translate-gtx');assert.equal(config.apiKey,'');assert.equal(config.maxOutputTokens,0);
 const review=await model.prepareTranslationReview(source,config);
 assert.equal(review.destination,'Google 번역');assert.equal(review.instructionsVersion,'sourceflow-translation-v6');assert.equal(review.pricingUrl,'');assert.match(review.paidNotice,/5,000자/);
 let calls=0;await assert.rejects(()=>model.executeTranslation({...review,destination:'Cloudflare Workers AI'},config,async()=>{calls++;}),error=>error.code==='CONFIGURATION_CHANGED');assert.equal(calls,0);
});

test('exact Google GET translates unique text once while preserving numbers, source indexes and option identifiers',async()=>{
 const review=await model.prepareTranslationReview(source,config),queries=[];
 const result=await model.executeTranslation(review,config,async(url,request)=>{
  const parsed=new URL(url);assert.equal(parsed.origin,'https://translate.googleapis.com');assert.equal(parsed.pathname,'/translate_a/single');assert.equal(parsed.searchParams.get('client'),'gtx');assert.equal(parsed.searchParams.get('sl'),'auto');assert.equal(parsed.searchParams.get('tl'),'ko');assert.equal(parsed.searchParams.get('dt'),'t');assert.equal(request.method,'GET');assert.equal(request.body,undefined);assert.equal(request.headers.Authorization,undefined);
  const q=parsed.searchParams.get('q');queries.push(q);assert.ok(translated.has(q),q);return googleReply(translated.get(q));
 });
 assert.equal(queries[0],source.title);assert.equal(queries.filter(q=>q==='棉').length,1);assert.equal(queries.length,6);assert.ok(!queries.includes('10 cm'));assert.ok(!queries.some(q=>q.includes('999')));
 assert.equal(result.usage,null);assert.equal(result.translationRequests,6);assert.deepEqual(plain(result.detectedSourceLanguages),['zh-CN']);assert.equal(result.draft.title,'면 수납 주머니 ABC-005');assert.equal(result.draft.attributes[1].name,'option-color:sku_1');assert.equal(result.draft.attributes[1].sourceIndex,1);assert.equal(result.draft.attributes[1].value,'검정');assert.equal(result.draft.attributes[2].value,'10 cm');assert.equal(result.appliedToContent,false);
 assert.ok(result.draft.keywords.every(word=>word.length<=20));assert.ok(result.draft.keywords.join(', ').length<=150);
});

test('429, malformed or unchanged Chinese product names fail before sending attributes and never retry or charge AI',async()=>{
 for(const response of [new Response('private upstream error',{status:429}),new Response('<html>error</html>'),googleReply(source.title)]){
  let calls=0;await assert.rejects(()=>model.executeTranslation(awaitReview(),config,async()=>{calls++;return response;}),error=>{assert.equal(error.code,'GOOGLE_TRANSLATION_FAILED');assert.equal(error.mayHaveBeenCharged,false);if(response.status===429)assert.match(error.message,/HTTP 429.*한도/);assert.doesNotMatch(error.message,/private upstream/);return true;});assert.equal(calls,1);
 }
 function awaitReview(){return {...config,source,destination:'Google 번역',instructionsVersion:'sourceflow-translation-v6'};}
});

test('missing attributes stay missing, long descriptions are not truncated, and invented numbers cannot be adopted',async()=>{
 const review=await model.prepareTranslationReview({...source,description:'中'.repeat(5001)},config);let calls=0;
 const result=await model.executeTranslation(review,config,async url=>{calls++;const q=new URL(url).searchParams.get('q');return q==='材质'?new Response('error',{status:429}):googleReply(translated.get(q));});
 assert.equal(result.draft.description,'');assert.deepEqual(plain(result.draft.attributes.map(pair=>pair.sourceIndex)),[1,2]);assert.match(result.draft.warnings.join(' '),/누락 2개/);assert.match(result.draft.warnings.join(' '),/HTTP 429.*중단/);assert.equal(calls,4);
 let inventedCalls=0;const inventedReview=await model.prepareTranslationReview({...source,attributes:[]},config);await assert.rejects(()=>model.executeTranslation(inventedReview,config,async url=>{inventedCalls++;return googleReply(new URL(url).searchParams.get('q')===source.title?'면 주머니 999':'크기 10 cm');}),error=>error.code==='UNSUPPORTED_FACT'&&!error.mayHaveBeenCharged);assert.equal(inventedCalls,2);
});

test('one batch respects the Free subrequest cap and prioritizes exact options before generic attributes',async()=>{
 const many={...source,description:'',attributes:[...Array.from({length:80},(_,i)=>({name:`名称${i}`,value:`值${i}`})),{name:'option:sku_last',value:'黑色'}]};let calls=0,active=0,maxActive=0;
 const result=await drafts.buildGoogleTranslationDraft(many,async url=>{calls++;active++;maxActive=Math.max(active,maxActive);await new Promise(resolve=>setTimeout(resolve,1));active--;const q=new URL(url).searchParams.get('q');return googleReply(q===source.title?'면 수납 주머니 ABC-005':q==='黑色'?'검정':`검토 ${q.match(/\d+/)?.[0]??''}`);});
 assert.equal(calls,49);assert.ok(maxActive<=3);assert.ok(result.draft.attributes.some(pair=>pair.sourceIndex===80&&pair.name==='option:sku_last'&&pair.value==='검정'));assert.match(result.draft.warnings.join(' '),/한도/);
 let failures=0;const stopped=await drafts.buildGoogleTranslationDraft(many,async url=>{failures++;return new URL(url).searchParams.get('q')===source.title?googleReply('면 수납 주머니 ABC-005'):new Response('error',{status:429});});assert.equal(failures,4);assert.match(stopped.draft.warnings.join(' '),/HTTP 429.*중단/);
});

for(const translatedTitle of [false,true])test(`the first Google 429 stops unsent texts despite successful in-flight responses (retained title: ${translatedTitle})`,async()=>{
 const input={...source,title:translatedTitle?'한국어 선글라스':'太阳镜',description:'',attributes:Array.from({length:20},(_,index)=>({name:`option-color:sku_${index}`,value:`颜色${index}`}))},queries=[];
 const result=await drafts.buildGoogleTranslationDraft(input,async url=>{
  const q=new URL(url).searchParams.get('q');queries.push(q);
  if(q===input.title)return googleReply('선글라스');
  if(q==='颜色0')return new Response('private limit body',{status:429,headers:{'retry-after':'3600'}});
  return googleReply(`색상 ${q.match(/\d+/u)[0]}`);
 });
 assert.equal(queries.length,translatedTitle?3:4,'only the initial concurrent requests may settle after the first quota response');
 assert.deepEqual(plain(result.draft.attributes.map(attribute=>attribute.sourceIndex)),[1,2]);
 assert.equal(result.draft.title,translatedTitle?input.title:'선글라스');assert.equal(result.requests,queries.length);
 assert.match(result.draft.warnings.join(' '),/429.*중단|중단.*429/);assert.ok(!queries.includes('颜色3'));
});

for(const status of [500,503])test(`HTTP ${status} stops unsent Google texts while ordinary text failures remain bounded`,async()=>{
 const input={...source,title:'한국어 선글라스',description:'',attributes:Array.from({length:20},(_,index)=>({name:`option-color:sku_${index}`,value:`颜色${index}`}))};let calls=0;
 const result=await drafts.buildGoogleTranslationDraft(input,async url=>{
  calls++;const q=new URL(url).searchParams.get('q');return q==='颜色0'?new Response('private upstream body',{status}):googleReply(`색상 ${q.match(/\d+/u)[0]}`);
 });
 assert.equal(calls,3);assert.deepEqual(plain(result.draft.attributes.map(attribute=>attribute.sourceIndex)),[1,2]);assert.match(result.draft.warnings.join(' '),new RegExp(`HTTP ${status}.*중단`));
 let textFailures=0;const independent=await drafts.buildGoogleTranslationDraft(input,async url=>{
  textFailures++;const q=new URL(url).searchParams.get('q');return q==='颜色0'?new Response('invalid individual text',{status:400}):googleReply(`색상 ${q.match(/\d+/u)[0]}`);
 });
 assert.equal(textFailures,20);assert.equal(independent.draft.attributes.length,19);assert.doesNotMatch(independent.draft.warnings.join(' '),/HTTP 400.*중단/);
});

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`Google quota stops a partial API job once and preserves missing option fields on replay (${company.companyCode})`,async()=>{
 const queries=[];let input;
 const h=mobileIntakeHarness({...company,translationFetcher:async url=>{
  const q=new URL(url).searchParams.get('q');queries.push(q);
  if(q===input.title)return googleReply('원문 기준 선글라스');
  if(q===input.attributes[0].value)return new Response('private quota body',{status:429,headers:{'retry-after':'3600'}});
  if(q===input.attributes[1].value)return googleReply('유광 검정');
  if(q===input.attributes[2].value)return googleReply('선글라스');
  assert.fail('no additional pending text may be sent after quota acknowledgement');
 }});
 try{
  h.sqlite.exec("UPDATE collection_jobs SET goal='collect'");await h.intake();h.bindings.SOURCEFLOW_TEXT_PROVIDER='google-free';
  const product=h.sqlite.prepare('SELECT * FROM products').get(),before=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload),base='/api/products/'+product.id;
  input={title:product.title,description:'',provenance:'manual',reference:'Local API quota-stop fixture',category:{id:h.context.category.categoryId,path:h.context.category.categoryPath},attributes:before.rows.slice(0,3).flatMap(row=>[
   {name:'option:'+row.id,value:row.originalName},{name:'option-color:'+row.id,value:row.color},{name:'option-size:'+row.id,value:row.size},
  ])};
  const json=async response=>{assert.ok(response.ok,await response.clone().text());return response.json();},request=body=>h.route(base+'/translation',{method:'POST',body});
  const prepared=await json(await request({action:'prepare',expectedVersion:product.updated_at,idempotencyKey:crypto.randomUUID(),source:input}));
  await json(await request({action:'approve',jobId:prepared.job.id,reviewFingerprint:prepared.job.review.fingerprint,confirmPaid:true}));
  const {job}=await json(await request({action:'execute',jobId:prepared.job.id}));assert.equal(job.status,'completed');assert.equal(job.result.translationRequests,4);assert.equal(job.result.googleStoppedHttpStatus,429);assert.equal(queries.length,4);
  assert.deepEqual(job.result.draft.attributes.map(attribute=>attribute.sourceIndex),[1,2,4,8]);assert.match(job.result.draft.warnings.join(' '),/9개 중 4개.*누락 5개/);assert.match(job.result.draft.warnings.join(' '),/HTTP 429.*중단/);
  assert.deepEqual(job.review.source,input);const persisted=h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(job.id);
  const repeated=await json(await request({action:'execute',jobId:job.id}));assert.equal(repeated.replayed,true);assert.equal(queries.length,4);
  const preview=await json(await h.route(base+'/translation-apply',{method:'POST',body:{action:'preview',jobId:job.id,expectedVersion:product.updated_at}}));
  await json(await h.route(base+'/translation-apply',{method:'POST',body:{action:'apply',jobId:job.id,expectedVersion:product.updated_at,fingerprint:preview.fingerprint}}));
  const after=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);
  assert.ok(after.rows.every(row=>row.translatedName===''&&row.provenance.translatedName!=='translated'));
  assert.equal(after.rows[0].color,'유광 검정');assert.equal(after.rows[0].size,'선글라스');assert.equal(after.rows[2].color,before.rows[2].color);assert.equal(after.rows[2].provenance.color,'collected');
  for(const [index,row]of after.rows.entries())for(const key of ['id','originalName','supplierSku','unitCostCny','unitsPerPack','imageKey'])assert.equal(row[key],before.rows[index][key]);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(job.id),persisted);assert.equal(queries.length,4);assert.equal(h.aiSources.length,0);assert.ok(!h.network.includes('supplier.coupang.com'));
 }finally{h.close();}
});

test('Chinese copies with Korean text remain missing attributes in Google and the shared v6 validator',async()=>{
 const input={...source,description:'',attributes:[
  {name:'상품속성: 材质',value:'棉 검토'},
  {name:'option-color:sku_1',value:'黑色 검토'},
  {name:'option-size:sku_1',value:'10 cm'},
  {name:'상품속성: 尺寸',value:'10 cm'},
 ]};
 const review=await model.prepareTranslationReview(input,config),queries=[];
 const result=await model.executeTranslation(review,config,async url=>{
  const q=new URL(url).searchParams.get('q');queries.push(q);
  return googleReply(q===input.title?'면 수납 주머니 ABC-005':q==='材质'?'재질':q==='尺寸'?'크기':q);
 });
 assert.deepEqual(plain(result.draft.attributes.map(item=>item.sourceIndex)),[2,3]);
 assert.equal(result.draft.attributes[0].name,'option-size:sku_1');assert.equal(result.draft.attributes[0].value,'10 cm');
 assert.match(result.draft.warnings.join(' '),/4개 중 2개.*누락 2개/);assert.equal(queries.filter(q=>q==='黑色 검토').length,1);
 const copied={title:'면 수납 주머니 ABC-005',description:'',keywords:[],warnings:[],attributes:input.attributes.map((item,sourceIndex)=>({sourceIndex,name:sourceIndex===0?'재질':sourceIndex===3?'크기':item.name,value:item.value}))};
 const shared=model.validateTranslationDraft(copied,input,'sourceflow-translation-v6');
 assert.deepEqual(plain(shared.attributes.map(item=>item.sourceIndex)),[2,3]);assert.match(shared.warnings.join(' '),/원문.*반환/);
 assert.equal(model.validateTranslationDraft(copied,input,'sourceflow-translation-v5').attributes.length,4,'earlier stored result contract stays intact');
 assert.deepEqual(plain(input.attributes),[
  {name:'상품속성: 材质',value:'棉 검토'},{name:'option-color:sku_1',value:'黑色 검토'},
  {name:'option-size:sku_1',value:'10 cm'},{name:'상품속성: 尺寸',value:'10 cm'},
 ]);
});

test('Chinese copied attribute headings and Korean-only prefixes do not count as translated coverage',()=>{
 const input={...source,description:'',attributes:[
  {name:'상품속성: 材质',value:'棉'},
  {name:'option:sku_1',value:'男士太阳眼镜'},
  {name:'option-size:sku_1',value:'XL'},
  {name:'option-color:sku_1',value:'검정'},
 ]};
 const output={title:'면 수납 주머니 ABC-005',description:'',keywords:[],warnings:[],attributes:[
  {sourceIndex:0,name:'상품속성: 材质',value:'면'},
  {sourceIndex:1,name:'option:sku_1',value:'한국어 男士太阳眼镜'},
  {sourceIndex:2,name:'option-size:sku_1',value:'XL'},
  {sourceIndex:3,name:'option-color:sku_1',value:'검정'},
 ]};
 const result=model.validateTranslationDraft(output,input,'sourceflow-translation-v6');
 assert.deepEqual(plain(result.attributes.map(item=>item.sourceIndex)),[2,3]);
 assert.deepEqual(plain(model.translationAttributeCoverage(input,result).missingSourceIndexes),[0,1]);
});

test('an unchanged mixed Korean and Chinese title fails once before any attribute request',async()=>{
 const input={...source,title:'선글라스 太阳镜'},review=await model.prepareTranslationReview(input,config);let calls=0;
 await assert.rejects(()=>model.executeTranslation(review,config,async url=>{
  calls++;assert.equal(new URL(url).searchParams.get('q'),input.title);return googleReply(input.title);
 }),error=>error.code==='GOOGLE_TRANSLATION_FAILED'&&!error.mayHaveBeenCharged);
 assert.equal(calls,1);
});

test('v6 attributes retain their own numeric evidence rather than borrowing measurements, dates or title numbers',()=>{
 const input={...source,title:'收纳袋 99',description:'日期 2025',attributes:[
  {name:'상품속성: 宽度',value:'10 cm'},{name:'상품속성: 长度',value:'20 cm'},
  {name:'상품속성: 日期',value:'2024-03'},{name:'option:sku_1',value:'ABC-005'},
  {name:'상품속성: 厚度',value:'2.5 cm'},{name:'상품속성: 颜色',value:'검정'},
  {name:'상품속성: 出厂年份',value:'2025'},{name:'상품속성: 材质',value:'棉'},
 ]};
 const output={title:'수납 주머니 99',description:'날짜 2025',keywords:[],warnings:[],attributes:[
  {sourceIndex:0,name:'너비',value:'20 cm'},{sourceIndex:1,name:'길이',value:'10 cm'},
  {sourceIndex:2,name:'날짜',value:'2025년 03월'},{sourceIndex:3,name:'option:sku_1',value:'ABC-005'},
  {sourceIndex:4,name:'두께',value:'2.5 센티미터'},{sourceIndex:5,name:'색상 99',value:'검정'},
  {sourceIndex:6,name:'생산 연도',value:'2025년'},{sourceIndex:7,name:'재질',value:'2025 면'},
 ]};
 const original=JSON.stringify({input,output}),result=model.validateTranslationDraft(output,input,'sourceflow-translation-v6');
 assert.deepEqual(plain(result.attributes.map(item=>item.sourceIndex)),[3,4,6]);
 assert.deepEqual(plain(model.translationAttributeCoverage(input,result).missingSourceIndexes),[0,1,2,5,7]);
 assert.match(result.warnings.join(' '),/8개 중 3개.*누락 5개/);assert.match(result.warnings.join(' '),/같은.*원문에 없는 숫자.*5개/);
 assert.equal(result.title,output.title);assert.equal(result.description,output.description);
 assert.equal(model.validateTranslationDraft(output,input,'sourceflow-translation-v5').attributes.length,8);
 assert.equal(JSON.stringify({input,output}),original);
});

test('Google measurements swapped across fields stay partial while their source indexes and numeric literals remain intact',async()=>{
 const input={...source,description:'',attributes:[
  {name:'option-size:sku_1',value:'小号 10 cm'},
  {name:'상품속성: 长度',value:'长度 20 cm'},
  {name:'상품속성: 厚度',value:'2.5 cm'},
 ]},review=await model.prepareTranslationReview(input,config);
 const result=await model.executeTranslation(review,config,async url=>{
  const q=new URL(url).searchParams.get('q'),value=q===input.title?'면 수납 주머니 ABC-005':q==='小号 10 cm'?'소형 20 cm':q==='长度 20 cm'?'길이 10 cm':q==='长度'?'길이':q==='厚度'?'두께':q;
  return googleReply(value);
 });
 assert.deepEqual(plain(result.draft.attributes),[{sourceIndex:2,name:'두께',value:'2.5 cm'}]);
 assert.match(result.draft.warnings.join(' '),/3개 중 1개.*누락 2개/);assert.match(result.draft.warnings.join(' '),/같은.*원문에 없는 숫자.*2개/);
});

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`recorded 1688 intake uses Google through real API/SQLite and preserves manual edits on reopen (${company.companyCode})`,async()=>{
 const color=value=>({'亮黑':'유광 검정','砂黑':'무광 검정','砂灰':'무광 회색'}[value]??value),size=value=>value==='太阳镜'?'선글라스':value==='太阳镜 加005 盒子'?'선글라스 + 005 케이스':value;
 let calls=0;const h=mobileIntakeHarness({...company,translationFetcher:async url=>{calls++;const q=new URL(url).searchParams.get('q');let value=q.startsWith('太阳眼镜木纹')?'우드 패턴 다리 선글라스':q.includes(' / ')?q.split(' / ').map((part,i)=>i?size(part):color(part)).join(' / '):color(size(q));if(value===q)value=`원문 검토 ${q.match(/\d+(?:[.,]\d+)*/g)?.join(' ')??''}`;return googleReply(value);}});
 try{
  h.bindings.SOURCEFLOW_TEXT_PROVIDER='google-free';h.sqlite.prepare("UPDATE collection_jobs SET goal='work'").run();
  await h.intake();assert.equal(h.aiSources.length,0);assert.ok(calls>0&&calls<=49);assert.equal(h.objects.size,19);
  const product=h.sqlite.prepare('SELECT * FROM products').get(),content=()=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload),options=()=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);
  assert.match(content().seo.title.value,/우드 패턴 다리 선글라스/);assert.equal(options().rows.length,6);assert.ok(options().rows.every(row=>/[가-힣]/.test(row.translatedName)&&/[가-힣]/.test(row.color)&&/[가-힣]/.test(row.size)));assert.equal(product.supplier_hub_status,'미전송');
  const stored=h.sqlite.prepare("SELECT * FROM translation_jobs WHERE idempotency_key='intake-auto-v1'").get();assert.equal(stored.status,'completed');assert.equal(JSON.parse(stored.review).destination,'Google 번역');
  const response=await h.route(`/api/products/${product.id}/content`,{method:'PATCH',body:{expectedRevision:content().revision,patch:{seo:{title:'직접 확인한 선글라스'}}}});assert.equal(response.status,200,await response.clone().text());
  const before=h.sqlite.prepare('SELECT payload FROM product_content').get().payload,count=calls;await h.intake();assert.equal(calls,count);assert.equal(h.aiSources.length,0);assert.equal(h.sqlite.prepare('SELECT payload FROM product_content').get().payload,before);
 }finally{h.close();}
});
