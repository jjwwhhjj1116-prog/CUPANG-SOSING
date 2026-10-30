'use client';

import {useState} from 'react';
import {derived,num,records,str,type Field,type OperationsContext,type OpsRecord,type TableColumn,type Values} from '../types';
import {CollectButton,ReadTable,RecordPanel,StatCards} from './shared';

const money=(value:unknown)=>`${num(value).toLocaleString('ko-KR')}원`;
const count=(value:unknown)=>num(value).toLocaleString('ko-KR');
const periodOf=(ctx:OperationsContext)=>ctx.month||String(ctx.year);
const inPeriod=(values:Values,ctx:OperationsContext,key='date')=>str(values[key]).startsWith(periodOf(ctx));
const defaultDate=(ctx:OperationsContext)=>{
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
 return ctx.month?`${ctx.month}-01`:today.startsWith(String(ctx.year))?today:`${ctx.year}-01-01`;
};
const sum=(rows:Values[],key:string)=>rows.reduce((total,row)=>total+num(row[key]),0);
const skuField:Field={key:'skuId',label:'상품 SKU',type:'sku',required:true};
const dateField:Field={key:'date',label:'일자',type:'date',required:true};

function namedRows(ctx:OperationsContext,rows:Values[]):Values[]{
 const skus=new Map(records(ctx,'skus').map(row=>[row.id,str(row.values.name)]));
 const campaigns=new Map(records(ctx,'campaigns').map(row=>[row.id,str(row.values.name)]));
 return rows.map(row=>({...row,skuName:row.skuName??skus.get(str(row.skuId))??str(row.skuId),campaignName:row.campaignName??campaigns.get(str(row.campaignId??row.id))??str(row.campaignId)}));
}

function SkuFilter({ctx,value,onChange}:{ctx:OperationsContext;value:string;onChange:(value:string)=>void}){
 return <label className="ops-field">상품 범위 <select value={value} onChange={event=>onChange(event.target.value)} aria-label="분석할 상품"><option value="">전체 상품</option>{records(ctx,'skus').map(row=><option key={row.id} value={row.id}>{str(row.values.name)} {str(row.values.barcode)}</option>)}</select></label>;
}

function SparkBars({rows,label,valueKey,labelKey='date'}:{rows:Values[];label:string;valueKey:string;labelKey?:string}){
 const available=rows.filter(row=>row[valueKey]!=null&&Number.isFinite(Number(row[valueKey]))).slice(-31);
 if(!available.length)return <p className="ops-empty">표시할 {label} 관측값이 없습니다.</p>;
 const maximum=Math.max(...available.map(row=>Math.abs(num(row[valueKey]))),1);
 return <div role="img" aria-label={`${label}: ${available.map(row=>`${str(row[labelKey])} ${count(row[valueKey])}`).join(', ')}`} style={{display:'flex',alignItems:'end',gap:4,minHeight:130,padding:'16px 0 4px',overflowX:'auto'}}>{available.map((row,index)=><div key={`${str(row[labelKey])}-${index}`} title={`${str(row[labelKey])} · ${label} ${count(row[valueKey])}`} style={{flex:'1 0 18px',minWidth:18,textAlign:'center'}}><div style={{height:`${Math.max(3,Math.abs(num(row[valueKey]))/maximum*100)}px`,background:num(row[valueKey])<0?'#ce5c59':'#316eae',borderRadius:'4px 4px 0 0'}}/><span style={{fontSize:10,color:'#677589'}}>{str(row[labelKey]).slice(-2)}</span></div>)}</div>;
}

