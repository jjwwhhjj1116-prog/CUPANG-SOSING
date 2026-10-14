import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {singleDocumentIdentity} from '../extensions/supplier-hub/single-document.mjs';
import {dispatchSingleDocument} from '../extensions/supplier-hub/single-dispatch.mjs';
const native=createRequire(import.meta.url),origin='https://sourceflow.jjwwhhjj1116.workers.dev';
const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const plain=value=>JSON.parse(JSON.stringify(value));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const flatten=tree=>typeof tree==='string'?tree:Array.isArray(tree)?tree.map(flatten).join(' '):tree&&typeof tree==='object'?flatten(tree.props?.children):'';
function fixture(company=companies[0],options={}){
 const clock={now:Date.now()},timers=new Map(),listeners=new Set(),calls=[],sent=[],modules=new Map(),slots=[],effects=[];
 let cursor=0,mountedKey=null,props,sequence=0;
 const saved={format:'yoofam-supplier-hub-single-package-v1',prepared:false,registered:false,remoteWrites:false,submissionReady:false,productId:'synthetic-stage-656',fingerprint:'a'.repeat(64),company:plain(company),schemaSha256:'b'.repeat(64),
  source:{productVersion:'2026-10-14T00:00:00.000Z',contentRevision:2,optionRevision:3,quotationRevision:4,profileId:'profile-656',profileRevision:5},options:[{optionId:'option-656',optionLabel:'합성 검정'}],
  payload:{docId:null,productName:'직접 검토한 합성상품',categoryPath:'운동 > 보호대 (81452)',categoryId:5562,displayCategoryCode:'81452',scope:'Retail_Categorized_Single',productNoticeNumber:25,version:188,
   jsonDocument:[{startPage:{productName:'직접 검토한 합성상품',categoryPath:'운동 > 보호대 (81452)'},productPage:{modelNumber:'',commonAttributes:{purchasePrice:'11960',coupangSalePrice:'19930'}},imagePage:{msrpAgree:true,labelContactAgreed:true,images:{mainImage:'https://fixture.invalid/synthetic.png'}}}]},
  review:{canPrepare:true,issues:[],fields:[]},manifest:[{optionId:'option-656',role:'main',files:[{key:'owner/private.png',url:'https://fixture.invalid/synthetic.png',sha256:'c'.repeat(64),byteLength:10,published:true}]}]};
 const view={productVersion:saved.source.productVersion,contentRevision:2,optionRevision:3,revision:4,inputFingerprint:'d'.repeat(64),categoryContext:{profileId:'profile-656',categoryId:'81452',categoryPath:['운동','보호대'],source:'profile'},resolved:{rows:[{optionId:'option-656',included:true}]}};
 const f={clock,saved,view,calls,sent,timers,listeners,actor:{ownerId:'owner-656',company:plain(company)},context:null};
 const sender={url:origin+'/',frameId:0,tab:{id:71,windowId:72}};
 const wait=async()=>new Promise(resolve=>setImmediate(resolve));
 const win={location:{origin},addEventListener(type,fn){if(type==='message')listeners.add(fn);},removeEventListener(type,fn){if(type==='message')listeners.delete(fn);},postMessage(message,target){assert.equal(target,origin);assert.equal(message.type,'SINGLE_DOCUMENT');sent.push({message,snapshot:plain(message)});void Promise.resolve().then(async()=>{const result=await f.bridge(message.payload);f.emit(message,result);}).catch(error=>f.emit(message,null,{ok:false,error:error.message}));}};
 f.emit=(message,result,envelope)=>{for(const fn of [...listeners])fn({source:win,origin,data:{channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId:message.requestId,result:envelope??{ok:true,result}}});};
 const setTimer=(fn,delay)=>{const id=++sequence;timers.set(id,{fn,delay,due:clock.now+delay});return id;};
 const clearTimer=id=>timers.delete(id);
 class LocalDate extends Date{static now(){return clock.now;}}
 const hook=(effect,deps,layout)=>{const i=cursor++,old=slots[i];if(!old||!deps||deps.some((item,j)=>!Object.is(item,old.deps[j]))){old?.cleanup?.();slots[i]={deps,cleanup:null};const run=()=>{slots[i].cleanup=effect();};if(layout)run();else effects.push(run);}};
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useLayoutEffect:(effect,deps)=>hook(effect,deps,true),useEffect:(effect,deps)=>hook(effect,deps,false)};
 f.fetch=async(url,init)=>{if(url==='/api/supplier-hub/catalog-context')return Response.json(f.actor);if(String(url).includes('/supplier-hub-single-package')){if(init?.method==='POST')saved.prepared=true;return Response.json(saved);}throw Error('Unexpected/forbidden URL '+url);};
 const load=file=>{if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,Error,Date:LocalDate,TextEncoder,Uint8Array,AbortController,structuredClone,crypto:webcrypto,window:win,setTimeout:setTimer,clearTimeout:clearTimer,
   fetch:async(url,init)=>{calls.push({url,method:init?.method??'GET',body:init?.body?JSON.parse(init.body):undefined,signal:init?.signal});return f.fetch(url,init);},require:name=>name==='react'?react:name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name)});return exports;};
 f.client=load('app/supplier-hub-single-client.ts');
 props={productId:saved.productId,profileId:'profile-656',view,disabled:false};
 f.render=(next=props)=>{props=next;cursor=0;let tree=load('app/components/supplier-hub-single-review.tsx').SupplierHubSingleReview(props);if(mountedKey!==null&&tree.key!==mountedKey){slots.forEach(slot=>slot?.cleanup?.());slots.length=0;effects.length=0;}mountedKey=tree.key;cursor=0;tree=tree.type(tree.props);return tree;};
 f.flush=()=>{f.render();effects.splice(0).forEach(run=>run());};
 f.idle=async()=>{f.flush();const end=Date.now()+3000;while(f.render().props['aria-busy']){await wait();f.flush();if(Date.now()>end)throw Error('UI did not settle');}};
 f.waitFor=async predicate=>{const end=Date.now()+3000;while(!predicate()){await wait();f.flush();if(Date.now()>end)throw Error('Condition timeout');}};
 f.button=label=>nodes(f.render()).find(node=>node.type==='button'&&node.props.children===label);
 f.click=async label=>{const button=f.button(label);assert.ok(button,label);assert.equal(Boolean(button.props.disabled),false,label);button.props.onClick();await f.idle();};
 f.select=()=>{const select=nodes(f.render()).find(node=>node.type==='select');assert.ok(select);select.props.onChange({target:{value:'option-656'}});f.flush();};
 f.check=()=>{const checkbox=nodes(f.render()).find(node=>node.type==='input'&&node.props.type==='checkbox');assert.ok(checkbox);checkbox.props.onChange({target:{checked:true}});f.flush();};
 f.text=()=>flatten(f.render());
 f.close=()=>{slots.forEach(slot=>slot?.cleanup?.());};
 f.change=next=>{f.render({...props,...next});f.flush();};
 f.advance=async amount=>{clock.now+=amount;for(const [id,timer]of [...timers])if(timer.due<=clock.now){timers.delete(id);timer.fn();}f.flush();await wait();f.flush();};
 f.result=(state,challenge,extra={})=>({format:f.context.packet.format,requestId:f.context.packet.requestId,identity:plain(f.context.identity),identityDigest:f.context.identityDigest,packetDigest:f.context.packetDigest,originalBodySha256:f.context.originalBodySha256,preparedBodySha256:f.context.bodySha256,state,docId:'synthetic-doc-656',registered:false,success:false,needsRecovery:false,...(challenge?{challenge}:{}),...extra});
 f.challenge=(stage='productPage')=>({id:(stage==='productPage'?'1':stage==='imagePage'?'2':'3').repeat(64),docId:'synthetic-doc-656',packetDigest:f.context.packetDigest,stage,issuedAt:clock.now,expiresAt:clock.now+120000,
  items:stage==='logisticsPage'?[]:[{key:stage==='productPage'?'msrpAgree':'labelContactAgreed',id:stage==='productPage'?'agreeMSRPTerm':'agreeLabelContact',text:'전체 동의 문구 '+stage,required:true,title:'정확한 약관 제목 '+stage,termsText:'첫 문단\n중간 전문\n마지막 문단 '+stage}]});
 f.bridge=async payload=>{f.context=await singleDocumentIdentity(plain(payload.packet),sender);if(payload.action==='preview'){const result=await dispatchSingleDocument({type:'YOOFAM_SINGLE_DOCUMENT_REQUEST',...plain(payload)},sender);return options.verified?{...result,liveVerified:true}:result;}return f.result('awaiting-stage-consent',f.challenge());};
 f.prepare=async()=>{await f.click('개별 견적 자료 검토');await f.click('이미지 전송 자료 준비');f.select();await f.click('개별 전송 자료 확인');};
 f.render();f.flush();return f;
}
for(const company of companies)test(company.name+': mount is read-only; explicit preparation and false live gate never expose or send a start',async()=>{
 const h=fixture(company);try{await h.idle();assert.equal(h.calls.length,0);assert.equal(h.sent.length,0);await h.prepare();assert.deepEqual(h.calls.map(call=>call.method),['GET','POST','GET','GET']);assert.equal(h.calls[1].body.expectedFingerprint,h.saved.fingerprint);assert.deepEqual(h.sent.map(call=>call.snapshot.payload.action),['preview']);assert.equal(h.button('선택 옵션의 개별 견적 등록 시작'),undefined);assert.match(h.text(),/현재 상품은 전송하지 않았습니다/);
  const packet=h.sent[0].message.payload.packet;assert.ok(Object.isFrozen(packet)&&Object.isFrozen(packet.company)&&Object.isFrozen(packet.body.jsonDocument[0]));const before=JSON.stringify(packet);h.saved.company.name='원본 테스트 변동';h.saved.payload.jsonDocument[0].startPage.productName='원본 테스트 변동';assert.equal(JSON.stringify(packet),before);const session=await h.client.previewSingleDocument(packet,new AbortController().signal);await assert.rejects(h.client.runSingleDocument(session,'start',new AbortController().signal),error=>error.code==='SINGLE_LIVE_CONTRACT_UNVERIFIED');assert.ok(h.sent.every(call=>call.snapshot.payload.action==='preview'));
 }finally{h.close();}
});
for(const company of companies)test(company.name+': complete terms, separate stage intentions and final empty-item consent reuse one immutable packet',async()=>{
 const h=fixture(company,{verified:true});try{await h.prepare();let confirmations=0;h.bridge=async payload=>{if(payload.action==='start')return h.result('awaiting-stage-consent',h.challenge('productPage'));assert.equal(payload.action,'confirm');confirmations++;if(confirmations===1){assert.equal(payload.confirmation.action,'confirm-and-continue');assert.equal(payload.confirmation.stage,'productPage');assert.deepEqual(plain(payload.confirmation.approvedKeys),['msrpAgree']);return h.result('awaiting-stage-consent',h.challenge('imagePage'));}if(confirmations===2){assert.equal(payload.confirmation.stage,'imagePage');assert.deepEqual(plain(payload.confirmation.approvedKeys),['labelContactAgreed']);return h.result('awaiting-consent',h.challenge('logisticsPage'));}assert.equal(payload.confirmation.action,'confirm-and-submit');assert.equal(payload.confirmation.stage,'logisticsPage');assert.deepEqual(plain(payload.confirmation.approvedKeys),[]);return h.result('accepted',null,{receipt:{state:'accepted',docId:'synthetic-doc-656',company:plain(company),identityDigest:h.context.identityDigest,preparedBodySha256:h.context.bodySha256,receiptId:'synthetic-receipt-656',observedAt:h.clock.now,evidence:'document-receipt'}});};
  await h.click('선택 옵션의 개별 견적 등록 시작');assert.match(h.text(),/첫 문단\n중간 전문\n마지막 문단 productPage/);assert.equal(h.button('현재 단계 동의 확인 · 계속').props.disabled,true);const productConfirm=h.button('현재 단계 동의 확인 · 계속').props.onClick;h.check();await h.click('현재 단계 동의 확인 · 계속');assert.match(h.text(),/마지막 문단 imagePage/);assert.equal(h.button('현재 단계 동의 확인 · 계속').props.disabled,true);productConfirm();await h.idle();assert.equal(confirmations,1,'old product consent callback cannot approve image/final');h.check();await h.click('현재 단계 동의 확인 · 계속');assert.match(h.text(),/최종 제출/);assert.equal(nodes(h.render()).filter(n=>n.type==='input'&&n.props.type==='checkbox').length,0);assert.equal(h.button('현재 문서 최종 제출 확인').props.disabled,false);assert.equal(confirmations,2);await h.click('현재 문서 최종 제출 확인');assert.equal(confirmations,3);assert.match(h.text(),/SKU 확인 전/);assert.ok(!h.text().includes('접수·SKU 증거를 확인했습니다.'));
  const packets=h.sent.map(call=>JSON.stringify(call.snapshot.payload.packet));assert.equal(new Set(packets).size,1);assert.equal(h.sent.filter(call=>call.snapshot.payload.action==='start').length,1);assert.equal(h.saved.payload.jsonDocument[0].imagePage.msrpAgree,true);
 }finally{h.close();}
});
test('expired challenge aborts the active call, never repeats consent, and explicit recovery resumes the same packet',async()=>{
 const h=fixture(companies[0],{verified:true});try{await h.prepare();await h.click('선택 옵션의 개별 견적 등록 시작');h.check();let release;h.bridge=payload=>payload.action==='confirm'?new Promise(resolve=>{release=resolve;}):payload.action==='recover'?h.result('navigation-requested',null):h.result('awaiting-stage-consent',h.challenge('imagePage'));
  h.button('현재 단계 동의 확인 · 계속').props.onClick();await h.waitFor(()=>Boolean(release));const sent=h.sent.length;await h.advance(120001);assert.equal(h.sent.length,sent);assert.equal(h.button('현재 단계 동의 확인 · 계속').props.disabled,true);assert.ok(h.button('개별 요청 저장 결과 확인'));release(h.result('awaiting-stage-consent',h.challenge('imagePage')));await h.idle();assert.match(h.text(),/만료/);await h.click('개별 요청 저장 결과 확인');assert.ok(h.button('개별 견적 단계 계속 확인'));await h.click('개별 견적 단계 계속 확인');assert.match(h.text(),/imagePage/);assert.equal(h.sent.filter(call=>call.snapshot.payload.action==='confirm').length,1);assert.equal(new Set(h.sent.map(call=>JSON.stringify(call.snapshot.payload.packet))).size,1);
 }finally{h.close();}
});
test('idle challenge expiration refreshes current terms with recover, never resume or repeated approval',async()=>{
 const h=fixture(companies[0],{verified:true});try{await h.prepare();await h.click('선택 옵션의 개별 견적 등록 시작');h.check();const old=h.button('현재 단계 동의 확인 · 계속').props.onClick;
  h.bridge=payload=>{assert.equal(payload.action,'recover');return h.result('awaiting-stage-consent',h.challenge('productPage'));};
  await h.advance(120001);assert.equal(h.button('현재 단계 동의 확인 · 계속').props.disabled,true);const before=h.sent.length;old();await h.idle();assert.equal(h.sent.length,before);await h.click('동의 내용 다시 확인');assert.equal(h.sent.at(-1).snapshot.payload.action,'recover');assert.equal(h.button('현재 단계 동의 확인 · 계속').props.disabled,true);assert.equal(h.sent.filter(call=>call.snapshot.payload.action==='confirm').length,0);
 }finally{h.close();}
});
for(const kind of ['disabled','source','unmount'])test('held preview and old handlers are invalidated by '+kind,async()=>{
 const h=fixture(companies[0],{verified:true});try{await h.click('개별 견적 자료 검토');await h.click('이미지 전송 자료 준비');h.select();let release;h.bridge=()=>new Promise(resolve=>{release=resolve;});const old=h.button('개별 전송 자료 확인').props.onClick;old();await h.waitFor(()=>Boolean(release));if(kind==='disabled')h.change({disabled:true});if(kind==='source')h.change({view:{...h.view,revision:5,inputFingerprint:'e'.repeat(64)}});if(kind==='unmount')h.close();release({format:'yoofam-supplier-hub-single-document-v1',liveVerified:true});await new Promise(resolve=>setImmediate(resolve));if(kind!=='unmount'){await h.idle();assert.equal(h.button('선택 옵션의 개별 견적 등록 시작'),undefined);}const before=h.sent.length;old();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.sent.length,before);assert.equal(h.listeners.size,0);
 }finally{h.close();}
});
test('approved company change clears the packet before any start action is sent',async()=>{
 const h=fixture(companies[0],{verified:true});try{await h.prepare();h.actor={ownerId:'owner-656',company:companies[1]};await h.click('선택 옵션의 개별 견적 등록 시작');assert.deepEqual(h.sent.map(call=>call.snapshot.payload.action),['preview']);assert.equal(h.button('선택 옵션의 개별 견적 등록 시작'),undefined);assert.match(h.text(),/회원 회사가 변경/);
 }finally{h.close();}
});
test('challenge expiry, document/digest mismatch, stage mismatch and missing complete terms are rejected',async()=>{
 const h=fixture(companies[0],{verified:true});try{await h.prepare();const session=await h.client.previewSingleDocument(h.sent[0].message.payload.packet,new AbortController().signal),challenge=h.challenge();
  for(const changed of [{packetDigest:'f'.repeat(64)},{docId:'other-doc'},{expiresAt:h.clock.now-1},{stage:'logisticsPage'},{items:[{...challenge.items[0],termsText:undefined}]}])assert.throws(()=>h.client.validateSingleConsentChallenge({...challenge,...changed},session,'awaiting-stage-consent','synthetic-doc-656',h.clock.now));
  assert.throws(()=>h.client.singleConsentConfirmation(challenge,[],h.clock.now));assert.throws(()=>h.client.singleConsentConfirmation(challenge,['msrpAgree'],challenge.expiresAt));
 }finally{h.close();}
});
test('misbound mutation reply is uncertain and never claims completion or silently restarts',async()=>{
 const h=fixture(companies[0],{verified:true});try{await h.prepare();h.bridge=()=>h.result('awaiting-stage-consent',{...h.challenge(),packetDigest:'f'.repeat(64)});await h.click('선택 옵션의 개별 견적 등록 시작');assert.ok(h.button('개별 요청 저장 결과 확인'));assert.equal(h.button('선택 옵션의 개별 견적 등록 시작'),undefined);assert.equal(h.sent.filter(call=>call.snapshot.payload.action==='start').length,1);assert.ok(!h.text().includes('접수·SKU 증거를 확인했습니다.'));
 }finally{h.close();}
});
test('confirmation bridge timeout is bounded to 120 seconds, cleans listeners and never retries missing ACK',async()=>{
 const h=fixture();try{await h.prepare();h.bridge=()=>new Promise(()=>{});const packet=h.sent[0].message.payload.packet,confirmation={action:'confirm-and-submit',userInitiated:true,stage:'logisticsPage',challengeId:'1'.repeat(64),confirmedAt:h.clock.now,approvedKeys:[]};const promise=h.client.singleDocumentExchange('confirm',packet,new AbortController().signal,confirmation);const reject=assert.rejects(promise,error=>error.code==='SINGLE_ACK_MISSING'&&error.uncertain===true);assert.ok([...h.timers.values()].some(timer=>timer.delay===120000));const before=h.sent.length;await h.advance(120000);await reject;assert.equal(h.sent.length,before);assert.equal(h.listeners.size,0);
 }finally{h.close();}
});
test('actual handoff content maps the Single bridge to one strict worker command and leaves existing requests unchanged',async()=>{
 const listeners=[],replies=[],sent=[];const window={addEventListener:(type,callback)=>{if(type==='message')listeners.push(callback);},postMessage:(message,target)=>replies.push({message,target})};
 const chrome={runtime:{id:'synthetic-extension',getManifest:()=>({version:'0.2.67'}),onMessage:{addListener(){}},sendMessage:async message=>{sent.push(plain(message));return{ok:true,result:{state:'awaiting-stage-consent'}};}}};
 vm.runInNewContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-content.js',import.meta.url),'utf8'),{window,location:{origin},chrome});
 const payload={action:'confirm',packet:{requestId:'synthetic'},confirmation:{action:'confirm-and-continue',stage:'productPage'}};await listeners[0]({source:window,origin,data:{channel:'YOOFAM_HUB_HANDOFF',type:'SINGLE_DOCUMENT',requestId:'a'.repeat(36),payload}});
 assert.equal(sent.length,1);assert.equal(sent[0].type,'YOOFAM_SINGLE_DOCUMENT_REQUEST');assert.deepEqual(sent[0].confirmation,payload.confirmation);assert.equal(replies[0].target,origin);assert.equal(replies[0].message.result.ok,true);await listeners[0]({source:{},origin,data:{channel:'YOOFAM_HUB_HANDOFF',type:'SINGLE_DOCUMENT',requestId:'b'.repeat(36),payload}});assert.equal(sent.length,1);
});
const nativeReceipt=(h,sourceStatus,qvtRequestId=20265801)=>{
 const state={SUBMITTED:'pending',FINISHED:'accepted',REJECTED:'rejected'}[sourceStatus];
 return h.result(state,null,{receipt:{state,docId:'synthetic-doc-656',company:plain(h.saved.company),identityDigest:h.context.identityDigest,
  preparedBodySha256:h.context.bodySha256,observedAt:h.clock.now,evidence:'document-receipt',sourceStatus,qvtRequestId,receiptId:qvtRequestId}});
};
for(const company of companies)for(const [sourceStatus,label]of [['SUBMITTED','접수 처리 중'],['FINISHED','등록 파일 처리 완료 · SKU 확인 전'],['REJECTED','반려']])
 test(company.name+': '+sourceStatus+' shows exact native registration-file identity without inventing a SKU',async()=>{
  const h=fixture(company,{verified:true});try{await h.prepare();const session=await h.client.previewSingleDocument(h.sent[0].message.payload.packet,new AbortController().signal);h.bridge=()=>nativeReceipt(h,sourceStatus,'00165801');await h.click('선택 옵션의 개별 견적 등록 시작');const text=h.text();
   assert.ok(text.includes(label));assert.match(text,/문서 ID/);assert.match(text,/등록 파일 ID/);assert.match(text,/00165801/);assert.match(text,/synthetic-doc-656/);assert.ok(!text.includes('접수·SKU 증거를 확인했습니다.'));
   assert.ok(!text.includes('견적서 접수·SKU 확인'));if(sourceStatus==='REJECTED')assert.match(text,/반려 상세는 Supplier Hub에서 확인/);
   const reply=await h.client.runSingleDocument(session,'observe',new AbortController().signal);assert.equal(reply.registered,false);assert.equal(reply.success,false);assert.equal(reply.receipt.qvtRequestId,'00165801');assert.equal(reply.receipt.skuId,undefined);
  }finally{h.close();}
 });
