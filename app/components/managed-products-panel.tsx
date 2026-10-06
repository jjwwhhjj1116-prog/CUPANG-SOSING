'use client';
import {useEffect,useRef,useState} from 'react';
import type {ManagedProductList,ManagedProductFilter,ManagedProductImportCounts,ManagedProductInput,ManagedProductAccountContext} from '@/app/managed-products';
import './managed-products-panel.css';

const columns=['SKUID','바코드','제품분류','노출ID','옵션ID','vendorItemId','productId','판매링크','발주가능상태','재고','판매가','판매가기준일','공급가','리뷰평점','리뷰수','구매링크','옵션1_중국어','옵션2_중국어','판매구성수량','매입단가','공급가액','부가세액','총매입가','구매정보','매입정보','latestImportPrice','구매정보여부','winner','productIdHistory','priceHistory','otherSellers','쿠팡마진','쿠팡마진율','마진','마진율','ROI','최소ROAS'];
const jsonColumns=['구매정보','매입정보','productIdHistory','priceHistory','otherSellers'];
const initialColumns=['SKUID','바코드','노출ID','옵션ID','판매링크','발주가능상태','재고','판매가','판매가기준일','공급가','리뷰평점','리뷰수','구매정보','매입정보'];
type List=ManagedProductList&ManagedProductAccountContext;
type Preview={preview:true;sha256:string;company:ManagedProductList['company'];counts:ManagedProductImportCounts;sample:ManagedProductInput[]}&ManagedProductAccountContext;
type ImportResult=Omit<Preview,'preview'>&{preview:boolean;error?:string};
function link(value:string){try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:undefined;}catch{return undefined;}}
function thumbnail(value:string){const url=link(value);if(!url)return;return new URL(url).hostname.endsWith('.coupangcdn.com')?url:undefined;}

