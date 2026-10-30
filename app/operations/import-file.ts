import type {Field,Values} from './types';

export function parseDelimited(text:string):string[][]{
 text=text.replace(/^\uFEFF/,'');let headerQuote=false,tabs=0;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(headerQuote&&text[i+1]==='"'){i++;continue;}headerQuote=!headerQuote;}else if(!headerQuote&&c==='\t')tabs++;else if(!headerQuote&&(c==='\n'||c==='\r'))break;}
 const delimiter=tabs?'\t':',';
 const rows:string[][]=[];let row:string[]=[],value='',quoted=false,afterQuote=false;
 const cell=()=>{row.push(value);value='';afterQuote=false;};
 const line=()=>{cell();if(row.some(v=>v.trim()))rows.push(row);row=[];};
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;afterQuote=true;}}else value+=c;continue;}
  if(c===delimiter){cell();continue;}
  if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;line();continue;}
  if(afterQuote){if(c===' '||c==='\t')continue;throw Error('닫힌 따옴표 뒤에 잘못된 문자가 있습니다. 파일을 확인해 주세요.');}
  if(c==='"'){if(value!=='')throw Error('셀 중간의 따옴표 형식이 올바르지 않습니다.');quoted=true;}else value+=c;
 }
 if(quoted)throw Error('따옴표가 닫히지 않은 셀이 있습니다. 파일을 확인해 주세요.');
 line();return rows;
}
export async function readImportFile(file:File):Promise<{headers:string[];rows:string[][];warnings:string[]}>{
 if(file.size>12*1024*1024)throw Error('파일은 12MB까지 읽을 수 있습니다. 기간을 나눠 주세요.');
 if(/\.xlsx$/i.test(file.name)){
  const x=await import('@/app/xlsx-template');const archive=await x.readXlsxArchive(await file.arrayBuffer());
  const inspection=x.inspectXlsxArchive(archive,{rowLimit:5001});const sheet=inspection.sheets[0];
  if(!sheet?.rows.length)throw Error('첫 번째 시트에 데이터가 없습니다.');
  const candidates=sheet.rows.slice(0,15);let index=0,score=-1;
  candidates.forEach((r,i)=>{const s=r.values.filter(v=>v.trim()).length;if(s>score){score=s;index=i;}});
  const data=sheet.rows.slice(index+1).map(r=>r.values);
  if(data.length>5000)throw Error('한 번에 5,000행까지 가져올 수 있습니다. 기간을 나눠 주세요.');
  return {headers:sheet.rows[index].values,rows:data,warnings:inspection.warnings};
 }
 if(/\.xls$/i.test(file.name))throw Error('이전 .xls 파일은 Excel에서 .xlsx 또는 CSV로 저장해 주세요.');
 const text=(await file.text()).replace(/^\uFEFF/,'');
 const table=parseDelimited(text);if(table.length<2)throw Error('머리글과 데이터가 포함된 표가 필요합니다.');
 if(table.length>5001)throw Error('한 번에 5,000행까지 가져올 수 있습니다. 기간을 나눠 주세요.');
 return {headers:table[0],rows:table.slice(1),warnings:[]};
}
const normalize=(v:string)=>v.toLowerCase().replace(/[\s_\-()·]/g,'');
const aliases:Record<string,string[]>={skuId:['SKUID','SKU번호','상품코드','바코드'],supplierSkuId:['SKUID','SKU번호'],optionId:['옵션ID','vendorItemId'],barcode:['SKU Barcode','바코드'],name:['상품명','SKU명','SKU 이름','거래처','캠페인명'],date:['일자','날짜','매출일','입고일','입고/반출시각','작성일'],qty:['수량','발주수량','입고수량','출고수량'],stock:['재고','재고수량'],price:['판매가','판매금액','합계'],supply:['공급가','공급가액'],vat:['세액','부가세'],total:['합계','총금액','결제금액'],vendor:['거래처','공급자','상호'],approvalNo:['승인번호'],rating:['별점','평점'],body:['리뷰','본문','내용'],cost:['광고비','집행 광고비'],clicks:['클릭수'],impressions:['노출수'],orders:['광고전환주문수','주문수'],units:['판매수량','광고판매수'],revenue:['광고전환매출','전환매출액'],keyword:['키워드','검색어'],sales28:['28일 판매량','최근28일판매수'],pv:['조회수'],productId:['상품ID','productId']};
export function guessMapping(headers:string[],fields:Field[]):Record<string,string>{
 const used=new Set<number>(),result:Record<string,string>={};
 for(const field of fields){const names=[field.key,field.label,...(aliases[field.key]??[])].map(normalize);const i=headers.findIndex((h,i)=>!used.has(i)&&names.includes(normalize(h)));result[field.key]=i<0?'':String(i);if(i>=0)used.add(i);}
 return result;
}
export function mapImportRows(headers:string[],rows:string[][],fields:Field[],mapping:Record<string,string>,defaults:Values):Values[]{
 for(const [key,index]of Object.entries(mapping))if(index!==''&&(!/^\d+$/.test(index)||Number(index)>=headers.length||!fields.some(f=>f.key===key)))throw Error('연결할 원본 열 번호를 확인해 주세요.');
 if(new Set(Object.values(mapping).filter(v=>v!=='')).size!==Object.values(mapping).filter(v=>v!=='').length)throw Error('같은 원본 열을 두 필드에 중복 연결할 수 없습니다.');
 return rows.filter(r=>r.some(x=>x.trim())).map((r,index)=>{
  const v:Values={...defaults};for(const f of fields){const m=mapping[f.key];if(m==null||m==='')continue;const raw=(r[Number(m)]??'').trim();
   if(f.type==='number'){if(!raw){v[f.key]=null;continue;}const n=Number(raw.replace(/[,₩￥¥%\s]/g,''));if(!Number.isFinite(n))throw Error(`${index+2}행 ${f.label}: 숫자를 확인해 주세요.`);v[f.key]=n;}
   else if(f.type==='checkbox')v[f.key]=['1','true','Y','y','예','O','완료'].includes(raw);
   else if(f.type==='date'&&raw){const m=/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/.exec(raw);v[f.key]=m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:raw;}
   else v[f.key]=raw;
  }
  for(const f of fields)if(f.required&&(v[f.key]==null||v[f.key]===''))throw Error(`${index+2}행 ${f.label}을 연결하거나 입력해 주세요.`);
  return v;
 });
}
export function downloadCsv(name:string,headers:string[],rows:unknown[][]){
 const cell=(v:unknown)=>{let s=v==null?'':String(v);if(typeof v==='string'&&/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 const text='\uFEFF'+[headers,...rows].map(r=>r.map(cell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download=name.endsWith('.csv')?name:name+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
