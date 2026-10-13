import assert from 'node:assert/strict';
import {managedFixture} from './managed-products.mjs';
import {managedStoreSettingsHarness} from './managed-store-settings.mjs';
import {managedComponentUI,nodes,text} from './managed-purchase-info-ui.mjs';

export {nodes,text};
export const storeCompanies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
export const plain=value=>JSON.parse(JSON.stringify(value));
export const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
export const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return{promise,resolve,reject};};

/** Only synthetic setup populates these tables. Subsequent preference actions
 * must preserve every original product, purchase, price and draft snapshot. */
export async function storeFixture(company=storeCompanies[0],{count=3,names,ownerId='stores-'+company.code}={}){
 const h=managedStoreSettingsHarness(company);h.state.user={...h.state.user,userId:ownerId,membership:{...h.state.user.membership,id:ownerId,companyCode:company.code,companyName:company.name}};h.syncMember();
 h.sqlite.exec(h.load('db/managed-store-settings.ts').managedStoreSettingsSchema);
 const bytes=managedFixture(count,rows=>{for(const[index,row]of rows.entries()){row['상품명']=`${company.name} 원문 보존 합성 상품 ${index+1}`;row['바코드']='00'+(1234567890+index);row['구매정보']=JSON.stringify([{'상품명':row['상품명'],'바코드':row['바코드'],'매칭상태':'매칭완료','요청사항':'등록완료','한글표시사항':{'제품명':row['상품명'],'제조국':'중국','kc인증':false}}]);row['otherSellers']=JSON.stringify({otherVendorNames:['다른 판매처'],hasOtherSellers:true});row['latestImportPrice']='0';row['썸네일']='';row['판매링크']='';}});
 const preview=await json(await h.submit(bytes,{companyCode:company.code}));await json(await h.submit(bytes,{companyCode:company.code,action:'import',sha256:preview.sha256,accountContext:preview.accountContext}),201);await json(await h.fetcher('/api/managed-products'));
 const now='2026-10-01T00:00:00.000Z';h.sqlite.prepare(`INSERT INTO products(id,owner_id,source_url,title,source_price_cny,exchange_rate,supply_margin,coupang_margin,supply_price,sale_price,msrp,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('stores-protected-draft',ownerId,'https://detail.1688.com/offer/646000000001.html','보존할 합성 수동 초안',25.6,350,50,40,17920,29870,38830,now,now);
 h.sqlite.prepare('INSERT INTO product_content VALUES(?,?,?,?,?)').run('stores-protected-draft',ownerId,7,JSON.stringify({seo:{title:'수동 제목',tags:[]},label:{manufacturer:'원문 제조원'},assets:{main:[]}}),now);
 h.sqlite.prepare('INSERT INTO managed_import_prices(owner_id,company_code,sku_id,import_date,price,revision,source_name,source_sha256,source_row,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(ownerId,company.code,'1000000000','2026-10-01','0.75',1,'합성매입.xlsx','a'.repeat(64),2,now,now);
 const source=()=>JSON.stringify(h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'managed_store_settings' ORDER BY name").all().map(({name})=>[name,h.sqlite.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all()]));
 const preferences=()=>plain(h.sqlite.prepare('SELECT * FROM managed_store_settings ORDER BY owner_id,company_code').all()),requests=[],endpoint='/api/managed-products/allowed-stores',accountContext=preview.accountContext;
 const request=async(url,init={})=>{const local=new URL(url,'https://app.test');requests.push({path:local.pathname+local.search,method:init.method??'GET',body:init.body});if(local.pathname!==endpoint)return h.fetcher(local.pathname+local.search,init);const method=init.method??'GET';return h.load('app/api/managed-products/allowed-stores/route.ts')[method](new Request(local.href,init));};
 const get=()=>request(endpoint+'?expectedAccountContext='+accountContext).then(response=>json(response));
 const put=(view,next)=>request(endpoint,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedAccountContext:accountContext,expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,allowedVendorNames:next})}).then(response=>json(response));
 if(names!==undefined)await put(await get(),names);requests.length=0;return{h,company,ownerId,accountContext,bytes,requests,endpoint,request,get,put,source,preferences,close:()=>h.close()};
}

export function storeUI(f,{fetcher=f.request,...props}={}){
 const panel=managedComponentUI('app/components/managed-store-settings-panel.tsx','ManagedStoreSettingsPanel',fetcher,{company:f.company,accountContext:f.accountContext,...props});
 return{...panel,field(label='허용 스토어 목록'){return nodes(panel.render()).find(node=>node.props?.['aria-label']===label);},async settlePending(){for(let i=0;i<8;i++){panel.render();await new Promise(resolve=>setImmediate(resolve));}}};
}
