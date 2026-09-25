'use client';
import { useEffect, useState } from 'react';
import { readBatchTranslationTarget, type BatchTranslationTarget } from '@/app/batch-translation';
import { TranslationIntegratedPreview } from '@/app/components/translation-integrated-preview';

type Item = { id: string; title: string };
type Result = { id: string; target?: BatchTranslationTarget; error?: string };
export function BatchTranslationPanel({ products, onOpen }: { products: Item[]; onOpen: (id: string) => void }) {
  const [attempt,setAttempt] = useState(0);
  const [snapshot,setSnapshot] = useState<{ key: string; results: Result[]; done: boolean }>({key:'',results:[],done:false});
  const ids = JSON.stringify(products.map(product=>product.id));
  const key = JSON.stringify([ids,attempt]);
  const results = snapshot.key === key ? snapshot.results : [];
  const busy = snapshot.key !== key || !snapshot.done;
  useEffect(()=>{
    const controller = new AbortController();
    void (async()=>{
      for (const id of JSON.parse(ids) as string[]) {
        if (controller.signal.aborted) return;
        let result: Result;
        try {
          const target = await readBatchTranslationTarget(id,fetch,controller.signal);
          if (!target) return;
          result = {id,target};
        } catch(error) { result = {id,error:error instanceof Error?error.message:'번역 조회 실패'}; }
        if (controller.signal.aborted) return;
        setSnapshot(previous=>({key,results:[...(previous.key===key?previous.results:[]),result],done:false}));
      }
      if (!controller.signal.aborted) setSnapshot(previous=>({key,results:previous.key===key?previous.results:[],done:true}));
    })();
    return ()=>controller.abort();
  },[ids,key]);
  return <section className="panel-stack" aria-label="선택 상품 번역 통합 검토" aria-busy={busy}>
    <p>선택 상품의 현재 버전과 일치하는 최신 완료 번역을 모았습니다. 각 상품의 변경 전후를 확인하고 SEO·표시사항·옵션을 함께 저장할 수 있습니다. 새 유료 번역과 이미지 처리, 등록 전송은 실행하지 않습니다.</p>
    <p role="status">확인 {results.length} / {products.length}개</p>
    <button type="button" className="btn ghost" disabled={busy} onClick={()=>setAttempt(value=>value+1)}>완료 번역 다시 조회</button>
    {products.map(product=>{
      const result=results.find(item=>item.id===product.id),target=result?.target;
      return <section key={product.id} className="translation-review"><h4>{product.title}</h4>
        {!result&&<p role="status">저장된 번역 확인 중…</p>}
        {result?.error&&<p role="alert">{result.error}</p>}
        {target&&!target.jobId&&<p>현재 상품 버전과 일치하는 완료 번역이 없습니다. 상품별 작업에서 원문과 번역 이력을 확인해주세요.</p>}
        {target?.jobId&&<TranslationIntegratedPreview key={`${key}:${target.jobId}`} productId={target.productId} version={target.version} jobId={target.jobId} disabled={busy}/>}
        <button type="button" className="btn ghost" disabled={busy} onClick={()=>onOpen(product.id)}>상품별 작업 열기</button>
      </section>;
    })}
  </section>;
}
