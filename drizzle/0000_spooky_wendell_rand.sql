CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`source_url` text NOT NULL,
	`title` text NOT NULL,
	`source_price_cny` real NOT NULL,
	`exchange_rate` real NOT NULL,
	`supply_margin` real NOT NULL,
	`coupang_margin` real NOT NULL,
	`supply_price` integer NOT NULL,
	`sale_price` integer NOT NULL,
	`msrp` integer NOT NULL,
	`options_count` integer DEFAULT 1 NOT NULL,
	`seo_status` text DEFAULT '대기' NOT NULL,
	`image_status` text DEFAULT '대기' NOT NULL,
	`quote_status` text DEFAULT '대기' NOT NULL,
	`registration_status` text DEFAULT '수집완료' NOT NULL,
	`supplier_hub_status` text DEFAULT '미전송' NOT NULL,
	`image_keys` text DEFAULT '[]' NOT NULL,
	`goal_stage` text DEFAULT 'price' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_products_owner_updated` ON `products` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_products_owner_status` ON `products` (`owner_id`,`registration_status`);--> statement-breakpoint
CREATE TABLE `workspace_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL
);
