'use client';
import {useEffect,useRef,useState} from 'react';
import type {ManagedProductList,ManagedProductFilter,ManagedProductImportCounts,ManagedProductInput,ManagedProductAccountContext} from '@/app/managed-products';
import {managedTableColumns,managedVisibleColumns,managedCell,managedColumn,managedTableParams,parseManagedTableQuery,type ManagedTableQuery,type ManagedTableFilter} from '@/app/managed-product-table';
import {ManagedImportPricesPanel} from '@/app/components/managed-import-prices-panel';
import './managed-products-panel.css';

type List=ManagedProductList&ManagedProductAccountContext;
type Preview={preview:true;sha256:string;company:ManagedProductList['company'];counts:ManagedProductImportCounts;sample:ManagedProductInput[]}&ManagedProductAccountContext;
type ImportResult=Omit<Preview,'preview'>&{preview:boolean;error?:string};
function link(value:string){try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:undefined;}catch{return undefined;}}
function thumbnail(value:string){const url=link(value);if(!url)return;return new URL(url).hostname.endsWith('.coupangcdn.com')?url:undefined;}

export function ManagedProductsPanel(){
 const [data,setData]=useState<List|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
 const [page,setPage]=useState(1),[pageSize,setPageSize]=useState(10),[search,setSearch]=useState(''),[searchDraft,setSearchDraft]=useState(''),[filter,setFilter]=useState<ManagedProductFilter>('all');
 const [visible,setVisible]=useState(()=>managedVisibleColumns.map(column=>column.id)),[file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<Preview|null>(null),[confirmed,setConfirmed]=useState(false),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [table,setTable]=useState<ManagedTableQuery>({sort:null,columnFilters:[]}),[pinned,setPinned]=useState('상품명'),[fixedHeight,setFixedHeight]=useState(true),[selection,setSelection]=useState<{accountContext:string;ids:Set<string>}>({accountContext:'',ids:new Set()}),[filterDraft,setFilterDraft]=useState<ManagedTableFilter|null>(null),[filterError,setFilterError]=useState('');
 const [importPriceDialog,setImportPriceDialog]=useState<{accountContext:string;skuId:string}|null>(null);
 const tableKey=JSON.stringify(table),displayed=managedTableColumns.filter(column=>visible.includes(column.id)),selected=selection.accountContext===data?.accountContext?selection.ids:new Set<string>();
 const active=useRef<AbortController|null>(null);
 const importContext=useRef<List|null>(null),latestList=useRef<List|null>(null);
 const currentPreview=preview&&data&&preview.accountContext===data.accountContext&&preview.company.code===data.company.code&&preview.company.name===data.company.name?preview:null;
 useEffect(()=>()=>{active.current?.abort();},[]);
 useEffect(()=>{
  const controller=new AbortController();
  importContext.current=null;
  queueMicrotask(()=>{if(!controller.signal.aborted){setLoading(true);setError('');}});
  void(async()=>{try{
   const query=JSON.parse(tableKey) as ManagedTableQuery,params=new URLSearchParams({page:String(page),pageSize:String(pageSize),search,filter,...managedTableParams(query)}),response=await fetch('/api/managed-products?'+params,{signal:controller.signal,cache:'no-store'}),body=await response.json() as List&{error?:string};
   if(!response.ok)throw Error(body.error??'상품 목록을 읽지 못했습니다.');
   if(!Array.isArray(body.products)||!body.company||!Number.isSafeInteger(body.total)||!/^[a-f0-9]{64}$/.test(body.accountContext))throw Error('상품 목록 응답을 확인하지 못했습니다.');
   if(!controller.signal.aborted){
    const previous=latestList.current;latestList.current=body;importContext.current=body;
    if(previous&&(previous.accountContext!==body.accountContext||previous.company.code!==body.company.code||previous.company.name!==body.company.name)){setPreview(null);setConfirmed(false);setImportPriceDialog(null);setMessage('로그인 계정 또는 회사정보가 변경되었습니다. 선택한 파일을 다시 미리보기해주세요.');}
    setData(body);
   }
  }catch(cause){if(!controller.signal.aborted){importContext.current=null;setData(null);setPreview(null);setConfirmed(false);setError(cause instanceof Error?cause.message:'상품 목록을 읽지 못했습니다.');}}
  finally{if(!controller.signal.aborted)setLoading(false);}})();
  return()=>controller.abort();
 },[page,pageSize,search,filter,refresh,tableKey]);
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
 const toggle=(ids:string[],checked:boolean)=>{if(!data)return;const next=new Set(selected);for(const id of ids){if(checked)next.add(id);else next.delete(id);}setSelection({accountContext:data.accountContext,ids:next});};
 const sort=(column:string)=>{setTable(current=>({...current,sort:current.sort?.column!==column?{column,direction:'ascending'}:current.sort.direction==='ascending'?{column,direction:'descending'}:null}));setPage(1);};
 function applyFilter(){if(!filterDraft)return;try{const columnFilters=[...table.columnFilters.filter(value=>value.column!==filterDraft.column),...((filterDraft.operator==='contains'&&!filterDraft.value)?[]:[filterDraft])];parseManagedTableQuery(new URLSearchParams({columnFilters:JSON.stringify(columnFilters)}));setTable(current=>({...current,columnFilters}));setPage(1);setFilterDraft(null);setFilterError('');}catch(cause){setFilterError(cause instanceof Error?cause.message:'필터 값을 확인해주세요.');}}
 async function download(){const context=importContext.current;if(active.current||loading||!context||context!==data)return;const controller=new AbortController();active.current=controller;setBusy(true);setMessage('');try{
  const params=new URLSearchParams({search,filter,...managedTableParams(table),expectedAccountContext:context.accountContext}),response=await fetch('/api/managed-products/export?'+params,{signal:controller.signal,cache:'no-store'});
  if(!response.ok){const body=await response.json() as {error?:string};throw Error(body.error||'상품 DB 다운로드를 확인하지 못했습니다.');}
  const filename=`YOOFAM-${context.company.code}-products.xlsx`;if(response.headers.get('content-type')?.split(';')[0]!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'||response.headers.get('x-managed-account-context')!==context.accountContext||response.headers.get('content-disposition')!==`attachment; filename="${filename}"`)throw Error('현재 회사의 상품 DB 파일을 확인하지 못했습니다.');
  const blob=await response.blob();if(controller.signal.aborted||importContext.current?.accountContext!==context.accountContext)return;const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage('현재 검색·열 필터·정렬을 적용한 상품 DB 파일을 내려받았습니다. 저장된 상품은 변경되지 않았습니다.');
 }catch(cause){if(!controller.signal.aborted)setMessage(cause instanceof Error?cause.message:'상품 DB 다운로드 실패');}finally{if(active.current===controller){active.current=null;if(!controller.signal.aborted)setBusy(false);}}}
 const summary=data?.summary,filters:{id:ManagedProductFilter;name:string;count:number}[]=[{id:'all',name:'전체',count:summary?.total??0},{id:'unavailable',name:'발주불가(품절)',count:summary?.unavailable??0},{id:'loser',name:'아이템루저',count:summary?.loser??0},{id:'no-purchase',name:'구매정보없음',count:summary?.noPurchase??0},{id:'no-import',name:'매입정보없음',count:summary?.noImport??0}];
 return <section className="managed-products" aria-label="로켓배송 상품관리 신규">
  <header><div><h2>로켓배송 상품관리 (신규)</h2><p>쿠플러스 상품 DB를 가져와 구매정보·매입정보·가격을 확인합니다.</p></div><button className="btn ghost" disabled={loading||busy} onClick={refreshList}>목록 새로고침</button></header>
  {error&&<p role="alert">{error}</p>}
  <details className="managed-import"><summary>상품 DB 가져오기</summary>
   <p>{data?`${data.company.name} (${data.company.code})`:'회사정보를 확인하고 있습니다.'}의 원본 XLSX를 선택하세요. 같은 SKU는 중복 추가하지 않으며 원본 값이 바뀐 행만 갱신합니다.</p>
   <p>쿠플러스 원본 상품 DB를 가져옵니다. YOOFAM 매입내역이 추가된 다운로드 파일은 조회·보관용입니다.</p>
   <label>로켓배송상품DB XLSX <input type="file" accept=".xlsx" disabled={busy||loading||!data} onChange={event=>{if(active.current)return;setFile(event.target.files?.[0]??null);setPreview(null);setConfirmed(false);setMessage('');}}/></label>
   <button className="btn" disabled={!file||busy||loading||!data} onClick={()=>void upload(false)}>{busy?'처리 중…':'파일 미리보기'}</button>
   {currentPreview&&<div className="managed-preview"><strong>{currentPreview.company.name} · {currentPreview.counts.total.toLocaleString()}개 SKU</strong><p>신규 {currentPreview.counts.added.toLocaleString()}개 · 변경 {currentPreview.counts.updated.toLocaleString()}개 · 동일 {currentPreview.counts.unchanged.toLocaleString()}개</p>
    <ul>{currentPreview.sample.map(row=><li key={row.skuId}>{row.title} <small>SKU {row.skuId}</small></li>)}</ul>
    <label><input type="checkbox" checked={confirmed} disabled={busy||loading} onChange={event=>{if(!active.current&&importContext.current?.accountContext===currentPreview.accountContext)setConfirmed(event.target.checked);}}/> 이 파일은 {currentPreview.company.name} ({currentPreview.company.code}) 계정에서 내려받은 상품 DB입니다.</label>
    <p>가격·재고는 파일 기준입니다. AI 초안이나 Supplier Hub 전송 이력으로 표시하지 않습니다.</p>
    <button className="btn primary" disabled={!confirmed||busy||loading} onClick={()=>void upload(true)}>상품 DB {currentPreview.counts.total.toLocaleString()}개 가져오기</button>
   </div>}
  </details>
  {message&&<p role="status">{message}</p>}
  <nav className="managed-filters" aria-label="등록 상품 필터">{filters.map(item=><button key={item.id} className={filter===item.id?'active':''} onClick={()=>{setFilter(item.id);setPage(1);}}>{item.name} <strong>{item.count.toLocaleString()}</strong></button>)}</nav>
  <p className="managed-source">{data?.company.name} · {summary?.priceDate?`판매가 기준일 ${summary.priceDate} · 원본 파일 값`:'판매가 기준일 없음'}{summary?.lastImportedAt&&` · 마지막 가져오기 ${new Date(summary.lastImportedAt).toLocaleString('ko-KR')}`}</p>
  <div className="managed-toolbar"><form onSubmit={event=>{event.preventDefault();setSearch(searchDraft.trim());setPage(1);}}><label>상품명·SKU·바코드 검색 <input value={searchDraft} onChange={event=>setSearchDraft(event.target.value)} maxLength={200}/></label><button className="btn ghost">검색</button></form>
   <button type="button" className="btn ghost" disabled={loading||busy||!data} onClick={()=>{if(data&&importContext.current===data)setImportPriceDialog({accountContext:data.accountContext,skuId:''});}}>매입정보 관리</button>
   <button type="button" className="btn ghost" disabled={loading||busy||!data} onClick={()=>void download()}>상품DB 다운로드</button>
   <label>페이지당 <select aria-label="상품관리 페이지당 상품 수" value={pageSize} onChange={event=>{setPageSize(Number(event.target.value));setPage(1);}}>{[10,25,50,100].map(value=><option key={value} value={value}>{value}개</option>)}</select></label>
   <details><summary>선택 컬럼 보기 ({displayed.length}개)</summary><div className="managed-columns"><button type="button" className="btn ghost" onClick={()=>setVisible(managedVisibleColumns.map(column=>column.id))}>기본 22열</button>{managedTableColumns.map(column=><label key={column.id}><input type="checkbox" data-column-field={column.field} aria-label={`${column.label} 컬럼 표시`} checked={visible.includes(column.id)} onChange={event=>{setVisible(current=>event.target.checked?[...new Set([...current,column.id])]:current.filter(value=>value!==column.id));if(pinned===column.id&&!event.target.checked)setPinned('');}}/>{column.label}</label>)}</div></details>
   <label>고정할 열 선택 <select aria-label="상품관리 고정할 열 선택" value={pinned} onChange={event=>setPinned(event.target.value)}><option value="">고정 안 함</option>{displayed.map(column=><option key={column.id} value={column.id}>{column.label}</option>)}</select></label><fieldset className="managed-height"><legend>높이 고정</legend><label><input type="radio" name="managed-height" checked={fixedHeight} onChange={()=>setFixedHeight(true)}/>Y</label><label><input type="radio" name="managed-height" checked={!fixedHeight} onChange={()=>setFixedHeight(false)}/>N</label></fieldset>
   <span>전체 결과 {data?.total??0}개 · 선택 {selected.size}개</span>{table.columnFilters.length>0&&<button type="button" className="btn ghost" onClick={()=>{setTable(current=>({...current,columnFilters:[]}));setPage(1);setFilterDraft(null);}}>열 필터 모두 해제</button>}
  </div>
  {filterDraft&&<form className="managed-filter-editor" role="dialog" aria-label={`${managedColumn(filterDraft.column)?.label} 열 필터`} onSubmit={event=>{event.preventDefault();applyFilter();}}><strong>{managedColumn(filterDraft.column)?.label} · 전체 결과에 적용</strong><select aria-label="상품관리 열 필터 조건" value={filterDraft.operator} onChange={event=>setFilterDraft({...filterDraft,operator:event.target.value as ManagedTableFilter['operator']})}><option value="contains">포함</option><option value="eq">같음</option><option value="ne">같지 않음</option>{managedColumn(filterDraft.column)?.numeric&&<><option value="gte">이상</option><option value="lte">이하</option></>}</select><input aria-label="상품관리 열 필터 값" value={filterDraft.value} maxLength={2000} onChange={event=>setFilterDraft({...filterDraft,value:event.target.value})}/><button className="btn primary">적용</button><button type="button" className="btn ghost" onClick={()=>{setTable(current=>({...current,columnFilters:current.columnFilters.filter(value=>value.column!==filterDraft.column)}));setPage(1);setFilterDraft(null);}}>해제</button><button type="button" className="icon-close" aria-label="상품관리 열 필터 닫기" onClick={()=>setFilterDraft(null)}>×</button>{filterError&&<p role="alert">{filterError}</p>}</form>}
  <div className={`table-wrap managed-table-scroll${fixedHeight?' managed-height-fixed':''}`} aria-busy={loading}><table><thead><tr><th><input type="checkbox" aria-label="상품관리 현재 페이지 전체 선택" checked={Boolean(data?.products.length)&&data!.products.every(product=>selected.has(product.skuId))} onChange={event=>toggle(data?.products.map(product=>product.skuId)??[],event.target.checked)}/></th>{displayed.map(column=><th key={column.id} data-column={column.id} className={pinned===column.id?'managed-pinned':''} aria-sort={table.sort?.column===column.id?table.sort.direction:'none'}><div className="managed-header-tools"><button type="button" aria-label={`${column.label} 정렬`} onClick={()=>sort(column.id)}>{column.label}{table.sort?.column===column.id?table.sort.direction==='ascending'?' ↑':' ↓':''}</button><button type="button" className={table.columnFilters.some(value=>value.column===column.id)?'active':''} aria-label={`${column.label} 열 필터`} aria-expanded={filterDraft?.column===column.id} onClick={()=>{setFilterError('');setFilterDraft(current=>current?.column===column.id?null:table.columnFilters.find(value=>value.column===column.id)??{column:column.id,operator:'contains',value:''});}}>⌕</button></div></th>)}</tr></thead><tbody>
   {/* eslint-disable-next-line @next/next/no-img-element -- Read the original CDN thumbnail directly without an image-provider request. */}
   {data?.products.map(product=><tr key={product.skuId} data-sku-id={product.skuId}><td><input type="checkbox" aria-label={`SKU ${product.skuId} 선택`} checked={selected.has(product.skuId)} onChange={event=>toggle([product.skuId],event.target.checked)}/></td>{displayed.map(column=>{const value=managedCell(product,column.id);return <td key={column.id} data-column={column.id} className={`${column.kind==='title'?'managed-title ':''}${pinned===column.id?'managed-pinned':''}`} title={value}>{column.field==='매입정보'?<><button type="button" className="btn ghost" aria-label={`SKU ${product.skuId} 매입관리`} disabled={loading||busy} onClick={()=>{if(data&&importContext.current===data)setImportPriceDialog({accountContext:data.accountContext,skuId:product.skuId});}}>매입관리</button>{value&&<details><summary>원문 보기</summary><pre>{value}</pre></details>}</>:column.kind==='image'?thumbnail(value)?<img src={thumbnail(value)} alt="" loading="lazy" referrerPolicy="no-referrer"/>:'—':column.kind==='link'&&link(value)?<a href={link(value)} target="_blank" rel="noopener noreferrer">열기</a>:column.kind==='json'&&value?<details><summary>원문 보기</summary><pre>{value}</pre></details>:value||'—'}</td>;})}</tr>)}
   {!loading&&!data?.products.length&&<tr><td colSpan={displayed.length+1}>등록 상품이 없습니다. 상품 DB 파일을 가져오거나 검색 조건을 확인해주세요.</td></tr>}
  </tbody></table></div>
  <footer><button className="btn ghost" disabled={loading||page===1} onClick={()=>setPage(value=>value-1)}>이전</button><span>{page} / {Math.max(1,Math.ceil((data?.total??0)/pageSize))} 페이지 · {(data?.total??0).toLocaleString()}개</span><button className="btn ghost" disabled={loading||page*pageSize>=(data?.total??0)} onClick={()=>setPage(value=>value+1)}>다음</button></footer>
  {data&&importPriceDialog?.accountContext===data.accountContext&&<ManagedImportPricesPanel key={data.accountContext} company={data.company} accountContext={data.accountContext} initialSkuId={importPriceDialog.skuId} onClose={()=>setImportPriceDialog(null)} onImported={()=>setRefresh(value=>value+1)}/>}
 </section>;
}
