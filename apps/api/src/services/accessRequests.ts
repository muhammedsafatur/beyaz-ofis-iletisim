import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import {
  accessLog,
  accessRequests,
  accessRequestTargets,
  conversationMembers,
  conversations,
  messages,
  userDepartments,
} from "@beyaz-ofis/db-schema";
import { ApiError, enforce } from "../errors.js";
import {
  aggregateRequestStatus,
  canDecideTarget,
  canReadApprovedContent,
  canReadTargetContent,
  type RequestStatus,
  type TargetStatus,
  validateReason,
} from "../policy/accessRequest.js";
import { MINUTE } from "../policy/types.js";
import { accessExpiresAt, expiresAt } from "../policy/window.js";
import {
  activeMembership,
  hasActiveExecutive,
  loadRules,
  loadUser,
  paginateDesc,
  retryAfter,
  actorSummary,
  type Actor,
  type Ctx,
} from "./common.js";
import { serializeMessages } from "./conversations.js";

type RequestRow = typeof accessRequests.$inferSelect;
type TargetRow = typeof accessRequestTargets.$inferSelect;

// K3 ve §5.4: karar öncesi içerik yalnızca patrona. Talep eden onaylı talebin içeriğini süre içinde okur.
// Meta veri (Ç6) onaylayana gösterilir: patron ya da patron yokken sistem yöneticisi.
const CONTENT_PAGE_LIMIT = 1000;
const COPY_BLOCKED_PER_MINUTE = 20;

async function loadRequest(ctx: Ctx, requestId: string): Promise<RequestRow> {
  const [r] = await ctx.db.select().from(accessRequests).where(eq(accessRequests.requestId, requestId)).limit(1);
  if (!r) throw new ApiError("NOT_FOUND");
  return r;
}

async function targetsOf(ctx: Ctx, requestId: string): Promise<TargetRow[]> {
  return ctx.db
    .select()
    .from(accessRequestTargets)
    .where(eq(accessRequestTargets.requestId, requestId))
    .orderBy(asc(accessRequestTargets.departmentId));
}

// Onaylayanın meta verisi (Ç6). Gerekçe ve hedefler de burada döner.
async function metaOf(ctx: Ctx, r: RequestRow, targets: TargetRow[]) {
  const [conv] = await ctx.db.select().from(conversations).where(eq(conversations.conversationId, r.conversationId)).limit(1);
  const members = await ctx.db
    .select({ userId: conversationMembers.userId, leftAt: conversationMembers.leftAt })
    .from(conversationMembers)
    .where(eq(conversationMembers.conversationId, r.conversationId));
  const requesterDeps = await ctx.db
    .select({ departmentId: userDepartments.departmentId })
    .from(userDepartments)
    .where(eq(userDepartments.userId, r.requesterId));
  const msgs = await ctx.db
    .select({ sentAt: messages.sentAt })
    .from(messages)
    .where(eq(messages.conversationId, r.conversationId))
    .orderBy(asc(messages.sentAt));
  return {
    conversation_type: conv?.type ?? "group",
    conversation_name: conv?.type === "direct" ? null : conv?.name ?? null,
    requester_department_ids: requesterDeps.map((d) => d.departmentId),
    member_count: members.filter((m) => m.leftAt === null).length,
    message_count: msgs.length,
    first_message_at: msgs[0]?.sentAt ?? null,
    last_message_at: msgs[msgs.length - 1]?.sentAt ?? null,
    reason: r.reason,
    target_department_ids: targets.map((t) => t.departmentId),
  };
}

async function summaryOf(ctx: Ctx, r: RequestRow, targets?: TargetRow[]) {
  const requester = await loadUser(ctx.db, r.requesterId);
  const [conv] = await ctx.db.select().from(conversations).where(eq(conversations.conversationId, r.conversationId)).limit(1);
  const tgts = targets ?? (await targetsOf(ctx, r.requestId));
  return {
    request_id: r.requestId,
    conversation_id: r.conversationId,
    conversation_name: conv?.type === "direct" ? null : conv?.name ?? null,
    requester: requester ? actorSummary(requester) : null,
    status: r.status,
    reopened_from: r.reopenedFrom,
    created_at: r.createdAt,
    expires_at: r.expiresAt,
    meta: await metaOf(ctx, r, tgts),
  };
}

