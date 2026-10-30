'use client';

import { useMemo, useState } from 'react';
import { derived, num, records, str, type Field, type OperationsContext, type OpsRecord, type Values } from '../types';
import { ActionButton, CollectButton, ReadTable, RecordPanel, StatCards } from './shared';

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const won = (value: unknown) => value == null || value === '' ? '미확인' : `${num(value).toLocaleString('ko-KR')}원`;
const skuFields: Field[] = [
  {key:'name',label:'상품명',required:true}, {key:'barcode',label:'바코드'},
  {key:'supplierSkuId',label:'쿠팡 SKU ID'}, {key:'optionId',label:'쿠팡 옵션ID'},
  {key:'supplyPrice',label:'공급단가(원)',type:'number',default:0},
  {key:'costPrice',label:'기초 개당원가(원)',type:'number',default:0},
  {key:'salePrice',label:'소비자 판매가(원)',type:'number',default:0},
  {key:'setQty',label:'판매 세트당 구성수',type:'number',default:1},
];

const candidateFields: Field[] = [
  {key:'name',label:'원문 상품명',required:true}, {key:'nameKo',label:'한국어 상품명'},
  {key:'offerId',label:'1688 상품번호'}, {key:'sourceProductId',label:'기존 YOOFAM 상품 ID'},
  {key:'url',label:'상품 원문 URL'}, {key:'image',label:'이미지 URL'},
  {key:'price',label:'표시가격(외화)',type:'number'}, {key:'keyword',label:'쿠팡 비교 검색어'},
  {key:'status',label:'검토 상태',type:'select',options:['미검토','비교 중','제안 후보','보류'],default:'미검토'},
  {key:'memo',label:'차별점·공급조건 메모',type:'textarea'},
];

function SkuWorkspace({ctx}:{ctx:OperationsContext}) {
  const [reviewSkuId,setReviewSkuId]=useState(''),[optionSource,setOptionSource]=useState(''),[override,setOverride]=useState(false);
  const skus=records(ctx,'skus'),sku=skus.find(row=>row.id===reviewSkuId);
  const observations=[...records(ctx,'discoveries').map(row=>({id:`discovery:${row.id}`,values:row.values,source:'키워드·발굴 관측'})),...records(ctx,'comparisons').map(row=>({id:`compare:${row.id}`,values:row.values,source:'쿠팡 비교 근거'}))].filter(row=>str(row.values.optionId).trim());
  const seen=new Set<string>(),options=observations.filter(row=>{const key=str(row.values.optionId);if(seen.has(key))return false;seen.add(key);return true;});
  const chosen=options.find(row=>row.id===optionSource);
  const apply=async()=>{
    if(!sku||!chosen){ctx.notify('변경할 SKU와 확인한 옵션 후보를 선택하세요. 기존값 유지는 아무것도 변경하지 않습니다.');return;}
    if(str(sku.values.optionId)&&!override){ctx.notify('기존 옵션ID 변경 확인을 체크하세요.');return;}
    if(!window.confirm(`‘${str(sku.values.name)}’의 옵션ID를 변경할까요?\n기존: ${str(sku.values.optionId)||'미연결'}\n변경: ${str(chosen.values.optionId)}\n후보: ${str(chosen.values.name)}\n\n같은 상품의 규격·구성인지 확인한 뒤 저장하세요.`))return;
    if(await ctx.command({type:'upsert',dataset:'skus',id:sku.id,values:{...sku.values,optionId:str(chosen.values.optionId),optionLinkEvidence:{source:chosen.source,productId:str(chosen.values.productId),name:str(chosen.values.name),checkedAt:new Date().toISOString()}}})){setOptionSource('');setOverride(false);}
  };
  return <><section className="ops-panel"><h2>옵션ID 연결 검토</h2><p className="ops-note">SKU를 고른 뒤 관측된 옵션의 상품명·구성·판매자 근거를 대조하세요. 기본값인 ‘기존값 유지’는 저장하지 않으며, 후보가 없어도 기존 연결을 지우지 않습니다.</p>
    <div className="ops-toolbar"><label>연결할 SKU<select value={reviewSkuId} onChange={event=>{setReviewSkuId(event.target.value);setOptionSource('');setOverride(false);}}><option value="">SKU 선택</option>{skus.map(row=><option value={row.id} key={row.id}>{str(row.values.name)} · {str(row.values.barcode)||str(row.values.supplierSkuId)||row.id}</option>)}</select></label>
      <label>옵션 후보<select value={optionSource} onChange={event=>{setOptionSource(event.target.value);setOverride(false);}}><option value="">기존값 유지</option>{options.map(row=><option value={row.id} key={row.id}>{str(row.values.name)} · {str(row.values.optionId)}</option>)}</select></label></div>
    {sku&&<><div className="ops-split"><p><strong>변경 전</strong><br/>{str(sku.values.optionId)||'미연결'}</p><p><strong>변경 후</strong><br/>{chosen?str(chosen.values.optionId):str(sku.values.optionId)||'미연결'}{chosen&&<><br/>{str(chosen.values.name)}<br/>{chosen.source} · 상품ID {str(chosen.values.productId)||'미확인'}</>}</p></div>
      <div className="ops-toolbar">{str(sku.values.optionId)&&chosen&&<label><input type="checkbox" checked={override} onChange={event=>setOverride(event.target.checked)}/>기존 연결을 변경하는 것을 확인했습니다.</label>}<ActionButton disabled={ctx.busy||!chosen||(!!str(sku.values.optionId)&&!override)} onClick={apply}>검토한 연결 저장</ActionButton></div></>}
  </section><RecordPanel ctx={ctx} dataset="skus" title="공통 SKU" description="후보를 SKU로 연결하면 이 상품을 구매·입고·매출·원가 화면에서 함께 사용합니다. 바코드, 쿠팡 SKU ID와 옵션ID는 서로 다른 번호입니다."
    fields={skuFields} columns={[{key:'name',label:'상품명'},{key:'barcode',label:'바코드'},{key:'supplierSkuId',label:'SKU ID'},{key:'optionId',label:'옵션ID'},{key:'supplyPrice',label:'공급단가',format:'money'},{key:'costPrice',label:'기초원가',format:'money'}]}>
    <ActionButton disabled={ctx.busy} onClick={()=>ctx.command({type:'sync-products'})}>기존 YOOFAM 상품 연결</ActionButton>
  </RecordPanel></>;
}

