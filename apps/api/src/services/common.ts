import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import {
  approvalRules,
  auditLog,
  conversationMembers,
  conversations,
  departmentManagers,
  departments,
  messages,
  companyLinks,
  userDepartments,
  users,
} from "@beyaz-ofis/db-schema";
import type { ErrorCode } from "@beyaz-ofis/core";
import type { Db } from "../db.js";
import type { Realtime } from "../realtime.js";
import type { FileStorage } from "../storage.js";
import type { PushSender } from "../push.js";
import type { Scanner } from "../scanner.js";
import { ApiError, enforce } from "../errors.js";
import type { CompanyLink, Decision, PolicyUser, Role } from "../policy/types.js";

// Servislerin ihtiyaç duyduğu zaman ve veritabanı bağlamı. Testler now'ı sabitler.
export interface Ctx {
  db: Db;
  now: () => Date;
  jwtSecret: string;
  invites: InviteSender;
  realtime: Realtime;
  files: FileStorage;
  push: PushSender;
  scanner: Scanner;
}

export interface InviteSender {
  send(email: string, token: string): Promise<void>;
}

// Kimliği doğrulanmış kullanıcı. companyIds ve departmentIds birim üyeliklerinden türetilir (§3.2).
export interface Actor extends PolicyUser {
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  departmentIds: number[];
}

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function loadActor(db: Db, userId: string): Promise<Actor | null> {
  const [u] = await db.select().from(users).where(eq(users.userId, userId)).limit(1);
  if (!u) return null;
  const deps = await db
    .select({ departmentId: userDepartments.departmentId, companyId: departments.companyId })
    .from(userDepartments)
    .innerJoin(departments, eq(departments.departmentId, userDepartments.departmentId))
    .where(and(eq(userDepartments.userId, userId), isNull(departments.deletedAt)));
  return {
    id: u.userId,
    role: u.role as Role,
    isActive: u.isActive,
    deleted: u.deletedAt !== null,
    companyIds: [...new Set(deps.map((d) => d.companyId))],
    departmentIds: [...new Set(deps.map((d) => d.departmentId))],
    firstName: u.firstName,
    lastName: u.lastName,
    jobTitle: u.jobTitle,
  };
}

// Politika için hedef kullanıcı (aktör ile aynı yapı, ama kimlik doğrulaması yok).
export async function loadUser(db: Db, userId: string): Promise<Actor | null> {
  return loadActor(db, userId);
}

export async function loadCompanyLinks(db: Db): Promise<CompanyLink[]> {
  const rows = await db.select().from(companyLinks);
  return rows.map((r) => ({ low: r.companyLowId, high: r.companyHighId, revoked: r.revokedAt !== null }));
}

export async function hasActiveExecutive(db: Db): Promise<boolean> {
  const [row] = await db
    .select({ id: users.userId })
    .from(users)
    .where(and(eq(users.role, "executive"), eq(users.isActive, true), isNull(users.deletedAt)))
    .limit(1);
  return row !== undefined;
}

export async function loadRules(db: Db) {
  const [r] = await db.select().from(approvalRules).where(eq(approvalRules.id, 1)).limit(1);
  if (!r) throw new ApiError("INTERNAL_ERROR", "Onay yapılandırması bulunamadı.");
  return r;
}

export function requireSystemAdmin(actor: Actor): void {
  if (actor.role !== "system_admin") throw new ApiError("FORBIDDEN");
}

// Konuşmanın aktif üyesi değilse NOT_FOUND (K6: üye olmayana varlık bilgisi verilmez).
export async function activeMembership(db: Db, conversationId: string, userId: string) {
  const [m] = await db
    .select()
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.conversationId, conversationMembers.conversationId))
    .where(
      and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.userId, userId),
        isNull(conversationMembers.leftAt),
        isNull(conversations.deletedAt),
      ),
    )
    .limit(1);
  if (!m) throw new ApiError("NOT_FOUND");
  return { membership: m.conversation_members, conversation: m.conversations };
}

export async function isDepartmentManager(db: Db, departmentId: number, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ d: departmentManagers.departmentId })
    .from(departmentManagers)
    .where(and(eq(departmentManagers.departmentId, departmentId), eq(departmentManagers.userId, userId)))
    .limit(1);
  return row !== undefined;
}

// Yalnızca değer alanları olan denetim kaydı. Parola, token, mesaj içeriği ve ticket gövdesi bu fonksiyona girmez (§11).
const FORBIDDEN_AUDIT_KEYS = /password|token|content|body/i;
function sanitize(value: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!value) return null;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !FORBIDDEN_AUDIT_KEYS.test(k)));
}

