CREATE TYPE "public"."notification_kind" AS ENUM('invitation_received', 'invitation_auto_accepted', 'application_accepted', 'application_rejected', 'moved_to_reserve', 'promoted_from_reserve', 'removed_from_lineup', 'event_changed', 'event_cancelled', 'lineup_position_changed', 'day_digest', 'day_digest_repeat', 'unconfirmed_alert', 'withdrawal_alert', 'pre_show_reminder', 'replacement_request', 'counter_proposal_received', 'new_application', 'broadcast');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'queued', 'sent', 'cancelled', 'failed');--> statement-breakpoint
CREATE TABLE "scheduled_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"participation_id" uuid,
	"event_id" uuid,
	"send_at" timestamp with time zone NOT NULL,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "digest_time" text DEFAULT '10:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pre_show_minutes" integer DEFAULT 30;--> statement-breakpoint
ALTER TABLE "scheduled_notifications" ADD CONSTRAINT "scheduled_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_notifications" ADD CONSTRAINT "scheduled_notifications_participation_id_participations_id_fk" FOREIGN KEY ("participation_id") REFERENCES "public"."participations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_notifications" ADD CONSTRAINT "scheduled_notifications_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_notifications_due_idx" ON "scheduled_notifications" USING btree ("status","send_at");--> statement-breakpoint
CREATE INDEX "scheduled_notifications_participation_idx" ON "scheduled_notifications" USING btree ("participation_id");--> statement-breakpoint
CREATE INDEX "scheduled_notifications_event_idx" ON "scheduled_notifications" USING btree ("event_id");