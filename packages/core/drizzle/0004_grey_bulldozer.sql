CREATE TABLE `delivery_job_offers` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`driver_id` text NOT NULL,
	`offered_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`status` text DEFAULT 'offered' NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `delivery_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`driver_id`) REFERENCES `drivers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_job_offers_job_driver_idx` ON `delivery_job_offers` (`job_id`,`driver_id`);--> statement-breakpoint
CREATE TABLE `delivery_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_code` text NOT NULL,
	`contract_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`buyer_id` text NOT NULL,
	`farmer_id` text NOT NULL,
	`driver_id` text,
	`vehicle_class_code` text NOT NULL,
	`distance_km` real NOT NULL,
	`quote_amount` integer NOT NULL,
	`pickup_lat` real NOT NULL,
	`pickup_lng` real NOT NULL,
	`dropoff_lat` real NOT NULL,
	`dropoff_lng` real NOT NULL,
	`state` text DEFAULT 'REQUESTED' NOT NULL,
	`funding_attempts` integer DEFAULT 0 NOT NULL,
	`assigned_at` integer,
	`funded_at` integer,
	`picked_up_at` integer,
	`delivered_at` integer,
	`paid_at` integer,
	`closed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`buyer_id`) REFERENCES `buyers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`farmer_id`) REFERENCES `farmers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`driver_id`) REFERENCES `drivers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vehicle_class_code`) REFERENCES `vehicle_classes`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_jobs_code_idx` ON `delivery_jobs` (`job_code`);--> statement-breakpoint
CREATE INDEX `delivery_jobs_contract_idx` ON `delivery_jobs` (`contract_id`);--> statement-breakpoint
CREATE INDEX `delivery_jobs_driver_idx` ON `delivery_jobs` (`driver_id`);--> statement-breakpoint
CREATE INDEX `delivery_jobs_state_idx` ON `delivery_jobs` (`state`);--> statement-breakpoint
CREATE TABLE `drivers` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`name` text NOT NULL,
	`region_code` text NOT NULL,
	`gps_lat` real,
	`gps_lng` real,
	`momo_msisdn` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`vehicle_class_code` text NOT NULL,
	`pin_hash` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`region_code`) REFERENCES `regions`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vehicle_class_code`) REFERENCES `vehicle_classes`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drivers_phone_idx` ON `drivers` (`phone`);--> statement-breakpoint
CREATE TABLE `vehicle_classes` (
	`code` text PRIMARY KEY NOT NULL,
	`name_key` text NOT NULL,
	`capacity_kg` real NOT NULL,
	`base_fee` integer NOT NULL,
	`per_km_rate` integer NOT NULL,
	`sort_order` integer DEFAULT 100 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `ledger_entries` ADD `job_id` text REFERENCES delivery_jobs(id);--> statement-breakpoint
ALTER TABLE `payments` ADD `job_id` text REFERENCES delivery_jobs(id);