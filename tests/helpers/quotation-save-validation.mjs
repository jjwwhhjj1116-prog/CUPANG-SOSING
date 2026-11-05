import assert from 'node:assert/strict';
import {assetApiFixture,companies,plain} from './supplier-hub-single-assets.mjs';
export {companies,plain};
export const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
export const completeQuotationChanges=[['taxType','과세'],['kcMarkType','해당사항없음'],['shelfLifeDays','0'],['handlingReason','해당사항없음'],['packagedWeightG','100'],['packagedDimensionsMm','100*100*100']].map(([fieldKey,value])=>({fieldKey,optionId:null,value}));
export async function quotationValidationFixture(company=companies[0],{captured=false}={}){
 const f=await assetApiFixture(company,undefined,{productId:'synthetic-saved-quotation-975'});
 if(captured){f.h.context.category=f.profile;f.h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(f.h.context),'job');f.h.sqlite.prepare('INSERT INTO collection_products(job_id,owner_id,product_id,created_at) VALUES(?,?,?,?)').run('job','owner',f.id,new Date().toISOString());f.h.sqlite.prepare('UPDATE products SET source_url=? WHERE id=?').run(f.h.sourceUrl,f.id);}
 const path=f.base+'/quotation-fields'+(captured?'':f.query),request=(url,init={})=>f.h.route(String(url),{method:init.method??'GET',...(init.body?{body:typeof init.body==='string'?JSON.parse(init.body):init.body}:{})});
 const read=()=>request(path).then(json),save=async(changes=completeQuotationChanges)=>{const view=await read();return request(path,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}).then(json);};
 return{...f,path,request,read,save,profileId:captured?undefined:f.profile.id};
}
