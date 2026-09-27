import type { CategoryProfileInput } from '@/app/category-profiles';
import type { ResolvedQuotation } from '@/app/quotation-schema';
import type { SubmissionIssue } from '@/app/submission-review';
import type { MappedQuotationReport } from '@/app/exports/mapped-quotation';

/** Only definite workbook violations block handoff; unevaluated formulas remain warnings. */
export function quotationWorkbookIssues(report: MappedQuotationReport, profile: CategoryProfileInput, resolved: ResolvedQuotation): SubmissionIssue[] {
  const aliases:Record<string,string>={boxQuantity:'boxSkuQuantity',detailImage:'detailImages',label:'labelImages',material:'noticeMaterial',countryOfOrigin:'noticeCountryOfOrigin',serviceContact:'noticeServiceContact'};
  const rows=resolved.rows.filter(row=>row.included);
  const issues:SubmissionIssue[]=[];
  const add=(cell:{row:number;column:number;header:string},code:string,message:string)=>{
    const row=rows[cell.row-report.dataStartRow];
    const mapping=profile.mappings.find(mapping=>mapping.column===cell.column-1);
    const field=mapping ? aliases[mapping.field]??mapping.field : null;
    issues.push({kind:'error',code,optionId:row?.optionId??null,optionLabel:row?.optionLabel??'견적서 양식',
      fieldId:resolved.schema.fields.some(item=>item.id===field)?field:null,
      message:`${profile.template?.sheetName||'견적서'} · ${cell.row}행 ${cell.column}열 (${cell.header}): ${message}`});
  };
  for(const cell of report.validationIssues)add(cell,'EXCEL_VALUE_INVALID',cell.message);
  const invalid=new Set(report.validationIssues.map(cell=>`${cell.row}:${cell.column}`));
  for(const cell of report.missingRequired)if(!invalid.has(`${cell.row}:${cell.column}`))add(cell,'EXCEL_REQUIRED_MISSING','양식에서 필수로 지정한 값이 비어 있습니다.');
  if(report.validationIssueCount>report.validationIssues.length)issues.push({kind:'error',code:'EXCEL_VALUE_INVALID_OVERFLOW',optionId:null,optionLabel:'견적서 양식',fieldId:null,message:`원본 Excel 입력 규칙 불일치 ${report.validationIssueCount}개 중 ${report.validationIssues.length}개를 표시했습니다. 값을 수정한 뒤 다시 검사해주세요.`});
  return issues;
}
