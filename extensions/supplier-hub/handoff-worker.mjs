import {validateHandoff,pendingPackage} from './handoff-store.mjs';
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type!=='YOOFAM_PREPARE_PACKAGE')return;
  (async()=>{try{
    const value=validateHandoff(message,sender);await pendingPackage('put',value);
    respond({ok:true,fingerprint:value.fingerprint,registered:false});
  }catch(error){respond({ok:false,error:error.message});}})();
  return true;
});
