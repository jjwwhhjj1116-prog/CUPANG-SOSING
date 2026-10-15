'use client';
import { useEffect, useRef, useState } from 'react';
import type { OptionCalculation, OptionField, OptionInput } from '@/app/product-options';
import { effectiveGridPrices } from '@/app/option-price-grid';
import { savedOptionRegistrationNumber, optionRegistrationLabel } from '@/app/product-registration';
import type { OptionPriceController } from '@/app/components/option-quotation-prices';
import './option-price-table.css';

const columns = [
  { id: 'name', label: '옵션명', width: 270 }, { id: 'id', label: '옵션번호', width: 150 },
  { id: 'quantity', label: '번들수량', width: 115 }, { id: 'stock', label: '재고', width: 100 },
  { id: 'cost', label: '중국원가(CNY)', width: 150 }, { id: 'supply', label: '공급가(KRW)', width: 130 },
  { id: 'supplyMargin', label: '공급마진', width: 140 }, { id: 'sale', label: '판매가(KRW)', width: 130 },
  { id: 'coupangMargin', label: '쿠팡마진', width: 140 },
] as const;
type ColumnId = typeof columns[number]['id'];
type Props = { rows: readonly OptionInput[]; calculations: readonly OptionCalculation[]; selected: ReadonlySet<string>;
  focusedOptionId?: string; optionRegistrationNumbers?: Readonly<Record<string,string>>; onSelect: (ids: string[]) => void;
  priceController?:OptionPriceController;priceBlocked?:boolean;
  onChange: <K extends OptionField>(id: string, key: K, value: OptionInput[K]) => void };
