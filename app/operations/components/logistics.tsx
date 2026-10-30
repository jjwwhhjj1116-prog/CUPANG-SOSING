'use client';

import { useMemo, useState } from 'react';
import { derived, num, records, str, type Field, type OperationsContext, type OpsRecord, type TableColumn, type Values } from '../types';
import { ActionButton, CollectButton, ReadTable, RecordPanel, StatCards } from './shared';

const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
const money=(value:unknown)=>`${num(value).toLocaleString('ko-KR')}원`;
const initialDate=(ctx:OperationsContext)=>ctx.month?`${ctx.month}-01`:`${ctx.year}-${today().slice(5,7)}-01`;
const inPeriod=(value:unknown,ctx:OperationsContext)=>str(value).startsWith(ctx.month||String(ctx.year));
const skuName=(ctx:OperationsContext,id:unknown)=>str(records(ctx,'skus').find(row=>row.id===str(id))?.values.name)||str(id)||'SKU 미연결';
const monthOf=(row:Values,year:number)=>/^\d{4}-\d{2}$/.test(str(row.month))?str(row.month):`${year}-${String(row.month).padStart(2,'0')}`;

function Purchasing({ctx}:{ctx:OperationsContext}) {
  const rows=records(ctx,'purchaseOrders').filter(row=>inPeriod(row.values.orderDate,ctx));
  const ordered=rows.reduce((sum,row)=>sum+num(row.values.qty),0),received=rows.reduce((sum,row)=>sum+num(row.values.receivedQty),0);
  const receive=async(row:OpsRecord)=>{
    const qty=num(row.values.qty),already=num(row.values.receivedQty),remaining=qty-already;
    if(remaining<=0){ctx.notify('이미 입고된 주문입니다. 입고내역에서 반품·정정을 기록하세요.');return;}
    const input=window.prompt(`‘${skuName(ctx,row.values.skuId)}’의 이번 입고수량을 입력하세요. 미입고 ${remaining.toLocaleString('ko-KR')}개`,String(remaining));
    if(input==null)return;const incoming=Number(input.replaceAll(',',''));
    if(!Number.isFinite(incoming)||incoming<=0||incoming>remaining){ctx.notify('이번 입고수량은 0보다 크고 미입고수량 이하여야 합니다.');return;}
    const date=window.prompt('실제 입고일을 입력하세요(YYYY-MM-DD).',today());if(date==null)return;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){ctx.notify('입고일 형식을 확인하세요.');return;}
    if(!window.confirm(`${incoming.toLocaleString('ko-KR')}개를 ${date} 입고로 기록할까요? 공통 SKU의 입고내역에 연결됩니다.`))return;
    await ctx.command({type:'receive-order',id:row.id,values:{receivedQty:incoming,receivedDate:date,receiptId:crypto.randomUUID()}});
  };
  return <>
    <StatCards items={[{label:'표시 주문',value:rows.length},{label:'주문수량',value:ordered.toLocaleString('ko-KR')},{label:'누적 입고수량',value:received.toLocaleString('ko-KR')},{label:'미입고수량',value:Math.max(0,ordered-received).toLocaleString('ko-KR')}]} />
    <RecordPanel ctx={ctx} dataset="purchaseOrders" title="제품 구매관리" description="공통 SKU에 주문일·송금일·입고일을 연결합니다. 입력한 주문은 서버에 저장됩니다. 실물 입고는 ‘입고 기록’으로 별도 확정하세요."
      initialValues={{orderDate:initialDate(ctx),status:'주문',qty:1,receivedQty:0,fx:1}}
      filter={row=>inPeriod(row.values.orderDate,ctx)}
      fields={[
        {key:'skuId',label:'공통 SKU',type:'sku',required:true},{key:'orderDate',label:'주문일',type:'date',required:true},
        {key:'paymentDate',label:'송금일',type:'date'},{key:'expectedDate',label:'입고예정일',type:'date'},
        {key:'url',label:'중국 주문 URL'},{key:'qty',label:'주문수량',type:'number',required:true,default:1},
        {key:'receivedQty',label:'누적 입고수량',type:'number',default:0,hint:'실제 입고확정은 행의 입고 기록을 사용하세요.'},
        {key:'unitPrice',label:'외화 개당단가',type:'number',default:0},{key:'fx',label:'적용환율',type:'number',default:1},
        {key:'status',label:'상태',type:'select',options:['주문','송금','부분 입고','입고 완료','취소'],default:'주문'},
        {key:'memo',label:'비고',type:'textarea'},
      ]}
      columns={[{key:'orderDate',label:'주문일'},{key:'skuId',label:'SKU'},{key:'qty',label:'주문수량',format:'number'},{key:'receivedQty',label:'누적 입고',format:'number'},{key:'expectedDate',label:'입고예정'},{key:'unitPrice',label:'외화 단가',format:'number'},{key:'fx',label:'환율',format:'number'},{key:'status',label:'상태'}]}
      rowActions={row=><ActionButton disabled={ctx.busy||num(row.values.receivedQty)>=num(row.values.qty)||row.values.status==='취소'} onClick={()=>receive(row)}>입고 기록</ActionButton>} />
    <p className="ops-note">구매 주문은 송금이나 외부 발주를 실행하지 않습니다. 수입원가에 매입 묶음·부대비를 입력하면 수불부 매입금액과 손익 원가로 이어집니다.</p>
  </>;
}

