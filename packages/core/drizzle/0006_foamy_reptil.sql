CREATE TABLE `voice_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`flow` text NOT NULL,
	`contract_id` text,
	`current_node` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`provider_ref` text,
	`session_ref` text,
	`outcome` text,
	`last_attempt_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `voice_calls_status_idx` ON `voice_calls` (`status`);--> statement-breakpoint
CREATE INDEX `voice_calls_phone_idx` ON `voice_calls` (`phone`);