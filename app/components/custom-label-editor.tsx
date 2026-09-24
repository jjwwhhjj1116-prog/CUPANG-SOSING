'use client';

import { CUSTOM_LABEL_LIMIT, type CustomLabel } from '@/app/product-content';

export function CustomLabelEditor({rows,onChange}:{rows:CustomLabel[];onChange:(rows:CustomLabel[])=>void}) {
  const edit=(id:string,patch:Partial<CustomLabel>)=>onChange(rows.map(row=>row.id===id?{...row,...patch}:row));
  const move=(index:number,offset:number)=>{
    const target=index+offset;if(target<0||target>=rows.length)return;
    const next=[...rows];[next[index],next[target]]=[next[target],next[index]];onChange(next);
  };
  return <section className="panel-stack" aria-label="추가 표시사항">
    <h3>직접 추가한 항목 · {rows.length}/{CUSTOM_LABEL_LIMIT}</h3>
    <p>기본 항목 아래에 순서대로 표시합니다. 추가 항목은 라벨용이며 견적서의 공식 필드에 자동 연결되지 않습니다.</p>
    {rows.map((row,index)=><div className="panel-stack" key={row.id}>
      <div className="quote-actions">
        <label><input type="checkbox" checked={row.visible} onChange={event=>edit(row.id,{visible:event.target.checked})}/>라벨에 표시</label>
        <button type="button" className="btn ghost" aria-label={`추가 항목 ${index+1} 위로`} disabled={index===0} onClick={()=>move(index,-1)}>↑</button>
        <button type="button" className="btn ghost" aria-label={`추가 항목 ${index+1} 아래로`} disabled={index===rows.length-1} onClick={()=>move(index,1)}>↓</button>
        <button type="button" className="btn ghost" aria-label={`추가 항목 ${index+1} 삭제`} onClick={()=>onChange(rows.filter(item=>item.id!==row.id))}>삭제</button>
      </div>
      <label className="field"><span>항목명</span><input maxLength={80} value={row.name} onChange={event=>edit(row.id,{name:event.target.value})}/></label>
      <label className="field"><span>내용</span><textarea rows={2} maxLength={2000} value={row.value} onChange={event=>edit(row.id,{value:event.target.value})}/></label>
    </div>)}
    <button type="button" className="btn primary" disabled={rows.length>=CUSTOM_LABEL_LIMIT} onClick={()=>{if(rows.length<CUSTOM_LABEL_LIMIT)onChange([...rows,{id:`custom-${crypto.randomUUID()}`,name:'',value:'',visible:true}]);}}>＋ 새 항목 추가</button>
    <small>삭제·순서 변경은 표시사항 저장 후 적용됩니다.</small>
  </section>;
}
