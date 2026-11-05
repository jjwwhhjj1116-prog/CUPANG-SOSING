import {validateNativeDraftDetailAmendmentRequest,amendmentFail as fail} from './native-draft-detail-amendment.mjs';
import {createNativeDraftDetailAmendmentReceiver} from './native-draft-detail-amendment-receiver.mjs';
import {createNativeDraftDetailAmendmentStore} from './native-draft-detail-amendment-store.mjs';
import {createNativeDraftDetailAmendmentBrowserAdapter} from './native-draft-detail-amendment-adapter.mjs';
import {createProductDocumentStore,productDocumentIdentity} from './product-document-receiver.mjs';
import {activeDocumentKeys} from './product-document-dispatch.mjs';

export async function dispatchNativeDraftDetailAmendment(message,sender){
 if(message?.type!=='YOOFAM_PRODUCT_DOCUMENT_DETAIL_AMENDMENT_REQUEST')fail('DRAFT_DETAIL_AMENDMENT_INPUT');
 const {type:omitted,...input}=message;void omitted;const request=validateNativeDraftDetailAmendmentRequest(input),parentStore=createProductDocumentStore(),store=createNativeDraftDetailAmendmentStore();
 const key=request.anchor||request.lookup?'product-document:'+(request.anchor??request.lookup).parentPacketDigest:(await productDocumentIdentity(request.packet,sender,{allowExpired:true})).key;
 if(activeDocumentKeys.has(key))fail('DRAFT_DETAIL_AMENDMENT_BUSY','같은 문서의 현재 작업 결과를 먼저 확인해주세요.');
 activeDocumentKeys.add(key);const adapter=createNativeDraftDetailAmendmentBrowserAdapter({parentStore,activeKeys:activeDocumentKeys});
 try{return await createNativeDraftDetailAmendmentReceiver({store,adapter}).run(request,sender);}finally{adapter.dispose();activeDocumentKeys.delete(key);}
}
