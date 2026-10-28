CREATE TYPE "public"."attendance" AS ENUM('unknown', 'present', 'absent');--> statement-breakpoint
CREATE TYPE "public"."busy_kind" AS ENUM('busy', 'manual_gig');--> statement-breakpoint
CREATE TYPE "public"."day_confirmation" AS ENUM('none', 'confirmed', 'declined');--> statement-breakpoint
CREATE TYPE "public"."event_format" AS ENUM('open_mic', 'showcase', 'concert', 'other');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('draft', 'recruiting', 'lineup_locked', 'finished', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."participation_source" AS ENUM('application', 'link', 'invitation');--> statement-breakpoint
CREATE TYPE "public"."participation_status" AS ENUM('pending', 'invited', 'counter_proposed', 'accepted', 'reserve', 'rejected', 'declined', 'withdrawn', 'removed');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('host');--> statement-breakpoint
CREATE TABLE "busy_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"title" text,
	"kind" "busy_kind" NOT NULL,
	"venue_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_staff" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "staff_role" DEFAULT 'host' NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_staff_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizer_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"title" text NOT NULL,
	"format" "event_format" NOT NULL,
	"format_note" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"window_ends_at" timestamp with time zone NOT NULL,
	"slots_count" integer NOT NULL,
	"set_minutes" integer NOT NULL,
	"gap_minutes" integer DEFAULT 2 NOT NULL,
	"conditions" text DEFAULT '' NOT NULL,
	"recruitment_open" boolean DEFAULT false NOT NULL,
	"recruitment_link_token" text,
	"show_lineup" boolean DEFAULT true NOT NULL,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"lineup_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_recruitment_link_token_unique" UNIQUE("recruitment_link_token")
);
--> statement-breakpoint
CREATE TABLE "participation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participation_id" uuid NOT NULL,
	"actor_id" uuid,
	"from_status" "participation_status",
	"to_status" "participation_status" NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"comedian_id" uuid NOT NULL,
	"source" "participation_source" NOT NULL,
	"status" "participation_status" NOT NULL,
	"position" integer,
	"set_minutes_override" integer,
	"invited_by" uuid,
	"auto_accepted" boolean DEFAULT false NOT NULL,
	"is_urgent" boolean DEFAULT false NOT NULL,
	"message" text,
	"counter_proposal" text,
	"day_confirmation" "day_confirmation" DEFAULT 'none' NOT NULL,
	"day_confirmed_at" timestamp with time zone,
	"attendance" "attendance" DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participations_event_comedian_uq" UNIQUE("event_id","comedian_id")
);
--> statement-breakpoint
ALTER TABLE "busy_slots" ADD CONSTRAINT "busy_slots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_staff" ADD CONSTRAINT "event_staff_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_staff" ADD CONSTRAINT "event_staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organizer_id_users_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participation_events" ADD CONSTRAINT "participation_events_participation_id_participations_id_fk" FOREIGN KEY ("participation_id") REFERENCES "public"."participations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participation_events" ADD CONSTRAINT "participation_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participations" ADD CONSTRAINT "participations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participations" ADD CONSTRAINT "participations_comedian_id_users_id_fk" FOREIGN KEY ("comedian_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participations" ADD CONSTRAINT "participations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "busy_slots_user_idx" ON "busy_slots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "busy_slots_window_gist" ON "busy_slots" USING gist (tstzrange("starts_at", "ends_at"));--> statement-breakpoint
CREATE INDEX "events_organizer_idx" ON "events" USING btree ("organizer_id","starts_at");--> statement-breakpoint
CREATE INDEX "events_open_idx" ON "events" USING btree ("status","recruitment_open","starts_at");--> statement-breakpoint
CREATE INDEX "events_window_gist" ON "events" USING gist (tstzrange("starts_at", "window_ends_at"));--> statement-breakpoint
CREATE INDEX "participation_events_participation_idx" ON "participation_events" USING btree ("participation_id");--> statement-breakpoint
CREATE INDEX "participations_comedian_idx" ON "participations" USING btree ("comedian_id","status");--> statement-breakpoint
CREATE INDEX "participations_event_idx" ON "participations" USING btree ("event_id","status");