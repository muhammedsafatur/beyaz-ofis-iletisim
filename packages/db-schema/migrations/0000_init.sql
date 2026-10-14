CREATE TYPE "public"."access_log_action" AS ENUM('read', 'approve', 'reject', 'copy_blocked');--> statement-breakpoint
CREATE TYPE "public"."conversation_type" AS ENUM('direct', 'group', 'department');--> statement-breakpoint
CREATE TYPE "public"."decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."decision_basis" AS ENUM('content', 'meta');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('text', 'system');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('pending', 'approved', 'rejected', 'withdrawn', 'expired');--> statement-breakpoint
CREATE TYPE "public"."revision_type" AS ENUM('edit', 'delete');--> statement-breakpoint
CREATE TYPE "public"."target_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('employee', 'system_admin');--> statement-breakpoint
CREATE TABLE "companies" (
	"company_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "companies_company_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "company_links" (
	"link_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "company_links_link_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"company_low_id" bigint NOT NULL,
	"company_high_id" bigint NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "company_links_low_lt_high_ck" CHECK ("company_links"."company_low_id" < "company_links"."company_high_id")
);
--> statement-breakpoint
CREATE TABLE "department_locations" (
	"department_id" bigint NOT NULL,
	"location_id" bigint NOT NULL,
	CONSTRAINT "department_locations_department_id_location_id_pk" PRIMARY KEY("department_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "department_managers" (
	"department_id" bigint NOT NULL,
	"user_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "department_managers_department_id_user_id_pk" PRIMARY KEY("department_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"department_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "departments_department_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"company_id" bigint NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"location_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "locations_location_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"city" text,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_departments" (
	"user_id" uuid NOT NULL,
	"department_id" bigint NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_departments_user_id_department_id_pk" PRIMARY KEY("user_id","department_id")
);
--> statement-breakpoint
CREATE TABLE "user_locations" (
	"user_id" uuid NOT NULL,
	"location_id" bigint NOT NULL,
	CONSTRAINT "user_locations_user_id_location_id_pk" PRIMARY KEY("user_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"user_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"job_title" text,
	"role" "user_role" DEFAULT 'employee' NOT NULL,
	"profile_picture_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conversation_members" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"last_read_at" timestamp with time zone,
	"is_muted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "conversation_members_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"conversation_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "conversation_type" NOT NULL,
	"name" text,
	"department_id" bigint,
	"company_context_id" bigint,
	"created_by" uuid NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "conversations_department_id_ck" CHECK (("conversations"."type" = 'department') = ("conversations"."department_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "message_revisions" (
	"revision_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "message_revisions_revision_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"message_id" uuid NOT NULL,
	"content" text NOT NULL,
	"revision_type" "revision_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"message_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"client_message_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"content" text NOT NULL,
	"message_type" "message_type" DEFAULT 'text' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ticket_decisions" (
	"decision_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ticket_decisions_decision_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ticket_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"decided_by" uuid NOT NULL,
	"decision" "decision" NOT NULL,
	"note" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_decisions_not_self_ck" CHECK ("ticket_decisions"."decided_by" <> "ticket_decisions"."requester_id")
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"ticket_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"target_department_id" bigint NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "tickets_id_requester_uq" UNIQUE("ticket_id","requester_id")
);
--> statement-breakpoint
CREATE TABLE "access_log" (
	"log_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "access_log_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"action" "access_log_action" NOT NULL,
	"request_id" uuid NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_request_targets" (
	"request_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"department_id" bigint NOT NULL,
	"status" "target_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_basis" "decision_basis",
	CONSTRAINT "access_request_targets_request_id_department_id_pk" PRIMARY KEY("request_id","department_id"),
	CONSTRAINT "access_request_targets_not_self_ck" CHECK ("access_request_targets"."decided_by" <> "access_request_targets"."requester_id"),
	CONSTRAINT "access_request_targets_decision_ck" CHECK (("access_request_targets"."status" IN ('approved', 'rejected')) = ("access_request_targets"."decided_by" IS NOT NULL AND "access_request_targets"."decided_at" IS NOT NULL AND "access_request_targets"."decision_basis" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "access_requests" (
	"request_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"access_expires_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "access_requests_id_requester_uq" UNIQUE("request_id","requester_id")
);
--> statement-breakpoint
ALTER TABLE "company_links" ADD CONSTRAINT "company_links_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_links" ADD CONSTRAINT "company_links_company_low_id_companies_company_id_fk" FOREIGN KEY ("company_low_id") REFERENCES "public"."companies"("company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_links" ADD CONSTRAINT "company_links_company_high_id_companies_company_id_fk" FOREIGN KEY ("company_high_id") REFERENCES "public"."companies"("company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_locations" ADD CONSTRAINT "department_locations_department_id_departments_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("department_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_locations" ADD CONSTRAINT "department_locations_location_id_locations_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("location_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_managers" ADD CONSTRAINT "department_managers_department_id_departments_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("department_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_managers" ADD CONSTRAINT "department_managers_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_companies_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_departments" ADD CONSTRAINT "user_departments_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_departments" ADD CONSTRAINT "user_departments_department_id_departments_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("department_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_location_id_locations_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("location_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_conversations_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("conversation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_department_id_departments_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("department_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_company_context_id_companies_company_id_fk" FOREIGN KEY ("company_context_id") REFERENCES "public"."companies"("company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_revisions" ADD CONSTRAINT "message_revisions_message_id_messages_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("message_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("conversation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_users_user_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_decisions" ADD CONSTRAINT "ticket_decisions_decided_by_users_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_decisions" ADD CONSTRAINT "ticket_decisions_ticket_id_requester_id_tickets_ticket_id_requester_id_fk" FOREIGN KEY ("ticket_id","requester_id") REFERENCES "public"."tickets"("ticket_id","requester_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_requester_id_users_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_target_department_id_departments_department_id_fk" FOREIGN KEY ("target_department_id") REFERENCES "public"."departments"("department_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_log" ADD CONSTRAINT "access_log_conversation_id_conversations_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("conversation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_log" ADD CONSTRAINT "access_log_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_log" ADD CONSTRAINT "access_log_request_id_access_requests_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."access_requests"("request_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_request_targets" ADD CONSTRAINT "access_request_targets_department_id_departments_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("department_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_request_targets" ADD CONSTRAINT "access_request_targets_decided_by_users_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_request_targets" ADD CONSTRAINT "access_request_targets_request_id_requester_id_access_requests_request_id_requester_id_fk" FOREIGN KEY ("request_id","requester_id") REFERENCES "public"."access_requests"("request_id","requester_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_conversation_id_conversations_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("conversation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_requester_id_users_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_name_active_uq" ON "companies" USING btree ("name") WHERE "companies"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "company_links_pair_uq" ON "company_links" USING btree ("company_low_id","company_high_id");--> statement-breakpoint
CREATE INDEX "department_managers_user_idx" ON "department_managers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_company_name_active_uq" ON "departments" USING btree ("company_id","name") WHERE "departments"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "locations_name_active_uq" ON "locations" USING btree ("name") WHERE "locations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "user_departments_department_idx" ON "user_departments" USING btree ("department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_active_uq" ON "users" USING btree ("email") WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "conversation_members_user_active_idx" ON "conversation_members" USING btree ("user_id") WHERE "conversation_members"."left_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_department_channel_uq" ON "conversations" USING btree ("department_id") WHERE "conversations"."type" = 'department' AND "conversations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "message_revisions_message_idx" ON "message_revisions" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_conversation_seq_uq" ON "messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_sender_client_message_uq" ON "messages" USING btree ("sender_user_id","client_message_id");--> statement-breakpoint
CREATE INDEX "ticket_decisions_ticket_idx" ON "ticket_decisions" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "tickets_requester_idx" ON "tickets" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "tickets_target_department_status_idx" ON "tickets" USING btree ("target_department_id","status");--> statement-breakpoint
CREATE INDEX "tickets_pending_expires_idx" ON "tickets" USING btree ("expires_at") WHERE "tickets"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "access_log_request_idx" ON "access_log" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "access_request_targets_department_pending_idx" ON "access_request_targets" USING btree ("department_id") WHERE "access_request_targets"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "access_requests_requester_idx" ON "access_requests" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "access_requests_pending_expires_idx" ON "access_requests" USING btree ("expires_at") WHERE "access_requests"."status" = 'pending';