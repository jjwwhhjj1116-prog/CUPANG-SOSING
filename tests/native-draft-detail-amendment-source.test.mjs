import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {nativeReviewFixture,plain} from './helpers/native-source-review.mjs';
import {nativeProductDocumentAppSourcePage} from '../extensions/supplier-hub/native-product-assets.mjs';
import {createProductDocumentPacket} from '../extensions/supplier-hub/product-document.mjs';
import {productDocumentIdentity} from '../extensions/supplier-hub/product-document-receiver.mjs';

test('amendment source captures settings and full quotation view with repeated source/scope fences',async()=>{
 const f=await nativeReviewFixture();try{
  const review=await f.model.reviewCurrentNativeSupplierHubProductDocument({...f.input,signal:new AbortController().signal,fetcher:f.request}),packet=await createProductDocumentPacket(plain(review));
  const context=await productDocumentIdentity(packet,{url:'http://localhost:3000/',frameId:0,tab:{id:71,windowId:5}}),reads=[];let changed=false;
  const fetcher=async(url,init)=>{const parsed=new URL(url);reads.push(parsed.pathname);let response;
   if(parsed.pathname==='/api/settings')response=Response.json({settings:{brand:changed?'변경':'원래'},scope:{ownerId:'owner',company:context.identity.company}});
   else if(parsed.pathname.endsWith('/catalog-context'))response=Response.json({ownerId:'owner',company:context.identity.company});
   else if(parsed.pathname.endsWith('/quotation-fields'))response=await f.h.route(parsed.pathname+parsed.search);
   else response=await f.request(parsed.pathname+parsed.search,init);
   Object.defineProperty(response,'url',{value:url});return response;
  };
  const run=()=>vm.runInNewContext('('+nativeProductDocumentAppSourcePage.toString()+')('+JSON.stringify({identity:context.identity,bodySha256:context.originalBodySha256,preparedBodySha256:context.bodySha256,action:'amendment'})+')',{location:new URL('http://localhost:3000'),fetch:fetcher,crypto:webcrypto,AbortController,TextEncoder,TextDecoder,Uint8Array,URL,setTimeout,clearTimeout,Date});
  const result=await run();assert.deepEqual(plain(result.amendmentSource.settings),{settings:{brand:'원래'},scope:{ownerId:'owner',company:context.identity.company}});assert.equal(result.amendmentSource.quotationView.revision,review.identity.source.quotationRevision);
  assert.equal(reads.filter(path=>path==='/api/settings').length,2);assert.equal(reads.filter(path=>path.endsWith('/quotation-fields')).length,2);assert.equal(reads.filter(path=>path.endsWith('/native-assets')).length,2);
  const normal=fetcher;let count=0;const changing=async(...args)=>{if(args[0].endsWith('/api/settings')&&++count===2)changed=true;return normal(...args);};
  const source='('+nativeProductDocumentAppSourcePage.toString()+')('+JSON.stringify({identity:context.identity,bodySha256:context.originalBodySha256,preparedBodySha256:context.bodySha256,action:'amendment'})+')';
  await assert.rejects(vm.runInNewContext(source,{location:new URL('http://localhost:3000'),fetch:changing,crypto:webcrypto,AbortController,TextEncoder,TextDecoder,Uint8Array,URL,setTimeout,clearTimeout,Date}));
 }finally{f.h.close();}
});
