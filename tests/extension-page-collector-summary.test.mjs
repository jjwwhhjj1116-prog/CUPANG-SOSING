import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {pageCollectorDom} from './helpers/page-collector-dom.mjs';

// Exercise the production button, delivery branches and status rendering. The
// parser is separately tested against DOM fixtures; no page/network is opened.
const bundle=await build({entryPoints:[fileURLToPath(new URL('../deployment/extension-page-collector.mjs',import.meta.url))],bundle:true,write:false,format:'iife',platform:'browser',target:'chrome120',plugins:[{name:'inert-source-fixture',setup(build){
 build.onLoad({filter:/[/\\]page-source\.mjs$/},()=>({loader:'js',contents:`
  export const pageSourceUrl=value=>{const url=new URL(value);return {sourceUrl:url.origin+url.pathname};};
  export const extractPageSource=()=>globalThis.captureFixture;
  export const readPageSourceDomOptions=()=>[];
  export const readPageSourceDomFacts=()=>({});
  export const readPageSourceElementImage=()=>null;
  export const readPageSourceDescriptionReference=()=>null;
  export const validatePageSourceForDelivery=value=>value;
 `}));
 build.onLoad({filter:/[/\\]page-dom-details\.mjs$/},()=>({loader:'js',contents:'export const waitForPageDomDetails=()=>({description:"",detailImages:[]});'}));
}}]});
const sourceUrl='https://detail.1688.com/offer/886034098637.html';
const source=()=>({format:'yoofam-page-source-v1',sourceUrl,offerId:'886034098637',collectedAt:'2026-10-23T01:00:00.000Z',title:'합성 뒤꿈치 패드',description:'',
 attributes:[],options:[{key:'black',name:'검정',supplierSku:'synthetic-black',unitPriceCny:0.28,currency:'CNY',minimumOrder:1,stock:1,imageUrl:null}],
 images:[{url:'https://cbu01.alicdn.com/synthetic-main.png',role:'main'}]});
function harness(snapshot=source(),response=()=>({ok:true,delivered:true})){
 const {elements,document}=pageCollectorDom({title:snapshot.title}),messages=[];
 const window={};window.top=window;
 const context={window,document,location:{href:sourceUrl},URL,Date,Error,TextEncoder,captureFixture:snapshot,
  chrome:{runtime:{getManifest(){assert.fail('Manifest version cannot identify the injected collector script');},sendMessage:async message=>{messages.push(structuredClone(message));return response(messages.length,message);}}},
  fetch(){assert.fail('No source/server request may be added by a completion summary');}};
 vm.runInNewContext(bundle.outputFiles[0].text,context);
 return {context,messages,button:elements.find(node=>node.tag==='button'),status:elements.find(node=>node.tag==='p')};
}

test('actual script marker is visible and a delivered title/options capture truthfully warns when all optional sections are absent',async()=>{
 const snapshot=source(),original=JSON.stringify(snapshot),h=harness(snapshot);
 assert.equal(h.button.title,'YOOFAM 상품 수집기 2.1.36');await h.button.click({isTrusted:false});assert.equal(h.messages.length,0);
 await h.button.click({isTrusted:true});
 assert.equal(h.button.textContent,'수집 완료');assert.equal(h.button.disabled,false);assert.equal(h.messages.length,1);
 assert.match(h.status.textContent,/^수집기 2\.1\.36 · /);assert.match(h.status.textContent,/서버 수집본 상세 미확인/);assert.doesNotMatch(h.status.textContent,/AI상품등록 목록에 담았습니다/);
 assert.match(h.status.textContent,/제품속성 0개 · 포장정보 0\/1옵션 · 상세이미지 0장/);
 assert.match(h.status.textContent,/미수집·미확인: 제품속성 · 포장정보 · 상세이미지/);assert.match(h.status.textContent,/누락 항목을 자동으로 채우지 않았습니다/);
 assert.equal(JSON.stringify(snapshot),original);
 const captureDiagnostics={format:'yoofam-page-capture-diagnostics-v1',collectorVersion:'2.1.36',sections:{tabCount:0,knownTabCount:0,panelCount:0,linkedKnownPanelCount:0,unlinkedKnownTabCount:0},description:'reference-missing',bodyTitles:{attributes:0,packaging:0,detail:0}};
 assert.deepEqual(h.messages[0],{type:'YOOFAM_SAVE_PAGE_SOURCE',snapshot:{...snapshot,captureDiagnostics}});
});

