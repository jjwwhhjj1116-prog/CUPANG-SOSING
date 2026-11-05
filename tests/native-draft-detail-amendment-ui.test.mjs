import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,observation,plain,descriptor,reserved,review,latest} from './helpers/native-draft-detail-amendment.mjs';

const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(' '):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function ui({pending=descriptor,stored,reply}={}){
 const slots=[],effects=[],locks=[];let cursor=0,props;
 const effect=(run,deps)=>{const index=cursor++,old=slots[index];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps[i]))){old?.cleanup?.();slots[index]={deps,cleanup:null};effects.push(()=>slots[index].cleanup=run());}};
 const react={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],value=>slots[index]=typeof value==='function'?value(slots[index]):value];},useRef(value){const index=cursor++;if(!(index in slots))slots[index]={current:value};return slots[index];},useEffect:effect,useLayoutEffect:effect,useMemo(run,deps){const index=cursor++,old=slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))slots[index]={deps,value:run()};return slots[index].value;}};
 const base=fixture({stored,modules:{react}}),store=base.load('app/native-draft-detail-amendment-pending.ts');await store.claimNativeDraftDetailAmendmentPending(pending,new AbortController().signal);
 const model=base.load('app/components/native-draft-detail-amendment-panel.tsx');
 props={review:plain(review),pending:plain(pending),disabled:false,refresh:async()=>props.review,onLockChange:(source,close=source)=>locks.push([source,close])};
 base.reply=reply??(message=>base.emit(message,observation()));
 const h={base,locks,render(next=props){props=next;cursor=0;return model.NativeDraftDetailAmendmentPanel(props);},flush(){h.render();effects.splice(0).forEach(run=>run());},props:()=>props,button(label){return nodes(h.render()).find(node=>node.type==='button'&&text(node.props.children)===label);},text:()=>text(h.render()),async wait(predicate){for(let i=0;i<400;i++){h.flush();if(predicate())return;await turn();}assert.fail('amendment UI boundary timeout');},async idle(){await h.wait(()=>!h.render().props['aria-busy']);},async click(label){const button=h.button(label);assert.ok(button,label);assert.equal(!!button.props.disabled,false,label);button.props.onClick();await h.idle();},close(){for(const slot of slots)slot?.cleanup?.();}};
 h.flush();return h;
}

test('a remounted amendment reads its retained anchor before unlocking edits and never offers a new document',async()=>{
 const h=await ui();try{const original=h.base.stored.get(h.base.parentKey);await h.idle();assert.deepEqual(h.base.sent.map(message=>message.payload.action),['inspect']);
  assert.deepEqual(h.locks.at(-1),[false,false]);assert.equal(h.base.stored.get(h.base.parentKey),original);assert.match(h.text(),/2362997/);
  assert.equal(h.button('새 견적 초안 만들기 · 제출 안 함'),undefined);assert.equal(h.button('준비한 새 견적서 등록전송'),undefined);assert.ok(h.button('수정 자료 확인'));
 }finally{h.close();}
});

test('an anchored edit observation without append capability cannot unlock or expose edit actions',async()=>{
 const h=await ui({reply:message=>h.base.emit(message,observation({capabilities:{appendDetail:false}}))});try{await h.idle();assert.deepEqual(h.locks.at(-1),[true,false]);assert.equal(h.button('수정 자료 확인'),undefined);assert.equal(h.button('같은 문서에 수정 반영'),undefined);}finally{h.close();}
});

