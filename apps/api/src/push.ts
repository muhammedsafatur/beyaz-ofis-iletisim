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
  // Dönen liste, cihazı artık kayıtlı olmayan (DeviceNotRegistered) belirteçlerdir; çağıran bunları siler.
  send(messages: PushMessage[]): Promise<string[]>;
}

export const noPush: PushSender = {
  async send() {
    return [];
  },
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface ExpoTicket {
  status: "ok" | "error";
  details?: { error?: string };
}

// Expo Push servisi. En fazla 100 mesaj tek istekte; her mesaja bir bilet döner ve sırası isteği izler.
export function expoPushSender(fetchImpl: typeof fetch = fetch): PushSender {
  return {
    async send(messages) {
      const unregistered: string[] = [];
      for (let i = 0; i < messages.length; i += 100) {
        const batch = messages.slice(i, i + 100);
        const res = await fetchImpl(EXPO_PUSH_URL, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(batch),
        });
        if (!res.ok) throw new Error(`Expo push yanıtı: ${res.status}`);
        const body = (await res.json()) as { data?: ExpoTicket[] };
        (body.data ?? []).forEach((ticket, j) => {
          if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") unregistered.push(batch[j]!.to);
        });
      }
      return unregistered;
    },
  };
}

// Verilen kullanıcıların kayıtlı cihazlarına bildirim gönderir. Artık geçersiz belirteçler silinir. Hata mesaj akışını bozmaz.
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
    const gone = await ctx.push.send(
      rows.map((r) => ({ to: r.token, title: payload.title, body: payload.body, data: payload.data, sound: "default" as const })),
    );
    if (gone.length > 0) await ctx.db.delete(pushTokens).where(inArray(pushTokens.token, gone));
  } catch (err) {
    console.warn("[push] gönderilemedi:", err instanceof Error ? err.message : err);
  }
}
