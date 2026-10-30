'use client';

import {useState} from 'react';
import {derived,num,records,str,type Field,type OperationsContext,type OpsRecord,type TableColumn,type Values} from '../types';
import {ActionButton,ReadTable,RecordPanel,StatCards} from './shared';

const money=(value:unknown)=>`${num(value).toLocaleString('ko-KR')}원`;
const period=(ctx:OperationsContext)=>ctx.month||String(ctx.year);
const inPeriod=(values:Values,ctx:OperationsContext,key='date')=>str(values[key]).startsWith(period(ctx));
const sum=(rows:Values[],key:string)=>rows.reduce((total,row)=>total+num(row[key]),0);
const defaultDate=(ctx:OperationsContext)=>ctx.month?`${ctx.month}-01`:`${ctx.year}-01-01`;
const groupLabels:Record<string,string>={sga:'판매비와관리비',income:'영업외수익',other:'영업외비용',tax:'소득세·법인세'};
const statusLabels:Record<string,string>={pending:'검토 대기',confirmed:'확정',excluded:'비용에서 제외'};

function PnlTrend({rows}:{rows:Values[]}){
 const max=Math.max(1,...rows.flatMap(row=>[Math.abs(num(row.revenue)),Math.abs(num(row.netProfit))]));
 return <section className="ops-panel"><div className="ops-toolbar"><h3>월별 매출과 순이익</h3><span className="ops-note"><span style={{color:'#336eac'}}>■</span> 총매출 <span style={{color:'#1b8b76'}}>■</span> 당기순이익 <span style={{color:'#c95c5a'}}>■</span> 손실</span></div><div role="img" aria-label={rows.map(row=>`${str(row.month)} 매출 ${money(row.revenue)}, 순이익 ${money(row.netProfit)}`).join('. ')} style={{display:'grid',gridTemplateColumns:`repeat(${Math.max(rows.length,1)},minmax(44px,1fr))`,gap:10,alignItems:'end',overflowX:'auto',padding:'20px 0 4px'}}>{rows.map(row=><div key={str(row.month)} title={`${str(row.month)} · 매출 ${money(row.revenue)} / 순이익 ${money(row.netProfit)}`}><div style={{height:100,display:'flex',gap:4,alignItems:'end',justifyContent:'center'}}><div style={{width:14,height:Math.max(2,Math.abs(num(row.revenue))/max*100),borderRadius:'4px 4px 0 0',background:'#336eac'}}/><div style={{width:14,height:Math.max(2,Math.abs(num(row.netProfit))/max*100),borderRadius:'4px 4px 0 0',background:num(row.netProfit)<0?'#c95c5a':'#1b8b76'}}/></div><div style={{textAlign:'center',fontSize:12,marginTop:8}}>{Number(str(row.month).slice(-2))}월</div></div>)}</div></section>;
}

const pnlRows:[string,string][]=[['revenue','총매출액'],['rocket','로켓매출'],['deductions','매출 차감'],['general','일반매출'],['other','기타매출'],['cogs','매출원가'],['grossProfit','매출총이익'],['sga','판매비와관리비'],['operatingProfit','영업이익'],['nonOperatingIncome','영업외수익'],['nonOperatingExpense','영업외비용'],['ordinaryProfit','경상이익'],['tax','소득세·법인세'],['netProfit','당기순이익']];

