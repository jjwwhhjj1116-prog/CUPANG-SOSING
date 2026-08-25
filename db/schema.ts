import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  sourceUrl: text('source_url').notNull(),
  title: text('title').notNull(),
  sourcePriceCny: real('source_price_cny').notNull(),
  exchangeRate: real('exchange_rate').notNull(),
  supplyMargin: real('supply_margin').notNull(),
  coupangMargin: real('coupang_margin').notNull(),
  supplyPrice: integer('supply_price').notNull(),
  salePrice: integer('sale_price').notNull(),
  msrp: integer('msrp').notNull(),
  optionsCount: integer('options_count').notNull().default(1),
  seoStatus: text('seo_status').notNull().default('대기'),
  imageStatus: text('image_status').notNull().default('대기'),
  quoteStatus: text('quote_status').notNull().default('대기'),
  registrationStatus: text('registration_status').notNull().default('수집완료'),
  supplierHubStatus: text('supplier_hub_status').notNull().default('미전송'),
  imageKeys: text('image_keys').notNull().default('[]'),
  goalStage: text('goal_stage').notNull().default('price'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_products_owner_updated').on(table.ownerId, table.updatedAt),
  index('idx_products_owner_status').on(table.ownerId, table.registrationStatus),
]);

export const workspaceSettings = sqliteTable('workspace_settings', {
  ownerId: text('owner_id').primaryKey(),
  payload: text('payload').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type ProductRow = typeof products.$inferSelect;
