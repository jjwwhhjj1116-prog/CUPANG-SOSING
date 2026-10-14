/** Serialized only into the selected owned Hub document. Opening 자세히보기
 * reads the current terms; only confirm may accept them after the isolated
 * app frame has verified an explicit, current user action. */
export async function singleDocumentStageAgreementPage(input){
  const canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
  const same=(a,b)=>canon(a)===canon(b),visible=node=>Boolean(node&&node.getClientRects().length),data=document.documentElement.dataset;
  const configs={productPage:{key:'msrpAgree',id:'agreeMSRPTerm',box:'.msrp-terms',title:'MSRP, OSRP 데이터 이용 약관',terms:3},imagePage:{key:'labelContactAgreed',id:'agreeLabelContact',box:'.label-contact-terms',title:'상품 라벨 내 연락처 제공 및 공개 동의 안내',terms:4}};
  const config=configs[input.stage];if(!config)throw Error('확인한 개별 등록 약관 단계가 아닙니다.');
  let companyVerified=false;
  const check=()=>{
    const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),m=>m[1]);
    const buttons=Array.from(document.querySelectorAll('button')).filter(node=>visible(node)&&!node.disabled&&(node.innerText||'').trim()===input.binding.identity.company.name);
    const record=JSON.parse(data.yoofamSingleDocumentRecords||'{}')[input.binding.packetDigest];
    if(record?.watchToken!==undefined&&(record.watchState!=='active'||Date.now()>=record.watchExpiresAt))throw Error('현재 새 문서의 입력 관찰이 중단됐습니다.');
    if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/sr/registration/step/'+input.stage||codes.length>1||codes.length===1&&codes[0]!==input.binding.identity.company.code
      ||!codes.length&&(!companyVerified||buttons.length!==1)||!record||!same(record.binding,input.binding)||!same(record.docId,input.docId)||!same(record.loadedDocId,input.docId))throw Error('소유한 새 문서의 현재 약관 단계를 확인해주세요.');
    if(codes.length===1)companyVerified=true;return record;
  };
  const save=record=>{const records=JSON.parse(data.yoofamSingleDocumentRecords||'{}');records[input.binding.packetDigest]=record;data.yoofamSingleDocumentRecords=JSON.stringify(records);};
  const scope=()=>{
    const boxes=Array.from(document.querySelectorAll(config.box)).filter(visible);if(boxes.length!==1)throw Error('현재 단계의 약관 영역을 확인하지 못했습니다.');
    const nodes=Array.from(boxes[0].querySelectorAll('input[type="checkbox"]')).filter(node=>visible(node)&&node.id===config.id);
    if(nodes.length!==1||nodes[0].disabled)throw Error('현재 단계의 동의 선택을 확인하지 못했습니다.');
    return {box:boxes[0],checkbox:nodes[0]};
  };
  const modal=()=>{
    const dialogs=Array.from(document.querySelectorAll('.modal-dialog.msrp-terms-modal')).filter(visible);
    if(dialogs.length>1)throw Error('여러 약관 팝업이 열려 있습니다. 현재 문서를 확인해주세요.');
    if(!dialogs.length)return null;
    const dialog=dialogs[0],titles=Array.from(dialog.querySelectorAll('.modal-title')).filter(visible),bodies=Array.from(dialog.querySelectorAll('.modal-body')).filter(visible);
    const buttons=Array.from(dialog.querySelectorAll('.modal-footer .btn-primary')).filter(node=>visible(node)&&!node.disabled&&(node.innerText||'').trim()==='동의하기');
    if(titles.length!==1||(titles[0].innerText||'').trim()!==config.title||bodies.length!==1||buttons.length!==1||bodies[0].querySelectorAll('ol > li').length!==config.terms)throw Error('현재 단계의 약관 전문·확인 버튼을 구분하지 못했습니다.');
    return {title:(titles[0].innerText||'').trim(),termsText:(bodies[0].innerText||'').trim(),button:buttons[0]};
  };
  const record=check();let displayed=modal();
  if(!displayed){
    if(Array.from(document.querySelectorAll('.modal[role="dialog"]')).some(visible))throw Error('다른 팝업을 유지했습니다. 현재 약관을 다시 확인해주세요.');
    const {box}=scope(),links=Array.from(box.querySelectorAll('[role="button"]')).filter(node=>visible(node)&&(node.innerText||'').trim()==='자세히보기');
    if(links.length!==1)throw Error('약관 전문 열기 버튼을 확인하지 못했습니다.');
    if(input.action==='confirm'&&(!input.challenge||input.confirmation?.challengeId!==input.challenge.id||input.confirmation?.action!=='confirm-and-continue'||input.confirmation.stage!==input.stage||input.confirmation.userInitiated!==true||Date.now()>input.challenge.expiresAt))throw Error('현재 사용자 확인이 없는 약관은 선택하지 않았습니다.');
    links[0].click();
    for(let n=0;n<40&&!displayed;n++){check();displayed=modal();if(!displayed)await new Promise(resolve=>setTimeout(resolve,100));}
    if(!displayed)throw Error('현재 약관 팝업의 전문을 읽지 못했습니다.');
  }
  const descriptor=()=>{
    check();const {box,checkbox}=scope(),value=modal();
    if(!value||!value.termsText||value.termsText.length>50000)throw Error('현재 약관 전문을 확인해주세요.');
    const text=(box.innerText||'').trim();if(!text||text.length>10000)throw Error('현재 동의 안내를 확인해주세요.');
    return {docId:input.docId,company:input.binding.identity.company,stage:input.stage,readyForConsent:true,
      items:[{key:config.key,id:config.id,text,required:true,checked:checkbox.checked===true,enabled:true,title:value.title,termsText:value.termsText}]};
  };
  const reviewed=descriptor(),plain=({key,id,text,required,title,termsText})=>({key,id,text,required,title,termsText});
  if(input.action==='read')return reviewed;
  const challenge=input.challenge;
  if(!challenge||challenge.stage!==input.stage||!same(challenge.docId,input.docId)||challenge.packetDigest!==input.binding.packetDigest||!same(reviewed.items.map(plain),challenge.items))throw Error('현재 단계의 원래 약관 확인과 다릅니다.');
  const existing=record.stageConsentOperations?.[input.stage];
  if(input.action==='recover'){
    if(!existing||existing.operationId!==input.operationId||existing.challengeId!==challenge.id||existing.state!=='observed'||!reviewed.items[0].checked||!same(existing.items,challenge.items))throw Error('원래 단계의 동의 반영을 읽기로 확인하지 못했습니다.');
    const dialogs=Array.from(document.querySelectorAll('.modal-dialog.msrp-terms-modal')).filter(visible),close=Array.from(dialogs[0].querySelectorAll('.modal-header button.close')).filter(node=>visible(node)&&!node.disabled&&node.getAttribute('type')==='button');
    if(close.length!==1)throw Error('조회한 약관을 변경 없이 닫지 못했습니다.');
    close[0].click();let closed=false;
    for(let n=0;n<40;n++){check();if(!modal()&&scope().checkbox.checked){closed=true;break;}await new Promise(resolve=>setTimeout(resolve,100));}
    if(!closed)throw Error('조회한 약관 닫기와 기존 동의값을 확인하지 못했습니다.');
    return {...reviewed,readOnly:true,operationId:input.operationId};
  }
  if(input.action!=='confirm'||existing||input.operationId!==input.binding.requestId+':stage-consent:'+input.stage
    ||input.confirmation?.action!=='confirm-and-continue'||input.confirmation.stage!==input.stage||input.confirmation.challengeId!==challenge.id||input.confirmation.userInitiated!==true
    ||!Number.isSafeInteger(challenge.expiresAt)||Date.now()>challenge.expiresAt||reviewed.items[0].checked)throw Error('원래 단계의 현재 사용자 동의 확인이 필요합니다. 다시 선택하지 않았습니다.');
  record.stageConsentOperations??={};record.stageConsentOperations[input.stage]={operationId:input.operationId,challengeId:challenge.id,items:challenge.items,state:'requested'};save(record);
  displayed.button.click();
  let observed=false;
  for(let n=0;n<40;n++){check();if(!modal()&&scope().checkbox.checked){observed=true;break;}await new Promise(resolve=>setTimeout(resolve,100));}
  if(!observed)throw Error('동의 반영을 확인하지 못했습니다. 다시 누르지 않았습니다.');
  record.stageConsentOperations[input.stage].state='observed';save(record);
  return {...reviewed,items:reviewed.items.map(item=>({...item,checked:true}))};
}
