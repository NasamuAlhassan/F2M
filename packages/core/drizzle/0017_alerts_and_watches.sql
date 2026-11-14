CREATE TABLE `alert_log` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`recipient` text NOT NULL,
	`subject` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alert_log_once_idx` ON `alert_log` (`kind`,`recipient`,`subject`);--> statement-breakpoint
CREATE INDEX `alert_log_recipient_idx` ON `alert_log` (`recipient`,`created_at`);--> statement-breakpoint
CREATE TABLE `price_watches` (
	`id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`owner_id` text NOT NULL,
	`commodity_id` text NOT NULL,
	`region_code` text,
	`kind` text NOT NULL,
	`threshold_per_kg` integer NOT NULL,
	`last_notified_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`commodity_id`) REFERENCES `commodities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`region_code`) REFERENCES `regions`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `price_watches_owner_idx` ON `price_watches` (`role`,`owner_id`);--> statement-breakpoint
CREATE INDEX `price_watches_commodity_idx` ON `price_watches` (`commodity_id`);