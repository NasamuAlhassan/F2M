ALTER TABLE `voice_calls` ADD `direction` text DEFAULT 'outbound' NOT NULL;--> statement-breakpoint
ALTER TABLE `voice_calls` ADD `state` text;