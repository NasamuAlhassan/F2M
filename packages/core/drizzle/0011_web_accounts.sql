CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_user_id` text NOT NULL,
	`phone` text NOT NULL,
	`role` text NOT NULL,
	`farmer_id` text,
	`buyer_id` text,
	`driver_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`farmer_id`) REFERENCES `farmers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`buyer_id`) REFERENCES `buyers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`driver_id`) REFERENCES `drivers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_auth_user_idx` ON `accounts` (`auth_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_phone_idx` ON `accounts` (`phone`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_buyers` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`name` text NOT NULL,
	`company` text,
	`phone` text,
	`momo_msisdn` text NOT NULL,
	`region_code` text,
	`gps_lat` real,
	`gps_lng` real,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`region_code`) REFERENCES `regions`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_buyers`("id", "email", "name", "company", "phone", "momo_msisdn", "region_code", "gps_lat", "gps_lng", "created_at") SELECT "id", "email", "name", "company", "phone", "momo_msisdn", "region_code", "gps_lat", "gps_lng", "created_at" FROM `buyers`;--> statement-breakpoint
DROP TABLE `buyers`;--> statement-breakpoint
ALTER TABLE `__new_buyers` RENAME TO `buyers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `buyers_email_idx` ON `buyers` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `buyers_phone_idx` ON `buyers` (`phone`);--> statement-breakpoint
CREATE TABLE `__new_drivers` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`name` text NOT NULL,
	`region_code` text NOT NULL,
	`gps_lat` real,
	`gps_lng` real,
	`momo_msisdn` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`vehicle_class_code` text NOT NULL,
	`pin_hash` text,
	`active` integer DEFAULT true NOT NULL,
	`route_regions` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`region_code`) REFERENCES `regions`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vehicle_class_code`) REFERENCES `vehicle_classes`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_drivers`("id", "phone", "name", "region_code", "gps_lat", "gps_lng", "momo_msisdn", "locale", "vehicle_class_code", "pin_hash", "active", "route_regions", "created_at") SELECT "id", "phone", "name", "region_code", "gps_lat", "gps_lng", "momo_msisdn", "locale", "vehicle_class_code", "pin_hash", "active", "route_regions", "created_at" FROM `drivers`;--> statement-breakpoint
DROP TABLE `drivers`;--> statement-breakpoint
ALTER TABLE `__new_drivers` RENAME TO `drivers`;--> statement-breakpoint
CREATE UNIQUE INDEX `drivers_phone_idx` ON `drivers` (`phone`);