test('native status, exact alias type, required qvt id and absent SKU are all validated before display',async()=>{
 const h=fixture(companies[0],{verified:true});try{await h.prepare();const session=await h.client.previewSingleDocument(h.sent[0].message.payload.packet,new AbortController().signal);
  for(const changed of [{sourceStatus:'FINISHED'},{qvtRequestId:undefined},{qvtRequestId:null},{qvtRequestId:0},{qvtRequestId:'20265801'},{receiptId:undefined},{skuId:'invented-sku'},{evidence:'document-and-sku'},{sourceStatus:'UNKNOWN'}]){
   h.bridge=()=>{const value=nativeReceipt(h,'SUBMITTED');for(const [key,item]of Object.entries(changed)){if(item===undefined)delete value.receipt[key];else value.receipt[key]=item;}return value;};
   await assert.rejects(h.client.runSingleDocument(session,'observe',new AbortController().signal),error=>error.code==='SINGLE_REPLY_IDENTITY'&&error.uncertain===false);
  }
  h.bridge=()=>{const value=nativeReceipt(h,'FINISHED');value.state='registered';value.receipt.state='registered';value.registered=true;value.success=true;return value;};
  await assert.rejects(h.client.runSingleDocument(session,'observe',new AbortController().signal));
 }finally{h.close();}
});
for(const company of companies)test(company.name+': later qvt identity replacement keeps the previous displayed native file and document',async()=>{
 const h=fixture(company,{verified:true});try{await h.prepare();h.bridge=()=>nativeReceipt(h,'SUBMITTED',20265801);await h.click('선택 옵션의 개별 견적 등록 시작');h.bridge=()=>nativeReceipt(h,'FINISHED',20265801);await h.click('개별 접수 결과 조회');assert.match(h.text(),/등록 파일 처리 완료/);
  const previous=h.text();h.bridge=()=>nativeReceipt(h,'FINISHED',20265802);await h.click('개별 접수 결과 조회');assert.match(h.text(),/원래 문서 또는 등록 파일 ID/);assert.match(h.text(),/20265801/);assert.ok(!h.text().includes('20265802'));assert.ok(h.text().includes('등록 파일 처리 완료'));assert.equal(h.button('선택 옵션의 개별 견적 등록 시작'),undefined);
  h.bridge=()=>nativeReceipt(h,'SUBMITTED',20265801);await h.click('개별 접수 결과 조회');assert.ok(h.text().includes('등록 파일 처리 완료'));assert.ok(!h.text().includes('접수 처리 중'));
  h.bridge=()=>{const value=nativeReceipt(h,'FINISHED',20265801);value.docId='another-doc';value.receipt.docId='another-doc';return value;};await h.click('개별 접수 결과 조회');assert.match(h.text(),/synthetic-doc-656/);assert.ok(!h.text().includes('another-doc'));assert.equal(h.sent.filter(call=>call.snapshot.payload.action==='start').length,1);assert.ok(previous.includes('20265801'));
 }finally{h.close();}
});
