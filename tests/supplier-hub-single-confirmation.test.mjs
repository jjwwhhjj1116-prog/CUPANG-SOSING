import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {singleDocumentIdentity} from '../extensions/supplier-hub/single-document.mjs';
import {singlePacket,SINGLE_SENDER,deferred} from './helpers/supplier-hub-single-document.mjs';

const clone=value=>structuredClone(value),plain=value=>JSON.parse(JSON.stringify(value));
const uiSource=fs.readFileSync(new URL('../extensions/supplier-hub/single-confirmation.js',import.meta.url),'utf8');
const bridgeSource=fs.readFileSync(new URL('../extensions/supplier-hub/single-content.js',import.meta.url),'utf8');
class Bus{
  listeners=new Map();
  addEventListener(type,fn){const set=this.listeners.get(type)??new Set();set.add(fn);this.listeners.set(type,set);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  emit(type,extra={}){const event={type,isTrusted:false,target:this,preventDefault(){this.prevented=true;},...extra};for(const fn of [...this.listeners.get(type)??[]])fn(event);return event;}
  count(){return [...this.listeners.values()].reduce((n,set)=>n+set.size,0);}
}
async function fixture(stage='productPage'){
  if(stage===null)stage=undefined;
  const packet=singlePacket();packet.accountContext=await hash(JSON.stringify(['sourceflow-managed-product-account-v1',packet.ownerId,packet.company.code,packet.company.name]));
  const context=await singleDocumentIdentity(packet,SINGLE_SENDER),window=new Bus(),document=new Bus(),roots=[],nodes=[],observers=new Set(),timers=new Map();
  let now=1_800_000_000_000,nextTimer=0,handler,actor={ownerId:packet.ownerId,company:clone(packet.company)},hook=null;
  class Node extends Bus{
    constructor(tag){super();this.tag=tag;this.children=[];this.parentNode=null;this.attributes={};this.checked=false;this.disabled=false;nodes.push(this);}
    get isConnected(){return this===document.documentElement||Boolean(this.parentNode?.isConnected);}
    get textContent(){return this._text??this.children.map(node=>node.textContent).join('');}
    set textContent(value){this._text=String(value);}
    set innerHTML(_value){throw Error('HTML injection is forbidden');}
    appendChild(node){node.parentNode=this;this.children.push(node);return node;}
    setAttribute(key,value){this.attributes[key]=value;}
    attachShadow(options){assert.equal(options.mode,'closed');this.shadowRoot=null;const root=new Node('#closed-shadow');root.parentNode=this;roots.push(root);return root;}
    focus(){document.activeElement=this;for(const root of roots)if(this.inside(root))root.activeElement=this;}
    inside(parent){return this===parent||Boolean(this.parentNode?.inside(parent));}
    remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}for(const observer of [...observers])observer.callback();}
  }
  document.documentElement=new Node('html');document.createElement=tag=>new Node(tag);document.visibilityState='visible';
  const previousFocus=new Node('button');document.documentElement.appendChild(previousFocus);document.activeElement=previousFocus;
  class Observer{constructor(callback){this.callback=callback;}observe(){observers.add(this);}disconnect(){observers.delete(this);}}
  const setTimer=(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,due:now+delay});return id;},clearTimer=id=>timers.delete(id);
  const value={format:'yoofam-supplier-hub-single-package-v1',prepared:true,registered:false,remoteWrites:false,submissionReady:false,
    productId:packet.productId,fingerprint:packet.fingerprint,company:clone(packet.company),schemaSha256:packet.schemaSha256,
    source:{...clone(packet.source),profileId:packet.profileId},options:[{optionId:packet.optionId,optionLabel:'합성 옵션'}],
    payload:clone(packet.body),review:{canPrepare:true,issues:[]}};
  const requests=[];
  const scope={crypto:webcrypto,TextEncoder,Uint8Array,AbortController,Date:class extends Date{static now(){return now;}},JSON,Array,Object,Error,Set,Number,Promise,structuredClone,
    window,document,MutationObserver:Observer,setTimeout:setTimer,clearTimeout:clearTimer,location:{origin:new URL(SINGLE_SENDER.url).origin},
    chrome:{runtime:{id:'extension',onMessage:{addListener:fn=>handler=fn}}},fetch:async(path,init)=>{
      requests.push({path,init});await hook?.(path,requests.length);
      const response=Response.json(path.includes('catalog-context')?actor:path.includes('supplier-hub-product-receipt')?{format:'yoofam-native-receipt-history-v1',productId:packet.productId,receipts:[]}:path.includes('supplier-hub-receipt')?{history:{productId:packet.productId,blocked:false}}:value);
      Object.defineProperty(response,'url',{value:new URL(SINGLE_SENDER.url).origin+path});return response;
    }};
  vm.createContext(scope);vm.runInContext(uiSource,scope);vm.runInContext(bridgeSource,scope);
  const source={identity:clone(context.identity),bodySha256:context.originalBodySha256,preparedBodySha256:context.bodySha256,packetDigest:context.packetDigest,requestId:packet.requestId,docId:'synthetic-doc'};
  const proof=await scope.verifySingleDocumentSource(source);
  const items=stage==='logisticsPage'?[]:[{key:'agreeMSRPTerm',id:'agreeMSRPTerm',text:'가격 자료 약관을 확인했습니다.',required:true,
    ...(stage?{title:'가격 정보 약관 <script>안전한 원문</script>',termsText:'첫 줄 <img src=x onerror=evil()>\n둘째 줄 & 원문을 생략하지 않습니다.'}:{})}];
  const challenge={id:'d'.repeat(64),docId:'synthetic-doc',packetDigest:context.packetDigest,items,issuedAt:now,expiresAt:now+120000,...(stage?{stage}:{})};
  const confirmation={action:stage==='productPage'||stage==='imagePage'?'confirm-and-continue':'confirm-and-submit',userInitiated:true,challengeId:challenge.id,confirmedAt:now,approvedKeys:items.filter(row=>row.required).map(row=>row.key),...(stage?{stage}:{})};
  const expected={identity:clone(context.identity),docId:challenge.docId,challenge,confirmation,sourceExpected:source,sessionId:proof.sessionId,identityDigest:context.identityDigest};
  const host=()=>document.documentElement.children.find(node=>node!==previousFocus),root=()=>roots.find(node=>node.parentNode?.isConnected);
  const find=(tag,text)=>nodes.find(node=>node.isConnected&&node.tag===tag&&(text===undefined||node.textContent===text));
  const click=(node,trusted=true)=>{assert.ok(node);if(node.disabled)return;if(node.tag==='input')node.checked=!node.checked;node.emit('click',{isTrusted:trusted});};
  const request=(input=expected,sender={id:'extension'})=>{
    let returned,reply;const promise=new Promise(resolve=>{returned=handler({type:'YOOFAM_CONFIRM_SINGLE_DOCUMENT_ACTION',expected:input},sender,value=>{reply=value;resolve(plain(value));});});
    return {promise,get returned(){return returned;},get reply(){return reply;}};
  };
  const h={scope,packet,context,expected,source,value,document,window,nodes,roots,timers,observers,requests,host,root,find,click,request,previousFocus,
    get now(){return now;},setActor(value){actor=clone(value);},setHook(value){hook=value;},
    advance(ms){now+=ms;for(const [id,timer] of [...timers])if(timer.due<=now){timers.delete(id);timer.fn();}},
    cleaned(){assert.equal(host(),undefined);assert.equal(window.count(),2);assert.equal(document.count(),1);assert.equal(observers.size,0);assert.equal(timers.size,0);assert.equal(document.activeElement,previousFocus);for(const node of nodes)assert.equal(node.count(),0);},
    approve(){for(const node of nodes.filter(node=>node.isConnected&&node.tag==='input'))click(node);click(find('button',stage==='productPage'||stage==='imagePage'?'동의하고 다음 단계 계속':'확인하고 견적서 제출'));},
  };
  return h;
}
async function hash(text){return Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(text))).toString('hex');}
async function settleUntil(predicate){for(let count=0;count<100;count++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,2));}assert.ok(predicate(),'expected async UI state');}
async function cleanupResult(h,operation){const result=await operation.promise;await settleUntil(()=>h.window.count()===2);h.cleaned();return result;}

