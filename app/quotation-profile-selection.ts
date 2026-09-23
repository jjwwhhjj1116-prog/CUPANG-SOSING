import type { CategoryProfile } from '@/app/category-profiles';
import type { QuotationFieldsView } from '@/app/quotation-schema';

/** A profile ID is mutable; auto-selection also requires its captured category code. */
export function selectQuotationProfile(profiles: readonly CategoryProfile[], context: QuotationFieldsView['categoryContext'], preferredId?: string) {
  if (preferredId) {
    if (!profiles.some(profile => profile.id === preferredId)) throw new Error('검사에 사용한 카테고리 설정이 삭제되었습니다. 사용할 설정을 다시 선택해주세요.');
    return { profileId: preferredId, warning: '' };
  }
  if (!context.profileId) return { profileId: '', warning: '' };
  const saved = profiles.find(profile => profile.id === context.profileId);
  if (!saved) return { profileId: '', warning: '수집할 때 사용한 설정이 삭제되었습니다. 수집 당시 분류를 유지합니다. Excel 출력에 사용할 설정은 직접 선택해주세요.' };
  if (!context.categoryId || saved.categoryId !== context.categoryId) return {
    profileId: '',
    warning: `수집 당시 카테고리(${context.categoryId || '미확인'})와 현재 저장 설정(${saved.categoryId || '미확인'})이 다르거나 확인되지 않았습니다. 수집 당시 분류를 유지하며 다른 양식을 자동 적용하지 않았습니다.`,
  };
  return { profileId: saved.id, warning: '' };
}
