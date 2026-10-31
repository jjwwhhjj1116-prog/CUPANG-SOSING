import type {UnexpectedLegalAuditLeafDifferences} from '../extensions/supplier-hub/unexpected-legal-audit.mjs';

export type NativeSerializationPattern = 'optional-form-key-omission' | 'empty-detail-html-to-null' | 'empty-size-chart-slot' | 'later-option-empty-sourcing' | 'empty-attribute-template-fallback';
export type NativeSerializationDiagnostics = Readonly<{
  patterns: readonly (NativeSerializationPattern | null)[];
  patternCount: number;
  unclassifiedCount: number;
}>;

// Diagnostic coverage only; this is not a body normalizer or qualification.
// Original captured schema SHA was checked read-only in Step886. Parent object
// examples/defaults are absent, and osrp/productNoticeName are optional.
// The one unexposed array example has 15 unique exact named rows in schema
// order. The six covered rows have string values and no enum/dropdown/default;
// Uf resets their templates to '', then getSortAttributes maps a null to ''.
// Official main SHA 6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11:
// model [2857628,2863804), schema [2852469,2855343), requiredOnly [1084892,1087560).
// REA ev_896f9c6962c3525ff1ab586edb52dc9b3fe34aaf0cb19a0248329f205c029443.
const COVERED_SCHEMA = 'f675549f02d67d903a82e28ba4ba116ee1a96f7740558431b3a0ce4cbfd47e10';

/** Describe only known structural patterns in an already validated, source-bound
 * audit. An omitted nonempty field still needs review. No raw value is copied,
 * no differences are removed, and no comparison or transport state is changed.
 * Unknown schemas and unproven nullable attribute templates have no coverage. */
export function nativeSerializationDiagnostics(schemaSha256: string, leaf: UnexpectedLegalAuditLeafDifferences | undefined): NativeSerializationDiagnostics | null {
  if (schemaSha256 !== COVERED_SCHEMA || !leaf || leaf.format !== 'yoofam-saved-body-leaf-differences-v1' || !Array.isArray(leaf.rows) || leaf.rows.length < 1 || leaf.rows.length > 80) return null;
  const patterns = leaf.rows.map(row => {
    const p = row.path;
    if (!Array.isArray(p) || p[0] !== 'jsonDocument' || !Number.isSafeInteger(p[1]) || typeof p[1] !== 'number' || p[1] < 0 || p[1] >= 200) return null;
    const path = p.slice(2).join('.');
    if ((path === 'productPage.commonAttributes.osrp' || path === 'legalPage.productNoticeName')
      && row.expectedType === 'string' && row.expectedValueKind === 'present' && row.actualType === 'missing' && row.actualValueKind === 'missing') return 'optional-form-key-omission';
    if (path === 'imagePage.details.htmlProductDetailContent' && row.expectedType === 'string-empty' && row.expectedValueKind === 'empty'
      && row.actualType === 'null' && row.actualValueKind === 'present') return 'empty-detail-html-to-null';
    if (path === 'imagePage.images.sizeChartImage' && row.expectedType === 'missing' && row.expectedValueKind === 'missing'
      && row.actualType === 'string-empty' && row.actualValueKind === 'empty') return 'empty-size-chart-slot';
    if (p[1] > 0 && (path === 'sourcingPage.sourcingChannelId' || path === 'sourcingPage.sourcingChannelType')
      && row.expectedType === 'null' && row.expectedValueKind === 'present' && row.actualType === 'string-empty' && row.actualValueKind === 'empty') return 'later-option-empty-sourcing';
    if (p.length === 6 && p[2] === 'productPage' && p[3] === 'unexposedAttributes' && typeof p[4] === 'number' && [3,8,10,12,13,14].includes(p[4]) && p[5] === 'attributeValue'
      && row.expectedType === 'null' && row.expectedValueKind === 'present' && row.actualType === 'string-empty' && row.actualValueKind === 'empty') return 'empty-attribute-template-fallback';
    return null;
  });
  const patternCount = patterns.filter(Boolean).length;
  return Object.freeze({patterns: Object.freeze(patterns), patternCount, unclassifiedCount: patterns.length - patternCount});
}