function Ledger({ctx}:{ctx:OperationsContext}) {
  const closingScope=`${ctx.snapshot.accountContext}:${ctx.year}:${ctx.month}`;
  const [closingSelection,setClosingSelection]=useState<{scope:string;month:string}|null>(null);
  const closingMonth=closingSelection?.scope===closingScope?closingSelection.month:ctx.month||`${ctx.year}-${today().slice(5,7)}`;
  const ledger=derived(ctx,'monthlyLedger').filter(row=>monthOf(row,ctx.year).startsWith(ctx.month||String(ctx.year)));
  const lastBySku=new Map<string,Values>();
  for(const row of ledger){const key=str(row.skuId),prev=lastBySku.get(key);if(!prev||monthOf(prev,ctx.year)<monthOf(row,ctx.year))lastBySku.set(key,row);}
  const endRows=[...lastBySku.values()],negative=ledger.filter(row=>num(row.closingQty)<0);
  const closed=records(ctx,'periodClosures').some(row=>str(row.values.month)===closingMonth&&(row.values.closed===true||row.values.status==='closed'));
  const changeClose=async()=>{
    if(!/^\d{4}-\d{2}$/.test(closingMonth)){ctx.notify('마감할 월을 선택하세요.');return;}
    if(!window.confirm(closed?`${closingMonth} 마감을 취소하고 연결된 매입·매출·경비 편집을 다시 허용할까요?`:`${closingMonth}을 마감할까요? 해당 월의 매입·매출·경비 변경과 삭제가 제한됩니다.`))return;
    await ctx.command({type:closed?'reopen-period':'close-period',month:closingMonth});
  };
  const columns:TableColumn[]=[{key:'month',label:'월'},{key:'name',label:'상품명'},{key:'openingQty',label:'기초수량',format:'number'},{key:'openingAmount',label:'기초금액',format:'money'},{key:'buyQty',label:'매입수량',format:'number'},{key:'buyAmount',label:'매입금액',format:'money'},{key:'issueQty',label:'출고수량',format:'number'},{key:'unitCost',label:'평균단가',format:'money'},{key:'issueAmount',label:'출고금액',format:'money'},{key:'closingQty',label:'기말수량',format:'number'},{key:'closingAmount',label:'기말금액',format:'money'},{key:'cogs',label:'손익 매출원가',format:'money'}];
  return <>
    <StatCards items={[{label:'표시 SKU',value:lastBySku.size},{label:'최근 월말 재고',value:endRows.reduce((sum,row)=>sum+num(row.closingQty),0).toLocaleString('ko-KR')},{label:'최근 월말 재고금액',value:money(endRows.reduce((sum,row)=>sum+num(row.closingAmount),0))},{label:'음수재고 행',value:negative.length,hint:'매입누락·이월·출고 중복을 확인하세요.'}]} />
    <section className="ops-panel"><h2>재고수불부</h2><p className="ops-note">기초재고와 매입 원가, 실제 매출 출고를 SKU·월별로 연결합니다. 월초와 월매입을 합친 평균단가로 계산하며, 출고 전량이 소진되면 기말금액은 0입니다. 자회사 실물 출고는 재고에서 빠지고, 그 원가 몫은 손익에서 제외됩니다.</p>
      <div className="ops-toolbar"><label>마감할 월<input type="month" value={closingMonth} onChange={event=>setClosingSelection({scope:closingScope,month:event.target.value})} /></label><span className="ops-badge">{closed?'마감됨':'편집 가능'}</span><ActionButton disabled={ctx.busy} onClick={changeClose} variant={closed?'default':'primary'}>{closed?'마감 취소':'월 마감'}</ActionButton></div>
    </section>
    <ReadTable title="월별 수불 내역" rows={ledger} columns={columns} empty="공통 SKU와 기초재고 또는 매입·매출을 등록하면 월별 수불부가 자동으로 만들어집니다." />
    {negative.length>0&&<ReadTable title="음수재고 점검" description="출고가 기초재고+매입수량보다 큽니다. 값을 0으로 숨기지 않고 원천을 확인하세요." rows={negative} columns={[{key:'month',label:'월'},{key:'name',label:'상품명'},{key:'buyQty',label:'매입',format:'number'},{key:'issueQty',label:'출고',format:'number'},{key:'closingQty',label:'부족수량',format:'number'}]} />}
    <RecordPanel ctx={ctx} dataset="openingBalances" title="기초재고 입력" description="최초 운영 연도의 수량과 원가금액을 입력합니다. 매입금액을 기초재고에도 중복 입력하지 마세요."
      initialValues={{year:ctx.year,qty:0,amount:0}}
      filter={row=>num(row.values.year)===ctx.year}
      fields={[{key:'skuId',label:'공통 SKU',type:'sku',required:true},{key:'year',label:'연도',type:'number',required:true,default:ctx.year},{key:'qty',label:'기초수량',type:'number',required:true,default:0},{key:'amount',label:'기초 원가금액(원)',type:'number',required:true,default:0}]}
      columns={[{key:'year',label:'연도'},{key:'skuId',label:'SKU'},{key:'qty',label:'기초수량',format:'number'},{key:'amount',label:'기초금액',format:'money'}]} />
  </>;
}