async function fullOf(ctx: Ctx, r: RequestRow) {
  const tgts = await targetsOf(ctx, r.requestId);
  const targets = await Promise.all(
    tgts.map(async (t) => {
      const decider = t.decidedBy ? await loadUser(ctx.db, t.decidedBy) : null;
      return {
        department_id: t.departmentId,
        status: t.status,
        decided_by: decider ? actorSummary(decider) : null,
        decision_basis: t.decisionBasis,
        decided_at: t.decidedAt,
      };
    }),
  );
  return {
    ...(await summaryOf(ctx, r, tgts)),
    reason: r.reason,
    targets,
    access_expires_at: r.accessExpiresAt,
  };
}

// Görünürlük: talep eden ve onaylayan (patron ya da patron yokken sistem yöneticisi) görür.
async function canSee(ctx: Ctx, actor: Actor, r: RequestRow): Promise<boolean> {
  if (r.requesterId === actor.id) return true;
  if (actor.role === "executive") return true;
  return actor.role === "system_admin" && !(await hasActiveExecutive(ctx.db));
}

// Hedefler yalnızca konuşmadaki üyelerin (ayrılmışlar dahil) birimleriyle sınırlıdır (Ç10).
async function allowedDepartments(ctx: Ctx, conversationId: string): Promise<Set<number>> {
  const members = await ctx.db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(eq(conversationMembers.conversationId, conversationId));
  if (members.length === 0) return new Set();
  const deps = await ctx.db
    .select({ departmentId: userDepartments.departmentId })
    .from(userDepartments)
    .where(inArray(userDepartments.userId, members.map((m) => m.userId)));
  return new Set(deps.map((d) => d.departmentId));
}

// K7: kopyalama olayı hız sınırı, istemci başına dakikada en fazla 20 (öneri).
async function assertCopyRate(ctx: Ctx, userId: string): Promise<void> {
  const now = ctx.now();
  const windowStart = new Date(now.getTime() - MINUTE);
  const recent = await ctx.db
    .select({ at: accessLog.accessedAt })
    .from(accessLog)
    .where(and(eq(accessLog.userId, userId), eq(accessLog.action, "copy_blocked"), gt(accessLog.accessedAt, windowStart)))
    .orderBy(asc(accessLog.accessedAt));
  if (recent.length >= COPY_BLOCKED_PER_MINUTE) {
    throw new ApiError("RATE_LIMITED", undefined, undefined, retryAfter(recent[0]!.at, MINUTE, now));
  }
}

export async function createRequest(
  ctx: Ctx,
  actor: Actor,
  body: { client_request_id: string; conversation_id: string; reason: string; target_department_ids: number[] },
): Promise<{ status: 200 | 201; body: unknown }> {
  // İdempotency (Ç25)
  const [dup] = await ctx.db
    .select()
    .from(accessRequests)
    .where(and(eq(accessRequests.requesterId, actor.id), eq(accessRequests.clientRequestId, body.client_request_id)))
    .limit(1);
  if (dup) return { status: 200, body: await fullOf(ctx, dup) };

  enforce(validateReason(body.reason));
  await activeMembership(ctx.db, body.conversation_id, actor.id);

  const allowed = await allowedDepartments(ctx, body.conversation_id);
  const targetIds = [...new Set(body.target_department_ids)];
  if (targetIds.some((d) => !allowed.has(d))) throw new ApiError("TARGET_NOT_IN_CONVERSATION");

  const now = ctx.now();
  const rules = await loadRules(ctx.db);
  const created = await ctx.db.transaction(async (tx) => {
    const [r] = await tx
      .insert(accessRequests)
      .values({
        conversationId: body.conversation_id,
        requesterId: actor.id,
        reason: body.reason,
        clientRequestId: body.client_request_id,
        status: "pending",
        expiresAt: expiresAt(now, rules.requestExpiryHours),
        createdAt: now,
      })
      .returning();
    if (!r) throw new ApiError("INTERNAL_ERROR");
    await tx.insert(accessRequestTargets).values(
      targetIds.map((departmentId) => ({ requestId: r.requestId, requesterId: actor.id, departmentId, status: "pending" as const })),
    );
    return r;
  });
  return { status: 201, body: await fullOf(ctx, created) };
}

