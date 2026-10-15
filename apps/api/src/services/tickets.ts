import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { departments, ticketDecisions, ticketRevisions, tickets, users } from "@beyaz-ofis/db-schema";
import { ApiError, enforce } from "../errors.js";
import { canDecideTicket, canEditTicket, canWithdrawTicket, TICKET_EDIT_WINDOW_MS, type TicketState } from "../policy/ticket.js";
import { HOUR } from "../policy/types.js";
import { expiresAt } from "../policy/window.js";
import {
  hasActiveExecutive,
  loadRules,
  loadUser,
  paginateDesc,
  retryAfter,
  actorSummary,
  type Actor,
  type Ctx,
} from "./common.js";

type TicketRow = typeof tickets.$inferSelect;

// Görünürlük (§5.5, Ç11): talep eden ve patron tam görür. Patron yokken sistem yöneticisi yalnızca meta veri görür.
type View = "full" | "meta" | null;
function viewOf(t: TicketRow, actor: Actor, executiveExists: boolean): View {
  if (t.requesterId === actor.id) return "full";
  if (actor.role === "executive") return "full";
  if (actor.role === "system_admin" && !executiveExists) return "meta";
  return null;
}

async function summaryOf(ctx: Ctx, t: TicketRow) {
  const requester = await loadUser(ctx.db, t.requesterId);
  return {
    ticket_id: t.ticketId,
    requester: requester ? actorSummary(requester) : null,
    target_department_id: t.targetDepartmentId,
    title: t.title,
    status: t.status,
    reopened_from: t.reopenedFrom,
    created_at: t.createdAt,
    expires_at: t.expiresAt,
    closed_at: t.closedAt,
  };
}

async function fullOf(ctx: Ctx, t: TicketRow, actor: Actor, view: View) {
  const decisions = await ctx.db
    .select()
    .from(ticketDecisions)
    .where(eq(ticketDecisions.ticketId, t.ticketId));
  const decidedBy = new Map<string, Awaited<ReturnType<typeof loadUser>>>();
  for (const d of decisions) decidedBy.set(d.decidedBy, await loadUser(ctx.db, d.decidedBy));
  return {
    ...(await summaryOf(ctx, t)),
    body: view === "full" ? t.body : null,
    edit_window_closes_at:
      t.requesterId === actor.id && t.status === "pending"
        ? new Date(t.createdAt.getTime() + TICKET_EDIT_WINDOW_MS)
        : null,
    decisions: decisions.map((d) => {
      const u = decidedBy.get(d.decidedBy);
      return {
        decided_by: u ? actorSummary(u) : null,
        decision: d.decision,
        note: d.note,
        decided_at: d.decidedAt,
      };
    }),
  };
}

function stateOf(t: TicketRow): TicketState {
  return { requesterId: t.requesterId, status: t.status, createdAt: t.createdAt };
}

async function loadTicket(ctx: Ctx, ticketId: string): Promise<TicketRow> {
  const [t] = await ctx.db.select().from(tickets).where(eq(tickets.ticketId, ticketId)).limit(1);
  if (!t) throw new ApiError("NOT_FOUND");
  return t;
}

// K7: ticket hız sınırı, son 1 saatte gönderenin açtığı ticket'lar.
async function assertTicketRate(ctx: Ctx, requesterId: string): Promise<void> {
  const now = ctx.now();
  const rules = await loadRules(ctx.db);
  const windowStart = new Date(now.getTime() - HOUR);
  const recent = await ctx.db
    .select({ createdAt: tickets.createdAt })
    .from(tickets)
    .where(and(eq(tickets.requesterId, requesterId), gt(tickets.createdAt, windowStart)))
    .orderBy(tickets.createdAt);
  if (recent.length >= rules.ticketRatePerHour) {
    throw new ApiError("RATE_LIMITED", undefined, undefined, retryAfter(recent[0]!.createdAt, HOUR, now));
  }
}

