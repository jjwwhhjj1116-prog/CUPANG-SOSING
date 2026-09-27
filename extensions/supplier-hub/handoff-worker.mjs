import {validateHandoff,pendingPackage,validateResultRequest,resultKey,transferRecord} from './handoff-store.mjs';
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!['YOOFAM_PREPARE_PACKAGE','YOOFAM_GET_RESULT'].includes(message?.type))return;
  (async()=>{try{
    if(message.type==='YOOFAM_GET_RESULT'){
      const identity=validateResultRequest(message,sender);
      const record=await transferRecord('get',resultKey(identity));
      respond({ok:true,fingerprint:identity.fingerprint,record:record||null,registered:false});return;
    }
    const value=validateHandoff(message,sender);await pendingPackage('put',value);
    respond({ok:true,fingerprint:value.fingerprint,registered:false});
  }catch(error){respond({ok:false,error:error.message});}})();
  return true;
});
