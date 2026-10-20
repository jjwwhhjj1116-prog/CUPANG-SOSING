'use client';
import { validOptionRegistrationNumbers, optionRegistrationLabel } from '@/app/product-registration';
import { QuotationTranslatedAttributes } from '@/app/components/quotation-translated-attributes';
import { QuotationAiPanel } from '@/app/components/quotation-ai-panel';
import { QuotationWorkbookReview } from '@/app/components/quotation-workbook-review';
import { importQuotationWorkbookDraft } from '@/app/quotation-workbook-review';
import { SupplierHubSingleReview } from '@/app/components/supplier-hub-single-review';

import { resolveQuotationNavigation, type QuotationNavigationTarget } from '@/app/quotation-navigation';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { duplicateQuotationImageIssue, quotationImageRoleIssues, quotationBarcodeIssues, quotationOptionLimitIssue, quotationPriceIssues, quotationValueIssues, validateQuotationChanges, type QuotationField, type QuotationFieldsView, type QuotationOverrides } from '@/app/quotation-schema';
import './quotation-fields-editor.css';
import { QuotationLabelPanel } from '@/app/components/quotation-label-panel';
import type { QuotationLabelUploadCache } from '@/app/quotation-label-attachment';
import type { LabelBatchCache } from '@/app/quotation-label-batch';
import { QuotationChoiceInput } from '@/app/components/quotation-choice-input';
import { quotationFieldGroup } from '@/app/quotation-field-groups';
import { quotationFieldDisplay } from '@/app/quotation-field-display';
import { quotationValueLength } from '@/app/quotation-scalar-constraints';
import { hasCouplusEmptyAttributeDefault } from '@/app/couplus-quotation-defaults';
import { hasSelectedEmptyQuotationChoice } from '@/app/quotation-choice-state';
import { quotationPackagedWeightEditChanges, quotationPackagedWeightEditFields, quotationPackagedWeightManual, quotationPackagedWeightPeer } from '@/app/quotation-packaged-weight';
import { isPackagedDimensionsMmField, normalizePackagedDimensionsMm } from '@/app/quotation-packaged-dimensions';
import { quotationPackagingReconfirmationChanges, quotationPackagingChangeStored, quotationPackagingChangeScopeChanged } from '@/app/quotation-packaging-basis';
import { quotationPriceDisplayField, quotationPriceEditChanges, quotationPriceEditFields, quotationPriceEditInput, quotationPriceStagedEdit, quotationPriceVisibleFields } from '@/app/quotation-price-edits';
import { quotationPriceTargets } from '@/app/quotation-price-targets';
import { quotationRequiredSummary } from '@/app/quotation-required-summary';
import { confirmQuotationFieldsSave, quotationFieldsSaveNeedsReadback } from '@/app/quotation-fields-confirmation';
import { quotationManualModelLinkState, quotationModelSuggestionState } from '@/app/quotation-model-suggestion';
import { QuotationExposedDuplicates } from '@/app/components/quotation-exposed-duplicates';
import { ProductOptionSplitPanel } from '@/app/components/product-option-split-panel';

export type QuotationEditorChange = { fieldKey: string; optionId: string | null; value: string | null };
type Row = QuotationFieldsView['resolved']['rows'][number];
type Cell = Row['fields'][string];
type Conflict = { key: string; change: QuotationEditorChange; before: string | null; saved: string | null; unavailable: boolean; schemaChanged?: boolean; packagingChanged?:boolean;linked?: string[] };
type BulkPreview = { mode?: 'restore'; base: string; changes: QuotationEditorChange[]; skipped?: string[]; rows: { optionId: string; optionLabel: string; fieldKey: string; label: string; before: string; after: string; beforeDisplay: string; afterDisplay: string; manualBefore: boolean }[] };
type Props = { navigationTarget?: QuotationNavigationTarget; productId: string; profileId?: string; refreshToken?: string; onSaved?: () => void; onReceiptSaved?:()=>void; onDirtyChange?: (dirty: boolean) => void; submissionActive?: boolean };
const sections = [
  { id: 'start', title: '시작 정보', english: 'Start', description: '상품명과 선택한 카테고리를 확인합니다.' },
  { id: 'product', title: '상품 정보', english: 'Product', description: '기본 정보, 판매 가격과 카테고리 속성을 편집합니다.' },
  { id: 'image', title: '이미지', english: 'Image', description: '이 상품에 저장한 이미지와 상세 설명을 연결합니다.' },
  { id: 'legal', title: '법적 정보', english: 'Legal', description: '인증과 상품정보 제공 고시를 실제 자료와 대조합니다.' },
  { id: 'logistics', title: '물류 정보', english: 'Logistics', description: '입고 수량과 포장 상태의 규격을 입력합니다.' },
] as const;
const sourceLabels: Record<string, string> = { 'couplus-default': '쿠플러스 양식 기본값', 'manual-option': '옵션 직접 수정', 'manual-common': '공통 직접 수정', content: '저장 콘텐츠', settings: '기본 설정', option: '저장 옵션', pricing: '가격 계산', product: '저장 상품', schema: '선택 카테고리', empty: '미입력' };
const has = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
export const quotationEditorKey = (optionId: string | null, fieldKey: string) => JSON.stringify([optionId, fieldKey]);
export function resolveQuotationEditorNavigation(resolved: QuotationFieldsView['resolved'], target: QuotationNavigationTarget) {
  const destination = resolveQuotationNavigation(resolved, target);
  return destination.ok ? { ...destination, fieldId: quotationPriceDisplayField(resolved.schema.fields, destination.fieldId) } : destination;
}
function manualValue(overrides: QuotationOverrides, optionId: string | null, fieldKey: string): string | null {
  const record = optionId === null ? overrides.common : overrides.options[optionId];
  return record && has(record, fieldKey) ? record[fieldKey] : null;
}
export function updateQuotationEditorDraft(overrides: QuotationOverrides, changes: readonly QuotationEditorChange[], change: QuotationEditorChange): QuotationEditorChange[] {
  const key = quotationEditorKey(change.optionId, change.fieldKey);
  const next = changes.filter(item => quotationEditorKey(item.optionId, item.fieldKey) !== key);
  if (manualValue(overrides, change.optionId, change.fieldKey) !== change.value) next.push({ ...change });
  return next;
}