function Discovery({ctx}:{ctx:OperationsContext}) {
  const targets=records(ctx,'watchTargets'), items=records(ctx,'discoveries'), candidates=records(ctx,'sourcingCandidates');
  const verified=items.filter(row=>row.values.verified===true).length;
  const addCandidate=async(row:OpsRecord)=>{
    const v=row.values, productId=str(v.productId), optionId=str(v.optionId);
    const url=productId?`https://www.coupang.com/vp/products/${encodeURIComponent(productId)}${optionId?`?vendorItemId=${encodeURIComponent(optionId)}`:''}`:'';
    await ctx.command({type:'upsert',dataset:'sourcingCandidates',values:{name:str(v.name),nameKo:str(v.name),keyword:str(v.keyword),coupangProductId:productId,optionId,url,price:v.price??null,status:'미검토',memo:'쿠팡 관측 결과에서 담음. 판매자·공급조건을 별도로 확인하세요.'}});
  };
  return <>
    <StatCards items={[{label:'관찰 검색어',value:targets.length},{label:'수집 상품',value:items.length},{label:'검증 표시 상품',value:verified,hint:'수집 원천이 확인한 필드만 검증값으로 사용'},{label:'소싱 후보',value:candidates.length}]} />
    <RecordPanel ctx={ctx} dataset="watchTargets" title="지켜볼 검색어" description="검색어별로 현재 노출 상품을 관찰합니다. 최초 관측일은 쿠팡 공식 등록일이 아닙니다. 수집이 실패하면 기존 관측을 보존합니다."
      fields={[{key:'keyword',label:'쿠팡 검색어',required:true},{key:'enabled',label:'수집 대상',type:'checkbox',default:true}]}
      columns={[{key:'keyword',label:'검색어'},{key:'enabled',label:'사용'}]}
      rowActions={row=>row.values.enabled===false?null:<CollectButton ctx={ctx} kind="discovery" label="이 검색어 수집" values={{keyword:str(row.values.keyword),watchTargetId:row.id}} dataset="discoveries" />} />
    <RecordPanel ctx={ctx} dataset="discoveries" title="관측된 상품" description="수집시각·상품ID·옵션ID와 함께 관측값을 보관합니다. 가격이나 배송방식을 읽지 못한 경우 0이나 직매입으로 추정하지 마세요. 파일 또는 수기로 관측 근거를 추가할 수도 있습니다."
      fields={[
        {key:'keyword',label:'검색어'},{key:'productId',label:'쿠팡 상품ID',required:true},{key:'optionId',label:'옵션ID'},
        {key:'name',label:'상품명',required:true},{key:'price',label:'관측 판매가(원)',type:'number'},
        {key:'delivery',label:'배송방식'},{key:'reviews',label:'리뷰수',type:'number'},{key:'rank',label:'노출순위',type:'number'},
        {key:'sales28',label:'최근 28일 판매수량',type:'number'},{key:'observedAt',label:'관측시각',default:today()},
        {key:'verified',label:'가격·배송 원천 검증됨',type:'checkbox',default:false},
      ]}
      columns={[{key:'name',label:'상품명'},{key:'keyword',label:'검색어'},{key:'price',label:'관측가',format:'money'},{key:'delivery',label:'배송방식'},{key:'sales28',label:'28일 수량',format:'number'},{key:'observedAt',label:'관측시각'},{key:'verified',label:'원천 검증'}]}
      rowActions={row=><ActionButton disabled={ctx.busy} onClick={()=>addCandidate(row)}>후보로 담기</ActionButton>} />
    {derived(ctx,'discoverySummary').length>0&&<ReadTable title="검색어별 수집 요약" rows={derived(ctx,'discoverySummary')} />}
  </>;
}

