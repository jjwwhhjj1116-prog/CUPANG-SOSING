import {LISTING_BATCH_LIMIT,listingPageUrl,scanListingCards,createListingSelection,createListingBatchPayload,validateListingBatchReply,listingStartNotCreated} from '../extensions/supplier-hub/listing-candidates.mjs';

const HOST='yoofam-listing-picker',OWNER='yoofam-studio',FORMAT='yoofam-listing-picker-v1';
const stateLabels={queued:'대기',opening:'상품 열기',reading:'상세 수집 중',saving:'서버 저장 확인 중',saved:'저장 확인',failed:'실패',uncertain:'저장 결과 미확정',cancelled:'중단'};
const compareLabels={queued:'대기',saving:'서버 저장 확인 중',saved:'저장 확인',failed:'실패',uncertain:'저장 결과 미확정',cancelled:'중단'};
const batchLabels={running:'선택한 상품을 담고 있습니다.',completed:'선택한 곳에 저장된 것을 확인했습니다.',partial:'일부 상품을 담지 못했습니다. 아래 결과를 확인해주세요.',paused:'일괄 담기를 멈추고 원래 작업을 보관했습니다.',cancelled:'대기 중인 상품 담기를 중단했습니다.'};
const errorText=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/gu,' ').trim().slice(0,1000):'일괄 담기 응답을 확인하지 못했습니다.';