function ImportCost({ctx}:{ctx:OperationsContext}) {
  const batches=records(ctx,'importBatches'),[selectedBatchId,setBatchId]=useState('');
  const periodBatches=batches.filter(row=>inPeriod(row.values.date,ctx));
  const batchId=periodBatches.some(row=>row.id===selectedBatchId)?selectedBatchId:'';
  const active=periodBatches.find(row=>row.id===batchId);
  const costs=derived(ctx,'procurementCosts').filter(row=>inPeriod(row.date,ctx)&&(!batchId||str(row.batchId)===batchId));
  const purchaseLines=records(ctx,'purchaseLines');
  const qty=costs.reduce((sum,row)=>sum+num(row.saleQty),0),amount=costs.reduce((sum,row)=>sum+num(row.totalCost),0);
  const batchFields:Field[]=[
    {key:'name',label:'매입 묶음명',required:true},{key:'date',label:'매입일',type:'date',required:true,default:initialDate(ctx)},
    {key:'fx',label:'기본환율(외화→원)',type:'number',required:true,default:1},
    {key:'cnCost',label:'중국 공통비(원)',type:'number',default:0},{key:'krCost',label:'국내·운송·통관 공통비(원)',type:'number',default:0},
    {key:'inspectionCost',label:'검사 공통비(원)',type:'number',default:0},{key:'extraCost',label:'기타 공통비(원)',type:'number',default:0},
    {key:'memo',label:'비용 내역·증빙 메모',type:'textarea'},
  ];
  const lineFields:Field[]=[{key:'batchId',label:'매입 묶음',type:'batch',required:true},{key:'skuId',label:'공통 SKU',type:'sku',required:true},
    {key:'qty',label:'구매 개수',type:'number',required:true,default:1},{key:'setQty',label:'판매 세트당 구성 개수',type:'number',required:true,default:1},
    {key:'unitPrice',label:'외화 개당단가',type:'number',required:true,default:0},{key:'fx',label:'행 환율(비우면 묶음값)',type:'number'},
    {key:'agentFee',label:'외화 구매대행비',type:'number',default:0},{key:'localShipping',label:'외화 현지운송비',type:'number',default:0},
    {key:'inspection',label:'검사비 배분 대상',type:'checkbox',default:false},{key:'memo',label:'메모',type:'textarea'},
  ];
  return <>
    <StatCards items={[{label:'표시 매입 묶음',value:periodBatches.length},{label:'원가 반영 상품행',value:costs.length},{label:'판매수량(세트)',value:qty.toLocaleString('ko-KR')},{label:'총 매입원가',value:money(amount)}]} />
    <section className="ops-panel"><h2>매입·수입원가</h2><p className="ops-note">함께 수입한 주문을 한 묶음으로 만들고 상품행을 연결하세요. 중국·국내 공통비는 원화 구매액 비율로, 검사비는 대상 상품에만 배분합니다. 1원 잔여를 조정해 공통비 합계를 보존합니다.</p>
      <div className="ops-toolbar"><label>조회할 매입 묶음<select value={batchId} onChange={event=>setBatchId(event.target.value)}><option value="">현재 기간 전체</option>{periodBatches.map(row=><option key={row.id} value={row.id}>{str(row.values.date)} · {str(row.values.name)||row.id}</option>)}</select></label>{active&&<span className="ops-badge">상품 {purchaseLines.filter(row=>str(row.values.batchId)===active.id).length}행</span>}</div>
    </section>
    <RecordPanel ctx={ctx} dataset="importBatches" title="매입 묶음·공통비" fields={batchFields} initialValues={{date:initialDate(ctx),fx:1,cnCost:0,krCost:0,inspectionCost:0,extraCost:0}}
      filter={row=>inPeriod(row.values.date,ctx)}
      columns={[{key:'date',label:'매입일'},{key:'name',label:'묶음명'},{key:'fx',label:'기본환율',format:'number'},{key:'cnCost',label:'중국 공통비',format:'money'},{key:'krCost',label:'국내 공통비',format:'money'},{key:'inspectionCost',label:'검사비',format:'money'},{key:'extraCost',label:'기타비',format:'money'}]}
      rowActions={row=><ActionButton onClick={()=>setBatchId(row.id)}>상품행 보기</ActionButton>} />
    <RecordPanel ctx={ctx} dataset="purchaseLines" title="매입 상품행" description="구매수량÷세트구성으로 판매수량을 계산합니다. 소수 세트수는 묶음 구성을 확인한 뒤 입력하세요. 매입 원가는 수불부와 손익에 같은 금액으로 연결됩니다."
      fields={lineFields} initialValues={{batchId:active?.id??'',qty:1,setQty:1,unitPrice:0,agentFee:0,localShipping:0,inspection:false}}
      filter={row=>{const batch=batches.find(item=>item.id===str(row.values.batchId));return !!batch&&inPeriod(batch.values.date,ctx)&&(!batchId||str(row.values.batchId)===batchId);}}
      columns={[{key:'batchId',label:'매입 묶음'},{key:'skuId',label:'SKU'},{key:'qty',label:'구매수량',format:'number'},{key:'setQty',label:'세트구성',format:'number'},{key:'unitPrice',label:'외화 단가',format:'number'},{key:'fx',label:'행 환율',format:'number'},{key:'inspection',label:'검사 대상'}]} />
    <ReadTable title="배분 결과·상품별 원가" rows={costs} columns={[{key:'name',label:'상품명'},{key:'date',label:'매입일'},{key:'qty',label:'구매수량',format:'number'},{key:'saleQty',label:'판매수량',format:'number'},{key:'buyAmount',label:'구매원화',format:'money'},{key:'allocatedChina',label:'중국 배분',format:'money'},{key:'allocatedDomestic',label:'국내 배분',format:'money'},{key:'allocatedInspection',label:'검사 배분',format:'money'},{key:'allocatedExtra',label:'기타 배분',format:'money'},{key:'totalCost',label:'총원가',format:'money'},{key:'unitCost',label:'판매단위원가',format:'money'}]} empty="매입 묶음에 상품행을 연결하면 배분 결과를 확인할 수 있습니다." />
  </>;
}