function Inventory({ctx}:{ctx:OperationsContext}){
 const [selected,setSelected]=useState('');
 const snapshots=records(ctx,'inventorySnapshots').filter(row=>str(row.values.businessDate??row.values.date).startsWith(String(ctx.year))).sort((a,b)=>str(b.values.businessDate??b.values.date).localeCompare(str(a.values.businessDate??a.values.date))||b.createdAt.localeCompare(a.createdAt));
 const selectedId=selected&&snapshots.some(row=>row.id===selected)?selected:snapshots[0]?.id??'';
 const rows=namedRows(ctx,derived(ctx,'inventoryRows'));
 const known=rows.filter(row=>row.stock!=null);
 return <>
  <StatCards items={[{label:'관리 SKU',value:records(ctx,'skus').length},{label:'재고가 확인된 SKU',value:known.length},{label:'확인 재고수량',value:count(sum(known,'stock')),hint:'관측된 수량만 합산'},{label:'실제 재고 0',value:known.filter(row=>num(row.stock)===0).length,hint:'미수집 상품과 구별합니다'}]}/>
  <div className="ops-toolbar"><CollectButton ctx={ctx} kind="inventory" label="광고센터 재고 가져오기" dataset="inventoryLines"/><span className="ops-note">수집한 재고는 업무 기준일에 연결됩니다. 빈값은 품절 0으로 계산하지 않습니다.</span></div>
  <ReadTable title="최근 확인 재고" description="완료된 수집의 최신 재고를 SKU별로 보여줍니다." rows={rows} columns={[{key:'skuName',label:'상품'},{key:'barcode',label:'바코드'},{key:'optionId',label:'옵션 ID'},{key:'date',label:'기준일',format:'date'},{key:'stock',label:'재고',format:'number'},{key:'price',label:'판매가',format:'money'},{key:'quality',label:'자료 상태'}]} empty="재고 자료가 없습니다. 광고센터에서 가져오거나 아래에 기준일과 SKU 재고를 입력하세요."/>
  <RecordPanel ctx={ctx} dataset="inventorySnapshots" title="재고 수집 이력" description="수집 시각의 날짜와 재고가 귀속될 업무 기준일을 구분합니다. 직접 입력할 때는 SKU 재고를 모두 입력한 후 완료로 바꾸세요." initialValues={{date:defaultDate(ctx),businessDate:defaultDate(ctx),complete:false}} fields={[{key:'date',label:'수집일',type:'date',required:true},{key:'businessDate',label:'업무 기준일',type:'date',required:true},{key:'complete',label:'전체 수집 완료',type:'checkbox'},{key:'memo',label:'수집 메모'}]} columns={[{key:'date',label:'수집일'},{key:'businessDate',label:'업무 기준일'},{key:'complete',label:'전체 완료'},{key:'memo',label:'메모'}]}/>
  <section className="ops-panel"><div className="ops-toolbar"><label className="ops-field">재고를 입력할 이력 <select aria-label="재고 입력 이력" value={selectedId} onChange={event=>setSelected(event.target.value)}><option value="">이력을 먼저 만드세요</option>{snapshots.map(row=><option key={row.id} value={row.id}>{str(row.values.businessDate??row.values.date)} · {row.values.complete?'완료':'입력 중'} · {str(row.values.memo)||row.id.slice(0,8)}</option>)}</select></label></div><p className="ops-note">수집 이력 하나에 SKU별 재고를 한 번씩 연결합니다. 실제 재고가 없으면 0을 입력합니다.</p></section>
  {selectedId?<RecordPanel ctx={ctx} dataset="inventoryLines" title="SKU별 재고 입력" initialValues={{snapshotId:selectedId}} filter={row=>row.values.snapshotId===selectedId} fields={[skuField,{key:'stock',label:'관측 재고수량',type:'number',required:true},{key:'price',label:'관측 판매가',type:'number'}]} columns={[{key:'skuId',label:'상품 SKU'},{key:'stock',label:'재고수량',format:'number'},{key:'price',label:'판매가',format:'money'}]}/>:null}
 </>;
}