function RelatedKeywords({ctx}:{ctx:OperationsContext}) {
  const [seed,setSeed]=useState(''),[iterations,setIterations]=useState(15);
  const rows=records(ctx,'keywords'), seeds=new Set(rows.map(row=>str(row.values.seed)).filter(Boolean));
  return <>
    <StatCards items={[{label:'기준 검색어',value:seeds.size},{label:'연관키워드',value:rows.length},{label:'확장 횟수',value:iterations,hint:'1~60회, 검색어별 최대 30개'}]} />
    <section className="ops-panel"><h2>연관키워드 수집</h2><p className="ops-note">기준 검색어의 연관검색어를 찾고, 발견한 검색어를 다시 조회합니다. 결과와 상품수는 수집시각의 관측값입니다.</p>
      <div className="ops-toolbar"><label>기준 검색어<input value={seed} maxLength={40} onChange={event=>setSeed(event.target.value)} placeholder="예: 러닝벨트" /></label>
        <label>확장 횟수<input type="number" min={1} max={60} value={iterations} onChange={event=>setIterations(Math.max(1,Math.min(60,Number(event.target.value)||1)))} /></label>
        {seed.trim()?<CollectButton ctx={ctx} kind="relatedKeywords" label="연관키워드 수집" values={{keyword:seed.trim(),seed:seed.trim(),iterations}} dataset="keywords" />:<span className="ops-note">검색어를 입력하세요.</span>}
      </div>
    </section>
    <RecordPanel ctx={ctx} dataset="keywords" title="연관키워드 목록" description="검색어를 수정하거나 검토한 키워드를 직접 추가할 수 있습니다. 빈 상품수는 미조회이며 상품수 0과 구분됩니다."
      initialValues={{seed:seed.trim(),collectedAt:today()}} fields={[
        {key:'seed',label:'기준 검색어',required:true},{key:'keyword',label:'연관키워드',required:true},
        {key:'productCount',label:'쿠팡 상품수',type:'number'},{key:'collectedAt',label:'수집일',type:'date',default:today()},
      ]} columns={[{key:'seed',label:'기준 검색어'},{key:'keyword',label:'연관키워드'},{key:'productCount',label:'상품수',format:'number'},{key:'collectedAt',label:'수집일'}]}
      rowActions={row=><CollectButton ctx={ctx} kind="keywordSearch" label="상품 조회" values={{keyword:str(row.values.keyword)}} dataset="discoveries" />} />
    {derived(ctx,'keywordSummary').length>0&&<ReadTable title="키워드별 상품 지표" rows={derived(ctx,'keywordSummary')} />}
  </>;
}

