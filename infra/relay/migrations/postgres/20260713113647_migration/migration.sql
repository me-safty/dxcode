ALTER TABLE "relay_delivery_attempts" ADD COLUMN "delivery_provider" varchar(16);
--> statement-breakpoint
ALTER TABLE "relay_delivery_attempts" ADD COLUMN "provider_status" varchar(64);
--> statement-breakpoint
ALTER TABLE "relay_delivery_attempts" ADD COLUMN "provider_reason" text;
--> statement-breakpoint
ALTER TABLE "relay_delivery_attempts" ADD COLUMN "provider_id" varchar(255);
--> statement-breakpoint
ALTER TABLE "relay_mobile_devices" ADD COLUMN "android_api_level" integer;
--> statement-breakpoint
ALTER TABLE "relay_mobile_devices" ADD COLUMN "expo_push_token" text;
--> statement-breakpoint
ALTER TABLE "relay_mobile_devices" ALTER COLUMN "ios_major_version" DROP NOT NULL;
--> statement-breakpoint
CREATE INDEX "idx_relay_delivery_attempts_expo_receipts" ON "relay_delivery_attempts" ("delivery_provider","provider_status","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_relay_mobile_devices_expo_push_token" ON "relay_mobile_devices" ("expo_push_token");
