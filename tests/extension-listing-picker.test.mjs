import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {LISTING_BATCH_LIMIT,LISTING_BATCH_BYTES,listingPageUrl,listingOfferUrl,readListingCard,scanListingCards,createListingSelection,validateListingBatchPayload,createListingBatchPayload,validateListingBatchReply,listingStartNotCreated} from '../extensions/supplier-hub/listing-candidates.mjs';
import {installListingPicker} from '../deployment/extension-listing-picker.mjs';
import {listingPickerDom,listingTimers} from './helpers/listing-picker-dom.mjs';

const listing='https://s.1688.com/selloffer/offer_search.htm?keywords=hat';
const both=['ai-registration','rocket-compare'];
const candidate=(offerId='886034098637')=>({offerId,sourceUrl:`https://detail.1688.com/offer/${offerId}.html`,title:'原文商品',thumbnail:'https://cbu01.alicdn.com/img/a.jpg',displayPrice:'¥4.60'});
const payload=(options={})=>({version:1,batchId:randomUUID(),listingUrl:listing,items:[candidate()],destinations:[...both],...options});
function snapshot(source=payload(),{status='running',itemStatus='queued',compareStatus='queued'}={}){
 const now=Date.now(),items=source.items.map(item=>({...item,itemId:randomUUID(),status:itemStatus,
  ...(itemStatus==='saved'&&source.destinations.includes('ai-registration')?{storedReceipt:{storedId:randomUUID(),captureVersion:1,receivedAt:new Date(now).toISOString()}}:{})}));
 const result={batchId:source.batchId,status,destinations:[...source.destinations],items,total:items.length,saved:items.filter(item=>item.status==='saved').length,failed:items.filter(item=>item.status==='failed').length,uncertain:items.filter(item=>item.status==='uncertain').length,queued:items.filter(item=>item.status==='queued').length,cancelRequested:false,createdAt:now,updatedAt:now};
 if(source.destinations.includes('rocket-compare')){
  result.comparison={status:compareStatus,storedCount:compareStatus==='saved'?items.length:0,existingCount:0};
  if(compareStatus==='saved'){result.comparison.revision=1;result.comparison.receipt={format:'yoofam-listing-comparison-receipt-v1',captureId:randomUUID(),batchId:source.batchId,ownerId:'private-owner',company:'private-company',stored:true,revision:1,storedCount:items.length,existingCount:0,itemOfferIds:items.map(item=>item.offerId),payloadSha256:'a'.repeat(64),recordedAt:new Date(now).toISOString()};}
 }
 return result;
}
const clone=value=>structuredClone(value);
const flush=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};

test('listing scope accepts only the reviewed HTTPS search route and canonical detail identities',()=>{
 assert.equal(listingPageUrl(listing+'#fragment'),listing);
 for(const bad of ['http://s.1688.com/selloffer/offer_search.htm','https://s.1688.com:8443/selloffer/offer_search.htm','https://s.1688.com/selloffer/offer_search.htm/','https://s.1688.com.evil.example/selloffer/offer_search.htm','https://user@s.1688.com/selloffer/offer_search.htm','https://detail.1688.com/offer/886034098637.html'])assert.throws(()=>listingPageUrl(bad));
 assert.deepEqual(listingOfferUrl('//detail.1688.com/offer/886034098637.html?x=1#i',listing),{offerId:'886034098637',sourceUrl:'https://detail.1688.com/offer/886034098637.html'});
 for(const bad of ['https://detail.1688.com.evil.example/offer/886034098637.html','https://detail.1688.com/offer/0886.html','http://detail.1688.com/offer/886.html','https://user:secret@detail.1688.com/offer/886.html','https://detail.1688.com/offer/886.html/more','javascript:alert(1)'])assert.equal(listingOfferUrl(bad),null);
});

test('loaded cards preserve title, safe thumbnail and observed price without manufacturing SKU data',()=>{
 const dom=listingPickerDom(),a=dom.card('886034098637',{title:'  原文\n商品  ',price:'¥ 4.60 – 5.00'}),b=dom.card('963861920029',{fallback:true,title:'第二商品',thumbnail:'https://evil.example/image.jpg'});
 const entries=scanListingCards(dom.document,listing);
 assert.equal(entries.length,2);assert.equal(entries[0].candidate.title,'原文 商品');assert.equal(entries[0].candidate.displayPrice,'¥ 4.60 – 5.00');assert.equal(entries[1].candidate.thumbnail,'');
 assert.deepEqual(Object.keys(entries[0].candidate),['offerId','sourceUrl','title','thumbnail','displayPrice']);
 const duplicate=dom.card('886034098637');assert.equal(scanListingCards(dom.document,listing).length,2);
 a.root.hidden=true;assert.equal(scanListingCards(dom.document,listing).find(entry=>entry.candidate.offerId==='886034098637').element===duplicate.root,true);b.root.remove();assert.equal(scanListingCards(dom.document,listing).length,1);
});

