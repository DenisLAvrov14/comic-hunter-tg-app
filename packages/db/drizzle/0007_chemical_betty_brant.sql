CREATE TABLE "comedian_trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comedian_id" uuid NOT NULL,
	"city_id" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comedian_trips" ADD CONSTRAINT "comedian_trips_comedian_id_users_id_fk" FOREIGN KEY ("comedian_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comedian_trips" ADD CONSTRAINT "comedian_trips_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comedian_trips_comedian_idx" ON "comedian_trips" USING btree ("comedian_id","ends_on");--> statement-breakpoint
CREATE INDEX "comedian_trips_city_idx" ON "comedian_trips" USING btree ("city_id","ends_on");