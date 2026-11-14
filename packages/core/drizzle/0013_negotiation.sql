CREATE TABLE `offer_events` (
	`id` text PRIMARY KEY NOT NULL,
	`offer_id` text NOT NULL,
	`by` text NOT NULL,
	`action` text NOT NULL,
	`units` real,
	`price_per_unit` integer,
	`channel` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `offer_events_offer_idx` ON `offer_events` (`offer_id`);--> statement-breakpoint
CREATE TABLE `offers` (
	`id` text PRIMARY KEY NOT NULL,
	`lot_id` text NOT NULL,
	`buyer_id` text NOT NULL,
	`farmer_id` text NOT NULL,
	`demand_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`turn` text,
	`units` real NOT NULL,
	`price_per_unit` integer NOT NULL,
	`proposed_by` text NOT NULL,
	`proposed_at` integer NOT NULL,
	`expires_at` integer,
	`held_demand_kg` real DEFAULT 0 NOT NULL,
	`contract_id` text,
	`reminder_sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`buyer_id`) REFERENCES `buyers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`farmer_id`) REFERENCES `farmers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`demand_id`) REFERENCES `demands`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `offers_lot_idx` ON `offers` (`lot_id`);--> statement-breakpoint
CREATE INDEX `offers_buyer_idx` ON `offers` (`buyer_id`);--> statement-breakpoint
CREATE INDEX `offers_farmer_idx` ON `offers` (`farmer_id`);--> statement-breakpoint
CREATE INDEX `offers_status_idx` ON `offers` (`status`);--> statement-breakpoint
ALTER TABLE `contracts` ADD `agreed_total` integer;--> statement-breakpoint
ALTER TABLE `demands` ADD `origin` text DEFAULT 'request' NOT NULL;--> statement-breakpoint
ALTER TABLE `lots` ADD `asking_price_per_unit` integer;--> statement-breakpoint
ALTER TABLE `lots` ADD `harvested_at` integer;--> statement-breakpoint
ALTER TABLE `lots` ADD `community` text;--> statement-breakpoint
ALTER TABLE `lots` ADD `landmark` text;--> statement-breakpoint
ALTER TABLE `lots` ADD `expires_at` integer;--> statement-breakpoint
ALTER TABLE `lots` ADD `expiry_warned_at` integer;--> statement-breakpoint
ALTER TABLE `voice_calls` ADD `offer_id` text REFERENCES offers(id);