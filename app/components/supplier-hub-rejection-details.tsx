import {isRejectionDetails} from '../../extensions/supplier-hub/rejection-details.mjs';

/** Render native diagnostics as escaped text, scoped by the parent receipt. */
export function SupplierHubRejectionDetails({details}:{details:unknown}){
  if(!isRejectionDetails(details)||details.status!=='available')return <p>반려 상세는 Supplier Hub에서 확인해주세요.</p>;
  return <div className="quotation-fields-bulk-table"><table>
    <caption>Supplier Hub 반려 상세</caption>
    <thead><tr><th scope="col">항목</th><th scope="col">반려 사유</th></tr></thead>
    <tbody>{details.errors.map((error,index)=><tr key={index}><td>{error.columnName}</td><td style={{whiteSpace:'pre-wrap'}}>{error.message}</td></tr>)}</tbody>
  </table></div>;
}