function Pnl({ctx}:{ctx:OperationsContext}){
 const all=derived(ctx,'pnl').filter(row=>/^\d{4}-\d{2}$/.test(str(row.month))&&str(row.month).startsWith(String(ctx.year)));
 const rows=all.filter(row=>!ctx.month||str(row.month)===ctx.month);
 const [detail,setDetail]=useState('');
 const pending=records(ctx,'expenses').filter(row=>inPeriod(row.values,ctx)&&row.values.status==='pending');
 const unresolved=records(ctx,'expenses').filter(row=>inPeriod(row.values,ctx)&&row.values.status!=='excluded'&&!str(row.values.categoryId));
 const periodClosed=ctx.month&&records(ctx,'periodClosures').some(row=>str(row.values.month)===ctx.month&&row.values.status!=='open');
 const columns:TableColumn[]=[{key:'name',label:'손익 항목'},...rows.map(row=>({key:str(row.month),label:`${Number(str(row.month).slice(-2))}월`,format:'money' as const})),{key:'annual',label:ctx.month?'선택월 합계':'연간 합계',format:'money'}];
 const matrix=pnlRows.map(([key,name])=>({name,annual:sum(rows,key),...Object.fromEntries(rows.map(row=>[str(row.month),row[key]]))}));
 const category=new Map(records(ctx,'expenseCategories').map(row=>[row.id,row.values]));
 const detailRows=detail==='cogs'?derived(ctx,'monthlyLedger').filter(row=>str(row.month).startsWith(period(ctx))).map(row=>({...row,source:'재고수불부'})):detail==='expenses'?records(ctx,'expenses').filter(row=>inPeriod(row.values,ctx)&&row.values.status==='confirmed').map(row=>({date:row.values.date,name:row.values.vendor,category:str(category.get(str(row.values.categoryId))?.name),amount:row.values.novat?row.values.total:row.values.supply,source:'확정 경비'})):detail==='deductions'?records(ctx,'salesDeductions').filter(row=>inPeriod(row.values,ctx,'month')).map(row=>({date:row.values.month,name:row.values.name,amount:row.values.amount,source:'매출 차감'})):records(ctx,'sales').filter(row=>inPeriod(row.values,ctx)&&row.values.type!=='subsidiary'&&!['cancelled','scheduled'].includes(str(row.values.status))).map(row=>({date:row.values.date,name:row.values.name??records(ctx,'skus').find(sku=>sku.id===row.values.skuId)?.values.name,type:row.values.type,amount:row.values.type==='rocket'?num(row.values.qty)*num(row.values.supply):row.values.supply??Math.round(num(row.values.price)/1.1),source:'매출 관리'}));
 return <>
  <StatCards items={[{label:'총매출',value:money(sum(rows,'revenue')),hint:'자회사 거래 제외 · 공급가액 기준'},{label:'매출총이익',value:money(sum(rows,'grossProfit'))},{label:'영업이익',value:money(sum(rows,'operatingProfit'))},{label:'당기순이익',value:money(sum(rows,'netProfit'))}]}/>
  <section className="ops-panel"><div className="ops-toolbar"><h3>{ctx.month?`${ctx.month} 마감 준비`:`${ctx.year}년 손익 검토`}</h3>{ctx.month?<span className="ops-badge">{periodClosed?'마감됨':'편집 가능'}</span>:null}</div><p className="ops-note">매출 → 매출 차감 → 월 평균 출고원가 → 확정 경비 순으로 집계합니다. 재고수불부의 자회사 출고원가는 손익에서 제외합니다. 광고 캠페인의 추정 일마진과 월 손익은 집계 기준이 다릅니다.</p><div className="ops-toolbar"><span>검토 대기 경비 <strong>{pending.length}건</strong></span><span>분류 미지정 <strong>{unresolved.length}건</strong></span>{ctx.month?<ActionButton disabled={ctx.busy} variant={periodClosed?'default':'primary'} onClick={async()=>{if(!window.confirm(periodClosed?`${ctx.month}의 마감을 해제할까요? 이후 원천 자료를 수정할 수 있습니다.`:`${ctx.month}을 마감할까요? 이 달의 매출·매입·입고·확정경비 수정을 잠급니다.${pending.length?` 검토 대기 경비 ${pending.length}건은 손익에 포함되지 않습니다.`:''}`))return;await ctx.command({type:periodClosed?'reopen-period':'close-period',month:ctx.month});}}>{periodClosed?'마감 해제':'선택월 마감'}</ActionButton>:<span className="ops-note">월을 선택하면 마감할 수 있습니다.</span>}</div></section>
  <PnlTrend rows={rows}/>
  <ReadTable title="월별 손익계산서" description="금액은 원천 자료에서 자동 계산됩니다. 원천을 수정하면 잠기지 않은 월의 손익이 함께 갱신됩니다." rows={matrix} columns={columns}/>
  <section className="ops-panel"><h3>금액의 원천 확인</h3><div className="ops-tabs" role="tablist" aria-label="손익 원천">{[['sales','매출'],['deductions','차감'],['cogs','출고원가'],['expenses','확정 경비']].map(([key,label])=><button type="button" key={key} role="tab" aria-selected={detail===key} className={detail===key?'is-active':''} onClick={()=>setDetail(detail===key?'':key)}>{label}</button>)}</div>{!detail?<p className="ops-note">손익 항목을 선택하면 해당 기간의 원천 거래를 볼 수 있습니다.</p>:null}</section>
  {detail?<ReadTable title={detail==='cogs'?'출고원가의 원천':'손익 원천 거래'} rows={detailRows} columns={detail==='cogs'?[{key:'month',label:'월'},{key:'name',label:'상품'},{key:'issueQty',label:'전체 출고',format:'number'},{key:'issueAmount',label:'전체 출고금액',format:'money'},{key:'subsidiaryQty',label:'자회사 출고',format:'number'},{key:'cogs',label:'손익 매출원가',format:'money'}]:[{key:'date',label:'일자'},{key:'name',label:'거래·상품'},{key:'type',label:'매출 유형'},{key:'category',label:'경비 계정'},{key:'amount',label:'손익 금액',format:'money'},{key:'source',label:'원천'}]}/>:null}
 </>;
}

