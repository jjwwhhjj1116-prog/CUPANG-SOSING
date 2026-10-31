import {PRODUCT_DOCUMENT_PREVIEW_ACK_TIMEOUT} from './product-document.mjs';

const PULSE_MS=25000;
// These are the existing app ACK budgets, not additional operation time.
const budgets=Object.freeze({preview:PRODUCT_DOCUMENT_PREVIEW_ACK_TIMEOUT,
  recoverSavedDraftTarget:180000,auditUnexpectedLegal:180000,
  validateSavedDocumentSteps:300000,retrySavedDocumentStep:300000});

/** Keep only an explicit, bounded document read/validation operation alive.
 * Chrome's trivial local API pulse grants no access and sends no document data.
 * Ending the pulse never settles, repeats or changes the underlying operation. */
export async function withProductDocumentReadLifetime(action,operation,runtime){
  const budget=Object.hasOwn(budgets,action)?budgets[action]:undefined;
  if(!budget||typeof runtime?.getPlatformInfo!=='function')return operation();
  let active=true,pending=false,interval,limit;
  const expiresAt=Date.now()+budget;
  const stop=()=>{active=false;clearInterval(interval);clearTimeout(limit);};
  const pulse=()=>{
    if(!active)return;
    if(Date.now()>=expiresAt){stop();return;}
    if(pending)return;
    pending=true;
    try{Promise.resolve(runtime.getPlatformInfo()).then(()=>{pending=false;},()=>{pending=false;});}
    catch{pending=false;}
  };
  try{
    interval=setInterval(pulse,PULSE_MS);
    limit=setTimeout(stop,budget);
    return await operation();
  }finally{stop();}
}
