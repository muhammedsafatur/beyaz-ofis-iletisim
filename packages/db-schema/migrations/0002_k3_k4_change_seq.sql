-- K4: delta polling için change_seq. Mevcut satırlar için değerler backfill edilir (drizzle-kit çıktısı NOT NULL'u boş tabloda varsayar).
ALTER TABLE "conversations" ADD COLUMN "last_change_seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "change_seq" bigint;--> statement-breakpoint
-- Henüz düzenleme ya da silme yok: change_seq başlangıçta seq ile aynıdır
UPDATE "messages" SET "change_seq" = "seq";--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "change_seq" SET NOT NULL;--> statement-breakpoint
UPDATE "conversations" c SET "last_change_seq" = COALESCE((SELECT max(m."seq") FROM "messages" m WHERE m."conversation_id" = c."conversation_id"), 0);--> statement-breakpoint
CREATE UNIQUE INDEX "messages_conversation_change_seq_uq" ON "messages" USING btree ("conversation_id","change_seq");