test('mixed links, explicit-ID disagreement, hidden cards and disconnected cards are not candidates',()=>{
 const dom=listingPickerDom(),source=dom.card('886034098637');
 source.root.setAttribute('data-offer-id','963861920029');assert.equal(readListingCard(source.root,listing),null);
 source.root.setAttribute('data-offer-id','886034098637');const other=dom.element('a');other.setAttribute('href','https://detail.1688.com/offer/963861920029.html');source.root.append(other);assert.equal(readListingCard(source.root,listing),null);other.remove();
 source.root.style.visibility='hidden';assert.equal(readListingCard(source.root,listing),null);source.root.style.visibility='';
 const parent=dom.element('div');parent.setAttribute('aria-hidden','true');dom.document.documentElement.append(parent);parent.append(source.root);assert.equal(readListingCard(source.root,listing),null);
 parent.removeAttribute('aria-hidden');assert.ok(readListingCard(source.root,listing));source.root.remove();assert.equal(readListingCard(source.root,listing),null);
});

test('selection belongs to the same connected card, and dispatch re-reads recycled identities',()=>{
 const dom=listingPickerDom(),a=dom.card('886034098637'),b=dom.card('963861920029'),selection=createListingSelection(),entries=scanListingCards(dom.document,listing);
 selection.set(entries[0],true);selection.set(entries[1],true);a.root.remove();
 assert.throws(()=>createListingBatchPayload({batchId:randomUUID(),listingUrl:listing,entries,selection,destinations:both}),/사라진 상품/);
 assert.equal(selection.size,1);const replacement=dom.card('886034098637');selection.reconcile(scanListingCards(dom.document,listing));assert.equal(selection.has(replacement.root),false);
 b.root.setAttribute('data-offer-id','1022260303756');b.link.setAttribute('href','https://detail.1688.com/offer/1022260303756.html');
 assert.throws(()=>createListingBatchPayload({batchId:randomUUID(),listingUrl:listing,entries,selection,destinations:both}),/바뀌거나 사라진/);assert.equal(selection.size,0);
});

test('batch destination validation supports either or both and rejects none, duplicate or unexpected fields',()=>{
 for(const destinations of [['ai-registration'],['rocket-compare'],both])assert.deepEqual(validateListingBatchPayload(payload({destinations})).destinations,destinations);
 for(const destinations of [[],['ai-registration','ai-registration'],['other'],new Array(1)])assert.throws(()=>validateListingBatchPayload(payload({destinations})));
 const extra=payload();extra.items[0].price=4.6;assert.throws(()=>validateListingBatchPayload(extra));
 const conflict=payload();conflict.items[0].sourceUrl='https://detail.1688.com/offer/1.html';assert.throws(()=>validateListingBatchPayload(conflict));
 const duplicate=payload();duplicate.items.push({...duplicate.items[0]});assert.throws(()=>validateListingBatchPayload(duplicate));
 assert.throws(()=>validateListingBatchPayload(payload({items:new Array(1)})));
 const badThumbnail=payload();badThumbnail.items[0].thumbnail='https://cbu01.alicdn.com.evil.example/img.jpg';assert.throws(()=>validateListingBatchPayload(badThumbnail));
});

test('batch item count and encoded bytes are bounded',()=>{
 assert.equal(LISTING_BATCH_LIMIT,60);assert.equal(LISTING_BATCH_BYTES,128*1024);
 const items=Array.from({length:60},(_,index)=>candidate(String(index+1)));assert.equal(validateListingBatchPayload(payload({items})).items.length,60);
 assert.throws(()=>validateListingBatchPayload(payload({items:[...items,candidate('61')]})));
 const large=items.map(item=>({...item,title:'中'.repeat(300),displayPrice:'元'.repeat(120),thumbnail:'https://cbu01.alicdn.com/'+ 'a'.repeat(1980)}));
 assert.throws(()=>validateListingBatchPayload(payload({items:large})),/크기를 초과/);
});

