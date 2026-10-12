'use client';
import {useState} from 'react';
import {ManagedProductsPanel} from '@/app/components/managed-products-panel';
import {CompanyRegistrationStatusPanel} from '@/app/components/company-registration-status-panel';
import './product-management-workspace.css';
export function ProductManagementWorkspace(){
 const [tab,setTab]=useState<'products'|'status'>('products');
 return <section className="product-management-workspace" aria-label="상품관리 작업 공간"><div className="product-management-tabs" role="tablist" aria-label="상품관리 메뉴" onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?'products':event.key==='End'?'status':tab==='products'?'status':'products';setTab(next);document.getElementById(next==='products'?'managed-products-tab':'registration-status-tab')?.focus();}}><button id="managed-products-tab" role="tab" tabIndex={tab==='products'?0:-1} aria-selected={tab==='products'} aria-controls="managed-products-panel" onClick={()=>setTab('products')}>등록 상품</button><button id="registration-status-tab" role="tab" tabIndex={tab==='status'?0:-1} aria-selected={tab==='status'} aria-controls="registration-status-panel" onClick={()=>setTab('status')}>상품 등록 상태</button></div><div id="managed-products-panel" role="tabpanel" aria-labelledby="managed-products-tab" hidden={tab!=='products'}><ManagedProductsPanel/></div><div id="registration-status-panel" role="tabpanel" aria-labelledby="registration-status-tab" hidden={tab!=='status'}><CompanyRegistrationStatusPanel/></div></section>;
}