export function statementApprovalState(rows:OpsRecord[],jobs:OpsRecord[]){
  const status=(value:unknown)=>str(value).trim().toLowerCase();
  const completedStatuses=new Set(['ok','confirmed','succeeded','completed','approved','success','확인 완료','승인 완료']);
  const unresolvedStatuses=new Set(['unknown','pending','queued','running','결과 불명','진행 중','승인 중']);
  const blockedSeqs=new Set<string>();
  for(const job of jobs){
    if(job.values.kind!=='statementConfirm'||!unresolvedStatuses.has(status(job.values.status)))continue;
    const params=job.values.params&&typeof job.values.params==='object'&&!Array.isArray(job.values.params)?job.values.params as Values:{};
    const seqs=params.purchaseOrderSeqs??job.values.purchaseOrderSeqs;
    if(Array.isArray(seqs))for(const seq of seqs)if(typeof seq==='string')blockedSeqs.add(seq);
  }
  const completed=rows.filter(row=>completedStatuses.has(status(row.values.status)));
  const unresolved=rows.filter(row=>!completed.includes(row)&&(unresolvedStatuses.has(status(row.values.status))||blockedSeqs.has(str(row.values.purchaseOrderSeq??row.values.poNumber))));
  return{completed,unresolved,eligible:rows.filter(row=>!completed.includes(row)&&!unresolved.includes(row))};
}

