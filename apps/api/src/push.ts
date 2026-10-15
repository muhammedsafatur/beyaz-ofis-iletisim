import { inArray } from "drizzle-orm";
import { pushTokens } from "@beyaz-ofis/db-schema";
import type { Ctx } from "./services/common.js";

// Push bildirimi. İçerik gönderilmez: yalnızca "yeni mesaj" ya da "sizi andılar" gibi genel metin gider.
export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default";
}

export interface PushSender {
  send(messages: PushMessage[]): Promise<void>;
}

export const noPush: PushSender = {
  async send() {
    return undefined;
  },
};

// Expo Push servisi (https://exp.host/--/api/v2/push/send). En fazla 100 mesaj tek istekte.
export function expoPushSender(fetchImpl: typeof fetch = fetch): PushSender {
  return {
    async send(messages) {
      for (let i = 0; i < messages.length; i += 100) {
        const res = await fetchImpl("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(messages.slice(i, i + 100)),
        });
        if (!res.ok) throw new Error(`Expo push yanıtı: ${res.status}`);
      }
    },
  };
}

// Verilen kullanıcıların kayıtlı cihazlarına bildirim gönderir. Hata mesaj akışını bozmaz.
export async function pushToUsers(
  ctx: Ctx,
  userIds: string[],
  payload: { title: string; body: string; data: Record<string, unknown> },
): Promise<void> {
  if (userIds.length === 0) return;
  try {
    const rows = await ctx.db
      .select({ token: pushTokens.token })
      .from(pushTokens)
      .where(inArray(pushTokens.userId, userIds));
    if (rows.length === 0) return;
    await ctx.push.send(rows.map((r) => ({ to: r.token, title: payload.title, body: payload.body, data: payload.data, sound: "default" as const })));
  } catch (err) {
    console.warn("[push] gönderilemedi:", err instanceof Error ? err.message : err);
  }
}
