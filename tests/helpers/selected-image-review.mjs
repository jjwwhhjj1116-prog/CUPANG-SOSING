import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as parse5 from 'parse5';
import * as pageSourcePriceBasis from '../../extensions/supplier-hub/page-source-price-basis.mjs';
export function reviewFixture(){
 const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,Date,URL,TextEncoder,structuredClone,require(name){if(name==='parse5')return parse5;if(name==='@/extensions/supplier-hub/page-source-price-basis.mjs')return pageSourcePriceBasis;if(name==='@/app/free-image-translation-client')return{};if(name==='@/app/image-files')return{isOwnedImageKey:(owner,key)=>typeof key==='string'&&key.startsWith(owner+'/')&&!key.includes('..')};if(!name.startsWith('@/'))throw Error(name);return load(name.slice(2)+'.ts');}});return exports;}
 const model=load('app/selected-image-review.ts'),vision=load('app/image-text-vision.ts'),style=load('app/free-image-vision-style.ts');
 const scope={ownerId:'owner',company:{code:'A01526306',name:'유앤채'}},version='2026-10-06T00:00:00.000Z';
 const keys=['owner/second.png','owner/original.png'],fields=[{id:'additionalImages',type:'images',section:'image',label:'추가',required:false,visibility:'common',maxItems:30}],cell={value:keys.join('\n'),source:'content',issues:[],needsReview:false};
 const view={revision:1,inputFingerprint:'b'.repeat(64),productVersion:version,contentRevision:2,optionRevision:1,imageKeys:keys,overrides:{common:{},options:{}},categoryContext:{source:'collection',profileId:null,categoryId:'991',categoryPath:['합성']},resolved:{schema:{fields},rows:[{optionId:'first',included:false,fields:{additionalImages:cell}},{optionId:'second',included:true,fields:{additionalImages:cell}}]},automatic:{rows:[]}};
 const source={productId:'product',productVersion:version,contentRevision:2,sourceKey:keys[1],sourceSha256:'a'.repeat(64),role:'additional',width:20,height:12,quotationTarget:{kind:'quotation',profileId:null,optionId:'second',input:'additionalImages',fieldKey:'additionalImages',slotIndex:1,revision:1,inputFingerprint:view.inputFingerprint,optionRevision:1,value:cell.value,bindingSha256:'c'.repeat(64)}};
 const configuration={provider:'workers-ai-vision',model:vision.IMAGE_TEXT_VISION_MODEL,notice:vision.IMAGE_TEXT_VISION_NOTICE,configured:true,paidAllowed:true},result={provider:'workers-ai-vision',model:vision.IMAGE_TEXT_VISION_MODEL,notice:vision.IMAGE_TEXT_VISION_NOTICE,requests:1,blocks:[{id:'vision-1',text:'中文',translated:'한국어',issue:null,box:{x:1,y:1,width:18,height:8}}],inspection:{policy:vision.IMAGE_TEXT_INSPECTION_POLICY,decision:'foreign-text'}};
 const canvas={width:20,height:12,getContext:()=>({font:'',measureText:()=>({width:10}),getImageData:(_x,_y,w,h)=>({data:new Uint8ClampedArray(w*h*4).fill(255)})})};
 const image={source,width:20,height:12,canvas,visionRequestId:'11111111-1111-4111-8111-111111111111',visionConfiguration:configuration,visionResult:result,visionStyleIssues:['VISION_BACKGROUND_COMPLEX']};
 const review=model.createSelectedImageReview(scope,view,image,'zh','배경 검토 필요');return{model,vision,style,scope,view,image,review};
}