test('picker protocol matches server identity, text and listing URL bounds',()=>{
 const bounded=candidate('12345678901234567890');bounded.title='中'.repeat(500);bounded.displayPrice='¥  4.60';assert.equal(validateListingBatchPayload(payload({items:[bounded]})).items[0].title.length,500);
 for(const invalid of [{...bounded,offerId:'123456789012345678901',sourceUrl:'https://detail.1688.com/offer/123456789012345678901.html'},{...bounded,title:'中'.repeat(501)},{...bounded,title:''},{...bounded,title:' 商品'},{...bounded,displayPrice:'¥4.6\n'}])assert.throws(()=>validateListingBatchPayload(payload({items:[invalid]})));
 assert.throws(()=>listingPageUrl(listing+'&x='+'a'.repeat(6000)));
 const p=payload({items:[bounded]}),reply=snapshot(p);assert.equal(validateListingBatchReply({ok:true,batch:reply}).items[0].displayPrice,'¥  4.60');
});

test('a queue ACK is running, never a saved product or completed collection',()=>{
 const p=payload(),batch=snapshot(p),view=validateListingBatchReply({ok:true,batch},{batchId:p.batchId,destinations:both});
 assert.equal(view.status,'running');assert.equal(view.saved,0);assert.equal(view.queued,1);assert.equal(view.items[0].storedReceipt,undefined);
 const falseComplete=clone(batch);falseComplete.status='completed';assert.throws(()=>validateListingBatchReply({ok:true,batch:falseComplete}));
 const fakeSave=clone(batch);fakeSave.items[0].status='saved';fakeSave.saved=1;fakeSave.queued=0;assert.throws(()=>validateListingBatchReply({ok:true,batch:fakeSave}));
});

test('AI and comparison receipts are validated independently and private scope data is not projected',()=>{
 const p=payload(),batch=snapshot(p,{status:'completed',itemStatus:'saved',compareStatus:'saved'}),view=validateListingBatchReply({ok:true,batch},{batchId:p.batchId,destinations:both});
 assert.equal(view.saved,1);assert.equal(view.comparison.storedCount,1);assert.equal(view.comparison.receipt,undefined);assert.ok(view.items[0].storedReceipt);assert.equal(JSON.stringify(view).includes('private-owner'),false);assert.equal(JSON.stringify(view).includes('payloadSha256'),false);
 for(const change of [value=>{value.comparison.receipt.batchId=randomUUID();},value=>{value.comparison.receipt.itemOfferIds=['1'];},value=>{value.comparison.receipt.revision=2;},value=>{value.items[0].storedReceipt.captureVersion=0;},value=>{value.saved=0;}]){const invalid=clone(batch);change(invalid);assert.throws(()=>validateListingBatchReply({ok:true,batch:invalid}));}
 const compareOnly=payload({destinations:['rocket-compare']}),compareBatch=snapshot(compareOnly,{status:'completed',itemStatus:'saved',compareStatus:'saved'}),compareView=validateListingBatchReply({ok:true,batch:compareBatch});
 assert.equal(compareView.items[0].storedReceipt,undefined);assert.equal(compareView.destinations.includes('ai-registration'),false);
 assert.throws(()=>validateListingBatchReply({ok:true,batch:compareBatch},{destinations:both}));
});

test('status rejects malformed, oversized, sparse, mismatched or duplicated identities',()=>{
 assert.equal(validateListingBatchReply({ok:true,batch:null}),null);assert.throws(()=>validateListingBatchReply({ok:true,batch:null},{batchId:randomUUID()}));
 const p=payload({items:[candidate('1'),candidate('2')]}),batch=snapshot(p);
 for(const change of [value=>{value.items[1].itemId=value.items[0].itemId;},value=>{value.items[1].offerId='1';},value=>{delete value.items[0];},value=>{value.items[0].error='x'.repeat(1001);},value=>{value.updatedAt=Date.now()+60000;}]){const invalid=clone(batch);change(invalid);assert.throws(()=>validateListingBatchReply({ok:true,batch:invalid}));}
 assert.throws(()=>validateListingBatchReply({ok:true,batch},{batchId:randomUUID()}));assert.throws(()=>validateListingBatchReply({ok:true,batch,untrusted:'x'.repeat(300000)}));
});

