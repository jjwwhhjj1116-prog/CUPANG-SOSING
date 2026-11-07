'use client';
import {useRef} from 'react';
import {changeCoupangMargin,priceMinimumMarginEnabled,type PricePolicy} from '@/app/pricing';
import './couplus-form-stages.css';

export type StageTwoPricePolicyFieldsProps={
  policy:PricePolicy;onChange:(policy:PricePolicy,onlySellingMargin?:boolean)=>void;onRecalculate:()=>void;onSave:()=>void;
  dirty:boolean;sourceDirty?:boolean;busy:boolean;disabled?:boolean;error?:string;allowUnchangedSave?:boolean;referenceCny?:number;
};
const numeric=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:'';
/** Controlled policy inputs share the option grid's draft and explicit save.
 * Rendering this panel never changes a product or workspace defaults. */
export function StageTwoPricePolicyFields({policy,onChange,onRecalculate,onSave,dirty,sourceDirty=dirty,busy,disabled=false,error,allowUnchangedSave=false,referenceCny}:StageTwoPricePolicyFieldsProps){
  const minimum=priceMinimumMarginEnabled(policy),lastMinimum=useRef(minimum?policy.minimumMargin:3000);
  const blocked=disabled||busy;
  const change=(next:PricePolicy,onlySellingMargin?:boolean)=>{if(!blocked)onChange(next,onlySellingMargin);};
  const fixedNumber=(key:'salePrice'|'supplyPrice'|'purchaseCost'|'sourceUnitsPerPack',value:string)=>{
    if(!policy.fixedSourcing)return;
    const fixedSourcing={...policy.fixedSourcing};
    if(value===''&&key!=='salePrice')delete fixedSourcing[key];else fixedSourcing[key]=value===''?NaN:Number(value);
    if(key==='salePrice'&&fixedSourcing.salePrice!==policy.fixedSourcing.salePrice)delete fixedSourcing.supplyAnchorMargin;
    change({...policy,fixedSourcing});
  };
  const gate=policy.fixedSourcing?.marginGate;
  const number=(key:'exchangeRate'|'supplyMargin'|'minimumMargin'|'msrpMultiple'|'integratedRate',value:string)=>
    change({...policy,[key]:value===''?NaN:Number(value)});
  const bundle={bundleEnabled:policy.bundleEnabled??false,bundleCriterion:policy.bundleCriterion??'supplyMargin' as const,
    bundleMinimumSupplyMargin:policy.bundleMinimumSupplyMargin??3000,bundleMinimumCoupangMargin:policy.bundleMinimumCoupangMargin??3000};
  return <section className="pricing-policy-panel" aria-label="가격 정책 설정" data-quotation-source-step="가격" data-workspace-dirty={sourceDirty} data-workspace-saving={busy}>
    <h3>가격 정책 설정</h3>
    <fieldset disabled={blocked} className="panel-stack pricing-policy-body" style={{border:0,margin:0,minWidth:0}}>
      <label className="switch-row"><span>고정 소싱가격 사용</span><input aria-label="고정 소싱가격 사용" type="checkbox" checked={Boolean(policy.fixedSourcing)} onChange={event=>{
        if(event.target.checked)change({...policy,fixedSourcing:{version:1,referenceCny:referenceCny??NaN,salePrice:NaN,sourceUnitsPerPack:1}});
        else {const next={...policy};delete next.fixedSourcing;change(next);}
      }}/><i/></label>
      {policy.fixedSourcing&&<div className="panel-stack" role="group" aria-label="고정 소싱가격 기준">
        <label className="field"><span>소싱 기준 CNY</span><input aria-label="소싱 기준 CNY" type="number" readOnly value={numeric(policy.fixedSourcing.referenceCny)}/></label>
        {([['salePrice','소싱 판매가 (원)'],['supplyPrice','소싱 공급가 (원)'],['purchaseCost','선택 매입원가 (원)'],['sourceUnitsPerPack','소싱 구성 수량']] as const).map(([key,label])=><label key={key} className="field"><span>{label}</span><input aria-label={label} type="number" min="1" step="1" value={numeric(policy.fixedSourcing![key])} onChange={event=>fixedNumber(key,event.target.value)}/></label>)}
        <details><summary>고정 소싱가격 안내</summary>
          <p>기준 CNY는 활성화 당시 포함 옵션의 최저 원가입니다. 공급가와 매입원가를 비우면 각각 기준 판매가와 현재 원가로 계산합니다. 구성 수량의 기본값은 1개입니다.</p>
          <p>쿠팡 마진율을 바꾸면 공급가를 유지한 채 판매가를 다시 계산합니다.</p>
          <p aria-label="계정 로켓 소싱 마진 기준">계정 로켓 소싱 마진 기준 {gate ? gate.mode==='rate'?`판매가의 ${gate.minRate}% 이상`:gate.mode==='amount'?`${gate.minAmount}원 이상`:`판매가의 ${gate.minRate}% ${gate.mode==='both'?'및':'또는'} ${gate.minAmount}원 이상` : '판매가의 25% 이상 (기본)'}</p>
        </details>
      </div>}
      <label className="field"><span>적용 환율 (CNY → KRW)</span><input aria-label="적용 환율 (CNY → KRW)" type="number" min="150" max="400" step="any" value={numeric(policy.exchangeRate)} onChange={event=>number('exchangeRate',event.target.value)}/></label>
      <label className="field"><span>공급 마진율 (%)</span><input aria-label="공급 마진율 (%)" type="number" min="0" max="90" step="any" value={numeric(policy.supplyMargin)} onChange={event=>number('supplyMargin',event.target.value)}/></label>
      <label className="field"><span>쿠팡 마진율 (%)</span><input aria-label="쿠팡 마진율 (%)" type="number" min="0" max="90" step="any" value={numeric(policy.coupangMargin)} onChange={event=>change(changeCoupangMargin(policy,event.target.value===''?NaN:Number(event.target.value)),true)}/></label>
      <label className="field"><span>반올림 단위 (원)</span><select aria-label="반올림 단위 (원)" value={policy.roundingUnit} onChange={event=>change({...policy,roundingUnit:Number(event.target.value)})}>
        {[1,10,100,1000].map(unit=><option key={unit} value={unit}>{unit.toLocaleString('ko-KR')}원 단위</option>)}
      </select></label>
      <label className="switch-row"><span>최소 공급 마진 보장</span><input aria-label="최소 공급 마진 보장" type="checkbox" checked={minimum} onChange={event=>{
        if(blocked)return;if(!event.target.checked&&Number.isFinite(policy.minimumMargin)&&policy.minimumMargin>=0)lastMinimum.current=policy.minimumMargin;
        change({...policy,minimumMargin:event.target.checked?lastMinimum.current:0,recalculationMinimumEnabled:event.target.checked});
      }}/><i/></label>
      {minimum&&<label className="field"><span>최소 공급 마진액 (원)</span><input aria-label="최소 공급 마진액 (원)" type="number" min="0" step="100" value={numeric(policy.minimumMargin)} onChange={event=>{
        if(blocked)return;const value=event.target.value===''?NaN:Number(event.target.value);if(Number.isFinite(value)&&value>=0)lastMinimum.current=value;
        change({...policy,minimumMargin:value,recalculationMinimumEnabled:true});
      }}/></label>}
      <label className="switch-row"><span>번들링 활성화</span><input aria-label="번들링 활성화" type="checkbox" checked={bundle.bundleEnabled} onChange={event=>change({...policy,...bundle,bundleEnabled:event.target.checked})}/><i/></label>
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
      <details className="pricing-policy-save-guide"><summary>계산·저장 안내</summary><p>일반 가격은 최소 공급 마진을 사용하면 원가에 최소액을 더해 공급가를 정합니다. 판매가는 공급가 ÷ (1 − 쿠팡 마진율)입니다.</p><p>번들링은 지정한 마진 기준에 맞게 구성 수량을 조정합니다. 설정과 옵션 가격은 저장하기를 누를 때 함께 저장됩니다.</p></details>
      {error&&<p role="alert">{error}</p>}
    </fieldset>
    <div className="pricing-policy-actions">
      <button type="button" className="btn ghost" disabled={blocked} onClick={()=>{if(!blocked)onRecalculate();}}>일괄 재계산</button>
      <button type="button" className="btn primary" aria-label="가격 설정 저장하기" disabled={blocked||(!dirty&&!allowUnchangedSave)||Boolean(error)} onClick={()=>{if(!blocked&&(dirty||allowUnchangedSave)&&!error)onSave();}}>{busy?'저장 중…':'저장하기'}</button>
    </div>
  </section>;
}
