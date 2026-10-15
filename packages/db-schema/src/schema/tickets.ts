import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { tstz } from "./_common";
import { decision, requestStatus } from "./enums";
import { departments } from "./organization";
import { users } from "./users";

// §3.5 tickets
export const tickets = pgTable(
  "tickets",
  {
    ticketId: uuid("ticket_id").primaryKey().defaultRandom(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.userId),
    // Bilgi amaçlı. Karar yetkisi birime bağlı değildir (K5).
    targetDepartmentId: bigint("target_department_id", { mode: "number" })
      .notNull()
      .references(() => departments.departmentId),
    title: text("title").notNull(),
    // Sistem yöneticisine görünmez (§5.5); loglara yazılmaz (§11)
    body: text("body").notNull(),
    status: requestStatus("status").notNull().default("pending"),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
    // request_expiry_hours ile hesaplanır
    expiresAt: tstz("expires_at").notNull(),
    closedAt: tstz("closed_at"),
  },
  (t) => [
    // ticket_decisions'taki bileşik FK için
    unique("tickets_id_requester_uq").on(t.ticketId, t.requesterId),
    index("tickets_requester_idx").on(t.requesterId),
    index("tickets_target_department_status_idx").on(t.targetDepartmentId, t.status),
    // Scheduler: süresi dolan bekleyen ticket'lar
    index("tickets_pending_expires_idx")
      .on(t.expiresAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);

// §3.5 ticket_decisions. Kısıt: decided_by <> requester_id.
// requester_id tickets'tan bileşik FK ile kopyalanır, böylece CHECK tek tabloda kalır.
export const ticketDecisions = pgTable(
  "ticket_decisions",
  {
    decisionId: bigint("decision_id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    ticketId: uuid("ticket_id").notNull(),
    requesterId: uuid("requester_id").notNull(),
    decidedBy: uuid("decided_by")
      .notNull()
      .references(() => users.userId),
    decision: decision("decision").notNull(),
    note: text("note"),
    decidedAt: tstz("decided_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.ticketId, t.requesterId],
      foreignColumns: [tickets.ticketId, tickets.requesterId],
    }),
    check("ticket_decisions_not_self_ck", sql`${t.decidedBy} <> ${t.requesterId}`),
    // K5: ticket başına tek karar. Karar yetkisi patron havuzunda, yeniden atama yok.
    unique("ticket_decisions_ticket_uq").on(t.ticketId),
  ],
);
