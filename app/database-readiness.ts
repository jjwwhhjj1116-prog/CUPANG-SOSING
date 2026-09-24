// Check table availability without reading product data or mutating the database.
export const requiredDatabaseTables = [
  'products', 'workspace_settings', 'product_price_policy', 'collection_jobs',
  'collection_context', 'category_profiles', 'product_content', 'product_options',
  'product_automation', 'product_automation_receipts', 'product_automation_history',
  'translation_jobs', 'image_jobs', 'product_quotation_fields', 'collection_results',
  'collection_products', 'collection_images',
] as const;

export async function inspectDatabaseTables(database: D1Database) {
  const result = await database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{name: string}>();
  if (!result.success || !Array.isArray(result.results)) throw new Error('Database inspection failed');
  const names = new Set(result.results.map(row => row.name));
  const missingTables = requiredDatabaseTables.filter(name => !names.has(name));
  return { status: missingTables.length ? 'missing_tables' : 'tables_present', missingTables };
}
