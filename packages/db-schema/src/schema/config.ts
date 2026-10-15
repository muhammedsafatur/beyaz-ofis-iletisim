import { sql } from "drizzle-orm";
import { bigint, check, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { tstz } from "./_common";
import { auditAction, auditEntityType } from "./enums";
import { users } from "./users";

// §10 approval_rules: tek satır (BOSLUKLAR B3, öneri B). Aralıklar kolon başına CHECK ile sınırlanır.
export const approvalRules = pgTable(
  "approval_rules",
  {
    id: integer("id").primaryKey().default(1),
    requestExpiryHours: integer("request_expiry_hours").notNull().default(72),
    accessWindowHours: integer("access_window_hours").notNull().default(24),
    messageRatePerMin: integer("message_rate_per_min").notNull().default(60),
    ticketRatePerHour: integer("ticket_rate_per_hour").notNull().default(20),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.userId),
  },
  (t) => [
    check("approval_rules_single_row_ck", sql`${t.id} = 1`),
    check("approval_rules_request_expiry_ck", sql`${t.requestExpiryHours} BETWEEN 1 AND 720`),
    check("approval_rules_access_window_ck", sql`${t.accessWindowHours} BETWEEN 1 AND 168`),
    check("approval_rules_message_rate_ck", sql`${t.messageRatePerMin} BETWEEN 1 AND 600`),
    check("approval_rules_ticket_rate_ck", sql`${t.ticketRatePerHour} BETWEEN 1 AND 200`),
  ],
);

// §3.6 audit_log (BOSLUKLAR B3, öneri A). Değiştirilemez: 0007 migration'ında trigger'lar.
// before/after içinde şifre hash'i, mesaj içeriği ve ticket gövdesi bulunmaz (§11), allowlist kod düzeyinde.
export const auditLog = pgTable(
  "audit_log",
  {
    auditId: bigint("audit_id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.userId),
    entityType: auditEntityType("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: auditAction("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entityType, t.entityId)],
);