for(const stage of ['productPage','imagePage',null,'logisticsPage'])test(`${stage??'legacy final'} requires its own actual unchecked choice and trusted final click`,async()=>{
  const h=await fixture(stage),operation=h.request();assert.equal(operation.returned,true);await settleUntil(()=>h.host());
  assert.equal(h.host().shadowRoot,null);const boxes=h.nodes.filter(node=>node.isConnected&&node.tag==='input');assert.ok(boxes.length);assert.ok(boxes.every(box=>box.checked===false));
  const confirm=h.find('button',stage==='productPage'||stage==='imagePage'?'동의하고 다음 단계 계속':'확인하고 견적서 제출');assert.equal(confirm.disabled,true);
  assert.match(h.root().textContent,/유앤채 · A01526306/);assert.match(h.root().textContent,/synthetic-product/);assert.match(h.root().textContent,/synthetic-option/);assert.match(h.root().textContent,/synthetic-doc/);
  if(stage==='productPage'||stage==='imagePage'){
    assert.ok(h.root().textContent.includes(h.expected.challenge.items[0].title));assert.ok(h.root().textContent.includes(h.expected.challenge.items[0].termsText));
    assert.ok(h.nodes.every(node=>!['script','img'].includes(node.tag)));
  }
  h.click(boxes[0],false);assert.equal(boxes[0].checked,false);assert.equal(confirm.disabled,true);
  for(const box of boxes)h.click(box);h.click(confirm,false);assert.equal(operation.reply,undefined);assert.ok(h.host());
  h.click(confirm);const result=await cleanupResult(h,operation);
  assert.deepEqual(result,{ok:true,userInitiated:true,challengeId:h.expected.challenge.id,identityDigest:h.context.identityDigest,checkedAt:h.now});
  assert.equal(h.requests.length,15);assert.ok(h.requests.every(row=>row.init.method===undefined));
});

