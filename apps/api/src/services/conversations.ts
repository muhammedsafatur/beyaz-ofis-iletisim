import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { attachments, conversationMembers, conversations, messageRevisions, messages, users } from "@beyaz-ofis/db-schema";
import { ApiError, enforce } from "../errors.js";
import { canMessage } from "../policy/canMessage.js";
import { canChangeMessage, MESSAGE_EDIT_WINDOW_MS } from "../policy/window.js";
import { attachmentOut, claimForMessage } from "./attachments.js";
import { MINUTE, type CompanyLink, type PolicyUser } from "../policy/types.js";
import {
  activeMembership,
  appendMessage,
  bumpChange,
  isDepartmentManager,
  notifyConversation,
  loadCompanyLinks,
  loadRules,
  loadUser,
  paginateDesc,
  retryAfter,
  userSummary,
  type Actor,
  type Ctx,
  type Tx,
} from "./common.js";

type ConvRow = typeof conversations.$inferSelect;
type MemberRow = typeof conversationMembers.$inferSelect;

// Birebir konuşma anahtarı (B2): "küçük:büyük:bağlam|0".
export function directKey(a: string, b: string, contextCompanyId: number | null): string {
  const [x, y] = [a, b].sort();
  return `${x}:${y}:${contextCompanyId ?? 0}`;
}

// §5.3 şirketler arası bağlam: aktif bağlantısı olan, gönderen tarafındaki şirketler.
export function contextOptions(sender: PolicyUser, target: PolicyUser, links: CompanyLink[]): number[] {
  const set = new Set<number>();
  for (const s of sender.companyIds) {
    for (const t of target.companyIds) {
      const low = Math.min(s, t);
      const high = Math.max(s, t);
      if (links.some((l) => l.low === low && l.high === high && !l.revoked)) set.add(s);
    }
  }
  return [...set].sort((x, y) => x - y);
}

function sharesCompany(a: PolicyUser, b: PolicyUser): boolean {
  return a.companyIds.some((c) => b.companyIds.includes(c));
}

// Birebir konuşmada bağlamı belirler. Aynı şirketteyse bağlam yoktur.
function resolveContext(
  sender: PolicyUser,
  target: PolicyUser,
  links: CompanyLink[],
  requested: number | undefined,
): number | null {
  if (sharesCompany(sender, target)) return null;
  const options = contextOptions(sender, target, links);
  if (requested !== undefined) {
    if (!options.includes(requested)) throw new ApiError("VALIDATION_FAILED", "Geçersiz şirket bağlamı.");
    return requested;
  }
  if (options.length === 1) return options[0] ?? null;
  throw new ApiError("CONTEXT_CHOICE_REQUIRED", undefined, { context_options: options });
}

// Konuşmanın üyeleri (ayrılmışlar dahil) ve konuşma özeti.
async function membersOf(ctx: Ctx, conversationId: string) {
  return ctx.db
    .select({ m: conversationMembers, u: users })
    .from(conversationMembers)
    .innerJoin(users, eq(users.userId, conversationMembers.userId))
    .where(eq(conversationMembers.conversationId, conversationId))
    .orderBy(asc(conversationMembers.joinedAt));
}

// K1: üyenin last_read_at değeri yalnızca isteği yapanın kendi kaydında dolu döner.
async function conversationDetail(ctx: Ctx, actor: Actor, conv: ConvRow) {
  const rows = await membersOf(ctx, conv.conversationId);
  return {
    conversation_id: conv.conversationId,
    type: conv.type,
    name: conv.type === "direct" ? null : conv.name,
    department_id: conv.departmentId,
    company_context_id: conv.companyContextId,
    last_message_at: conv.lastMessageAt,
    updated_at: conv.updatedAt,
    members: rows.map((r) => ({
      user: userSummary(r.u),
      joined_at: r.m.joinedAt,
      left_at: r.m.leftAt,
      last_read_at: r.m.userId === actor.id ? r.m.lastReadAt : null,
    })),
  };
}

async function unreadCount(ctx: Ctx, actorId: string, m: MemberRow): Promise<number> {
  const [r] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, m.conversationId),
        eq(messages.messageType, "text"),
        isNull(messages.deletedAt),
        sql`${messages.senderUserId} <> ${actorId}`,
        m.lastReadAt ? gt(messages.sentAt, m.lastReadAt) : sql`true`,
      ),
    );
  return r?.n ?? 0;
}

