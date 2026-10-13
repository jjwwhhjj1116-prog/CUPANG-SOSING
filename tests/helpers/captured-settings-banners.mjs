import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './mobile-intake.mjs';
export const bannerCompanies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
export const bannerJson=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64');
/** Captured settings and images are synthetic. Actual collection/content APIs
 * run in isolated SQLite; provider/CDN responses never leave this harness. */
export async function bannerFixture(company=bannerCompanies[0]){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name}),top='owner/captured-top.png',bottom='owner/captured-bottom.png';
 for(const [index,key]of [top,bottom].entries())await h.bindings.FILES.put(key,Buffer.concat([png,Buffer.from([index])]),{httpMetadata:{contentType:'image/png'}});
 const get=h.bindings.FILES.get;h.bindings.FILES.get=async(key,options)=>{const saved=await get(key);if(!saved)return null;const value=h.objects.get(key),bytes=options?.range?value.slice(options.range.offset,options.range.offset+options.range.length):value.slice();return{...saved,body:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}})};};
 Object.assign(h.context.settings,{topImageEnabled:true,topImageKey:top,bottomImageEnabled:true,bottomImageKey:bottom});h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));h.sqlite.prepare("UPDATE collection_jobs SET goal='work'").run();await h.intake();
 const product=()=>h.sqlite.prepare('SELECT * FROM products').get(),endpoint='/api/products/'+product().id+'/content',read=()=>h.route(endpoint).then(bannerJson);
 const save=async patch=>{const before=await read();return bannerJson(await h.route(endpoint,{method:'PATCH',body:{expectedRevision:before.content.revision,patch}}));};
 const stable=()=>JSON.stringify({source:h.sqlite.prepare('SELECT * FROM collection_results').all(),context:h.sqlite.prepare('SELECT * FROM collection_context').all(),options:h.sqlite.prepare('SELECT * FROM product_options').all(),policy:product().pricing_policy,images:product().image_keys,objects:[...h.objects].map(([key,bytes])=>[key,Buffer.from(bytes).toString('base64')])});
 return{h,top,bottom,company,product,endpoint,read,save,stable,close(){h.close();}};
}
