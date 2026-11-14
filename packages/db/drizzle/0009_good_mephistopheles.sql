ALTER TYPE "public"."country" ADD VALUE 'UZ';--> statement-breakpoint
ALTER TYPE "public"."country" ADD VALUE 'KG';--> statement-breakpoint
ALTER TYPE "public"."country" ADD VALUE 'TJ';--> statement-breakpoint
ALTER TYPE "public"."country" ADD VALUE 'BY';--> statement-breakpoint
ALTER TYPE "public"."country" ADD VALUE 'GE';--> statement-breakpoint
ALTER TYPE "public"."country" ADD VALUE 'AM';--> statement-breakpoint
ALTER TYPE "public"."country" ADD VALUE 'RS';--> statement-breakpoint
ALTER TYPE "public"."country" ADD VALUE 'PL';--> statement-breakpoint
ALTER TYPE "public"."country" ADD VALUE 'ES';--> statement-breakpoint
ALTER TYPE "public"."country" ADD VALUE 'TR';--> statement-breakpoint
ALTER TYPE "public"."country" ADD VALUE 'DE';--> statement-breakpoint
ALTER TYPE "public"."country" ADD VALUE 'CZ';--> statement-breakpoint
ALTER TYPE "public"."country" ADD VALUE 'NL';--> statement-breakpoint
ALTER TYPE "public"."event_format" ADD VALUE 'tryout';--> statement-breakpoint
ALTER TYPE "public"."event_format" ADD VALUE 'paid';--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "logo_s3_key" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "photo_s3_key" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "photo_preview_s3_key" text;