function KeywordSearch({ctx}:{ctx:OperationsContext}) {
  const [keyword,setKeyword]=useState(''),[delivery,setDelivery]=useState('전체');
  const all=records(ctx,'discoveries');
  const matches=all.filter(row=>(!keyword.trim()||str(row.values.keyword).toLowerCase().includes(keyword.trim().toLowerCase()))&&(delivery==='전체'||str(row.values.delivery).includes(delivery)));
  const qty=matches.reduce((sum,row)=>sum+num(row.values.sales28),0);
  const revenue=matches.reduce((sum,row)=>sum+(row.values.sales28!=null&&row.values.price!=null?num(row.values.sales28)*num(row.values.price):0),0);
  const fields:Field[]=[{key:'keyword',label:'검색어',required:true},{key:'productId',label:'상품ID',required:true},{key:'optionId',label:'옵션ID'},{key:'name',label:'상품명',required:true},{key:'price',label:'관측 판매가(원)',type:'number'},{key:'rank',label:'순위',type:'number'},{key:'delivery',label:'배송방식'},{key:'pv',label:'28일 조회수',type:'number'},{key:'sales28',label:'28일 판매수량',type:'number'},{key:'reviews',label:'리뷰수',type:'number'},{key:'observedAt',label:'관측시각',default:today()}];
  return <>
    <StatCards items={[{label:'표시 상품수',value:matches.length},{label:'28일 판매수량 합',value:qty.toLocaleString('ko-KR')},{label:'추정매출 합',value:won(revenue),hint:'관측 판매가 × 28일 수량. 정산매출과 다릅니다.'}]} />
    <section className="ops-panel"><h2>키워드 조회</h2><div className="ops-toolbar"><label>쿠팡 검색어<input value={keyword} maxLength={40} onChange={event=>setKeyword(event.target.value)} placeholder="검색어 입력" /></label>
      <label>배송방식<select value={delivery} onChange={event=>setDelivery(event.target.value)}><option>전체</option><option>로켓</option><option>그로스</option><option>판매자</option></select></label>
      {keyword.trim()?<CollectButton ctx={ctx} kind="keywordSearch" label="현재 검색어 조회" values={{keyword:keyword.trim()}} dataset="discoveries" />:<span className="ops-note">조회할 검색어를 입력하세요.</span>}
    </div><p className="ops-note">순위·가격·조회수·28일 판매량을 수집 원천과 함께 보관합니다. 상품 단위와 옵션 단위의 집계 범위를 확인한 뒤 소싱을 결정하세요.</p></section>
    <RecordPanel ctx={ctx} dataset="discoveries" title="키워드 상품 결과" fields={fields} initialValues={{keyword:keyword.trim(),observedAt:today()}}
      filter={row=>matches.some(item=>item.id===row.id)}
      columns={[{key:'rank',label:'순위',format:'number'},{key:'name',label:'상품명'},{key:'delivery',label:'배송방식'},{key:'price',label:'관측가',format:'money'},{key:'pv',label:'28일 조회수',format:'number'},{key:'sales28',label:'28일 수량',format:'number'},{key:'optionId',label:'옵션ID'}]} />
  </>;
}

const tokenize=(value:string)=>[...new Set((value.toLowerCase().match(/[가-힣a-z]{2,}/g)??[]).filter(word=>!['상품','제품','배송','너무','정말','사용','구매','합니다','있어요','그리고','이렇게','저는','해서','하는'].includes(word)))];

