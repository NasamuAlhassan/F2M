CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`template_key` text NOT NULL,
	`message` text NOT NULL,
	`contract_id` text,
	`lot_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`provider` text,
	`error` text,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notifications_phone_idx` ON `notifications` (`phone`);--> statement-breakpoint
CREATE INDEX `notifications_status_idx` ON `notifications` (`status`);