import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tstz } from "./_common";
import { conversations } from "./conversations";
import { accessLogAction, decisionBasis, requestStatus, targetStatus } from "./enums";
import { departments } from "./organization";
import { users } from "./users";

// §3.6 access_requests. request_id tipi spec'te yok; OpenAPI uuid diyor.
export const accessRequests = pgTable(
  "access_requests",
  {
    requestId: uuid("request_id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.conversationId),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.userId),
    // Asgari uzunluk uygulama katmanında
    reason: text("reason").notNull(),
    status: requestStatus("status").notNull().default("pending"),
    // Onay sonrası süreli erişim (access_window_hours)
    accessExpiresAt: tstz("access_expires_at"),
    // Karar bekleme süresi (request_expiry_hours)
    expiresAt: tstz("expires_at").notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
    closedAt: tstz("closed_at"),
  },
  (t) => [
    unique("access_requests_id_requester_uq").on(t.requestId, t.requesterId),
    index("access_requests_requester_idx").on(t.requesterId),
    index("access_requests_pending_expires_idx")
      .on(t.expiresAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);

// §3.6 access_request_targets. Kısıt: decided_by <> requester_id.
// requester_id access_requests'ten bileşik FK ile kopyalanır.
export const accessRequestTargets = pgTable(
  "access_request_targets",
  {
    requestId: uuid("request_id").notNull(),
    requesterId: uuid("requester_id").notNull(),
    departmentId: bigint("department_id", { mode: "number" })
      .notNull()
      .references(() => departments.departmentId),
    status: targetStatus("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => users.userId),
    decidedAt: tstz("decided_at"),
    // content: birim yöneticisi; meta: yönetici yokken sistem yöneticisi
    decisionBasis: decisionBasis("decision_basis"),
  },
  (t) => [
    primaryKey({ columns: [t.requestId, t.departmentId] }),
    foreignKey({
      columns: [t.requestId, t.requesterId],
      foreignColumns: [accessRequests.requestId, accessRequests.requesterId],
    }),
    check("access_request_targets_not_self_ck", sql`${t.decidedBy} <> ${t.requesterId}`),
    // Karar verilmiş hedefte karar veren, zaman ve dayanak dolu olmalı
    check(
      "access_request_targets_decision_ck",
      sql`(${t.status} IN ('approved', 'rejected')) = (${t.decidedBy} IS NOT NULL AND ${t.decidedAt} IS NOT NULL AND ${t.decisionBasis} IS NOT NULL)`,
    ),
    // Onaylayanın bekleyen hedefleri
    index("access_request_targets_department_pending_idx")
      .on(t.departmentId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

// §3.6 access_log. Değiştirilemez: sql/0001_immutable_logs.sql
export const accessLog = pgTable(
  "access_log",
  {
    logId: bigint("log_id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.conversationId),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId),
    action: accessLogAction("action").notNull(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => accessRequests.requestId),
    accessedAt: tstz("accessed_at").notNull().defaultNow(),
  },
  (t) => [index("access_log_request_idx").on(t.requestId)],
);
