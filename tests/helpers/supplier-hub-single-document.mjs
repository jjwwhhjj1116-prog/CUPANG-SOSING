import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createSingleDocumentReceiver,singleDocumentIdentity,SINGLE_DOCUMENT_FORMAT,SINGLE_DOCUMENT_ORIGIN} from '../../extensions/supplier-hub/single-document.mjs';

export const SINGLE_COMPANIES=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
export const SINGLE_SENDER={url:'https://sourceflow.jjwwhhjj1116.workers.dev/',frameId:0,tab:{id:17,windowId:29}};
export const clone=value=>structuredClone(value);
export function singlePacket(company=SINGLE_COMPANIES[0]){
  const productName=company.name+' 합성 견적 옵션',categoryPath='스포츠>보호대 (81452)';
  return {type:'YOOFAM_SINGLE_DOCUMENT_TRANSPORT',format:SINGLE_DOCUMENT_FORMAT,requestId:'request-one',ownerId:company.code==='A01526306'?'owner-unand':'owner-waihop',accountContext:'a'.repeat(64),company:clone(company),
    productId:'synthetic-product',profileId:'synthetic-profile',optionId:'synthetic-option',categoryId:'81452',fingerprint:'b'.repeat(64),schemaSha256:'c'.repeat(64),
    source:{productVersion:'2026-10-14T01:00:00.000Z',contentRevision:3,optionRevision:4,quotationRevision:5,profileRevision:2},
    body:{docId:null,productName,categoryPath,categoryId:1234,displayCategoryCode:'81452',scope:'Retail_Categorized_Single',productNoticeNumber:12,version:7,
      jsonDocument:[{startPage:{productName,categoryPath},productPage:{supplyPrice:4280,normalPrice:7130,color:'검정 단층'},
        imagePage:{msrpAgree:true,labelContactAgreed:true,images:{mainImage:'https://image.example.test/main.jpg',additionalImage:'https://image.example.test/a.jpg,https://image.example.test/b.jpg',labelImages:[{type:'PRODUCT_INFORMATION',image:'https://image.example.test/label.jpg'}]},details:{detailedImage:'https://image.example.test/detail.jpg'}},
        legalPage:{country:'CN'},logisticsPage:{quantityPerBox:50},sourcingPage:{sourcingChannelType:null,sourcingChannelId:null}}]}};
}
export function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

