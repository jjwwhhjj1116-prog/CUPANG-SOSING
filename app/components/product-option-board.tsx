'use client';
/* eslint-disable @next/next/no-img-element -- Images use authenticated same-origin file access. */
import {useEffect,useState} from 'react';
import type {ProductContent} from '@/app/product-content';
import type {CollectionEditorTab} from '@/app/registration-navigation';
import {quotationMainImageKeys,optionQuotationName,type ProductOption,type ProductOptionsResponse} from '@/app/product-options';

type Props={productId:string;sourceUrl:string;imageKeys:string;onQuotation:(optionId:string)=>void;onEdit:(optionId?:string)=>void;onImage?:(optionId:string)=>void;onContent?:(step:CommonContentStep)=>void;onStage?:(optionId:string,step:CollectionEditorTab)=>void;onManage?:(optionId:string)=>void};
type CommonContentStep='추가 이미지'|'상세 이미지'|'표시사항';
type CommonRole='additional'|'detail'|'size'|'label';
const commonStages=[['additional','추가이미지','추가 이미지'],['detail','상세이미지','상세 이미지'],['size','사이즈표','옵션'],['label','한글표시사항','표시사항']] as const;
export type OptionBoardData=ProductOptionsResponse & {imageKeys:string[];quotationPrices?:Record<string,{supplyPrice:string;salePrice:string}>;seoTitle?:string|null;commonImageKeys:string[];commonAssets?:Partial<Record<CommonRole,string[]>>};
function record(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function validOption(row:unknown):row is ProductOption {
  if(!record(row)||typeof row.id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(row.id)
    ||['originalName','translatedName','supplierSku'].some(key=>typeof row[key]!=='string')
    ||['color','size'].some(key=>row[key]!==undefined&&typeof row[key]!=='string')
    ||typeof row.included!=='boolean'||!Number.isSafeInteger(row.unitsPerPack)||(row.unitsPerPack as number)<1
    ||(row.unitCostCny!==null&&(typeof row.unitCostCny!=='number'||!Number.isFinite(row.unitCostCny)||row.unitCostCny<=0))
    ||(row.stock!==undefined&&row.stock!==null&&(!Number.isSafeInteger(row.stock)||(row.stock as number)<0))
    ||(row.imageKey!==null&&(typeof row.imageKey!=='string'||!row.imageKey))
    ||(row.provenance!==undefined&&!record(row.provenance)))return false;
  return true;
}
function validCalculation(value:unknown){
  return value===null||(record(value)&&['supplyPrice','salePrice'].every(key=>{const price=value[key];return typeof price==='number'&&Number.isFinite(price);}));
}
export async function readOptionBoard(productId:string,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<OptionBoardData>{
  const response=await fetcher(`/api/products/${encodeURIComponent(productId)}/options`,{cache:'no-store',signal});
  const body=await response.json() as ProductOptionsResponse & {error?:string};
  if(!response.ok)throw Error(body?.error||'옵션을 불러오지 못했습니다.');
  if(!body||body.options?.productId!==productId||body.options.schemaVersion!==1||!Number.isSafeInteger(body.options.revision)||body.options.revision<0
    ||typeof body.productVersion!=='string'||!body.productVersion||!Array.isArray(body.options.rows)||body.options.rows.length>200||body.options.rows.some(row=>!validOption(row))
    ||new Set(body.options.rows.map(row=>row.id)).size!==body.options.rows.length||!Array.isArray(body.pricing?.rows)
    ||body.pricing.rows.some(row=>!record(row)||typeof row.optionId!=='string'||!body.options.rows.some(option=>option.id===row.optionId)||!validCalculation(row.calculation)))throw Error('상품의 옵션 응답을 확인하지 못했습니다.');
  if(body.sourceImageKeys!==undefined&&(!body.sourceImageKeys||typeof body.sourceImageKeys!=='object'||Array.isArray(body.sourceImageKeys)||Object.entries(body.sourceImageKeys).some(([id,key])=>typeof key!=='string'||!key||!body.options.rows.some(row=>row.id===id))))throw Error('상품의 원본 이미지 응답을 확인하지 못했습니다.');
  const contentResponse=await fetcher(`/api/products/${encodeURIComponent(productId)}/content`,{cache:'no-store',signal});
  const saved=await contentResponse.json() as {content?:ProductContent;error?:string};
  if(!contentResponse.ok)throw Error(saved?.error||'공통 상품 자료를 불러오지 못했습니다.');
  const content=saved?.content;
  if(content?.productId!==productId||content.schemaVersion!==1||(content.revision!==undefined&&(!Number.isSafeInteger(content.revision)||content.revision<0))||!record(content.assets)||!Array.isArray(content.assets.main?.value)||content.assets.main.value.some((key:unknown)=>typeof key!=='string'))throw Error('상품의 공통 이미지 응답을 확인하지 못했습니다.');
  if(content.seo!==undefined&&(!record(content.seo)||!record(content.seo.title)||typeof content.seo.title.value!=='string'))throw Error('상품의 SEO 응답을 확인하지 못했습니다.');
  const readKeys=(role:'additional'|'detailTop'|'detail'|'detailBottom'|'size'|'label')=>{
    const field=content.assets[role],keys=field===undefined?[]:field?.value;
    if((field!==undefined&&!record(field))||!Array.isArray(keys)||keys.some(key=>typeof key!=='string'))throw Error('상품의 공통 이미지 응답을 확인하지 못했습니다.');
    return keys;
  };
  const quoteResponse=await fetcher(`/api/products/${encodeURIComponent(productId)}/quotation-fields`,{cache:'no-store',signal});
  const quote=await quoteResponse.json() as {error?:string;productVersion?:string;optionRevision?:number;contentRevision?:number;imageKeys?:string[];resolved?:{rows?:{optionId:string|null;fields:Record<string,{value:string}>}[]}};
  if(!quoteResponse.ok)throw Error(quote?.error||'저장된 견적 가격을 불러오지 못했습니다.');
  if(!quote?.resolved||!Array.isArray(quote.resolved.rows)||quote.productVersion!==body.productVersion||quote.optionRevision!==body.options.revision||quote.contentRevision!==content.revision)throw Error('상품·옵션·견적서가 변경되었습니다. 새로고침해주세요.');
  if(!Array.isArray(quote.imageKeys)||quote.imageKeys.some(key=>typeof key!=='string'||!key))throw Error('상품의 이미지 목록 응답을 확인하지 못했습니다.');
  if(quote.resolved.rows.some(row=>!record(row)||(row.optionId!==null&&typeof row.optionId!=='string')||!record(row.fields)))throw Error('옵션별 견적 가격 응답을 확인하지 못했습니다.');
  const quotationPrices:NonNullable<OptionBoardData['quotationPrices']>=Object.create(null);
  for(const option of body.options.rows){
    const rows=quote.resolved.rows.filter(row=>row.optionId===option.id),row=rows[0];
    if(rows.length!==1||typeof row.fields?.supplyPrice?.value!=='string'||typeof row.fields?.salePrice?.value!=='string')throw Error('옵션별 견적 가격 응답을 확인하지 못했습니다.');
    quotationPrices[option.id]={supplyPrice:row.fields.supplyPrice.value,salePrice:row.fields.salePrice.value};
  }
  return {...body,imageKeys:quote.imageKeys,quotationPrices,seoTitle:content.seo?.title.value??null,commonImageKeys:content.assets.main.value,commonAssets:{additional:readKeys('additional'),detail:[...readKeys('detailTop'),...readKeys('detail'),...readKeys('detailBottom')],size:readKeys('size'),label:readKeys('label')}};
}
export function ProductOptionBoard({productId,sourceUrl,onQuotation,onEdit,onImage,onContent,onStage,onManage}:Props){
  const [loaded,setLoaded]=useState<{productId:string;attempt:number;data:OptionBoardData|null;error:string}|null>(null);
  const [attempt,setAttempt]=useState(0);const [query,setQuery]=useState('');
  const [selection,setSelection]=useState({productId,ids:new Set<string>()});
  const current=loaded?.productId===productId&&loaded.attempt===attempt?loaded:null;
  const data=current?.data??null,error=current?.error??'';
  useEffect(()=>{const controller=new AbortController();
    readOptionBoard(productId,controller.signal).then(value=>{if(!controller.signal.aborted)setLoaded({productId,attempt,data:value,error:''});}).catch(cause=>{if(!controller.signal.aborted)setLoaded({productId,attempt,data:null,error:cause instanceof Error?cause.message:'옵션 조회 실패'});});
    return()=>controller.abort();
  },[productId,attempt]);
  const keys=data?.imageKeys??[];
  const rows=data?.options.rows.filter(row=>[row.id,row.supplierSku,row.originalName,row.translatedName,row.color,row.size].join(' ').toLowerCase().includes(query.trim().toLowerCase()))??[];
  const selected=new Set(selection.productId===productId?[...selection.ids].filter(id=>data?.options.rows.some(row=>row.id===id)):[]);
  const toggle=(ids:string[],checked:boolean)=>{const next=new Set(selected);for(const id of ids){if(checked)next.add(id);else next.delete(id);}setSelection({productId,ids:next});};
  const stageHandler=(optionId:string,step:CollectionEditorTab):(()=>void)|undefined=>{
    if(onStage)return ()=>onStage(optionId,step);
    if(step==='가격')return ()=>onEdit(optionId);
    if(step==='견적서')return ()=>onQuotation(optionId);
    if(step==='대표 이미지'&&onImage)return ()=>onImage(optionId);
    if((step==='추가 이미지'||step==='상세 이미지'||step==='표시사항')&&onContent)return ()=>onContent(step);
    return undefined;
  };
  const stageButton=(optionId:string,step:CollectionEditorTab,label:string,text:string)=>{
    const handler=stageHandler(optionId,step);
    return handler?<button type="button" className="registration-cell-button" aria-label={`옵션 ${optionId} ${label} 편집`} onClick={handler}>{text}</button>:<small>{text}</small>;
  };
  let url:string|undefined;try{const parsed=new URL(sourceUrl);if(parsed.protocol==='https:'&&parsed.hostname==='detail.1688.com')url=parsed.href;}catch{/* Display text only. */}
  return <section className="option-board" aria-busy={!data&&!error}>
    <div className="option-board-source"><strong>1688 원본 URL</strong>{url?<a href={url} target="_blank" rel="noopener noreferrer">{sourceUrl}</a>:<span>{sourceUrl||'미입력'}</span>}</div>
    <div className="registration-table-tools"><label className="search"><input type="search" aria-label="상품 옵션 검색" placeholder="옵션명 · SKU · 색상 · 사이즈" value={query} onChange={event=>setQuery(event.target.value)}/></label><span>총 {data?.options.rows.length??0}개 옵션 · 검색 {rows.length}개 · 선택 {selected.size}개</span><button type="button" className="btn ghost" onClick={()=>onEdit()}>옵션·번들·가격 수정</button><button type="button" className="btn ghost" onClick={()=>setAttempt(value=>value+1)}>새로고침</button></div>
    {error?<p role="alert">{error}</p>:!data?<p role="status">저장된 옵션·가격을 불러오는 중…</p>:<div className="table-wrap"><table className="option-work-table"><thead><tr><th><input type="checkbox" aria-label="현재 옵션 전체 선택" checked={rows.length>0&&rows.every(row=>selected.has(row.id))} onChange={event=>toggle(rows.map(row=>row.id),event.target.checked)}/></th><th>옵션번호</th><th>옵션명</th><th>SEO설정</th><th>가격설정</th><th>대표이미지</th>{commonStages.map(([role,label])=><th key={role}>{label}</th>)}<th>견적서</th><th>재고/가격</th><th>관리</th></tr></thead><tbody>{rows.map(row=>{
      const prices=data.quotationPrices&&Object.hasOwn(data.quotationPrices,row.id)?data.quotationPrices[row.id]:undefined;
      const priceText=(value:string)=>value.trim()===''?'미입력':/^\d+(?:\.\d+)?$/.test(value)&&Number.isFinite(Number(value))?Number(value).toLocaleString('ko-KR')+'원':value;
      const calculation=data.pricing.rows.find(item=>item.optionId===row.id);
      const selectedImages=quotationMainImageKeys(row,data.commonImageKeys??[]);
      const original=!selectedImages.length&&data.sourceImageKeys&&Object.hasOwn(data.sourceImageKeys,row.id)?data.sourceImageKeys[row.id]:undefined;
      const imageKey=selectedImages.find(key=>keys.includes(key))??(original&&keys.includes(original)?original:undefined);
      const mainCount=new Set(selectedImages.filter(key=>keys.includes(key))).size;
      const mainLabel=selectedImages.length&&!mainCount?'연결 확인 필요':mainCount+'장';
      const priceLabel=prices?prices.supplyPrice.trim()&&prices.salePrice.trim()?'입력됨':'미입력':calculation?.calculation?'계산값':'미입력';
      return <tr key={row.id} data-option-id={row.id}><td><input type="checkbox" aria-label={`옵션 ${row.id} 선택`} checked={selected.has(row.id)} onChange={event=>toggle([row.id],event.target.checked)}/></td><td>{row.id}<small>{row.supplierSku||'SKU 미입력'}</small></td><td><strong>{optionQuotationName(row)||'(옵션명 공란)'}</strong><small>{row.originalName}</small><small>구성 {row.unitsPerPack}개 · 견적 {row.included?'포함':'제외'}</small></td>
        <td>{stageButton(row.id,'SEO','SEO설정',data.seoTitle==null?'확인 필요':data.seoTitle.trim()?'입력됨':'미입력')}</td>
        <td>{stageButton(row.id,'가격','가격설정',priceLabel)}</td>
        <td>{imageKey?<img src={`/api/files/${imageKey.split('/').map(encodeURIComponent).join('/')}`} alt={optionQuotationName(row)||'옵션 이미지'} width={64} height={64}/>:<small>{row.imageKey?'이미지 연결 확인 필요':'대표 이미지 미설정'}</small>}{imageKey&&<small>{original?'수집 원본 · 대표 이미지 미설정':row.imageKey?'개별 이미지':'공통 대표 이미지'}</small>}{stageButton(row.id,'대표 이미지','대표이미지',mainLabel)}</td>
        {commonStages.map(([role,label,step])=>{const saved=[...new Set(data.commonAssets?.[role]??[])],count=saved.filter(key=>keys.includes(key)).length;const text=role==='size'&&!saved.length?'미사용':saved.length&&!count?'연결 확인 필요':count+'장';return <td key={role}>{saved.length!==count&&count>0&&<small>{count}장 · 연결 확인 필요</small>}{stageButton(row.id,step,label,text)}</td>;})}
        <td>{stageButton(row.id,'견적서','견적서','열기')}</td>
        <td>{row.stock==null?'재고 미확인':`재고 ${row.stock.toLocaleString('ko-KR')}개`}<small>{row.unitCostCny===null?'원가 미입력':`¥${row.unitCostCny} / 개`}</small>{prices?<><small>{priceText(prices.supplyPrice)} (견적 공급가)</small><small>{priceText(prices.salePrice)} (견적 판매가)</small></>:calculation?.calculation?<><small>{calculation.calculation.supplyPrice.toLocaleString('ko-KR')}원 (공급가)</small><small>{calculation.calculation.salePrice.toLocaleString('ko-KR')}원 (판매가)</small></>:<small>{calculation?.error||'가격 미계산'}</small>}</td>
        <td>{onManage?<button type="button" className="registration-delete" aria-label={`옵션 ${row.id} 삭제 검토`} title="옵션 삭제 검토" onClick={()=>onManage(row.id)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg></button>:<button type="button" className="btn ghost" aria-label={`옵션 ${row.id} 수정`} onClick={()=>onEdit(row.id)}>수정</button>}</td>
      </tr>;
    })}</tbody></table>{!rows.length&&<p className="collection-empty">{data.options.rows.length?'검색 결과가 없습니다.':'저장된 옵션이 없습니다.'}</p>}</div>}
  </section>;
}
