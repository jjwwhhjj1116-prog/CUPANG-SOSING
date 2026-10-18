/** Bounded, owner-bound keyset navigation. A cursor is a position, not authority. */
export const REMOVED_PRODUCTS_PAGE_SIZE = 50;
export const REMOVED_PRODUCTS_MAX_PAGE_SIZE = 100;
export type RemovedProductSummary = {id:string;registration_number?:string;owner_id:string;title:string;source_url:string;updated_at:string;removed_at:string};
export type RemovedProductsCursor = {removedAt:string;id:string};
export type RemovedProductsQuery = {limit:number;cursor:RemovedProductsCursor|null};
export type RemovedProductsPage = {products:RemovedProductSummary[];nextCursor:string|null};
export class RemovedProductsQueryError extends Error {}

const timestamp=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)&&Number.isFinite(Date.parse(value));
const identifier=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\u0000-\u001f\ud800-\udfff]/u.test(value);
const validCursor=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=1024&&/^[A-Za-z0-9_-]+$/u.test(value);
async function ownerScope(ownerId:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ownerId)))].map(value=>value.toString(16).padStart(2,'0')).join('');}
function encode(value:unknown){return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,'');}

export async function removedProductsCursor(ownerId:string,row:RemovedProductsCursor):Promise<string>{
  if(!timestamp(row.removedAt)||!identifier(row.id))throw new RemovedProductsQueryError('삭제 기록의 페이지 위치를 확인하지 못했습니다.');
  return encode({version:1,owner:await ownerScope(ownerId),removedAt:row.removedAt,id:row.id});
}
export async function parseRemovedProductsQuery(params:URLSearchParams,ownerId:string):Promise<RemovedProductsQuery>{
  if([...params.keys()].some(key=>!['cursor','limit'].includes(key)||params.getAll(key).length!==1))throw new RemovedProductsQueryError('삭제 목록 조회 조건을 확인해주세요.');
  const rawLimit=params.get('limit'),limit=rawLimit===null?REMOVED_PRODUCTS_PAGE_SIZE:Number(rawLimit);
  if(rawLimit!==null&&!/^[1-9]\d{0,2}$/u.test(rawLimit)||!Number.isSafeInteger(limit)||limit<1||limit>REMOVED_PRODUCTS_MAX_PAGE_SIZE)throw new RemovedProductsQueryError('삭제 목록은 한 번에 1~100개까지 조회할 수 있습니다.');
  if(!params.has('cursor'))return{limit,cursor:null};
  const raw=params.get('cursor');
  try{
    if(!validCursor(raw))throw Error();
    const bytes=Uint8Array.from(atob(raw.replaceAll('-','+').replaceAll('_','/')),character=>character.charCodeAt(0));
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='id,owner,removedAt,version'||value.version!==1
      ||value.owner!==await ownerScope(ownerId)||!timestamp(value.removedAt)||!identifier(value.id))throw Error();
    return{limit,cursor:{removedAt:value.removedAt,id:value.id}};
  }catch{throw new RemovedProductsQueryError('삭제 목록의 페이지가 만료되었거나 현재 계정과 다릅니다. 첫 페이지부터 다시 조회해주세요.');}
}

export function parseRemovedProductsPage(value:unknown,ownerId?:string):RemovedProductsPage{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('삭제된 상품 응답을 확인하지 못했습니다.');
  const page=value as Partial<RemovedProductsPage>;
  if(!Array.isArray(page.products)||page.products.length>REMOVED_PRODUCTS_MAX_PAGE_SIZE||page.nextCursor!==null&&!validCursor(page.nextCursor)
    ||page.products.length===0&&page.nextCursor!==null||new Set(page.products.map(row=>row?.id)).size!==page.products.length
    ||page.products.some(row=>!row||!identifier(row.id)||!identifier(row.owner_id)||ownerId!==undefined&&row.owner_id!==ownerId
      ||typeof row.title!=='string'||typeof row.source_url!=='string'||!timestamp(row.updated_at)||!timestamp(row.removed_at)
      ||row.registration_number!==undefined&&(typeof row.registration_number!=='string'||row.registration_number.length>100)))
    throw Error('현재 계정의 삭제된 상품과 페이지를 확인하지 못했습니다. 첫 페이지부터 다시 조회해주세요.');
  return{products:page.products,nextCursor:page.nextCursor as string|null};
}