export function installListingPicker({document:doc=globalThis.document,location:loc=globalThis.location,runtime=globalThis.chrome?.runtime,
 MutationObserver:Observe=globalThis.MutationObserver,setTimeout:later=globalThis.setTimeout,clearTimeout:clearLater=globalThis.clearTimeout,crypto=globalThis.crypto}={}){
 const initialUrl=listingPageUrl(loc.href);
 if(!doc?.documentElement||typeof runtime?.sendMessage!=='function'||typeof crypto?.randomUUID!=='function')return null;
 if(doc.getElementById(HOST))return null;
 const host=doc.createElement('div');host.id=HOST;host.setAttribute('data-yoofam-owner',OWNER);host.setAttribute('data-yoofam-format',FORMAT);
 host.style.cssText='position:fixed;right:20px;bottom:152px;width:min(440px,calc(100vw - 32px));z-index:2147483639;';
 const root=host.attachShadow({mode:'closed'}),style=doc.createElement('style');
 style.textContent=`
 :host{font:13px/1.45 system-ui,sans-serif;color:#f1f5ff;color-scheme:dark}*{box-sizing:border-box}
 .panel{background:#14213b;color:#f1f5ff;border:1px solid #60789e;border-radius:12px;padding:12px;box-shadow:0 8px 28px #08111f66}
 .top{display:flex;justify-content:space-between;gap:8px;align-items:center}.top strong{display:flex;align-items:center;gap:8px;font-size:14px;color:#fff}
 .top strong::before{content:"YFS";display:inline-flex;align-items:center;justify-content:center;flex:none;width:30px;height:30px;border-radius:50%;background:#3a56c9;color:#d5ffef;font-size:10px;font-weight:800;letter-spacing:.3px;border:1px solid #8ba4ff}
 button{font:600 12px system-ui;border:1px solid #8194b3;background:#1e2c47;color:#eef4ff;border-radius:7px;padding:7px 9px;cursor:pointer}
 button:hover:not(:disabled){background:#2c4065;border-color:#b1c9ee}button:focus-visible,input:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid #93c5fd;outline-offset:3px}
 button.primary{background:#4165eb;border-color:#829aff;color:#fff}button.primary:hover:not(:disabled){background:#3155d6;border-color:#b1c4ff}
 button:disabled{opacity:1;background:#293750;border-color:#536781;color:#b9c6da;cursor:default}button.primary:disabled{background:#2b3d73;border-color:#5d75a6;color:#c7d4ef}
 .actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}p{margin:7px 0 0;font-size:12px;color:#e2ebfa}small{font-size:11px;color:#bac8de}.status{white-space:pre-wrap;color:#e8efff}
 .choice{background:#1b2b49;border:1px solid #60789e;border-radius:8px;padding:10px;margin-top:10px}.choice label{display:block;margin:7px 0;cursor:pointer;color:#f1f5ff}.choice input{margin:0 7px 0 0;vertical-align:middle;accent-color:#8ca7ff}.choice h3{font-size:13px;margin:0 0 6px;color:#fff}
 .progress{border-top:1px solid #536781;margin-top:9px;padding-top:8px}.channels{font-size:12px;margin:0;color:#e2ebfa}.results{max-height:190px;overflow:auto;padding:0;margin:7px 0 0;list-style:none}.results li{border-top:1px solid #425673;padding:5px 0;font-size:11px}.results a{color:#b4d2ff;text-decoration:none}.results a:hover{text-decoration:underline;color:#e1edff}.results span{display:block;color:#bdcbe0}.results .error{color:#ffb6bf}
 details summary{cursor:pointer;font-size:12px;color:#e2ebfa}.minimized{max-width:210px;padding:9px 12px}.minimized .body{display:none}
 `;
 const panel=doc.createElement('section');panel.className='panel';panel.setAttribute('aria-label','YOOFAM 여러 상품 담기');
 const top=doc.createElement('div');top.className='top';const title=doc.createElement('strong');title.textContent='YOOFAM · 여러 상품 담기';
 const minimize=button('접기');minimize.setAttribute('aria-label','여러 상품 담기 패널 접기');minimize.setAttribute('aria-expanded','true');top.append(title,minimize);
 const body=doc.createElement('div');body.className='body';const counts=doc.createElement('p'),note=doc.createElement('small');note.textContent='현재 로드된 카드만 선택합니다. 전체 검색결과를 자동으로 불러오지 않습니다.';
 let runtimeVersion='';try{const value=runtime.getManifest?.().version;if(typeof value==='string'&&/^\d+\.\d+\.\d+$/u.test(value))runtimeVersion=value;}catch{/* A missing manifest does not invent an installed version. */}
 if(runtimeVersion)note.textContent=`확장 ${runtimeVersion} · `+note.textContent;
 const actions=doc.createElement('div');actions.className='actions';const all=button('로딩된 상품 모두 선택'),none=button('선택 해제'),choose=button('선택 상품 담기','primary');actions.append(all,none,choose);
 const status=doc.createElement('p');status.className='status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const choice=doc.createElement('section');choice.className='choice';choice.hidden=true;choice.setAttribute('role','dialog');choice.setAttribute('aria-label','담을 위치 선택');choice.setAttribute('aria-modal','false');
 const choiceTitle=doc.createElement('h3');choiceTitle.textContent='담을 위치 선택';
 const ai=destination('AI상품등록 수집함','ai-registration'),comparison=destination('1688 소싱·로켓 비교함','rocket-compare');
 const choiceNote=doc.createElement('p');choiceNote.textContent='한 곳 또는 두 곳 모두 선택할 수 있습니다. AI상품등록은 상세 수집과 서버 저장이 확인돼야 완료됩니다.';
 const choiceActions=doc.createElement('div');choiceActions.className='actions';const confirm=button('선택한 곳에 담기','primary'),dismiss=button('취소');choiceActions.append(confirm,dismiss);choice.append(choiceTitle,ai.label,comparison.label,choiceNote,choiceActions);
 const progress=doc.createElement('section');progress.className='progress';progress.hidden=true;progress.setAttribute('aria-label','일괄 담기 진행 상태');
 const channels=doc.createElement('p');channels.className='channels';const progressActions=doc.createElement('div');progressActions.className='actions';
 const refresh=button('진행 상태 확인'),resume=button('남은 상품 담기 계속'),cancel=button('대기 상품 중단');progressActions.append(refresh,resume,cancel);
 const details=doc.createElement('details'),detailsTitle=doc.createElement('summary'),results=doc.createElement('ol');detailsTitle.textContent='상품별 결과';results.className='results';details.append(detailsTitle,results);progress.append(channels,progressActions,details);
 body.append(counts,note,actions,status,choice,progress);panel.append(top,body);root.append(style,panel);doc.documentElement.append(host);
 const selection=createListingSelection(),decorations=new Map();let entries=[],batch=null,pendingId=null,pendingDestinations=null,requesting=false,polling=false,unknownStart=false,stopped=false,scanTimer=null,pollTimer=null,observer=null,pollCount=0;
 function button(label,className=''){const element=doc.createElement('button');element.type='button';element.textContent=label;element.className=className;return element;}
 function destination(label,value){const element=doc.createElement('label'),input=doc.createElement('input');input.type='checkbox';input.value=value;input.checked=true;input.setAttribute('aria-label',label);element.append(input,doc.createTextNode(label));return {label:element,input};}
 const current=()=>{try{return !stopped&&host.isConnected&&doc.getElementById(HOST)===host&&listingPageUrl(loc.href)===initialUrl;}catch{return false;}};
 const running=()=>requesting||unknownStart||batch?.status==='running'||batch?.status==='paused'||batch?.uncertain>0||batch?.comparison?.status==='uncertain';
 const targets=()=>[ai.input.checked?'ai-registration':null,comparison.input.checked?'rocket-compare':null].filter(Boolean);
 const message=value=>{status.textContent=errorText(value);};
 function update(){
  const locked=running(),size=selection.values(entries).length;counts.textContent=`선택 ${size}개 · 로딩된 상품 ${entries.length}개`;
  all.disabled=locked||entries.length===0;none.disabled=locked||size===0;choose.disabled=locked||polling||size===0;confirm.disabled=locked||polling||size===0||targets().length===0;dismiss.disabled=requesting;
  ai.input.disabled=locked;comparison.input.disabled=locked;
  for(const [element,entry] of decorations)entry.input.disabled=locked||!entries.some(item=>item.element===element);
  progress.hidden=!(batch||pendingId);refresh.disabled=requesting||polling;resume.hidden=!(batch?.status==='paused'&&batch.queued>0&&batch.uncertain===0&&batch.comparison?.status!=='uncertain');resume.disabled=requesting||polling;
  cancel.hidden=!(batch&&(batch.status==='running'||batch.status==='paused')&&!batch.cancelRequested);cancel.disabled=requesting;
  if(batch){
   const labels=[];
   if(batch.destinations.includes('ai-registration'))labels.push(`AI 수집함: 저장 확인 ${batch.saved}/${batch.total} · 실패 ${batch.failed} · 미확정 ${batch.uncertain}`);
   if(batch.comparison)labels.push(`비교함: ${compareLabels[batch.comparison.status]}${batch.comparison.status==='saved'?` ${batch.comparison.storedCount+batch.comparison.existingCount}/${batch.total}`:''}`);
   channels.textContent=labels.join('\n');
   results.replaceChildren();
   for(const item of batch.items){const line=doc.createElement('li'),link=doc.createElement('a'),detail=doc.createElement('span');link.textContent=item.title||`1688 상품 ${item.offerId}`;link.href=item.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';
    detail.textContent=batch.destinations.includes('ai-registration')?stateLabels[item.status]:`비교함 ${compareLabels[batch.comparison?.status]||'확인 중'}`;line.append(link,detail);
    if(item.error){const error=doc.createElement('span');error.className='error';error.textContent=item.error;line.append(error);}results.append(line);}
  }else if(pendingId)channels.textContent='원래 일괄 담기의 저장 상태를 확인해주세요. 같은 선택을 다시 전송하지 않습니다.';
 }
 function scan(){
  scanTimer=null;if(!current())return;
  const latest=scanListingCards(doc,initialUrl),removed=selection.reconcile(latest),live=new Map(latest.map(entry=>[entry.element,entry.candidate]));
  for(const [element,entry] of decorations){const identity=live.get(element);if(!identity||!entry.host.isConnected||identity.offerId!==entry.offerId){entry.host.remove();decorations.delete(element);}}
  entries=latest;
  for(const entry of entries){
   if(decorations.has(entry.element))continue;
   const marker=doc.createElement('div');marker.setAttribute('data-yoofam-listing-card',FORMAT);marker.style.cssText='display:block;width:100%;position:relative;z-index:20;margin-bottom:4px;';
   const shadow=marker.attachShadow({mode:'closed'}),css=doc.createElement('style');css.textContent='label{display:flex;align-items:center;gap:5px;padding:3px 6px;border:1px solid #60a5fa;border-radius:5px;background:#eff6ff;color:#1e40af;font:600 12px system-ui;cursor:pointer}input{margin:0}';
   const label=doc.createElement('label'),input=doc.createElement('input');input.type='checkbox';input.setAttribute('aria-label',`YOOFAM ${entry.candidate.title||entry.candidate.offerId} 담기`);label.append(input,doc.createTextNode('YOOFAM 담기'));shadow.append(css,label);
   label.addEventListener('click',event=>{
    event.preventDefault();event.stopPropagation();if(!event.isTrusted||running()||!current())return;
    const actual=scanListingCards(doc,initialUrl).find(item=>item.element===entry.element);
    if(!actual||actual.candidate.offerId!==entry.candidate.offerId||actual.candidate.sourceUrl!==entry.candidate.sourceUrl){scan();message('상품 카드가 변경되어 선택하지 않았습니다. 현재 목록에서 다시 선택해주세요.');return;}
    if(!selection.has(entry.element)&&selection.size>=LISTING_BATCH_LIMIT){message(`한 번에 최대 ${LISTING_BATCH_LIMIT}개를 담을 수 있습니다.`);return;}
    selection.set(actual,!selection.has(entry.element));Promise.resolve().then(()=>{if(current()){input.checked=selection.has(entry.element);update();}});
   });
   entry.element.insertBefore(marker,entry.element.firstChild);decorations.set(entry.element,{host:marker,input,offerId:entry.candidate.offerId});
  }
  for(const [element,entry] of decorations)entry.input.checked=selection.has(element);
  if(removed&&!running())message(`바뀌거나 사라진 상품 ${removed}개의 선택을 해제했습니다.`);update();
 }
 function scheduleScan(){if(scanTimer===null&&current())scanTimer=later(scan,250);}
 function call(payload){
  return new Promise((resolve,reject)=>{
   let finished=false;const finish=(error,value)=>{if(finished)return;finished=true;clearLater(timer);if(error)reject(error instanceof Error?error:Error(errorText(error)));else resolve(value);};
   const timer=later(()=>finish('확장 응답 확인 시간이 지났습니다. 같은 담기를 다시 시작하지 말고 진행 상태를 확인해주세요.'),30000);
   try{runtime.sendMessage(payload,reply=>{const cause=runtime.lastError?.message;if(cause)finish('확장 연결이 바뀌었습니다. 현재 검색 탭을 새로고침하고 원래 진행 상태를 확인해주세요.');else if(!reply||reply.ok!==true){const error=Error(errorText(reply?.error?.message||reply?.error||'일괄 담기를 확인하지 못했습니다.'));if(payload.type==='YOOFAM_LISTING_BATCH_START'&&listingStartNotCreated(reply,payload.payload?.batchId))error.startNotCreated=true;finish(error);}else finish(null,reply);});}catch{finish('확장 연결이 바뀌었습니다. 현재 검색 탭을 새로고침해주세요.');}
  });
 }
 function accept(reply){
  const value=validateListingBatchReply(reply,{batchId:pendingId,destinations:pendingDestinations});if(!current())return;
  batch=value;unknownStart=false;if(value){pendingId=value.batchId;pendingDestinations=value.destinations;message(batchLabels[value.status]);if(value.comparison?.error)message(value.comparison.error);
   if(['completed','partial','cancelled'].includes(value.status)){selection.removeOffers(value.destinations.includes('ai-registration')?value.items.filter(item=>item.status==='saved').map(item=>item.offerId):value.comparison?.status==='saved'?value.items.map(item=>item.offerId):[]);for(const [element,entry] of decorations)entry.input.checked=selection.has(element);}}
  update();schedulePoll();
 }
 function schedulePoll(){
  if(pollTimer!==null){clearLater(pollTimer);pollTimer=null;}
  if(!current()||!(unknownStart||batch?.status==='running'))return;
  if(pollCount>=1800){message('자동 상태 확인을 멈췄습니다. 새 담기를 시작하지 말고 진행 상태 확인을 눌러주세요.');return;}
  pollTimer=later(()=>{pollTimer=null;void readStatus();},2000);
 }
 async function readStatus(){
  if(!current()||polling||requesting)return;polling=true;pollCount++;update();
  try{accept(await call({type:'YOOFAM_LISTING_BATCH_STATUS',batchId:pendingId}));}
  catch(error){if(current()){message(error.message);if(pendingId)unknownStart=true;}}
  finally{polling=false;if(current()){update();schedulePoll();}}
 }
 async function transition(type){
  if(!current()||requesting||polling||!pendingId)return;requesting=true;update();
  try{accept(await call({type,batchId:pendingId}));}catch(error){if(current())message(error.message);}finally{requesting=false;if(current()){update();schedulePoll();}}
 }
 all.addEventListener('click',event=>{if(!event.isTrusted||running()||!current())return;scan();for(const entry of entries.slice(0,LISTING_BATCH_LIMIT))selection.set(entry,true);scan();if(entries.length>LISTING_BATCH_LIMIT)message(`로드된 ${entries.length}개 중 앞 ${LISTING_BATCH_LIMIT}개를 선택했습니다. 한 번에 최대 ${LISTING_BATCH_LIMIT}개를 담습니다.`);});
 none.addEventListener('click',event=>{if(!event.isTrusted||running()||!current())return;selection.clear();scan();});
 choose.addEventListener('click',event=>{if(!event.isTrusted||running()||!current())return;scan();if(selection.size){choice.hidden=false;update();ai.input.focus();}});
 dismiss.addEventListener('click',event=>{if(!event.isTrusted||requesting)return;choice.hidden=true;choose.focus();});
 root.addEventListener('keydown',event=>{if(event.key==='Escape'&&!requesting&&!choice.hidden){choice.hidden=true;choose.focus();event.stopPropagation();}});
 for(const input of [ai.input,comparison.input])input.addEventListener('change',event=>{if(event.isTrusted&&!running())update();});
 confirm.addEventListener('click',async event=>{
  if(!event.isTrusted||running()||polling||!current())return;
  let payload;try{payload=createListingBatchPayload({batchId:crypto.randomUUID(),listingUrl:loc.href,entries,selection,destinations:targets()});}catch(error){scan();message(error.message);return;}
  pendingId=payload.batchId;pendingDestinations=payload.destinations;batch=null;requesting=true;unknownStart=true;choice.hidden=true;pollCount=0;message('선택 목록을 보관하고 담기 진행 상태를 확인합니다. 아직 서버 저장 완료가 아닙니다.');update();
  let rejectedBeforeStart=false;
  try{accept(await call({type:'YOOFAM_LISTING_BATCH_START',payload}));}catch(error){if(current()){message(error.message);if(error.startNotCreated===true){pendingId=null;pendingDestinations=null;unknownStart=false;batch=null;choice.hidden=false;rejectedBeforeStart=true;}}}finally{requesting=false;if(current()){update();if(rejectedBeforeStart)void readStatus();else schedulePoll();}}
 });
 refresh.addEventListener('click',event=>{if(event.isTrusted){pollCount=0;void readStatus();}});
 cancel.addEventListener('click',event=>{if(event.isTrusted)void transition('YOOFAM_LISTING_BATCH_CANCEL');});
 resume.addEventListener('click',event=>{if(event.isTrusted&&batch?.status==='paused'&&batch.uncertain===0&&batch.comparison?.status!=='uncertain')void transition('YOOFAM_LISTING_BATCH_RESUME');});
 minimize.addEventListener('click',event=>{if(!event.isTrusted)return;const collapsed=panel.className.includes('minimized');panel.className=collapsed?'panel':'panel minimized';minimize.textContent=collapsed?'접기':'펼치기';minimize.setAttribute('aria-expanded',String(collapsed));minimize.setAttribute('aria-label',`여러 상품 담기 패널 ${collapsed?'접기':'펼치기'}`);});
 const cleanup=()=>{if(stopped)return;stopped=true;observer?.disconnect();if(scanTimer!==null)clearLater(scanTimer);if(pollTimer!==null)clearLater(pollTimer);for(const entry of decorations.values())entry.host.remove();decorations.clear();host.remove();doc.defaultView?.removeEventListener('pagehide',cleanup);};
 doc.defaultView?.addEventListener('pagehide',cleanup,{once:true});
 if(typeof Observe==='function'){observer=new Observe(scheduleScan);observer.observe(doc.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['href','data-offer-id','data-offerid','data-complete-offer-id','data-offer-expose-id','data-renderkey','data-aplus-report','data-extra','data-price','hidden','aria-hidden','class','src','data-src','data-lazyload-src','data-ks-lazyload','title']});}
 scan();void readStatus();
 return Object.freeze({host,cleanup,scan,selection,readStatus});
}

try{if(typeof window!=='undefined'&&window.top===window&&globalThis.chrome?.runtime?.id)installListingPicker();}catch{/* Other pages remain untouched. */}
