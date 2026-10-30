'use client';
import {useRef} from 'react';
import {priceMinimumMarginEnabled,type PricePolicy} from '@/app/pricing';
import './couplus-form-stages.css';

export type StageTwoPricePolicyFieldsProps={
  policy:PricePolicy;onChange:(policy:PricePolicy)=>void;onRecalculate:()=>void;onSave:()=>void;
  dirty:boolean;sourceDirty?:boolean;busy:boolean;disabled?:boolean;error?:string;
};
const numeric=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:'';
/** Controlled policy inputs share the option grid's draft and explicit save.
 * Rendering this panel never changes a product or workspace defaults. */
export function StageTwoPricePolicyFields({policy,onChange,onRecalculate,onSave,dirty,sourceDirty=dirty,busy,disabled=false,error}:StageTwoPricePolicyFieldsProps){
  const minimum=priceMinimumMarginEnabled(policy),lastMinimum=useRef(minimum?policy.minimumMargin:3000);
  const blocked=disabled||busy;
  const change=(next:PricePolicy)=>{if(!blocked)onChange(next);};
  const number=(key:'exchangeRate'|'supplyMargin'|'coupangMargin'|'minimumMargin'|'msrpMultiple'|'integratedRate',value:string)=>
    change({...policy,[key]:value===''?NaN:Number(value)});
  const bundle={bundleEnabled:policy.bundleEnabled??false,bundleCriterion:policy.bundleCriterion??'supplyMargin' as const,
    bundleMinimumSupplyMargin:policy.bundleMinimumSupplyMargin??3000,bundleMinimumCoupangMargin:policy.bundleMinimumCoupangMargin??3000};
  return <section className="pricing-policy-panel" aria-label="가격 정책 설정" data-quotation-source-step="가격" data-workspace-dirty={sourceDirty} data-workspace-saving={busy}>
    <h3>가격 정책 설정</h3>
    <fieldset disabled={blocked} className="panel-stack" style={{border:0,padding:0,margin:0,minWidth:0}}>
      <label className="field"><span>적용 환율 (CNY → KRW)</span><input aria-label="적용 환율 (CNY → KRW)" type="number" min="150" max="400" step="any" value={numeric(policy.exchangeRate)} onChange={event=>number('exchangeRate',event.target.value)}/></label>
      <label className="field"><span>공급 마진율 (%)</span><input aria-label="공급 마진율 (%)" type="number" min="0" max="90" step="any" value={numeric(policy.supplyMargin)} onChange={event=>number('supplyMargin',event.target.value)}/></label>
      <label className="field"><span>쿠팡 마진율 (%)</span><input aria-label="쿠팡 마진율 (%)" type="number" min="0" max="90" step="any" value={numeric(policy.coupangMargin)} onChange={event=>number('coupangMargin',event.target.value)}/></label>
      <label className="field"><span>반올림 단위 (원)</span><select aria-label="반올림 단위 (원)" value={policy.roundingUnit} onChange={event=>change({...policy,roundingUnit:Number(event.target.value)})}>
        {[1,10,100,1000].map(unit=><option key={unit} value={unit}>{unit.toLocaleString('ko-KR')}원 단위</option>)}
      </select></label>
      <label className="switch-row"><span>최소 공급 마진 보장</span><input aria-label="최소 공급 마진 보장" type="checkbox" checked={minimum} onChange={event=>{
        if(blocked)return;if(!event.target.checked&&Number.isFinite(policy.minimumMargin)&&policy.minimumMargin>=0)lastMinimum.current=policy.minimumMargin;
        change({...policy,minimumMargin:event.target.checked?lastMinimum.current:0,recalculationMinimumEnabled:event.target.checked});
      }}/><i/></label>
      <small>쿠팡 마진율은 고정하고 원가율을 조정하여 최소 공급 마진액을 보장합니다.</small>
      {minimum&&<label className="field"><span>최소 공급 마진액 (원)</span><input aria-label="최소 공급 마진액 (원)" type="number" min="0" step="100" value={numeric(policy.minimumMargin)} onChange={event=>{
        if(blocked)return;const value=event.target.value===''?NaN:Number(event.target.value);if(Number.isFinite(value)&&value>=0)lastMinimum.current=value;
        change({...policy,minimumMargin:value,recalculationMinimumEnabled:true});
      }}/></label>}
      <label className="switch-row"><span>번들링 활성화</span><input aria-label="번들링 활성화" type="checkbox" checked={bundle.bundleEnabled} onChange={event=>change({...policy,...bundle,bundleEnabled:event.target.checked})}/><i/></label>
      <small>낮은 마진 상품을 자동으로 묶어서 판매합니다.</small>
      {bundle.bundleEnabled&&<div className="panel-stack" role="group" aria-label="번들링 기준">
        <label><input type="radio" name="stage-two-bundle-criterion" checked={bundle.bundleCriterion==='supplyMargin'} onChange={()=>change({...policy,...bundle,bundleCriterion:'supplyMargin'})}/> 최소 공급 마진액 기준</label>
        <label><input type="radio" name="stage-two-bundle-criterion" checked={bundle.bundleCriterion==='coupangMargin'} onChange={()=>change({...policy,...bundle,bundleCriterion:'coupangMargin'})}/> 최소 쿠팡 마진액 기준</label>
        {bundle.bundleCriterion==='supplyMargin'
          ?<label className="field"><span>최소 공급 마진액 (원)</span><input aria-label="번들 최소 공급 마진액 (원)" type="number" min="1000" step="1000" value={numeric(bundle.bundleMinimumSupplyMargin)} onChange={event=>change({...policy,...bundle,bundleMinimumSupplyMargin:event.target.value===''?NaN:Number(event.target.value)})}/></label>
          :<label className="field"><span>최소 쿠팡 마진액 (원)</span><input aria-label="번들 최소 쿠팡 마진액 (원)" type="number" min="1000" step="1000" value={numeric(bundle.bundleMinimumCoupangMargin)} onChange={event=>change({...policy,...bundle,bundleMinimumCoupangMargin:event.target.value===''?NaN:Number(event.target.value)})}/></label>}
      </div>}
      <details className="pricing-policy-extra"><summary>추가 가격 설정</summary><div className="panel-stack">
        <label className="field"><span>시장가격 배수</span><input aria-label="시장가격 배수" type="number" min="1" step="any" value={numeric(policy.msrpMultiple)} onChange={event=>number('msrpMultiple',event.target.value)}/></label>
        <label className="field"><span>가격 처리 방식</span><select aria-label="가격 처리 방식" value={policy.roundingMode??'up'} onChange={event=>change({...policy,roundingMode:event.target.value as 'up'|'nearest'})}><option value="nearest">반올림</option><option value="up">올림</option></select></label>
        <label className="switch-row"><span>통합통관 환율 사용</span><input aria-label="통합통관 환율 사용" type="checkbox" checked={policy.useIntegratedRate===true} onChange={event=>change({...policy,useIntegratedRate:event.target.checked})}/><i/></label>
        {policy.useIntegratedRate&&<label className="field"><span>통합통관 적용환율 (CNY → KRW)</span><input aria-label="통합통관 적용환율 (CNY → KRW)" type="number" min="0" step="any" value={numeric(policy.integratedRate)} onChange={event=>number('integratedRate',event.target.value)}/></label>}
      </div></details>
      <details className="pricing-policy-save-guide"><summary>계산·저장 안내</summary><p>공급가 = 원가 + 최소 공급 마진액, 판매가 = 공급가 ÷ (1 - 쿠팡마진율)로 계산됩니다.</p><p>입력한 설정과 옵션 가격은 아래 저장하기를 누를 때 함께 저장됩니다.</p></details>
      {error&&<p role="alert">{error}</p>}
      <button type="button" className="btn ghost" disabled={blocked} onClick={()=>{if(!blocked)onRecalculate();}}>일괄 재계산</button>
      <button type="button" className="btn primary" aria-label="가격 설정 저장하기" disabled={blocked||!dirty||Boolean(error)} onClick={()=>{if(!blocked&&dirty&&!error)onSave();}}>{busy?'저장 중…':'저장하기'}</button>
    </fieldset>
  </section>;
}
