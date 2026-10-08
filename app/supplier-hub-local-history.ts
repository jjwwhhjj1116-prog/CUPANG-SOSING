export type SupplierHubLocalTransmission={key:string;value:Record<string,unknown>};
export function validateSupplierHubLocalHistory(value:unknown,origin:string,productId:string){
  if(!Array.isArray(value)||value.length>200||new TextEncoder().encode(JSON.stringify(value)).length>512*1024)throw Error('Chrome의 상품 전체 전송 이력을 확인하지 못했습니다.');
  const rows=value as SupplierHubLocalTransmission[];
  for(const row of rows){const record=row?.value;
    if(!record||!['transmission','result'].some(kind=>row.key===`${kind}:${origin}:${productId}:${record.categoryId}:${record.fingerprint}`)
      ||record.origin!==origin||record.productId!==productId||typeof record.categoryId!=='string'||!/^\d{1,20}$/.test(record.categoryId)
      ||typeof record.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(record.fingerprint)||record.registered!==false)throw Error('이전 Chrome 전송 기록이 불확실하여 새 첨부를 중단했습니다.');
  }
  const rejected=new Set(rows.filter(row=>{
    const result=row.value,company=result.company as {code?:string;name?:string}|undefined;
    return row.key.startsWith('result:')&&result.state==='validation-rejected'&&!result.quotationId&&result.registration===undefined
      &&result.filename===`YOOFAM-${result.fingerprint}.xlsx`&&Number.isSafeInteger(result.includedOptions)&&(result.includedOptions as number)>=1&&(result.includedOptions as number)<=200
      &&Number.isSafeInteger(result.observedAt)&&(result.observedAt as number)>0&&(result.observedAt as number)<=Date.now()+60000
      &&(company?.code==='A01464742'&&company.name==='와이홉'||company?.code==='A01526306'&&company.name==='유앤채');
  }).map(row=>row.value.fingerprint));
  return {records:rows,blocked:rows.some(row=>!rejected.has(row.value.fingerprint))};
}
