ALTER TYPE "public"."notification_kind" ADD VALUE 'admin_granted';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "can_manage_admins" boolean DEFAULT false NOT NULL;