import {StudioSidebar,studioMenus} from '../../components/studio-navigation';

export const operationsMenus=studioMenus.filter(group=>group.id!=='rocket');
const locations=operationsMenus.flatMap(group=>group.items.map(([id,name])=>({id,name,group:group.group})));
export function operationsLocation(id:string|null){
 if(id==='settings')return {id:'settings',name:'공통 SKU·데이터 연결',group:'설정'};
 return locations.find(item=>item.id===id)??locations[0];
}

export function OperationsNavigation({view,open,expandedGroup,onToggleGroup,onNavigate,onClose}:{view:string;open:boolean;expandedGroup:string|null;onToggleGroup:(group:string)=>void;onNavigate:(id:string)=>void;onClose:()=>void}){
 return StudioSidebar({id:'operations-navigation',active:view,mobileOpen:open,expandedGroup,onToggleGroup,onOperationView:onNavigate,onClose});
}
