import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createSingleDocumentBrowserAdapter} from '../../extensions/supplier-hub/single-document-adapter.mjs';
import {createSingleDocumentReceiver,singleDocumentIdentity} from '../../extensions/supplier-hub/single-document.mjs';
import {singlePacket,SINGLE_SENDER,SINGLE_COMPANIES,sqliteSingleStore,clone} from './supplier-hub-single-document.mjs';

const jsonCopy=value=>JSON.parse(JSON.stringify(value));
const response=(url,json,status=200,contentType='application/json')=>{
  const result=new Response(JSON.stringify(json),{status,headers:{'content-type':contentType}});Object.defineProperty(result,'url',{value:url});return result;
};
function element(values={}){return {disabled:false,required:false,checked:false,innerText:'',textContent:'',value:'',id:'',labels:[],classList:{contains:()=>false},getClientRects:()=>[{}],getAttribute:()=>null,querySelectorAll:()=>[],click:()=>{},...values};}
const localMinute=value=>{const date=new Date(value),pad=n=>String(n).padStart(2,'0');return date.getFullYear()+'.'+pad(date.getMonth()+1)+'.'+pad(date.getDate())+' '+pad(date.getHours())+':'+pad(date.getMinutes());};
function requestEvent(){const listeners=new Map();return {addListener:(callback,filter)=>listeners.set(callback,filter),removeListener:callback=>listeners.delete(callback),emit:(...details)=>{for(const callback of [...listeners.keys()])callback(...details);},get size(){return listeners.size;},get loadSize(){return [...listeners.values()].filter(filter=>filter?.urls?.some(url=>url.endsWith('/sr/draft/api/get-by-id/*'))).length;}};}
export async function singleBrowserFixture(company=SINGLE_COMPANIES[0],options={}){
  const packet=singlePacket(company),sender=clone(SINGLE_SENDER),hash=async text=>Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(text))).toString('hex');
  packet.accountContext=await hash(JSON.stringify(['sourceflow-managed-product-account-v1',packet.ownerId,company.code,company.name]));
  const context=await singleDocumentIdentity(packet,sender),storage=sqliteSingleStore(),calls=[],f={packet,sender,context,storage,calls,now:Date.now(),clockOffset:0,sessionId:'local-session-one',company:clone(company),ownerId:packet.ownerId,submitted:0,selected:[],modal:false,termModal:null,loaded:null,fullDocuments:options.fullDocuments!==false,appReads:0,hubReads:0,listReads:0,nextClicks:0,checkboxClicks:0,loaderRequests:[],ownDocumentReadsDuringLoad:0,createdDocId:20261001+SINGLE_COMPANIES.indexOf(company),hubDocumentId:webcrypto.randomUUID(),stageApprovalClicks:{productPage:0,imagePage:0},stageOpenClicks:{productPage:0,imagePage:0},stageCloseClicks:{productPage:0,imagePage:0},stagePersisted:[],executeErrors:[]};
  const prior={docId:'protected-previous',productName:'보호된 기존 작업',categoryPath:'보호된 기존 카테고리 (99999)',modifiedAt:'2026-09-10T03:04:05.000Z',remark:'기존 작업 유지',jsonDocument:[{productPage:{supplyPrice:9999}}]},documents=new Map([[prior.docId,clone(prior)]]);f.documents=documents;f.prior=clone(prior);
  const appLocation={origin:new URL(sender.url).origin,pathname:'/'},hubLocation={origin:'https://supplier.coupang.com',pathname:'/dashboard/KR'},dataset={};
  const checkboxes=[element({id:'msrpAgreement',required:true,labels:[element({innerText:'합성 가격 정보 동의'})]}),element({id:'agreeLabelContact',required:true,labels:[element({innerText:'합성 라벨 업무용 연락처 동의'})]})];
  const intermediateAgreement=element({id:'agreeMSRPTerm',required:false,labels:[element({innerText:'MSRP, OSRP 데이터 이용 약관'})]});f.intermediateAgreement=intermediateAgreement;
  const stageCheckboxes={productPage:element({id:options.stageWrongId?'unknownMSRP':'agreeMSRPTerm',required:true}),imagePage:element({id:'agreeLabelContact',required:true})};f.stageCheckboxes=stageCheckboxes;
  const stageTitles={productPage:'MSRP, OSRP 데이터 이용 약관',imagePage:'상품 라벨 내 연락처 제공 및 공개 동의 안내'};f.stageTitles=stageTitles;
  const stageTerms={productPage:['합성 MSRP 약관 1: 가격 정보의 권한을 확인합니다.','합성 MSRP 약관 2: 현재 견적 가격 정보를 확인합니다.','합성 MSRP 약관 3: 정보 이용에 동의합니다.'],imagePage:['합성 라벨 약관 1: 개인 연락처를 제외합니다.','합성 라벨 약관 2: 공식 업무용 연락처임을 확인합니다.','합성 라벨 약관 3: 공개에 동의합니다.','합성 라벨 약관 4: 현재 표시사항을 확인합니다.']};f.stageTerms=stageTerms;
  [...checkboxes,intermediateAgreement].forEach(node=>{node.click=()=>{f.checkboxClicks++;node.checked=!node.checked;};});
  const productInput=element({value:options.dirtyHub?'보호 중인 수동 작업':''});
  const title=()=>({'/sr/registration/step/startPage':'Start Page','/sr/registration/step/productPage':'Product Page','/sr/registration/step/imagePage':'Image Page','/sr/registration/step/legalPage':'Legal Page','/sr/registration/step/logisticsPage':'Logistics Page'}[hubLocation.pathname]??'Dashboard');
  const advance=element({click:()=>{
    f.nextClicks++;if(options.companyMenuCloses)f.companyMenuOpen=false;
    const phases=['startPage','productPage','imagePage','legalPage','logisticsPage'],current=phases.indexOf(hubLocation.pathname.split('/').at(-1));
    if(current===4){f.submitted++;options.afterNativeSubmit?.(f);return;}
    if(options.stageFlow&&options.nextNoCommitStage===phases[current])throw Error('Synthetic next-step click lost before observed page change');
    if(options.stageFlow&&[1,2].includes(current)){
      const stage=phases[current],key=stage==='productPage'?'msrpAgree':'labelContactAgreed';
      if(!stageCheckboxes[stage].checked)throw Error('Synthetic unchecked stage agreement cannot advance');
      documents.get(f.createdDocId).jsonDocument[0].imagePage[key]=true;f.stagePersisted.push({stage,key,docId:f.createdDocId});
    }
    hubLocation.pathname='/sr/registration/step/'+phases[current+1];
  }});
  f.companyMenuOpen=true;
  const companyButton=element({click:()=>{f.companyMenuOpen=true;if(options.companyMenuCloses&&f.termModal)f.termModal=null;}});Object.defineProperty(companyButton,'innerText',{get:()=>f.company.name});
  const modalButton=element({innerText:'중간 저장 불러오기',click:()=>{f.modal=true;if(options.companyMenuCloses)f.companyMenuOpen=false;if(options.companyChangeAfterModal)f.company=clone(SINGLE_COMPANIES.find(value=>value.code!==company.code));}});
  const webRequest=Object.fromEntries(['onBeforeRequest','onCompleted','onErrorOccurred','onBeforeRedirect'].map(name=>[name,requestEvent()]));f.webRequest=webRequest;
  const rows=()=>[...documents].map(([docId,body])=>{
    const name=element({textContent:body.productName}),badge=element({textContent:'반려',classList:{contains:key=>key==='badge'}});
    const first=element({querySelectorAll:selector=>selector==='span'?(body.remark?[badge,name]:[name]):selector==='.badge'?(body.remark?[badge]:[]):[]});
    const load=element({getAttribute:key=>key==='type'?'button':null,click:async()=>{
      f.selected.push(docId);if(options.companyMenuCloses)f.companyMenuOpen=false;const actual=options.wrongLoaderId??docId,url=hubLocation.origin+'/sr/draft/api/get-by-id/'+encodeURIComponent(String(actual));f.loaderRequests.push(actual);
      const details={tabId:71,frameId:0,documentId:f.hubDocumentId,documentLifecycle:'active',frameType:'outermost_frame',initiator:hubLocation.origin,method:'GET',type:'xmlhttprequest',url,requestId:'ui-load-'+f.loaderRequests.length,timeStamp:Date.now()};
      webRequest.onBeforeRequest.emit(details);
      await hubFetch(url,{method:'GET',credentials:'include',redirect:'error'},true);
      if(options.loaderRedirect)webRequest.onBeforeRedirect.emit({...details,redirectUrl:hubLocation.origin+'/login',statusCode:302});
      if(options.loaderError)webRequest.onErrorOccurred.emit({...details,error:'net::ERR_FAILED'});
      else webRequest.onCompleted.emit({...details,timeStamp:details.timeStamp+1,statusCode:options.loaderStatus??200,fromCache:options.loaderCache===true,responseHeaders:[{name:'Content-Type',value:options.loaderContentType??'application/json'}]});
      f.loaded=actual;productInput.value=body.productName;f.modal=false;
    }});
    const cells=[first,element({textContent:body.categoryPath}),element({textContent:localMinute(body.modifiedAt)}),element({querySelectorAll:selector=>selector==='.btn-outline-primary'?[load]:[]}),element({querySelectorAll:()=>[element()]})];
    return element({innerText:body.productName,getAttribute:key=>key==='data-doc-id'&&!options.hideRowIdentity?docId:null,querySelectorAll:selector=>selector==='td'?cells:selector==='.btn-outline-primary'?[load]:[]});
  });
  const stageBox=stage=>element({innerText:stage==='productPage'?'MSRP, OSRP 데이터 이용 약관 * 자세히보기 이용약관을 읽고 동의합니다.':'합성 라벨 업무용 연락처 제공 및 공개 동의 * 자세히보기 이용약관을 읽고 동의합니다.',querySelectorAll:selector=>
    selector==='input[type="checkbox"]'?[stageCheckboxes[stage]]:selector==='[role="button"]'?[element({innerText:'자세히보기',getAttribute:key=>key==='role'?'button':null,click:()=>{f.stageOpenClicks[stage]++;f.termModal=stage;if(options.companyMenuCloses)f.companyMenuOpen=false;}})]:[]});
  const stageDialog=()=>{
    const stage=f.termModal;if(!stage)return null;
    const footer=element({innerText:'동의하기',type:'submit',getAttribute:()=>null,click:()=>{
      f.stageApprovalClicks[stage]++;f.termModal=null;if(options.companyMenuCloses)f.companyMenuOpen=false;
      if(options.stageUncheckedAfterAccept!==stage)stageCheckboxes[stage].checked=true;
    }});f.lastStageFooter=footer;
    const close=element({innerText:'× Close',type:'button',getAttribute:key=>key==='type'?'button':null,click:()=>{f.stageCloseClicks[stage]++;f.termModal=null;}});
    return element({querySelectorAll:selector=>selector==='.modal-title'?[element({innerText:options.stageWrongTitle?'다른 약관':stageTitles[stage]})]:selector==='.modal-body'?[element({innerText:options.stageEmptyTerms?'':stageTerms[stage].join('\n'),querySelectorAll:key=>key==='ol > li'?stageTerms[stage].map(innerText=>element({innerText})):[]})]:selector==='.modal-footer .btn-primary'?[footer]:selector==='.modal-header .close'||selector==='.modal-header button.close'||selector==='.modal-header button.close[type="button"]'?[close]:[]});
  };
  const hubDocument={documentElement:{dataset},body:{get innerText(){return options.companyMenuCloses&&!f.companyMenuOpen?'': 'Company Code: '+f.company.code;}},
    querySelectorAll:selector=>{
      if(selector==='.rsc-text-input input')return productInput.value||hubLocation.pathname!=='/dashboard/KR'?[productInput]:[];
      if(selector==='.btn-outline-secondary')return [modalButton];if(selector==='.modal-title')return f.modal?[element({innerText:'중간 저장 불러오기'})]:[];
      if(selector==='.sr-contents__table-draft tbody > tr')return rows();
      if(selector==='input[type="checkbox"]'){
        if(options.stageFlow)return hubLocation.pathname.endsWith('/productPage')?[stageCheckboxes.productPage]:hubLocation.pathname.endsWith('/imagePage')?[stageCheckboxes.imagePage]:[];
        return hubLocation.pathname.endsWith('/logisticsPage')?checkboxes:options.intermediateAgreementUnchecked&&hubLocation.pathname.endsWith('/productPage')?[intermediateAgreement]:[];
      }
      if(selector==='.msrp-terms')return options.stageFlow&&hubLocation.pathname.endsWith('/productPage')?[stageBox('productPage')]:[];
      if(selector==='.label-contact-terms')return options.stageFlow&&hubLocation.pathname.endsWith('/imagePage')?[stageBox('imagePage')]:[];
      if(selector==='.modal-dialog.msrp-terms-modal')return f.termModal?Array.from({length:options.stageModalAmbiguous?2:1},()=>stageDialog()):[];
      if(selector==='.modal[role="dialog"]')return f.termModal?[stageDialog()]:[];
      if(selector==='button[type="submit"]')return [advance];if(selector==='button')return [companyButton];return [];
    },querySelector:selector=>selector==='#root__title'?element({innerText:title()}):selector==='.text-primary'?element({innerText:f.submitted?'상품 등록 완료':''}):null};
  f.hubDocument=hubDocument;f.hubLocation=hubLocation;
  const appFetch=async(url,init)=>{
    calls.push({name:'app-fetch',url,init:{...init,signal:undefined}});f.appReads++;
    if(options.beforeAppFetch)await options.beforeAppFetch(url,init,f);
    if(url.endsWith('/catalog-context'))return response(url,{ownerId:f.ownerId,company:f.company});
    const packageView={format:'yoofam-supplier-hub-single-package-v1',prepared:true,registered:false,remoteWrites:false,submissionReady:false,humanAgreementsConfirmed:false,
      productId:packet.productId,requestedProfileId:packet.profileId,fingerprint:packet.fingerprint,company:clone(company),schemaSha256:packet.schemaSha256,
      source:{...packet.source,profileId:packet.profileId},payload:clone(packet.body),manifest:[{optionId:packet.optionId,files:[{published:true,verification:'stored-body-sha256',url:'https://image.example.test/main.jpg'}]}],
      review:{canPrepare:true,fields:[{optionId:packet.optionId,path:['startPage','productName'],projected:true}],issues:[]},...options.packageView};
    return response(url,packageView,options.appStatus??200,options.appContentType??'application/json');
  };
  const hubFetch=async(url,init,uiLoader=false)=>{
    calls.push({name:uiLoader?'hub-ui-fetch':'hub-fetch',url,init:{...init,signal:undefined}});f.hubReads++;if(options.beforeHubFetch)await options.beforeHubFetch(url,init,f);
    if(url.endsWith('/drafts/register-requested')){
      const rows=typeof options.registerRequestedRows==='function'?await options.registerRequestedRows(f):options.registerRequestedRows??[];
      const result=response(options.registerRequestedUrl??url,rows,options.registerRequestedStatus??200,options.registerRequestedContentType??'application/json');
      if(options.registerRequestedRedirected)Object.defineProperty(result,'redirected',{value:true});return result;
    }
    if(url.endsWith('/drafts')){
      f.listReads++;let list=[...documents.values()].map(doc=>f.fullDocuments?clone(doc):{docId:doc.docId,productName:doc.productName,categoryPath:doc.categoryPath,modifiedAt:doc.modifiedAt,remark:doc.remark});
      if(options.draftList)list=await options.draftList(list,f);return response(url,list);
    }
    if(new URL(url).pathname.startsWith('/sr/draft/api/get-by-id/')){
      if(!uiLoader&&Object.values(webRequest).some(event=>event.loadSize>0))f.ownDocumentReadsDuringLoad++;
      const docId=decodeURIComponent(new URL(url).pathname.slice('/sr/draft/api/get-by-id/'.length)),stored=documents.get(docId)??documents.get(Number(docId));
      let result=stored?{...clone(stored),status:'UNFINISHED'}:null;
      if(options.documentRead)result=await options.documentRead(result,f);
      return response(url,result,options.documentStatus??200,options.documentContentType??'application/json');
    }
    const body=JSON.parse(init.body);
    if(url.endsWith('/create')){
      const docId=f.createdDocId,created={...body,docId,modifiedAt:new Date(f.now).toISOString()};documents.set(docId,created);
      if(options.ambiguousRow)documents.set(docId+1000000,{...clone(created),docId:docId+1000000});return response(url,{docId},options.createStatus??200);
    }
    if(url.endsWith('/update')){documents.set(body.docId,{...body,modifiedAt:documents.get(body.docId).modifiedAt});return response(url,{},options.updateStatus??200);}
    return response(url,{code:200,data:[{success:true,errors:[]}]});
  };
  class FixtureDate extends Date {static now(){return Date.now()+f.clockOffset;}}
  const clock=()=>Date.now()+f.clockOffset;
  const appContext=vm.createContext({location:appLocation,fetch:appFetch,crypto:webcrypto,AbortController,TextEncoder,TextDecoder,Uint8Array,URL,setTimeout,clearTimeout,Date:options.stageFlow?FixtureDate:Date,Response,structuredClone});
  const hubContext=vm.createContext({location:hubLocation,document:hubDocument,fetch:hubFetch,crypto:webcrypto,AbortController,TextEncoder,TextDecoder,Uint8Array,URL,setTimeout,clearTimeout,Date:options.stageFlow?FixtureDate:Date,Response,structuredClone});
  const appTab={id:sender.tab.id,windowId:sender.tab.windowId,url:sender.url,status:'complete'},hubTab={id:71,windowId:sender.tab.windowId,url:hubLocation.origin+hubLocation.pathname,status:'complete'};
  // The Hub DOM belongs to a newly extension-created tab. Existing tabs are
  // retained separately and must never be inspected, navigated or selected.
  const tabs=[appTab,...(options.extraTabs??[])];f.tabs=tabs;
  const api={tabs:{
    get:async id=>{if(id===hubTab.id)hubTab.url=hubLocation.origin+hubLocation.pathname;return clone(tabs.find(tab=>tab.id===id));},
    create:async input=>{calls.push({name:'tabs-create',input});if(tabs.some(tab=>tab.id===hubTab.id))throw Error('Synthetic duplicate target creation');tabs.push(hubTab);return clone(hubTab);},
    query:async query=>{calls.push({name:'tabs-query',query});return clone(tabs.filter(tab=>tab.id!==appTab.id&&tab.windowId===query.windowId));},
    update:async(id,input)=>{calls.push({name:'tabs-update',id,input});if(id!==hubTab.id)throw Error('unknown tab');hubLocation.pathname=new URL(input.url).pathname;hubTab.url=input.url;
      // A real browser navigation discards this page's dataset and input state.
      for(const key of Object.keys(dataset))delete dataset[key];productInput.value='';f.modal=false;f.termModal=null;f.loaded=null;f.hubDocumentId=webcrypto.randomUUID();return clone(hubTab);},
    sendMessage:async(id,message,frame)=>{
      calls.push({name:'app-message',id,message,frame});if(id!==appTab.id||frame.frameId!==0)throw Error('wrong original app frame');
      if(message.type==='YOOFAM_VERIFY_SINGLE_DOCUMENT_SOURCE')return {ok:true,current:true,submissionReady:true,priorDocumentClear:true,identity:clone(message.expected.identity),bodySha256:message.expected.bodySha256,sessionId:f.sessionId,checkedAt:clock(),...options.bridge};
      if(message.type==='YOOFAM_CONFIRM_SINGLE_DOCUMENT_ACTION'){
        if(options.beforeHumanConfirmation)await options.beforeHumanConfirmation(message,f);
        return {ok:options.human!==false,userInitiated:true,challengeId:message.expected.challenge.id,identityDigest:context.identityDigest,checkedAt:clock()};
      }
      throw Error('unknown message');
    },
  },scripting:{executeScript:async request=>{
    calls.push({name:'execute',func:request.func.name,target:clone(request.target)});
    if(request.target.documentIds&&!request.target.documentIds.includes(f.hubDocumentId))throw Error('Synthetic browser document changed');
    const target=request.target.tabId===appTab.id?appContext:hubContext;target.args=clone(request.args??[]);
    let value;try{value=await vm.runInContext('('+request.func.toString()+')(...args)',target);}catch(error){f.executeErrors.push({name:request.func.name,action:request.args?.[0]?.action,stage:request.args?.[0]?.stage,message:error.message});throw error;}
    if(request.func.name==='singleDocumentStageAgreementPage'&&request.args?.[0]?.action==='confirm'&&options.stageLostExecuteAck===request.args[0].stage){options.stageLostExecuteAck=null;throw Error('Synthetic stage confirmation executeScript ACK lost after observation');}
    if(request.func.name==='singleDocumentNavigatePage'&&options.nextLostExecuteAck&&request.args?.[0]?.stageConsents?.some(entry=>entry.stage===options.nextLostExecuteAck)){options.nextLostExecuteAck=null;throw Error('Synthetic next-step executeScript ACK lost after observed page change');}
    if(request.func.name==='singleDocumentSubmitPage'&&options.submitLoseExecuteAck){options.submitLoseExecuteAck=false;throw Error('Synthetic submit ACK lost after its one click');}
    if(options.loseExecuteAck===request.func.name&&request.args?.[0]?.path===options.losePath)throw Error('Synthetic Chrome executeScript ACK lost');
    return [{frameId:options.frameId??0,documentId:request.target.tabId===appTab.id?'12345678-1234-4234-9234-123456789abc':f.hubDocumentId,result:value===undefined?undefined:jsonCopy(value)}];
  }},webRequest};
  const pageEvents=new Map();hubDocument.addEventListener=(name,callback)=>{if(!pageEvents.has(name))pageEvents.set(name,new Set());pageEvents.get(name).add(callback);};hubDocument.removeEventListener=(name,callback)=>pageEvents.get(name)?.delete(callback);
  f.hubEvent=(name,isTrusted=true)=>{for(const callback of [...(pageEvents.get(name)??[])])callback({isTrusted});};f.pageEvents=pageEvents;
  for(const name of ['onUpdated','onDetached','onRemoved','onReplaced'])api.tabs[name]=requestEvent();
  f.api=api;f.adapter=createSingleDocumentBrowserAdapter({api,now:clock});f.receiver=createSingleDocumentReceiver({adapter:f.adapter,store:storage.store,now:clock});
  f.action=started=>({action:['productPage','imagePage'].includes(started.challenge.stage)?'confirm-and-continue':'confirm-and-submit',...(started.challenge.stage?{stage:started.challenge.stage}:{}),userInitiated:true,challengeId:started.challenge.id,confirmedAt:clock(),approvedKeys:started.challenge.items.filter(item=>item.required).map(item=>item.key)});
  f.close=()=>{f.adapter.dispose();f.hubEvent('pointerdown');storage.db.close();};return f;
}