function Reviews({ctx}:{ctx:OperationsContext}) {
  const [productInput,setProductInput]=useState(''),[productFilter,setProductFilter]=useState('전체'),[ratingFilter,setRatingFilter]=useState('전체');
  const reviewRows=records(ctx,'reviews');
  const products=[...new Set(reviewRows.map(row=>str(row.values.productId)).filter(Boolean))];
  const selected=reviewRows.filter(row=>productFilter==='전체'||str(row.values.productId)===productFilter);
  const visible=selected.filter(row=>ratingFilter==='전체'||num(row.values.rating)===Number(ratingFilter));
  const valid=selected.filter(row=>num(row.values.rating)>=1&&num(row.values.rating)<=5);
  const average=valid.length?valid.reduce((sum,row)=>sum+num(row.values.rating),0)/valid.length:0;
  const positive=valid.filter(row=>num(row.values.rating)>=4), negative=valid.filter(row=>num(row.values.rating)<=2);
  const words=useMemo(()=>{
    const map=new Map<string,{word:string;positive:number;negative:number;total:number}>();
    for(const row of selected){const v=row.values,rating=num(v.rating);for(const word of tokenize(`${str(v.title)} ${str(v.body)}`)){const stat=map.get(word)??{word,positive:0,negative:0,total:0};stat.total++;if(rating>=4)stat.positive++;if(rating<=2)stat.negative++;map.set(word,stat);}}
    return [...map.values()].filter(row=>row.total>=2).sort((a,b)=>b.total-a.total).slice(0,30);
  },[selected]);
  const monthly=useMemo(()=>{
    const map=new Map<string,{month:string;count:number;ratingSum:number;positive:number;negative:number}>();
    for(const row of valid){const date=str(row.values.date),month=date.slice(0,7);if(!/^\d{4}-\d{2}$/.test(month))continue;const stat=map.get(month)??{month,count:0,ratingSum:0,positive:0,negative:0};stat.count++;stat.ratingSum+=num(row.values.rating);if(num(row.values.rating)>=4)stat.positive++;if(num(row.values.rating)<=2)stat.negative++;map.set(month,stat);}
    return [...map.values()].sort((a,b)=>b.month.localeCompare(a.month)).slice(0,24).map(row=>({...row,average:Math.round(row.ratingSum/row.count*100)/100}));
  },[valid]);
  const productId=productInput.trim().match(/\/products\/(\d+)/)?.[1]??(/^\d+$/.test(productInput.trim())?productInput.trim():'');
  return <>
    <section className="ops-panel"><h2>리뷰 분석</h2><div className="ops-toolbar"><label>쿠팡 상품 URL 또는 상품ID<input value={productInput} onChange={event=>setProductInput(event.target.value)} placeholder="https://www.coupang.com/vp/products/…" /></label>
      {productId?<CollectButton ctx={ctx} kind="reviews" label="리뷰 수집" values={{productId}} dataset="reviews" />:<span className="ops-note">숫자 상품ID 또는 쿠팡 상품 URL을 입력하세요.</span>}
      <label>상품<select value={productFilter} onChange={event=>setProductFilter(event.target.value)}><option>전체</option>{products.map(id=><option key={id}>{id}</option>)}</select></label>
      <label>별점<select value={ratingFilter} onChange={event=>setRatingFilter(event.target.value)}><option>전체</option>{[5,4,3,2,1].map(rating=><option key={rating} value={rating}>{rating}점</option>)}</select></label>
    </div><p className="ops-note">수집된 리뷰만 분석합니다. 중단·차단·일부 페이지만 수집된 표본은 전체 리뷰와 다를 수 있습니다. 반복 어휘는 이 화면에서 계산하며 외부 AI로 원문을 전송하지 않습니다.</p></section>
    <StatCards items={[{label:'분석 리뷰',value:valid.length},{label:'평균 별점',value:valid.length?average.toFixed(2):'—'},{label:'긍정 4~5점',value:valid.length?`${(positive.length/valid.length*100).toFixed(1)}%`:'—'},{label:'부정 1~2점',value:valid.length?`${(negative.length/valid.length*100).toFixed(1)}%`:'—'}]} />
    <div className="ops-split"><ReadTable title="반복 표현" description="리뷰 한 건당 단어를 한 번만 세고, 2건 이상 언급된 표현을 표시합니다." rows={words} columns={[{key:'word',label:'표현'},{key:'total',label:'언급 리뷰',format:'number'},{key:'positive',label:'4~5점',format:'number'},{key:'negative',label:'1~2점',format:'number'}]} />
      <ReadTable title="월별 리뷰 추이" rows={monthly} columns={[{key:'month',label:'월'},{key:'count',label:'리뷰수',format:'number'},{key:'average',label:'평균 별점',format:'number'},{key:'negative',label:'부정',format:'number'}]} /></div>
    <RecordPanel ctx={ctx} dataset="reviews" title="리뷰 원문" description="상품ID와 작성일을 보존한 파일을 가져오거나 수기로 추가할 수 있습니다." initialValues={{productId,date:today()}} filter={row=>visible.some(item=>item.id===row.id)}
      fields={[{key:'productId',label:'상품ID',required:true},{key:'rating',label:'별점(1~5)',type:'number',required:true},{key:'date',label:'작성일',type:'date',required:true},{key:'option',label:'옵션'},{key:'title',label:'제목'},{key:'body',label:'리뷰 본문',type:'textarea',required:true},{key:'helpful',label:'도움됨',type:'number',default:0}]}
      columns={[{key:'rating',label:'별점',format:'number'},{key:'date',label:'작성일'},{key:'option',label:'옵션'},{key:'title',label:'제목'},{key:'body',label:'내용'},{key:'helpful',label:'도움됨',format:'number'}]} />
  </>;
}

