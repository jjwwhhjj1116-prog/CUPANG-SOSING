// Check table availability without reading product data or mutating the database.
export const requiredDatabaseTables = [
  'products', 'workspace_settings', 'product_price_policy', 'collection_jobs',
  'collection_context', 'category_profiles', 'product_content', 'product_options',
  'product_automation', 'product_automation_receipts', 'product_automation_history',
  'translation_jobs', 'image_jobs', 'product_quotation_fields', 'collection_results',
  'collection_products', 'collection_images', 'quotation_attribute_rules', 'intake_drafts',
  'members', 'member_sessions', 'member_rate_limits', 'member_audit', 'supplier_hub_receipts', 'collection_source_supplements', 'managed_products', 'historical_ai_records', 'product_removals',
  'collection_offer_claims', 'product_labels', 'managed_import_prices',
  'supplier_hub_single_receipts',
  'detail_family_apply_operations', 'image_vision_requests', 'managed_product_history',
  'managed_purchase_info', 'managed_store_settings', 'member_connections', 'operations_workspaces',
  'product_detail_workspaces', 'product_option_split_members', 'product_option_split_operations',
  'product_registration_counters', 'product_registration_numbers', 'product_registration_options',
  'query_source_captures', 'quotation_ai_daily', 'quotation_ai_jobs',
  'source_inbox', 'source_inbox_captures', 'source_inbox_title_runs', 'source_inbox_titles',
] as const;

export async function inspectDatabaseTables(database: D1Database) {
  const result = await database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{name: string}>();
  if (!result.success || !Array.isArray(result.results)) throw new Error('Database inspection failed');
  const names = new Set(result.results.map(row => row.name));
  const missingTables = requiredDatabaseTables.filter(name => !names.has(name));
  return { status: missingTables.length ? 'missing_tables' : 'tables_present', missingTables };
}
