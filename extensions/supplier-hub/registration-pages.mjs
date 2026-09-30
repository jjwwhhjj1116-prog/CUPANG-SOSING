// Read-only aggregation: the caller owns the search tab and checks its company,
// validation identity and window before and after every rendered-page operation.
export async function collectSupplierHubRegistrationPages(quotationId,includedOptions,{read,advance,check,now=Date.now}){
  if(typeof quotationId!=='string'||!quotationId||quotationId!==quotationId.trim()||quotationId.length>200
    ||!Number.isSafeInteger(includedOptions)||includedOptions<1||includedOptions>200)throw Error('견적서 ID와 전송한 옵션 수를 확인해주세요.');
  const rows=[],start=now();let snapshot,pagesRead=0;
  const fields=['title','submittedAt','category','barcode','sourceQuotation','skuId','status','stage'];
  for(;;){
    await check();
    snapshot=pagesRead?await advance(snapshot.page):await read();
    await check();
    if(!snapshot||snapshot.quotationId!==quotationId||snapshot.scope!=='visible-page'||snapshot.registered!==false
      ||!Array.isArray(snapshot.rows)||snapshot.rows.length>includedOptions
      ||snapshot.rows.some(row=>!row||fields.some(field=>typeof row[field]!=='string'||row[field].length>20000)))throw Error('현재 견적서의 페이지 결과를 확인하지 못했습니다.');
    const page=snapshot.page;
    if(!page||page.current!==null&&(!Number.isSafeInteger(page.current)||page.current<1||page.current>200)
      ||![true,false,null].includes(page.hasNext)||typeof page.signature!=='string'||page.signature!==JSON.stringify(snapshot.rows)
      ||page.current===null&&page.hasNext!==null)throw Error('상품 등록 결과의 페이지 표시를 확인하지 못했습니다.');
    if(page.current!==null&&page.current!==pagesRead+1||pagesRead&&page.current===null)throw Error('견적서 조회가 첫 페이지부터 순서대로 진행되지 않았습니다.');
    rows.push(...snapshot.rows);pagesRead++;
    if(rows.length>includedOptions)throw Error('조회된 상품 수가 전송한 옵션 수보다 많습니다.');
    const skus=rows.map(row=>row.skuId.trim()).filter(value=>value&&!/\.\.\.|…/.test(value)&&!/^(?:-|—|n\/a|미표시|해당사항없음)$/i.test(value));
    if(new Set(skus).size!==skus.length)throw Error('페이지 간 같은 SKU ID가 중복되어 결과를 확인하지 못했습니다.');
    if(page.hasNext!==true||pagesRead>=200||now()-start>=60000){
      if(page.current===null)return {quotationId,scope:'visible-page',registered:false,rows};
      return {quotationId,scope:'queried-pages',registered:false,rows,pagesRead,hasMore:page.hasNext};
    }
  }
}
