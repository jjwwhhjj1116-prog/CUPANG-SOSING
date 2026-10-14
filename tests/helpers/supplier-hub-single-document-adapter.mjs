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
function requestEvent(){const listeners=new Set();return {addListener:(callback,filter,extra)=>{listeners.add(callback);void filter;void extra;},removeListener:callback=>listeners.delete(callback),emit:details=>{for(const callback of [...listeners])callback(details);},get size(){return listeners.size;}};}
export async function singleBrowserFixture(company=SINGLE_COMPANIES[0],options={}){
  const packet=singlePacket(company),sender=clone(SINGLE_SENDER),hash=async text=>Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(text))).toString('hex');
  packet.accountContext=await hash(JSON.stringify(['sourceflow-managed-product-account-v1',packet.ownerId,company.code,company.name]));
  const context=await singleDocumentIdentity(packet,sender),storage=sqliteSingleStore(),calls=[],f={packet,sender,context,storage,calls,now:Date.now(),sessionId:'local-session-one',company:clone(company),ownerId:packet.ownerId,submitted:0,selected:[],modal:false,loaded:null,fullDocuments:options.fullDocuments!==false,appReads:0,hubReads:0,listReads:0,nextClicks:0,checkboxClicks:0,loaderRequests:[],ownDocumentReadsDuringLoad:0,createdDocId:20261001+SINGLE_COMPANIES.indexOf(company),hubDocumentId:webcrypto.randomUUID()};
  const prior={docId:'protected-previous',productName:'보호된 기존 작업',categoryPath:'보호된 기존 카테고리 (99999)',modifiedAt:'2026-09-10T03:04:05.000Z',remark:'기존 작업 유지',jsonDocument:[{productPage:{supplyPrice:9999}}]},documents=new Map([[prior.docId,clone(prior)]]);f.documents=documents;f.prior=clone(prior);
  const appLocation={origin:new URL(sender.url).origin,pathname:'/'},hubLocation={origin:'https://supplier.coupang.com',pathname:'/dashboard/KR'},dataset={};
  const checkboxes=[element({id:'msrpAgreement',required:true,labels:[element({innerText:'합성 가격 정보 동의'})]}),element({id:'agreeLabelContact',required:true,labels:[element({innerText:'합성 라벨 업무용 연락처 동의'})]})];
  const intermediateAgreement=element({id:'agreeMSRPTerm',required:false,labels:[element({innerText:'MSRP, OSRP 데이터 이용 약관'})]});f.intermediateAgreement=intermediateAgreement;
  [...checkboxes,intermediateAgreement].forEach(node=>{node.click=()=>{f.checkboxClicks++;node.checked=!node.checked;};});
  const productInput=element({value:options.dirtyHub?'보호 중인 수동 작업':''});
  const title=()=>({'/sr/registration/step/startPage':'Start Page','/sr/registration/step/productPage':'Product Page','/sr/registration/step/imagePage':'Image Page','/sr/registration/step/legalPage':'Legal Page','/sr/registration/step/logisticsPage':'Logistics Page'}[hubLocation.pathname]??'Dashboard');
  const advance=element({click:()=>{
    f.nextClicks++;if(options.companyMenuCloses)f.companyMenuOpen=false;
    const phases=['startPage','productPage','imagePage','legalPage','logisticsPage'],current=phases.indexOf(hubLocation.pathname.split('/').at(-1));
    if(current===4){f.submitted++;return;}
    hubLocation.pathname='/sr/registration/step/'+phases[current+1];
  }});
  f.companyMenuOpen=true;
  const companyButton=element({click:()=>{f.companyMenuOpen=true;}});Object.defineProperty(companyButton,'innerText',{get:()=>f.company.name});
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
  const hubDocument={documentElement:{dataset},body:{get innerText(){return options.companyMenuCloses&&!f.companyMenuOpen?'': 'Company Code: '+f.company.code;}},
    querySelectorAll:selector=>{
      if(selector==='.rsc-text-input input')return productInput.value||hubLocation.pathname!=='/dashboard/KR'?[productInput]:[];
      if(selector==='.btn-outline-secondary')return [modalButton];if(selector==='.modal-title')return f.modal?[element({innerText:'중간 저장 불러오기'})]:[];
      if(selector==='.sr-contents__table-draft tbody > tr')return rows();
      if(selector==='input[type="checkbox"]')return hubLocation.pathname.endsWith('/logisticsPage')?checkboxes:options.intermediateAgreementUnchecked&&hubLocation.pathname.endsWith('/productPage')?[intermediateAgreement]:[];
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
    if(url.endsWith('/drafts')){
      f.listReads++;let list=[...documents.values()].map(doc=>f.fullDocuments?clone(doc):{docId:doc.docId,productName:doc.productName,categoryPath:doc.categoryPath,modifiedAt:doc.modifiedAt,remark:doc.remark});
      if(options.draftList)list=await options.draftList(list,f);return response(url,list);
    }
    if(new URL(url).pathname.startsWith('/sr/draft/api/get-by-id/')){
      if(!uiLoader&&Object.values(webRequest).some(event=>event.size>0))f.ownDocumentReadsDuringLoad++;
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
  const appContext=vm.createContext({location:appLocation,fetch:appFetch,crypto:webcrypto,AbortController,TextEncoder,TextDecoder,Uint8Array,URL,setTimeout,clearTimeout,Date,Response,structuredClone});
  const hubContext=vm.createContext({location:hubLocation,document:hubDocument,fetch:hubFetch,crypto:webcrypto,AbortController,TextEncoder,TextDecoder,Uint8Array,URL,setTimeout,clearTimeout,Date,Response,structuredClone});
  const appTab={id:sender.tab.id,windowId:sender.tab.windowId,url:sender.url,status:'complete'},hubTab={id:71,windowId:sender.tab.windowId,url:hubLocation.origin+hubLocation.pathname,status:'complete'};
  const tabs=[appTab,hubTab,...(options.extraTabs??[])];f.tabs=tabs;
  const api={tabs:{
    get:async id=>{if(id===hubTab.id)hubTab.url=hubLocation.origin+hubLocation.pathname;return clone(tabs.find(tab=>tab.id===id));},
    query:async query=>{calls.push({name:'tabs-query',query});return clone(tabs.filter(tab=>tab.id!==appTab.id&&tab.windowId===query.windowId));},
    update:async(id,input)=>{calls.push({name:'tabs-update',id,input});if(id!==hubTab.id)throw Error('unknown tab');hubLocation.pathname=new URL(input.url).pathname;hubTab.url=input.url;
      // A real browser navigation discards this page's dataset and input state.
      for(const key of Object.keys(dataset))delete dataset[key];productInput.value='';f.modal=false;f.loaded=null;f.hubDocumentId=webcrypto.randomUUID();return clone(hubTab);},
    sendMessage:async(id,message,frame)=>{
      calls.push({name:'app-message',id,message,frame});if(id!==appTab.id||frame.frameId!==0)throw Error('wrong original app frame');
      if(message.type==='YOOFAM_VERIFY_SINGLE_DOCUMENT_SOURCE')return {ok:true,current:true,submissionReady:true,priorDocumentClear:true,identity:clone(message.expected.identity),bodySha256:message.expected.bodySha256,sessionId:f.sessionId,checkedAt:Date.now(),...options.bridge};
      if(message.type==='YOOFAM_CONFIRM_SINGLE_DOCUMENT_ACTION')return {ok:options.human!==false,userInitiated:true,challengeId:message.expected.challenge.id,identityDigest:context.identityDigest,checkedAt:Date.now()};
      throw Error('unknown message');
    },
  },scripting:{executeScript:async request=>{
    calls.push({name:'execute',func:request.func.name,target:clone(request.target)});
    if(request.target.documentIds&&!request.target.documentIds.includes(f.hubDocumentId))throw Error('Synthetic browser document changed');
    const target=request.target.tabId===appTab.id?appContext:hubContext;target.args=clone(request.args??[]);
    const value=await vm.runInContext('('+request.func.toString()+')(...args)',target);
    if(options.loseExecuteAck===request.func.name&&request.args?.[0]?.path===options.losePath)throw Error('Synthetic Chrome executeScript ACK lost');
    return [{frameId:options.frameId??0,documentId:request.target.tabId===appTab.id?'12345678-1234-4234-9234-123456789abc':f.hubDocumentId,result:value===undefined?undefined:jsonCopy(value)}];
  }},webRequest};
  f.api=api;f.adapter=createSingleDocumentBrowserAdapter({api});f.receiver=createSingleDocumentReceiver({adapter:f.adapter,store:storage.store});
  f.action=started=>({action:'confirm-and-submit',userInitiated:true,challengeId:started.challenge.id,confirmedAt:Date.now(),approvedKeys:started.challenge.items.filter(item=>item.required).map(item=>item.key)});
  f.close=()=>storage.db.close();return f;
}