function CostDetails({ctx}:{ctx:OperationsContext}){
 const rows=derived(ctx,'costDetails').filter(row=>str(row.month).startsWith(period(ctx)));
 const categories=records(ctx,'expenseCategories');
 const enriched=rows.map(row=>({...row,groupLabel:groupLabels[str(row.group)]??str(row.group),categoryPath:categoryPath(categories,str(row.categoryId))||str(row.name)}));
 const totals=Object.entries(groupLabels).map(([key,label])=>({label,value:money(sum(rows.filter(row=>row.group===key),'amount'))}));
 return <><StatCards items={totals}/><p className="ops-note">이 화면은 조회 전용입니다. 항목 구조는 ‘경비항목 설정’에서, 금액은 ‘경비 입력하기’에서 관리합니다. 검토 대기·제외 경비는 비용 합계에 반영하지 않습니다.</p><ReadTable title="월별 비용 내역" rows={enriched} columns={[{key:'month',label:'귀속월'},{key:'groupLabel',label:'대항목'},{key:'categoryPath',label:'중·소항목'},{key:'amount',label:'비용 금액',format:'money'}]} empty="확정된 경비가 없습니다. 경비를 분류하고 확정하면 이곳과 손익계산서에 자동 반영됩니다."/></>;
}

function categoryPath(rows:OpsRecord[],id:string,visited=new Set<string>()):string{
 if(!id||visited.has(id))return '';
 visited.add(id);const row=rows.find(item=>item.id===id);if(!row)return '';
 const parent=categoryPath(rows,str(row.values.parentId),visited);
 return [parent,str(row.values.name)].filter(Boolean).join(' › ');
}

