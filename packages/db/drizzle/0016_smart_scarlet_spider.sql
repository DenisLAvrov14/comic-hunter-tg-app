CREATE TABLE "venue_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"s3_key" text NOT NULL,
	"preview_s3_key" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "venue_photos" ADD CONSTRAINT "venue_photos_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "venue_photos_venue_idx" ON "venue_photos" USING btree ("venue_id");--> statement-breakpoint
-- Перенос единственного фото площадки в галерею.
INSERT INTO "venue_photos" ("venue_id", "s3_key", "preview_s3_key") SELECT "id", "photo_s3_key", "photo_preview_s3_key" FROM "venues" WHERE "photo_s3_key" IS NOT NULL AND "photo_preview_s3_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "venues" DROP COLUMN "photo_s3_key";--> statement-breakpoint
ALTER TABLE "venues" DROP COLUMN "photo_preview_s3_key";