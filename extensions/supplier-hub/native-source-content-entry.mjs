import {nativeProductDocumentAppSourcePage} from './native-product-assets.mjs';
import {singleDocumentAppSourcePage} from './single-document-adapter.mjs';
import {normalizeSourceReadFailure} from './product-document-source.mjs';

// Manifest-installed isolated content code already has access to its own app
// origin. An app button does not grant activeTab for scripting.executeScript.
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender?.id!==chrome.runtime.id||!['YOOFAM_READ_NATIVE_PRODUCT_DOCUMENT_SOURCE','YOOFAM_READ_LEGACY_PRODUCT_DOCUMENT_SOURCE'].includes(message?.type))return;
 const read=message.type==='YOOFAM_READ_NATIVE_PRODUCT_DOCUMENT_SOURCE'?nativeProductDocumentAppSourcePage:input=>singleDocumentAppSourcePage(input,true);
 Promise.resolve().then(()=>read(message.expected)).then(result=>respond({ok:true,result}),error=>respond({ok:false,sourceFailure:normalizeSourceReadFailure(error?.sourceFailure)??{code:'SOURCE_CHANGED'}}));
 return true;
});
