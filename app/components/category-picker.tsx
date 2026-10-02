'use client';
import { loadCategoryProfiles } from '@/app/load-category-profiles';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usableCategoryCode, type CategoryProfile } from '@/app/category-profiles';
import { canConfirmCategory, categoryAdvancedSeed, categoryChoices, categoryChoicesAtPath, categoryLevel, categoryObservationScope, categoryProfileForChoice, categoryProfilesForChoice, searchCategoryChoices, type CategoryAdvancedSeed, type CategoryChoice } from '@/app/category-catalog';
import { getQuotationSchema } from '@/app/quotation-schema';
import { CategoryQuotationPreview } from '@/app/components/category-quotation-preview';
import './category-picker.css';
import { IntakeQuotationPreview } from '@/app/components/intake-quotation-preview';
import { SupplierHubCategoryBrowser } from '@/app/components/supplier-hub-category-browser';
import { loadLiveHubCategorySchema } from '@/app/supplier-hub-catalog';

function codeEvidenceLabel(choice: CategoryChoice) {
  if (choice.codeEvidence === 'supplier-hub') return 'Supplier Hub 코드 확인 · 전체 경로 일치';
  if (choice.codeEvidence === 'couplus') return '쿠플러스 코드 관찰 · Supplier Hub 대조 미확인';
  if (choice.codeEvidence === 'saved') return '사용자가 저장한 코드 · Supplier Hub 경로·코드 미확인';
  return '분류 코드 미확인';
}

