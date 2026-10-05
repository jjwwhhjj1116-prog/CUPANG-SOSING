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
 assert.equal(result.draft.description,'');assert.deepEqual(plain(result.draft.attributes.map(pair=>pair.sourceIndex)),[1,2,3]);assert.match(result.draft.warnings.join(' '),/누락 1개/);assert.equal(calls,5);
 let inventedCalls=0;const inventedReview=await model.prepareTranslationReview({...source,attributes:[]},config);await assert.rejects(()=>model.executeTranslation(inventedReview,config,async url=>{inventedCalls++;return googleReply(new URL(url).searchParams.get('q')===source.title?'면 주머니 999':'크기 10 cm');}),error=>error.code==='UNSUPPORTED_FACT'&&!error.mayHaveBeenCharged);assert.equal(inventedCalls,2);
});

test('one batch respects the Free subrequest cap and prioritizes exact options before generic attributes',async()=>{
 const many={...source,description:'',attributes:[...Array.from({length:80},(_,i)=>({name:`名称${i}`,value:`值${i}`})),{name:'option:sku_last',value:'黑色'}]};let calls=0,active=0,maxActive=0;
 const result=await drafts.buildGoogleTranslationDraft(many,async url=>{calls++;active++;maxActive=Math.max(active,maxActive);await new Promise(resolve=>setTimeout(resolve,1));active--;const q=new URL(url).searchParams.get('q');return googleReply(q===source.title?'면 수납 주머니 ABC-005':q==='黑色'?'검정':`검토 ${q.match(/\d+/)?.[0]??''}`);});
 assert.equal(calls,49);assert.ok(maxActive<=3);assert.ok(result.draft.attributes.some(pair=>pair.sourceIndex===80&&pair.name==='option:sku_last'&&pair.value==='검정'));assert.match(result.draft.warnings.join(' '),/한도/);
 let failures=0;const stopped=await drafts.buildGoogleTranslationDraft(many,async url=>{failures++;return new URL(url).searchParams.get('q')===source.title?googleReply('면 수납 주머니 ABC-005'):new Response('error',{status:429});});assert.ok(failures<=6);assert.match(stopped.draft.warnings.join(' '),/연속/);
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