export async function audit(
  db: Db | Tx,
  actorId: string,
  entityType: typeof auditLog.$inferInsert["entityType"],
  entityId: string,
  action: typeof auditLog.$inferInsert["action"],
  before?: Record<string, unknown>,
  after?: Record<string, unknown>,
): Promise<void> {
  await db.insert(auditLog).values({
    actorUserId: actorId,
    entityType,
    entityId,
    action,
    before: sanitize(before),
    after: sanitize(after),
  });
}

// Mesaj ekleme: konuşmanın seq ve change_seq sayaçlarını atomik artırır (B1, K4).
export async function appendMessage(
  tx: Tx,
  args: {
    conversationId: string;
    senderId: string | null;
    type: "text" | "system";
    content: string;
    clientMessageId: string;
    now: Date;
  },
) {
  const [c] = await tx
    .update(conversations)
    .set({
      lastSeq: sql`${conversations.lastSeq} + 1`,
      lastChangeSeq: sql`${conversations.lastChangeSeq} + 1`,
      lastMessageAt: args.now,
      updatedAt: args.now,
    })
    .where(eq(conversations.conversationId, args.conversationId))
    .returning({ lastSeq: conversations.lastSeq, lastChangeSeq: conversations.lastChangeSeq });
  if (!c) throw new ApiError("NOT_FOUND");
  const [m] = await tx
    .insert(messages)
    .values({
      conversationId: args.conversationId,
      senderUserId: args.senderId,
      clientMessageId: args.clientMessageId,
      seq: c.lastSeq,
      changeSeq: c.lastChangeSeq,
      content: args.content,
      messageType: args.type,
      sentAt: args.now,
    })
    .returning();
  if (!m) throw new ApiError("INTERNAL_ERROR");
  return m;
}

// Düzenleme ve silme: değişiklik sayacı artar, konuşma updated_at güncellenir (K4).
export async function bumpChange(tx: Tx, conversationId: string, now: Date): Promise<number> {
  const [c] = await tx
    .update(conversations)
    .set({ lastChangeSeq: sql`${conversations.lastChangeSeq} + 1`, updatedAt: now })
    .where(eq(conversations.conversationId, conversationId))
    .returning({ lastChangeSeq: conversations.lastChangeSeq });
  if (!c) throw new ApiError("NOT_FOUND");
  return c.lastChangeSeq;
}

// Hız sınırı için Retry-After (saniye): penceredeki en eski kaydın düşmesini bekle.
export function retryAfter(oldest: Date, windowMs: number, now: Date): number {
  return Math.max(1, Math.ceil((oldest.getTime() + windowMs - now.getTime()) / 1000));
}

// Sayfalama: imleç opak tutulur (Ç22). Liste azalan sırayla gelir, imleç son öğenin (anahtar, id) değeridir.
export function encodeCursor(key: string, id: string): string {
  return Buffer.from(JSON.stringify([key, id]), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): [string, string] | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(v) && typeof v[0] === "string" && typeof v[1] === "string") return [v[0], v[1]];
  } catch {
    // aşağıda hata fırlatılır
  }
  throw new ApiError("VALIDATION_FAILED", "Geçersiz imleç.");
}

// items: azalan sıralı. key ve id'den oluşan imleçten sonrakileri döner.
export function paginateDesc<T>(
  items: T[],
  limit: number,
  cursor: string | undefined,
  keyOf: (t: T) => { key: string; id: string },
): { page: T[]; nextCursor: string | null } {
  const after = decodeCursor(cursor);
  const filtered = after
    ? items.filter((t) => {
        const { key, id } = keyOf(t);
        return key < after[0] || (key === after[0] && id < after[1]);
      })
    : items;
  const page = filtered.slice(0, limit);
  const last = page[page.length - 1];
  const hasMore = filtered.length > limit;
  return {
    page,
    nextCursor: hasMore && last ? encodeCursor(keyOf(last).key, keyOf(last).id) : null,
  };
}

export function userSummary(u: { userId: string; firstName: string; lastName: string; jobTitle: string | null; isActive: boolean }) {
  return {
    user_id: u.userId,
    first_name: u.firstName,
    last_name: u.lastName,
    job_title: u.jobTitle,
    is_active: u.isActive,
  };
}

// Aktör (politika görünümü) için kullanıcı özeti.
export function actorSummary(a: Actor) {
  return { user_id: a.id, first_name: a.firstName, last_name: a.lastName, job_title: a.jobTitle, is_active: a.isActive };
}

// Konuşmanın aktif üyelerine değişiklik bildirimi. Yalnızca konu bilgisi gider, içerik gitmez.
export async function notifyConversation(ctx: Ctx, conversationId: string): Promise<void> {
  const rows = await ctx.db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), isNull(conversationMembers.leftAt)));
  ctx.realtime.publish(rows.map((r) => r.userId), { type: "conversation.changed", conversation_id: conversationId });
}

export function enforceDecision(d: Decision): void {
  enforce(d);
}

export type { ErrorCode };
export { asc, desc };
