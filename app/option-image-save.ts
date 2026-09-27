import { optionInputs, type OptionInput, type ProductOptions } from '@/app/product-options';
/** Save image selections for existing options, never unrelated draft edits. */
export function optionImageSaveRows(saved: ProductOptions, draft: readonly OptionInput[]): OptionInput[] {
 return optionInputs(saved).map(row=>{const pending=draft.find(item=>item.id===row.id);return pending?{...row,imageKey:pending.imageKey}:row;});
}
export function mergeSavedOptionImages(draft: readonly OptionInput[], saved: ProductOptions): OptionInput[] {
 return draft.map(row=>{const stored=saved.rows.find(item=>item.id===row.id);return stored?{...row,imageKey:stored.imageKey}:row;});
}