test('UUID identities cannot be coerced from arrays, objects or non-string pending values',()=>{
 const p=payload(),uuid=p.batchId;
 for(const bad of [[uuid],{toString:()=>uuid},null,undefined,123]){assert.throws(()=>validateListingBatchPayload({...p,batchId:bad}));const b=snapshot(p);b.batchId=bad;assert.throws(()=>validateListingBatchReply({ok:true,batch:b}));}
 for(const field of ['itemId','storedId']){const b=snapshot(p,{status:'completed',itemStatus:'saved',compareStatus:'saved'});if(field==='itemId')b.items[0].itemId=[b.items[0].itemId];else b.items[0].storedReceipt.storedId=[b.items[0].storedReceipt.storedId];assert.throws(()=>validateListingBatchReply({ok:true,batch:b}));}
 assert.throws(()=>validateListingBatchReply({ok:true,batch:snapshot(p)},{batchId:[uuid]}));
});

test('only exact correlated non-creation proof releases a rejected START',()=>{
 const batchId=randomUUID(),proof={ok:false,accepted:false,batchId,code:'BATCH_PENDING',error:'원래 작업부터 확인해주세요.'};assert.equal(listingStartNotCreated(proof,batchId),true);
 for(const wrong of [{...proof,accepted:true},{...proof,batchId:randomUUID()},{...proof,batchId:[batchId]},{...proof,extra:true},{...proof,code:''},{...proof,error:{message:'failure'}},{ok:false,code:'BATCH_PENDING',error:'failure'}])assert.equal(listingStartNotCreated(wrong,batchId),false);
 assert.equal(listingStartNotCreated(proof,[batchId]),false);
});

function setupUi({amount=2,onMessage,bootstrap=null,uuid=randomUUID}={}){
 const dom=listingPickerDom(),cards=Array.from({length:amount},(_,index)=>dom.card(String(index+1))),timers=listingTimers(),messages=[];let latest=bootstrap;
 const runtime={sendMessage(message,callback){messages.push(message);if(onMessage?.(message,callback)===false)return;
  if(message.type==='YOOFAM_LISTING_BATCH_START')latest=snapshot(message.payload);
  callback({ok:true,batch:latest});
 }};
 const installed=installListingPicker({document:dom.document,location:{href:listing},runtime,MutationObserver:undefined,setTimeout:timers.setTimeout,clearTimeout:timers.clearTimeout,crypto:{randomUUID:uuid}});
 return {...dom,cards,timers,messages,installed,setBatch(value){latest=value;}};
}
const startMessages=ui=>ui.messages.filter(message=>message.type==='YOOFAM_LISTING_BATCH_START');
const click=async(ui,label)=>{const node=ui.find(label);assert.ok(node,`missing ${label}`);await node.emit('click');await flush();return node;};

test('picker only handles its reviewed route; untrusted clicks cannot select or dispatch',async()=>{
 const dom=listingPickerDom();assert.throws(()=>installListingPicker({document:dom.document,location:{href:'https://detail.1688.com/offer/1.html'}}));
 const ui=setupUi();await flush();assert.equal(ui.installed.host.shadowRoot,null);
 await ui.find('로딩된 상품 모두 선택').emit('click',{isTrusted:false});assert.equal(ui.installed.selection.size,0);
 await ui.find('선택 상품 담기').emit('click',{isTrusted:false});await ui.find('선택한 곳에 담기').emit('click',{isTrusted:false});assert.equal(startMessages(ui).length,0);ui.installed.cleanup();
});

test('selecting cards opens two checked destinations; only explicit confirmation dispatches',async()=>{
 const ui=setupUi();await flush();await click(ui,'로딩된 상품 모두 선택');await click(ui,'선택 상품 담기');
 assert.equal(startMessages(ui).length,0);const inputs=ui.elements.filter(node=>node.tag==='input'&&['AI상품등록 수집함','1688 소싱·로켓 비교함'].includes(node.getAttribute('aria-label')));assert.equal(inputs.length,2);assert.ok(inputs.every(input=>input.checked));
 await click(ui,'선택한 곳에 담기');assert.equal(startMessages(ui).length,1);assert.deepEqual(startMessages(ui)[0].payload.destinations,both);assert.equal(startMessages(ui)[0].payload.items.length,2);
 assert.equal(ui.find('선택 상품 담기').disabled,true);assert.ok(ui.elements.some(node=>node.textContent==='AI 수집함: 저장 확인 0/2 · 실패 0 · 미확정 0\n비교함: 대기'));
 ui.installed.scan();assert.equal(ui.find('선택 상품 담기').disabled,true);await click(ui,'선택한 곳에 담기');assert.equal(startMessages(ui).length,1);ui.installed.cleanup();
});