function SalesReport({ctx}:{ctx:OperationsContext}){
 const [sku,setSku]=useState('');
 const rows=namedRows(ctx,derived(ctx,'salesDaily')).filter(row=>inPeriod(row,ctx)&&(!sku||str(row.skuId)===sku));
 const normalized:Values[]=rows.map(row=>({...row,estimatedSales:row.estimatedSales??row.sales??null,previousStock:row.previousStock??row.previousInventory??null,currentStock:row.currentStock??row.stock??null}));
 const valid=normalized.filter(row=>row.estimatedSales!=null);
 const daily=Object.values(normalized.reduce<Record<string,Values>>((acc,row)=>{const key=str(row.date);const item=acc[key]??{date:key,estimatedSales:0};if(row.estimatedSales==null)item.unknown=true;else item.estimatedSales=num(item.estimatedSales)+num(row.estimatedSales);acc[key]=item;return acc;},{})).map(row=>({...row,estimatedSales:row.unknown?null:row.estimatedSales}));
 return <>
  <StatCards items={[{label:'관측된 SKU·일',value:valid.length},{label:'자료 부족 SKU·일',value:normalized.length-valid.length},{label:'추정 판매수량',value:valid.length?count(sum(valid,'estimatedSales')):'미확인',hint:'주문 원장이 아닌 재고 차감 추정치'},{label:'연결 입고수량',value:count(sum(rows,'inbound'))}]}/>
  <section className="ops-panel"><div className="ops-toolbar"><SkuFilter ctx={ctx} value={sku} onChange={setSku}/><CollectButton ctx={ctx} kind="inventory" label="재고 수집" dataset="inventoryLines"/><CollectButton ctx={ctx} kind="inbound" label="입고 수집" dataset="inboundEvents"/></div><p className="ops-note">추정판매 = 전일 재고 − 당일 재고 + 해당 SKU의 당일 입고. 양일 중 재고가 없으면 미확인으로 표시합니다. 상품을 좁히면 입고도 같은 상품 범위로 계산합니다.</p><SparkBars rows={daily} valueKey="estimatedSales" label="일별 추정판매"/></section>
  <ReadTable title="일별 판매 현황" rows={normalized} columns={[{key:'date',label:'기준일',format:'date'},{key:'skuName',label:'상품'},{key:'previousStock',label:'전일 재고',format:'number'},{key:'inbound',label:'입고',format:'number'},{key:'currentStock',label:'당일 재고',format:'number'},{key:'estimatedSales',label:'추정판매',format:'number'},{key:'adCost',label:'광고비',format:'money'},{key:'netMargin',label:'추정마진',format:'money'},{key:'quality',label:'자료 상태'}]} empty="연속한 두 날짜의 재고와 입고 자료를 등록하면 판매 추정치를 볼 수 있습니다."/>
 </>;
}