test('new-review preview and one same-document apply preserve the original pending through validation',async()=>{
 const h=await ui();try{let sequence=1;h.base.reply=message=>h.base.emit(message,message.payload.action==='inspect'?observation():observation({state:message.payload.action==='preview'?'previewed':'validated',sequence:++sequence,previewDigest:'e'.repeat(64),latest,validatedSteps:message.payload.action==='preview'?[]:[2,3,4,5],readOnly:message.payload.action!=='apply',execution:{create:0,upload:message.payload.action==='apply'?1:0,update:message.payload.action==='apply'?1:0,validate:message.payload.action==='apply'?4:0,submit:0}}));
  await h.idle();const original=h.base.stored.get(h.base.parentKey);await h.click('수정 자료 확인');assert.ok(h.button('같은 문서에 수정 반영'));await h.click('같은 문서에 수정 반영');
  assert.deepEqual(h.base.sent.map(message=>message.payload.action),['inspect','preview','apply']);assert.equal(h.base.stored.get(h.base.parentKey),original);assert.ok(h.button('최신 수정 문서 등록전송'));assert.deepEqual(h.locks.at(-1),[true,false]);
 }finally{h.close();}
});

test('lost begin ACK retains its UUID and readonly not-found cannot grant edit or apply permission',async()=>{
 const h=await ui({pending:reserved});try{h.base.reply=message=>h.base.emit(message,observation({state:'not-found',anchor:null,sequence:0,capabilities:{appendDetail:false}}));await h.idle();
  assert.deepEqual(h.base.sent.map(message=>message.payload.action),['inspect']);assert.deepEqual(h.locks.at(-1),[true,false]);assert.equal(h.button('수정 자료 확인'),undefined);assert.equal(h.button('같은 문서에 수정 반영'),undefined);
  const saved=h.base.load('app/native-draft-detail-amendment-pending.ts').readNativeDraftDetailAmendmentPending({identity:review.identity});assert.equal(saved.amendmentId,reserved.amendmentId);assert.equal(saved.format,reserved.format);
 }finally{h.close();}
});

test('a late preview after a review change cannot expose apply for the new saved source',async()=>{
 const h=await ui();try{await h.idle();let waiting;h.base.reply=message=>{waiting=message;};h.button('수정 자료 확인').props.onClick();await h.wait(()=>!!waiting);
  h.render({...h.props(),review:{...h.props().review,reviewDigest:'f'.repeat(64)}});h.flush();h.base.emit(waiting,observation({state:'previewed',sequence:2,previewDigest:'e'.repeat(64),latest}));await turn();h.flush();assert.equal(h.button('같은 문서에 수정 반영'),undefined);
 }finally{h.close();}
});

test('a missing apply ACK retains both reservations and stale apply callbacks cannot retry a write',async()=>{
 const h=await ui();try{await h.idle();h.base.reply=message=>{if(message.payload.action==='preview')h.base.emit(message,observation({state:'previewed',sequence:2,previewDigest:'e'.repeat(64),latest}));};
  await h.click('수정 자료 확인');const stale=h.button('같은 문서에 수정 반영').props.onClick,before=[...h.base.stored];stale();stale();await h.wait(()=>h.base.sent.some(message=>message.payload.action==='apply'));h.base.advance();await h.idle();
  assert.deepEqual([...h.base.stored],before);assert.equal(h.base.sent.filter(message=>message.payload.action==='apply').length,1);assert.equal(h.button('같은 문서에 수정 반영'),undefined);assert.deepEqual(h.locks.at(-1),[true,true]);
  stale();await turn();h.flush();assert.equal(h.base.sent.filter(message=>message.payload.action==='apply').length,1);
  h.base.reply=message=>h.base.emit(message,observation({state:'validated',sequence:8,previewDigest:'e'.repeat(64),latest,validatedSteps:[2,3,4,5]}));await h.click('같은 수정 문서 결과 확인 · 읽기 전용');assert.equal(h.base.sent.at(-1).payload.action,'recover');assert.deepEqual(h.locks.at(-1),[true,false]);assert.ok(h.button('최신 수정 문서 등록전송'));
 }finally{h.close();}
});

