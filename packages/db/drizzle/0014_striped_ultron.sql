CREATE TYPE "public"."venue_kind" AS ENUM('club', 'bar', 'hall', 'other');--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "kind" "venue_kind";