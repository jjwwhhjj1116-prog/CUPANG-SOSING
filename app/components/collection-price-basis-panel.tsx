import type { CollectionResult } from '@/app/collection-result';

export function CollectionPriceBasisPanel({ result }: { result: CollectionResult }) {
  if (result.offerDefault) return <details className="collection-price-basis">
    <summary>원가 계산 기준 · 옵션 구분 없는 상품</summary>
    <p>상품 가격표 첫 행의 {result.offerDefault.unitPriceCny}위안을 기본 옵션 원가로 사용했습니다. 공급자 SKU는 제공되지 않아 비워 두었습니다.</p>
  </details>;
  if(result.pagePriceBasis){const basis=result.pagePriceBasis,keys=basis.review?.sourceKeys??basis.rows.map(row=>row.key);return <details className="collection-price-basis"><summary>원가 계산 기준 · 브라우저 공개 원문</summary>
    <p>{basis.selection==='common-original-first-tier'?'상품 공통 원가표의 첫 가격':basis.selection==='original-per-sku'?'옵션별 원문 원가':'관찰된 페이지 가격'}을 사용했습니다. 공급자별 배급가·위탁가와의 일치는 확인하지 않았습니다.</p>
    <div className="table-wrap"><table><thead><tr><th>SKU</th><th>관찰 가격 CNY</th><th>사용 원가 CNY</th><th>검토 수정</th></tr></thead><tbody>{keys.map((key,index)=>{const row=basis.rows.find(row=>row.key===key)!;return <tr key={key}><td>{row.sku}</td><td>{row.observedPrice??'미확인'}</td><td>{result.options[index].unitPriceCny}</td><td>{basis.review?.overrides.some(row=>row.key===key)?'직접 수정':'원문 기준'}</td></tr>;})}</tbody></table></div></details>;}
  const basis = result.priceBasis;
  if (!basis) return null;
  return <details className="collection-price-basis">
    <summary>원가 계산 기준 · {basis.selection === 'uniform-first-base' ? '가격표 첫 가격' : '옵션별 원문 가격'}</summary>
    <p>{basis.selection === 'uniform-first-base'
      ? `모든 원문 SKU 가격이 같아 상품 가격표 첫 행의 ${basis.firstBasePriceCny}위안을 견적 원가로 사용했습니다.`
      : '옵션마다 원문 가격이 달라 각 SKU의 배급가 또는 위탁가를 견적 원가로 사용했습니다.'}</p>
    <div className="table-wrap"><table><thead><tr><th>SKU</th><th>가격 출처</th><th>원문 SKU 가격 CNY</th><th>견적 원가 CNY</th></tr></thead>
      <tbody>{basis.skuPrices.map((price, index) => <tr key={price.sku}><td>{price.sku}</td>
        <td>{price.source === 'fenxiao-offer-price' ? '배급가' : '위탁가'}</td><td>{price.unitPriceCny}</td><td>{result.options[index].unitPriceCny}</td></tr>)}</tbody></table></div>
  </details>;
}
