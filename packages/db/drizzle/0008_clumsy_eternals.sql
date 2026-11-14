CREATE TYPE "public"."staff_status" AS ENUM('invited', 'accepted', 'declined');--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'host_invitation';--> statement-breakpoint
ALTER TABLE "event_staff" ADD COLUMN "status" "staff_status" DEFAULT 'invited' NOT NULL;--> statement-breakpoint
UPDATE "event_staff" SET "status" = 'accepted', "permissions" = '{}'::jsonb;
