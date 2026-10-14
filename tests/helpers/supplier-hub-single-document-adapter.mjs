import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createSingleDocumentBrowserAdapter} from '../../extensions/supplier-hub/single-document-adapter.mjs';
import {createSingleDocumentReceiver,singleDocumentIdentity} from '../../extensions/supplier-hub/single-document.mjs';
import {singlePacket,SINGLE_SENDER,SINGLE_COMPANIES,sqliteSingleStore,clone} from './supplier-hub-single-document.mjs';

const jsonCopy=value=>JSON.parse(JSON.stringify(value));
const response=(url,json,status=200,contentType='application/json')=>{
  const result=new Response(JSON.stringify(json),{status,headers:{'content-type':contentType}});Object.defineProperty(result,'url',{value:url});return result;
};
function element(values={}){return {disabled:false,required:false,checked:false,innerText:'',value:'',id:'',labels:[],getClientRects:()=>[{}],getAttribute:()=>null,querySelectorAll:()=>[],click:()=>{},...values};}
export async function singleBrowserFixture(company=SINGLE_COMPANIES[0],options={}){
  const packet=singlePacket(company),sender=clone(SINGLE_SENDER),hash=async text=>Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(text))).toString('hex');
  packet.accountContext=await hash(JSON.stringify(['sourceflow-managed-product-account-v1',packet.ownerId,company.code,company.name]));
  const context=await singleDocumentIdentity(packet,sender),storage=sqliteSingleStore(),calls=[],f={packet,sender,context,storage,calls,now:Date.now(),sessionId:'local-session-one',company:clone(company),ownerId:packet.ownerId,submitted:0,selected:[],modal:false,loaded:null,fullDocuments:options.fullDocuments!==false,appReads:0,hubReads:0};
  const prior={docId:'protected-previous',productName:'보호된 기존 작업',jsonDocument:[{productPage:{supplyPrice:9999}}]},documents=new Map([[prior.docId,clone(prior)]]);f.documents=documents;f.prior=clone(prior);
  const appLocation={origin:new URL(sender.url).origin,pathname:'/'},hubLocation={origin:'https://supplier.coupang.com',pathname:'/dashboard/KR'},dataset={};
  const checkboxes=[element({id:'msrpAgreement',required:true,labels:[element({innerText:'합성 가격 정보 동의'})]}),element({id:'agreeLabelContact',required:true,labels:[element({innerText:'합성 라벨 업무용 연락처 동의'})]})];
  checkboxes.forEach(node=>{node.click=()=>{node.checked=!node.checked;};});
  const productInput=element({value:options.dirtyHub?'보호 중인 수동 작업':''});
  const title=()=>({'/sr/registration/step/startPage':'Start Page','/sr/registration/step/productPage':'Product Page','/sr/registration/step/imagePage':'Image Page','/sr/registration/step/legalPage':'Legal Page','/sr/registration/step/logisticsPage':'Logistics Page'}[hubLocation.pathname]??'Dashboard');
  const advance=element({click:()=>{
    const phases=['startPage','productPage','imagePage','legalPage','logisticsPage'],current=phases.indexOf(hubLocation.pathname.split('/').at(-1));
    if(current===4){f.submitted++;return;}
    hubLocation.pathname='/sr/registration/step/'+phases[current+1];
  }});
  const modalButton=element({innerText:'중간 저장 불러오기',click:()=>{f.modal=true;}});
  const rows=()=>[...documents].map(([docId,body])=>element({innerText:options.hideRowIdentity?body.productName:docId+' '+body.productName,getAttribute:key=>key==='data-doc-id'&&!options.hideRowIdentity?docId:null,
    querySelectorAll:selector=>selector==='.btn-outline-primary'?[element({click:()=>{f.loaded=docId;f.selected.push(docId);productInput.value=body.productName;}})]:[]}));
  const hubDocument={documentElement:{dataset},body:{get innerText(){return 'Company Code: '+f.company.code;}},
    querySelectorAll:selector=>{
      if(selector==='.rsc-text-input input')return productInput.value||hubLocation.pathname!=='/dashboard/KR'?[productInput]:[];
      if(selector==='.btn-outline-secondary')return [modalButton];if(selector==='.modal-title')return f.modal?[element({innerText:'중간 저장 불러오기'})]:[];
      if(selector==='.sr-contents__table-draft tbody > tr')return rows();
      if(selector==='input[type="checkbox"]')return hubLocation.pathname.endsWith('/logisticsPage')?checkboxes:[];
      if(selector==='button[type="submit"]')return [advance];if(selector==='button')return [];return [];
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
  const hubFetch=async(url,init)=>{
    calls.push({name:'hub-fetch',url,init:{...init,signal:undefined}});f.hubReads++;if(options.beforeHubFetch)await options.beforeHubFetch(url,init,f);
    if(url.endsWith('/drafts'))return response(url,[...documents.values()].map(doc=>f.fullDocuments?clone(doc):{docId:doc.docId,productName:doc.productName}));
    const body=JSON.parse(init.body);
    if(url.endsWith('/create')){const docId='created-'+company.code;documents.set(docId,{...body,docId});return response(url,{docId},options.createStatus??200);}
    if(url.endsWith('/update')){documents.set(body.docId,body);return response(url,{},options.updateStatus??200);}
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
      for(const key of Object.keys(dataset))delete dataset[key];productInput.value='';f.modal=false;f.loaded=null;return clone(hubTab);},
    sendMessage:async(id,message,frame)=>{
      calls.push({name:'app-message',id,message,frame});if(id!==appTab.id||frame.frameId!==0)throw Error('wrong original app frame');
      if(message.type==='YOOFAM_VERIFY_SINGLE_DOCUMENT_SOURCE')return {ok:true,current:true,submissionReady:true,priorDocumentClear:true,identity:clone(message.expected.identity),bodySha256:message.expected.bodySha256,sessionId:f.sessionId,checkedAt:Date.now(),...options.bridge};
      if(message.type==='YOOFAM_CONFIRM_SINGLE_DOCUMENT_ACTION')return {ok:options.human!==false,userInitiated:true,challengeId:message.expected.challenge.id,identityDigest:context.identityDigest,checkedAt:Date.now()};
      throw Error('unknown message');
    },
  },scripting:{executeScript:async request=>{
    calls.push({name:'execute',func:request.func.name,target:clone(request.target)});
    const target=request.target.tabId===appTab.id?appContext:hubContext;target.args=clone(request.args??[]);
    const value=await vm.runInContext('('+request.func.toString()+')(...args)',target);
    if(options.loseExecuteAck===request.func.name&&request.args?.[0]?.path===options.losePath)throw Error('Synthetic Chrome executeScript ACK lost');
    return [{frameId:options.frameId??0,result:value===undefined?undefined:jsonCopy(value)}];
  }}};
  f.api=api;f.adapter=createSingleDocumentBrowserAdapter({api});f.receiver=createSingleDocumentReceiver({adapter:f.adapter,store:storage.store});
  f.action=started=>({action:'confirm-and-submit',userInitiated:true,challengeId:started.challenge.id,confirmedAt:Date.now(),approvedKeys:started.challenge.items.filter(item=>item.required).map(item=>item.key)});
  f.close=()=>storage.db.close();return f;
}