// The fixture exercises durable transactions rather than a mirrored state
// machine. Only new in-memory synthetic checkpoint rows exist in this DB.
export function sqliteSingleStore(){
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE operations (key TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE lanes (key TEXT PRIMARY KEY,operation_key TEXT NOT NULL)');
  const changes=[];
  const getSync=key=>{const row=db.prepare('SELECT payload FROM operations WHERE key=?').get(key);return row?JSON.parse(row.payload):undefined;};
  const store={
    get:async key=>getSync(key),
    claim:async(key,next)=>{
      db.exec('BEGIN IMMEDIATE');
      try{
        if(getSync(key)){db.exec('ROLLBACK');return false;}
        const lane=db.prepare('SELECT operation_key FROM lanes WHERE key=?').get(next.laneKey);
        if(lane&&!['validation-rejected','rejected'].includes(getSync(lane.operation_key)?.state)){db.exec('ROLLBACK');return false;}
        db.prepare('INSERT INTO operations VALUES (?,?)').run(key,JSON.stringify(next));
        db.prepare('INSERT INTO lanes VALUES (?,?) ON CONFLICT(key) DO UPDATE SET operation_key=excluded.operation_key').run(next.laneKey,key);
        db.exec('COMMIT');changes.push(['claim',key,next.state]);return true;
      }catch(error){db.exec('ROLLBACK');throw error;}
    },
    compareAndSet:async(key,expected,next)=>{
      const result=db.prepare('UPDATE operations SET payload=? WHERE key=? AND payload=?').run(JSON.stringify(next),key,JSON.stringify(expected));
      if(result.changes===1)changes.push(['cas',key,next.state]);return result.changes===1;
    },
  };
  return {db,store,changes,get:getSync,force:(key,value)=>db.prepare('UPDATE operations SET payload=? WHERE key=?').run(JSON.stringify(value),key)};
}

export async function singleDocumentFixture(company=SINGLE_COMPANIES[0],options={}){
  const packet=singlePacket(company),sender=clone(SINGLE_SENDER),context=await singleDocumentIdentity(packet,sender),storage=options.storage??sqliteSingleStore(),calls=[];
  const tab={tabId:71,windowId:sender.tab.windowId,origin:SINGLE_DOCUMENT_ORIGIN,authenticated:true,company:clone(company)};
  const protectedBody={docId:'protected-existing',productName:'보호된 기존 작업',jsonDocument:[{productPage:{price:12345}}]},documents=new Map([[protectedBody.docId,clone(protectedBody)]]);
  const operations=new Map(),items=options.stageFlow&&options.finalNoItems?[]:[
    {key:'priceData',id:'msrpAgree',text:'합성 가격 정보 약관 확인',required:true,checked:false,enabled:true},
    {key:'labelBusinessContact',id:'agreeLabelContact',text:'합성 업무용 라벨 연락처 공개 동의',required:true,checked:false,enabled:true},
  ];
  const f={packet,sender,context,storage,calls,tab,documents,operations,items,now:1_800_000_000_000,sessionId:'session-one',current:true,ready:true,priorDocumentClear:true,submitted:0,sourceReads:0,
    sourceSnapshot:clone(packet),protectedSnapshot:clone(protectedBody),createCount:0,updateCount:0};
  const stageItems={
    productPage:[{key:'msrpAgree',id:'agreeMSRPTerm',text:'합성 가격 정보 이용약관에 동의합니다.',required:true,checked:false,enabled:true,title:'합성 MSRP, OSRP 이용약관',termsText:'합성 약관 1. 공급자가 제공한 가격 정보의 권한을 확인합니다.\n합성 약관 2. 견적서의 현재 가격 정보를 확인합니다.\n합성 약관 3. 해당 정보 이용에 동의합니다.'}],
    imagePage:[{key:'labelContactAgreed',id:'agreeLabelContact',text:'합성 라벨의 공식 업무용 연락처 제공 및 공개에 동의합니다.',required:true,checked:false,enabled:true,title:'합성 상품 라벨 연락처 제공 및 공개 동의',termsText:'합성 약관 1. 개인 연락처를 제외합니다.\n합성 약관 2. 공식 업무용 연락처임을 확인합니다.\n합성 약관 3. 공개에 동의합니다.\n합성 약관 4. 현재 표시사항을 확인합니다.'}],
  };
  f.stageItems=stageItems;f.stageIndex=0;f.stageAcceptCounts={productPage:0,imagePage:0};f.stageReceipts=new Map();f.stageWrites=[];
  const stages=['productPage','imagePage','logisticsPage'];
  const record=async(name,input)=>{calls.push({name,input:clone(input)});await options.before?.(name,input,f);};
  const proofFor=docId=>({docId,company:clone(company),identityDigest:context.identityDigest,body:clone(documents.get(docId))});
  const adapter={
    readSource:async input=>{await record('readSource',input);f.sourceReads++;return {current:f.current,submissionReady:f.ready,priorDocumentClear:f.priorDocumentClear,identity:clone(context.identity),bodySha256:context.originalBodySha256,sessionId:f.sessionId,...options.sourceProof};},
    selectTab:async input=>{await record('selectTab',input);return clone(options.selectedTab??tab);},
    readTab:async input=>{await record('readTab',input);return clone(tab);},
    hubRequest:async input=>{
      await record('hubRequest',input);assert.equal(input.tab.tabId,tab.tabId);assert.equal(input.tab.origin,SINGLE_DOCUMENT_ORIGIN);
      const checkpoint=storage.get(context.key);
      if(input.method==='GET'){assert.equal(input.path,'/sr/draft/api/drafts');assert.equal(Object.hasOwn(input,'body'),false);return {ok:true,status:200,json:[...documents.keys()].map(docId=>({docId}))};}
      if(input.path==='/sr/draft/api/create'){
        assert.equal(checkpoint.state,'create-requested');assert.equal(checkpoint.operationId,input.operationId);f.createCount++;
        assert.equal(input.body.docId,null);assert.equal(input.body.jsonDocument.length,1);
        assert.equal(input.body.jsonDocument[0].imagePage.msrpAgree,false);assert.equal(input.body.jsonDocument[0].imagePage.labelContactAgreed,false);
        if(options.createNoCommit)throw Error('synthetic create response lost before commit');
        const docId=options.createdDocId??'created-'+company.code;
        const body={...clone(input.body),docId};documents.set(docId,body);operations.set(input.operationId,{docId,body:clone(body)});
        if(options.createWait)await options.createWait.promise;
        if(options.createLost)throw Error('synthetic create ACK lost after commit');
        return options.createResponse??{ok:true,status:200,json:{docId}};
      }
      if(input.path==='/sr/draft/api/update'){
        assert.equal(checkpoint.state,'update-requested');assert.equal(checkpoint.operationId,input.operationId);f.updateCount++;
        assert.equal(input.body.docId,'created-'+company.code);assert.ok(documents.has(input.body.docId));
        documents.set(input.body.docId,clone(input.body));operations.set(input.operationId,{docId:input.body.docId,body:clone(input.body)});
        if(options.updateLost)throw Error('synthetic update ACK lost after commit');
        return options.updateResponse??{ok:true,status:200,json:{}};
      }
      const step=Number(input.path.split('/').at(-1));assert.deepEqual(input.body,{docId:'created-'+company.code,version:packet.body.version});
      assert.equal(checkpoint.state,'validation-requested');assert.equal(checkpoint.requestedStep,step);
      if(options.validationLost===step)throw Error('synthetic validation ACK lost');
      return {ok:true,status:200,json:options.validationResponse?options.validationResponse(step):{code:200,data:[{success:true,errors:[]}]}};
    },
    readDocument:async input=>{await record('readDocument',input);return options.readback?.(input,f)??proofFor(input.docId);},
    recoverWrite:async input=>{await record('recoverWrite',input);const operation=operations.get(input.operationId);if(!operation||options.recoveryMissing)return null;return {readOnly:true,operationId:input.operationId,...proofFor(operation.docId),...options.recoveryProof};},
    readValidation:async input=>{await record('readValidation',input);return {readOnly:true,operationId:input.operationId,docId:input.docId,company:clone(company),step:input.step,response:{code:200,data:[{success:true}]},...options.validationRecovery};},
    navigate:async input=>{
      await record('navigate',input);assert.equal(input.docId,'created-'+company.code);
      if(options.stageFlow){
        while(f.stageIndex<2&&stageItems[stages[f.stageIndex]].every(item=>!item.required||item.checked)){
          const stage=stages[f.stageIndex],key=stageItems[stage][0].key,body=documents.get(input.docId);body.jsonDocument[0].imagePage[key]=true;f.stageWrites.push({stage,key,docId:input.docId});f.stageIndex++;
        }
        if(f.stageIndex<2)return {docId:input.docId,company:clone(company),productName:packet.body.productName,stage:stages[f.stageIndex],readyForConsent:true,readyForSubmit:false,...options.navigation};
      }
      return {docId:input.docId,company:clone(company),productName:packet.body.productName,readyForSubmit:true,...(options.stageFlow?{stage:'logisticsPage'}:{}),...options.navigation};
    },
    readAgreements:async input=>{await record('readAgreements',input);return {docId:input.docId,company:clone(tab.company),readyForSubmit:true,items:clone(items),...(options.stageFlow?{stage:'logisticsPage'}:{}),...options.agreementReview};},
    verifyHumanConfirmation:async input=>{await record('verifyHumanConfirmation',input);return {confirmed:options.humanConfirmed!==false,challengeId:input.challenge.id,identityDigest:context.identityDigest};},
    confirmAgreements:async input=>{await record('confirmAgreements',input);assert.equal(storage.get(context.key).state,'consent-requested');for(const item of items)if(input.confirmation.approvedKeys.includes(item.key))item.checked=true;return {docId:input.docId,company:clone(company),readyForSubmit:true,items:clone(items)};},
    submit:async input=>{await record('submit',input);assert.equal(storage.get(context.key).state,'submit-requested');assert.ok(items.every(item=>!item.required||item.checked));if(options.stageFlow)assert.ok(Object.values(stageItems).every(stage=>stage.every(item=>item.checked)));f.submitted++;if(options.submitLost)throw Error('synthetic submit ACK lost');return {dispatched:true};},
    observeReceipt:async input=>{await record('observeReceipt',input);assert.equal(f.submitted,1);const receipt={state:'registered',docId:input.docId,company:clone(company),identityDigest:context.identityDigest,
      receiptId:'receipt-'+company.code,skuId:'sku-'+company.code,preparedBodySha256:context.bodySha256,observedAt:f.now,evidence:'document-and-sku',...options.receipt};
      for(const key of Object.keys(receipt))if(receipt[key]===undefined)delete receipt[key];return receipt;},
  };
  if(options.stageFlow){
    const stageReview=input=>({docId:input.docId,company:clone(company),stage:stages[f.stageIndex],readyForConsent:true,items:clone(stageItems[stages[f.stageIndex]]??[])});
    adapter.readStageAgreements=async input=>{await record('readStageAgreements',input);const review=stageReview(input);return options.stageAgreementReview?options.stageAgreementReview(review,f):review;};
    adapter.confirmStageAgreements=async input=>{
      await record('confirmStageAgreements',input);const checkpoint=storage.get(context.key);assert.equal(checkpoint.state,'stage-consent-requested');assert.equal(input.operationId,checkpoint.operationId);
      const stage=stages[f.stageIndex];assert.equal(input.stage,stage);if(options.stageConsentNoCommit===stage)throw Error('synthetic stage consent ACK lost before checkbox acceptance');
      for(const item of stageItems[stage])if(input.confirmation.approvedKeys.includes(item.key))item.checked=true;
      f.stageAcceptCounts[stage]++;const review=stageReview(input);f.stageReceipts.set(input.operationId,{readOnly:true,operationId:input.operationId,...clone(review)});
      if(options.stageConsentLost===stage)throw Error('synthetic stage consent ACK lost after checkbox acceptance');return review;
    };
    adapter.recoverStageConsent=async input=>{
      await record('recoverStageConsent',input);const receipt=f.stageReceipts.get(input.operationId);return receipt?{...clone(receipt),...options.stageRecoveryProof}:null;
    };
  }
  f.adapter=adapter;f.receiver=createSingleDocumentReceiver({adapter,store:storage.store,now:()=>f.now});
  f.action=result=>({action:['productPage','imagePage'].includes(result.challenge.stage)?'confirm-and-continue':'confirm-and-submit',...(result.challenge.stage?{stage:result.challenge.stage}:{}),userInitiated:true,challengeId:result.challenge.id,confirmedAt:f.now,approvedKeys:result.challenge.items.filter(item=>item.required).map(item=>item.key)});
  f.assertPreserved=()=>{assert.deepEqual(packet,f.sourceSnapshot);assert.deepEqual(documents.get(protectedBody.docId),f.protectedSnapshot);};
  f.close=()=>storage.db.close();return f;
}
