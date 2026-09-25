/** A blank wire code is a choice only when its schema and source confirm it. */
export function hasSelectedEmptyQuotationChoice(
  field: { type: string; choices?: readonly { value: string; label: string }[] },
  cell: { value: string; source: string } | undefined,
): boolean {
  return cell?.value === '' && Boolean(cell.source) && cell.source !== 'empty'
    && field.type === 'select' && Boolean(field.choices?.some(choice => choice.value === ''));
}