export async function listConversations(
  ctx: Ctx,
  actor: Actor,
  q: { cursor?: string | undefined; limit: number; updatedAfter?: Date | undefined },
) {
  const rows = await ctx.db
    .select({ m: conversationMembers, c: conversations })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.conversationId, conversationMembers.conversationId))
    .where(
      and(
        eq(conversationMembers.userId, actor.id),
        isNull(conversationMembers.leftAt),
        isNull(conversations.deletedAt),
        q.updatedAfter ? gt(conversations.updatedAt, q.updatedAfter) : undefined,
      ),
    );

  const items = await Promise.all(
    rows.map(async (r) => ({
      conv: r.c,
      summary: {
        conversation_id: r.c.conversationId,
        type: r.c.type,
        name: r.c.type === "direct" ? null : r.c.name,
        last_message_at: r.c.lastMessageAt,
        unread_count: await unreadCount(ctx, actor.id, r.m),
        is_muted: r.m.isMuted,
        updated_at: r.c.updatedAt,
      },
    })),
  );
  items.sort((a, b) => {
    const ka = a.conv.lastMessageAt?.toISOString() ?? "";
    const kb = b.conv.lastMessageAt?.toISOString() ?? "";
    return ka < kb ? 1 : ka > kb ? -1 : a.conv.conversationId < b.conv.conversationId ? 1 : -1;
  });
  const { page, nextCursor } = paginateDesc(items, q.limit, q.cursor, (i) => ({
    key: i.conv.lastMessageAt?.toISOString() ?? "",
    id: i.conv.conversationId,
  }));
  return { items: page.map((i) => i.summary), next_cursor: nextCursor };
}

export async function getConversation(ctx: Ctx, actor: Actor, conversationId: string) {
  const { conversation } = await activeMembership(ctx.db, conversationId, actor.id);
  return conversationDetail(ctx, actor, conversation);
}

// Grup kurucusu ya da birim kanalında birim yöneticisi üye ekleyip çıkarabilir (Ç8).
async function assertMembershipAuthority(ctx: Ctx, actor: Actor, conv: ConvRow): Promise<void> {
  if (conv.type === "group") {
    if (conv.createdBy === actor.id) return;
    throw new ApiError("FORBIDDEN");
  }
  if (conv.type === "department" && conv.departmentId !== null) {
    if (await isDepartmentManager(ctx.db, conv.departmentId, actor.id)) return;
  }
  throw new ApiError("FORBIDDEN");
}

async function displayName(ctx: Ctx, userId: string): Promise<string> {
  const u = await loadUser(ctx.db, userId);
  return u ? `${u.firstName} ${u.lastName}` : "Kullanıcı";
}

export async function createConversation(
  ctx: Ctx,
  actor: Actor,
  body: { type: "direct" | "group"; name?: string | undefined; member_ids: string[]; company_context_id?: number | undefined },
) {
  const memberIds = [...new Set(body.member_ids)].filter((id) => id !== actor.id);
  const links = await loadCompanyLinks(ctx.db);
  const now = ctx.now();

  if (body.type === "direct") {
    if (memberIds.length !== 1) throw new ApiError("VALIDATION_FAILED", "Birebir konuşmada tek hedef gerekir.");
    const target = await loadUser(ctx.db, memberIds[0]!);
    if (!target) throw new ApiError("NOT_FOUND");
    enforce(canMessage(actor, target, links));
    const context = resolveContext(actor, target, links, body.company_context_id);
    const key = directKey(actor.id, target.id, context);

    const [existing] = await ctx.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.directKey, key), isNull(conversations.deletedAt)))
      .limit(1);
    if (existing) return { status: 200 as const, body: await conversationDetail(ctx, actor, existing) };

    const created = await ctx.db
      .transaction(async (tx) => {
        const [c] = await tx
          .insert(conversations)
          .values({ type: "direct", createdBy: actor.id, directKey: key, companyContextId: context, createdAt: now, updatedAt: now })
          .returning();
        if (!c) throw new ApiError("INTERNAL_ERROR");
        await tx.insert(conversationMembers).values([
          { conversationId: c.conversationId, userId: actor.id, joinedAt: now },
          { conversationId: c.conversationId, userId: target.id, joinedAt: now },
        ]);
        return c;
      })
      .catch(async (e) => {
        // Eşzamanlı istekte aynı birebir konuşma başka bir istekle açıldıysa onu döndür (B2)
        if (isUniqueViolation(e)) {
          const [again] = await ctx.db
            .select()
            .from(conversations)
            .where(and(eq(conversations.directKey, key), isNull(conversations.deletedAt)))
            .limit(1);
          if (again) return again;
        }
        throw e;
      });
    await notifyConversation(ctx, created.conversationId);
    return { status: 201 as const, body: await conversationDetail(ctx, actor, created) };
  }

  // Grup: her aktif çalışan oluşturabilir (Ç7). Her üye için canMessage geçmelidir.
  const targets: PolicyUser[] = [];
  for (const id of memberIds) {
    const t = await loadUser(ctx.db, id);
    if (!t) throw new ApiError("NOT_FOUND");
    enforce(canMessage(actor, t, links));
    targets.push(t);
  }
  const group = await ctx.db.transaction(async (tx) => {
    const [c] = await tx
      .insert(conversations)
      .values({ type: "group", name: body.name ?? null, createdBy: actor.id, createdAt: now, updatedAt: now })
      .returning();
    if (!c) throw new ApiError("INTERNAL_ERROR");
    await tx.insert(conversationMembers).values([actor.id, ...targets.map((t) => t.id)].map((userId) => ({
      conversationId: c.conversationId,
      userId,
      joinedAt: now,
    })));
    return c;
  });
  await notifyConversation(ctx, group.conversationId);
  return { status: 201 as const, body: await conversationDetail(ctx, actor, group) };
}