const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`;
const percent = (value: number) => `${Math.round(value)}%`;
const defaultPageSize = 20;
// Recorded table display contract; monetary calculations stay in calculateOptionPrices.
const marginRate = (cost: number, sale: number) => !cost || !sale || cost >= sale ? 0 : Math.round((sale - cost) / sale * 100);

/** Presentation state never replaces the editor's complete option draft. */
export function OptionPriceTable({ rows, calculations, selected, focusedOptionId, optionRegistrationNumbers, onSelect, onChange,priceController,priceBlocked=false }: Props) {
  const [query, setQuery] = useState(''), [pageSize, setPageSize] = useState(defaultPageSize);
  const [page, setPage] = useState(() => Math.max(0, Math.floor(rows.findIndex(row => row.id === focusedOptionId) / defaultPageSize)));
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(() => columns.map(column => column.id));
  const [pinned, setPinned] = useState<ColumnId | ''>('name'), [fixedHeight, setFixedHeight] = useState(true);
  const root = useRef<HTMLDivElement>(null), focused = useRef<string | undefined>(undefined);
  let priceError='';let effective:ReturnType<typeof effectiveGridPrices>|undefined;
  if(priceController)try{effective=effectiveGridPrices(rows,calculations,priceController.view,priceController.edits);}catch(cause){priceError=cause instanceof Error?cause.message:'가격 연결 확인 실패';}
  const displayed=effective?calculations.map(row=>({...row,calculation:effective!.get(row.optionId)?.calculation??null,error:effective!.get(row.optionId)?.error??row.error})):calculations;
  const byId = new Map(displayed.map(row => [row.optionId, row]));
  const entries = rows.map((row, index) => ({ row, index, result: byId.get(row.id) }));
  const filtered = (() => {
    const needle = query.trim().toLocaleLowerCase('ko-KR');
    return needle ? entries.filter(({ row, result }) => [savedOptionRegistrationNumber(row.id,optionRegistrationNumbers), row.id, row.supplierSku, row.originalName, row.translatedName,
      row.unitsPerPack, row.stock, row.unitCostCny, result?.calculation?.supplyPrice, result?.calculation?.salePrice,
      result?.calculation?.marginKrw].some(value => value != null && String(value).toLocaleLowerCase('ko-KR').includes(needle))) : entries;
  })();
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize)), currentPage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const shownColumns = columns.filter(column => visibleColumns.includes(column.id));
  const allFilteredSelected = filtered.length > 0 && filtered.every(({ row }) => selected.has(row.id));
  const partiallyFilteredSelected = !allFilteredSelected && filtered.some(({ row }) => selected.has(row.id));
  const valid = displayed.filter(row => row.included && row.calculation !== null && row.error === null);
  const average = (value: (row: Pick<NonNullable<OptionCalculation['calculation']>,'costKrw'|'supplyPrice'|'salePrice'|'marginKrw'>) => number) => valid.length
    ? valid.reduce((sum, row) => sum + value(row.calculation!), 0) / valid.length : null;
  const averages = { supply: average(row => row.supplyPrice), supplyMargin: average(row => row.marginKrw),
    sale: average(row => row.salePrice), coupangMargin: average(row => row.salePrice - row.supplyPrice),
    supplyRate: average(row => marginRate(row.costKrw, row.supplyPrice)), coupangRate: average(row => marginRate(row.supplyPrice, row.salePrice)) };
  useEffect(() => {
    if (!focusedOptionId || focused.current === focusedOptionId) return;
    const target = root.current?.querySelector<HTMLElement>(`[data-price-option-id="${focusedOptionId}"]`);
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    target.querySelector<HTMLElement>('input[type="number"]')?.focus({ preventScroll: true });
    focused.current = focusedOptionId;
  }, [focusedOptionId, currentPage, query, pageSize, visibleColumns, rows]);
  function toggleSelection(id: string, checked: boolean) {
    const next = new Set(selected); if (checked) next.add(id); else next.delete(id); onSelect([...next]);
  }
  function toggleColumn(id: ColumnId, checked: boolean) {
    if (!checked && visibleColumns.length === 1) return;
    setVisibleColumns(previous => columns.filter(column => checked ? previous.includes(column.id) || column.id === id : previous.includes(column.id) && column.id !== id).map(column => column.id));
    if (!checked && pinned === id) setPinned('');
  }
  function editable(row:OptionInput){return !priceBlocked&&!priceController?.busy&&!priceController?.uncertain&&!!priceController?.targets&&row.included&&priceController.view?.resolved.rows.some(value=>value.optionId===row.id&&value.included);}
  function priceInput(row:OptionInput,index:number,input:'supplyPrice'|'salePrice'|'msrp',label:string){const values=effective?.get(row.id),value=input==='supplyPrice'?values?.supply:input==='salePrice'?values?.sale:values?.msrp;
    return <><input type="number" min={1} step={1} aria-label={`가격 옵션 ${index+1} ${label}`} value={value??''} disabled={!editable(row)} onKeyDown={event=>{if(event.key==='Enter')event.preventDefault();}} onChange={event=>priceController?.change(row.id,input,event.target.value)}/><button type="button" className="btn ghost" aria-label={`가격 옵션 ${index+1} ${label} 복원`} disabled={!editable(row)} onClick={()=>priceController?.change(row.id,input,null)}>복원</button></>;}
  function cell(id: ColumnId, row: OptionInput, index: number, result: typeof displayed[number] | undefined) {
    const calculation = result?.calculation;
    switch (id) {
      case 'name': return <><strong>{row.translatedName || row.originalName || `옵션 ${index + 1}`}</strong><small>{row.supplierSku || '공급자 SKU 미입력'}</small></>;
      case 'id': return savedOptionRegistrationNumber(row.id,optionRegistrationNumbers);
      case 'quantity': return <input aria-label={`가격 옵션 ${index + 1} 구성 수량`} type="number" min="1" step="1" disabled={priceBlocked} value={Number.isFinite(row.unitsPerPack) ? row.unitsPerPack : ''} onChange={event => onChange(row.id, 'unitsPerPack', event.target.valueAsNumber)} />;
      case 'stock': return row.stock == null ? '미확인' : row.stock.toLocaleString('ko-KR');
      case 'cost': return <input aria-label={`가격 옵션 ${index + 1} 개당 원가`} type="number" min="0" step="any" disabled={priceBlocked} value={row.unitCostCny === null || !Number.isFinite(row.unitCostCny) ? '' : row.unitCostCny} onChange={event => onChange(row.id, 'unitCostCny', event.target.value === '' ? null : event.target.valueAsNumber)} />;
      default:
        if (!row.included) return <span>견적 제외</span>;
        if(priceController&&(id==='supply'||id==='sale'))return priceInput(row,index,id==='supply'?'supplyPrice':'salePrice',id==='supply'?'공급가':'판매가');
        if (!calculation) return <span role="status">{result?.error || '계산 미완료'}</span>;
        if (id === 'supply') return won(calculation.supplyPrice);
        if (id === 'sale') return won(calculation.salePrice);
        if (id === 'supplyMargin') return <>{won(calculation.marginKrw)}<small>({percent(marginRate(calculation.costKrw, calculation.supplyPrice))})</small></>;
        return <>{won(calculation.salePrice - calculation.supplyPrice)}<small>({percent(marginRate(calculation.supplyPrice, calculation.salePrice))})</small></>;
    }
  }
  return <div ref={root} className="option-price-grid" aria-label="옵션별 가격 정보">
    {priceError&&<p role="alert">{priceError}</p>}
    <div className="option-price-grid-tools">
      <label className="option-price-grid-search">Search<input aria-label="가격 옵션 검색" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
      <label>Items per page<select aria-label="가격표 페이지당 옵션 수" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(0); }}>{[10, 20, 25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
      <details className="option-price-grid-columns"><summary>선택 컬럼 보기 · {visibleColumns.length}개</summary><div>{columns.map(column => <label key={column.id}><input type="checkbox" aria-label={`가격표 ${column.label} 표시`} checked={visibleColumns.includes(column.id)} disabled={visibleColumns.length === 1 && visibleColumns[0] === column.id} onChange={event => toggleColumn(column.id, event.target.checked)} />{column.label}</label>)}<button type="button" className="btn ghost" onClick={() => setVisibleColumns(columns.map(column => column.id))}>가격표 전체 열 표시</button></div></details>
      <label>고정할 열 선택<select aria-label="가격표 고정할 열" value={pinned} onChange={event => setPinned(event.target.value as ColumnId | '')}><option value="">고정 없음</option>{shownColumns.map(column => <option key={column.id} value={column.id}>{column.label}</option>)}</select></label>
      <fieldset><legend>높이고정</legend>{[true, false].map(value => <label key={String(value)}><input type="radio" name="option-price-height" aria-label={`가격표 높이 고정 ${value ? 'Y' : 'N'}`} checked={fixedHeight === value} onChange={() => setFixedHeight(value)} />{value ? 'Y' : 'N'}</label>)}</fieldset>
    </div>
    <div className={`option-price-grid-scroll${fixedHeight ? ' option-price-grid-fixed' : ''}`} tabIndex={0} aria-label="옵션 가격표 스크롤 영역">
      <table className="option-price-grid-table" style={{ minWidth: 52 + shownColumns.reduce((sum, column) => sum + column.width, 0) }}>
        <caption>옵션별 가격 정보 · 저장된 가격 정책 기준</caption>
        <colgroup><col style={{ width: 52 }} />{shownColumns.map(column => <col key={column.id} style={{ width: column.width }} />)}</colgroup>
        <thead><tr><th className="option-price-grid-selection"><input type="checkbox" aria-label="가격 검색 결과 전체 선택" aria-checked={partiallyFilteredSelected ? 'mixed' : allFilteredSelected} ref={input => { if(input) input.indeterminate = partiallyFilteredSelected; }} checked={allFilteredSelected} disabled={!filtered.length} onChange={event => onSelect(event.target.checked ? filtered.map(({ row }) => row.id) : [])} /></th>{shownColumns.map(column => <th key={column.id} data-price-column={column.id} className={pinned === column.id ? 'option-price-grid-pinned' : undefined}>{column.label}</th>)}</tr></thead>
        <tbody>{pageRows.map(({ row, index, result }) => <tr key={row.id} data-option-target={row.id === focusedOptionId} data-price-option-id={row.id}>
          <td className="option-price-grid-selection"><label><input type="checkbox" aria-label={`가격 옵션 ${index + 1} 선택`} checked={selected.has(row.id)} onChange={event => toggleSelection(row.id, event.target.checked)} /><span className="sr-only">선택</span></label><label><input type="checkbox" aria-label={`가격 옵션 ${index + 1} 견적 포함`} disabled={priceBlocked} checked={row.included} onChange={event => onChange(row.id, 'included', event.target.checked)} /><span className="sr-only">견적 포함</span></label></td>
          {shownColumns.map(column => <td key={column.id} data-price-column={column.id} className={pinned === column.id ? 'option-price-grid-pinned' : undefined}>{cell(column.id, row, index, result)}</td>)}
        </tr>)}</tbody>
      </table>
      {!pageRows.length && <p className="option-price-grid-empty">검색 결과가 없습니다.</p>}
    </div>
    <div className="option-price-grid-pagination"><span>{filtered.length ? `${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, filtered.length)}` : '0'} / {filtered.length}개</span><button type="button" className="btn ghost" aria-label="가격표 이전 페이지" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>이전</button><span aria-label="가격표 현재 페이지">{currentPage + 1} / {pageCount}</span><button type="button" className="btn ghost" aria-label="가격표 다음 페이지" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>다음</button></div>
    <section className="option-price-grid-summary" aria-label="전체 옵션 가격 요약"><header><h4>가격 요약</h4><small>전체 견적 포함 {rows.filter(row => row.included).length}개 · 계산 가능 {valid.length}개</small></header><div>
      <article><h5>평균 공급가</h5><strong>{averages.supply === null ? '—' : won(averages.supply)}</strong><p>평균 공급 마진: {averages.supplyMargin === null ? '—' : won(averages.supplyMargin)}</p></article>
      <article><h5>평균 판매가</h5><strong>{averages.sale === null ? '—' : won(averages.sale)}</strong><p>평균 쿠팡 마진: {averages.coupangMargin === null ? '—' : won(averages.coupangMargin)}</p></article>
      <article><h5>평균 마진율</h5><strong>공급: {averages.supplyRate === null ? '—' : percent(averages.supplyRate)}</strong><p>쿠팡: {averages.coupangRate === null ? '—' : percent(averages.coupangRate)}</p></article>
    </div></section>
    {priceController&&<details><summary>권장소비자가·가격 복원</summary>{rows.filter(row=>row.included).map(row=>{const index=rows.findIndex(value=>value.id===row.id);return <label className="field" key={row.id}><span>{optionRegistrationLabel(row.id,row.translatedName||row.originalName||row.id,optionRegistrationNumbers)} · 권장소비자가</span><div>{priceInput(row,index,'msrp','권장소비자가')}</div></label>;})}</details>}
    <p>옵션명·이미지·치수·복제는 상단 옵션·사이즈표에서 수정합니다. 왼쪽 가격 정책은 저장한 뒤 이 표에 반영됩니다.</p>
  </div>;
}