type RevenueTab='rocket'|'deductions'|'general'|'subsidiary'|'other';
function Revenue({ctx}:{ctx:OperationsContext}){
 const [tab,setTab]=useState<RevenueTab>('rocket');
 const labels:Record<RevenueTab,string>={rocket:'로켓매출',deductions:'매출 차감',general:'일반매출',subsidiary:'자회사 판매',other:'기타매출'};
 const scope=records(ctx,'sales').filter(row=>inPeriod(row.values,ctx));
 const rows=scope.filter(row=>row.values.type===tab);
 const tabs=Object.entries(labels) as [RevenueTab,string][];
 const supplyOf=(row:OpsRecord)=>row.values.type==='rocket'?num(row.values.qty)*num(row.values.supply):row.values.supply!=null?num(row.values.supply):Math.round(num(row.values.price)/1.1);
 const included=scope.filter(row=>row.values.type!=='subsidiary'&&!['cancelled','scheduled'].includes(str(row.values.status)));
 const deductions=records(ctx,'salesDeductions').filter(row=>inPeriod(row.values,ctx,'month')).reduce((total,row)=>total+num(row.values.amount),0);
 const fields:Field[]=[dateField,...(tab==='other'?[{key:'name',label:'매출 내용',required:true} as Field]:[skuField]),{key:'qty',label:tab==='rocket'?'실제 입고수량':'출고수량',type:'number',required:true}];
 if(tab==='rocket')fields.push({key:'supply',label:'개당 공급단가 (부가세 제외)',type:'number',required:true},{key:'po',label:'발주번호'},{key:'expectedDate',label:'입고예정일',type:'date'},{key:'status',label:'발주 상태',type:'select',options:['received','scheduled','cancelled'],default:'received'});
 else fields.push({key:'price',label:'행 전체 판매금액 (부가세 포함)',type:'number',required:true});
 if(tab==='subsidiary')fields.push({key:'company',label:'상대 자회사',required:true});
 fields.push({key:'memo',label:'적요',type:'textarea'});
 return <>
  <StatCards items={[{label:'외부 매출 공급가액',value:money(included.reduce((total,row)=>total+supplyOf(row),0))},{label:'매출 차감',value:money(deductions),hint:'음수 금액은 환입'},{label:'차감 후 외부 매출',value:money(included.reduce((total,row)=>total+supplyOf(row),0)-deductions)},{label:'자회사 거래',value:scope.filter(row=>row.values.type==='subsidiary').length,hint:'손익 매출에서 제외'}]}/>
  <div className="ops-tabs" role="tablist" aria-label="매출 유형">{tabs.map(([key,label])=><button key={key} type="button" role="tab" aria-selected={tab===key} className={tab===key?'is-active':''} onClick={()=>setTab(key)}>{label}</button>)}</div>
  {tab==='deductions'?<RecordPanel key="deductions" ctx={ctx} dataset="salesDeductions" title="공제코드별 매출 차감" description="성장장려금·프로모션비 등 부가세를 제외한 월별 공제를 입력합니다. 양수는 차감, 음수는 환입입니다." initialValues={{month:ctx.month||`${ctx.year}-01`}} filter={row=>inPeriod(row.values,ctx,'month')} fields={[{key:'month',label:'귀속월',type:'month',required:true},{key:'code',label:'공제코드',required:true},{key:'name',label:'공제항목',required:true},{key:'amount',label:'차감금액',type:'number',required:true}]} columns={[{key:'month',label:'귀속월'},{key:'code',label:'공제코드'},{key:'name',label:'항목'},{key:'amount',label:'차감금액',format:'money'}]}/>:<>
   {tab==='subsidiary'?<p className="ops-note">자회사 출고는 재고에서 빠지지만 손익계산서의 매출과 해당 출고원가에서는 제외됩니다. 이 화면은 세금계산서를 발행하지 않습니다.</p>:null}
   <RecordPanel key={tab} ctx={ctx} dataset="sales" title={labels[tab]} description={tab==='rocket'?'공급단가는 개당 금액입니다. 매출은 실제 입고수량 × 공급단가로 계산합니다.':tab==='other'?'상품 판매와 구분되는 기타 수입입니다. 이 매출에는 재고 출고원가를 만들지 않습니다.':'판매금액은 이 행 전체의 금액입니다. 수량에 다시 곱하지 않으며 부가세를 분리해 손익에 연결합니다.'} initialValues={{type:tab,date:defaultDate(ctx),status:tab==='rocket'?'received':'confirmed'}} filter={row=>row.values.type===tab&&inPeriod(row.values,ctx)} fields={fields} columns={[{key:'date',label:'매출일'},{key:tab==='other'?'name':'skuId',label:tab==='other'?'내용':'상품 SKU'},{key:'qty',label:'수량',format:'number'},{key:tab==='rocket'?'supply':'price',label:tab==='rocket'?'개당 공급가':'전체 판매금액',format:'money'},...(tab==='rocket'?[]:[{key:'supply',label:'공급가액 (자동)',format:'money' as const},{key:'vat',label:'부가세 (자동)',format:'money' as const}]),{key:'company',label:'상대 회사'},{key:'memo',label:'적요'}]}>
    {tab==='rocket'?<CollectButton ctx={ctx} kind="rocketSales" label="서플라이어허브 매출 가져오기" dataset="sales" values={{type:'rocket'}}/>:null}
   </RecordPanel>
   <p className="ops-note">현재 유형 {rows.length}건 · 수량 {count(rows.reduce((total,row)=>total+num(row.values.qty),0))} · 공급가액 {money(rows.reduce((total,row)=>total+supplyOf(row),0))}</p>
  </>}
 </>;
}