export async function addMembers(ctx: Ctx, actor: Actor, conversationId: string, userIds: string[]) {
  const { conversation } = await activeMembership(ctx.db, conversationId, actor.id);
  await assertMembershipAuthority(ctx, actor, conversation);
  const links = await loadCompanyLinks(ctx.db);
  const now = ctx.now();

  for (const userId of [...new Set(userIds)]) {
    const target = await loadUser(ctx.db, userId);
    if (!target || target.deleted) throw new ApiError("NOT_FOUND");
    enforce(canMessage(actor, target, links));
    const [row] = await ctx.db
      .select()
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)))
      .limit(1);
    if (row && row.leftAt === null) throw new ApiError("ALREADY_MEMBER");

    const name = `${target.firstName} ${target.lastName}`;
    await ctx.db.transaction(async (tx) => {
      if (row) {
        await tx
          .update(conversationMembers)
          .set({ leftAt: null, joinedAt: now })
          .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
      } else {
        await tx.insert(conversationMembers).values({ conversationId, userId, joinedAt: now });
      }
      await appendMessage(tx, {
        conversationId,
        senderId: null,
        type: "system",
        content: `${name} katıldı`,
        clientMessageId: randomUUID(),
        now,
      });
    });
    await notifyConversation(ctx, conversationId);
  }
  return conversationDetail(ctx, actor, conversation);
}

export async function removeMember(ctx: Ctx, actor: Actor, conversationId: string, userId: string): Promise<void> {
  const { conversation } = await activeMembership(ctx.db, conversationId, actor.id);
  await assertMembershipAuthority(ctx, actor, conversation);
  const [row] = await ctx.db
    .select()
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)))
    .limit(1);
  if (!row || row.leftAt !== null) throw new ApiError("NOT_FOUND");
  const now = ctx.now();
  const name = await displayName(ctx, userId);
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(conversationMembers)
      .set({ leftAt: now })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
    await appendMessage(tx, {
      conversationId,
      senderId: null,
      type: "system",
      content: `${name} konuşmadan çıkarıldı`,
      clientMessageId: randomUUID(),
      now,
    });
  });
  await notifyConversation(ctx, conversationId);
}

export async function markRead(ctx: Ctx, actor: Actor, conversationId: string): Promise<void> {
  await activeMembership(ctx.db, conversationId, actor.id);
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(conversationMembers)
      .set({ lastReadAt: now })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, actor.id)));
    // K4: okundu olayı konuşmanın updated_at değerini günceller
    await tx.update(conversations).set({ updatedAt: now }).where(eq(conversations.conversationId, conversationId));
  });
}

export async function setMute(ctx: Ctx, actor: Actor, conversationId: string, isMuted: boolean) {
  await activeMembership(ctx.db, conversationId, actor.id);
  await ctx.db
    .update(conversationMembers)
    .set({ isMuted })
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, actor.id)));
  return { is_muted: isMuted };
}

// Ön kontrol (yalnızca arayüz, karar sunucuda). Politika kararını açıklayıcı biçimde döner.
export async function canSendPreview(ctx: Ctx, actor: Actor, targetUserId: string) {
  const target = await loadUser(ctx.db, targetUserId);
  if (!target) throw new ApiError("NOT_FOUND");
  const links = await loadCompanyLinks(ctx.db);
  const decision = canMessage(actor, target, links);
  const options = sharesCompany(actor, target) ? [] : contextOptions(actor, target, links);
  if (!decision.allowed) {
    return { allowed: false, reason: new ApiError(decision.code).message, context_options: options };
  }
  return { allowed: true, reason: null, context_options: options };
}

