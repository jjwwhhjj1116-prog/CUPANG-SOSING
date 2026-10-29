import {seoGenerationAuthorization,seoGenerationSettings} from '@/app/seo-generation-server';
import {SeoGenerationError} from '@/app/seo-generation';
export async function GET(){
 try{const auth=await seoGenerationAuthorization();return Response.json({purpose:'seo-generation',ownerId:auth.owner,company:auth.company,configuration:seoGenerationSettings()},{headers:{'cache-control':'no-store'}});}
 catch(error){return Response.json({error:error instanceof SeoGenerationError?error.message:'SEO 생성 설정을 확인하지 못했습니다.'},{status:error instanceof SeoGenerationError?error.status:503,headers:{'cache-control':'no-store'}});}
}