test('fresh source mismatch or replaced child reservation blocks apply before any write dispatch',async()=>{
 for(const mode of ['source','reservation']){const h=await ui();try{await h.idle();h.base.reply=message=>h.base.emit(message,observation({state:'previewed',sequence:2,previewDigest:'e'.repeat(64),latest}));await h.click('수정 자료 확인');
  if(mode==='source'){h.render({...h.props(),refresh:async()=>({...h.props().review,preparedBodySha256:'f'.repeat(64)})});h.flush();}
  else{const key=h.base.load('app/native-draft-detail-amendment-pending.ts').nativeDraftDetailAmendmentPendingKey({identity:review.identity});h.base.stored.set(key,JSON.stringify({...descriptor,amendmentId:'33333333-3333-4333-8333-333333333333'}));}
  await h.click('같은 문서에 수정 반영');assert.equal(h.base.sent.some(message=>message.payload.action==='apply'),false,mode);assert.deepEqual(h.locks.at(-1),[true,false]);assert.ok(h.base.stored.has(h.base.parentKey));
 }finally{h.close();}}
});

test('a committed review ABA revokes a captured preview and cannot unlock from its late response',async()=>{
 const h=await ui();try{await h.idle();const original=h.props();let waiting;h.base.reply=message=>{waiting=message;};h.button('수정 자료 확인').props.onClick();await h.wait(()=>!!waiting);const old=waiting;
  h.render({...original,review:{...original.review,reviewDigest:'f'.repeat(64)}});h.render(original);h.flush();h.base.emit(old,observation({state:'previewed',sequence:2,previewDigest:'e'.repeat(64),latest}));await turn();h.flush();assert.equal(h.button('같은 문서에 수정 반영'),undefined);assert.deepEqual(h.locks.at(-1),[true,true]);
 }finally{h.close();}
});

test('remounting an in-progress child submission offers read-only lifecycle recovery instead of a parent submit',async()=>{
 const h=await ui({reply:message=>h.base.emit(message,observation({state:'submission',sequence:9,latest,previewDigest:'e'.repeat(64),validatedSteps:[2,3,4,5]}))});try{await h.idle();assert.equal(h.button('최신 수정 문서 등록전송'),undefined);await h.click('같은 수정 문서 결과 확인 · 읽기 전용');assert.deepEqual(h.base.sent.map(message=>message.payload.action),['inspect','recover']);assert.deepEqual(h.locks.at(-1),[true,false]);}finally{h.close();}
});

for(const state of ['files-saved','updated'])test(`positively read ${state} child continues only its remaining explicit apply under the same preview`,async()=>{
 const h=await ui({reply:message=>h.base.emit(message,observation({state,sequence:5,latest,previewDigest:'e'.repeat(64),validatedSteps:state==='updated'?[2,3]:[]}))});try{await h.idle();const before=[...h.base.stored];assert.deepEqual(h.locks.at(-1),[true,false]);
  h.base.reply=message=>h.base.emit(message,observation({state:'validated',sequence:8,latest,previewDigest:'e'.repeat(64),validatedSteps:[2,3,4,5],readOnly:false,execution:{create:0,upload:0,update:state==='files-saved'?1:0,validate:state==='files-saved'?4:2,submit:0}}));
  await h.click('같은 문서에 수정 반영');assert.deepEqual(h.base.sent.map(message=>message.payload.action),['inspect','apply']);assert.equal(h.base.sent[1].payload.previewDigest,'e'.repeat(64));assert.deepEqual([...h.base.stored],before);assert.ok(h.button('최신 수정 문서 등록전송'));
 }finally{h.close();}
});

test('requested, recovery-required, stale and errored partial child states never expose apply',async()=>{
 for(const extra of [{state:'upload-requested'},{state:'update-requested'},{state:'validation-requested'},{state:'files-saved',needsRecovery:true},{state:'updated',needsRecovery:true},{state:'updated',error:{code:'UNCERTAIN',message:'저장 결과 확인 필요'}},{state:'files-saved',latest:{...latest,reviewDigest:'f'.repeat(64)}},{state:'updated',previewDigest:null}]){
  const h=await ui({reply:message=>h.base.emit(message,observation({sequence:5,latest,previewDigest:'e'.repeat(64),...extra}))});try{await h.idle();assert.equal(h.button('같은 문서에 수정 반영'),undefined,JSON.stringify(extra));assert.equal(h.base.sent.some(message=>message.payload.action==='apply'),false);}finally{h.close();}
 }
});
