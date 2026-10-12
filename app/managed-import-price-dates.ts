import {xlsxDateCells} from '@/app/xlsx-template';
export function validManagedImportDate(value:string){try{return /^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}catch{return false;}}
function dateFormat(id:number|null,code:string|null){if(code!==null){const value=code.split(';')[0].replace(/"[^"]*"|\\.|\[[^\]]*\]|_.|\*./g,'').toLowerCase();return /y/.test(value)&&/m/.test(value)&&/d/.test(value);}return id!==null&&[14,15,16,17,22].includes(id);}
/** Only proven B-column date cells are normalized; bare numeric dates remain invalid. */
export function normalizedManagedImportDates(files:Map<string,Uint8Array>):Map<number,string>{
 const proof=xlsxDateCells(files,'매입가업로드양식','B'),result=new Map<number,string>();
 for(const cell of proof.cells){let date:string|undefined;
  if(cell.type==='d'){const match=/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(cell.raw);if(!match||!validManagedImportDate(match[1])||match[2]!==undefined&&(Number(match[2])>23||Number(match[3])>59||Number(match[4])>59||!Number.isFinite(Date.parse(cell.raw))))throw Error(`${cell.rowNumber}행의 ISO 날짜 셀을 확인해주세요.`);date=match[1];}
  else if(cell.type==='n'&&dateFormat(cell.formatId,cell.formatCode)){if(!/^\d+(?:\.\d+)?$/.test(cell.raw)||!Number.isFinite(Number(cell.raw)))throw Error(`${cell.rowNumber}행의 Excel 날짜 셀을 확인해주세요.`);const day=Math.floor(Number(cell.raw));if(!proof.date1904&&(day<1||day===60))throw Error(`${cell.rowNumber}행의 날짜는 실제 달력에 존재하지 않습니다.`);try{date=new Date((proof.date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,31))+(proof.date1904?day:day-(day>60?1:0))*86400000).toISOString().slice(0,10);}catch{throw Error(`${cell.rowNumber}행의 Excel 날짜 범위를 확인해주세요.`);}}
  if(date!==undefined){if(!validManagedImportDate(date))throw Error(`${cell.rowNumber}행의 실제 날짜를 확인해주세요.`);result.set(cell.rowNumber,date);}
 }
 return result;
}
