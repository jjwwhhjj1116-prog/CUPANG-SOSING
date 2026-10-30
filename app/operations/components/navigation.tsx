import Link from 'next/link';

export const operationsMenus=[
 {group:'상품소싱',icon:'◈',items:[['discovery','신규상품 발굴'],['related','연관키워드 수집'],['keyword','키워드 조회'],['reviews','리뷰 분석'],['compare','1688·쿠팡 비교']]},
 {group:'판매관리',icon:'▥',items:[['inventory','쿠팡 재고 현황'],['sales-report','판매 현황 보고서'],['revenue','매출 관리'],['inbound','입고 상세내역'],['ad-reports','광고보고서 분석'],['campaigns','광고캠페인']]},
 {group:'손익계산',icon:'◉',items:[['pnl','손익계산서'],['cost-details','비용 내역'],['expense-categories','경비항목 설정'],['expenses','경비 입력']]},
 {group:'물류',icon:'▣',items:[['purchasing','제품 구매관리'],['import-cost','매입·수입원가'],['ledger','재고수불부'],['statements','거래명세서 확인']]}
] as const;
const locations=operationsMenus.flatMap(group=>group.items.map(([id,name])=>({id,name,group:group.group})));
export function operationsLocation(id:string|null){
 if(id==='settings')return {id:'settings',name:'공통 SKU·데이터 연결',group:'설정'};
 return locations.find(item=>item.id===id)??locations[0];
}

export function OperationsNavigation({view,open,onNavigate,onClose}:{view:string;open:boolean;onNavigate:(id:string)=>void;onClose:()=>void}){
 return <aside id="operations-navigation" className={'ops-sidebar '+(open?'open':'')}>
  <Link className="ops-brand" href="/"><span className="ops-brand-icon">Y</span><span>YOOFAM 스튜디오</span></Link>
  <nav className="ops-workspace-nav" aria-label="작업 공간 이동"><Link href="/" className="ops-workspace-return"><span aria-hidden="true">←</span> AI 상품등록</Link><span className="ops-workspace-current"><span aria-hidden="true">▥</span> 운영관리</span></nav>
  <button type="button" className="ops-mobile-close" onClick={onClose} aria-label="운영 메뉴 닫기">×</button>
  <nav aria-label="운영관리 메뉴">{operationsMenus.map(group=><section className="ops-menu-group" key={group.group} aria-label={group.group}>
   <h2><span aria-hidden="true">{group.icon}</span>{group.group}</h2>
   {group.items.map(([id,name])=><button type="button" key={id} aria-current={view===id?'page':undefined} className={view===id?'active':''} onClick={()=>onNavigate(id)}>{name}</button>)}
  </section>)}</nav>
  <nav className="ops-sidebar-tools" aria-label="운영관리 설정"><button type="button" className={'ops-return '+(view==='settings'?'active':'')} aria-current={view==='settings'?'page':undefined} onClick={()=>onNavigate('settings')}><span aria-hidden="true">⚙</span> 공통 SKU·데이터 연결</button></nav>
 </aside>;
}
