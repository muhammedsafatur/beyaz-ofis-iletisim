DROP INDEX "ticket_decisions_ticket_idx";--> statement-breakpoint
ALTER TABLE "ticket_decisions" ADD CONSTRAINT "ticket_decisions_ticket_uq" UNIQUE("ticket_id");