function Inbound({ctx}:{ctx:OperationsContext}){
 const rows=records(ctx,'inboundEvents').filter(row=>inPeriod(row.values,ctx));
 const received=rows.filter(row=>row.values.type!=='outbound'),returned=rows.filter(row=>row.values.type==='outbound');
 return <>
  <StatCards items={[{label:'입고 건수',value:received.length},{label:'입고 수량',value:count(received.reduce((s,row)=>s+num(row.values.qty),0))},{label:'반출 건수',value:returned.length},{label:'반출 수량',value:count(returned.reduce((s,row)=>s+Math.abs(num(row.values.qty)),0))}]}/>
  <RecordPanel ctx={ctx} dataset="inboundEvents" title="입고·반출 내역" description="발주번호·SKU·실제 시각을 보존합니다. 분할 입고는 각각 기록하며 같은 내역을 다시 가져오면 중복을 점검합니다." initialValues={{date:defaultDate(ctx),type:'inbound'}} filter={row=>inPeriod(row.values,ctx)} fields={[dateField,{key:'occurredAt',label:'실제 입고·반출 시각',hint:'예: 2026-10-30T09:30:00+09:00'},skuField,{key:'type',label:'구분',type:'select',options:['inbound','outbound'],required:true},{key:'po',label:'발주번호',required:true},{key:'qty',label:'수량',type:'number',required:true},{key:'center',label:'물류센터'},{key:'supply',label:'공급가액',type:'number'},{key:'vat',label:'부가세',type:'number'},{key:'invoice',label:'계산서번호'},{key:'payday',label:'지급일',type:'date'},{key:'memo',label:'메모'}]} columns={[{key:'date',label:'입고일'},{key:'occurredAt',label:'실제 시각'},{key:'type',label:'구분'},{key:'po',label:'발주번호'},{key:'skuId',label:'상품 SKU'},{key:'qty',label:'수량',format:'number'},{key:'center',label:'센터'},{key:'supply',label:'공급가액',format:'money'},{key:'invoice',label:'계산서번호'}]}><CollectButton ctx={ctx} kind="inbound" label="서플라이어허브 입고 가져오기" dataset="inboundEvents"/></RecordPanel>
 </>;
}

const metricFields:Field[]=[dateField,{key:'campaignId',label:'광고캠페인',type:'campaign',required:true},{key:'skuId',label:'광고 상품 SKU',type:'sku'},{key:'placement',label:'노출 지면',type:'select',options:['search','nonSearch','audience','retargeting'],default:'search'},{key:'keyword',label:'검색 키워드'},{key:'attributionDays',label:'전환 귀속기간 (일)',type:'select',options:['1','14'],default:'14'},{key:'impressions',label:'노출수',type:'number',required:true},{key:'clicks',label:'클릭수',type:'number',required:true},{key:'cost',label:'광고비',type:'number',required:true},{key:'revenue',label:'광고 전환매출',type:'number',required:true},{key:'orders',label:'전환 주문수',type:'number'},{key:'units',label:'전환 판매수량',type:'number'}];

