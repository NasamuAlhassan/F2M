CREATE SCHEMA "f2m";
--> statement-breakpoint
CREATE TABLE "f2m"."accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"auth_user_id" text NOT NULL,
	"phone" text NOT NULL,
	"role" text NOT NULL,
	"farmer_id" text,
	"buyer_id" text,
	"driver_id" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."alert_log" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."buyer_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"buyer_id" text NOT NULL,
	"template_key" text NOT NULL,
	"message" text NOT NULL,
	"contract_id" text,
	"lot_id" text,
	"demand_id" text,
	"job_id" text,
	"read_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."buyers" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"name" text NOT NULL,
	"company" text,
	"phone" text,
	"momo_msisdn" text NOT NULL,
	"region_code" text,
	"gps_lat" double precision,
	"gps_lng" double precision,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."commodities" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_key" text NOT NULL,
	"category" text NOT NULL,
	"clock_type" text NOT NULL,
	"clock_config" text NOT NULL,
	"active_rubric_version" bigint DEFAULT 1 NOT NULL,
	"sort_order" bigint DEFAULT 100 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"demand_id" text NOT NULL,
	"lot_id" text NOT NULL,
	"buyer_id" text NOT NULL,
	"farmer_id" text NOT NULL,
	"commodity_id" text NOT NULL,
	"quantity_kg" double precision NOT NULL,
	"price_terms" text NOT NULL,
	"hold_amount" bigint NOT NULL,
	"display_currency" text DEFAULT 'GHS' NOT NULL,
	"settlement_currency" text DEFAULT 'GHS' NOT NULL,
	"state" text DEFAULT 'OFFERED' NOT NULL,
	"final_grade" text,
	"final_amount" bigint,
	"agreed_total" bigint,
	"advance_amount" bigint,
	"deduction_amount" bigint,
	"decline_reason_key" text,
	"dispute_note" text,
	"funding_attempts" bigint DEFAULT 0 NOT NULL,
	"accepted_at" bigint,
	"funded_at" bigint,
	"pickup_confirmed_at" bigint,
	"graded_at" bigint,
	"delivered_at" bigint,
	"receipt_due_at" bigint,
	"received_at" bigint,
	"settled_at" bigint,
	"closed_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."delivery_job_offers" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"driver_id" text NOT NULL,
	"offered_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"status" text DEFAULT 'offered' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."delivery_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"job_code" text NOT NULL,
	"contract_id" text NOT NULL,
	"lot_id" text NOT NULL,
	"buyer_id" text NOT NULL,
	"farmer_id" text NOT NULL,
	"driver_id" text,
	"vehicle_class_code" text NOT NULL,
	"distance_km" double precision NOT NULL,
	"quote_amount" bigint NOT NULL,
	"pickup_lat" double precision NOT NULL,
	"pickup_lng" double precision NOT NULL,
	"dropoff_lat" double precision NOT NULL,
	"dropoff_lng" double precision NOT NULL,
	"state" text DEFAULT 'REQUESTED' NOT NULL,
	"funding_attempts" bigint DEFAULT 0 NOT NULL,
	"assigned_at" bigint,
	"funded_at" bigint,
	"picked_up_at" bigint,
	"delivered_at" bigint,
	"paid_at" bigint,
	"closed_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."demands" (
	"id" text PRIMARY KEY NOT NULL,
	"buyer_id" text NOT NULL,
	"commodity_id" text NOT NULL,
	"quantity_kg" double precision NOT NULL,
	"remaining_kg" double precision NOT NULL,
	"min_band" text NOT NULL,
	"price_terms" text NOT NULL,
	"window_start" bigint NOT NULL,
	"window_end" bigint NOT NULL,
	"region_code" text NOT NULL,
	"gps_lat" double precision,
	"gps_lng" double precision,
	"status" text DEFAULT 'open' NOT NULL,
	"origin" text DEFAULT 'request' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."drivers" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"name" text NOT NULL,
	"region_code" text NOT NULL,
	"gps_lat" double precision,
	"gps_lng" double precision,
	"momo_msisdn" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"vehicle_class_code" text NOT NULL,
	"pin_hash" text,
	"active" boolean DEFAULT true NOT NULL,
	"route_regions" text DEFAULT '[]' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."farmers" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"name" text NOT NULL,
	"region_code" text NOT NULL,
	"district" text,
	"gps_lat" double precision,
	"gps_lng" double precision,
	"momo_msisdn" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."gradings" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"lot_id" text NOT NULL,
	"rubric_id" text NOT NULL,
	"attempt" bigint DEFAULT 1 NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"grade_band" text,
	"confidence" double precision,
	"reasons" text,
	"raw_response" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"journal_id" text NOT NULL,
	"account" text NOT NULL,
	"debit" bigint DEFAULT 0 NOT NULL,
	"credit" bigint DEFAULT 0 NOT NULL,
	"contract_id" text,
	"job_id" text,
	"memo_key" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."lot_events" (
	"id" text PRIMARY KEY NOT NULL,
	"lot_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"payload" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."lots" (
	"id" text PRIMARY KEY NOT NULL,
	"lot_code" text NOT NULL,
	"farmer_id" text NOT NULL,
	"commodity_id" text NOT NULL,
	"quantity_kg" double precision NOT NULL,
	"remaining_kg" double precision NOT NULL,
	"unit_id" text NOT NULL,
	"unit_qty" double precision NOT NULL,
	"declared_band" text NOT NULL,
	"channel" text DEFAULT 'ussd' NOT NULL,
	"ready_date" bigint NOT NULL,
	"asking_price_per_kg" bigint,
	"asking_price_per_unit" bigint,
	"harvested_at" bigint,
	"community" text,
	"landmark" text,
	"expires_at" bigint,
	"expiry_warned_at" bigint,
	"region_code" text NOT NULL,
	"gps_lat" double precision,
	"gps_lng" double precision,
	"status" text DEFAULT 'registered' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."market_prices" (
	"id" text PRIMARY KEY NOT NULL,
	"commodity_id" text NOT NULL,
	"market" text NOT NULL,
	"region_code" text NOT NULL,
	"price_per_kg" bigint NOT NULL,
	"recorded_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."matches" (
	"id" text PRIMARY KEY NOT NULL,
	"demand_id" text NOT NULL,
	"lot_id" text NOT NULL,
	"allocated_kg" double precision NOT NULL,
	"score" double precision NOT NULL,
	"score_breakdown" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"offered_at" bigint,
	"expires_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"template_key" text NOT NULL,
	"message" text NOT NULL,
	"contract_id" text,
	"lot_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text,
	"error" text,
	"created_at" bigint NOT NULL,
	"sent_at" bigint
);
--> statement-breakpoint
CREATE TABLE "f2m"."offer_events" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"by" text NOT NULL,
	"action" text NOT NULL,
	"units" double precision,
	"price_per_unit" bigint,
	"channel" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."offers" (
	"id" text PRIMARY KEY NOT NULL,
	"lot_id" text NOT NULL,
	"buyer_id" text NOT NULL,
	"farmer_id" text NOT NULL,
	"demand_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"turn" text,
	"units" double precision NOT NULL,
	"price_per_unit" bigint NOT NULL,
	"proposed_by" text NOT NULL,
	"proposed_at" bigint NOT NULL,
	"expires_at" bigint,
	"held_demand_kg" double precision DEFAULT 0 NOT NULL,
	"contract_id" text,
	"reminder_sent_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."order_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"buyer_id" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"proposed_deduction" bigint NOT NULL,
	"status" text DEFAULT 'awaiting_farmer' NOT NULL,
	"farmer_answer" text,
	"answer_due_at" bigint NOT NULL,
	"answered_at" bigint,
	"final_deduction" bigint,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"reviewed_by" text,
	"reviewed_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."payments" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"job_id" text,
	"direction" text NOT NULL,
	"kind" text,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"counterparty_msisdn" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"raw" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."photos" (
	"id" text PRIMARY KEY NOT NULL,
	"lot_id" text NOT NULL,
	"contract_id" text,
	"grading_id" text,
	"path" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."price_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"commodity_id" text NOT NULL,
	"region_code" text,
	"market" text,
	"price_per_kg" bigint NOT NULL,
	"source" text NOT NULL,
	"dataset" text,
	"ref_id" text,
	"observed_at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."price_watches" (
	"id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"owner_id" text NOT NULL,
	"commodity_id" text NOT NULL,
	"region_code" text,
	"kind" text NOT NULL,
	"threshold_per_kg" bigint NOT NULL,
	"last_notified_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."regions" (
	"code" text PRIMARY KEY NOT NULL,
	"name_key" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."rubrics" (
	"id" text PRIMARY KEY NOT NULL,
	"commodity_id" text NOT NULL,
	"version" bigint NOT NULL,
	"doc" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."units" (
	"id" text PRIMARY KEY NOT NULL,
	"commodity_id" text NOT NULL,
	"code" text NOT NULL,
	"name_key" text NOT NULL,
	"kg_per_unit" double precision NOT NULL,
	"is_informal" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."ussd_sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"screen" text NOT NULL,
	"ctx" text DEFAULT '{}' NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."vehicle_classes" (
	"code" text PRIMARY KEY NOT NULL,
	"name_key" text NOT NULL,
	"capacity_kg" double precision NOT NULL,
	"base_fee" bigint NOT NULL,
	"per_km_rate" bigint NOT NULL,
	"sort_order" bigint DEFAULT 100 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."voice_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"flow" text NOT NULL,
	"direction" text DEFAULT 'outbound' NOT NULL,
	"state" text,
	"contract_id" text,
	"offer_id" text,
	"current_node" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" bigint DEFAULT 0 NOT NULL,
	"provider_ref" text,
	"session_ref" text,
	"outcome" text,
	"last_attempt_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f2m"."voice_listings" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"farmer_id" text,
	"audio_ref" text,
	"transcript" text,
	"translated_text" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"parsed" text,
	"lot_id" text,
	"status" text DEFAULT 'recorded' NOT NULL,
	"error" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "f2m"."accounts" ADD CONSTRAINT "accounts_farmer_id_farmers_id_fk" FOREIGN KEY ("farmer_id") REFERENCES "f2m"."farmers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."accounts" ADD CONSTRAINT "accounts_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "f2m"."buyers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."accounts" ADD CONSTRAINT "accounts_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "f2m"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."buyer_notifications" ADD CONSTRAINT "buyer_notifications_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "f2m"."buyers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."buyer_notifications" ADD CONSTRAINT "buyer_notifications_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "f2m"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."buyer_notifications" ADD CONSTRAINT "buyer_notifications_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "f2m"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."buyer_notifications" ADD CONSTRAINT "buyer_notifications_demand_id_demands_id_fk" FOREIGN KEY ("demand_id") REFERENCES "f2m"."demands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."buyer_notifications" ADD CONSTRAINT "buyer_notifications_job_id_delivery_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "f2m"."delivery_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."buyers" ADD CONSTRAINT "buyers_region_code_regions_code_fk" FOREIGN KEY ("region_code") REFERENCES "f2m"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."contracts" ADD CONSTRAINT "contracts_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "f2m"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."contracts" ADD CONSTRAINT "contracts_demand_id_demands_id_fk" FOREIGN KEY ("demand_id") REFERENCES "f2m"."demands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."contracts" ADD CONSTRAINT "contracts_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "f2m"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."contracts" ADD CONSTRAINT "contracts_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "f2m"."buyers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."contracts" ADD CONSTRAINT "contracts_farmer_id_farmers_id_fk" FOREIGN KEY ("farmer_id") REFERENCES "f2m"."farmers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."contracts" ADD CONSTRAINT "contracts_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "f2m"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."delivery_job_offers" ADD CONSTRAINT "delivery_job_offers_job_id_delivery_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "f2m"."delivery_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."delivery_job_offers" ADD CONSTRAINT "delivery_job_offers_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "f2m"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."delivery_jobs" ADD CONSTRAINT "delivery_jobs_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "f2m"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."delivery_jobs" ADD CONSTRAINT "delivery_jobs_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "f2m"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."delivery_jobs" ADD CONSTRAINT "delivery_jobs_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "f2m"."buyers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."delivery_jobs" ADD CONSTRAINT "delivery_jobs_farmer_id_farmers_id_fk" FOREIGN KEY ("farmer_id") REFERENCES "f2m"."farmers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."delivery_jobs" ADD CONSTRAINT "delivery_jobs_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "f2m"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."delivery_jobs" ADD CONSTRAINT "delivery_jobs_vehicle_class_code_vehicle_classes_code_fk" FOREIGN KEY ("vehicle_class_code") REFERENCES "f2m"."vehicle_classes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."demands" ADD CONSTRAINT "demands_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "f2m"."buyers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."demands" ADD CONSTRAINT "demands_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "f2m"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."demands" ADD CONSTRAINT "demands_region_code_regions_code_fk" FOREIGN KEY ("region_code") REFERENCES "f2m"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."drivers" ADD CONSTRAINT "drivers_region_code_regions_code_fk" FOREIGN KEY ("region_code") REFERENCES "f2m"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."drivers" ADD CONSTRAINT "drivers_vehicle_class_code_vehicle_classes_code_fk" FOREIGN KEY ("vehicle_class_code") REFERENCES "f2m"."vehicle_classes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."farmers" ADD CONSTRAINT "farmers_region_code_regions_code_fk" FOREIGN KEY ("region_code") REFERENCES "f2m"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."gradings" ADD CONSTRAINT "gradings_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "f2m"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."gradings" ADD CONSTRAINT "gradings_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "f2m"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."gradings" ADD CONSTRAINT "gradings_rubric_id_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "f2m"."rubrics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."ledger_entries" ADD CONSTRAINT "ledger_entries_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "f2m"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."ledger_entries" ADD CONSTRAINT "ledger_entries_job_id_delivery_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "f2m"."delivery_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."lot_events" ADD CONSTRAINT "lot_events_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "f2m"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."lots" ADD CONSTRAINT "lots_farmer_id_farmers_id_fk" FOREIGN KEY ("farmer_id") REFERENCES "f2m"."farmers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."lots" ADD CONSTRAINT "lots_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "f2m"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."lots" ADD CONSTRAINT "lots_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "f2m"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."lots" ADD CONSTRAINT "lots_region_code_regions_code_fk" FOREIGN KEY ("region_code") REFERENCES "f2m"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."market_prices" ADD CONSTRAINT "market_prices_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "f2m"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."market_prices" ADD CONSTRAINT "market_prices_region_code_regions_code_fk" FOREIGN KEY ("region_code") REFERENCES "f2m"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."matches" ADD CONSTRAINT "matches_demand_id_demands_id_fk" FOREIGN KEY ("demand_id") REFERENCES "f2m"."demands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."matches" ADD CONSTRAINT "matches_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "f2m"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."notifications" ADD CONSTRAINT "notifications_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "f2m"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."notifications" ADD CONSTRAINT "notifications_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "f2m"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."offer_events" ADD CONSTRAINT "offer_events_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "f2m"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."offers" ADD CONSTRAINT "offers_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "f2m"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."offers" ADD CONSTRAINT "offers_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "f2m"."buyers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."offers" ADD CONSTRAINT "offers_farmer_id_farmers_id_fk" FOREIGN KEY ("farmer_id") REFERENCES "f2m"."farmers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."offers" ADD CONSTRAINT "offers_demand_id_demands_id_fk" FOREIGN KEY ("demand_id") REFERENCES "f2m"."demands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."offers" ADD CONSTRAINT "offers_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "f2m"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."order_claims" ADD CONSTRAINT "order_claims_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "f2m"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."order_claims" ADD CONSTRAINT "order_claims_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "f2m"."buyers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."payments" ADD CONSTRAINT "payments_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "f2m"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."payments" ADD CONSTRAINT "payments_job_id_delivery_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "f2m"."delivery_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."photos" ADD CONSTRAINT "photos_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "f2m"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."photos" ADD CONSTRAINT "photos_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "f2m"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."photos" ADD CONSTRAINT "photos_grading_id_gradings_id_fk" FOREIGN KEY ("grading_id") REFERENCES "f2m"."gradings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."price_observations" ADD CONSTRAINT "price_observations_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "f2m"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."price_observations" ADD CONSTRAINT "price_observations_region_code_regions_code_fk" FOREIGN KEY ("region_code") REFERENCES "f2m"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."price_watches" ADD CONSTRAINT "price_watches_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "f2m"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."price_watches" ADD CONSTRAINT "price_watches_region_code_regions_code_fk" FOREIGN KEY ("region_code") REFERENCES "f2m"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."rubrics" ADD CONSTRAINT "rubrics_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "f2m"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."units" ADD CONSTRAINT "units_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "f2m"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."voice_calls" ADD CONSTRAINT "voice_calls_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "f2m"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."voice_calls" ADD CONSTRAINT "voice_calls_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "f2m"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."voice_listings" ADD CONSTRAINT "voice_listings_farmer_id_farmers_id_fk" FOREIGN KEY ("farmer_id") REFERENCES "f2m"."farmers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f2m"."voice_listings" ADD CONSTRAINT "voice_listings_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "f2m"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_auth_user_idx" ON "f2m"."accounts" USING btree ("auth_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_phone_idx" ON "f2m"."accounts" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_log_once_idx" ON "f2m"."alert_log" USING btree ("kind","recipient","subject");--> statement-breakpoint
CREATE INDEX "alert_log_recipient_idx" ON "f2m"."alert_log" USING btree ("recipient","created_at");--> statement-breakpoint
CREATE INDEX "buyer_notifications_buyer_idx" ON "f2m"."buyer_notifications" USING btree ("buyer_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "buyers_email_idx" ON "f2m"."buyers" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "buyers_phone_idx" ON "f2m"."buyers" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "commodities_code_idx" ON "f2m"."commodities" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_match_idx" ON "f2m"."contracts" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "contracts_farmer_idx" ON "f2m"."contracts" USING btree ("farmer_id");--> statement-breakpoint
CREATE INDEX "contracts_buyer_idx" ON "f2m"."contracts" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "contracts_state_idx" ON "f2m"."contracts" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_job_offers_job_driver_idx" ON "f2m"."delivery_job_offers" USING btree ("job_id","driver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_jobs_code_idx" ON "f2m"."delivery_jobs" USING btree ("job_code");--> statement-breakpoint
CREATE INDEX "delivery_jobs_contract_idx" ON "f2m"."delivery_jobs" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "delivery_jobs_driver_idx" ON "f2m"."delivery_jobs" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "delivery_jobs_state_idx" ON "f2m"."delivery_jobs" USING btree ("state");--> statement-breakpoint
CREATE INDEX "demands_buyer_idx" ON "f2m"."demands" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "demands_commodity_status_idx" ON "f2m"."demands" USING btree ("commodity_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_phone_idx" ON "f2m"."drivers" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "farmers_phone_idx" ON "f2m"."farmers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "gradings_contract_idx" ON "f2m"."gradings" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "ledger_journal_idx" ON "f2m"."ledger_entries" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "ledger_account_idx" ON "f2m"."ledger_entries" USING btree ("account");--> statement-breakpoint
CREATE UNIQUE INDEX "lot_events_lot_seq_idx" ON "f2m"."lot_events" USING btree ("lot_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "lots_code_idx" ON "f2m"."lots" USING btree ("lot_code");--> statement-breakpoint
CREATE INDEX "lots_farmer_idx" ON "f2m"."lots" USING btree ("farmer_id");--> statement-breakpoint
CREATE INDEX "lots_commodity_status_idx" ON "f2m"."lots" USING btree ("commodity_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "market_prices_commodity_market_idx" ON "f2m"."market_prices" USING btree ("commodity_id","market");--> statement-breakpoint
CREATE INDEX "matches_demand_idx" ON "f2m"."matches" USING btree ("demand_id");--> statement-breakpoint
CREATE INDEX "matches_lot_idx" ON "f2m"."matches" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "notifications_phone_idx" ON "f2m"."notifications" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "f2m"."notifications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "offer_events_offer_idx" ON "f2m"."offer_events" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "offers_lot_idx" ON "f2m"."offers" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "offers_buyer_idx" ON "f2m"."offers" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "offers_farmer_idx" ON "f2m"."offers" USING btree ("farmer_id");--> statement-breakpoint
CREATE INDEX "offers_status_idx" ON "f2m"."offers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "order_claims_contract_idx" ON "f2m"."order_claims" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "order_claims_status_idx" ON "f2m"."order_claims" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_ref_idx" ON "f2m"."payments" USING btree ("provider_ref");--> statement-breakpoint
CREATE INDEX "payments_contract_idx" ON "f2m"."payments" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "photos_lot_idx" ON "f2m"."photos" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "photos_contract_idx" ON "f2m"."photos" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "price_obs_commodity_time_idx" ON "f2m"."price_observations" USING btree ("commodity_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_obs_source_ref_idx" ON "f2m"."price_observations" USING btree ("source","ref_id");--> statement-breakpoint
CREATE INDEX "price_watches_owner_idx" ON "f2m"."price_watches" USING btree ("role","owner_id");--> statement-breakpoint
CREATE INDEX "price_watches_commodity_idx" ON "f2m"."price_watches" USING btree ("commodity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rubrics_commodity_version_idx" ON "f2m"."rubrics" USING btree ("commodity_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "units_commodity_code_idx" ON "f2m"."units" USING btree ("commodity_id","code");--> statement-breakpoint
CREATE INDEX "voice_calls_status_idx" ON "f2m"."voice_calls" USING btree ("status");--> statement-breakpoint
CREATE INDEX "voice_calls_phone_idx" ON "f2m"."voice_calls" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "voice_listings_phone_idx" ON "f2m"."voice_listings" USING btree ("phone");