/** Copy only the current option's edits; keep every untouched automatic field linked. */
export function quotationSavePlan(view: QuotationFieldsView, changes: readonly QuotationEditorChange[], sourceOptionId: string | null, allOptions: boolean) {
  let planned = quotationPriceEditChanges(view.resolved.schema.fields, quotationPackagedWeightEditChanges(view.resolved.schema.fields, changes));
  const propagated: { optionId: string; optionLabel: string; included: boolean; fieldKey: string; label: string; before: string; after: string }[] = [];
  if (allOptions && (sourceOptionId === null || !view.resolved.rows.some(row => row.optionId === sourceOptionId))) throw Error('현재 상품의 원본 옵션을 선택해주세요.');
  const edits = allOptions ? planned.filter(change => change.optionId === sourceOptionId) : [];
  for (const row of allOptions ? view.resolved.rows : []) {
    if (row.optionId === null || row.optionId === sourceOptionId) continue;
    for (const edit of edits) {
      const field = view.resolved.schema.fields.find(field => field.id === edit.fieldKey);
      if (!field || field.readOnly) throw Error('복사할 견적 항목을 다시 확인해주세요.');
      const target = { ...edit, optionId: row.optionId };
      if (storedDraftManual(view, planned, row.optionId, edit.fieldKey) === edit.value) continue;
      const before = resolveQuotationEditorCell(view, changes, row.optionId, edit.fieldKey);
      planned = updateQuotationEditorDraft(view.overrides, planned, target);
      const after = resolveQuotationEditorCell(view, planned, row.optionId, edit.fieldKey);
      propagated.push({ optionId: row.optionId, optionLabel: row.optionLabel, included: row.included, fieldKey: edit.fieldKey, label: field.label,
        before: quotationFieldDisplay(field, before), after: quotationFieldDisplay(field, after) });
      if (planned.length > 1000) throw Error('한 번에 1,000개 값까지 저장할 수 있습니다. 수정 항목을 나눠 저장해주세요.');
    }
  }
  const priceScopes = new Set(planned.filter(change => ['supplyPrice', 'salePrice'].includes(quotationPriceEditInput(view.resolved.schema.fields, change.fieldKey) ?? '')).map(change => change.optionId));
  if (priceScopes.size) {
    const targets = quotationPriceTargets(view.resolved.schema.fields);
    for (const row of view.resolved.rows.filter(row => (row.included || priceScopes.has(row.optionId)) && (priceScopes.has(row.optionId) || priceScopes.has(null)))) {
      const issues = quotationPriceIssues(view.resolved.schema,
        resolveQuotationEditorCell(view, planned, row.optionId, targets.supplyPrice.primary).value,
        resolveQuotationEditorCell(view, planned, row.optionId, targets.salePrice.primary).value);
      if (issues.length) throw new Error(`${row.optionLabel}: ${issues.join(' ')}`);
    }
  }
  return { changes: planned, propagated };
}
function draftManual(view: QuotationFieldsView, changes: readonly QuotationEditorChange[], optionId: string | null, fieldKey: string) {
  try { const price = quotationPriceStagedEdit(view.resolved.schema.fields, changes, optionId, fieldKey); if (price) return price.value; }
  catch { /* Keep each conflicting input visible; the save plan reports it. */ }
  return storedDraftManual(view, changes, optionId, fieldKey);
}
function storedDraftManual(view: QuotationFieldsView, changes: readonly QuotationEditorChange[], optionId: string | null, fieldKey: string) {
  const staged = changes.find(change => change.optionId === optionId && change.fieldKey === fieldKey);
  return staged ? staged.value : manualValue(view.overrides, optionId, fieldKey);
}
export function resolveQuotationEditorCell(view: QuotationFieldsView, changes: readonly QuotationEditorChange[], optionId: string | null, fieldKey: string): Cell {
  const automatic = view.automatic.rows.find(row => row.optionId === optionId)?.fields[fieldKey];
  const saved = view.resolved.rows.find(row => row.optionId === optionId)?.fields[fieldKey];
  const fallback = automatic ?? saved ?? { value: '', source: 'empty', needsReview: false, issues: [] };
  const definition = view.resolved.schema.fields.find(field => field.id === fieldKey);
  if (definition?.readOnly) return fallback;
  const optionValue = optionId === null ? null : draftManual(view, changes, optionId, fieldKey);
  const commonValue = draftManual(view, changes, null, fieldKey);
  const weightManual = quotationPackagedWeightManual(view.resolved.schema.fields, fieldKey, optionId,
    (layer, id) => draftManual(view, changes, layer, id));
  const value = weightManual?.value ?? optionValue ?? commonValue;
  const source = weightManual?.source ?? (optionValue !== null ? 'manual-option' : commonValue !== null ? 'manual-common' : fallback.source);
  const resolvedValue = value ?? fallback.value;
  const inherited = value === null ? fallback : saved?.value === value && saved.source === source ? saved : undefined;
  const dynamicIssues = new Set([
    '판매가는 공급가보다 작을 수 없습니다.', duplicateQuotationImageIssue,
    '실제 바코드 번호를 입력해주세요.', '바코드 생성 요청 방식과 입력된 번호가 충돌합니다.',
    ...quotationBarcodeIssues(view.resolved.schema.categoryId, 'existing', resolvedValue),
  ]);
  const priceIssues: string[] = [];
  try {
    for (const layer of optionId === null ? [null] : [optionId, null]) quotationPriceStagedEdit(view.resolved.schema.fields, changes, layer, fieldKey);
    if (quotationPriceEditInput(view.resolved.schema.fields, fieldKey) === 'salePrice') {
      const target = quotationPriceTargets(view.resolved.schema.fields);
      priceIssues.push(...quotationPriceIssues(view.resolved.schema, resolveQuotationEditorCell(view, changes, optionId, target.supplyPrice.primary).value, resolvedValue));
    }
  } catch (cause) { priceIssues.push(cause instanceof Error ? cause.message : '연결된 가격 수정값을 확인해주세요.'); }
  const validationIssues = [...new Set([
    ...(inherited?.validationIssues ?? inherited?.issues ?? []).filter(issue => !dynamicIssues.has(issue)),
    ...(definition ? quotationValueIssues(definition, resolvedValue, view.imageKeys, source) : []),
    ...priceIssues,
  ])];
  if (fieldKey === 'barcode') {
    const mode = resolveQuotationEditorCell(view, changes, optionId, 'barcodeMode').value;
    validationIssues.push(...quotationBarcodeIssues(view.resolved.schema.categoryId, mode, resolvedValue));
    if (mode === 'existing' && !resolvedValue.trim()) validationIssues.push('실제 바코드 번호를 입력해주세요.');
    if (mode === 'request-coupang' && resolvedValue.trim()) validationIssues.push('바코드 생성 요청 방식과 입력된 번호가 충돌합니다.');
  }
  // Keep server source reviews for an unchanged saved cell. A pending quantity
  // edit invalidates the saved pack-price review; saving refreshes that evidence.
  const quantityDraft = source === 'pricing' && changes.some(change => change.fieldKey === 'quantity' && (change.optionId === optionId || change.optionId === null));
  const reviewMessages: string[] = saved?.value === resolvedValue && saved.source === source && !quantityDraft ? [...(saved.reviewMessages ?? [])] : [];
  if (source === 'couplus-default') reviewMessages.push('쿠플러스 참조 화면의 양식 기본값입니다. 실제 상품의 해당 여부를 확인해주세요.');
  if (definition?.workbookWire?.requirement === 'conditional') reviewMessages.push(['해당 상품에 조건이 적용되는지 확인해주세요.', definition.help].filter(Boolean).join('\n'));
  else if (definition?.reviewRequired && (resolvedValue.trim() || hasSelectedEmptyQuotationChoice(definition, { value: resolvedValue, source }))) reviewMessages.push('실제 상품·증빙과 일치하는지 확인해주세요.');
  if (definition?.type === 'images' && resolvedValue) reviewMessages.push('견적서에는 연결한 첨부 이미지 파일명이 기록됩니다. 실제 상품과 이미지 구성을 확인해주세요.');
  const errors = [...new Set(validationIssues)];
  const issues = [...new Set([...errors, ...reviewMessages,
    ...(fieldKey === 'detailImages' ? quotationImageRoleIssues(resolveQuotationEditorCell(view, changes, optionId, 'mainImage').value, resolvedValue) : []),
  ])];
  return { ...fallback, value: resolvedValue, source, issues, validationIssues: errors, reviewMessages: [...new Set(reviewMessages)],
    needsReview: Boolean(definition?.reviewRequired) || issues.length > 0 };
}
function quotationEditorChangeFields(fields: readonly QuotationField[], change: QuotationEditorChange, changes: readonly QuotationEditorChange[]) {
  const weights = quotationPackagedWeightEditFields(fields, change.fieldKey, change.value).filter(id =>
    id === change.fieldKey || !changes.some(item => item.optionId === change.optionId && item.fieldKey === id && item.value === null));
  return [...new Set(weights.flatMap(id => quotationPriceEditFields(fields, id)))];
}
/** A conflict decision covers the same stored fields that its eventual save
 * addresses, including a former peer after the category binding changes.
 * Weight resets remain independent when their peer has a literal draft. */
