CREATE TABLE `order_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`buyer_id` text NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`proposed_deduction` integer NOT NULL,
	`status` text DEFAULT 'awaiting_farmer' NOT NULL,
	`farmer_answer` text,
	`answer_due_at` integer NOT NULL,
	`answered_at` integer,
	`final_deduction` integer,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`review_note` text,
	`reviewed_by` text,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`buyer_id`) REFERENCES `buyers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `order_claims_contract_idx` ON `order_claims` (`contract_id`);--> statement-breakpoint
CREATE INDEX `order_claims_status_idx` ON `order_claims` (`status`);--> statement-breakpoint
ALTER TABLE `contracts` ADD `advance_amount` integer;--> statement-breakpoint
ALTER TABLE `contracts` ADD `deduction_amount` integer;--> statement-breakpoint
ALTER TABLE `contracts` ADD `delivered_at` integer;--> statement-breakpoint
ALTER TABLE `contracts` ADD `receipt_due_at` integer;--> statement-breakpoint
ALTER TABLE `contracts` ADD `received_at` integer;--> statement-breakpoint
ALTER TABLE `payments` ADD `kind` text;