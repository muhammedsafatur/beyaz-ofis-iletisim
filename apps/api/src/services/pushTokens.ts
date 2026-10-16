import { and, eq } from "drizzle-orm";
import { pushTokens } from "@beyaz-ofis/db-schema";
import type { Actor, Ctx } from "./common.js";

// Bir belirteç yalnızca bir kullanıcıya bağlıdır: yeni kayıt eskisini devralır.
export async function registerPushToken(ctx: Ctx, actor: Actor, token: string, platform: "ios" | "android" | "desktop"): Promise<void> {
  const now = ctx.now();
  await ctx.db
    .insert(pushTokens)
    .values({ token, userId: actor.id, platform, createdAt: now, lastSeenAt: now })
    .onConflictDoUpdate({ target: pushTokens.token, set: { userId: actor.id, platform, lastSeenAt: now } });
}

export async function removePushToken(ctx: Ctx, actor: Actor, token: string): Promise<void> {
  await ctx.db.delete(pushTokens).where(and(eq(pushTokens.token, token), eq(pushTokens.userId, actor.id)));
}