function Categories({ctx}:{ctx:OperationsContext}){
 const [group,setGroup]=useState('sga');
 const all=records(ctx,'expenseCategories'),inGroup=all.filter(row=>row.values.group===group);
 const parentOptions=inGroup.filter(row=>!row.values.parentId).map(row=>row.id);
 const [parent,setParent]=useState('');
 const parentId=parentOptions.includes(parent)?parent:'';
 const usage=(id:string)=>records(ctx,'expenses').filter(row=>row.values.categoryId===id&&row.values.status!=='excluded').length;
 return <>
  <section className="ops-panel"><h3>경비 분류 구조</h3><div className="ops-tabs" role="tablist" aria-label="경비 대항목">{Object.entries(groupLabels).map(([key,label])=><button key={key} type="button" role="tab" aria-selected={group===key} className={group===key?'is-active':''} onClick={()=>{setGroup(key);setParent('');}}>{label}</button>)}</div><p className="ops-note">대항목 아래에 계정을 만들고, 계정 아래에 거래처·카드별 소항목을 연결합니다. 경비가 연결된 항목은 삭제할 수 없습니다. 이름을 바꾸어도 연결된 경비는 유지됩니다.</p><label className="ops-field">새 항목의 상위 계정 <select aria-label="새 경비 항목의 상위 계정" value={parentId} onChange={event=>setParent(event.target.value)}><option value="">없음 — 계정(중항목) 만들기</option>{inGroup.filter(row=>!row.values.parentId).map(row=><option key={row.id} value={row.id}>{str(row.values.name)}</option>)}</select></label></section>
  <RecordPanel key={`${group}-${parentId}`} ctx={ctx} dataset="expenseCategories" title={parentId?'소항목 관리':'계정·소항목 관리'} description={`현재 대항목: ${groupLabels[group]}${parentId?` / 상위 계정: ${str(all.find(row=>row.id===parentId)?.values.name)}`:''}`} initialValues={{group,parentId,novat:false}} filter={row=>row.values.group===group&&(!parentId||row.values.parentId===parentId)} fields={[{key:'name',label:parentId?'소항목명':'계정명',required:true},{key:'novat',label:'기본 VAT 환급 미적용',type:'checkbox',hint:'이 항목의 비용을 부가세 포함 합계로 처리할 때 사용합니다.'},{key:'memo',label:'항목 설명'}]} columns={[{key:'name',label:'항목명'},{key:'parentId',label:'상위 계정'},{key:'novat',label:'VAT 환급 미적용'},{key:'memo',label:'설명'}]} rowActions={row=><span className="ops-badge">연결 경비 {usage(row.id)}건</span>}/>
  <ReadTable title="현재 분류 구조" rows={inGroup.map(row=>({name:categoryPath(all,row.id),level:row.values.parentId?'소항목':'계정',novat:row.values.novat?'합계 금액':'공급가액',used:usage(row.id)}))} columns={[{key:'name',label:'계층'},{key:'level',label:'단계'},{key:'novat',label:'기본 비용 기준'},{key:'used',label:'사용 중',format:'number'}]}/>
 </>;
}

