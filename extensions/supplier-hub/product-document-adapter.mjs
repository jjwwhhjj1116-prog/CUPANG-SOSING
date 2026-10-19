import {createSupplierHubDocumentBrowserAdapter} from './single-document-adapter.mjs';

/** Same owned-tab adapter and native operations, with a trusted full-product
 * source verifier. Packet fields cannot select a looser adapter contract. */
export function createProductDocumentBrowserAdapter(options={}){
  return createSupplierHubDocumentBrowserAdapter(options,{wholeProduct:true});
}
