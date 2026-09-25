/** Shared order for the collection handoff and the product editor. */
export const registrationSteps: readonly string[] = ['SEO','가격','대표 이미지','추가 이미지','상세 이미지','표시사항','견적서'];
export type CollectionEditorTab = 'SEO'|'가격'|'대표 이미지'|'추가 이미지'|'상세 이미지'|'표시사항'|'견적서'|'옵션';
export function initialRegistrationStep(tab: string): string {
  return registrationSteps.includes(tab) ? tab : 'SEO';
}