for(const mode of ['cancel','escape','overlay','hidden','pagehide','removed','expired'])test(`${mode} cancels confirmation and removes every UI/lifecycle resource`,async()=>{
  const h=await fixture(),operation=h.request();await settleUntil(()=>h.host());
  if(mode==='cancel'){const cancel=h.find('button','취소');h.click(cancel,false);assert.ok(h.host());h.click(cancel);}
  if(mode==='escape'){h.root().emit('keydown',{isTrusted:false,key:'Escape'});assert.ok(h.host());h.root().emit('keydown',{isTrusted:true,key:'Escape'});}
  if(mode==='overlay'){const overlay=h.nodes.find(node=>node.isConnected&&node.className==='backdrop');overlay.emit('click',{isTrusted:true,target:overlay});}
  if(mode==='hidden'){h.document.visibilityState='hidden';h.document.emit('visibilitychange');}
  if(mode==='pagehide')h.window.emit('pagehide');
  if(mode==='removed')h.host().remove();
  if(mode==='expired')h.advance(120001);
  const result=await cleanupResult(h,operation);assert.equal(result.ok,false);assert.equal(result.userInitiated,undefined);assert.equal(h.requests.length,10);
});

test('one active request locks synchronously even before the source pre-read finishes',async()=>{
  const h=await fixture(),held=deferred();h.setHook((path,count)=>count===6?held.promise:undefined);
  const first=h.request(),second=h.request();assert.equal(second.returned,undefined);assert.equal(second.reply.ok,false);assert.equal(h.host(),undefined);
  held.resolve();await settleUntil(()=>h.host());h.click(h.find('button','취소'));assert.equal((await cleanupResult(h,first)).ok,false);
  const next=h.request();await settleUntil(()=>h.host());h.approve();assert.equal((await cleanupResult(h,next)).ok,true);
});

