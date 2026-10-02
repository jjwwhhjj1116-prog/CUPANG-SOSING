import {dispatchSupplierHubValidation} from './validation-dispatch.mjs';
import {observeSupplierHubResult} from './observe.mjs';
import {validateHandoff,pendingPackage,resultKey,transferRecord} from './handoff-store.mjs';
import {dispatchPendingPackage} from './dispatch.mjs';
import {capture1688Product,cancel1688Capture} from './capture-1688.mjs';
import {transmitSupplierHubPackage} from './transmit.mjs';
import {validateAppHubRequest} from './app-request.mjs';
import {refreshSupplierHubRegistration} from './app-registration.mjs';
import {readAppSupplierHubCatalog} from './catalog.mjs';
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!['YOOFAM_PREPARE_PACKAGE','YOOFAM_GET_RESULT','YOOFAM_DISPATCH_PACKAGE','YOOFAM_OBSERVE_RESULT','YOOFAM_VALIDATE_PACKAGE','YOOFAM_CAPTURE_1688','YOOFAM_CANCEL_1688','YOOFAM_TRANSMIT_PACKAGE','YOOFAM_REFRESH_RESULT','YOOFAM_REFRESH_REGISTRATION','YOOFAM_READ_CATEGORY_BRANCH','YOOFAM_READ_CATEGORY_SCHEMA','YOOFAM_READ_CATEGORY_TEMPLATE'].includes(message?.type))return;
  (async()=>{try{
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
      const identity=validateAppHubRequest(message,sender,'YOOFAM_REFRESH_RESULT');
      await observeSupplierHubResult({...message,kind:'validation'},sender);
      const record=await transferRecord('get',resultKey(identity));
      respond({ok:true,fingerprint:identity.fingerprint,record:record||null,registered:false});return;
    }
    if(message.type==='YOOFAM_CAPTURE_1688'){
      respond(await capture1688Product(message,sender));return;
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
