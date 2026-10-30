import './sales-worker.mjs';
import {readAppSupplierHubCategoryRecommendations} from './category-predict.mjs';
import {dispatchSupplierHubValidation} from './validation-dispatch.mjs';
import {observeSupplierHubResult} from './observe.mjs';
import {validateHandoff,pendingPackage,resultKey,transferRecord} from './handoff-store.mjs';
import {dispatchPendingPackage} from './dispatch.mjs';
import {capture1688Product,probe1688Product,cancel1688Capture} from './capture-1688.mjs';
import {transmitSupplierHubPackage} from './transmit.mjs';
import {resumeSupplierHubValidation} from './validation-resume.mjs';
import {validateAppHubRequest} from './app-request.mjs';
import {refreshSupplierHubRegistration} from './app-registration.mjs';
import {readAppSupplierHubCatalog} from './catalog.mjs';
import {readOwnedProductTransferHistory} from './product-history.mjs';
import {readAppCompanyRegistrations} from './company-registration.mjs';
import {readAppNativeRegistrations} from './native-registration.mjs';
import {dispatchSingleDocument} from './single-dispatch.mjs';
import {dispatchProductDocument} from './product-document-dispatch.mjs';
import {savePageSource,flushPageSources} from './source-inbox.mjs';
import {dispatchListingBatch,authenticateListingBulkPage,saveListingBulkPage} from './listing-batch.mjs';
import {readPageDescription} from './page-description.mjs';
import {readProductSourceSession} from './product-source-session.mjs';
import {inspectPreservedProductDocument} from './preserved-product-checkpoint.mjs';
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(['YOOFAM_LISTING_BATCH_START','YOOFAM_LISTING_BATCH_STATUS','YOOFAM_LISTING_BATCH_CANCEL','YOOFAM_LISTING_BATCH_RESUME'].includes(message?.type)){
    dispatchListingBatch(message,sender).then(respond,error=>respond({ok:false,error:error.message,code:error.code??'LISTING_BATCH_FAILED'}));return true;
  }
  if(message?.type==='YOOFAM_VALIDATE_BULK_PAGE'){
    authenticateListingBulkPage(message,sender).then(respond,error=>respond({ok:false,error:error.message,code:error.code??'LISTING_BULK_REJECTED'}));return true;
  }
  if(message?.type==='YOOFAM_SAVE_PAGE_SOURCE'&&message.bulk!==undefined){
    saveListingBulkPage(message,sender).then(respond,error=>respond({ok:false,error:error.message,code:error.code??'LISTING_BULK_SAVE_REJECTED'}));return true;
  }
  if(message?.type==='YOOFAM_INSPECT_PRESERVED_PRODUCT_DOCUMENT'){
    inspectPreservedProductDocument(message,sender).then(result=>respond({ok:true,result}),error=>respond({ok:false,error:error?.code?error.message:'보관된 요청을 읽지 못했습니다. 기존 기록은 변경하지 않았습니다.',code:error?.code??'PRESERVED_INSPECTION_FAILED'}));return true;
  }
  if(message?.type==='YOOFAM_READ_PRODUCT_SOURCE_SESSION'){
    readProductSourceSession(message,sender).then(result=>respond({ok:true,...result}),()=>respond({ok:false,error:'원래 전송 요청의 연결 기록을 확인하지 못했습니다.'}));return true;
  }
  if(message?.type==='YOOFAM_READ_PAGE_DESCRIPTION'){
    readPageDescription(message,sender).then(respond,()=>respond({ok:true,available:false,detailImages:[],reason:'read-unavailable'}));return true;
  }
  if(message?.type==='YOOFAM_QUERY_NATIVE_REGISTRATIONS'){
    readAppNativeRegistrations(message,sender).then(observation=>respond({ok:true,observation}),error=>respond({ok:false,error:error.message}));return true;
  }
  if(message?.type==='YOOFAM_RECOMMEND_CATEGORIES'){
    readAppSupplierHubCategoryRecommendations(message,sender).then(recommendations=>respond({ok:true,recommendations}),error=>respond({ok:false,error:error.message}));return true;
  }
  if(['YOOFAM_SAVE_PAGE_SOURCE','YOOFAM_FLUSH_PAGE_SOURCES'].includes(message?.type)){
    const run=message.type==='YOOFAM_SAVE_PAGE_SOURCE'?savePageSource:flushPageSources;
    run(message,sender).then(respond,error=>respond({ok:false,error:error.message}));return true;
  }
  if(message?.type==='YOOFAM_PRODUCT_DOCUMENT_REQUEST'){
    dispatchProductDocument(message,sender).then(result=>respond({ok:true,result}),error=>respond({ok:false,error:error.message,code:error.code}));return true;
  }
  if(message?.type==='YOOFAM_SINGLE_DOCUMENT_REQUEST'){
    dispatchSingleDocument(message,sender).then(result=>respond({ok:true,result}),error=>respond({ok:false,error:error.message,code:error.code}));return true;
  }
  if(!['YOOFAM_PREPARE_PACKAGE','YOOFAM_GET_RESULT','YOOFAM_GET_PRODUCT_TRANSMISSIONS','YOOFAM_QUERY_COMPANY_REGISTRATIONS','YOOFAM_DISPATCH_PACKAGE','YOOFAM_OBSERVE_RESULT','YOOFAM_VALIDATE_PACKAGE','YOOFAM_PROBE_1688','YOOFAM_CAPTURE_1688','YOOFAM_CANCEL_1688','YOOFAM_TRANSMIT_PACKAGE','YOOFAM_RESUME_VALIDATION','YOOFAM_REFRESH_RESULT','YOOFAM_REFRESH_REGISTRATION','YOOFAM_READ_CATEGORY_BRANCH','YOOFAM_READ_CATEGORY_SCHEMA','YOOFAM_READ_CATEGORY_TEMPLATE'].includes(message?.type))return;
  (async()=>{try{
    if(message.type==='YOOFAM_QUERY_COMPANY_REGISTRATIONS'){const observation=await readAppCompanyRegistrations(message,sender);respond({ok:true,observation});return;}
    if(message.type==='YOOFAM_GET_PRODUCT_TRANSMISSIONS'){
      const identity=validateAppHubRequest(message,sender,'YOOFAM_GET_PRODUCT_TRANSMISSIONS');
      const records=await readOwnedProductTransferHistory(identity,{appTabId:sender.tab.id,windowId:sender.tab.windowId});respond({ok:true,productId:identity.productId,records});return;
    }
    if(['YOOFAM_READ_CATEGORY_BRANCH','YOOFAM_READ_CATEGORY_SCHEMA','YOOFAM_READ_CATEGORY_TEMPLATE'].includes(message.type)){
      const branch=await readAppSupplierHubCatalog(message,sender);respond({ok:true,branch});return;
    }
    if(message.type==='YOOFAM_CANCEL_1688'){
      respond(cancel1688Capture(message,sender));return;
    }
    if(message.type==='YOOFAM_REFRESH_REGISTRATION'){
      const record=await refreshSupplierHubRegistration(message,sender);
      respond({ok:true,fingerprint:message.fingerprint,record,registered:false});return;
    }
    if(message.type==='YOOFAM_TRANSMIT_PACKAGE'){
      let result;
      try{result=await transmitSupplierHubPackage(message,sender);}
      catch(error){
        const identity=validateAppHubRequest(message,sender,'YOOFAM_TRANSMIT_PACKAGE');
        const attempt=await transferRecord('get',`transmission:${identity.origin}:${identity.productId}:${identity.categoryId}:${identity.fingerprint}`);
        if(attempt||await transferRecord('get',resultKey(identity))
          ||['SUPPLIER_HUB_RECEIPT_UNCONFIRMED','SUPPLIER_HUB_ALREADY_SUBMITTED'].includes(error.code))throw error;
        // A restored receipt also proves a prior upload; never treat it as a fresh retry.
        result={state:'not-started',registered:false,error:error.message};
      }
      respond({ok:true,fingerprint:message.fingerprint,result,registered:false});return;
    }
    if(message.type==='YOOFAM_REFRESH_RESULT'){
      // Result lookup remains independent of validation resumption.
      const identity=validateAppHubRequest(message,sender,'YOOFAM_REFRESH_RESULT');
      await observeSupplierHubResult({...message,kind:'validation'},sender);
      const record=await transferRecord('get',resultKey(identity));
      respond({ok:true,fingerprint:identity.fingerprint,record:record||null,registered:false});return;
    }
    if(message.type==='YOOFAM_RESUME_VALIDATION'){
      const result=await resumeSupplierHubValidation(message,sender);
      respond({ok:true,fingerprint:message.fingerprint,result,registered:false});return;
    }
    if(message.type==='YOOFAM_CAPTURE_1688'){
      respond(await capture1688Product(message,sender));return;
    }
    if(message.type==='YOOFAM_PROBE_1688'){
      respond(await probe1688Product(message,sender));return;
    }
    if(message.type==='YOOFAM_VALIDATE_PACKAGE'){
      const result=await dispatchSupplierHubValidation(message,sender);respond({ok:true,result});return;
    }
    if(message.type==='YOOFAM_OBSERVE_RESULT'){
      const result=await observeSupplierHubResult(message,sender);respond({ok:true,result});return;
    }
    if(message.type==='YOOFAM_DISPATCH_PACKAGE'){
      const result=await dispatchPendingPackage(message,sender);respond({ok:true,result});return;
    }
    if(message.type==='YOOFAM_GET_RESULT'){
      const identity=validateAppHubRequest(message,sender,'YOOFAM_GET_RESULT');
      const record=await transferRecord('get',resultKey(identity));
      const attempt=await transferRecord('get',`transmission:${identity.origin}:${identity.productId}:${identity.categoryId}:${identity.fingerprint}`);
      respond({ok:true,fingerprint:identity.fingerprint,record:record||null,attempt:attempt||null,registered:false});return;
    }
    const value=validateHandoff(message,sender);await pendingPackage('put',value);
    respond({ok:true,fingerprint:value.fingerprint,registered:false});
  }catch(error){respond({ok:false,error:error.message});}})();
  return true;
});