test('choice requires at least one target and emits only the chosen destination',async()=>{
 for(const chosen of ['ai-registration','rocket-compare']){
  const ui=setupUi({amount:1});await flush();await click(ui,'로딩된 상품 모두 선택');await click(ui,'선택 상품 담기');
  const inputs=ui.elements.filter(node=>node.tag==='input'&&both.includes(node.value));for(const input of inputs){input.checked=false;await input.emit('change');}
  assert.equal(ui.find('선택한 곳에 담기').disabled,true);await ui.find('선택한 곳에 담기').emit('click');await flush();assert.equal(startMessages(ui).length,0);
  const selected=inputs.find(input=>input.value===chosen);selected.checked=true;await selected.emit('change');assert.equal(ui.find('선택한 곳에 담기').disabled,false);await click(ui,'선택한 곳에 담기');assert.deepEqual(startMessages(ui)[0].payload.destinations,[chosen]);ui.installed.cleanup();
 }
});

test('removed and recycled cards are invalidated before START and their checkbox closures are replaced',async()=>{
 const ui=setupUi({amount:1});await flush();await click(ui,'로딩된 상품 모두 선택');await click(ui,'선택 상품 담기');ui.cards[0].root.remove();await click(ui,'선택한 곳에 담기');assert.equal(startMessages(ui).length,0);assert.equal(ui.installed.selection.size,0);ui.installed.cleanup();
 const recycled=setupUi({amount:1});await flush();await click(recycled,'로딩된 상품 모두 선택');const oldMarker=recycled.cards[0].root.firstChild;recycled.cards[0].root.setAttribute('data-offer-id','3');recycled.cards[0].link.setAttribute('href','https://detail.1688.com/offer/3.html');recycled.installed.scan();assert.equal(recycled.installed.selection.size,0);assert.equal(oldMarker.isConnected,false);
 const newMarker=recycled.cards[0].root.firstChild;assert.notEqual(newMarker,oldMarker);const label=newMarker.testShadow.childNodes.find(node=>node.tag==='label');await label.emit('click');await flush();await click(recycled,'선택 상품 담기');await click(recycled,'선택한 곳에 담기');assert.equal(startMessages(recycled)[0].payload.items[0].offerId,'3');recycled.installed.cleanup();
});

test('unknown START acknowledgement blocks duplicate dispatch and resumes status checks only',async()=>{
 const ui=setupUi({amount:1,onMessage:(message)=>message.type==='YOOFAM_LISTING_BATCH_START'?false:undefined});await flush();await click(ui,'로딩된 상품 모두 선택');await click(ui,'선택 상품 담기');
 const confirming=ui.find('선택한 곳에 담기').emit('click');await flush();assert.equal(startMessages(ui).length,1);await ui.timers.run(30000);await confirming;await flush();assert.equal(ui.find('선택 상품 담기').disabled,true);
 await click(ui,'선택한 곳에 담기');assert.equal(startMessages(ui).length,1);await ui.timers.run(2000);assert.equal(startMessages(ui).length,1);assert.ok(ui.messages.filter(message=>message.type==='YOOFAM_LISTING_BATCH_STATUS').length>=2);ui.installed.cleanup();
});

test('definite pre-START rejection unlocks selection and permits only a new explicit attempt',async()=>{
 const ui=setupUi({amount:1,onMessage(message,callback){if(message.type!=='YOOFAM_LISTING_BATCH_START')return;callback({ok:false,accepted:false,batchId:message.payload.batchId,code:'BATCH_LOGIN_REQUIRED',error:'앱 로그인 후 다시 담아주세요.'});return false;}});
 await flush();await click(ui,'로딩된 상품 모두 선택');await click(ui,'선택 상품 담기');await click(ui,'선택한 곳에 담기');assert.equal(startMessages(ui).length,1);assert.equal(ui.installed.selection.size,1);assert.equal(ui.find('선택한 곳에 담기').disabled,false);assert.equal(ui.timers.tasks.filter(timer=>timer.ms===2000).length,0);
 assert.equal(ui.messages.at(-1).type,'YOOFAM_LISTING_BATCH_STATUS');assert.equal(ui.messages.at(-1).batchId,null);
 const priorId=startMessages(ui)[0].payload.batchId;await click(ui,'선택한 곳에 담기');assert.equal(startMessages(ui).length,2);assert.notEqual(startMessages(ui)[1].payload.batchId,priorId);ui.installed.cleanup();
});

