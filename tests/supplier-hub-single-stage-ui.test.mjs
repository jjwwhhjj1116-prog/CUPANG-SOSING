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
 const view={productVersion:saved.source.productVersion,contentRevision:2,optionRevision:3,revision:4,inputFingerprint:'d'.repeat(64),categoryContext:{profileId:'profile-656',categoryId:'81452',categoryPath:['운동','보호대'],source:'profile'},resolved:{rows:[{optionId:'option-656',optionLabel:'합성 검정',included:true}]}};
 const f={clock,saved,view,calls,sent,timers,listeners,actor:{ownerId:'owner-656',company:plain(company)},context:null,history:plain(options.history??[])};
 const sender={url:origin+'/',frameId:0,tab:{id:71,windowId:72}};
 const wait=async()=>new Promise(resolve=>setImmediate(resolve));
 const win={location:{origin},addEventListener(type,fn){if(type==='message')listeners.add(fn);},removeEventListener(type,fn){if(type==='message')listeners.delete(fn);},postMessage(message,target){assert.equal(target,origin);assert.equal(message.type,'SINGLE_DOCUMENT');sent.push({message,snapshot:plain(message)});void Promise.resolve().then(async()=>{const result=await f.bridge(message.payload);f.emit(message,result);}).catch(error=>f.emit(message,null,{ok:false,error:error.message}));}};
 f.emit=(message,result,envelope)=>{for(const fn of [...listeners])fn({source:win,origin,data:{channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId:message.requestId,result:envelope??{ok:true,result}}});};
 const setTimer=(fn,delay)=>{const id=++sequence;timers.set(id,{fn,delay,due:clock.now+delay});return id;};
 const clearTimer=id=>timers.delete(id);
 class LocalDate extends Date{static now(){return clock.now;}}
 const hook=(effect,deps,layout)=>{const i=cursor++,old=slots[i];if(!old||!deps||deps.some((item,j)=>!Object.is(item,old.deps[j]))){old?.cleanup?.();slots[i]={deps,cleanup:null};const run=()=>{slots[i].cleanup=effect();};if(layout)run();else effects.push(run);}};
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useLayoutEffect:(effect,deps)=>hook(effect,deps,true),useEffect:(effect,deps)=>hook(effect,deps,false)};
 f.fetch=async(url,init)=>{if(url==='/api/supplier-hub/catalog-context')return Response.json(f.actor);if(String(url).includes('/supplier-hub-single-package')){if(init?.method==='POST')saved.prepared=true;return Response.json(saved);}
  if(String(url).includes('/supplier-hub-single-receipt')){
   if(init?.method==='POST'){
    const body=JSON.parse(init.body),packet=plain(sent[0].message.payload.packet);
    const record={...plain(await load('app/supplier-hub-single-receipt.ts').validateSingleReceiptObservation(body.observation,packet,origin,clock.now)),recordedAt:new Date(clock.now).toISOString()};
    f.history=[record,...f.history.filter(row=>row.requestId!==record.requestId)];return Response.json({receipt:record});
   }
   return Response.json({format:'yoofam-single-receipt-history-v1',productId:saved.productId,receipts:f.history});
  }throw Error('Unexpected/forbidden URL '+url);};
 const load=file=>{if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,Error,Date:LocalDate,URL,TextEncoder,TextDecoder,Uint8Array,AbortController,structuredClone,crypto:webcrypto,window:win,setTimeout:setTimer,clearTimeout:clearTimer,
   fetch:async(url,init)=>{calls.push({url,method:init?.method??'GET',body:init?.body?JSON.parse(init.body):undefined,signal:init?.signal});return f.fetch(url,init);},require:name=>name==='react'?react:name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name)});return exports;};
 f.client=load('app/supplier-hub-single-client.ts');
 f.load=load;
 props={productId:saved.productId,profileId:'profile-656',view,disabled:false,onReceiptSaved:options.onReceiptSaved};
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
 f.reload=()=>{f.close();slots.length=0;effects.length=0;mountedKey=null;f.render();f.flush();};
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
 const h=fixture(company);try{await h.idle();assert.ok(h.calls.every(call=>call.method==='GET'));assert.equal(h.calls.filter(call=>call.url.includes('/supplier-hub-single-receipt')).length,1);assert.equal(h.calls.filter(call=>call.url.includes('/supplier-hub-single-package')).length,0);assert.equal(h.sent.length,0);await h.prepare();const packageCalls=h.calls.filter(call=>call.url.includes('/supplier-hub-single-package'));assert.deepEqual(packageCalls.map(call=>call.method),['GET','POST']);assert.equal(packageCalls[1].body.expectedFingerprint,h.saved.fingerprint);assert.deepEqual(h.sent.map(call=>call.snapshot.payload.action),['preview']);assert.equal(h.button('선택 옵션의 개별 견적 등록 시작'),undefined);assert.match(h.text(),/현재 상품은 전송하지 않았습니다/);
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
  preparedBodySha256:h.context.bodySha256,observedAt:h.clock.now,evidence:'document-receipt',sourceStatus,qvtRequestId,receiptId:qvtRequestId,registered:false}});
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
for(const company of companies)test(company.name+': native observation is saved once and reload reads history without restoring a session or sending Hub requests',async()=>{
 let refreshed=0;const h=fixture(company,{verified:true,onReceiptSaved:()=>{refreshed++;}});try{
  await h.prepare();const source=JSON.stringify(h.saved);h.bridge=()=>nativeReceipt(h,'SUBMITTED','000165901');await h.click('선택 옵션의 개별 견적 등록 시작');
  const writes=h.calls.filter(call=>call.method==='POST'&&call.url.includes('/supplier-hub-single-receipt'));
  assert.equal(writes.length,1);assert.deepEqual(Object.keys(writes[0].body).sort(),['observation','optionId','profileId']);assert.equal(writes[0].body.observation.receipt.qvtRequestId,'000165901');assert.equal(writes[0].body.observation.registered,false);
  assert.equal(h.history.length,1);assert.equal(h.history[0].registered,false);assert.equal(h.history[0].receipt.skuId,undefined);assert.equal(JSON.stringify(h.saved),source);assert.equal(writes[0].signal.aborted,false);assert.equal(refreshed,1);
  const sent=h.sent.length,before=h.calls.length;h.reload();await h.idle();assert.equal(h.sent.length,sent);assert.ok(h.calls.slice(before).every(call=>call.method==='GET'));assert.match(h.text(),/현재 상품 저장 버전/);assert.match(h.text(),/합성 검정/);assert.ok(!h.text().includes('option-656'));assert.match(h.text(),/000165901/);assert.match(h.text(),/synthetic-doc-656/);assert.match(h.text(),/보관된 결과는 확인 이력/);
  const time=nodes(h.render()).find(node=>node.type==='time');assert.equal(time.props.dateTime,new Date(h.history[0].receipt.observedAt).toISOString());assert.equal(time.props.children,new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(h.history[0].receipt.observedAt));
  assert.equal(h.button('선택 옵션의 개별 견적 등록 시작'),undefined);assert.equal(h.button('개별 접수 결과 조회'),undefined);assert.equal(nodes(h.render()).filter(node=>node.type==='input'&&node.props.type==='checkbox').length,0);assert.equal(refreshed,1,'history mount is read-only and never announces a new save');
 }finally{h.close();}
});
for(const company of companies)test(company.name+': lost local save ACK keeps the native proof and retries only the immutable observation, never Hub submission',async()=>{
 let refreshed=0;const h=fixture(company,{verified:true,onReceiptSaved:()=>{refreshed++;}});try{
  await h.prepare();const original=h.fetch;let fail=true;
  h.fetch=async(url,init)=>{const response=await original(url,init);return String(url).includes('/supplier-hub-single-receipt')&&init?.method==='POST'&&fail?Response.json({error:'합성 저장 ACK 누락'},{status:503}):response;};
  h.bridge=()=>nativeReceipt(h,'FINISHED','000165902');await h.click('선택 옵션의 개별 견적 등록 시작');assert.match(h.text(),/000165902/);assert.match(h.text(),/등록 파일 처리 완료 · SKU 확인 전/);assert.match(h.text(),/화면에 유지/);assert.ok(h.button('확인 결과 저장 다시 시도'));assert.equal(h.history.length,1);assert.equal(refreshed,0);
  const sent=h.sent.length,source=JSON.stringify(h.saved),retry=h.button('확인 결과 저장 다시 시도').props.onClick;fail=false;retry();retry();await h.idle();
  const writes=h.calls.filter(call=>call.method==='POST'&&call.url.includes('/supplier-hub-single-receipt'));assert.equal(writes.length,2);assert.deepEqual(writes[0].body,writes[1].body);assert.equal(h.sent.length,sent);assert.equal(h.sent.filter(call=>call.snapshot.payload.action==='start').length,1);assert.equal(JSON.stringify(h.saved),source);assert.equal(h.button('확인 결과 저장 다시 시도'),undefined);assert.equal(h.history.length,1);assert.equal(refreshed,1);
 }finally{h.close();}
});
test('history shows prior saved source separately and cannot supply a new session, approval or generic SKU mapping',async()=>{
 const h=fixture(companies[0],{verified:true});try{
  await h.prepare();h.bridge=()=>nativeReceipt(h,'REJECTED','000165903');await h.click('선택 옵션의 개별 견적 등록 시작');const sent=h.sent.length;
  h.change({view:{...h.view,revision:5,inputFingerprint:'e'.repeat(64),resolved:{rows:[{...h.view.resolved.rows[0],optionLabel:'나중에 수정한 흰색'}]}}});await h.idle();assert.match(h.text(),/이전 상품 저장 버전/);assert.match(h.text(),/이전 옵션 전송 기록/);assert.ok(!h.text().includes('나중에 수정한 흰색'));assert.ok(!h.text().includes('option-656'));assert.match(h.text(),/반려 상세는 Supplier Hub에서 확인/);assert.match(h.text(),/000165903/);assert.equal(h.sent.length,sent);assert.equal(h.button('선택 옵션의 개별 견적 등록 시작'),undefined);assert.ok(!h.text().includes('견적서 접수·SKU 확인'));
 }finally{h.close();}
});
test('current history without a human option label uses a generic caption and never exposes an internal option ID',async()=>{
 const h=fixture(companies[0],{verified:true});try{
  await h.prepare();h.bridge=()=>nativeReceipt(h,'SUBMITTED','000165911');await h.click('선택 옵션의 개별 견적 등록 시작');const sent=h.sent.length;
  for(const optionLabel of ['', '  ',undefined,'option-656']){
   h.change({view:{...h.view,resolved:{rows:[{...h.view.resolved.rows[0],optionLabel}]}}});h.reload();await h.idle();assert.match(h.text(),/옵션 전송 기록/);assert.ok(!h.text().includes('option-656'));assert.equal(h.sent.length,sent);assert.equal(h.button('선택 옵션의 개별 견적 등록 시작'),undefined);
  }
 }finally{h.close();}
});
test('legacy document receipt is displayed but is never automatically written as native receipt history',async()=>{
 const h=fixture(companies[0],{verified:true});try{
  await h.prepare();h.bridge=()=>h.result('accepted',null,{receipt:{state:'accepted',docId:'synthetic-doc-656',company:plain(h.saved.company),identityDigest:h.context.identityDigest,preparedBodySha256:h.context.bodySha256,receiptId:'legacy-document-receipt',observedAt:h.clock.now,evidence:'document-receipt'}});
  await h.click('선택 옵션의 개별 견적 등록 시작');assert.match(h.text(),/등록 파일 처리 완료/);assert.equal(h.calls.filter(call=>call.method==='POST'&&call.url.includes('/supplier-hub-single-receipt')).length,0);assert.equal(h.history.length,0);
 }finally{h.close();}
});
test('history validates exact scope and receipt schema; forged records never replace current read-only history',async()=>{
 const h=fixture(companies[0],{verified:true});try{
  await h.prepare();h.bridge=()=>nativeReceipt(h,'SUBMITTED',20265904);await h.click('선택 옵션의 개별 견적 등록 시작');const good=plain(h.history[0]),original=h.fetch;
  for(const change of [{productId:'another-product'},{profileId:'another-profile'},{registered:true},{receipt:{...good.receipt,qvtRequestId:'20265904'}},{company:companies[1]},{identity:{...good.identity,ownerId:'other-owner'}}]){
   h.fetch=(url,init)=>String(url).includes('/supplier-hub-single-receipt')?Promise.resolve(Response.json({format:'yoofam-single-receipt-history-v1',productId:h.saved.productId,receipts:[{...good,...change}]})):original(url,init);
   h.reload();await h.idle();assert.ok(!h.text().includes('20265904'));assert.match(h.text(),/확인|다른|형식/);assert.equal(h.button('선택 옵션의 개별 견적 등록 시작'),undefined);
  }
 }finally{h.close();}
});
for(const change of ['company','owner'])test('held history GET rejects a changed '+change+' before exposing prior account proof',async()=>{
 const h=fixture(companies[0],{verified:true});try{
  await h.prepare();h.bridge=()=>nativeReceipt(h,'SUBMITTED','000165905');await h.click('선택 옵션의 개별 견적 등록 시작');const original=h.fetch;let release;
  h.fetch=(url,init)=>String(url).includes('/supplier-hub-single-receipt')&&init?.method!=='POST'?new Promise(resolve=>{release=resolve;}):original(url,init);
  h.reload();await h.waitFor(()=>Boolean(release));const source=plain(h.history);h.actor=change==='company'?{...h.actor,company:companies[1]}:{...h.actor,ownerId:'other-owner'};
  release(Response.json({format:'yoofam-single-receipt-history-v1',productId:h.saved.productId,receipts:source}));await h.idle();assert.ok(!h.text().includes('000165905'));assert.match(h.text(),/회원 회사가 변경/);assert.equal(h.button('선택 옵션의 개별 견적 등록 시작'),undefined);
 }finally{h.close();}
});
for(const change of ['source','unmount'])test('held receipt-save result and captured retry are invalidated on '+change,async()=>{
 const h=fixture(companies[0],{verified:true});try{
  await h.prepare();const original=h.fetch;let release;
  h.fetch=(url,init)=>String(url).includes('/supplier-hub-single-receipt')&&init?.method==='POST'?new Promise(resolve=>{release=async()=>resolve(await original(url,init));}):original(url,init);
  h.bridge=()=>nativeReceipt(h,'SUBMITTED','000165906');h.button('선택 옵션의 개별 견적 등록 시작').props.onClick();await h.waitFor(()=>Boolean(release));const write=h.calls.find(call=>call.method==='POST'&&call.url.includes('/supplier-hub-single-receipt'));
  if(change==='source')h.change({view:{...h.view,revision:5,inputFingerprint:'e'.repeat(64)}});else h.close();assert.equal(write.signal.aborted,true);await release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.sent.filter(call=>call.snapshot.payload.action==='start').length,1);assert.equal(h.calls.filter(call=>call.method==='POST'&&call.url.includes('/supplier-hub-single-receipt')).length,1);
  if(change==='source'){await h.idle();assert.equal(h.button('확인 결과 저장 다시 시도'),undefined);assert.equal(h.button('선택 옵션의 개별 견적 등록 시작'),undefined);assert.ok(!h.text().includes('개별 등록 파일 처리 결과'));}
 }finally{h.close();}
});
test('save response mismatching the native file retains the original proof and only offers local save retry',async()=>{
 let refreshed=0;const h=fixture(companies[0],{verified:true,onReceiptSaved:()=>{refreshed++;}});try{
  await h.prepare();const original=h.fetch;
  h.fetch=async(url,init)=>{const response=await original(url,init);if(String(url).includes('/supplier-hub-single-receipt')&&init?.method==='POST'){const value=await response.json();value.receipt.receipt.qvtRequestId=20265908;value.receipt.receipt.receiptId=20265908;return Response.json(value);}return response;};
  h.bridge=()=>nativeReceipt(h,'SUBMITTED',20265907);await h.click('선택 옵션의 개별 견적 등록 시작');assert.match(h.text(),/20265907/);assert.ok(!h.text().includes('20265908'));assert.match(h.text(),/원래 확인한 등록 파일이 다릅니다/);assert.ok(h.button('확인 결과 저장 다시 시도'));assert.equal(h.sent.filter(call=>call.snapshot.payload.action==='start').length,1);assert.equal(refreshed,0);
 }finally{h.close();}
});
test('a failed parent status refresh cannot turn a confirmed receipt save into an error or retry',async()=>{
 let refreshed=0;const h=fixture(companies[0],{verified:true,onReceiptSaved:()=>{refreshed++;throw Error('synthetic parent refresh failure');}});try{
  await h.prepare();h.bridge=()=>nativeReceipt(h,'SUBMITTED','000165912');await h.click('선택 옵션의 개별 견적 등록 시작');assert.equal(refreshed,1);assert.match(h.text(),/000165912/);assert.equal(h.button('확인 결과 저장 다시 시도'),undefined);assert.ok(!h.text().includes('parent refresh failure'));assert.equal(h.calls.filter(call=>call.method==='POST'&&call.url.includes('/supplier-hub-single-receipt')).length,1);assert.equal(h.sent.filter(call=>call.snapshot.payload.action==='start').length,1);
 }finally{h.close();}
});
test('held valid receipt save notifies only the latest parent callback once without invalidating the current packet',async()=>{
 let oldRefresh=0,newRefresh=0;const h=fixture(companies[0],{verified:true,onReceiptSaved:()=>{oldRefresh++;}});try{
  await h.prepare();const original=h.fetch;let release;
  h.fetch=(url,init)=>String(url).includes('/supplier-hub-single-receipt')&&init?.method==='POST'?new Promise(resolve=>{release=async()=>resolve(await original(url,init));}):original(url,init);
  h.bridge=()=>nativeReceipt(h,'SUBMITTED','000165913');h.button('선택 옵션의 개별 견적 등록 시작').props.onClick();await h.waitFor(()=>Boolean(release));const packet=JSON.stringify(h.sent[0].snapshot.payload.packet);
  h.change({onReceiptSaved:()=>{newRefresh++;}});await release();await h.idle();assert.equal(oldRefresh,0);assert.equal(newRefresh,1);assert.equal(JSON.stringify(h.sent[0].snapshot.payload.packet),packet);assert.match(h.text(),/000165913/);assert.equal(h.button('확인 결과 저장 다시 시도'),undefined);assert.equal(h.sent.filter(call=>call.snapshot.payload.action==='start').length,1);
 }finally{h.close();}
});
for(const [attemptStatus,storedStatus,delta,allowed]of [['SUBMITTED','FINISHED',10,true],['FINISHED','REJECTED',10,true],['FINISHED','SUBMITTED',10,false],['REJECTED','FINISHED',10,false],['SUBMITTED','FINISHED',0,false],['SUBMITTED','SUBMITTED',-10,false]])
 test(`local save ACK ${attemptStatus} accepts ${storedStatus} at delta ${delta} only under the exact immutable newer-observation contract`,async()=>{
  const h=fixture(companies[0],{verified:true});try{
   await h.prepare();const original=h.fetch;let fail=true,newer;
   h.fetch=async(url,init)=>{
    if(String(url).includes('/supplier-hub-single-receipt')&&init?.method==='POST'&&!fail)return Response.json({receipt:newer});
    const response=await original(url,init);return String(url).includes('/supplier-hub-single-receipt')&&init?.method==='POST'?Response.json({error:'합성 저장 ACK 누락'},{status:503}):response;
   };
   h.bridge=()=>nativeReceipt(h,attemptStatus,'000165909');await h.click('선택 옵션의 개별 견적 등록 시작');assert.ok(h.button('확인 결과 저장 다시 시도'));const sent=h.sent.length;
   newer=plain(h.history[0]);newer.receipt.sourceStatus=storedStatus;newer.receipt.state={SUBMITTED:'pending',FINISHED:'accepted',REJECTED:'rejected'}[storedStatus];newer.receipt.observedAt+=delta;h.clock.now+=Math.max(0,delta);newer.recordedAt=new Date(h.clock.now).toISOString();fail=false;
   await h.click('확인 결과 저장 다시 시도');assert.equal(h.sent.length,sent);const writes=h.calls.filter(call=>call.method==='POST'&&call.url.includes('/supplier-hub-single-receipt'));assert.equal(writes.length,2);assert.deepEqual(writes[0].body,writes[1].body);
   if(allowed){assert.equal(h.button('확인 결과 저장 다시 시도'),undefined);const history=nodes(h.render()).find(node=>node.props?.['aria-label']==='보관된 개별 등록 파일 확인 이력');assert.ok(flatten(history).includes({SUBMITTED:'접수 처리 중',FINISHED:'등록 파일 처리 완료 · SKU 확인 전',REJECTED:'반려'}[storedStatus]));}
   else{assert.ok(h.button('확인 결과 저장 다시 시도'));assert.match(h.text(),/원래 확인한 등록 파일이 다릅니다/);}
  }finally{h.close();}
 });