export function ManagedProductsPanel(){
 const [data,setData]=useState<List|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
 const [page,setPage]=useState(1),[pageSize,setPageSize]=useState(25),[search,setSearch]=useState(''),[searchDraft,setSearchDraft]=useState(''),[filter,setFilter]=useState<ManagedProductFilter>('all');
 const [visible,setVisible]=useState(initialColumns),[file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<Preview|null>(null),[confirmed,setConfirmed]=useState(false),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const active=useRef<AbortController|null>(null);
 const importContext=useRef<List|null>(null),latestList=useRef<List|null>(null);
 const currentPreview=preview&&data&&preview.accountContext===data.accountContext&&preview.company.code===data.company.code&&preview.company.name===data.company.name?preview:null;
 useEffect(()=>()=>{active.current?.abort();},[]);
 useEffect(()=>{
  const controller=new AbortController();
  importContext.current=null;
  queueMicrotask(()=>{if(!controller.signal.aborted){setLoading(true);setError('');}});
  void(async()=>{try{
   const params=new URLSearchParams({page:String(page),pageSize:String(pageSize),search,filter}),response=await fetch('/api/managed-products?'+params,{signal:controller.signal,cache:'no-store'}),body=await response.json() as List&{error?:string};
   if(!response.ok)throw Error(body.error??'상품 목록을 읽지 못했습니다.');
   if(!Array.isArray(body.products)||!body.company||!Number.isSafeInteger(body.total)||!/^[a-f0-9]{64}$/.test(body.accountContext))throw Error('상품 목록 응답을 확인하지 못했습니다.');
   if(!controller.signal.aborted){
    const previous=latestList.current;latestList.current=body;importContext.current=body;
    if(previous&&(previous.accountContext!==body.accountContext||previous.company.code!==body.company.code||previous.company.name!==body.company.name)){setPreview(null);setConfirmed(false);setMessage('로그인 계정 또는 회사정보가 변경되었습니다. 선택한 파일을 다시 미리보기해주세요.');}
    setData(body);
   }
  }catch(cause){if(!controller.signal.aborted){importContext.current=null;setData(null);setPreview(null);setConfirmed(false);setError(cause instanceof Error?cause.message:'상품 목록을 읽지 못했습니다.');}}
  finally{if(!controller.signal.aborted)setLoading(false);}})();
  return()=>controller.abort();
 },[page,pageSize,search,filter,refresh]);
 async function upload(commit:boolean){
  const context=importContext.current;
  if(active.current||!file||!data||!context||context.accountContext!==data.accountContext||context.company.code!==data.company.code||context.company.name!==data.company.name||commit&&(!currentPreview||!confirmed))return;
  const controller=new AbortController();active.current=controller;setBusy(true);setMessage('');
  try{
   const form=new FormData();form.set('file',file);form.set('action',commit?'import':'preview');form.set('companyCode',context.company.code);
   if(commit){form.set('expectedSha256',currentPreview!.sha256);form.set('expectedAccountContext',currentPreview!.accountContext);form.set('confirmedCompany','true');}
   const response=await fetch('/api/managed-products/import',{method:'POST',body:form,signal:controller.signal,credentials:'same-origin'}),body=await response.json() as ImportResult;
   if(!response.ok)throw Error(body.error??'상품 DB 가져오기를 확인하지 못했습니다.');
   if(body.company?.code!==context.company.code||body.company.name!==context.company.name||body.accountContext!==context.accountContext||body.preview!==!commit||!body.counts||!['total','added','updated','unchanged'].every(key=>Number.isSafeInteger(body.counts[key as keyof ManagedProductImportCounts])&&body.counts[key as keyof ManagedProductImportCounts]>=0)
    ||body.counts.total!==body.counts.added+body.counts.updated+body.counts.unchanged||!commit&&(!Array.isArray(body.sample)||!/^[a-f0-9]{64}$/.test(body.sha256)))throw Error('가져온 회사와 결과를 확인하지 못했습니다.');
   if(controller.signal.aborted||active.current!==controller||importContext.current?.accountContext!==context.accountContext)return;
   if(commit){setMessage(`총 ${body.counts.total.toLocaleString()}개 확인: 신규 ${body.counts.added.toLocaleString()}개, 갱신 ${body.counts.updated.toLocaleString()}개, 동일 ${body.counts.unchanged.toLocaleString()}개. 상품관리 DB에 저장했습니다.`);setPreview(null);setConfirmed(false);setRefresh(value=>value+1);}
   else{setPreview({...body,preview:true});setConfirmed(false);}
  }catch(cause){if(!controller.signal.aborted)setMessage(cause instanceof Error?cause.message:'응답을 확인하지 못했습니다. 같은 파일로 다시 확인해주세요.');}
  finally{if(active.current===controller){active.current=null;if(!controller.signal.aborted)setBusy(false);}}
 }
 function refreshList(){importContext.current=null;setLoading(true);setRefresh(value=>value+1);}
 const summary=data?.summary,filters:{id:ManagedProductFilter;name:string;count:number}[]=[{id:'all',name:'전체',count:summary?.total??0},{id:'unavailable',name:'발주불가(품절)',count:summary?.unavailable??0},{id:'loser',name:'아이템루저',count:summary?.loser??0},{id:'no-purchase',name:'구매정보없음',count:summary?.noPurchase??0},{id:'no-import',name:'매입정보없음',count:summary?.noImport??0}];
 return <section className="managed-products" aria-label="로켓배송 상품관리 신규">
  <header><div><h2>로켓배송 상품관리 (신규)</h2><p>쿠플러스 상품 DB를 가져와 구매정보·매입정보·가격을 확인합니다.</p></div><button className="btn ghost" disabled={loading||busy} onClick={refreshList}>목록 새로고침</button></header>
  {error&&<p role="alert">{error}</p>}
  <details className="managed-import"><summary>상품 DB 가져오기</summary>
   <p>{data?`${data.company.name} (${data.company.code})`:'회사정보를 확인하고 있습니다.'}의 원본 XLSX를 선택하세요. 같은 SKU는 중복 추가하지 않으며 원본 값이 바뀐 행만 갱신합니다.</p>
   <label>로켓배송상품DB XLSX <input type="file" accept=".xlsx" disabled={busy||loading||!data} onChange={event=>{if(active.current)return;setFile(event.target.files?.[0]??null);setPreview(null);setConfirmed(false);setMessage('');}}/></label>
   <button className="btn" disabled={!file||busy||loading||!data} onClick={()=>void upload(false)}>{busy?'처리 중…':'파일 미리보기'}</button>
   {currentPreview&&<div className="managed-preview"><strong>{currentPreview.company.name} · {currentPreview.counts.total.toLocaleString()}개 SKU</strong><p>신규 {currentPreview.counts.added.toLocaleString()}개 · 변경 {currentPreview.counts.updated.toLocaleString()}개 · 동일 {currentPreview.counts.unchanged.toLocaleString()}개</p>
    <ul>{currentPreview.sample.map(row=><li key={row.skuId}>{row.title} <small>SKU {row.skuId}</small></li>)}</ul>
    <label><input type="checkbox" checked={confirmed} disabled={busy||loading} onChange={event=>{if(!active.current&&importContext.current?.accountContext===currentPreview.accountContext)setConfirmed(event.target.checked);}}/> 이 파일은 {currentPreview.company.name} ({currentPreview.company.code}) 계정에서 내려받은 상품 DB입니다.</label>
    <p>가격·재고는 파일 기준입니다. AI 초안이나 Supplier Hub 전송 이력으로 표시하지 않습니다.</p>
    <button className="btn primary" disabled={!confirmed||busy||loading} onClick={()=>void upload(true)}>상품 DB {currentPreview.counts.total.toLocaleString()}개 가져오기</button>
   </div>}
   {message&&<p role="status">{message}</p>}
  </details>
  <nav className="managed-filters" aria-label="등록 상품 필터">{filters.map(item=><button key={item.id} className={filter===item.id?'active':''} onClick={()=>{setFilter(item.id);setPage(1);}}>{item.name} <strong>{item.count.toLocaleString()}</strong></button>)}</nav>
  <p className="managed-source">{data?.company.name} · {summary?.priceDate?`판매가 기준일 ${summary.priceDate} · 원본 파일 값`:'판매가 기준일 없음'}{summary?.lastImportedAt&&` · 마지막 가져오기 ${new Date(summary.lastImportedAt).toLocaleString('ko-KR')}`}</p>
  <div className="managed-toolbar"><form onSubmit={event=>{event.preventDefault();setSearch(searchDraft.trim());setPage(1);}}><label>상품명·SKU·바코드 검색 <input value={searchDraft} onChange={event=>setSearchDraft(event.target.value)} maxLength={200}/></label><button className="btn ghost">검색</button></form>
   <label>페이지당 <select value={pageSize} onChange={event=>{setPageSize(Number(event.target.value));setPage(1);}}>{[10,25,50].map(value=><option key={value} value={value}>{value}개</option>)}</select></label>
   <details><summary>표시할 열 ({visible.length}개)</summary><div className="managed-columns">{columns.map(name=><label key={name}><input type="checkbox" checked={visible.includes(name)} onChange={event=>setVisible(current=>event.target.checked?[...current,name]:current.filter(value=>value!==name))}/>{name}</label>)}</div></details>
  </div>
  <div className="table-wrap" aria-busy={loading}><table><thead><tr><th>이미지</th><th>상품명</th>{visible.map(name=><th key={name}>{name==='SKUID'?'SKU ID':name}</th>)}</tr></thead><tbody>
   {/* eslint-disable-next-line @next/next/no-img-element -- Read the original CDN thumbnail directly without an image-provider request. */}
   {data?.products.map(product=><tr key={product.skuId}><td>{thumbnail(product.values['썸네일']??'')?<img src={thumbnail(product.values['썸네일'])} alt="" loading="lazy" referrerPolicy="no-referrer"/>:'—'}</td><td className="managed-title">{product.title}</td>{visible.map(name=><td key={name} title={product.values[name]??''}>{name.endsWith('링크')&&link(product.values[name]??'')?<a href={link(product.values[name])} target="_blank" rel="noopener noreferrer">열기</a>:jsonColumns.includes(name)&&product.values[name]?<details><summary>원문 보기</summary><pre>{product.values[name]}</pre></details>:product.values[name]||'—'}</td>)}</tr>)}
   {!loading&&!data?.products.length&&<tr><td colSpan={visible.length+2}>등록 상품이 없습니다. 상품 DB 파일을 가져오거나 검색 조건을 확인해주세요.</td></tr>}
  </tbody></table></div>
  <footer><button className="btn ghost" disabled={loading||page===1} onClick={()=>setPage(value=>value-1)}>이전</button><span>{page} / {Math.max(1,Math.ceil((data?.total??0)/pageSize))} 페이지 · {(data?.total??0).toLocaleString()}개</span><button className="btn ghost" disabled={loading||page*pageSize>=(data?.total??0)} onClick={()=>setPage(value=>value+1)}>다음</button></footer>
 </section>;
}
