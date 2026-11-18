ALTER TYPE "public"."notification_kind" ADD VALUE 'event_chat_invite';--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "chat_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "chat_invite_link" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "chat_request_id" integer;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_chat_id_telegram_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."telegram_chats"("id") ON DELETE set null ON UPDATE no action;