test('changed challenge text cannot authorize the immutable displayed request',async()=>{
  const h=await fixture(),operation=h.request();await settleUntil(()=>h.host());h.expected.challenge.items[0].termsText+=' changed';h.approve();
  const result=await cleanupResult(h,operation);assert.equal(result.ok,false);assert.equal(h.requests.length,10);
});

for(const change of ['actor','source','session-aba'])test(`post-click fresh ${change} proof rejects consent`,async()=>{
  const h=await fixture(),operation=h.request();await settleUntil(()=>h.host());
  if(change==='actor')h.setActor({ownerId:'other-member',company:{code:'A01464742',name:'와이홉'}});
  if(change==='source')h.value.fingerprint='f'.repeat(64);
  if(change==='session-aba'){
    h.setActor({ownerId:'other-member',company:{code:'A01464742',name:'와이홉'}});await assert.rejects(h.scope.verifySingleDocumentSource(h.source));
    h.setActor({ownerId:h.packet.ownerId,company:h.packet.company});await assert.rejects(h.scope.verifySingleDocumentSource(h.source));
    const proof=await h.scope.verifySingleDocumentSource(h.source);assert.notEqual(proof.sessionId,h.expected.sessionId);
  }
  h.approve();const result=await cleanupResult(h,operation);assert.equal(result.ok,false);assert.equal(result.userInitiated,undefined);
});

test('absolute expiry cancels a stalled pre-read and prevents a late prompt',async()=>{
  const h=await fixture(),held=deferred();h.setHook((path,count)=>count===6?held.promise:undefined);const operation=h.request();
  await settleUntil(()=>h.requests.length===6);h.advance(120001);assert.equal((await cleanupResult(h,operation)).ok,false);
  held.resolve();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(h.host(),undefined);assert.equal(h.timers.size,0);
});

test('absolute expiry while post-read is stalled cannot return late authorization',async()=>{
  const h=await fixture(),held=deferred();h.setHook((path,count)=>count===11?held.promise:undefined);const operation=h.request();await settleUntil(()=>h.host());h.approve();
  await settleUntil(()=>h.requests.length===11);h.advance(120001);assert.equal((await cleanupResult(h,operation)).ok,false);
  held.resolve();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(operation.reply.ok,false);assert.equal(h.host(),undefined);
});

test('multiple required choices are independent and keyboard focus remains in the modal',async()=>{
  const h=await fixture();h.expected.challenge.items.push({key:'additional',id:'additional',text:'두 번째 필수 확인',required:true,title:'두 번째 약관',termsText:'별도 약관 전체 원문'});h.expected.confirmation.approvedKeys.push('additional');
  const operation=h.request();await settleUntil(()=>h.host());const boxes=h.nodes.filter(node=>node.isConnected&&node.tag==='input'),confirm=h.find('button','동의하고 다음 단계 계속');
  h.click(boxes[0]);assert.equal(confirm.disabled,true);h.click(boxes[1]);assert.equal(confirm.disabled,false);h.click(boxes[0]);assert.equal(confirm.disabled,true);
  boxes[0].focus();const event=h.root().emit('keydown',{isTrusted:true,key:'Tab',shiftKey:true});assert.equal(event.prevented,true);assert.equal(h.root().activeElement,h.find('button','취소'));
  h.click(h.find('button','취소'));assert.equal((await cleanupResult(h,operation)).ok,false);
});