function Statements({ctx}:{ctx:OperationsContext}) {
  const [dateType,setDateType]=useState('PURCHASE_ORDER_DATE'),[from,setFrom]=useState(initialDate(ctx)),[to,setTo]=useState(today()),[selection,setSelected]=useState<string[]>([]);
  const rows=records(ctx,'statementApprovals');
  const jobs=records(ctx,'jobs');
  const {eligible,completed,unresolved}=useMemo(()=>statementApprovalState(rows,jobs),[rows,jobs]);
  const selected=selection.filter(id=>eligible.some(row=>row.id===id));
  const chosen=eligible.filter(row=>selected.includes(row.id));
  const validDates=!!from&&!!to&&from<=to;
  const confirmStatements=async()=>{
    if(!chosen.length){ctx.notify('확인할 거래명세서를 선택하세요.');return;}
    if(chosen.length>10){ctx.notify('거래명세서 승인은 한 번에 10건까지 가능합니다. 선택을 줄인 뒤 다시 요청하세요.');return;}
    const seqs=chosen.map(row=>str(row.values.purchaseOrderSeq??row.values.poNumber));
    if(seqs.some(value=>!value.trim())){ctx.notify('발주번호가 없는 내역은 승인할 수 없습니다.');return;}
    if(!window.confirm(`선택한 ${chosen.length}건의 거래명세서를 쿠팡에서 확인(승인)하도록 요청합니다.\n총 입고금액 ${money(chosen.reduce((sum,row)=>sum+num(row.values.amount),0))}\n발주번호: ${seqs.join(', ')}\n\n정산에 영향을 주며 되돌리기 어렵습니다. 이 항목들의 승인을 요청할까요?`))return;
    await ctx.collect?.('statementConfirm',{purchaseOrderSeqs:seqs,recordIds:chosen.map(row=>row.id),confirmed:true,startDate:from,endDate:to,dateType},'statementApprovals');
  };
  const rowFields:Field[]=[{key:'purchaseOrderSeq',label:'발주번호',required:true},{key:'date',label:'발주일',type:'date',required:true},{key:'expectedDate',label:'입고예정일',type:'date'},{key:'name',label:'첫 SKU명'},{key:'qty',label:'SKU수',type:'number'},{key:'amount',label:'입고금액(원)',type:'number'},{key:'center',label:'물류센터'},{key:'status',label:'조회 상태',type:'select',options:['대기','미확인','실패','결과 불명'],default:'대기'},{key:'message',label:'조회·확인 메모',type:'textarea'}];
  return <>
    <StatCards items={[{label:'조회된 명세서',value:rows.length},{label:'선택',value:chosen.length},{label:'확인 완료',value:completed.length},{label:'진행·결과 확인 필요',value:unresolved.length},{label:'선택 입고금액',value:money(chosen.reduce((sum,row)=>sum+num(row.values.amount),0))}]} />
    <section className="ops-panel"><h2>거래명세서 자동확인</h2><div className="ops-toolbar"><label>조회 기준<select value={dateType} onChange={event=>setDateType(event.target.value)}><option value="PURCHASE_ORDER_DATE">발주일</option><option value="WAREHOUSING_PLAN_DATE">입고예정일</option></select></label><label>시작일<input type="date" value={from} onChange={event=>setFrom(event.target.value)} /></label><label>종료일<input type="date" value={to} onChange={event=>setTo(event.target.value)} /></label>
      {validDates?<CollectButton ctx={ctx} kind="statements" label="확인요청 대상 조회" values={{dateType,startDate:from,endDate:to}} dataset="statementApprovals" />:<span className="ops-danger">시작일과 종료일을 확인하세요.</span>}
    </div><p className="ops-note">서플라이어허브의 거래명세서 확인요청(RI) 항목을 읽고, 한 번에 최대 10건을 별도 승인합니다. 진행 중이거나 결과가 불명인 발주는 다시 승인할 수 없습니다. Supplier Hub의 실제 상태와 수집 기록을 먼저 확인하세요.</p>
      {unresolved.length>0&&<p className="ops-danger">진행·결과 확인이 필요한 {unresolved.length}건은 재승인 대상에서 제외했습니다.</p>}
      <div className="ops-toolbar"><label><input type="checkbox" checked={eligible.length>0&&chosen.length===eligible.length} onChange={event=>{if(event.target.checked&&eligible.length>10){ctx.notify('승인은 한 번에 10건까지 가능합니다. 개별 항목을 선택하세요.');return;}setSelected(event.target.checked?eligible.map(row=>row.id):[]);}} />미완료 항목 전체 선택</label><ActionButton variant="danger" disabled={ctx.busy||chosen.length===0||chosen.length>10} onClick={confirmStatements}>선택 {chosen.length}건 확인 요청</ActionButton></div>
      {eligible.length>0?<div className="ops-statement-picks">{eligible.map(row=><label key={row.id}><input type="checkbox" checked={selected.includes(row.id)} onChange={event=>{if(event.target.checked&&chosen.length>=10){ctx.notify('승인은 한 번에 10건까지 가능합니다. 선택한 항목을 해제한 뒤 추가하세요.');return;}setSelected(event.target.checked?[...new Set([...selected,row.id])]:selected.filter(id=>id!==row.id));}} /><strong>{str(row.values.purchaseOrderSeq??row.values.poNumber)}</strong> · {str(row.values.name)||'상품명 미확인'} · {money(row.values.amount)} · {str(row.values.status)||'대기'}</label>)}</div>:<p className="ops-empty">확인할 미완료 거래명세서가 없습니다.</p>}
    </section>
    <RecordPanel ctx={ctx} dataset="statementApprovals" title="거래명세서 내역" description="수기로 추가한 메모나 상태는 쿠팡의 승인 완료 증거가 아닙니다. 실제 승인 결과는 연결 프로그램이 반환한 결과로 구분됩니다."
      fields={rowFields} initialValues={{date:initialDate(ctx),status:'대기'}} columns={[{key:'purchaseOrderSeq',label:'발주번호'},{key:'name',label:'첫 SKU명'},{key:'date',label:'발주일'},{key:'expectedDate',label:'입고예정일'},{key:'amount',label:'입고금액',format:'money'},{key:'center',label:'센터'},{key:'status',label:'상태'},{key:'message',label:'결과·메모'}]} />
    <ReadTable title="처리 요청 기록" rows={records(ctx,'jobs').filter(row=>['statements','statementConfirm'].includes(str(row.values.kind))).map(row=>({...row.values,id:row.id}))} columns={[{key:'id',label:'요청ID'},{key:'kind',label:'작업'},{key:'status',label:'상태'},{key:'message',label:'진행·결과'}]} />
  </>;
}

export function LogisticsView({view,ctx}:{view:string;ctx:OperationsContext}) {
  if(view==='ledger')return <Ledger ctx={ctx}/>;
  if(view==='import-cost')return <ImportCost ctx={ctx}/>;
  if(view==='statements')return <Statements ctx={ctx}/>;
  return <Purchasing ctx={ctx}/>;
}
