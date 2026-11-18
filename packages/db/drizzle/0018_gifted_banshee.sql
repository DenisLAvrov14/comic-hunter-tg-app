ALTER TABLE "comedian_profiles" ADD COLUMN "started_year" integer;--> statement-breakpoint
ALTER TABLE "comedian_profiles" ADD COLUMN "gigs_per_month" integer;--> statement-breakpoint
ALTER TABLE "comedian_profiles" ADD COLUMN "set_lengths" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "comedian_profiles" ADD COLUMN "languages" jsonb DEFAULT '[]'::jsonb NOT NULL;