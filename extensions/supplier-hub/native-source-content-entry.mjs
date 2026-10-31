import {nativeProductDocumentAppSourcePage} from './native-product-assets.mjs';
import {singleDocumentAppSourcePage} from './single-document-adapter.mjs';
import {normalizeSourceReadFailure} from './product-document-source.mjs';
import {unexpectedLegalAuditSchemaPage} from './unexpected-legal-audit.mjs';

// Manifest-installed isolated content code already has access to its own app
// origin. An app button does not grant activeTab for scripting.executeScript.
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender?.id!==chrome.runtime.id||!['YOOFAM_READ_NATIVE_PRODUCT_DOCUMENT_SOURCE','YOOFAM_READ_LEGACY_PRODUCT_DOCUMENT_SOURCE','YOOFAM_READ_UNEXPECTED_LEGAL_AUDIT_SCHEMA'].includes(message?.type))return;
 if(message.type==='YOOFAM_READ_UNEXPECTED_LEGAL_AUDIT_SCHEMA'&&(Object.keys(message).sort().join(',')!=='expected,type'||!message.expected||typeof message.expected!=='object'||Array.isArray(message.expected)
  ||Object.keys(message.expected).sort().join(',')!=='expectedBody,identity')){respond({ok:false,sourceFailure:{code:'SOURCE_CHANGED'}});return;}
 const read=message.type==='YOOFAM_READ_NATIVE_PRODUCT_DOCUMENT_SOURCE'?nativeProductDocumentAppSourcePage:message.type==='YOOFAM_READ_UNEXPECTED_LEGAL_AUDIT_SCHEMA'?unexpectedLegalAuditSchemaPage:input=>singleDocumentAppSourcePage(input,true);
 Promise.resolve().then(()=>read(message.expected)).then(result=>respond({ok:true,result}),error=>respond({ok:false,sourceFailure:normalizeSourceReadFailure(error?.sourceFailure)??{code:'SOURCE_CHANGED'}}));
 return true;
});
