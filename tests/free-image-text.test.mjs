import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as parse5 from 'parse5';
function load(file,cache=new Map()){
 if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,crypto,URL,URLSearchParams,Response,TextEncoder,TextDecoder,AbortController,setTimeout,clearTimeout,fetch:()=>{throw Error('Live HTTP forbidden');},require(name){if(name==='parse5')return parse5;assert.ok(name.startsWith('@/app/'),name);return load(name.slice(2)+'.ts',cache);}});return exports;
}
const {translateImageRegions}=load('app/automation/free-image-text.ts');
const contract=load('app/free-image-translation.ts');
const google=text=>Response.json([[[text,'fixture source']],null,'zh-CN']);
const plain=value=>JSON.parse(JSON.stringify(value));
const block=(q,values,reverse=false)=>{const rows=q.split('\n').map(line=>{const match=/^(\[\[YFTR\d{6}\]\]) (.+)$/u.exec(line);assert.ok(match);return`${match[1]} ${values.get(match[2])}`;});return google((reverse?rows.reverse():rows).join('\n'));};

test('common and source-option identity bytes stay compatible with existing deterministic R2 records',()=>{
 const source={productId:'p',productVersion:'2026-10-06T00:00:00.000Z',contentRevision:2,sourceKey:'owner/a.png',sourceSha256:'a'.repeat(64),role:'main',width:3,height:2};
 const old='{"productId":"p","productVersion":"2026-10-06T00:00:00.000Z","contentRevision":2,"sourceKey":"owner/a.png","sourceSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","role":"main","width":3,"height":2}';
 assert.equal(contract.freeImageSourceIdentity(source),old);assert.equal(contract.freeImageApplyIdentity(source),old);
 const optionOnly={...source,optionImages:{commonAssigned:false,optionIds:['blue','red'],revision:3}};
 const optionBytes=old.slice(0,-1)+',"optionImages":{"revision":3,"optionIds":["blue","red"],"commonAssigned":false}}';
 assert.equal(contract.freeImageSourceIdentity(optionOnly),optionBytes);
 assert.equal(contract.freeImageApplyIdentity(optionOnly,['red','blue']),JSON.stringify({source:optionBytes,optionImageIds:['blue','red']}));
});

test('image text uses the exact keyless Google GET and reordered regions retain their own numbers',async()=>{
 const input=[{id:'width',text:'宽度 10 cm'},{id:'height',text:'高度 20 cm'},{id:'other',text:'SIZE XL'}],before=JSON.stringify(input);let calls=0;
 const result=await translateImageRegions(input,'zh',async(url,init)=>{
  calls++;const endpoint=new URL(url);assert.equal(endpoint.origin,'https://translate.googleapis.com');assert.equal(endpoint.pathname,'/translate_a/single');
  assert.deepEqual(Object.fromEntries([...endpoint.searchParams].filter(([key])=>key!=='q')),{client:'gtx',sl:'zh-CN',tl:'ko',dt:'t'});assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');
  return block(endpoint.searchParams.get('q'),new Map([['宽度 10 cm','너비 10 cm'],['高度 20 cm','높이 20 cm']]),true);
 });
 assert.equal(calls,1);assert.equal(result.requests,1);assert.equal(JSON.stringify(input),before);
 assert.deepEqual(plain(result.regions.map(row=>[row.id,row.translated])),[['width','너비 10 cm'],['height','높이 20 cm'],['other',null]]);
 assert.equal(result.stoppedHttpStatus,null);assert.ok(result.regions[2].issue);
});
test('English image translation excludes Chinese text and leaves plain numeric identifiers untouched',async()=>{
 const result=await translateImageRegions([{id:'a',text:'SUNGLASSES'},{id:'b',text:'黑色'},{id:'c',text:'123.5'}],'en',async url=>{const endpoint=new URL(url);assert.equal(endpoint.searchParams.get('sl'),'en');assert.equal(endpoint.searchParams.get('q'),'SUNGLASSES');return google('선글라스');});
 assert.equal(result.requests,1);assert.deepEqual(plain(result.regions.map(row=>row.translated)),['선글라스',null,null]);
});
test('foreign, dropped or duplicated numbers cannot paint an OCR region as successfully translated',async()=>{
 for(const translated of ['너비 20 cm','너비 센티미터','너비 10 10 cm','宽度 10 cm']){
  const result=await translateImageRegions([{id:'a',text:'宽度 10 cm'}],'zh',async()=>google(translated));assert.equal(result.regions[0].translated,null);assert.match(result.regions[0].issue,/원문/);
 }
});
test('corrupted markers reject the whole image block without individual fallback requests',async()=>{
 let calls=0;const result=await translateImageRegions([{id:'a',text:'黑色'},{id:'b',text:'白色'}],'zh',async()=>{calls++;return google('[[YFTR000001]] 검정\n[[YFTR000001]] 흰색');});
 assert.equal(calls,1);assert.ok(result.regions.every(row=>row.translated===null&&row.issue));
});
test('repeated source text shares a translation call while both exact UI IDs survive',async()=>{
 const result=await translateImageRegions([{id:'a',text:'黑色'},{id:'b',text:'黑色'}],'zh',async url=>{assert.equal(new URL(url).searchParams.get('q'),'黑色');return google('검정');});
 assert.equal(result.requests,1);assert.deepEqual(plain(result.regions.map(row=>[row.id,row.translated])),[['a','검정'],['b','검정']]);
});
for(const status of [429,500,503])test(`HTTP ${status} stops subsequent image blocks and retains original and successful results`,async()=>{
 const inputs=Array.from({length:8},(_,i)=>({id:'line'+i,text:`颜色${i} ${'文'.repeat(900)}`}));let calls=0;
 const result=await translateImageRegions(inputs,'zh',async url=>{calls++;return calls===1?block(new URL(url).searchParams.get('q'),new Map(inputs.map((row,i)=>[row.text,'색상 '+i]))):new Response('fixture error',{status});});
 assert.equal(calls,2);assert.equal(result.stoppedHttpStatus,status);assert.equal(result.regions.filter(row=>row.translated).length,5);assert.ok(result.regions.slice(5).every(row=>row.translated===null));
});
test('an already cancelled image translation performs no HTTP and preserves the OCR original',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;const result=await translateImageRegions([{id:'a',text:'黑色'}],'zh',async()=>{calls++;return google('검정');},controller.signal);
 assert.equal(calls,0);assert.equal(result.requests,0);assert.equal(result.regions[0].original,'黑色');assert.equal(result.regions[0].translated,null);
});
test('region text/IDs/pixel limits are enforced before network work',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return google('검정');};
 for(const rows of [[],[{id:'a',text:''}],[{id:'a',text:'黑色'},{id:'a',text:'白色'}],[{id:'bad/id',text:'黑色'}],Array.from({length:101},(_,i)=>({id:'a'+i,text:'黑色'})),[{id:'a',text:'中'.repeat(5001)}],Array.from({length:5},(_,i)=>({id:'a'+i,text:'中'.repeat(4500)}))])await assert.rejects(()=>translateImageRegions(rows,'zh',fetcher));
 const source={productId:'product-a',productVersion:'2026-10-06T00:00:00.000Z',contentRevision:0,sourceKey:'owner/a.png',sourceSha256:'a'.repeat(64),role:'detail',width:1000,height:1000};
 assert.deepEqual(plain(contract.validateFreeImageSource(source)),source);assert.throws(()=>contract.validateFreeImageSource({...source,width:16000,height:16000}));assert.throws(()=>contract.validateFreeImageSource({...source,role:'label'}));assert.equal(calls,0);
});