export function resolveQuotationEditorConflict(view: QuotationFieldsView, changes: readonly QuotationEditorChange[], conflicts: readonly Conflict[], key: string, choice: 'draft' | 'saved') {
  const selected = conflicts.find(conflict => conflict.key === key);
  if (!selected) return { changes: changes.map(change => ({ ...change })), conflicts: [...conflicts] };
  const linked = new Set(selected.linked ?? [selected.change.fieldKey]);
  try { quotationEditorChangeFields(view.resolved.schema.fields, selected.change, changes).forEach(id => linked.add(id)); }
  catch { /* Retain the reviewed peer identities when the new binding is ambiguous. */ }
  const matches = (change: QuotationEditorChange) => change.optionId === selected.change.optionId && linked.has(change.fieldKey);
  if (choice === 'saved') {
    // Discarding an exact weight reset can make its retained literal peer pair
    // again. Discard that dependent draft too, so it cannot recreate a value
    // for which the user just chose the stored version.
    let expanded: boolean;
    do {
      expanded = false;
      const remaining = changes.filter(change => !matches(change));
      for (const change of remaining.filter(change => change.optionId === selected.change.optionId)) {
        try {
          const peers = quotationEditorChangeFields(view.resolved.schema.fields, change, remaining);
          if (!peers.some(id => linked.has(id))) continue;
          for (const id of peers) if (!linked.has(id)) { linked.add(id); expanded = true; }
        } catch { /* An ambiguous binding cannot introduce another saved peer. */ }
      }
    } while (expanded);
  }
  return {
    changes: changes.filter(change => choice === 'draft' || !matches(change)).map(change => ({ ...change })),
    conflicts: conflicts.filter(conflict => !matches(conflict.change)),
  };
}
export function reconcileQuotationEditorDraft(previous: QuotationFieldsView, next: QuotationFieldsView, changes: readonly QuotationEditorChange[], pending: readonly Conflict[] = []) {
  const conflicts: Conflict[] = [];
  const retained = changes.filter(change => {
    const key = quotationEditorKey(change.optionId, change.fieldKey);
    const prior = pending.find(conflict => conflict.key === key);
    let linked = prior?.linked ?? [change.fieldKey], nextLinked = [change.fieldKey], bindingChanged = false;
    try { linked = quotationEditorChangeFields(previous.resolved.schema.fields, change, changes); }
    catch { bindingChanged = true; }
    try { nextLinked = quotationEditorChangeFields(next.resolved.schema.fields, change, changes); }
    catch { bindingChanged = true; }
    const definition = (view: QuotationFieldsView, id: string) => view.resolved.schema.fields.find(field => field.id === id);
    const reviewedLinked = [...new Set([...linked, ...nextLinked, ...(prior?.linked ?? [])])];
    const unavailable = reviewedLinked.some(id => !next.resolved.schema.fields.some(field => field.id === id && !field.readOnly)) || !next.resolved.rows.some(row => row.optionId === change.optionId);
    const schemaChanged = bindingChanged || JSON.stringify(linked) !== JSON.stringify(nextLinked) || previous.resolved.schema.categoryId !== next.resolved.schema.categoryId ||
      linked.some(id => JSON.stringify(definition(previous, id)) !== JSON.stringify(definition(next, id))) || pending.some(conflict => conflict.key === key && conflict.schemaChanged);
    const packagingChanged=quotationPackagingChangeScopeChanged(previous,next,change)||Boolean(prior?.packagingChanged);
    const fulfilled = linked.every(id => manualValue(next.overrides, change.optionId, id) === change.value
      &&quotationPackagingChangeStored(previous,next,{...change,fieldKey:id},changes));
    if (!unavailable && !schemaChanged && !packagingChanged && fulfilled) return false;
    const changedId = linked.find(id => manualValue(previous.overrides, change.optionId, id) !== manualValue(next.overrides, change.optionId, id));
    const before = manualValue(previous.overrides, change.optionId, changedId ?? change.fieldKey), saved = manualValue(next.overrides, change.optionId, changedId ?? change.fieldKey);
    if (unavailable || schemaChanged || packagingChanged||changedId !== undefined || prior) conflicts.push({ key, change, before, saved, unavailable,
      linked: reviewedLinked, ...(schemaChanged ? { schemaChanged: true } : {}),...(packagingChanged?{packagingChanged:true}:{}) });
    return true;
  });
  return { changes: retained.map(change => ({ ...change })), conflicts };
}
function bulkBase(view: QuotationFieldsView, changes: readonly QuotationEditorChange[]) { return JSON.stringify([view.revision, view.inputFingerprint, changes]); }
export function previewQuotationEditorBulk(view: QuotationFieldsView, changes: readonly QuotationEditorChange[], sourceOptionId: string | null, fieldKeys: readonly string[], includedOnly: boolean): BulkPreview {
  if (!view.resolved.rows.some(row => row.optionId === sourceOptionId)) throw new Error('편집할 옵션을 다시 선택해주세요.');
  const fields = [...new Set(fieldKeys)].map(key => view.resolved.schema.fields.find(field => field.id === key));
  if (!fields.length || fields.some(field => !field || field.readOnly)) throw new Error('적용할 수정 가능 항목을 선택해주세요.');
  const rows: BulkPreview['rows'] = []; const planned: QuotationEditorChange[] = [];
  let targetDraft = [...changes];
  const skipped: string[] = [];
  const copyable = (fields as QuotationField[]).filter(field => {
    const cell = resolveQuotationEditorCell(view, changes, sourceOptionId, field.id);
    // A failed source derivation is not a reviewed value. Copying it as an
    // override would erase its diagnostics and overwrite another SKU's facts.
    // Ordinary value validation (including deliberate required-field blanks)
    // still belongs to the editor/save path, preserving explicit clearing.
    const valueIssues = new Set(quotationValueIssues(field, cell.value, view.imageKeys, cell.source));
    const sourceIssues = quotationEditorValidation(field, cell, view.imageKeys).filter(issue => !valueIssues.has(issue));
    if (sourceIssues.length) {
      skipped.push(`${field.label}: 원본을 확인한 뒤 적용해주세요. ${sourceIssues.join(' ')}`);
      return false;
    }
    if (cell.source !== 'empty') return true;
    skipped.push(`${field.label}: 원본이 미입력이므로 다른 옵션의 값과 자동 연동을 유지합니다.`);
    return false;
  });
  for (const field of copyable) {
    const peer = quotationPackagedWeightPeer(view.resolved.schema.fields, field.id);
    if (peer && copyable.some(item => item.id === peer)
      && resolveQuotationEditorCell(view, changes, sourceOptionId, field.id).value !== resolveQuotationEditorCell(view, changes, sourceOptionId, peer).value) {
      throw new Error('연결된 포장 무게 값이 다릅니다. 사용할 무게를 직접 입력한 뒤 적용해주세요.');
    }
    const prices = quotationPriceEditFields(view.resolved.schema.fields, field.id);
    if (prices.length > 1 && prices.some(id => copyable.some(item => item.id === id)
      && resolveQuotationEditorCell(view, changes, sourceOptionId, id).value !== resolveQuotationEditorCell(view, changes, sourceOptionId, field.id).value)) {
      throw new Error('연결된 가격의 수정값이 다릅니다. 사용할 금액을 직접 입력한 뒤 적용해주세요.');
    }
  }
  for (const row of view.resolved.rows) {
    if (row.optionId === null || row.optionId === sourceOptionId || (includedOnly && !row.included)) continue;
    for (const field of copyable) {
      const source = resolveQuotationEditorCell(view, changes, sourceOptionId, field.id);
      const after = isPackagedDimensionsMmField(field) ? normalizePackagedDimensionsMm(source.value) : source.value;
      for (const fieldKey of [...new Set(quotationPackagedWeightEditFields(view.resolved.schema.fields, field.id, after).flatMap(key => quotationPriceEditFields(view.resolved.schema.fields, key)))]) {
        const target = view.resolved.schema.fields.find(item => item.id === fieldKey)!;
        if (storedDraftManual(view, targetDraft, row.optionId, fieldKey) === after) continue;
        const before = resolveQuotationEditorCell(view, changes, row.optionId, fieldKey);
        rows.push({ optionId: row.optionId, optionLabel: row.optionLabel, fieldKey, label: target.label, before: before.value, after,
          beforeDisplay: quotationFieldDisplay(target, before), afterDisplay: quotationFieldDisplay(target, { ...source, value: after }), manualBefore: before.source.startsWith('manual-') });
        planned.push({ optionId: row.optionId, fieldKey, value: after });
        targetDraft = updateQuotationEditorDraft(view.overrides, targetDraft, { optionId: row.optionId, fieldKey, value: after });
        if (planned.length > 1000) throw new Error('한 번에 1,000개 값까지 적용할 수 있습니다. 항목 선택 범위를 줄여주세요.');
      }
    }
  }
  return { base: bulkBase(view, changes), changes: planned, rows, skipped };
}
/** Remove only selected option overrides. Shared edits remain the inheritance source. */
export function previewQuotationEditorRestore(view: QuotationFieldsView, changes: readonly QuotationEditorChange[], fieldKeys: readonly string[], includedOnly: boolean): BulkPreview {
  const fields = [...new Set(fieldKeys.flatMap(key => quotationPriceEditFields(view.resolved.schema.fields, key)))].map(key => view.resolved.schema.fields.find(field => field.id === key));
  if (!fields.length || fields.some(field => !field || field.readOnly)) throw new Error('복원할 수정 가능 항목을 선택해주세요.');
  const rows: BulkPreview['rows'] = []; const planned: QuotationEditorChange[] = [];
  for (const row of view.resolved.rows) {
    if (row.optionId === null || (includedOnly && !row.included)) continue;
    for (const field of fields as QuotationField[]) {
      if (draftManual(view, changes, row.optionId, field.id) === null) continue;
      const reset = { optionId: row.optionId, fieldKey: field.id, value: null };
      const before = resolveQuotationEditorCell(view, changes, row.optionId, field.id);
      rows.push({ optionId: row.optionId, optionLabel: row.optionLabel, fieldKey: field.id, label: field.label, before: before.value, after: '',
        beforeDisplay: quotationFieldDisplay(field, before), afterDisplay: '', manualBefore: true });
      planned.push(reset);
      if (planned.length > 1000) throw new Error('한 번에 1,000개 값까지 복원할 수 있습니다. 항목 선택 범위를 줄여주세요.');
    }
  }
  const resets = quotationPriceEditChanges(view.resolved.schema.fields, planned).reduce((draft, change) => updateQuotationEditorDraft(view.overrides, draft, change), [...changes]);
  for (const row of rows) {
    const field = view.resolved.schema.fields.find(field => field.id === row.fieldKey)!;
    const after = resolveQuotationEditorCell(view, resets, row.optionId, row.fieldKey);
    row.after = after.value; row.afterDisplay = quotationFieldDisplay(field, after);
  }
  return { mode: 'restore', base: bulkBase(view, changes), changes: planned, rows };
}
export function applyQuotationEditorBulk(view: QuotationFieldsView, changes: readonly QuotationEditorChange[], preview: BulkPreview) {
  if (preview.base !== bulkBase(view, changes)) throw new Error('미리보기 이후 입력이 바뀌었습니다. 적용 범위를 다시 확인해주세요.');
  const next = preview.changes.reduce((draft, change) => updateQuotationEditorDraft(view.overrides, draft, change), [...changes]);
  if (next.length > 1000) throw new Error('저장할 수정은 한 번에 1,000개까지입니다. 현재 수정부터 저장한 뒤 적용 범위를 줄여주세요.');
  return next;
}
export function quotationEditorIssues(field: QuotationField, cell: Cell, imageKeys: readonly string[]) {
  return [...new Set([...cell.issues, ...quotationValueIssues(field, cell.value, imageKeys, cell.source)])];
}
function imageValues(value: string) { return [...new Set(value.split('\n').map(key => key.trim()).filter(Boolean))]; }
export function quotationEditorValidation(field: QuotationField, cell: Cell, imageKeys: readonly string[]) {
  return [...new Set([...(cell.validationIssues ?? []), ...quotationValueIssues(field, cell.value, imageKeys, cell.source)])];
}
export function quotationEditorRequiredSummary(view: QuotationFieldsView, changes: readonly QuotationEditorChange[], optionId: string | null, section?: QuotationField['section']) {
  const fields = quotationPriceVisibleFields(view.resolved.schema.fields).filter(field => section === undefined || field.section === section);
  return quotationRequiredSummary(fields, field => {
    const cell = resolveQuotationEditorCell(view, changes, optionId, field.id);
    return { value: cell.value, source: cell.source, validationIssues: quotationEditorValidation(field, cell, view.imageKeys) };
  });
}
export function quotationSectionProgress(view: QuotationFieldsView, changes: readonly QuotationEditorChange[], optionId: string | null) {
  return sections.map(section => {
    const fields = quotationPriceVisibleFields(view.resolved.schema.fields).filter(field => field.section === section.id);
    const { required, complete } = quotationEditorRequiredSummary(view, changes, optionId, section.id);
    let invalid = 0;
    for (const field of fields) {
      const cell = resolveQuotationEditorCell(view, changes, optionId, field.id);
      const issues = quotationEditorValidation(field, cell, view.imageKeys);
      if (issues.length) invalid++;
    }
    return { ...section, required, complete, invalid };
  });
}
export function quotationOptionOverview(view: QuotationFieldsView, changes: readonly QuotationEditorChange[]) {
  return view.resolved.rows.filter(row => row.included).map(row => {
    let linked = 0; let defaults = 0; let manual = 0;
    const missingFields = quotationEditorRequiredSummary(view, changes, row.optionId).missing.map(entry => ({ fieldKey: entry.field.id, label: entry.field.label, section: entry.field.section }));
    const problems: { fieldKey: string; label: string; section: QuotationField['section']; issues: string[] }[] = [];
    for (const field of quotationPriceVisibleFields(view.resolved.schema.fields)) {
      const cell = resolveQuotationEditorCell(view, changes, row.optionId, field.id);
      if (cell.source.startsWith('manual-')) manual++;
      else if (cell.source === 'couplus-default') defaults++;
      else if (cell.source !== 'empty' && (cell.value.trim() || hasSelectedEmptyQuotationChoice(field, cell))) linked++;
      // Use the same draft-aware validation as the individual field, including
      // failed automatic calculations and unavailable image references.
      // Review reminders remain separate from validation problems.
      const issues = quotationEditorValidation(field, cell, view.imageKeys);
      if (issues.length) problems.push({ fieldKey: field.id, label: field.label, section: field.section, issues });
    }
    return { optionId: row.optionId, optionLabel: row.optionLabel, linked, defaults, manual, missing: missingFields.length, missingFields, problems };
  });
}
export function QuotationOptionOverview({ view, changes, disabled, onOpen }: {
  view: QuotationFieldsView; changes: readonly QuotationEditorChange[]; disabled: boolean;
  onOpen: (optionId: string | null, section: QuotationField['section'], fieldId?: string) => void;
}) {
  const rows = quotationOptionOverview(view, changes);
  return <details className="quotation-fields-notice" open><summary>전체 견적 작성 현황 · 포함 {rows.length}개 · 필수 미입력 {rows.reduce((sum, row) => sum + row.missing, 0)}개</summary>
    <p>미저장 입력까지 반영한 항목 수입니다. 직접 수정한 공란도 수정으로 집계합니다. 양식 기본값과 입력 형식 확인은 실제 상품 검증·등록 가능 판정과 다릅니다. 제외 옵션은 집계하지 않습니다.</p>
    {rows.length > 0 && <div className="quotation-fields-bulk-table"><table><thead><tr><th>옵션</th><th>저장 자료 연동</th><th>양식 기본값</th><th>직접 수정</th><th>필수 미입력</th><th>입력 확인</th></tr></thead><tbody>{rows.map(row => <tr key={row.optionId ?? 'common'}>
      <td><button type="button" className="quotation-field-text-button" disabled={disabled} onClick={() => onOpen(row.optionId, 'start')}>{optionRegistrationLabel(row.optionId,row.optionLabel,view.optionRegistrationNumbers)}</button></td>
      <td>{row.linked}</td><td>{row.defaults}</td><td>{row.manual}</td><td>{row.missing}{row.missingFields.map(field => <div key={field.fieldKey}><button type="button" className="quotation-field-text-button" disabled={disabled} onClick={() => onOpen(row.optionId, field.section, field.fieldKey)}>{field.label} 입력하기</button></div>)}</td>
      <td>{row.problems.length ? row.problems.map(problem => <div key={problem.fieldKey}><button type="button" className="quotation-field-text-button" disabled={disabled} onClick={() => onOpen(row.optionId, problem.section)}>{problem.label} 구역 열기</button><small> · {problem.issues.join(' / ')}</small></div>) : '필수·형식 오류 없음 · 별도 검토 필요'}</td>
    </tr>)}</tbody></table></div>}
  </details>;
}
export function legacyQuotationCandidates(view: QuotationFieldsView, changes: readonly QuotationEditorChange[]) {
  if (!view.categoryContext.categoryId || !view.legacyOverrides) return [];
  const entries: [string | null, Record<string, string>][] = [[null, view.legacyOverrides.common], ...Object.entries(view.legacyOverrides.options)];
  return entries.flatMap(([optionId, values]) => Object.entries(values).map(([fieldKey, value]) => {
    const field = view.resolved.schema.fields.find(item => item.id === fieldKey);
    const row = view.resolved.rows.find(item => item.optionId === optionId);
    const issues = !field || field.readOnly || !row ? ['현재 양식에서 수정할 수 없는 항목 또는 삭제된 옵션입니다.'] : value.trim() ? quotationValueIssues(field, value, view.imageKeys) : [];
    return { key: quotationEditorKey(optionId, fieldKey), change: { optionId, fieldKey, value }, label: field?.label ?? fieldKey,
      optionLabel: row?.optionLabel ?? (optionId === null ? '공통' : optionId),
      before: row && field ? resolveQuotationEditorCell(view, changes, optionId, fieldKey).value : '', issues };
  }));
}
export function importLegacyQuotationDraft(view: QuotationFieldsView, changes: readonly QuotationEditorChange[], keys: readonly string[]) {
  const candidates = legacyQuotationCandidates(view, changes);
  if (!keys.length || new Set(keys).size !== keys.length) throw new Error('가져올 이전 항목을 선택해주세요.');
  const chosen = keys.map(key => candidates.find(item => item.key === key));
  if (chosen.some(item => !item || item.issues.length)) throw new Error('현재 양식에 맞지 않는 이전 입력은 가져올 수 없습니다.');
  const draft = chosen.reduce((current, item) => updateQuotationEditorDraft(view.overrides, current, item!.change), [...changes]);
  validateQuotationChanges(draft, { schema: view.resolved.schema, optionIds: view.resolved.rows.flatMap(row => row.optionId === null ? [] : [row.optionId]), ownedImageKeys: view.imageKeys, overrides: view.overrides });
  return draft;
}
function LegacyQuotationImport({ view, changes, disabled, onApply }: { view: QuotationFieldsView; changes: QuotationEditorChange[]; disabled: boolean; onApply: (keys: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const candidates = legacyQuotationCandidates(view, changes);
  if (!candidates.length) return null;
  return <details className="quotation-fields-notice"><summary>분류 미지정 이전 입력 비교 · {candidates.length}개</summary>
    <p>이전 자료에는 카테고리 기록이 없습니다. 현재 양식과 비교해 선택하세요. 선택한 현재 입력은 교체되며 이전 원본은 보존됩니다. 적용 후 견적 입력 저장을 눌러 확정하세요.</p>
    <div className="table-wrap"><table><thead><tr><th>선택</th><th>옵션 / 항목</th><th>현재 입력</th><th>이전 입력</th><th>확인 사항</th></tr></thead><tbody>{candidates.map(item => <tr key={item.key}>
      <td><input type="checkbox" aria-label={`${item.optionLabel} ${item.label} 가져오기`} checked={selected.includes(item.key)} disabled={disabled || item.issues.length > 0} onChange={event => setSelected(previous => event.target.checked ? [...previous, item.key] : previous.filter(key => key !== item.key))}/></td>
      <td>{item.optionLabel}<br/>{item.label}</td><td style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{item.before || '(공란)'}</td><td style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{item.change.value || '(공란)'}</td><td>{item.issues.join(' / ')}</td>
    </tr>)}</tbody></table></div><button type="button" className="btn primary" disabled={disabled || !selected.length} onClick={() => onApply(selected)}>선택한 {selected.length}개를 편집 초안에 적용</button>
  </details>;
}
async function fetchView(endpoint: string, signal?: AbortSignal): Promise<QuotationFieldsView> {
  const response = await fetch(endpoint, { signal, cache: 'no-store' });
  const body = await response.json() as QuotationFieldsView & { error?: string };
  if (!response.ok || !body.resolved || !body.automatic) throw new Error(body.error || '견적 입력 자료를 불러오지 못했습니다.');
  verifyQuotationRegistrationDisplay(body);
  return body;
}
function verifyQuotationRegistrationDisplay(view: QuotationFieldsView) {
  if(!Array.isArray(view.resolved?.rows)||!validOptionRegistrationNumbers(view.optionRegistrationNumbers,view.resolved.rows.flatMap(row=>row.optionId===null?[]:[{id:row.optionId}]))) throw Error('견적서의 옵션 등록번호 응답을 확인하지 못했습니다. 입력은 유지했습니다.');
}

export function QuotationFieldsEditor(props: Props) { return <QuotationFieldsForm key={`${props.productId}:${props.profileId ?? ''}`} {...props} />; }
function QuotationFieldsForm({ navigationTarget, productId, profileId, refreshToken, onSaved, onReceiptSaved, onDirtyChange, submissionActive = true }: Props) {
  const endpoint = `/api/products/${encodeURIComponent(productId)}/quotation-fields${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`;
  const [view, setView] = useState<QuotationFieldsView | null>(null);
  const [changes, commitChanges] = useState<QuotationEditorChange[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(true); const [operationBusy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [active, setActive] = useState<(typeof sections)[number]['id']>('start');
  const [selectedOption, setSelectedOption] = useState<string | null>(navigationTarget?.optionId ?? null);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [includedOnly, setIncludedOnly] = useState(true);
  const [bulk, setBulk] = useState<BulkPreview | null>(null);
  const [applyAll, setApplyAll] = useState(false);
  const [labelRecovery, setLabelRecovery] = useState('');
  const [splitBusy, setSplitBusy] = useState(false), [splitDrafting, setSplitDrafting] = useState(false);
  const busy = operationBusy || Boolean(labelRecovery) || splitBusy || splitDrafting;
  const initialTarget = useRef(navigationTarget); const pendingFocus = useRef<string | null>(null);
  const requests = useRef(0); const observedRefresh = useRef(refreshToken); const prefix = useId();
  const activeWrite = useRef<AbortController | null>(null);
  const explicitRefreshAction = useRef<{ endpoint: string; view: QuotationFieldsView | null; optionId: string | null; changes: QuotationEditorChange[]; conflicts: Conflict[]; recovery: string; run: () => Promise<void> } | null>(null);
  const aiDraftApplied = useRef(false);
  function setChanges(next: QuotationEditorChange[] | ((previous: QuotationEditorChange[]) => QuotationEditorChange[])) {
    explicitRefreshAction.current = null;
    aiDraftApplied.current = typeof next === 'function' || next.length > 0;
    commitChanges(next);
  }
  useEffect(() => { aiDraftApplied.current = changes.length > 0; }, [changes]);
  const modelActionState = useRef({ view, selectedOption, busy, loading, conflicts, changes, applyAll });
  useEffect(() => {
    modelActionState.current = { view, selectedOption, busy, loading, conflicts, changes, applyAll };
    return () => { modelActionState.current = { view: null, selectedOption, busy: true, loading: true, conflicts, changes, applyAll }; };
  }, [view, selectedOption, busy, loading, conflicts, changes, applyAll]);
  const labelBatchCache = useRef<LabelBatchCache>({ signature: null, uploaded: new Map() });
  const labelUploadCache = useRef<QuotationLabelUploadCache>({ signature: null, uploadedKey: null, rendered: null });
  const invalidateRequests = useCallback(() => { requests.current++; activeWrite.current?.abort(); activeWrite.current=null; }, []);
  const dirty = changes.length > 0;
  useEffect(() => { onDirtyChange?.(dirty || splitDrafting); }, [dirty, splitDrafting, onDirtyChange]);
  useEffect(() => {
    const controller = new AbortController(); const id = ++requests.current;
    fetchView(endpoint, controller.signal).then(saved => { if (!controller.signal.aborted && id === requests.current) {
        setView(saved);
        if (initialTarget.current) {
          const destination = resolveQuotationEditorNavigation(saved.resolved, initialTarget.current);
          if (destination.ok) { setSelectedOption(destination.optionId); setActive(destination.section); pendingFocus.current = destination.fieldId; setMessage(destination.message); }
          else setMessage(destination.message);
        }
      } })
      .catch(cause => { if (!controller.signal.aborted && id === requests.current) setError(cause instanceof Error ? cause.message : '견적 입력 자료 확인 실패'); })
      .finally(() => { if (!controller.signal.aborted && id === requests.current) setLoading(false); });
    return () => { controller.abort(); invalidateRequests(); };
  }, [endpoint, invalidateRequests]);
  useEffect(() => {
    if (loading || !pendingFocus.current) return;
    const element = document.getElementById(`${prefix}-${pendingFocus.current}`);
    if (element) { element.scrollIntoView({ block: 'center' }); element.focus({ preventScroll: true }); pendingFocus.current = null; }
  }, [loading, view, active, selectedOption, prefix]);
  const refresh = useCallback(async (discard = false, afterConflict = false, labelFailure?: string) => {
    if (activeWrite.current && !afterConflict) return;
    explicitRefreshAction.current = null;
    // Block an already captured model action before React commits loading.
    // The refreshed view's effect releases this lock after success or failure.
    modelActionState.current = { ...modelActionState.current, loading: true };
    const failureMessage = labelFailure ?? labelRecovery;
    const id = ++requests.current; setLoading(true); setError(''); setBulk(null);
    try {
      const saved = await fetchView(endpoint);
      if (id !== requests.current) return;
      const reconciled = view && !discard ? reconcileQuotationEditorDraft(view, saved, changes, conflicts) : { changes: [], conflicts: [] };
      setView(saved); setChanges(reconciled.changes); setConflicts(reconciled.conflicts); setLabelRecovery('');
      if (labelFailure) setError(labelFailure);
      if (!saved.resolved.rows.some(row => row.optionId === selectedOption)) setApplyAll(false);
      setMessage(labelFailure ? '현재 저장된 견적을 다시 불러왔습니다. 오류를 확인한 뒤 라벨 연결을 다시 실행해주세요.' : discard ? '현재 입력을 버리고 저장본을 불러왔습니다.' : reconciled.conflicts.length ? '저장값 또는 카테고리·항목 규격이 바뀌었습니다. 입력을 검토하고 사용할 값을 선택해주세요.' : '최신 상품·옵션·기본값을 반영했습니다. 직접 입력한 내용은 유지했습니다.');
    } catch (cause) {
      if (id === requests.current) {
        const reason = cause instanceof Error ? cause.message : '최신 자료 확인 실패';
        setError(failureMessage ? `${failureMessage} 현재 저장본을 확인하지 못했습니다: ${reason} 기본값 다시 반영을 눌러 저장본을 확인해주세요.` : reason);
      }
    }
    finally { if (id === requests.current) setLoading(false); }
  }, [endpoint, view, changes, conflicts, selectedOption, labelRecovery]);
  const explicitRefreshBlocked = loading || operationBusy || splitBusy || splitDrafting || Boolean(labelRecovery) && (dirty || conflicts.length > 0);
  useEffect(() => {
    explicitRefreshAction.current = explicitRefreshBlocked ? null : { endpoint, view, optionId: selectedOption, changes, conflicts, recovery: labelRecovery, run: () => refresh() };
    return () => { explicitRefreshAction.current = null; };
  }, [explicitRefreshBlocked, endpoint, view, selectedOption, changes, conflicts, labelRecovery, refresh]);
  function refreshExplicitly() {
    const current = explicitRefreshAction.current;
    if (!current || activeWrite.current || current.endpoint !== endpoint || current.view !== view || current.optionId !== selectedOption
      || current.changes !== changes || current.conflicts !== conflicts || current.recovery !== labelRecovery) return;
    explicitRefreshAction.current = null;
    void current.run();
  }
  useEffect(() => {
    if (observedRefresh.current === refreshToken || busy || loading) return;
    observedRefresh.current = refreshToken;
    void Promise.resolve().then(() => refresh());
  }, [refreshToken, refresh, busy, loading]);
  useEffect(() => {
    const focus = () => { if (view && !busy && !loading) void refresh(); };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [view, busy, loading, refresh]);

  function edit(fieldKey: string, value: string | null, optionId: string | null = selectedOption) {
    if (!view || busy || loading || !view.resolved.rows.some(row => row.optionId === optionId)) return;
    const field = view.resolved.schema.fields.find(field => field.id === fieldKey);
    if (typeof value === 'string' && field && isPackagedDimensionsMmField(field)) value = normalizePackagedDimensionsMm(value);
    let fieldKeys: string[];
    try { fieldKeys = [...new Set(quotationPackagedWeightEditFields(view.resolved.schema.fields, fieldKey, value).flatMap(key => quotationPriceEditFields(view.resolved.schema.fields, key)))]; }
    catch (cause) { setError(cause instanceof Error ? cause.message : '가격 항목 연결을 확인해주세요.'); return; }
    setChanges(previous => fieldKeys.reduce((draft, id) => updateQuotationEditorDraft(view.overrides, draft, { fieldKey: id, optionId, value }), previous));
    setConflicts(previous => previous.filter(conflict => !fieldKeys.some(id => conflict.key === quotationEditorKey(optionId, id))));
    setBulk(null); setMessage('');
  }
  function resolveConflict(key: string, choice: 'draft' | 'saved') {
    if (!view || busy || loading) return;
    const resolved = resolveQuotationEditorConflict(view, changes, conflicts, key, choice);
    setChanges(resolved.changes); setConflicts(resolved.conflicts); setBulk(null);
  }
  async function save() {
    if (!view || !changes.length || conflicts.length || busy || loading || activeWrite.current || !view.resolved.rows.some(row => row.optionId === selectedOption)) return;
    const current = modelActionState.current;
    if (current.view !== view || current.changes !== changes || current.selectedOption !== selectedOption || current.applyAll !== applyAll || current.busy || current.loading || current.conflicts.length) return;
    const controller = new AbortController(); activeWrite.current=controller;
    setBusy(true); setError(''); setMessage(''); setBulk(null);
    try {
      const plan = quotationSavePlan(view, changes, selectedOption, applyAll);
      const requested = validateQuotationChanges(plan.changes, { schema: view.resolved.schema, optionIds: view.resolved.rows.flatMap(item => item.optionId === null ? [] : [item.optionId]), ownedImageKeys: view.imageKeys, overrides: view.overrides });
      const response = await fetch(endpoint, { method: 'PUT', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes: requested }) });
      const body = await response.json() as QuotationFieldsView & { error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok || !body.resolved || !body.automatic) {
        if (response.status === 409) { await refresh(false,true); if(controller.signal.aborted)return; setError(body.error || '저장 중 원본이 바뀌었습니다. 현재 입력을 보존했습니다. 최신 값을 검토한 뒤 다시 저장해주세요.'); return; }
        throw new Error(body.error || '견적 입력을 저장하지 못했습니다.');
      }
      verifyQuotationRegistrationDisplay(body);
      const readback = quotationFieldsSaveNeedsReadback(view, requested) ? await fetchView(endpoint, controller.signal) : undefined;
      if (controller.signal.aborted) return;
      const confirmed = confirmQuotationFieldsSave(view, body, requested, readback);
      setView(confirmed); setChanges([]); setConflicts([]); setApplyAll(false); setMessage(`견적 입력 저장 완료${plan.propagated.length ? ` · 다른 옵션 ${new Set(plan.propagated.map(item => item.optionId)).size}개에도 적용했습니다.` : ' · 출력 미리보기에 반영됩니다.'}`); onSaved?.();
    } catch (cause) { if(!controller.signal.aborted)setError(cause instanceof Error ? cause.message : '견적 입력 저장 실패'); }
    finally { if(activeWrite.current===controller)activeWrite.current=null; if(!controller.signal.aborted)setBusy(false); }
  }
  const schema = view?.resolved.schema;
  const row = view?.resolved.rows.find(item => item.optionId === selectedOption);
  function openSection(section: (typeof sections)[number]['id'], fieldId?: string, deferFocus = false) {
    setActive(section);
    const visibleField = fieldId && schema ? quotationPriceDisplayField(schema.fields, fieldId) : fieldId;
    const target = document.getElementById(visibleField ? `${prefix}-${visibleField}` : `${prefix}-section-${section}`);
    pendingFocus.current = fieldId && (deferFocus || !target) ? visibleField ?? null : null;
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (fieldId && !deferFocus) target?.focus({ preventScroll: true });
  }
  const counts = view ? quotationSectionProgress(view, changes, selectedOption) : [];
  const allIssues = view && schema ? schema.fields.flatMap(field => quotationEditorIssues(field, resolveQuotationEditorCell(view, changes, selectedOption, field.id), view.imageKeys).map(issue => ({ field, issue }))) : [];
  const missingRequired = view && schema ? quotationEditorRequiredSummary(view, changes, selectedOption).missing.length : 0;
  const optionCount = view?.resolved.rows.filter(item => item.optionId !== null).length ?? 0;
  const optionLimitIssue = view && schema ? quotationOptionLimitIssue(schema, view.resolved.rows.filter(item => item.optionId !== null && item.included).length) : null;
  const packagingReconfirmation=view?quotationPackagingReconfirmationChanges(view,selectedOption):[];
  let hasInvalidDraft = false; let invalidDraftMessage = '';
  let savePlan: ReturnType<typeof quotationSavePlan> = { changes: [], propagated: [] };
  if (view && changes.length) try { savePlan = quotationSavePlan(view, changes, selectedOption, applyAll); validateQuotationChanges(savePlan.changes, { schema: view.resolved.schema, optionIds: view.resolved.rows.flatMap(item => item.optionId === null ? [] : [item.optionId]), ownedImageKeys: view.imageKeys, overrides: view.overrides }); } catch (cause) { hasInvalidDraft = true; invalidDraftMessage = cause instanceof Error ? cause.message : '수정한 필드의 입력 오류를 확인해주세요.'; }

  return <section className="quotation-fields" aria-busy={loading || operationBusy || splitBusy} data-workspace-dirty={dirty || splitDrafting} data-workspace-saving={operationBusy || splitBusy}>
    <div className="quotation-fields-heading"><div><h3>카테고리별 견적 입력</h3><p>저장 자료를 자동으로 채우고, 필요한 항목만 직접 수정합니다.</p></div><button type="button" className="btn ghost" disabled={explicitRefreshBlocked} onClick={refreshExplicitly}>기본값 다시 반영</button></div>
    {loading && <p role="status">최신 견적 입력을 확인하는 중입니다.</p>}
    {error && <p role="alert" className="collection-error">{error}</p>}
    {message && <p role="status" className="quotation-fields-notice">{message}</p>}
    {schema && <div className="quotation-fields-category"><strong>{schema.categoryPath.join(' › ') || '카테고리 미연결'}{schema.categoryId ? ` · ${schema.categoryId}` : ''}</strong>{schema.status !== 'observed' && <small>이 카테고리의 세부 규격은 미확인입니다.</small>}</div>}
    {view && <>
      {optionLimitIssue && <p className="quotation-fields-notice" role="alert">{optionLimitIssue}</p>}
      <div className="quotation-fields-toolbar"><label className="field"><span>편집할 옵션</span><select value={selectedOption ?? ''} disabled={loading || busy} onChange={event => { explicitRefreshAction.current = null; const next = event.target.value || null; modelActionState.current = { ...modelActionState.current, selectedOption: next }; setSelectedOption(next); setApplyAll(false); setBulk(null); }}>{!row && <option value={selectedOption ?? ''} disabled>선택한 옵션 없음 · 다시 선택해주세요</option>}{view.resolved.rows.map(item => <option key={item.optionId ?? 'common'} value={item.optionId ?? ''}>{item.optionId === null ? '상품 공통값' : `${optionRegistrationLabel(item.optionId,item.optionLabel,view.optionRegistrationNumbers)}${item.included ? '' : ' · 견적 제외'}`}</option>)}</select></label><small>{selectedOption === null ? '공통 수정은 별도로 수정하지 않은 옵션에도 적용됩니다. 옵션별 입력은 개별 값을 우선 사용합니다.' : '선택한 옵션만 수정합니다. 다른 옵션에도 같은 값을 넣으려면 항목을 선택한 뒤 적용 범위를 확인하세요.'}</small></div>
      <div className="quotation-fields-summary"><span>현재 옵션 필수 미입력 <b>{missingRequired}개</b></span><span>입력 확인 <b>{allIssues.length}건</b></span><span>미저장 수정 <b>{changes.length}개</b></span></div>
      <QuotationExposedDuplicates resolved={view.resolved} numbers={view.optionRegistrationNumbers} disabled={busy || loading || conflicts.length > 0}
        readValue={(optionId, fieldId) => resolveQuotationEditorCell(view, changes, optionId, fieldId).value}
        onOpen={(optionId, fieldId) => { explicitRefreshAction.current = null; setSelectedOption(optionId); setApplyAll(false); openSection('product', fieldId, optionId !== selectedOption); setBulk(null); }}/>
      {!view.resolved.rows.some(item => item.included) && <p className="quotation-fields-notice" role="alert">견적에 포함된 옵션이 없습니다. 옵션 설정에서 상품 옵션을 추가하거나 포함을 선택해주세요. 공통 입력은 보존되지만 견적서 출력 대상은 아닙니다.</p>}
      {!row && <p role="alert" className="quotation-fields-notice">선택한 옵션이 현재 상품에 없습니다. 공통값으로 자동 전환하지 않았습니다. 편집할 옵션을 다시 선택해주세요. 미저장 입력은 유지됩니다.</p>}
      {packagingReconfirmation.length>0&&<div className="quotation-fields-notice"><p>직접 입력한 포장값의 판매 구성 수량이 바뀌었습니다. 현재 구성의 실제 포장 무게·치수를 확인한 뒤 저장해주세요. 입력값은 그대로 유지됩니다.</p><button type="button" className="btn ghost" disabled={busy||loading||dirty||conflicts.length>0} onClick={()=>{
        if(busy||loading||dirty||conflicts.length||activeWrite.current)return;
        setChanges(packagingReconfirmation.map(change=>({...change})));setApplyAll(false);setBulk(null);setMessage('현재 구성의 포장값을 확인했습니다. 견적 입력 저장을 눌러 확인 기준을 함께 저장해주세요.');
      }}>현재 구성 포장값 확인·저장</button></div>}
      <nav className="quotation-fields-section-nav" aria-label="견적 입력 구역">{counts.map((section, index) => <button key={section.id} type="button" disabled={busy || loading} aria-pressed={active === section.id} onClick={() => openSection(section.id)}><b>{index + 1}</b><span>{section.title}</span><small>{section.complete}/{section.required} 필수 입력{section.invalid > 0 && ` · 확인 ${section.invalid}개`}</small></button>)}</nav>
      {conflicts.length > 0 && <div className="quotation-fields-notice" role="alert"><strong>다시 검토할 항목 {conflicts.length}개</strong><ul className="quotation-fields-conflicts">{conflicts.map(conflict => <li key={conflict.key}><strong>{schema?.fields.find(field => field.id === conflict.change.fieldKey)?.label ?? conflict.change.fieldKey} · {view.resolved.rows.find(item => item.optionId === conflict.change.optionId)?.optionLabel ?? '삭제된 옵션'}</strong>{conflict.schemaChanged && <p>카테고리 또는 항목 규격이 변경되었습니다. 같은 값이라도 새 양식에 맞는지 확인해주세요.</p>}{conflict.packagingChanged && <p>판매 구성 수량이 변경되었습니다. 같은 값이라도 현재 구성의 포장 무게·치수를 확인해주세요.</p>}<p>{conflict.unavailable ? '현재 카테고리 또는 옵션에 없는 입력입니다.' : `현재 저장값: ${conflict.saved === null ? '자동값 사용' : conflict.saved || '(공란)'}`}</p><p>내 입력: {conflict.change.value === null ? '수동 수정 해제' : conflict.change.value || '(공란)'}</p>{(conflict.linked?.length ?? 0) > 1 && <p>연결된 항목에도 같은 선택을 적용합니다.</p>}<div className="quote-actions">{!conflict.unavailable && <button type="button" className="btn ghost" disabled={busy || loading} onClick={() => resolveConflict(conflict.key, 'draft')}>내 입력 유지</button>}<button type="button" className="btn ghost" disabled={busy || loading} onClick={() => resolveConflict(conflict.key, 'saved')}>{conflict.unavailable ? '이 입력 제외' : '저장된 값 사용'}</button></div></li>)}</ul></div>}
      {row && sections.map((section, sectionIndex) => <fieldset key={section.id} id={`${prefix}-section-${section.id}`} data-section={section.id} className="quotation-fields-section" disabled={busy || loading} style={{ padding: 0, margin: 0, minWidth: 0 }}><header><h4>{sectionIndex + 1}. {section.english} Page ({section.title})</h4><small>* 필수 입력</small><p className="quotation-field-help" style={{ width: '100%' }}>{section.description}</p></header><div className="quotation-fields-grid">{quotationPriceVisibleFields(schema?.fields ?? []).filter(field => field.section === section.id).flatMap((field, fieldIndex, sectionFields) => {
        const cell = resolveQuotationEditorCell(view, changes, selectedOption, field.id);
        const automatic = view.automatic.rows.find(item => item.optionId === selectedOption)?.fields[field.id];
        const issues = quotationEditorIssues(field, cell, view.imageKeys);
        const id = `${prefix}-${field.id}`;
        const priceAliases = (schema?.fields ?? []).filter(item => item.id !== field.id && quotationPriceDisplayField(schema?.fields ?? [], item.id) === field.id);
        const ownManual = [field, ...priceAliases].some(item => draftManual(view, changes, selectedOption, item.id) !== null);
        const inheritedManual = selectedOption !== null && !ownManual && cell.source === 'manual-common';
        const weightManual = quotationPackagedWeightManual(view.resolved.schema.fields, field.id, selectedOption,
          (layer, key) => draftManual(view, changes, layer, key));
        const linkedWeight = weightManual && weightManual.fieldId !== field.id;
        const restoredWeight = ownManual && quotationPackagedWeightPeer(view.resolved.schema.fields, field.id)
          ? resolveQuotationEditorCell(view, updateQuotationEditorDraft(view.overrides, changes, { fieldKey: field.id, optionId: selectedOption, value: null }), selectedOption, field.id) : null;
        const editable = !field.readOnly; const imageKeys = imageValues(cell.value);
        const modelState = quotationModelSuggestionState(view.resolved.schema, field.id,
          (key, optionId = selectedOption) => resolveQuotationEditorCell(view, changes, optionId, key),
          { optionId: selectedOption, optionIds: view.resolved.rows.filter(item => item.included).map(item => item.optionId) });
        const modelSuggestion = modelState.suggestion;
        const manualModelState = quotationManualModelLinkState(view.resolved.schema, field.id,
          (key, optionId = selectedOption) => resolveQuotationEditorCell(view, changes, optionId, key),
          { optionId: selectedOption, optionIds: view.resolved.rows.filter(item => item.included).map(item => item.optionId) });
        const manualModelLink = manualModelState.link;
        const inputProps = { id, value: cell.value, readOnly: !editable, 'aria-invalid': quotationEditorValidation(field, cell, view.imageKeys).length > 0, 'aria-describedby': `${id}-notes`, onChange: (event: { target: { value: string } }) => edit(field.id, event.target.value) };
        const group = quotationFieldGroup(field, schema?.fields);
        const heading = group && (fieldIndex === 0 || quotationFieldGroup(sectionFields[fieldIndex - 1], schema?.fields) !== group) ? <h5 key={`group-${field.id}`} className="quotation-field-group">{group}</h5> : null;
        const priceMismatch = priceAliases.map(alias => ({ alias, cell: resolveQuotationEditorCell(view, changes, selectedOption, alias.id) })).filter(item => item.cell.value !== cell.value);
        return [heading, <div className={`quotation-field ${field.type === 'textarea' || field.type === 'images' ? 'wide' : ''}`} key={field.id}>
          <div className="quotation-field-heading"><label htmlFor={id}>{field.label}{field.unit ? ` (${field.unit})` : ''}{field.required && <b>*</b>}</label><div className="quotation-field-badges"><span className={`quotation-field-badge ${cell.source.startsWith('manual-') ? 'manual' : ''}`}>{sourceLabels[cell.source] ?? cell.source}</span>{field.workbookWire?.requirement==='conditional'&&<span className="quotation-field-badge">조건부 필수</span>}{field.visibility === 'exposed' && <span className="quotation-field-badge">노출 속성</span>}{field.visibility === 'hidden' && <span className="quotation-field-badge">비노출 속성</span>}{cell.needsReview && <span className="quotation-field-badge review">검토 필요</span>}</div></div>
          {field.type === 'select' && editable ? <QuotationChoiceInput field={field} cell={cell} id={id} disabled={busy || loading} invalid={inputProps['aria-invalid']} onChange={value => edit(field.id, value)}/>
            : field.type === 'textarea' || field.type === 'images' ? <textarea {...inputProps} rows={field.type === 'images' ? 2 : 3} placeholder={field.type === 'images' ? '아래에서 이 상품의 이미지 파일을 선택하세요.' : '확인한 내용을 입력하세요.'} />
              : <input {...inputProps} type="text" inputMode={field.type === 'number' ? 'decimal' : 'text'} placeholder={field.readOnly ? '' : hasCouplusEmptyAttributeDefault(field, cell) ? '해당사항없음' : '확인한 내용을 입력하세요.'} />}
          {modelSuggestion && <div className="quotation-field-auto">
            <small>출처: 현재 {selectedOption === null ? '공통' : '옵션'} 견적 상품명 · {sourceLabels[modelSuggestion.source] ?? modelSuggestion.source}</small>
            <p>상품명: {modelSuggestion.sourceTitle}</p><p>제안 모델명: {modelSuggestion.value}{modelSuggestion.shortened && ' · 앞 50자 이내'}</p>
            {modelSuggestion.peer && <p>공식 견적 {modelSuggestion.peer.label} · 현재 {modelSuggestion.peer.before || '(공란)'} ({sourceLabels[modelSuggestion.peer.source] ?? modelSuggestion.peer.source}) → {modelSuggestion.peer.changed ? `같은 제안값으로 함께 입력: ${modelSuggestion.value}` : '이미 같은 값 · 기존 입력 유지'}</p>}
            <button type="button" className="quotation-field-text-button" disabled={busy || loading || conflicts.length > 0} onClick={() => {
              if (busy || loading || conflicts.length || activeWrite.current) return;
              setChanges(previous => {
                const suggestion = quotationModelSuggestionState(view.resolved.schema, field.id,
                  (key, optionId = selectedOption) => resolveQuotationEditorCell(view, previous, optionId, key),
                  { optionId: selectedOption, optionIds: view.resolved.rows.filter(item => item.included).map(item => item.optionId) }).suggestion;
                return suggestion ? suggestion.changes.reduce((draft, change) => updateQuotationEditorDraft(view.overrides, draft,
                  { ...change, optionId: selectedOption }), previous) : previous;
              });
              setApplyAll(false); setBulk(null); setMessage('');
            }}>상품명으로 모델명 입력</button>
            <small>별도 모델명이 없는 상품일 때만 확인하고 적용하세요. 현재 편집 범위의 견적 초안에만 반영하며 다른 옵션 일괄 적용 선택은 해제합니다. 견적 입력 저장을 눌러 확정합니다.</small>
          </div>}
          {modelState.reason && <p className="quotation-field-help">{modelState.reason}</p>}
          {manualModelLink && <div className="quotation-field-auto">
            <small>현재 {selectedOption === null ? '공통' : '옵션'} 모델명 · {sourceLabels[manualModelLink.source] ?? manualModelLink.source}</small>
            <p>입력한 모델명: {manualModelLink.value}</p>
            <p>공식 견적 {manualModelLink.peer.label} · 현재 {manualModelLink.peer.before || '(공란)'} ({sourceLabels[manualModelLink.peer.source] ?? manualModelLink.peer.source}) → {manualModelLink.value}</p>
            <button type="button" className="quotation-field-text-button" disabled={busy || loading || conflicts.length > 0} onClick={() => {
              const current = modelActionState.current;
              if (current.view !== view || current.selectedOption !== selectedOption || current.busy || current.loading || current.conflicts.length || activeWrite.current) return;
              setChanges(previous => {
                const link = quotationManualModelLinkState(view.resolved.schema, field.id,
                  (key, optionId = selectedOption) => resolveQuotationEditorCell(view, previous, optionId, key),
                  { optionId: selectedOption, optionIds: view.resolved.rows.filter(item => item.included).map(item => item.optionId) }).link;
                return link ? link.changes.reduce((draft, change) => updateQuotationEditorDraft(view.overrides, draft,
                  { ...change, optionId: selectedOption }), previous) : previous;
              });
              setApplyAll(false); setBulk(null); setMessage('');
            }}>입력한 모델명을 공식 모델명/품번에 적용</button>
            <small>위 두 값이 같은 실제 모델인지 확인한 뒤 적용하세요. 현재 편집 범위의 견적 초안에만 반영하며 다른 옵션 일괄 적용 선택은 해제합니다. 견적 입력 저장을 눌러 확정합니다.</small>
          </div>}
          {manualModelState.reason && <p className="quotation-field-help">{manualModelState.reason}</p>}
          {field.type === 'images' && <><div className="quotation-fields-image-list">{view.imageKeys.map((key, index) => <button className="quotation-fields-image-choice" key={key} type="button" disabled={!editable} aria-pressed={imageKeys.includes(key)} aria-label={`이미지 ${index + 1} ${imageKeys.includes(key) ? '연결 해제' : '연결'}`} onClick={() => edit(field.id, (imageKeys.includes(key) ? imageKeys.filter(item => item !== key) : field.maxItems === 1 ? [key] : [...imageKeys, key]).join('\n'))}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files/${key.split('/').map(encodeURIComponent).join('/')}`} alt={`업로드 이미지 ${index + 1}`} loading="lazy" /><span>이미지 {index + 1}</span>{imageKeys.includes(key) && <b>{imageKeys.indexOf(key) + 1}</b>}</button>)}</div>{imageKeys.length > 0 && <div className="quotation-fields-image-selected">{imageKeys.map((key, index) => <div key={key}><span>{index + 1}. {view.imageKeys.includes(key) ? `이미지 ${view.imageKeys.indexOf(key) + 1}` : `연결 확인: ${key}`}</span><button type="button" disabled={!editable || index === 0} aria-label={`${index + 1}번 이미지 앞으로`} onClick={() => { const next = [...imageKeys]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; edit(field.id, next.join('\n')); }}>↑</button><button type="button" disabled={!editable || index === imageKeys.length - 1} aria-label={`${index + 1}번 이미지 뒤로`} onClick={() => { const next = [...imageKeys]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; edit(field.id, next.join('\n')); }}>↓</button><button type="button" disabled={!editable} onClick={() => edit(field.id, imageKeys.filter(item => item !== key).join('\n'))}>제외</button></div>)}</div>}</>}
          <div id={`${id}-notes`}>{modelSuggestion ? <p className="quotation-field-help">별도 모델명이 있으면 해당 값을 입력하세요. 모델명이 없는 상품에 한해 위 상품명과 제안값을 확인한 뒤 직접 적용할 수 있습니다.</p> : 'help' in field && field.help ? <p className="quotation-field-help">{String(field.help)}</p> : null}{priceMismatch.map(item => <p key={item.alias.id} className="quotation-field-issue">이전 요약 가격 {quotationFieldDisplay(item.alias, item.cell, '(공란)')}과 Supplier Hub 가격이 다릅니다. 저장값은 유지했습니다. 이 금액을 직접 입력하면 두 항목에 함께 반영합니다.</p>)}{issues.map(issue => <p key={issue} className="quotation-field-issue">{issue}</p>)}</div>
          {ownManual && <div className="quotation-field-auto">{restoredWeight ? `수정 해제 후 ${sourceLabels[restoredWeight.source]}: ${quotationFieldDisplay(field, restoredWeight, '(미입력)')}` : selectedOption !== null && draftManual(view, changes, null, field.id) !== null ? `수정 해제 후 공통값: ${quotationFieldDisplay(field, {value:draftManual(view, changes, null, field.id)!,source:'manual-common'})}` : `자동값 (${sourceLabels[automatic?.source ?? 'empty'] ?? '저장 자료'}): ${quotationFieldDisplay(field, automatic ?? {value:'',source:'empty'}, '(미입력)')}`}</div>}
          <div className="quotation-field-footer"><div>{editable && ownManual && <button type="button" className="quotation-field-text-button" onClick={() => edit(field.id, null)}>{restoredWeight ? restoredWeight.source.startsWith('manual-') ? '수정 해제 · 연결값 사용' : '수정 해제 · 자동값 복원' : selectedOption !== null && draftManual(view, changes, null, field.id) !== null ? '수정 해제 · 공통값 사용' : '수정 해제 · 자동값 복원'}</button>}{linkedWeight ? <small>연결된 포장 무게의 {weightManual.source === 'manual-option' ? '옵션' : '공통'} 입력값을 따릅니다.</small> : inheritedManual && <small>공통값을 따릅니다. 여기서 입력하면 이 옵션만 바뀝니다.</small>}{field.minLength !== undefined && field.minLength > 0 && <small> 최소 {field.minLength}자</small>}{field.maxLength !== undefined && <small> {quotationValueLength(field, cell.value)}/{field.maxLength}자</small>}</div>{editable && optionCount > 0 && <label className="quotation-field-select-copy"><input type="checkbox" checked={selectedFields.includes(field.id)} onChange={event => { setSelectedFields(previous => event.target.checked ? [...previous, field.id] : previous.filter(key => key !== field.id)); setBulk(null); }} />다른 옵션에 적용</label>}</div>
        </div>];
      })}</div></fieldset>)}
      <div className="quotation-fields-actions">{selectedOption !== null && row && optionCount > 1 && <label className="quotation-apply-all"><input type="checkbox" role="switch" checked={applyAll} disabled={busy || loading} onChange={event => {
        const current = modelActionState.current;
        if (current.view !== view || current.selectedOption !== selectedOption || current.busy || current.loading || activeWrite.current) return;
        modelActionState.current = { ...current, applyAll: event.target.checked };
        setApplyAll(event.target.checked);
      }}/>모든 옵션에 적용</label>}<small>입력 v{view.revision} · 작성 중에도 저장할 수 있습니다.<br />수동 수정값은 기본값이 바뀌어도 유지됩니다.</small><div><button type="button" className="btn ghost" disabled={busy || loading || !dirty} onClick={() => void refresh(true)}>입력 버리고 저장본 불러오기</button><button type="button" className="btn primary" disabled={busy || loading || !dirty || !row || conflicts.length > 0 || hasInvalidDraft} onClick={() => void save()}>{operationBusy ? '저장 중…' : `견적 입력 저장${dirty ? ` (${savePlan.changes.length || changes.length})` : ''}`}</button></div></div>
      {applyAll && <div className="quotation-fields-bulk" role="status"><p>현재 옵션에서 수정한 항목을 견적 제외 옵션까지 모든 옵션에 적용합니다. 대상의 같은 항목에 직접 입력한 값이 있으면 바뀝니다. 수정하지 않은 항목과 옵션의 견적 포함 여부는 유지됩니다.</p><strong>다른 옵션 {new Set(savePlan.propagated.map(item => item.optionId)).size}개 · {savePlan.propagated.length}개 값 적용 예정</strong>{savePlan.propagated.length > 0 && <details><summary>함께 저장할 변경 내용</summary><div className="quotation-fields-bulk-table"><table><thead><tr><th>옵션 / 항목</th><th>현재 입력</th><th>저장할 값</th></tr></thead><tbody>{savePlan.propagated.map(item => <tr key={quotationEditorKey(item.optionId,item.fieldKey)}><td>{item.optionLabel}{!item.included && ' · 견적 제외'}<br/>{item.label}</td><td>{item.before}</td><td>{item.after}</td></tr>)}</tbody></table></div></details>}</div>}
      {row && optionCount > 0 && selectedFields.length > 0 && <div className="quotation-fields-bulk"><strong>선택한 {selectedFields.length}개 항목 · 옵션별 일괄 작업</strong><p>선택한 항목의 현재 값을 복사합니다. 미입력 항목은 제외하여 대상 옵션의 값과 자동 연동을 유지합니다. 적용 대상의 기존 수동값도 바뀌며, 복사한 값은 이후 기본값 변경을 자동으로 따르지 않습니다.</p><label className="quotation-field-select-copy"><input type="checkbox" checked={includedOnly} disabled={busy || loading} onChange={event => { setIncludedOnly(event.target.checked); setBulk(null); }} />견적에 포함된 옵션만 적용</label><div className="quote-actions"><button type="button" className="btn ghost" disabled={busy || loading} onClick={() => { setSelectedFields([]); setBulk(null); }}>항목 선택 해제</button><button type="button" className="btn ghost" disabled={busy || loading || conflicts.length > 0} onClick={() => { try { setBulk(previewQuotationEditorBulk(view, changes, selectedOption, selectedFields, includedOnly)); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : '적용 범위 확인 실패'); } }}>적용 범위 미리보기</button><button type="button" className="btn ghost" disabled={busy || loading || conflicts.length > 0} onClick={() => { try { setBulk(previewQuotationEditorRestore(view, changes, selectedFields, includedOnly)); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : '복원 범위 확인 실패'); } }}>공통·자동 연동 복원 미리보기</button></div><p>연동 복원은 현재 옵션을 포함한 대상 옵션의 선택 항목에서 수동 수정만 해제합니다. 공통 수정값이 있으면 공통값을, 없으면 저장 자료의 자동값을 따릅니다. 선택하지 않은 항목과 공통 수정값은 유지됩니다.</p>{bulk && <>{bulk.skipped && bulk.skipped.length > 0 && <ul>{bulk.skipped.map(item => <li key={item}>{item}</li>)}</ul>}{bulk.mode === 'restore' && <p role="status">수동 수정 해제 예정입니다. 값이 같아도 이후 공통·자동값 변경을 따라가게 됩니다. 직접 비워둔 값도 복원 대상에 포함됩니다.</p>}<strong>{new Set(bulk.rows.map(item => item.optionId)).size}개 옵션 · {bulk.rows.length}개 값 변경 예정</strong><div className="quotation-fields-bulk-table"><table><thead><tr><th>옵션 / 항목</th><th>현재 값</th><th>적용할 값</th></tr></thead><tbody>{bulk.rows.map(item => <tr key={quotationEditorKey(item.optionId, item.fieldKey)}><td>{item.optionLabel}<br />{item.label}</td><td>{item.beforeDisplay}{item.manualBefore ? '\n직접 수정한 값' : '\n자동값 사용 중'}</td><td>{item.afterDisplay}</td></tr>)}</tbody></table></div>{!bulk.rows.length && <p>현재 선택에서 바뀌는 옵션이 없습니다.</p>}<div className="quote-actions"><button type="button" className="btn ghost" onClick={() => setBulk(null)}>취소</button><button type="button" className="btn primary" disabled={!bulk.rows.length || busy || loading} onClick={() => { try { setChanges(applyQuotationEditorBulk(view, changes, bulk)); setBulk(null); setMessage('옵션별 입력에 반영했습니다. 저장 버튼을 눌러 확정하세요.'); } catch (cause) { setError(cause instanceof Error ? cause.message : '미리보기를 다시 확인해주세요.'); } }}>확인한 범위에 적용</button></div></>}</div>}
      {(view.resolved.issues.length > 0 || allIssues.length > 0) && <details className="quotation-fields-notice"><summary>입력·검토 안내 {view.resolved.issues.length + allIssues.length}건</summary><ul>{view.resolved.issues.map((issue, index) => <li key={`global-${index}`}>{issue}</li>)}{allIssues.map(({ field, issue }, index) => <li key={`${field.id}-${index}`}><button type="button" className="quotation-field-text-button" disabled={busy || loading} onClick={() => openSection(field.section, field.id)}>{field.label}</button>: {issue}</li>)}</ul></details>}
      {hasInvalidDraft && <p className="quotation-field-issue" role="status">{invalidDraftMessage} 필수 항목의 공란은 작성 중 상태로 저장할 수 있습니다.</p>}
      <details className="quotation-supplemental-tools"><summary>추가 견적 작업</summary>
      <QuotationOptionOverview view={view} changes={changes} disabled={busy || loading} onOpen={(optionId, section, fieldId) => { explicitRefreshAction.current = null; setSelectedOption(optionId); setApplyAll(false); openSection(section, fieldId, optionId !== selectedOption); setBulk(null); }}/>
      <ProductOptionSplitPanel productId={productId} profileId={profileId} view={view} disabled={dirty || operationBusy || Boolean(labelRecovery) || loading || conflicts.length > 0}
        onBusyChange={next => { if (next) explicitRefreshAction.current = null; setSplitBusy(next); }} onDraftChange={next => { if (next) explicitRefreshAction.current = null; setSplitDrafting(next); }} onCommitted={() => { onSaved?.(); void refresh(); }} />
      <QuotationAiPanel productId={productId} profileId={profileId} view={view} optionId={selectedOption} disabled={dirty || busy || loading || conflicts.length > 0}
        onBusyChange={next=>{if(next)explicitRefreshAction.current=null;modelActionState.current={...modelActionState.current,busy:next||Boolean(labelRecovery)};setBusy(next);}}
        onApply={proposals=>{
          const current=modelActionState.current;
          if(current.view!==view||current.busy||current.loading||current.conflicts.length||changes.length||aiDraftApplied.current||activeWrite.current)return;
          const requested=validateQuotationChanges(proposals,{schema:view.resolved.schema,optionIds:view.resolved.rows.flatMap(item=>item.optionId===null?[]:[item.optionId]),ownedImageKeys:view.imageKeys,overrides:view.overrides});
          const nextDraft=requested.reduce((draft,change)=>updateQuotationEditorDraft(view.overrides,draft,change),[] as QuotationEditorChange[]);
          aiDraftApplied.current=nextDraft.length>0;
          setChanges(nextDraft);
          setApplyAll(false);setBulk(null);setMessage('검토한 AI 초안을 입력란에 반영했습니다. 확인·수정한 뒤 견적 입력 저장을 눌러주세요.');
        }}/>
      <QuotationWorkbookReview key={`workbook:${JSON.stringify([view.revision, view.inputFingerprint, changes])}`} view={view} changes={changes} disabled={busy || loading || conflicts.length > 0} onApply={(selections, basis) => {
        const current = modelActionState.current;
        if (current.view !== view || current.changes !== changes || current.busy || current.loading || current.conflicts.length || activeWrite.current) return false;
        try {
          const next = importQuotationWorkbookDraft(view, changes, selections, basis);
          modelActionState.current = { ...current, changes: next, applyAll: false };
          setChanges(next); setApplyAll(false); setBulk(null); setError('');
          setMessage('선택한 이전 Excel 입력을 해당 공통·옵션의 편집 초안에 가져왔습니다. 모든 옵션에 적용을 껐습니다. 확인·수정 후 견적 입력 저장을 눌러주세요.');
          return true;
        } catch (cause) { setError(cause instanceof Error ? cause.message : '이전 Excel 입력을 확인해주세요.'); return false; }
      }}/>
      <LegacyQuotationImport key={`legacy:${JSON.stringify([view.revision, view.inputFingerprint, changes])}`} view={view} changes={changes} disabled={busy || loading || conflicts.length > 0} onApply={keys => {
        try { setChanges(importLegacyQuotationDraft(view, changes, keys)); setBulk(null); setError(''); setMessage('선택한 이전 입력을 초안에 반영했습니다. 현재 분류에 저장하려면 견적 입력 저장을 눌러주세요.'); }
        catch (cause) { setError(cause instanceof Error ? cause.message : '이전 입력을 확인해주세요.'); }
      }}/>
      {row && <QuotationTranslatedAttributes key={`translation:${view.inputFingerprint}:${view.revision}:${selectedOption??'common'}`} productId={productId} view={view} optionId={selectedOption} disabled={dirty || loading || busy || conflicts.length > 0} onApply={items=>items.forEach(item=>edit(item.fieldKey,item.value,item.optionId))} />}
      {row && <QuotationLabelPanel key={`${view.inputFingerprint}:${view.revision}:${selectedOption??'common'}`} view={view} productId={productId} endpoint={endpoint} optionId={selectedOption} disabled={dirty || loading || busy || conflicts.length > 0} batchCache={labelBatchCache} uploadCache={labelUploadCache} onBusyChange={next=>{if(next)explicitRefreshAction.current=null;setBusy(next);}} onFailed={async message=>{setLabelRecovery(message);setMessage('');onSaved?.();await refresh(false,false,message);}} onAttached={(saved,batch)=>{setView(saved);setMessage(batch?.stopped ? `라벨 ${batch.completed}/${batch.total}건을 저장하고 중지했습니다. 저장 결과를 반영했으며 전체 생성·연결을 다시 누르면 이어서 진행합니다.` : '표시사항 PNG를 처리한 옵션의 라벨 이미지에 추가했습니다. 기존 첨부는 유지했습니다.');onSaved?.();}} />}
      </details>
      {schema && <details className="quotation-source-evidence"><summary>견적 양식 확인 정보</summary><p>{schema.evidence}</p></details>}
      <details className="quotation-submission-tools"><summary>저장한 견적 검토·전송</summary><p>견적 입력을 저장한 뒤 자료를 검토하고 전송을 준비하세요.</p>
      <SupplierHubSingleReview productId={productId} profileId={profileId} view={view} disabled={!submissionActive || dirty || busy || loading || conflicts.length > 0} onReceiptSaved={onReceiptSaved} primaryProduct={true}/>
      </details>
    </>}
  </section>;
}
