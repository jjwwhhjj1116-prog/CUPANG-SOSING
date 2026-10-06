import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {COMPATIBILITY_DATE} from '../deployment/cloudflare-config.mjs';

// Run outside npm test: node scripts/check-paid-provider-runtime.mjs
// Bundles the real adapters into workerd. All outbound traffic is intercepted;
// only synthetic text, blank PNG pixels and a fake credential are ever used.
function png(width, height) {
  const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
  const chunk=(type,data)=>{const name=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([length,name,data,crc]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(height*(width*4+1)))),chunk('IEND',Buffer.alloc(0))]);
}
const sourceImage=png(2,2),outputImage=png(1024,1024),credential='TEST-ONLY-RUNTIME-NOT-A-REAL-KEY';
const source={title:'合成收纳袋',description:'尺寸 10 cm',attributes:[],provenance:'manual',reference:'Synthetic local runtime check'};
const draft={title:'합성 수납 주머니',description:'크기 10 cm',keywords:['수납'],attributes:[],warnings:[]};
const code=`
import {executeTranslation,prepareTranslationReview,requireTranslationConfig} from './app/automation/translation.ts';
import {executeImageEdit,prepareImageReview,imageMetadata} from './app/automation/image-edit.ts';
export default {async fetch(request){
  const image=new URL(request.url).pathname==='/image';const contracts=[];
  const checkedFetch=(input,init)=>{
    const req=new Request(input,init);
    contracts.push({method:req.method,redirect:req.redirect,authorization:req.headers.get('authorization')===${JSON.stringify('Bearer '+credential)},contentType:req.headers.get('content-type'),aborted:init.signal.aborted});
    const nativeFetch=fetch;return nativeFetch(input,init);
  };
  try {
    if(image){
      const bytes=Uint8Array.from(atob(${JSON.stringify(sourceImage.toString('base64'))}),c=>c.charCodeAt(0));
      const config={apiKey:${JSON.stringify(credential)},model:'gpt-image-1.5'};
      const review=await prepareImageReview({sourceKey:'synthetic/source.png',prompt:'',purpose:'translate',size:'1024x1024',quality:'low'},await imageMetadata(bytes),config.model);
      const result=await executeImageEdit(review,config,bytes,checkedFetch);
      return Response.json({contracts,result:{width:result.metadata.width,height:result.metadata.height,bytes:result.metadata.bytes,providerRequestId:result.providerRequestId},sourceUnchanged:review.source.sha256===(await imageMetadata(bytes)).sha256});
    }
    const config=requireTranslationConfig({OPENAI_API_KEY:${JSON.stringify(credential)},SOURCEFLOW_TEXT_MODEL:'synthetic-model',SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS:'1024'});
    const review=await prepareTranslationReview(${JSON.stringify(source)},config);
    const result=await executeTranslation(review,config,checkedFetch);
    return Response.json({contracts,result:{title:result.draft.title,provenance:result.provenance,appliedToContent:result.appliedToContent}});
  }catch(error){return Response.json({contracts,error:{code:error.code,mayHaveBeenCharged:error.mayHaveBeenCharged}});}
}};`;
const bundle=await build({stdin:{contents:code,resolveDir:fileURLToPath(new URL('../',import.meta.url)),sourcefile:'paid-provider-runtime-probe.ts',loader:'ts'},bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',logLevel:'silent'});
let redirect=false;
const seen=[];
const runtime=new Miniflare({modules:true,compatibilityDate:COMPATIBILITY_DATE,compatibilityFlags:['nodejs_compat'],script:bundle.outputFiles[0].text,
  outboundService:async request=>{
    const url=new URL(request.url);
    assert.equal(url.origin,'https://api.openai.com');
    assert.ok(['/v1/responses','/v1/images/edits'].includes(url.pathname),'Redirect target must never be requested');
    assert.equal(request.method,'POST');assert.equal(request.headers.get('authorization'),'Bearer '+credential);
    seen.push(url.pathname);
    if(url.pathname==='/v1/responses'){
      const body=await request.json();assert.equal(body.model,'synthetic-model');assert.equal(body.store,false);
      assert.deepEqual(JSON.parse(body.input[0].content[0].text),source);assert.equal(body.max_output_tokens,1024);
    }else{
      const form=await request.formData();assert.equal(form.get('model'),'gpt-image-1.5');assert.equal(form.get('n'),'1');assert.equal(form.get('output_format'),'png');
      assert.equal(form.get('image').type,'image/png');assert.deepEqual(Buffer.from(await form.get('image').arrayBuffer()),sourceImage);
    }
    if(redirect)return new Response(null,{status:308,headers:{location:'https://redirect.invalid/never-follow'}});
    if(url.pathname==='/v1/responses')return Response.json({id:'resp_synthetic',model:'synthetic-model',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(draft)}]}]});
    return Response.json({data:[{b64_json:outputImage.toString('base64')}],output_format:'png'},{headers:{'x-request-id':'req_synthetic'}});
  }});
try{
  for(const kind of ['translation','image']){
    for(redirect of [false,true]){
      const before=seen.length;
      const response=await runtime.dispatchFetch('http://local.test/'+kind);assert.equal(response.status,200);
      const result=await response.json();assert.equal(result.contracts.length,1);const contract=result.contracts[0];
      assert.equal(contract.method,'POST');assert.equal(contract.redirect,'manual');assert.equal(contract.authorization,true);assert.equal(contract.aborted,false);
      assert.match(contract.contentType,kind==='image'?/^multipart\/form-data; boundary=/:/^application\/json$/);
      assert.equal(seen.length,before+1,'Each execution sends exactly one synthetic request');
      if(redirect){assert.deepEqual(result.error,{code:'PROVIDER_OUTCOME_UNCERTAIN',mayHaveBeenCharged:true});assert.equal(result.result,undefined);}
      else if(kind==='image'){assert.deepEqual(result.result,{width:1024,height:1024,bytes:outputImage.length,providerRequestId:'req_synthetic'});assert.equal(result.sourceUnchanged,true);}
      else assert.deepEqual(result.result,{title:draft.title,provenance:'generated',appliedToContent:false});
    }
  }
  console.log('Paid provider workerd check passed: Responses JSON and Images multipart success, 308 blocked with no follow-up; 4 synthetic requests, 0 external requests.');
}finally{await runtime.dispose();}