export function CategoryPicker({ profiles: suppliedProfiles, selectedId, onSelected, onAdvanced }: { profiles: CategoryProfile[]; selectedId: string; onSelected: (profile: CategoryProfile) => void; onAdvanced: (seed?: CategoryAdvancedSeed) => void }) {
  const [refreshedProfiles, setRefreshedProfiles] = useState<CategoryProfile[] | null>(null);
  const [liveChoice,setLiveChoice]=useState<CategoryChoice|null>(null);
  const [catalogMode,setCatalogMode]=useState<'live'|'saved'>('live');
  const profiles = refreshedProfiles ?? suppliedProfiles;
  const choices = useMemo(() => categoryChoices(profiles), [profiles]);
  const [path, setPath] = useState<string[]>(profiles.find(profile => profile.id === selectedId)?.categoryPath ?? []);
  const [selectedKey, setSelectedKey] = useState(selectedId);
  const [query, setQuery] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const activeRequest = useRef<AbortController | null>(null);
  const completed = useRef(false);
  const createRequest = useRef<{ body: string; id: string } | null>(null);
  useEffect(() => () => { activeRequest.current?.abort(); }, []);
  const selected = liveChoice?.key===selectedKey?liveChoice:choices.find(choice => choice.key === selectedKey);
  const selectedProfile = profiles.find(profile => profile.id === selected?.profileId);
  const schema = selected?.categoryId ? getQuotationSchema(selected.categoryId, selected.path) : null;
  const visible = searchCategoryChoices(choices, query);
  const connections = categoryChoicesAtPath(choices, path).filter(choice => choice.isLeaf);
  const hasChildren = categoryLevel(choices, path, path.length).length > 0;
  const depths = Math.max(1, path.length + (hasChildren ? 1 : 0));
  const unresolvedBranch = catalogMode==='saved'&&path.length > 0 && !hasChildren && connections.length === 0;
  function choose(choice: CategoryChoice) { if (activeRequest.current) return; completed.current = false;setLiveChoice(null);setCatalogMode('saved');setPath(choice.path); setSelectedKey(choice.key); setError(''); }
  function navigate(next: string[]) {
    if (activeRequest.current) return;
    completed.current = false;
    setPath(next); const leaves = categoryChoicesAtPath(choices, next).filter(choice => choice.isLeaf);
    setSelectedKey(leaves.length === 1 ? leaves[0].key : leaves.some(choice => choice.key === selectedKey) ? selectedKey : ''); setError('');
  }
  async function confirm(target = selected) {
    if (!target || !canConfirmCategory(target) || busy || activeRequest.current || completed.current) return;
    const controller = new AbortController(); activeRequest.current = controller;
    setBusy(true); setError('');
    try {
      const hubSchema=target.supplierHub?await loadLiveHubCategorySchema(target,controller.signal):undefined;
      if(controller.signal.aborted)return;
      async function withSchema(profile:CategoryProfile){
        if(!hubSchema||profile.hubSchema?.schemaString===hubSchema.schemaString&&JSON.stringify(profile.hubSchema.metadata)===JSON.stringify(hubSchema.metadata)&&profile.hubSchema.company.code===hubSchema.company.code&&profile.hubSchema.company.name===hubSchema.company.name)return profile;
        const response=await fetch('/api/category-profiles',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({id:profile.id,expectedRevision:profile.revision,profile:{...profile,hubSchema}}),signal:controller.signal});
        const result=await response.json() as {profile?:CategoryProfile;error?:string};
        if(!response.ok)throw Error(result.error??'상세 견적 양식을 저장하지 못했습니다.');
        const saved=result.profile;
        if(!saved||saved.id!==profile.id||saved.revision!==profile.revision+1||saved.categoryId!==target!.categoryId||JSON.stringify(saved.categoryPath)!==JSON.stringify(target!.path)||saved.hubSchema?.schemaString!==hubSchema.schemaString||JSON.stringify(saved.hubSchema.metadata)!==JSON.stringify(hubSchema.metadata)||saved.hubSchema.company.code!==hubSchema.company.code||saved.hubSchema.company.name!==hubSchema.company.name||JSON.stringify(saved.template)!==JSON.stringify(profile.template)||JSON.stringify(saved.mappings)!==JSON.stringify(profile.mappings))throw Error('저장된 상세 양식과 기존 견적서 연결을 확인하지 못했습니다.');
        return saved;
      }
      const existing = profiles.find(profile => profile.id === target.profileId);
      if (existing) {
        const result = { profiles: await loadCategoryProfiles(controller.signal) };
        if (controller.signal.aborted) return;
        const latest = result.profiles.find(profile => profile.id === existing.id);
        if (latest && (!Number.isSafeInteger(latest.revision) || latest.revision < 1 || !Array.isArray(latest.categoryPath))) throw new Error('카테고리 설정 응답이 올바르지 않습니다. 다시 시도해주세요.');
        setRefreshedProfiles(result.profiles);
        if (!latest) {
          setSelectedKey('');
          throw new Error('선택한 카테고리 설정이 삭제되었습니다. 갱신된 목록에서 사용할 분류를 선택해주세요.');
        }
        if (latest.categoryId !== existing.categoryId || JSON.stringify(latest.categoryPath) !== JSON.stringify(existing.categoryPath)) {
          setPath(latest.categoryPath);
          throw new Error('다른 화면에서 이 설정의 카테고리가 변경되었습니다. 갱신된 분류와 견적 항목을 확인한 뒤 선택 완료를 눌러주세요.');
        }
        if (latest.revision !== existing.revision) {
          throw new Error('선택한 카테고리의 견적 설정이 변경되었습니다. 아래 갱신된 양식과 열 연결을 확인한 뒤 선택 완료를 눌러주세요.');
        }
        const saved=hubSchema?await withSchema(latest):latest;if(controller.signal.aborted)return;completed.current = true; onSelected(saved); return;
      }
      // The picker may have been opened before this category's template was saved.
      // Read every current page before creating another empty configuration.
      const latestProfiles = await loadCategoryProfiles(controller.signal);
      if (controller.signal.aborted) return;
      setRefreshedProfiles(latestProfiles);
      const matching = categoryProfilesForChoice(latestProfiles, target);
      if (matching.length > 1) {
        setSelectedKey('');
        throw new Error('같은 카테고리의 견적서 설정이 여러 개입니다. 갱신된 목록에서 사용할 설정을 선택해주세요.');
      }
      if (matching.length === 1) {
        const latest = matching[0];
        if (!Number.isSafeInteger(latest.revision) || latest.revision < 1) throw new Error('카테고리 설정 응답이 올바르지 않습니다. 다시 시도해주세요.');
        const saved=hubSchema?await withSchema(latest):latest;if(controller.signal.aborted)return;completed.current = true; onSelected(saved); return;
      }
      const body = JSON.stringify({...categoryProfileForChoice(target),...(hubSchema?{hubSchema}:{})});
      if (createRequest.current?.body !== body) createRequest.current = { body, id: crypto.randomUUID() };
      const response = await fetch('/api/category-profiles', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': createRequest.current.id }, body, signal: controller.signal });
      const result = await response.json() as { profile: CategoryProfile; error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(result.error ?? '카테고리를 저장하지 못했습니다.');
      const saved = result.profile;
      if (!saved || typeof saved.id !== 'string' || !saved.id.trim()
        || !Number.isSafeInteger(saved.revision) || saved.revision < 1
        || saved.categoryId !== target.categoryId
        || !Array.isArray(saved.categoryPath) || JSON.stringify(saved.categoryPath) !== JSON.stringify(target.path)
        || hubSchema&&(saved.hubSchema?.schemaString!==hubSchema.schemaString||JSON.stringify(saved.hubSchema.metadata)!==JSON.stringify(hubSchema.metadata)||saved.hubSchema.company.code!==hubSchema.company.code||saved.hubSchema.company.name!==hubSchema.company.name)) {
        throw new Error('저장된 카테고리 코드·경로·버전이 선택한 분류와 일치하지 않습니다. URL 입력을 중단했습니다. 카테고리 설정을 다시 확인해주세요.');
      }
      completed.current = true; onSelected(result.profile);
    } catch (cause) { completed.current = false; if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '카테고리 선택 실패'); }
    finally { if (activeRequest.current === controller) activeRequest.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  return <div className="category-picker" aria-busy={busy}>
    <p className="category-instructions">등록할 상품의 카테고리를 선택해주세요. 단계별로 선택하면 하위 카테고리가 표시됩니다.</p>
    <div className="workspace-actions" role="group" aria-label="카테고리 목록 선택"><button type="button" className={`btn ${catalogMode==='live'?'primary':'ghost'}`} disabled={busy} onClick={()=>setCatalogMode('live')}>Supplier Hub 카테고리</button><button type="button" className={`btn ${catalogMode==='saved'?'primary':'ghost'}`} disabled={busy} onClick={()=>setCatalogMode('saved')}>저장된 목록</button></div>
    {catalogMode==='live'&&<SupplierHubCategoryBrowser disabled={busy} onNavigating={()=>{if(activeRequest.current)return;completed.current=false;setLiveChoice(null);setSelectedKey('');setPath([]);setError('');}} onChoice={choice=>{if(activeRequest.current)return;completed.current=false;setLiveChoice(choice);setPath(choice.path);setSelectedKey(choice.key);setError('');}}/>}
    {path.length > 0 && <nav className="category-breadcrumb" aria-label="선택한 카테고리 경로">{path.map((name,index)=><button type="button" key={index} disabled={busy||catalogMode==='live'} onClick={()=>navigate(path.slice(0,index+1))}>{name}</button>)}</nav>}
    <div hidden={catalogMode!=='saved'}>
    <label className="field"><span>카테고리 검색</span><input type="search" placeholder="카테고리 이름 또는 번호" value={query} onChange={event => setQuery(event.target.value)} disabled={busy}/></label>
    {profiles.length > 0 && <details className="category-saved"><summary>저장한 카테고리 설정에서 선택</summary><label className="field"><span>저장한 카테고리 설정</span><select value={selected?.profileId ?? ''} disabled={busy} onChange={event => { const found = choices.find(choice => choice.profileId === event.target.value); if (found) { choose(found); setQuery(''); } }}><option value="">저장한 설정 선택</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name} · {profile.categoryId || '코드 미입력'} · {profile.categoryPath.join(' › ')}</option>)}</select></label></details>}
    {query.trim() ? <div className="category-search-results">{visible.map(choice => <button key={choice.key} type="button" className={selectedKey === choice.key ? 'selected' : ''} onClick={() => { if (activeRequest.current || completed.current) return; if (choice.isLeaf) { choose(choice); if (canConfirmCategory(choice)) void confirm(choice); } else { navigate(choice.path); setQuery(''); } }} disabled={busy}><span>{choice.path.join(' › ')}{choice.profileName && <em>{choice.profileName}</em>}</span><small className={canConfirmCategory(choice) ? 'ready' : 'unconfirmed'}>{choice.categoryId ? `${choice.evidence === 'saved' ? '저장 설정 · ' : ''}${choice.categoryId}` : choice.isLeaf ? '최종 · 코드 미확인' : choice.childrenObserved ? '하위 분류 보기' : '하위 목록 미확인'}</small></button>)}{!visible.length && <p>관찰한 목록과 저장 설정에서 일치하는 분류가 없습니다. 전체 목록에 없는 것으로 단정할 수는 없습니다.</p>}</div> : <div className="category-tree">{Array.from({ length: depths }, (_, depth) => <section key={depth}><h3>{depth + 1}단계 카테고리</h3><div className="category-tree-options">{categoryLevel(choices, path, depth).map(name => {
      const next = [...path.slice(0, depth), name]; const exact = categoryChoicesAtPath(choices, next); const leaves = exact.filter(choice => choice.isLeaf);
      const known = leaves.some(canConfirmCategory); const children = categoryLevel(choices, next, next.length).length > 0;
      return <button type="button" key={name} className={path[depth] === name ? 'selected' : ''} disabled={busy} onClick={() => navigate(next)}><span>{name}</span><small className={known ? 'ready' : 'unconfirmed'}>{known ? '설정 선택' : leaves.length ? '최종 · 코드 미확인' : children ? '›' : '하위 미확인'}</small></button>;
    })}</div></section>)}</div>}
    </div>
    {connections.length > 1 && <div className="category-connections"><strong>이 경로에 연결된 설정을 선택해주세요.</strong>{connections.map(choice => <button key={choice.key} className={selectedKey === choice.key ? 'selected' : ''} type="button" disabled={busy} onClick={() => choose(choice)}><span>{choice.profileName || '화면에서 관찰한 분류'} · {choice.categoryId || '코드 미입력'}</span><small>{codeEvidenceLabel(choice)}</small></button>)}</div>}
    {unresolvedBranch && <div className="category-unconfirmed" role="status"><strong>{path.join(' › ')}</strong><p>이 가지의 하위 목록은 아직 확보하지 못했습니다. {path[0] === '기프트카드' ? '쿠플러스에서 다른 분류의 이전 목록이 남아 있어 해당 하위 목록을 가져오지 않았습니다.' : '최종 분류 이름과 실제 코드를 확인한 뒤 저장 설정으로 연결해주세요.'}</p></div>}
    {selected?.isLeaf && <div className={`category-summary ${canConfirmCategory(selected) ? '' : 'unconfirmed'}`}><strong>{selected.path.join(' › ')}</strong><span>{selected.categoryId ? `카테고리 ${selected.categoryId}` : '분류 코드 미확인'}</span><p>{canConfirmCategory(selected) ? '선택 완료를 누르면 1688 URL 입력으로 이동합니다. 수집한 상품정보와 기본설정을 이 카테고리의 견적 항목에 연결합니다.' : '이 분류는 코드 확인이 필요합니다. 확인된 최종 카테고리를 선택해주세요.'}</p>{schema?.status === 'unconfirmed' && <small>이 카테고리의 전체 견적 항목은 아직 대조되지 않았습니다.</small>}</div>}
    <details className="category-scope"><summary>현재 지원 범위와 확인 근거</summary><p>{categoryObservationScope.rootsWithSecondLevel}개 대분류의 2단계 {categoryObservationScope.secondLevel}개와 주방수납/정리 최종 {categoryObservationScope.completeSubtreeLeaves}개, 요가/필라테스용품 최종 {categoryObservationScope.yogaSubtreeLeaves}개 경로를 확인했습니다. 코드 {categoryObservationScope.knownCodes}개 중 {categoryObservationScope.supplierHubCodes}개는 {categoryObservationScope.supplierHubObservedDate} Supplier Hub 개별등록 화면과 대조했습니다. 전체 최종 분류·카테고리별 양식·공식 접수는 아직 모두 검증되지 않았습니다.</p></details>
    {error && <p role="alert" className="collection-error">{error}</p>}
    <div className="modal-actions"><button className="btn primary" type="button" disabled={!canConfirmCategory(selected) || busy} onClick={() => void confirm()}>{busy ? '설정 중…' : '선택 완료 · URL 입력'}</button></div>
    <details className="category-advanced" key={selected?.key ?? 'unselected'}><summary>견적 항목·Excel 출력 설정</summary>
      {selected?.isLeaf && <p>{codeEvidenceLabel(selected)}{selected.codeObservedAt ? ` · ${selected.codeObservedAt.slice(0, 10)}` : ''}</p>}
      <p>카테고리 선택과 초안 작성은 Excel 파일을 연결하지 않아도 진행할 수 있습니다. 원본 Excel 양식으로 출력할 때 아래 설정을 사용합니다.</p>
      {selected?.isLeaf && schema && (selectedProfile ? <IntakeQuotationPreview key={`${selected.key}:${selectedProfile.revision}`} profile={selectedProfile}/> : <CategoryQuotationPreview key={selected.key} schema={schema} />)}
      <button className="btn ghost" type="button" disabled={busy} onClick={() => onAdvanced(categoryAdvancedSeed(selected, path))}>{selected?.categoryId ? '카테고리·Excel 양식 설정' : '선택 경로로 실제 코드·양식 연결'}</button>
    </details>
    {selected?.categoryId && !usableCategoryCode(selected.categoryId) && <p role="alert">저장된 카테고리 번호 형식이 올바르지 않습니다. 카테고리·Excel 양식 설정에서 영문·숫자·하이픈·밑줄 100자 이하의 실제 번호로 수정해주세요. 기존 설정은 보존되어 있습니다.</p>}
  </div>;
}
