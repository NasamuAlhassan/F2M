CREATE TABLE `buyers` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text NOT NULL,
	`company` text,
	`phone` text,
	`momo_msisdn` text NOT NULL,
	`region_code` text,
	`gps_lat` real,
	`gps_lng` real,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`region_code`) REFERENCES `regions`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `buyers_email_idx` ON `buyers` (`email`);--> statement-breakpoint
CREATE TABLE `commodities` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name_key` text NOT NULL,
	`category` text NOT NULL,
	`clock_type` text NOT NULL,
	`clock_config` text NOT NULL,
	`active_rubric_version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commodities_code_idx` ON `commodities` (`code`);--> statement-breakpoint
CREATE TABLE `contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`demand_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`buyer_id` text NOT NULL,
	`farmer_id` text NOT NULL,
	`commodity_id` text NOT NULL,
	`quantity_kg` real NOT NULL,
	`price_terms` text NOT NULL,
	`hold_amount` integer NOT NULL,
	`display_currency` text DEFAULT 'GHS' NOT NULL,
	`settlement_currency` text DEFAULT 'GHS' NOT NULL,
	`state` text DEFAULT 'OFFERED' NOT NULL,
	`final_grade` text,
	`final_amount` integer,
	`decline_reason_key` text,
	`dispute_note` text,
	`funding_attempts` integer DEFAULT 0 NOT NULL,
	`accepted_at` integer,
	`funded_at` integer,
	`pickup_confirmed_at` integer,
	`graded_at` integer,
	`settled_at` integer,
	`closed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`demand_id`) REFERENCES `demands`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`buyer_id`) REFERENCES `buyers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`farmer_id`) REFERENCES `farmers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`commodity_id`) REFERENCES `commodities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contracts_match_idx` ON `contracts` (`match_id`);--> statement-breakpoint
CREATE INDEX `contracts_farmer_idx` ON `contracts` (`farmer_id`);--> statement-breakpoint
CREATE INDEX `contracts_buyer_idx` ON `contracts` (`buyer_id`);--> statement-breakpoint
CREATE INDEX `contracts_state_idx` ON `contracts` (`state`);--> statement-breakpoint
CREATE TABLE `demands` (
	`id` text PRIMARY KEY NOT NULL,
	`buyer_id` text NOT NULL,
	`commodity_id` text NOT NULL,
	`quantity_kg` real NOT NULL,
	`remaining_kg` real NOT NULL,
	`min_band` text NOT NULL,
	`price_terms` text NOT NULL,
	`window_start` integer NOT NULL,
	`window_end` integer NOT NULL,
	`region_code` text NOT NULL,
	`gps_lat` real,
	`gps_lng` real,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`buyer_id`) REFERENCES `buyers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`commodity_id`) REFERENCES `commodities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`region_code`) REFERENCES `regions`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `demands_buyer_idx` ON `demands` (`buyer_id`);--> statement-breakpoint
CREATE INDEX `demands_commodity_status_idx` ON `demands` (`commodity_id`,`status`);--> statement-breakpoint
CREATE TABLE `farmers` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`name` text NOT NULL,
	`region_code` text NOT NULL,
	`district` text,
	`gps_lat` real,
	`gps_lng` real,
	`momo_msisdn` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`region_code`) REFERENCES `regions`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `farmers_phone_idx` ON `farmers` (`phone`);--> statement-breakpoint
CREATE TABLE `gradings` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`rubric_id` text NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`grade_band` text,
	`confidence` real,
	`reasons` text,
	`raw_response` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rubric_id`) REFERENCES `rubrics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `gradings_contract_idx` ON `gradings` (`contract_id`);--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`journal_id` text NOT NULL,
	`account` text NOT NULL,
	`debit` integer DEFAULT 0 NOT NULL,
	`credit` integer DEFAULT 0 NOT NULL,
	`contract_id` text,
	`memo_key` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_journal_idx` ON `ledger_entries` (`journal_id`);--> statement-breakpoint
CREATE INDEX `ledger_account_idx` ON `ledger_entries` (`account`);--> statement-breakpoint
CREATE TABLE `lot_events` (
	`id` text PRIMARY KEY NOT NULL,
	`lot_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`payload` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lot_events_lot_seq_idx` ON `lot_events` (`lot_id`,`seq`);--> statement-breakpoint
CREATE TABLE `lots` (
	`id` text PRIMARY KEY NOT NULL,
	`lot_code` text NOT NULL,
	`farmer_id` text NOT NULL,
	`commodity_id` text NOT NULL,
	`quantity_kg` real NOT NULL,
	`remaining_kg` real NOT NULL,
	`unit_id` text NOT NULL,
	`unit_qty` real NOT NULL,
	`declared_band` text NOT NULL,
	`ready_date` integer NOT NULL,
	`asking_price_per_kg` integer,
	`region_code` text NOT NULL,
	`gps_lat` real,
	`gps_lng` real,
	`status` text DEFAULT 'registered' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`farmer_id`) REFERENCES `farmers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`commodity_id`) REFERENCES `commodities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`region_code`) REFERENCES `regions`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lots_code_idx` ON `lots` (`lot_code`);--> statement-breakpoint
CREATE INDEX `lots_farmer_idx` ON `lots` (`farmer_id`);--> statement-breakpoint
CREATE INDEX `lots_commodity_status_idx` ON `lots` (`commodity_id`,`status`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`demand_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`allocated_kg` real NOT NULL,
	`score` real NOT NULL,
	`score_breakdown` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`offered_at` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`demand_id`) REFERENCES `demands`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `matches_demand_idx` ON `matches` (`demand_id`);--> statement-breakpoint
CREATE INDEX `matches_lot_idx` ON `matches` (`lot_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`direction` text NOT NULL,
	`provider` text NOT NULL,
	`provider_ref` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`counterparty_msisdn` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`raw` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_provider_ref_idx` ON `payments` (`provider_ref`);--> statement-breakpoint
CREATE INDEX `payments_contract_idx` ON `payments` (`contract_id`);--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`lot_id` text NOT NULL,
	`contract_id` text,
	`grading_id` text,
	`path` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`grading_id`) REFERENCES `gradings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `photos_lot_idx` ON `photos` (`lot_id`);--> statement-breakpoint
CREATE INDEX `photos_contract_idx` ON `photos` (`contract_id`);--> statement-breakpoint
CREATE TABLE `regions` (
	`code` text PRIMARY KEY NOT NULL,
	`name_key` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rubrics` (
	`id` text PRIMARY KEY NOT NULL,
	`commodity_id` text NOT NULL,
	`version` integer NOT NULL,
	`doc` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`commodity_id`) REFERENCES `commodities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rubrics_commodity_version_idx` ON `rubrics` (`commodity_id`,`version`);--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`commodity_id` text NOT NULL,
	`code` text NOT NULL,
	`name_key` text NOT NULL,
	`kg_per_unit` real NOT NULL,
	`is_informal` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`commodity_id`) REFERENCES `commodities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `units_commodity_code_idx` ON `units` (`commodity_id`,`code`);--> statement-breakpoint
CREATE TABLE `ussd_sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`screen` text NOT NULL,
	`ctx` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL
);
