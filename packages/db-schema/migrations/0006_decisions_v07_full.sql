CREATE TYPE "public"."audit_action" AS ENUM('create', 'update', 'deactivate', 'activate', 'delete', 'revoke', 'assign', 'unassign');--> statement-breakpoint
CREATE TYPE "public"."audit_entity_type" AS ENUM('user', 'department', 'company', 'location', 'company_link', 'department_manager', 'approval_rules');--> statement-breakpoint
CREATE TABLE "ticket_revisions" (
	"revision_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ticket_revisions_revision_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ticket_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_rules" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"request_expiry_hours" integer DEFAULT 72 NOT NULL,
	"access_window_hours" integer DEFAULT 24 NOT NULL,
	"message_rate_per_min" integer DEFAULT 60 NOT NULL,
	"ticket_rate_per_hour" integer DEFAULT 20 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "approval_rules_single_row_ck" CHECK ("approval_rules"."id" = 1),
	CONSTRAINT "approval_rules_request_expiry_ck" CHECK ("approval_rules"."request_expiry_hours" BETWEEN 1 AND 720),
	CONSTRAINT "approval_rules_access_window_ck" CHECK ("approval_rules"."access_window_hours" BETWEEN 1 AND 168),
	CONSTRAINT "approval_rules_message_rate_ck" CHECK ("approval_rules"."message_rate_per_min" BETWEEN 1 AND 600),
	CONSTRAINT "approval_rules_ticket_rate_ck" CHECK ("approval_rules"."ticket_rate_per_hour" BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"audit_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_user_id" uuid NOT NULL,
	"entity_type" "audit_entity_type" NOT NULL,
	"entity_id" text NOT NULL,
	"action" "audit_action" NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"invitation_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"token_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"family_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
DROP INDEX "company_links_pair_uq";--> statement-breakpoint
DROP INDEX "users_email_active_uq";--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "sender_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "last_seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
-- B1 backfill: mevcut konuşmalarda sayaç son seq değerine eşitlenir
UPDATE "conversations" c SET "last_seq" = COALESCE((SELECT max(m."seq") FROM "messages" m WHERE m."conversation_id" = c."conversation_id"), 0);--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "direct_key" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "client_request_id" uuid;--> statement-breakpoint
-- Ç25 backfill: mevcut kayıtlara sunucu tarafında anahtar atanır
UPDATE "tickets" SET "client_request_id" = gen_random_uuid() WHERE "client_request_id" IS NULL;--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "client_request_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "reopened_from" uuid;--> statement-breakpoint
ALTER TABLE "access_requests" ADD COLUMN "client_request_id" uuid;--> statement-breakpoint
UPDATE "access_requests" SET "client_request_id" = gen_random_uuid() WHERE "client_request_id" IS NULL;--> statement-breakpoint
ALTER TABLE "access_requests" ALTER COLUMN "client_request_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "access_requests" ADD COLUMN "reopened_from" uuid;--> statement-breakpoint
ALTER TABLE "ticket_revisions" ADD CONSTRAINT "ticket_revisions_ticket_id_tickets_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("ticket_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_updated_by_users_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_refresh_tokens_token_id_fk" FOREIGN KEY ("replaced_by") REFERENCES "public"."refresh_tokens"("token_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_revisions_ticket_idx" ON "ticket_revisions" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "invitations_user_idx" ON "invitations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_reopened_from_tickets_ticket_id_fk" FOREIGN KEY ("reopened_from") REFERENCES "public"."tickets"("ticket_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_reopened_from_access_requests_request_id_fk" FOREIGN KEY ("reopened_from") REFERENCES "public"."access_requests"("request_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- B2 backfill: mevcut birebir konuşmalarda anahtar "küçük_user:büyük_user:bağlam|0" biçiminde (bağlam yoksa 0)
UPDATE "conversations" c SET "direct_key" = (SELECT string_agg(m."user_id"::text, ':' ORDER BY m."user_id"::text) FROM "conversation_members" m WHERE m."conversation_id" = c."conversation_id") || ':' || COALESCE(c."company_context_id"::text, '0') WHERE c."type" = 'direct';--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_direct_key_uq" ON "conversations" USING btree ("direct_key") WHERE "conversations"."type" = 'direct' AND "conversations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "messages_sender_sent_idx" ON "messages" USING btree ("sender_user_id","sent_at");--> statement-breakpoint
CREATE INDEX "tickets_requester_created_idx" ON "tickets" USING btree ("requester_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "company_links_pair_uq" ON "company_links" USING btree ("company_low_id","company_high_id") WHERE "company_links"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_active_uq" ON "users" USING btree (lower("email")) WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_client_request_uq" UNIQUE("requester_id","client_request_id");--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_client_request_uq" UNIQUE("requester_id","client_request_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_direct_key_ck" CHECK (("conversations"."type" = 'direct') = ("conversations"."direct_key" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_ck" CHECK (("messages"."message_type" = 'text') = ("messages"."sender_user_id" IS NOT NULL));