function Compare({ctx}:{ctx:OperationsContext}) {
  const [selected,setSelected]=useState('');
  const candidates=records(ctx,'sourcingCandidates'), comparisons=records(ctx,'comparisons');
  const candidate=candidates.find(row=>row.id===selected);
  const connected=candidate?comparisons.filter(row=>str(row.values.candidateId)===candidate.id):comparisons;
  const linkRows:Values[]=connected.map(row=>({...row.values,candidate:candidates.find(item=>item.id===str(row.values.candidateId))?.values.nameKo??candidates.find(item=>item.id===str(row.values.candidateId))?.values.name??'',id:row.id}));
  return <>
    <StatCards items={[{label:'공급 후보',value:candidates.length},{label:'비교 상품',value:comparisons.length},{label:'제안 후보',value:candidates.filter(row=>row.values.status==='제안 후보').length},{label:'연결된 SKU',value:records(ctx,'skus').filter(row=>!!row.values.sourceProductId).length}]} />
    <section className="ops-panel"><h2>1688 소싱·로켓 비교</h2><p className="ops-note">공급 후보와 쿠팡 상품을 나란히 검토하고 차별점을 기록합니다. ‘제안 후보’는 내부 검토 상태이며 쿠팡 제출이 아닙니다.</p>
      <div className="ops-toolbar"><a href="https://www.1688.com" target="_blank" rel="noreferrer">1688 검색 열기 ↗</a>
        <label>비교할 후보<select value={selected} onChange={event=>setSelected(event.target.value)}><option value="">전체 후보</option>{candidates.map(row=><option key={row.id} value={row.id}>{str(row.values.nameKo)||str(row.values.name)}</option>)}</select></label>
        {candidate&&str(candidate.values.keyword).trim()&&<CollectButton ctx={ctx} kind="coupangCompare" label="후보 검색어로 쿠팡 비교" values={{keyword:str(candidate.values.keyword),candidateId:candidate.id}} dataset="comparisons" />}
      </div>
      {candidate&&<p><strong>{str(candidate.values.nameKo)||str(candidate.values.name)}</strong> · 표시가격 {str(candidate.values.price)||'미확인'} · {str(candidate.values.memo)||'차별점 메모를 추가하세요.'}</p>}
    </section>
    <RecordPanel ctx={ctx} dataset="sourcingCandidates" title="소싱 후보" fields={candidateFields} columns={[{key:'nameKo',label:'한국어명'},{key:'name',label:'원문명'},{key:'offerId',label:'1688 번호'},{key:'price',label:'표시가격'},{key:'keyword',label:'쿠팡 검색어'},{key:'status',label:'검토 상태'},{key:'memo',label:'차별점·메모'}]}
      rowActions={row=><><ActionButton onClick={()=>setSelected(row.id)}>비교 보기</ActionButton><ActionButton disabled={ctx.busy} onClick={async()=>{if(window.confirm(`‘${str(row.values.nameKo)||str(row.values.name)}’을 공통 SKU로 연결할까요? 연결 후 구매·재고·판매에서 선택할 수 있습니다.`))await ctx.command({type:'promote-candidate',id:row.id});}}>SKU로 연결</ActionButton></>} />
    <ReadTable title="후보별 비교 요약" rows={linkRows} columns={[{key:'candidate',label:'공급 후보'},{key:'name',label:'쿠팡 상품'},{key:'price',label:'판매가',format:'money'},{key:'seller',label:'확인 판매자'},{key:'delivery',label:'배송방식'},{key:'decision',label:'비교 판단'},{key:'evidence',label:'확인 근거'},{key:'memo',label:'차별점'}]} />
    {candidate?<RecordPanel ctx={ctx} dataset="comparisons" title="비교 근거 기록" description="판매자명·옵션ID·근거 URL을 함께 기록하세요. 목록의 로켓 배지만으로 직매입이라고 확정하지 않습니다."
      initialValues={{candidateId:candidate.id}} filter={row=>str(row.values.candidateId)===candidate.id}
      fields={[{key:'candidateId',label:'공급 후보ID',required:true,default:candidate.id},{key:'productId',label:'쿠팡 상품ID',required:true},{key:'optionId',label:'옵션ID'},{key:'name',label:'상품명',required:true},{key:'price',label:'판매가(원)',type:'number'},{key:'seller',label:'판매자명'},{key:'delivery',label:'판매방식',type:'select',options:['미확인','직매입 확인','그로스','판매자배송'],default:'미확인'},{key:'decision',label:'비교 판단',type:'select',options:['판단 보류','동일·유사','차별점 있음'],default:'판단 보류'},{key:'evidence',label:'확인 근거 URL·시각',type:'textarea'},{key:'memo',label:'기능·규격·구성의 차이',type:'textarea'}]} />:<p className="ops-note">위에서 공급 후보를 고르면 비교 근거를 추가하거나 수정할 수 있습니다.</p>}
    <SkuWorkspace ctx={ctx} />
  </>;
}