function Expenses({ctx}:{ctx:OperationsContext}){
 const [filter,setFilter]=useState('pending'),[selected,setSelected]=useState<string[]>([]),[category,setCategory]=useState('');
 const categories=records(ctx,'expenseCategories');
 const duplicateFlags=new Map(derived(ctx,'expenseRows').map(row=>[str(row.id),Boolean(row.duplicateSuspected??row.duplicateSuspect)]));
 const all=records(ctx,'expenses').filter(row=>inPeriod(row.values,ctx)).map(row=>({...row,values:{...row.values,duplicateSuspect:duplicateFlags.get(row.id)??false}} as OpsRecord));
 const matching=all.filter(row=>!ctx.search||JSON.stringify(row.values).toLocaleLowerCase().includes(ctx.search.toLocaleLowerCase()));
 const visible=matching.filter(row=>filter==='all'?true:filter==='unclassified'?!str(row.values.categoryId):filter==='duplicates'?Boolean(row.values.duplicateSuspect):row.values.status===filter);
 const displayed=visible.slice(0,200);
 const pending=all.filter(row=>row.values.status==='pending');
 const confirmed=all.filter(row=>row.values.status==='confirmed');
 const selectedPending=pending.filter(row=>selected.includes(row.id));
 const categoryId=categories.some(row=>row.id===category)?category:'';
 const changeStatus=async(row:OpsRecord,status:string)=>ctx.command({type:'upsert',dataset:'expenses',id:row.id,values:{...row.values,status}});
 const fields:Field[]=[{key:'date',label:'거래일',type:'date',required:true},{key:'vendor',label:'거래처',required:true},{key:'memo',label:'적요·품목'},{key:'supply',label:'공급가액 (선택)',type:'number'},{key:'vat',label:'부가세 (선택)',type:'number'},{key:'total',label:'부가세 포함 합계',type:'number',required:true},{key:'approvalNo',label:'카드 승인번호'},{key:'businessNo',label:'공급자 사업자번호'},{key:'source',label:'자료 출처',type:'select',options:['card','tax','bank','manual'],default:'manual'},{key:'novat',label:'VAT 환급 미적용',type:'checkbox',hint:'켜면 합계, 끄면 공급가액을 비용으로 반영합니다.'}];
 const cost=(row:OpsRecord)=>row.values.novat?num(row.values.total):row.values.supply!=null?num(row.values.supply):Math.round(num(row.values.total)/1.1);
 return <>
  <StatCards items={[{label:'검토 대기',value:pending.length,hint:'아직 손익에 반영되지 않음'},{label:'확정 비용',value:money(confirmed.reduce((s,row)=>s+cost(row),0))},{label:'미분류',value:all.filter(row=>row.values.status!=='excluded'&&!str(row.values.categoryId)).length},{label:'중복 의심',value:all.filter(row=>Boolean(row.values.duplicateSuspect)).length,hint:'실제 중복인지 확인이 필요합니다'}]}/>
  <section className="ops-panel"><div className="ops-toolbar"><label>표시 대상 <select aria-label="경비 표시 대상" value={filter} onChange={event=>{setFilter(event.target.value);setSelected([]);}}><option value="pending">검토 대기</option><option value="confirmed">확정 경비</option><option value="unclassified">미분류</option><option value="duplicates">중복 의심</option><option value="excluded">제외</option><option value="all">전체</option></select></label><ActionButton variant="primary" disabled={ctx.busy||!selectedPending.length} onClick={async()=>{if(selectedPending.some(row=>!str(row.values.categoryId))){ctx.notify('선택한 경비의 분류를 먼저 지정하세요.');return;}const ok=await ctx.command({type:'confirm-expenses',ids:selectedPending.map(row=>row.id)});if(ok)setSelected([]);}}>선택 {selectedPending.length}건 확정</ActionButton></div><p className="ops-note">파일을 가져오거나 수기로 입력한 경비는 검토 대기로 저장합니다. 분류·금액·중복을 확인한 후 확정하면 비용 내역과 손익에 반영됩니다. 승인번호 없는 동일 날짜·거래처·금액은 중복 의심으로 검토합니다.</p>
   {visible.length?<div className="ops-table-wrap"><table className="ops-table"><thead><tr><th><input type="checkbox" aria-label="표시된 검토 대기 경비 전체 선택" checked={displayed.filter(row=>row.values.status==='pending').length>0&&displayed.filter(row=>row.values.status==='pending').every(row=>selected.includes(row.id))} onChange={event=>setSelected(event.target.checked?displayed.filter(row=>row.values.status==='pending').map(row=>row.id):[])}/></th><th>일자</th><th>거래처·적요</th><th>분류</th><th>비용</th><th>상태</th><th>검토</th></tr></thead><tbody>{displayed.map(row=><tr key={row.id}><td>{row.values.status==='pending'?<input type="checkbox" aria-label={`${str(row.values.vendor)} ${str(row.values.date)} 경비 선택`} checked={selected.includes(row.id)} onChange={event=>setSelected(ids=>event.target.checked?[...new Set([...ids,row.id])]:ids.filter(id=>id!==row.id))}/>:null}</td><td>{str(row.values.date)}</td><td>{str(row.values.vendor)}<small style={{display:'block',color:'#69788d'}}>{str(row.values.memo)}</small></td><td><select aria-label={`${str(row.values.vendor)} 경비 분류`} value={str(row.values.categoryId)} disabled={ctx.busy} onChange={event=>{const item=categories.find(c=>c.id===event.target.value);void ctx.command({type:'upsert',dataset:'expenses',id:row.id,values:{...row.values,categoryId:event.target.value,...(item?{novat:Boolean(item.values.novat)}:{})}});}}><option value="">분류 미지정</option>{categories.map(item=><option key={item.id} value={item.id}>{groupLabels[str(item.values.group)]??str(item.values.group)} / {categoryPath(categories,item.id)}</option>)}</select></td><td>{money(cost(row))}<small style={{display:'block'}}>{row.values.novat?'VAT 포함':'공급가액'}</small></td><td><span className="ops-badge">{statusLabels[str(row.values.status)]??str(row.values.status)}</span>{row.values.duplicateSuspect?<small className="ops-danger" style={{display:'block'}}>중복 의심</small>:null}</td><td><div className="ops-toolbar">{row.values.status==='pending'?<ActionButton disabled={ctx.busy||!str(row.values.categoryId)} onClick={()=>ctx.command({type:'confirm-expenses',ids:[row.id]})}>확정</ActionButton>:<ActionButton disabled={ctx.busy} onClick={()=>changeStatus(row,'pending')}>다시 검토</ActionButton>}{row.values.status!=='excluded'?<ActionButton disabled={ctx.busy} onClick={()=>changeStatus(row,'excluded')}>비용 제외</ActionButton>:null}</div></td></tr>)}</tbody></table>{visible.length>200?<p className="ops-note">검토 표에는 먼저 200건을 표시합니다. 연도·월이나 검색으로 범위를 좁히세요. 원장에서는 전체 내역을 확인할 수 있습니다.</p>:null}</div>:<p className="ops-empty">이 조건에 해당하는 경비가 없습니다.</p>}
  </section>
  <section className="ops-panel"><label className="ops-field">새 경비의 분류 <select aria-label="새 경비의 분류" value={categoryId} onChange={event=>setCategory(event.target.value)}><option value="">미분류로 검토 대기</option>{categories.map(row=><option key={row.id} value={row.id}>{groupLabels[str(row.values.group)]??str(row.values.group)} / {categoryPath(categories,row.id)}</option>)}</select></label><p className="ops-note">행별 분류는 위 검토 표에서 바꿀 수 있습니다. 자료가 공급가액·부가세를 따로 제공하면 원문 값을 함께 입력하세요.</p></section>
  <RecordPanel key={`expense-${categoryId}`} ctx={ctx} dataset="expenses" title="경비 원장·자료 가져오기" description="거래처·날짜·합계와 증빙을 보존합니다. 검토 중인 자료도 서버에 저장되며 확정된 자료만 손익에 반영됩니다." initialValues={{date:defaultDate(ctx),categoryId,status:'pending',source:'manual',novat:Boolean(categories.find(row=>row.id===categoryId)?.values.novat)}} filter={row=>inPeriod(row.values,ctx)} fields={fields} columns={[{key:'date',label:'일자'},{key:'vendor',label:'거래처'},{key:'memo',label:'적요'},{key:'supply',label:'공급가액',format:'money'},{key:'vat',label:'세액',format:'money'},{key:'total',label:'합계',format:'money'},{key:'categoryId',label:'분류'},{key:'novat',label:'환급 미적용'},{key:'status',label:'상태'}]}/>
 </>;
}

export function FinanceView({view,ctx}:{view:string;ctx:OperationsContext}){
 switch(view){
  case 'pnl':return <Pnl ctx={ctx}/>;
  case 'cost-details':return <CostDetails ctx={ctx}/>;
  case 'expense-categories':return <Categories ctx={ctx}/>;
  case 'expenses':return <Expenses ctx={ctx}/>;
  default:return <p className="ops-empty">손익계산 메뉴를 선택하세요.</p>;
 }
}