function AdReports({ctx}:{ctx:OperationsContext}){
 const [attribution,setAttribution]=useState('14'),[campaign,setCampaign]=useState('');
 const source=records(ctx,'adMetrics').filter(row=>inPeriod(row.values,ctx)&&(!campaign||row.values.campaignId===campaign)&&str(row.values.attributionDays??'14')===attribution);
 const totals=source.reduce((a,row)=>{for(const key of ['impressions','clicks','cost','revenue','orders','units'])a[key]+=num(row.values[key]);return a;},{impressions:0,clicks:0,cost:0,revenue:0,orders:0,units:0} as Record<string,number>);
 const unitsKnown=source.length>0&&source.every(row=>row.values.units!=null&&row.values.units!=='');
 const aggregate=(key:string)=>Object.entries(source.reduce<Record<string,Values[]>>((a,row)=>{const group=str(row.values[key])||'미지정';(a[group]??=[]).push(row.values);return a;},{})).map(([name,items])=>{
  const m=Object.fromEntries(['impressions','clicks','cost','revenue','orders','units'].map(metric=>[metric,items.every(row=>row[metric]!=null&&row[metric]!=='')?sum(items,metric):null])) as Record<string,number|null>;
  return {name,...m,ctr:m.impressions&&m.clicks!=null?m.clicks/m.impressions*100:null,cvrUnits:m.clicks&&m.units!=null?m.units/m.clicks*100:null,cpc:m.clicks&&m.cost!=null?m.cost/m.clicks:null,roas:m.cost&&m.revenue!=null?m.revenue/m.cost*100:null,cpa:m.units&&m.cost!=null?m.cost/m.units:null};
 });
 const areaRows=aggregate('placement').map(row=>{
  const isSearch=row.name==='search',ctrTarget=isSearch?2.5:.1,cvrTarget=isSearch?15:4.5;
  const strategy=row.ctr==null||row.cvrUnits==null?'자료 부족':row.ctr<ctrTarget&&row.cvrUnits<cvrTarget?'노출 상품·키워드와 상세페이지를 함께 점검':row.ctr<ctrTarget?'대표 이미지·가격·키워드 적합성 점검':row.cvrUnits<cvrTarget?'상세페이지·옵션·후기·가격 점검':'수익과 재고를 확인하며 예산 검토';
  return {...row,name:({search:'검색',nonSearch:'비검색',audience:'오디언스',retargeting:'리타겟팅'} as Record<string,string>)[row.name]??row.name,strategy};
 });
 const cols:TableColumn[]=[{key:'name',label:'구분'},{key:'impressions',label:'노출',format:'number'},{key:'clicks',label:'클릭',format:'number'},{key:'cost',label:'광고비',format:'money'},{key:'revenue',label:'전환매출',format:'money'},{key:'units',label:'판매수량',format:'number'},{key:'ctr',label:'클릭률',format:'percent'},{key:'cvrUnits',label:'수량 전환율',format:'percent'},{key:'roas',label:'ROAS',format:'percent'},{key:'cpc',label:'클릭당 비용',format:'money'},{key:'cpa',label:'판매당 비용',format:'money'}];
 return <>
  <StatCards items={[{label:'집행 광고비',value:money(totals.cost)},{label:'전환매출',value:money(totals.revenue)},{label:'광고 ROAS',value:totals.cost?`${(totals.revenue/totals.cost*100).toFixed(1)}%`:'미확인'},{label:'수량 전환율',value:totals.clicks&&unitsKnown?`${(totals.units/totals.clicks*100).toFixed(1)}%`:'미확인',hint:'판매수량 ÷ 클릭수 · 수량 누락 시 미확인'}]}/>
  <section className="ops-panel"><div className="ops-toolbar"><label>전환 귀속기간 <select aria-label="광고 전환 귀속기간" value={attribution} onChange={e=>setAttribution(e.target.value)}><option value="1">1일</option><option value="14">14일</option></select></label><label>캠페인 <select aria-label="광고보고서 캠페인" value={campaign} onChange={e=>setCampaign(e.target.value)}><option value="">전체</option>{records(ctx,'campaigns').map(row=><option key={row.id} value={row.id}>{str(row.values.name)}</option>)}</select></label>{attribution==='14'?<CollectButton ctx={ctx} kind="adMetrics" label="광고센터 14일 귀속 성과 가져오기" dataset="adMetrics" values={{attributionDays:14,...(campaign?{campaignId:campaign}:{})}}/>:<span className="ops-note">1일 귀속 자료는 원본 보고서로 가져오세요.</span>}</div><p className="ops-note">1일·14일 전환 자료를 섞지 않습니다. 이 보고서의 전환율은 판매수량 기준이며 캠페인 요약의 주문 전환율과 다를 수 있습니다.</p></section>
  <ReadTable title="노출 지면별 분석" rows={areaRows} columns={[...cols,{key:'strategy',label:'운영 점검'}]} empty="광고 원시 지표를 가져오면 지면별 비용과 성과를 분석합니다."/>
  <ReadTable title="검색 키워드 성과" rows={aggregate('keyword')} columns={cols}/>
  <RecordPanel ctx={ctx} dataset="adMetrics" title="광고 원시 지표" description="원본 보고서를 가져오거나 일별 지표를 입력합니다. 같은 날짜·캠페인·상품·지면·키워드·귀속기간을 하나의 지표로 관리합니다." initialValues={{date:defaultDate(ctx),placement:'search',attributionDays:'14'}} filter={row=>inPeriod(row.values,ctx)} fields={metricFields} columns={[{key:'date',label:'일자'},{key:'campaignId',label:'캠페인'},{key:'placement',label:'지면'},{key:'keyword',label:'키워드'},{key:'attributionDays',label:'귀속 일수'},{key:'cost',label:'광고비',format:'money'},{key:'revenue',label:'전환매출',format:'money'}]}/>
  <p className="ops-note">운영 점검 문구는 클릭률·전환율의 정해진 기준으로 계산합니다. 예산이나 입찰가를 자동 변경하지 않습니다.</p>
 </>;
}