// --- Mesajlar ---

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

// Yanıt biçimi. Okundu sayıları yalnızca gönderenin kendi mesajlarında dolu döner (K2).
export async function serializeMessages(ctx: Ctx, viewerId: string, conversationId: string, rows: (typeof messages.$inferSelect)[]) {
  const members = await ctx.db
    .select()
    .from(conversationMembers)
    .where(eq(conversationMembers.conversationId, conversationId));
  const senderIds = [...new Set(rows.map((r) => r.senderUserId).filter((s): s is string => s !== null))];
  const senders = senderIds.length
    ? await ctx.db.select().from(users).where(inArray(users.userId, senderIds))
    : [];
  const senderMap = new Map(senders.map((u) => [u.userId, u]));
  const msgIds = rows.map((r) => r.messageId);
  const linked = msgIds.length ? await ctx.db.select().from(attachments).where(inArray(attachments.messageId, msgIds)) : [];
  const attachmentByMessage = new Map(linked.map((a) => [a.messageId!, a]));
  const [conv] = await ctx.db.select().from(conversations).where(eq(conversations.conversationId, conversationId)).limit(1);

  return rows.map((m) => {
    const sender = m.senderUserId ? senderMap.get(m.senderUserId) : undefined;
    const own = m.senderUserId === viewerId;
    let readCount: number | null = null;
    let readByPeer: boolean | null = null;
    if (own && m.messageType === "text") {
      const others = members.filter((x) => x.userId !== m.senderUserId);
      const readAfter = (x: MemberRow) => x.lastReadAt !== null && x.lastReadAt.getTime() > m.sentAt.getTime();
      if (conv?.type === "direct") readByPeer = others.some(readAfter);
      else readCount = others.filter((x) => x.leftAt === null && readAfter(x)).length;
    }
    return {
      message_id: m.messageId,
      conversation_id: m.conversationId,
      sender: sender ? userSummary(sender) : null,
      client_message_id: m.clientMessageId,
      seq: m.seq,
      change_seq: m.changeSeq,
      content: m.deletedAt ? null : m.content,
      message_type: m.messageType,
      sent_at: m.sentAt,
      edited_at: m.editedAt,
      deleted: m.deletedAt !== null,
      edit_window_closes_at: own ? new Date(m.sentAt.getTime() + MESSAGE_EDIT_WINDOW_MS) : null,
      read_count: readCount,
      read_by_peer: readByPeer,
      attachment: attachmentByMessage.has(m.messageId) ? attachmentOut(attachmentByMessage.get(m.messageId)!) : null,
    };
  });
}

export async function listMessages(
  ctx: Ctx,
  actor: Actor,
  conversationId: string,
  q: { before_seq?: number | undefined; after_seq?: number | undefined; after_change_seq?: number | undefined; limit: number },
) {
  const provided = [q.before_seq, q.after_seq, q.after_change_seq].filter((v) => v !== undefined).length;
  if (provided > 1) throw new ApiError("VALIDATION_FAILED", "Sayfalama parametreleri birlikte kullanılamaz.");
  await activeMembership(ctx.db, conversationId, actor.id);
  const base = eq(messages.conversationId, conversationId);
  const take = q.limit + 1;

  let rows: (typeof messages.$inferSelect)[];
  let newestFirst = false;
  if (q.after_change_seq !== undefined) {
    rows = await ctx.db
      .select()
      .from(messages)
      .where(and(base, gt(messages.changeSeq, q.after_change_seq)))
      .orderBy(asc(messages.changeSeq))
      .limit(take);
  } else if (q.after_seq !== undefined) {
    rows = await ctx.db
      .select()
      .from(messages)
      .where(and(base, gt(messages.seq, q.after_seq)))
      .orderBy(asc(messages.seq))
      .limit(take);
  } else {
    // Ç23: before_seq yoksa en yeni mesajlar (ilk yükleme dahil)
    newestFirst = true;
    rows = await ctx.db
      .select()
      .from(messages)
      .where(q.before_seq !== undefined ? and(base, lt(messages.seq, q.before_seq)) : base)
      .orderBy(desc(messages.seq))
      .limit(take);
  }
  const hasMore = rows.length > q.limit;
  let page = rows.slice(0, q.limit);
  if (newestFirst) page = page.reverse();
  return { items: await serializeMessages(ctx, actor.id, conversationId, page), has_more: hasMore };
}

function directPeer(members: MemberRow[], actorId: string): MemberRow | undefined {
  return members.find((m) => m.userId !== actorId);
}