export function SourcingView({view,ctx}:{view:string;ctx:OperationsContext}) {
  const content=view==='related'?<RelatedKeywords ctx={ctx}/>:view==='keyword'?<KeywordSearch ctx={ctx}/>:view==='reviews'?<Reviews ctx={ctx}/>:view==='compare'?<Compare ctx={ctx}/>:<Discovery ctx={ctx}/>;
  return <>
    <details className="ops-panel"><summary><strong>소싱 순서 · 검색어 → 수요 → 리뷰 → 공급비교 → SKU 연결</strong></summary>
      <ol>
        <li><a href="/operations?view=discovery">신규상품 발굴</a>에서 관찰할 검색어를 등록하고 후보를 모읍니다.</li>
        <li><a href="/operations?view=related">연관키워드</a>로 검색 범위를 넓히고, <a href="/operations?view=keyword">키워드 조회</a>에서 상품별 28일 수량·가격을 확인합니다.</li>
        <li><a href="/operations?view=reviews">리뷰분석</a>에서 반복되는 불만과 옵션·구성의 차이를 찾습니다. 상품번호가 같은지 대조하세요.</li>
        <li><a href="/operations?view=compare">1688 소싱·로켓 비교</a>에 공급 후보와 차별점 근거를 기록하고, 검토한 후보를 공통 SKU로 연결합니다.</li>
      </ol><p className="ops-note">SKU로 연결한 뒤 구매·수입원가와 실제 판매를 입력하면 동일 상품의 재고·매출원가·손익으로 이어집니다. 가격·공급조건·판매자 근거가 미확인인 후보는 확인 후 진행하세요.</p>
    </details>
    {content}
  </>;
}
