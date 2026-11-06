import {seoCompositionContext} from '@/app/seo-composition-context';
import {seoGenerationAuthorization,seoGenerationSource} from '@/app/seo-generation-server';
import type {TranslationSource} from '@/app/automation/translation';
/** Server-only snapshot, kept outside factualTranslationSource and current memo. */
export async function readSeoCompositionSnapshot(owner:string,id:string,source?:TranslationSource){
 const auth=await seoGenerationAuthorization();if(auth.owner!==owner)throw Error('SEO owner changed');
 const saved=await seoGenerationSource(auth,id),context={...seoCompositionContext(saved.options),sourceFingerprint:saved.captured.sourceFingerprint,company:auth.company};
 if(source){const original=saved.captured.source,core=(value:TranslationSource)=>JSON.stringify([value.title,value.description,value.reference,value.category]);if(core(source)!==core(original))throw Error('SEO source changed');
  const facts=[...original.attributes,...saved.options.rows.filter(row=>row.included).flatMap(row=>[{name:'option:'+row.id,value:row.originalName},{name:'option-color:'+row.id,value:row.color??''},{name:'option-size:'+row.id,value:row.size??''}])];
  if(source.attributes.some(pair=>!facts.some(fact=>fact.name===pair.name&&fact.value===pair.value)))throw Error('SEO option source changed');
 }
 return {context,member:auth.member,guard:saved.captured.guard,productVersion:saved.product.updated_at,contentRevision:saved.content.revision};
}
