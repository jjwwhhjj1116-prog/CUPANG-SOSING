import type { MouseEvent } from 'react';
import './studio-navigation.css';

export const studioMenus = [
  {id:'rocket',group:'로켓배송',color:'#259af5',items:[['work','AI상품등록'],['archive','상품관리']]},
  {id:'sourcing',group:'상품소싱/분석',color:'#8863d8',items:[['discovery','신규상품 발굴'],['related','연관키워드 수집'],['keyword','키워드 조회'],['reviews','리뷰 분석'],['compare','1688 쿠팡비교']]},
  {id:'sales',group:'판매/분석',color:'#27b95e',items:[['inventory','쿠팡 재고 현황'],['sales-report','판매 현황 보고서'],['revenue','매출 관리'],['inbound','입고 상세내역'],['ad-reports','광고 보고서 분석'],['campaigns','광고캠페인']]},
  {id:'finance',group:'손익계산',color:'#e7a129',items:[['pnl','손익계산서'],['cost-details','비용 내역'],['expense-categories','경비항목 설정'],['expenses','경비입력']]},
  {id:'logistics',group:'물류',color:'#22b7a7',items:[['purchasing','제품 구매관리'],['import-cost','매입·수입원가'],['ledger','재고수불부'],['statements','거래명세서 확인']]},
] as const;

export function studioHref(id:string) {
  return id==='work'?'/':id==='archive'?'/?view=archive':'/operations?view='+encodeURIComponent(id);
}

function GroupIcon({id,color}:{id:string;color:string}) {
  const paths:Record<string,string>={
    rocket:'M12 3c-3 2-4 5-4 9l4 2 4-2c0-4-1-7-4-9ZM8 10 5 13v4l3-2m8-5 3 3v4l-3-2m-6 2v3m4-3v3M11 8h2',
    sourcing:'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15ZM16 16l5 5M7 12V9m4 3V6m4 6V8',
    sales:'M4 20V11h4v9m2 0V7h4v13m2 0V3h4v17M2 20h20',
    finance:'M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM8 6h8v4H8Zm0 8h1m3 0h1m3 0h1m-9 4h1m3 0h1m3 0h1',
    logistics:'M3 6h11v11H3Zm11 4h4l3 4v3h-7M6 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm12 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  };
  return <svg className="studio-group-icon" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[id]}/></svg>;
}

type NavigationProps={id?:string;active:string;expandedGroup:string|null;mobileOpen?:boolean;onToggleGroup:(group:string)=>void;onClose?:()=>void;onRocketView?:(view:'work'|'archive')=>void;onOperationView?:(view:string)=>void;onBeforeNavigate?:(event:Pick<MouseEvent<HTMLAnchorElement>,'preventDefault'>)=>void};

export function StudioSidebar({id='studio-navigation',active,expandedGroup,mobileOpen=false,onToggleGroup,onClose,onRocketView,onOperationView,onBeforeNavigate}:NavigationProps) {
  return <aside id={id} className={'studio-sidebar '+(mobileOpen?'open':'')}>
    <a className="studio-brand" href={studioHref('work')} onClick={onBeforeNavigate}><span className="studio-brand-icon">Y</span><span>YOOFAM 스튜디오</span></a>
    <button type="button" className="studio-mobile-close" aria-label="메뉴 닫기" onClick={onClose}><svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button>
    <nav aria-label="주 메뉴">{studioMenus.map(group=><section className="studio-menu-group" key={group.id} aria-label={group.group}>
      <h2><button type="button" className={'studio-menu-toggle '+(group.items.some(([item])=>item===active)?'current':'')} aria-label={group.group} aria-expanded={expandedGroup===group.group} aria-controls={'studio-menu-'+group.id} onClick={()=>onToggleGroup(group.group)}><GroupIcon id={group.id} color={group.color}/><span>{group.group}</span><svg className="studio-menu-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg></button></h2>
      <div className="studio-menu-items" id={'studio-menu-'+group.id} hidden={expandedGroup!==group.group}>{group.items.map(([item,label])=>{
        const className='studio-menu-item '+(active===item?'active':'');
        const current=active===item?'page' as const:undefined;
        if(group.id==='rocket'&&onRocketView)return <button type="button" key={item} className={className} aria-current={current} onClick={()=>onRocketView(item as 'work'|'archive')}>{label}</button>;
        if(group.id!=='rocket'&&onOperationView)return <button type="button" key={item} className={className} aria-current={current} onClick={()=>onOperationView(item)}>{label}</button>;
        return <a key={item} href={studioHref(item)} className={className} aria-current={current} onClick={onBeforeNavigate}>{label}</a>;
      })}</div>
    </section>)}</nav>
    <nav className="studio-sidebar-tools" aria-label="설정">{onOperationView?<button type="button" className={'studio-menu-item '+(active==='settings'?'active':'')} aria-current={active==='settings'?'page':undefined} onClick={()=>onOperationView('settings')}>공통 SKU·데이터 연결</button>:<a className="studio-menu-item" href={studioHref('settings')} onClick={onBeforeNavigate}>공통 SKU·데이터 연결</a>}</nav>
  </aside>;
}
