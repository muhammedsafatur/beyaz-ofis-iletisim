import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { hash, verify } from "@node-rs/argon2";
import jwt from "jsonwebtoken";
import { invitations, refreshTokens, users } from "@beyaz-ofis/db-schema";
import { ApiError } from "../errors.js";
import { HOUR } from "../policy/types.js";
import type { Db } from "../db.js";
import { loadActor, type Ctx, type Tx } from "./common.js";

// B4: erişim belirteci 15 dakika, yenileme belirteci 30 gün.
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * HOUR;
// Davet süresi: 3 gün (öneri; uygulama yapılandırmasında değil, kodda sabit).
export const INVITE_TTL_MS = 3 * 24 * HOUR;

export const UNUSABLE_PASSWORD_HASH = "!davet-bekliyor";

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    // Kullanılamaz kayıt (ör. davet bekliyor) ya da bozuk hash: giriş reddedilir
    return false;
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function signAccess(userId: string, secret: string): string {
  return jwt.sign({ sub: userId }, secret, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
}

// Erişim belirtecini doğrular, kullanıcı kimliğini döndürür.
// Erişim belirteci gerçek saate göre doğrulanır (süre kontrolü ctx.now'a bağlı değildir).
export function verifyAccess(token: string, secret: string): string {
  try {
    const payload = jwt.verify(token, secret);
    if (typeof payload === "object" && payload.sub) return payload.sub;
    throw new ApiError("UNAUTHENTICATED");
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof jwt.TokenExpiredError) throw new ApiError("TOKEN_EXPIRED");
    throw new ApiError("UNAUTHENTICATED");
  }
}

async function issue(ctx: Ctx, db: Db | Tx, userId: string, familyId: string, tokenId: string) {
  const raw = randomToken();
  const now = ctx.now();
  await db.insert(refreshTokens).values({
    tokenId,
    userId,
    tokenHash: sha256(raw),
    familyId,
    expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
    createdAt: now,
  });
  return {
    access_token: signAccess(userId, ctx.jwtSecret),
    refresh_token: raw,
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
  };
}

export async function login(ctx: Ctx, email: string, password: string) {
  const [u] = await ctx.db
    .select()
    .from(users)
    .where(and(sql`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)))
    .limit(1);
  if (!u || !(await verifyPassword(u.passwordHash, password))) throw new ApiError("UNAUTHENTICATED");
  if (!u.isActive) throw new ApiError("ACCOUNT_INACTIVE");
  return issue(ctx, ctx.db, u.userId, randomUUID(), randomUUID());
}

// B4: rotasyon. Rotate edilmiş bir belirteç tekrar gelirse aynı aile iptal edilir.
export async function refresh(ctx: Ctx, raw: string) {
  const [row] = await ctx.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(raw))).limit(1);
  if (!row) throw new ApiError("UNAUTHENTICATED");
  const now = ctx.now();
  if (row.revokedAt) {
    await ctx.db
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
    throw new ApiError("REFRESH_TOKEN_REUSED");
  }
  if (row.expiresAt.getTime() <= now.getTime()) throw new ApiError("TOKEN_EXPIRED");
  const actor = await loadActor(ctx.db, row.userId);
  if (!actor || actor.deleted) throw new ApiError("UNAUTHENTICATED");
  if (!actor.isActive) throw new ApiError("ACCOUNT_INACTIVE");

  // Önce yeni belirteç yazılır, sonra eskisi işaretlenir (replaced_by yabancı anahtarı için).
  const newId = randomUUID();
  const tokens = await ctx.db.transaction(async (tx) => {
    const fresh = await issue(ctx, tx, row.userId, row.familyId, newId);
    const [claimed] = await tx
      .update(refreshTokens)
      .set({ revokedAt: now, replacedBy: newId })
      .where(and(eq(refreshTokens.tokenId, row.tokenId), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.tokenId });
    if (!claimed) throw new ApiError("REFRESH_TOKEN_REUSED");
    return fresh;
  });
  return tokens;
}

// Tek oturumu kapatır: belirtecin ailesi (B4).
export async function logout(ctx: Ctx, raw: string): Promise<void> {
  const [row] = await ctx.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(raw))).limit(1);
  if (!row) return;
  await ctx.db
    .update(refreshTokens)
    .set({ revokedAt: ctx.now() })
    .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
}

// Tüm cihazlardan çıkış.
export async function logoutAll(ctx: Ctx, userId: string): Promise<void> {
  await ctx.db
    .update(refreshTokens)
    .set({ revokedAt: ctx.now() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}

// Ç16: davet oluşturur, token'ın yalnızca hash'i saklanır, ham hali gönderici arayüzüne gider.
export async function createInvitation(ctx: Ctx, userId: string, email: string, createdBy: string): Promise<void> {
  const raw = randomToken();
  const now = ctx.now();
  await ctx.db.insert(invitations).values({
    userId,
    tokenHash: sha256(raw),
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    createdBy,
    createdAt: now,
  });
  await ctx.invites.send(email, raw);
}

export async function acceptInvite(ctx: Ctx, token: string, password: string): Promise<void> {
  const now = ctx.now();
  const [inv] = await ctx.db
    .select()
    .from(invitations)
    .where(
      and(eq(invitations.tokenHash, sha256(token)), isNull(invitations.usedAt), gt(invitations.expiresAt, now)),
    )
    .limit(1);
  if (!inv) throw new ApiError("INVITATION_INVALID");
  const passwordHash = await hashPassword(password);
  await ctx.db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(invitations)
      .set({ usedAt: now })
      .where(and(eq(invitations.invitationId, inv.invitationId), isNull(invitations.usedAt)))
      .returning({ id: invitations.invitationId });
    if (!claimed) throw new ApiError("INVITATION_INVALID");
    await tx.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.userId, inv.userId));
  });
}