function Campaigns({ctx}:{ctx:OperationsContext}){
 const [selected,setSelected]=useState('');
 const campaigns=records(ctx,'campaigns');
 const summaries:Values[]=campaigns.filter(row=>!selected||row.id===selected).map(campaign=>{
  const metrics=records(ctx,'adMetrics').filter(row=>row.values.campaignId===campaign.id&&inPeriod(row.values,ctx)&&str(row.values.attributionDays??'14')==='14');
  const total=(key:string)=>metrics.reduce((s,row)=>s+num(row.values[key]),0),cost=total('cost'),revenue=total('revenue'),clicks=total('clicks');
  const marginRows=derived(ctx,'dailyMargins').filter(row=>row.campaignId===campaign.id&&inPeriod(row,ctx));
  const known=(key:string)=>metrics.length>0&&metrics.every(row=>row.values[key]!=null&&row.values[key]!=='');
  return {id:campaign.id,campaignName:campaign.values.name,cost,revenue,orders:known('orders')?total('orders'):null,units:known('units')?total('units'):null,roas:cost?revenue/cost*100:null,cvr:clicks&&known('orders')?total('orders')/clicks*100:null,netMargin:marginRows.some(row=>row.netMargin!=null)?sum(marginRows,'netMargin'):null};
 });
 const daily=namedRows(ctx,derived(ctx,'dailyMargins')).filter(row=>inPeriod(row,ctx)&&(!selected||str(row.campaignId)===selected));
 const known=daily.filter(row=>row.netMargin!=null||row.margin!=null);
 const chart:Values[]=daily.map(row=>({...row,netMargin:row.netMargin??row.margin??null}));
 return <>
  <StatCards items={[{label:'등록 캠페인',value:campaigns.length},{label:'연결 상품',value:records(ctx,'campaignSkus').length},{label:'확인 광고비',value:money(sum(summaries,'cost'))},{label:'확인 순마진',value:known.length?money(known.reduce((s,row)=>s+num(row.netMargin??row.margin),0)):'미확인',hint:'미수집 재고일은 확정하지 않습니다'}]}/>
  <section className="ops-panel"><div className="ops-toolbar"><label>분석 캠페인 <select aria-label="분석 캠페인 선택" value={selected} onChange={event=>setSelected(event.target.value)}><option value="">전체 캠페인</option>{campaigns.map(row=><option key={row.id} value={row.id}>{str(row.values.name)}</option>)}</select></label><CollectButton ctx={ctx} kind="adMetrics" label="캠페인 성과 가져오기" dataset="adMetrics" values={selected?{campaignId:selected}:{}}/></div><SparkBars rows={chart} valueKey="netMargin" label="캠페인 일마진"/></section>
  <ReadTable title="캠페인 성과 요약" rows={summaries} columns={[{key:'campaignName',label:'캠페인'},{key:'cost',label:'광고비',format:'money'},{key:'revenue',label:'전환매출',format:'money'},{key:'orders',label:'전환 주문',format:'number'},{key:'units',label:'판매수량',format:'number'},{key:'roas',label:'ROAS',format:'percent'},{key:'cvr',label:'주문 전환율',format:'percent'},{key:'netMargin',label:'확인 순마진',format:'money'}]}/>
  <ReadTable title="일별 재고·판매·마진" description="연결 상품의 공급단가와 원가로 판매마진을 계산하고 광고비를 차감합니다. 주문 기반 확정매출과 구별해 활용하세요." rows={daily} columns={[{key:'date',label:'기준일'},{key:'campaignName',label:'캠페인'},{key:'estimatedSales',label:'추정판매',format:'number'},{key:'grossMargin',label:'광고비 차감 전 마진',format:'money'},{key:'adCost',label:'광고비',format:'money'},{key:'netMargin',label:'순마진',format:'money'},{key:'quality',label:'자료 상태'}]}/>
  <div className="ops-split"><RecordPanel ctx={ctx} dataset="campaigns" title="캠페인 설정" fields={[{key:'name',label:'캠페인명',required:true},{key:'externalId',label:'광고센터 캠페인 ID'},{key:'budget',label:'일 예산',type:'number'},{key:'targetRoas',label:'목표 ROAS (%)',type:'number'},{key:'startDate',label:'분석 시작일',type:'date'},{key:'memo',label:'메모'}]} columns={[{key:'name',label:'캠페인명'},{key:'externalId',label:'외부 ID'},{key:'budget',label:'일 예산',format:'money'},{key:'targetRoas',label:'목표 ROAS',format:'percent'}]}/><RecordPanel ctx={ctx} dataset="campaignSkus" title="캠페인 상품 연결" description="동일 상품을 여러 캠페인에 연결할 때 배분 비율을 지정합니다. 합계가 100%를 넘지 않도록 관리하세요." initialValues={selected?{campaignId:selected,weight:1}:{weight:1}} fields={[{key:'campaignId',label:'캠페인',type:'campaign',required:true},skuField,{key:'weight',label:'판매·원가 배분 비율 (0~1)',type:'number',default:1}]} columns={[{key:'campaignId',label:'캠페인'},{key:'skuId',label:'연결 SKU'},{key:'weight',label:'배분 비율',format:'number'}]}/></div>
 </>;
}

export function SalesView({view,ctx}:{view:string;ctx:OperationsContext}){
 switch(view){
  case 'inventory':return <Inventory ctx={ctx}/>;
  case 'sales-report':return <SalesReport ctx={ctx}/>;
  case 'revenue':return <Revenue ctx={ctx}/>;
  case 'inbound':return <Inbound ctx={ctx}/>;
  case 'ad-reports':return <AdReports ctx={ctx}/>;
  case 'campaigns':return <Campaigns ctx={ctx}/>;
  default:return <p className="ops-empty">판매관리 메뉴를 선택하세요.</p>;
 }
}
