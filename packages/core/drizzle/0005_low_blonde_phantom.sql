CREATE TABLE `buyer_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`buyer_id` text NOT NULL,
	`template_key` text NOT NULL,
	`message` text NOT NULL,
	`contract_id` text,
	`lot_id` text,
	`demand_id` text,
	`job_id` text,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`buyer_id`) REFERENCES `buyers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`demand_id`) REFERENCES `demands`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `delivery_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `buyer_notifications_buyer_idx` ON `buyer_notifications` (`buyer_id`,`read_at`);