export async function listRequests(
  ctx: Ctx,
  actor: Actor,
  q: { role: "requester" | "approver"; status?: RequestStatus | undefined; cursor?: string | undefined; limit: number },
) {
  let rows: RequestRow[];
  if (q.role === "requester") {
    rows = await ctx.db
      .select()
      .from(accessRequests)
      .where(and(eq(accessRequests.requesterId, actor.id), q.status ? eq(accessRequests.status, q.status) : undefined));
  } else {
    const exec = await hasActiveExecutive(ctx.db);
    const canApprove = actor.role === "executive" || (actor.role === "system_admin" && !exec);
    if (!canApprove) return { items: [], next_cursor: null };
    rows = await ctx.db
      .select()
      .from(accessRequests)
      .where(eq(accessRequests.status, q.status ?? "pending"));
  }
  rows.sort((a, b) => (a.createdAt.getTime() === b.createdAt.getTime()
    ? (a.requestId < b.requestId ? 1 : -1)
    : b.createdAt.getTime() - a.createdAt.getTime()));
  const { page, nextCursor } = paginateDesc(rows, q.limit, q.cursor, (r) => ({
    key: r.createdAt.toISOString(),
    id: r.requestId,
  }));
  return { items: await Promise.all(page.map((r) => summaryOf(ctx, r))), next_cursor: nextCursor };
}

export async function getRequest(ctx: Ctx, actor: Actor, requestId: string) {
  const r = await loadRequest(ctx, requestId);
  if (!(await canSee(ctx, actor, r))) throw new ApiError("FORBIDDEN");
  return fullOf(ctx, r);
}

// Hedef kararı (§5.4 adım 3-7). Tüm hedefler onaylarsa talep onaylanır, biri reddederse talep reddedilir.
export async function decideTarget(
  ctx: Ctx,
  actor: Actor,
  requestId: string,
  departmentId: number,
  body: { decision: "approved" | "rejected"; note?: string | undefined },
) {
  const r = await loadRequest(ctx, requestId);
  const [target] = await ctx.db
    .select()
    .from(accessRequestTargets)
    .where(and(eq(accessRequestTargets.requestId, requestId), eq(accessRequestTargets.departmentId, departmentId)))
    .limit(1);
  if (!target) throw new ApiError("NOT_FOUND");

  const auth = canDecideTarget({
    actor,
    requesterId: r.requesterId,
    requestStatus: r.status,
    targetStatus: target.status,
    hasActiveExecutive: await hasActiveExecutive(ctx.db),
  });
  if (!auth.allowed) throw new ApiError(auth.code);

  const now = ctx.now();
  const rules = await loadRules(ctx.db);
  await ctx.db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(accessRequestTargets)
      .set({ status: body.decision, decidedBy: actor.id, decidedAt: now, decisionBasis: auth.basis })
      .where(
        and(
          eq(accessRequestTargets.requestId, requestId),
          eq(accessRequestTargets.departmentId, departmentId),
          eq(accessRequestTargets.status, "pending"),
        ),
      )
      .returning({ id: accessRequestTargets.departmentId });
    if (!claimed) throw new ApiError("REQUEST_NOT_PENDING");

    await tx.insert(accessLog).values({
      conversationId: r.conversationId,
      userId: actor.id,
      action: body.decision === "approved" ? "approve" : "reject",
      requestId,
      accessedAt: now,
    });

    const statuses = (await tx.select().from(accessRequestTargets).where(eq(accessRequestTargets.requestId, requestId)))
      .map((t) => t.status as TargetStatus);
    const next = aggregateRequestStatus(statuses);
    if (next === "rejected") {
      await tx
        .update(accessRequests)
        .set({ status: "rejected", closedAt: now })
        .where(and(eq(accessRequests.requestId, requestId), eq(accessRequests.status, "pending")));
    } else if (next === "approved") {
      await tx
        .update(accessRequests)
        .set({ status: "approved", closedAt: now, accessExpiresAt: accessExpiresAt(now, rules.accessWindowHours) })
        .where(and(eq(accessRequests.requestId, requestId), eq(accessRequests.status, "pending")));
    }
  });
  return fullOf(ctx, await loadRequest(ctx, requestId));
}

export async function withdrawRequest(ctx: Ctx, actor: Actor, requestId: string) {
  const r = await loadRequest(ctx, requestId);
  if (r.requesterId !== actor.id) throw new ApiError("FORBIDDEN");
  const now = ctx.now();
  const [updated] = await ctx.db
    .update(accessRequests)
    .set({ status: "withdrawn", closedAt: now })
    .where(and(eq(accessRequests.requestId, requestId), eq(accessRequests.status, "pending")))
    .returning();
  if (!updated) throw new ApiError("REQUEST_NOT_PENDING");
  return fullOf(ctx, updated);
}

