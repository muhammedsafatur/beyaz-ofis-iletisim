import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
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
    // Ç25: istemci üretir, tekrar eden istek ikinci ticket açmaz
    clientRequestId: uuid("client_request_id").notNull(),
    // Ç14: süresi dolan ticket yeniden açılınca yeni kayıt, önceki ticket'a bağlanır
    reopenedFrom: uuid("reopened_from").references((): AnyPgColumn => tickets.ticketId),
  },
  (t) => [
    // ticket_decisions'taki bileşik FK için
    unique("tickets_id_requester_uq").on(t.ticketId, t.requesterId),
    unique("tickets_client_request_uq").on(t.requesterId, t.clientRequestId),
    index("tickets_requester_idx").on(t.requesterId),
    // Ticket açma hız sınırı (K7): son 1 saatte gönderenin satırları sayılır
    index("tickets_requester_created_idx").on(t.requesterId, t.createdAt),
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

// B5: ticket düzenleme geçmişi. Önceki başlık ve gövde kopyalanır; talep eden görmez (mesajlar için message_revisions ile aynı desen).
export const ticketRevisions = pgTable(
  "ticket_revisions",
  {
    revisionId: bigint("revision_id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.ticketId),
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [index("ticket_revisions_ticket_idx").on(t.ticketId)],
);

// Faz 2: ticket yorumları. Görünürlük ticket gövdesiyle aynıdır (talep eden ve patron).
export const ticketComments = pgTable(
  "ticket_comments",
  {
    commentId: bigint("comment_id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.ticketId),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.userId),
    body: text("body").notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [index("ticket_comments_ticket_idx").on(t.ticketId)],
);