export async function createTicket(
  ctx: Ctx,
  actor: Actor,
  body: { client_request_id: string; target_department_id: number; title: string; body: string },
): Promise<{ status: 200 | 201; body: unknown }> {
  // İdempotency (Ç25): aynı istek anahtarı mevcut ticket'ı döner
  const [dup] = await ctx.db
    .select()
    .from(tickets)
    .where(and(eq(tickets.requesterId, actor.id), eq(tickets.clientRequestId, body.client_request_id)))
    .limit(1);
  if (dup) return { status: 200, body: await fullOf(ctx, dup, actor, "full") };

  const [dept] = await ctx.db
    .select({ id: departments.departmentId })
    .from(departments)
    .where(and(eq(departments.departmentId, body.target_department_id), isNull(departments.deletedAt)))
    .limit(1);
  if (!dept) throw new ApiError("VALIDATION_FAILED", "Birim bulunamadı.");

  await assertTicketRate(ctx, actor.id);
  const now = ctx.now();
  const rules = await loadRules(ctx.db);
  const [t] = await ctx.db
    .insert(tickets)
    .values({
      requesterId: actor.id,
      targetDepartmentId: body.target_department_id,
      title: body.title,
      body: body.body,
      clientRequestId: body.client_request_id,
      expiresAt: expiresAt(now, rules.requestExpiryHours),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!t) throw new ApiError("INTERNAL_ERROR");
  return { status: 201, body: await fullOf(ctx, t, actor, "full") };
}

export async function listTickets(
  ctx: Ctx,
  actor: Actor,
  q: { role: "requester" | "approver"; status?: TicketRow["status"] | undefined; cursor?: string | undefined; limit: number },
) {
  const exec = await hasActiveExecutive(ctx.db);
  let rows: TicketRow[];
  if (q.role === "requester") {
    rows = await ctx.db
      .select()
      .from(tickets)
      .where(and(eq(tickets.requesterId, actor.id), q.status ? eq(tickets.status, q.status) : undefined));
  } else {
    // Onaylayıcı görünümü: patron kurum genelindeki açık ticket'ları görür; patron yoksa sistem yöneticisi meta veriyle
    const canApprove = actor.role === "executive" || (actor.role === "system_admin" && !exec);
    if (!canApprove) return { items: [], next_cursor: null };
    rows = await ctx.db
      .select()
      .from(tickets)
      .where(eq(tickets.status, q.status ?? "pending"));
  }
  rows.sort((a, b) => (a.createdAt.getTime() === b.createdAt.getTime()
    ? (a.ticketId < b.ticketId ? 1 : -1)
    : b.createdAt.getTime() - a.createdAt.getTime()));
  const { page, nextCursor } = paginateDesc(rows, q.limit, q.cursor, (t) => ({
    key: t.createdAt.toISOString(),
    id: t.ticketId,
  }));
  const items = await Promise.all(page.map((t) => summaryOf(ctx, t)));
  return { items, next_cursor: nextCursor };
}

export async function getTicket(ctx: Ctx, actor: Actor, ticketId: string) {
  const t = await loadTicket(ctx, ticketId);
  const view = viewOf(t, actor, await hasActiveExecutive(ctx.db));
  if (!view) throw new ApiError("FORBIDDEN");
  return fullOf(ctx, t, actor, view);
}

export async function editTicket(ctx: Ctx, actor: Actor, ticketId: string, patch: { title?: string; body?: string }) {
  const t = await loadTicket(ctx, ticketId);
  const now = ctx.now();
  enforce(canEditTicket(stateOf(t), actor, now));
  await ctx.db.transaction(async (tx) => {
    // B5: önceki hal kopyalanır
    await tx.insert(ticketRevisions).values({ ticketId, title: t.title, body: t.body, createdAt: now });
    await tx
      .update(tickets)
      .set({ title: patch.title ?? t.title, body: patch.body ?? t.body, updatedAt: now })
      .where(eq(tickets.ticketId, ticketId));
  });
  return getTicket(ctx, actor, ticketId);
}

export async function withdrawTicket(ctx: Ctx, actor: Actor, ticketId: string) {
  const t = await loadTicket(ctx, ticketId);
  enforce(canWithdrawTicket(stateOf(t), actor));
  const now = ctx.now();
  const [updated] = await ctx.db
    .update(tickets)
    .set({ status: "withdrawn", closedAt: now, updatedAt: now })
    .where(and(eq(tickets.ticketId, ticketId), eq(tickets.status, "pending")))
    .returning();
  if (!updated) throw new ApiError("REQUEST_NOT_PENDING");
  return fullOf(ctx, updated, actor, "full");
}

// K5: karar patron havuzunda. Ticket başına tek karar; eşzamanlı ikinci karar REQUEST_NOT_PENDING.
export async function decideTicket(
  ctx: Ctx,
  actor: Actor,
  ticketId: string,
  body: { decision: "approved" | "rejected"; note?: string | undefined },
) {
  const t = await loadTicket(ctx, ticketId);
  const exec = await hasActiveExecutive(ctx.db);
  const r = canDecideTicket(stateOf(t), actor, exec);
  if (!r.allowed) throw new ApiError(r.code);
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(tickets)
      .set({ status: body.decision, closedAt: now, updatedAt: now })
      .where(and(eq(tickets.ticketId, ticketId), eq(tickets.status, "pending")))
      .returning({ id: tickets.ticketId });
    if (!claimed) throw new ApiError("REQUEST_NOT_PENDING");
    await tx.insert(ticketDecisions).values({
      ticketId,
      requesterId: t.requesterId,
      decidedBy: actor.id,
      decision: body.decision,
      note: body.note ?? null,
      decidedAt: now,
    });
  });
  return fullOf(ctx, await loadTicket(ctx, ticketId), actor, "full");
}

// Ç14: süresi dolan ticket yeniden açılır, yeni kayıt önceki ticket'a bağlanır.
export async function reopenTicket(ctx: Ctx, actor: Actor, ticketId: string) {
  const t = await loadTicket(ctx, ticketId);
  if (t.requesterId !== actor.id) throw new ApiError("FORBIDDEN");
  if (t.status !== "expired") throw new ApiError("REQUEST_NOT_PENDING");
  await assertTicketRate(ctx, actor.id);
  const now = ctx.now();
  const rules = await loadRules(ctx.db);
  const [n] = await ctx.db
    .insert(tickets)
    .values({
      requesterId: t.requesterId,
      targetDepartmentId: t.targetDepartmentId,
      title: t.title,
      body: t.body,
      clientRequestId: randomUUID(),
      reopenedFrom: t.ticketId,
      expiresAt: expiresAt(now, rules.requestExpiryHours),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!n) throw new ApiError("INTERNAL_ERROR");
  return fullOf(ctx, n, actor, "full");
}

