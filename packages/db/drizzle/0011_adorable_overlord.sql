CREATE TYPE "public"."venue_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'venue_submitted';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'venue_approved';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'venue_rejected';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "status" "venue_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
-- Площадки, добавленные до проверки админами, считаются проверенными.
UPDATE "venues" SET "status" = 'approved';--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "reject_reason" text;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "venues_status_idx" ON "venues" USING btree ("status");