ALTER TABLE "relay_mobile_devices" ADD COLUMN "android_sdk_version" integer;
--> statement-breakpoint
ALTER TABLE "relay_mobile_devices" ALTER COLUMN "ios_major_version" DROP NOT NULL;
