CREATE TABLE `price_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`commodity_id` text NOT NULL,
	`region_code` text,
	`market` text,
	`price_per_kg` integer NOT NULL,
	`source` text NOT NULL,
	`dataset` text,
	`ref_id` text,
	`observed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`commodity_id`) REFERENCES `commodities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`region_code`) REFERENCES `regions`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `price_obs_commodity_time_idx` ON `price_observations` (`commodity_id`,`observed_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `price_obs_source_ref_idx` ON `price_observations` (`source`,`ref_id`);