test('counts use saved attributes, packaging-bearing options and detail roles only, with partial-option packaging warning',async()=>{
 const snapshot=source();snapshot.attributes=[{name:'재질',value:'스펀지'},{name:'판매 단위',value:'1쌍'}];
 snapshot.options=[{...snapshot.options[0],packaging:{source:'package-table',weightG:10}},
  {...snapshot.options[0],key:'pink',packaging:{source:'package-table',widthMm:200,lengthMm:300,heightMm:100}},
  {...snapshot.options[0],key:'beige'}];
 snapshot.images.push({url:'https://cbu01.alicdn.com/synthetic-additional.png',role:'additional'},
  {url:'https://cbu01.alicdn.com/synthetic-detail-1.png',role:'detail'},{url:'https://cbu01.alicdn.com/synthetic-detail-2.png',role:'detail'});
 const h=harness(snapshot);await h.button.click({isTrusted:true});
 assert.match(h.status.textContent,/제품속성 2개 · 포장정보 2\/3옵션 · 상세이미지 2장/);assert.match(h.status.textContent,/미수집·미확인: 포장정보 1옵션/);
 assert.equal(h.messages[0].snapshot.options.length,3);assert.equal(h.messages[0].snapshot.images.length,4);
});

test('a fully populated saved capture has a summary without claiming missing sections',async()=>{
 const snapshot=source();snapshot.attributes=[{name:'재질',value:'면'}];snapshot.options[0].packaging={source:'package-table',weightG:10,widthMm:200,lengthMm:300,heightMm:100};
 snapshot.images.push({url:'https://cbu01.alicdn.com/synthetic-detail.png',role:'detail'});
 const h=harness(snapshot,()=>({ok:true,delivered:true,duplicate:true}));await h.button.click({isTrusted:true});
 assert.match(h.status.textContent,/서버 수집본 상세 미확인/);assert.match(h.status.textContent,/제품속성 1개 · 포장정보 1\/1옵션 · 상세이미지 1장/);
 assert.doesNotMatch(h.status.textContent,/미수집·미확인|누락 항목/);assert.equal(h.button.textContent,'수집 완료');
 assert.equal(h.messages[0].snapshot.captureDiagnostics.description,'not-needed');
 assert.equal(h.messages[0].snapshot.captureDiagnostics.bodyTitles,undefined,'an unmeasured body-title count is not invented as zero');
});

test('an uncertain app delivery stays uncertain; retry statistics belong to the original retained payload',async()=>{
 const original=source(),h=harness(original,n=>n===1?{ok:true,delivered:false,message:'저장 응답 미확인'}:{ok:true,delivered:true});
 await h.button.click({isTrusted:true});assert.equal(h.button.textContent,'앱 전송 다시 시도');assert.match(h.status.textContent,/앱 수집함의 저장을 확인하지 못했습니다/);
 assert.doesNotMatch(h.status.textContent,/AI상품등록 목록에 담았습니다|수집 내용:/);
 h.context.captureFixture={...source(),attributes:[{name:'새 속성',value:'새 원문'}]};await h.button.click({isTrusted:false});assert.equal(h.messages.length,1);
 await h.button.click({isTrusted:true});assert.equal(h.messages.length,2);assert.deepEqual(h.messages[1].snapshot,h.messages[0].snapshot);
 assert.deepEqual({...h.messages[1].snapshot,captureDiagnostics:undefined},{...original,captureDiagnostics:undefined});
 assert.match(h.status.textContent,/현재 문서 영역: 탭 0개/,'retry retains the first captured diagnostic note');
 assert.match(h.status.textContent,/제품속성 0개/);assert.doesNotMatch(h.status.textContent,/제품속성 1개/);
});

