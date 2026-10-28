CREATE TABLE "auto_accept_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comedian_id" uuid NOT NULL,
	"organizer_id" uuid NOT NULL,
	"formats" "event_format"[],
	"weekdays" integer[],
	"time_from" text,
	"time_to" text,
	"max_gigs_per_day" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_feeds" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "calendar_feeds_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "auto_accept_rules" ADD CONSTRAINT "auto_accept_rules_comedian_id_users_id_fk" FOREIGN KEY ("comedian_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_accept_rules" ADD CONSTRAINT "auto_accept_rules_organizer_id_users_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auto_accept_rules_pair_uq" ON "auto_accept_rules" USING btree ("comedian_id","organizer_id");