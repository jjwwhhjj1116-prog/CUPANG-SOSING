/** Keep option-price diagnostics visible instead of discarding them at the API boundary. */
export function requestErrorMessage(value: unknown): string {
 if(!value||typeof value!=='object'||Array.isArray(value))return '요청에 실패했습니다.';
 const body=value as {error?:unknown;code?:unknown;options?:unknown};
 const message=typeof body.error==='string'&&body.error?body.error:'요청에 실패했습니다.';
 if(body.code!=='INVALID_OPTION_PRICE'||!Array.isArray(body.options))return message;
 const failures=body.options.filter((row):row is {optionId:string;error:string}=>Boolean(row)&&typeof row==='object'&&typeof row.optionId==='string'&&typeof row.error==='string');
 if(!failures.length)return message;
 const shown=failures.slice(0,10).map(row=>`${row.optionId}: ${row.error}`).join(' / ');
 return `${message} ${shown}${failures.length>10?` / 외 ${failures.length-10}개 옵션`:''}`;
}