test('pre-START rejection recovers an existing pending batch using read-only latest lookup',async()=>{
 const existing=snapshot(payload(),{status:'paused'});let rejected=false;
 const ui=setupUi({amount:1,onMessage(message,callback){if(message.type==='YOOFAM_LISTING_BATCH_START'){rejected=true;callback({ok:false,accepted:false,batchId:message.payload.batchId,code:'BATCH_PENDING',error:'원래 작업부터 확인해주세요.'});return false;}if(rejected&&message.type==='YOOFAM_LISTING_BATCH_STATUS'){callback({ok:true,batch:existing});return false;}}});
 await flush();await click(ui,'로딩된 상품 모두 선택');await click(ui,'선택 상품 담기');await click(ui,'선택한 곳에 담기');assert.equal(startMessages(ui).length,1);assert.equal(ui.find('선택 상품 담기').disabled,true);assert.equal(ui.find('남은 상품 담기 계속').hidden,false);ui.installed.cleanup();
});

test('generic or mismatched START rejection remains locked without automatic retry',async()=>{
 for(const proof of [()=>({ok:false,code:'BATCH_PENDING',error:'결과 미확정'}),()=>({ok:false,accepted:false,batchId:randomUUID(),code:'BATCH_LOGIN_REQUIRED',error:'다른 요청'}),(id)=>({ok:false,accepted:false,batchId:[id],code:'BATCH_LOGIN_REQUIRED',error:'잘못된 식별값'})]){
  const ui=setupUi({amount:1,onMessage(message,callback){if(message.type!=='YOOFAM_LISTING_BATCH_START')return;callback(proof(message.payload.batchId));return false;}});await flush();await click(ui,'로딩된 상품 모두 선택');await click(ui,'선택 상품 담기');await click(ui,'선택한 곳에 담기');assert.equal(ui.find('선택 상품 담기').disabled,true);await ui.timers.run(2000);await flush();assert.equal(startMessages(ui).length,1);assert.equal(ui.find('선택 상품 담기').disabled,true);ui.installed.cleanup();
 }
});

test('a malformed generated batch ID cannot reach runtime START',async()=>{
 const ui=setupUi({amount:1,uuid:()=>[randomUUID()]});await flush();await click(ui,'로딩된 상품 모두 선택');await click(ui,'선택 상품 담기');await click(ui,'선택한 곳에 담기');assert.equal(startMessages(ui).length,0);assert.equal(ui.find('선택한 곳에 담기').disabled,false);ui.installed.cleanup();
});

test('completed actual receipts clear saved selections and distinguish the two channels',async()=>{
 const ui=setupUi({amount:1});await flush();await click(ui,'로딩된 상품 모두 선택');await click(ui,'선택 상품 담기');await click(ui,'선택한 곳에 담기');
 ui.setBatch(snapshot(startMessages(ui)[0].payload,{status:'completed',itemStatus:'saved',compareStatus:'saved'}));await ui.installed.readStatus();await flush();assert.equal(ui.installed.selection.size,0);assert.equal(ui.find('선택 상품 담기').disabled,true);
 assert.ok(ui.elements.some(node=>node.textContent==='AI 수집함: 저장 확인 1/1 · 실패 0 · 미확정 0\n비교함: 저장 확인 1/1'));assert.equal(ui.installed.host.textContent.includes('private-owner'),false);ui.installed.cleanup();
});

test('select loaded is bounded at sixty; pagehide clears its markers, observer and timers',async()=>{
 const ui=setupUi({amount:61});await flush();await click(ui,'로딩된 상품 모두 선택');assert.equal(ui.installed.selection.size,60);await click(ui,'선택 상품 담기');await click(ui,'선택한 곳에 담기');assert.equal(startMessages(ui)[0].payload.items.length,60);
 await ui.pagehide();assert.equal(ui.installed.host.isConnected,false);assert.equal(ui.timers.tasks.length,0);assert.equal(ui.document.querySelectorAll('[data-yoofam-listing-card]').length,0);
});