// Ç14: süresi dolmuş talep yeniden açılır. Yeni kayıt önceki talebe bağlanır ve hedefleri yeniden alır.
export async function reopenRequest(ctx: Ctx, actor: Actor, requestId: string) {
  const r = await loadRequest(ctx, requestId);
  if (r.requesterId !== actor.id) throw new ApiError("FORBIDDEN");
  if (r.status !== "expired") throw new ApiError("REQUEST_NOT_PENDING");
  const oldTargets = await targetsOf(ctx, requestId);
  const now = ctx.now();
  const rules = await loadRules(ctx.db);
  const created = await ctx.db.transaction(async (tx) => {
    const [n] = await tx
      .insert(accessRequests)
      .values({
        conversationId: r.conversationId,
        requesterId: r.requesterId,
        reason: r.reason,
        clientRequestId: randomUUID(),
        reopenedFrom: r.requestId,
        status: "pending",
        expiresAt: expiresAt(now, rules.requestExpiryHours),
        createdAt: now,
      })
      .returning();
    if (!n) throw new ApiError("INTERNAL_ERROR");
    await tx.insert(accessRequestTargets).values(
      oldTargets.map((t) => ({ requestId: n.requestId, requesterId: r.requesterId, departmentId: t.departmentId, status: "pending" as const })),
    );
    return n;
  });
  return fullOf(ctx, created);
}

// İstemci olayı (Ç15): kopyalama denemesi access_log'a yazılır. Kayıt istemci beyanıdır.
export async function recordClientEvent(ctx: Ctx, actor: Actor, requestId: string, type: "copy_blocked"): Promise<void> {
  const r = await loadRequest(ctx, requestId);
  if (r.requesterId !== actor.id) throw new ApiError("FORBIDDEN");
  if (r.status !== "approved") throw new ApiError("CONTENT_NOT_VISIBLE");
  await assertCopyRate(ctx, actor.id);
  await ctx.db.insert(accessLog).values({
    conversationId: r.conversationId,
    userId: actor.id,
    action: type,
    requestId,
    accessedAt: ctx.now(),
  });
}

// §5.4 adım 5: onaylı talepte içerik, yalnızca talep eden, access_expires_at süresince. Her okuma loglanır.
export async function requesterContent(ctx: Ctx, actor: Actor, requestId: string) {
  const r = await loadRequest(ctx, requestId);
  const now = ctx.now();
  enforce(canReadApprovedContent(actor, r.requesterId, r.status, r.accessExpiresAt ?? new Date(0), now));
  const rows = await ctx.db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, r.conversationId))
    .orderBy(asc(messages.seq))
    .limit(CONTENT_PAGE_LIMIT + 1);
  await ctx.db.insert(accessLog).values({
    conversationId: r.conversationId,
    userId: actor.id,
    action: "read",
    requestId,
    accessedAt: now,
  });
  const page = rows.slice(0, CONTENT_PAGE_LIMIT);
  return {
    items: await serializeMessages(ctx, actor.id, r.conversationId, page),
    access_expires_at: r.accessExpiresAt,
    has_more: rows.length > CONTENT_PAGE_LIMIT,
  };
}

// K3: karar öncesi içerik, yalnızca patron, hedef pending iken. Her çağrı loglanır.
export async function targetContent(ctx: Ctx, actor: Actor, requestId: string, departmentId: number) {
  const r = await loadRequest(ctx, requestId);
  const [target] = await ctx.db
    .select()
    .from(accessRequestTargets)
    .where(and(eq(accessRequestTargets.requestId, requestId), eq(accessRequestTargets.departmentId, departmentId)))
    .limit(1);
  if (!target) throw new ApiError("NOT_FOUND");
  enforce(canReadTargetContent(actor, r.requesterId, target.status as TargetStatus));
  const rows = await ctx.db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, r.conversationId))
    .orderBy(asc(messages.seq))
    .limit(CONTENT_PAGE_LIMIT + 1);
  await ctx.db.insert(accessLog).values({
    conversationId: r.conversationId,
    userId: actor.id,
    action: "read",
    requestId,
    accessedAt: ctx.now(),
  });
  const page = rows.slice(0, CONTENT_PAGE_LIMIT);
  return {
    items: await serializeMessages(ctx, actor.id, r.conversationId, page),
    has_more: rows.length > CONTENT_PAGE_LIMIT,
  };
}

