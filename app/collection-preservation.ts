import type { CollectionJob, CollectionRequest, CollectionContext, PreservedCollectionRequest } from '@/app/sourcing';
import { capturedCollectionCompany } from '@/app/collection-company';

/** Compare the persisted result, so concurrent inserts and retries are reported truthfully. */
export function preservedCollectionRequests(jobs: readonly CollectionJob[], requests: readonly CollectionRequest[], context: CollectionContext): PreservedCollectionRequest[] {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
    return JSON.stringify(value) ?? 'undefined';
  };
  const settingsForComparison = (value: unknown, inactiveBundle: boolean, inactiveIntegrated: boolean): unknown => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const compared = { ...value } as Record<string, unknown>;
    // Old captures predate the three bundle criteria. Compare missing fields as
    // legacy nulls; while both switches are off, criteria cannot affect intake.
    // Never normalize the stored capture or hide an active policy difference.
    for (const key of ['bundleCriterion','bundleMinimumSupplyMargin','bundleMinimumCoupangMargin']) {
      if (inactiveBundle) delete compared[key];
      else if (!Object.hasOwn(compared, key)) compared[key] = null;
    }
    if (inactiveIntegrated) { delete compared.useIntegratedRate; delete compared.integratedRate; }
    else { if (!Object.hasOwn(compared, 'useIntegratedRate')) compared.useIntegratedRate = false; if (!Object.hasOwn(compared, 'integratedRate')) compared.integratedRate = null; }
    return compared;
  };
  const companyForComparison = (value: unknown) => {
    try { return capturedCollectionCompany(value); }
    catch { return 'invalid-recorded-company'; }
  };
  return jobs.flatMap(job => {
    const request = requests.find(item => item.offerId === job.offer_id);
    if (!request) return [];
    const differences: string[] = [];
    if (job.goal !== request.goal) differences.push('작업 목표');
    if (!job.context) differences.push('카테고리·기본설정 기록 없음');
    else {
      if (canonical(companyForComparison(job.context)) !== canonical(companyForComparison(context))) differences.push('수집 당시 회사');
      if (canonical(job.context.category) !== canonical(context.category)) differences.push('카테고리·견적서 설정');
      const inactiveBundle = job.context.settings?.bundleEnabled === false && context.settings?.bundleEnabled === false;
      const inactiveIntegrated = [job.context.settings?.useIntegratedRate, context.settings?.useIntegratedRate].every(value => value === undefined || value === false);
      if (canonical(settingsForComparison(job.context.settings, inactiveBundle, inactiveIntegrated)) !== canonical(settingsForComparison(context.settings, inactiveBundle, inactiveIntegrated))) differences.push('기본설정');
      if (job.context.features !== context.features) differences.push('상품 특징');
      if (job.context.keywords !== context.keywords) differences.push('타겟 키워드');
    }
    return differences.length ? [{ offerId: job.offer_id, sourceUrl: job.source_url, differences }] : [];
  });
}