export async function postMessage(
  ctx: Ctx,
  actor: Actor,
  conversationId: string,
  body: { client_message_id: string; content: string; attachment_id?: string | undefined },
): Promise<{ status: 200 | 201; body: unknown }> {
  const { conversation } = await activeMembership(ctx.db, conversationId, actor.id);

  // İdempotency: aynı gönderen ve istemci kimliği ilk mesajın sonucunu döner
  const [dup] = await ctx.db
    .select()
    .from(messages)
    .where(and(eq(messages.senderUserId, actor.id), eq(messages.clientMessageId, body.client_message_id)))
    .limit(1);
  if (dup) return { status: 200, body: (await serializeMessages(ctx, actor.id, conversationId, [dup]))[0] };

  const members = await ctx.db.select().from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
  if (conversation.type === "direct") {
    const peer = directPeer(members, actor.id);
    const peerUser = peer ? await loadUser(ctx.db, peer.userId) : null;
    if (peerUser) enforce(canMessage(actor, peerUser, await loadCompanyLinks(ctx.db)));
  }

  // K7: mesaj hız sınırı, son 1 dakikada gönderenin satırları (silinmişler dahil)
  const now = ctx.now();
  const windowStart = new Date(now.getTime() - MINUTE);
  const rules = await loadRules(ctx.db);
  const recent = await ctx.db
    .select({ sentAt: messages.sentAt })
    .from(messages)
    .where(and(eq(messages.senderUserId, actor.id), gt(messages.sentAt, windowStart)))
    .orderBy(asc(messages.sentAt));
  if (recent.length >= rules.messageRatePerMin) {
    const oldest = recent[0]!.sentAt;
    throw new ApiError("RATE_LIMITED", undefined, undefined, retryAfter(oldest, MINUTE, now));
  }

  try {
    const m = await ctx.db.transaction(async (tx) => {
      const row = await appendMessage(tx, {
        conversationId,
        senderId: actor.id,
        type: "text",
        content: body.content,
        clientMessageId: body.client_message_id,
        now,
      });
      if (body.attachment_id) await claimForMessage(tx, body.attachment_id, conversationId, actor.id, row.messageId);
      return row;
    });
    await notifyConversation(ctx, conversationId);
    return { status: 201, body: (await serializeMessages(ctx, actor.id, conversationId, [m]))[0] };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const [again] = await ctx.db
      .select()
      .from(messages)
      .where(and(eq(messages.senderUserId, actor.id), eq(messages.clientMessageId, body.client_message_id)))
      .limit(1);
    if (!again) throw e;
    return { status: 200, body: (await serializeMessages(ctx, actor.id, conversationId, [again]))[0] };
  }
}

async function loadMessage(ctx: Ctx, messageId: string) {
  const [m] = await ctx.db.select().from(messages).where(eq(messages.messageId, messageId)).limit(1);
  if (!m) throw new ApiError("NOT_FOUND");
  return m;
}

export async function editMessage(ctx: Ctx, actor: Actor, messageId: string, content: string) {
  const m = await loadMessage(ctx, messageId);
  const now = ctx.now();
  enforce(
    canChangeMessage({ senderId: m.senderUserId ?? "", sentAt: m.sentAt, deleted: m.deletedAt !== null }, actor, now),
  );
  await ctx.db.transaction(async (tx) => {
    await tx.insert(messageRevisions).values({ messageId, content: m.content, revisionType: "edit", createdAt: now });
    const changeSeq = await bumpChange(tx, m.conversationId, now);
    await tx
      .update(messages)
      .set({ content, editedAt: now, changeSeq })
      .where(eq(messages.messageId, messageId));
  });
  await notifyConversation(ctx, m.conversationId);
  const [fresh] = await ctx.db.select().from(messages).where(eq(messages.messageId, messageId)).limit(1);
  return (await serializeMessages(ctx, actor.id, m.conversationId, [fresh!]))[0];
}

export async function deleteMessage(ctx: Ctx, actor: Actor, messageId: string): Promise<void> {
  const m = await loadMessage(ctx, messageId);
  const now = ctx.now();
  enforce(
    canChangeMessage({ senderId: m.senderUserId ?? "", sentAt: m.sentAt, deleted: m.deletedAt !== null }, actor, now),
  );
  await ctx.db.transaction(async (tx: Tx) => {
    await tx.insert(messageRevisions).values({ messageId, content: m.content, revisionType: "delete", createdAt: now });
    const changeSeq = await bumpChange(tx, m.conversationId, now);
    await tx
      .update(messages)
      .set({ deletedAt: now, changeSeq })
      .where(eq(messages.messageId, messageId));
  });
  await notifyConversation(ctx, m.conversationId);
}