for(const change of ['company','owner','unmount'])test('captured save retry after '+change+' cannot send the observation under another account or a closed panel',async()=>{
 const h=fixture(companies[0],{verified:true});try{
  await h.prepare();const original=h.fetch;h.fetch=async(url,init)=>String(url).includes('/supplier-hub-single-receipt')&&init?.method==='POST'?Response.json({error:'합성 저장 실패'},{status:503}):original(url,init);
  h.bridge=()=>nativeReceipt(h,'SUBMITTED','000165910');await h.click('선택 옵션의 개별 견적 등록 시작');const retry=h.button('확인 결과 저장 다시 시도').props.onClick,count=h.calls.length,sent=h.sent.length;
  if(change==='company')h.actor={...h.actor,company:companies[1]};if(change==='owner')h.actor={...h.actor,ownerId:'another-owner'};if(change==='unmount')h.close();retry();await new Promise(resolve=>setImmediate(resolve));
  if(change!=='unmount'){await h.idle();assert.match(h.text(),/현재 회원 회사와 원래 확인 결과가 다릅니다/);assert.ok(!h.text().includes('000165910'));assert.equal(h.button('확인 결과 저장 다시 시도'),undefined);}
  assert.equal(h.calls.slice(count).filter(call=>call.method==='POST').length,0);assert.equal(h.sent.length,sent);
 }finally{h.close();}
});
test('history HTML, over-limit arrays, redirected replies and a stalled body fail boundedly without preparation or publication',async()=>{
 const h=fixture();try{
  await h.idle();const original=h.fetch;
  for(const response of [new Response('<!DOCTYPE html> temporary upstream outage',{status:503}),Response.json({format:'yoofam-single-receipt-history-v1',productId:h.saved.productId,receipts:Array(201).fill({})}),(()=>{const r=Response.json({});Object.defineProperty(r,'redirected',{value:true});return r;})()]){
   h.fetch=(url,init)=>String(url).includes('/supplier-hub-single-receipt')?Promise.resolve(response):original(url,init);h.reload();await h.idle();assert.equal(h.sent.length,0);assert.match(h.text(),/읽지 못|형식을 확인|앱 응답/);assert.ok(!h.text().includes('DOCTYPE'));
  }
  let canceled=false;h.fetch=(url,init)=>String(url).includes('/supplier-hub-single-receipt')?Promise.resolve(new Response(new ReadableStream({cancel(){canceled=true;}}))):original(url,init);h.reload();await h.waitFor(()=>h.calls.at(-1)?.url.includes('/supplier-hub-single-receipt'));await h.advance(15000);await h.idle();assert.equal(canceled,true);assert.equal(h.sent.length,0);assert.ok(h.calls.every(call=>call.method==='GET'));assert.match(h.text(),/취소/);
 }finally{h.close();}
});
