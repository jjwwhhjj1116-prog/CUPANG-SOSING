import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
const document={fonts:null};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/free-image-text-style.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,document,setTimeout,clearTimeout});
const {resolveFreeImageTextStyle:resolve,freeImageFontFamilies:families}=exports,plain=value=>JSON.parse(JSON.stringify(value));

test('older drafts retain exact sans, plain, left and 1.2 drawing defaults without mutation',()=>{
 const original={id:'old-region',translated:'직접 입력',box:{x:1,y:2,width:30,height:40}},before=JSON.stringify(original);
 assert.deepEqual(plain(resolve(original)),{fontFamily:'Arial, "Noto Sans KR", sans-serif',bold:false,italic:false,textAlign:'left',lineHeight:1.2});
 assert.equal(JSON.stringify(original),before);
 assert.deepEqual(plain(resolve({fontFamily:'sans',bold:false,italic:false,textAlign:'left',lineHeight:1.2})),plain(resolve({})));
});

test('fixed local families and all supported styles remain independent across regions',()=>{
 assert.deepEqual(Object.keys(families),['sans','serif','mono','gmarket']);
 for(const fontFamily of Object.keys(families))for(const textAlign of ['left','center','right'])for(const lineHeight of [0.8,1,1.2,2,3]){
  const input={fontFamily,textAlign,lineHeight,bold:true,italic:true},before=JSON.stringify(input);
  assert.deepEqual(plain(resolve(input)),{fontFamily:families[fontFamily].css,textAlign,lineHeight,bold:true,italic:true});
  assert.equal(JSON.stringify(input),before);
 }
 assert.equal(resolve({bold:true}).italic,false);assert.equal(resolve({italic:true}).bold,false);assert.equal(resolve({}).bold,false);
});

test('bundled font loads the chosen face before use and cannot silently use a missing fallback',async()=>{
 const {ensureFreeImageTextFont:ensure}=exports,signal=new AbortController().signal,calls=[];
 await ensure(resolve({}),signal);
 document.fonts={load:async(descriptor,sample)=>{calls.push([descriptor,sample]);return[{}];},check:()=>true};
 await ensure(resolve({fontFamily:'gmarket'}),signal);await ensure(resolve({fontFamily:'gmarket',bold:true,italic:true}),signal);
 assert.deepEqual(calls.map(row=>row[0]),['20px "Gmarket Sans"','italic bold 20px "Gmarket Sans"']);
 assert.ok(calls.every(row=>row[1]==='가나다 ABC 123'));
 for(const fonts of [null,{load:async()=>[],check:()=>true},{load:async()=>[{}],check:()=>false},{load:async()=>{throw Error('fixture unavailable');},check:()=>true},{load:async()=>[{}],check:()=>{throw Error('font check failed');}}]){
  document.fonts=fonts;await assert.rejects(ensure(resolve({fontFamily:'gmarket'}),signal),/글꼴|Gmarket/);
 }
});

test('font cancellation ends promptly and a late face result cannot acknowledge rendering',async()=>{
 const {ensureFreeImageTextFont:ensure}=exports,controller=new AbortController();let finish,calls=0;
 document.fonts={load:()=>{calls++;return new Promise(resolve=>{finish=resolve;});},check:()=>true};
 const waiting=ensure(resolve({fontFamily:'gmarket'}),controller.signal);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls,1);controller.abort();await assert.rejects(waiting);finish([{}]);await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(ensure(resolve({fontFamily:'gmarket'}),controller.signal));assert.equal(calls,1);
});

test('invalid styles and arbitrary font CSS fail before image drawing',()=>{
 for(const input of [null,[],false,'sans',
  ...['fontFamily','textAlign','lineHeight','bold','italic'].map(key=>({[key]:null})),
  ...['url(https://example.test/font)','Arial','__proto__','constructor',{},1].map(fontFamily=>({fontFamily})),
  ...['start','end','CENTER',{},true,1].map(textAlign=>({textAlign})),
  ...[-1,0,0.79,3.01,NaN,Infinity,'1.2',true,{}].map(lineHeight=>({lineHeight})),
  ...['true',1,{}].flatMap(value=>[{bold:value},{italic:value}]),
 ])assert.throws(()=>resolve(input),/행간/);
});