for(const delivered of [true,false])test(`old pending replay (${delivered}) never labels freshly read section counts as saved`,async()=>{
 const snapshot=source();snapshot.attributes=[{name:'새 원문',value:'미저장'}];
 const h=harness(snapshot,()=>({ok:true,delivered,duplicate:true,pendingSnapshotReplayed:true,newCaptureStored:false,message:'이전 수집본 확인'}));
 await h.button.click({isTrusted:true});assert.match(h.status.textContent,/수집기 2\.1\.36/);assert.match(h.status.textContent,/방금 읽은 새 상품정보는 아직 저장하지 않았습니다/);
 assert.doesNotMatch(h.status.textContent,/수집 내용:|제품속성 1개|AI상품등록 목록에 담았습니다/);assert.notEqual(h.button.textContent,'수집 완료');assert.equal(h.messages.length,1);
});

test('missing or rejected app ACK never acquires a completion summary or success label',async()=>{
 for(const result of [{ok:true},{ok:false,error:'앱 저장 실패'}]){
  const h=harness(source(),()=>result);await h.button.click({isTrusted:true});assert.equal(h.messages.length,1);
  assert.match(h.status.textContent,/^수집기 2\.1\.36 · /);assert.doesNotMatch(h.status.textContent,/수집 내용:|AI상품등록 목록에 담았습니다/);assert.notEqual(h.button.textContent,'수집 완료');
 }
});

const acknowledged=(snapshot,patch={})=>({ok:true,delivered:true,ownerId:'owner',company:{code:'A01464742',name:'와이홉'},fingerprint:'a'.repeat(64),
 storedReceipt:{ownerId:'owner',company:{code:'A01464742',name:'와이홉'},sourceUrl:snapshot.sourceUrl,fingerprint:'a'.repeat(64),storedId:'00000000-0000-4000-8000-000000000024',captureVersion:3,receivedAt:'2026-10-23T01:00:01.000Z',collectedAt:snapshot.collectedAt,...patch}});
test('only a validated server receipt shows capture version and actual received/source timestamps in Korean KST without private IDs',async()=>{
 const snapshot=source(),h=harness(snapshot,()=>acknowledged(snapshot));await h.button.click({isTrusted:true});
 assert.equal(h.button.textContent,'수집 완료');assert.match(h.status.textContent,/AI상품등록 목록에 담았습니다/);assert.match(h.status.textContent,/서버 수집본 3/);
 assert.match(h.status.textContent,/저장 2026\. 10\. 23\. 10:00:01 \(KST\)/);assert.match(h.status.textContent,/원문 수집 2026\. 10\. 23\. 10:00:00 \(KST\)/);
 assert.doesNotMatch(h.status.textContent,/00000000-0000|a{64}|서버 수집본 상세 미확인/);
});

test('old pending replay displays its actually acknowledged old capture times, never the fresh page statistics/time',async()=>{
 const snapshot=source(),h=harness(snapshot,()=>({...acknowledged(snapshot,{collectedAt:'2026-10-23T00:00:00.000Z'}),pendingSnapshotReplayed:true,newCaptureStored:false,duplicate:true}));
 await h.button.click({isTrusted:true});assert.equal(h.button.textContent,'현재 상품 다시 수집');assert.match(h.status.textContent,/서버 수집본 3/);assert.match(h.status.textContent,/원문 수집 2026\. 10\. 23\. 09:00:00 \(KST\)/);
 assert.doesNotMatch(h.status.textContent,/수집 내용:|10:00:00|AI상품등록 목록에 담았습니다/);
});

test('an advertised malformed or mismatched server receipt cannot produce a completed button or saved-current-page claim',async()=>{
 const snapshot=source();
 for(const patch of [{ownerId:'other'},{company:{code:'A01526306',name:'유앤채'}},{fingerprint:'b'.repeat(64)},{storedId:'invalid'},
  {sourceUrl:sourceUrl+'?different=1'},{captureVersion:0},{captureVersion:1.5},{receivedAt:'bad'},{collectedAt:'2026-10-22T01:00:00.000Z'},{extra:true}]){
  const h=harness(snapshot,()=>acknowledged(snapshot,patch));await h.button.click({isTrusted:true});assert.notEqual(h.button.textContent,'수집 완료');assert.match(h.status.textContent,/상세 응답이 전달한 원문과 일치하지 않습니다/);assert.doesNotMatch(h.status.textContent,/목록에 담았습니다|수집 내용:/);
 }
 const h=harness(snapshot,()=>({ok:true,delivered:true,storedReceipt:null}));await h.button.click({isTrusted:true});assert.notEqual(h.button.textContent,'수집 완료');
});
