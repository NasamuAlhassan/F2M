CREATE TABLE `market_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`commodity_id` text NOT NULL,
	`market` text NOT NULL,
	`region_code` text NOT NULL,
	`price_per_kg` integer NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`commodity_id`) REFERENCES `commodities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`region_code`) REFERENCES `regions`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_prices_commodity_market_idx` ON `market_prices` (`commodity_id`,`market`);