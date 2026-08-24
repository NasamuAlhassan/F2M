CREATE TABLE `voice_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`farmer_id` text,
	`audio_ref` text,
	`transcript` text,
	`translated_text` text,
	`locale` text DEFAULT 'en' NOT NULL,
	`parsed` text,
	`lot_id` text,
	`status` text DEFAULT 'recorded' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`farmer_id`) REFERENCES `farmers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `voice_listings_phone_idx` ON `voice_listings` (`phone`);