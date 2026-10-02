/** Current explicit choices, independent of workbook defaults. */
export function supplierHubAgreementsReady(value:{priceData:boolean;labelBusinessContact:boolean;legalDocumentsNotApplicable:boolean;legalDocumentsRequired?:boolean},requiresDocuments=false){
 return value.priceData===true&&value.labelBusinessContact===true&&(requiresDocuments
  ?value.legalDocumentsRequired===true&&value.legalDocumentsNotApplicable===false
  :value.legalDocumentsNotApplicable===true&&value.legalDocumentsRequired!==true);
}