const invalid=[
  ['missing source proof',v=>delete v.sourceExpected],['foreign identity',v=>v.sourceExpected.identity.ownerId='other'],['wrong identity origin',v=>v.identity.origin='https://other.test'],
  ['wrong company',v=>v.identity.company.name='다른 회사'],['session ID',v=>v.sessionId=''],['identity hash',v=>v.identityDigest='invalid'],
  ['unknown challenge field',v=>v.challenge.extra=true],['bad challenge hash',v=>v.challenge.id='short'],['document mismatch',v=>v.docId='other'],['packet mismatch',v=>v.challenge.packetDigest='f'.repeat(64)],
  ['expired',v=>v.challenge.expiresAt=v.challenge.issuedAt],['future issued',v=>{v.challenge.issuedAt+=6000;v.challenge.expiresAt=v.challenge.issuedAt+120000;}],
  ['unknown stage',v=>v.challenge.stage='legalPage'],['stage submit action',v=>v.confirmation.action='confirm-and-submit'],['wrong confirmation stage',v=>v.confirmation.stage='imagePage'],
  ['unapproved keys',v=>v.confirmation.approvedKeys=[]],['duplicate approvals',v=>v.confirmation.approvedKeys.push(v.confirmation.approvedKeys[0])],['not user initiated',v=>v.confirmation.userInitiated=false],
  ['changed challenge ID',v=>v.confirmation.challengeId='f'.repeat(64)],['confirmation from future',v=>v.confirmation.confirmedAt+=6000],
  ['missing terms',v=>delete v.challenge.items[0].termsText],['missing title',v=>delete v.challenge.items[0].title],['long terms',v=>v.challenge.items[0].termsText='x'.repeat(50001)],
  ['long title',v=>v.challenge.items[0].title='x'.repeat(501)],['empty visible label',v=>v.challenge.items[0].text=' '],['duplicate item',v=>v.challenge.items.push(clone(v.challenge.items[0]))],
  ['no required stage item',v=>{v.challenge.items[0].required=false;v.confirmation.approvedKeys=[];}],['unknown item field',v=>v.challenge.items[0].checked=true],
  ['too many items',v=>v.challenge.items=Array(21).fill(v.challenge.items[0])],['unexpected confirmation token',v=>v.confirmation.token='reusable'],
];
for(const [name,change] of invalid)test(`malformed ${name} fails synchronously without source read or UI`,async()=>{
  const h=await fixture();change(h.expected);const operation=h.request();assert.equal(operation.returned,undefined);assert.equal(operation.reply.ok,false);assert.equal(h.requests.length,5);h.cleaned();
});

test('wrong identity digest or changed prepared body fails before prompt even with syntactically valid hashes',async()=>{
  for(const change of [v=>v.identityDigest='f'.repeat(64),v=>v.sourceExpected.bodySha256='f'.repeat(64),v=>v.sourceExpected.preparedBodySha256='f'.repeat(64)]){
    const h=await fixture();change(h.expected);assert.equal((await cleanupResult(h,h.request())).ok,false);assert.equal(h.host(),undefined);
  }
});

test('foreign extension sender does not receive or open a confirmation',async()=>{
  const h=await fixture(),operation=h.request(h.expected,{id:'another-extension'});assert.equal(operation.returned,undefined);assert.equal(operation.reply,undefined);h.cleaned();
});

test('empty item final challenge only works for logisticsPage and explicit submit action',async()=>{
  for(const stage of [null,'productPage','imagePage']){const h=await fixture(stage);h.expected.challenge.items=[];h.expected.confirmation.approvedKeys=[];assert.equal(h.request().reply.ok,false);h.cleaned();}
  const h=await fixture('logisticsPage');h.expected.confirmation.action='confirm-and-continue';assert.equal(h.request().reply.ok,false);h.cleaned();
});

test('a hidden document never displays a trusted prompt or sends an authorization',async()=>{
  const h=await fixture();h.document.visibilityState='hidden';assert.equal((await cleanupResult(h,h.request())).ok,false);assert.equal(h.requests.length,5);
});
