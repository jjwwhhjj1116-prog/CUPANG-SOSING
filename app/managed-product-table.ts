import type {ManagedProduct} from '@/app/managed-products';

export type ManagedTableColumn={id:string;label:string;field:string;kind?:'image'|'title'|'link'|'json';numeric?:boolean};
const column=(field:string,label=field,extra:Partial<ManagedTableColumn>={}):ManagedTableColumn=>({id:field,label,field,...extra});
/** Labels/order observed on the registered-products table. Values retain their
 * original exported keys; no margin or registration facts are recalculated. */
export const managedVisibleColumns:readonly ManagedTableColumn[]=[
 column('썸네일','이미지',{kind:'image'}),column('상품명','상품명',{kind:'title'}),column('SKUID','SKU ID'),column('바코드'),column('노출ID'),column('옵션ID'),column('판매링크','판매링크',{kind:'link'}),column('발주가능상태'),column('재고','쿠팡재고',{numeric:true}),column('판매가','판매가',{numeric:true}),column('공급가','공급가',{numeric:true}),column('리뷰평점','리뷰평점',{numeric:true}),column('리뷰수','리뷰수',{numeric:true}),column('구매정보','구매정보',{kind:'json'}),column('매입정보','매입관리',{kind:'json'}),column('마진','마진',{numeric:true}),column('마진율','마진율',{numeric:true}),column('ROI','ROI',{numeric:true}),column('최소ROAS','최소ROAS',{numeric:true}),column('쿠팡마진','쿠팡마진',{numeric:true}),column('쿠팡마진율','쿠팡마진율',{numeric:true}),column('바코드출력','바코드출력',{field:'바코드'}),
];
const remaining=['제품분류','vendorItemId','productId','판매가기준일','구매링크','옵션1_중국어','옵션2_중국어','판매구성수량','매입단가','공급가액','부가세액','총매입가','latestImportPrice','구매정보여부','winner','productIdHistory','priceHistory','otherSellers'];
export const managedTableColumns:readonly ManagedTableColumn[]=[...managedVisibleColumns,...remaining.map(field=>column(field,field,{...(['productIdHistory','priceHistory','otherSellers'].includes(field)?{kind:'json' as const}:field.endsWith('링크')?{kind:'link' as const}:{}),...(['판매구성수량','매입단가','공급가액','부가세액','총매입가','latestImportPrice'].includes(field)?{numeric:true}:{})}))];
export type ManagedTableSort={column:string;direction:'ascending'|'descending'};
export type ManagedTableFilter={column:string;operator:'contains'|'eq'|'ne'|'gte'|'lte';value:string};
export type ManagedTableQuery={sort:ManagedTableSort|null;columnFilters:ManagedTableFilter[]};
export function managedColumn(id:string){return managedTableColumns.find(column=>column.id===id);}
export function managedCell(product:ManagedProduct,id:string):string{const definition=managedColumn(id);return !definition?'':id==='latestImportPrice'&&product.latestImportedPrice?product.latestImportedPrice.price:definition.kind==='title'?product.title:product.values[definition.field]??'';}
const invalid=()=>new Error('상품 표의 정렬·열 필터 조건을 확인해주세요.');
export function parseManagedTableQuery(params:URLSearchParams):ManagedTableQuery{
 const id=params.get('sort'),direction=params.get('direction');let sort:ManagedTableSort|null=null;
 if(id!==null||direction!==null){if(!id||!managedColumn(id)||!['ascending','descending'].includes(direction??''))throw invalid();sort={column:id,direction:direction as ManagedTableSort['direction']};}
 const raw=params.get('columnFilters');if(raw!==null&&raw.length>8000)throw invalid();let input:unknown=[];try{if(raw!==null)input=JSON.parse(raw);}catch{throw invalid();}
 if(!Array.isArray(input)||input.length>8)throw invalid();const used=new Set<string>();
 const columnFilters=input.map((item:unknown):ManagedTableFilter=>{if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).length!==3)throw invalid();const value=item as Record<string,unknown>,column=typeof value.column==='string'?managedColumn(value.column):undefined;
  if(!column||used.has(column.id)||typeof value.value!=='string'||value.value.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.value)||!['contains','eq','ne','gte','lte'].includes(String(value.operator)))throw invalid();
  if(['gte','lte'].includes(String(value.operator))&&(!column.numeric||!value.value.trim()||!Number.isFinite(Number(value.value))))throw invalid();used.add(column.id);return{column:column.id,operator:value.operator as ManagedTableFilter['operator'],value:value.value};
 });return{sort,columnFilters};
}
export function managedTableParams(query:ManagedTableQuery):Record<string,string>{return{...(query.sort?{sort:query.sort.column,direction:query.sort.direction}:{}),...(query.columnFilters.length?{columnFilters:JSON.stringify(query.columnFilters)}:{})};}
/** SQL identifiers/paths come exclusively from the above fixed column map.
 * All user-entered values are bound arguments, including LIKE wildcards. */
export function managedTableSql(query:ManagedTableQuery){
 const expression=(id:string)=>{const definition=managedColumn(id);if(!definition)throw invalid();return definition.kind==='title'?'title':id==='SKUID'?'sku_id':id==='latestImportPrice'?`COALESCE((SELECT price FROM managed_import_prices i WHERE i.owner_id=managed_products.owner_id AND i.company_code=managed_products.company_code AND i.sku_id=managed_products.sku_id ORDER BY import_date DESC LIMIT 1),CAST(json_extract(source_payload,'$."latestImportPrice"') AS TEXT),'')`:`COALESCE(CAST(json_extract(source_payload,'$."${definition.field}"') AS TEXT),'')`;};
 const number=(text:string)=>{const json=`('['||${text}||']')`;return`CASE WHEN json_valid(${json}) THEN CASE WHEN json_array_length(${json})=1 AND json_type(${json},'$[0]') IN ('integer','real') THEN CAST(${text} AS REAL) END END`;};
 const args:(string|number)[]=[],conditions=query.columnFilters.map(filter=>{const value=expression(filter.column);if(filter.operator==='contains'){args.push('%'+filter.value.replace(/[\\%_]/g,value=>'\\'+value)+'%');return`${value} LIKE ? ESCAPE '\\'`;}
  if(filter.operator==='gte'||filter.operator==='lte'){args.push(Number(filter.value));return`${number(value)} ${filter.operator==='gte'?'>=':'<='} ?`;}
  args.push(filter.value);return`${value} ${filter.operator==='eq'?'=':'<>'} ?`;
 });let orderBy='first_imported_at DESC,source_row,sku_id';
 if(query.sort){const value=expression(query.sort.column),direction=query.sort.direction==='ascending'?'ASC':'DESC',numeric=managedColumn(query.sort.column)!.numeric;orderBy=numeric?`${number(value)} IS NULL ASC,${number(value)} ${direction},source_row,sku_id`:`${value} COLLATE NOCASE ${direction},source_row,sku_id`;}
 return{where:conditions.length?' AND '+conditions.map(value=>'('+value+')').join(' AND '):'',args,orderBy};
}
