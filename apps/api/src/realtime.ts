// Gerçek zamanlı kanal (Faz 2): kullanıcı başına bağlantılar. Olaylar yalnızca kimlik ve konu bilgisi taşır,
// mesaj içeriği taşımaz; istemci değişikliği delta uçlarından çeker (K4).
export type RealtimeEvent = { type: "conversation.changed"; conversation_id: string } | { type: "hello" };

export interface Realtime {
  subscribe(userId: string, send: (payload: string) => void): () => void;
  publish(userIds: string[], event: RealtimeEvent): void;
  connectionCount(): number;
}

export function createRealtime(): Realtime {
  const byUser = new Map<string, Set<(payload: string) => void>>();
  return {
    subscribe(userId, send) {
      const set = byUser.get(userId) ?? new Set();
      set.add(send);
      byUser.set(userId, set);
      return () => {
        set.delete(send);
        if (set.size === 0) byUser.delete(userId);
      };
    },
    publish(userIds, event) {
      const payload = JSON.stringify(event);
      for (const id of new Set(userIds)) {
        for (const send of byUser.get(id) ?? []) {
          try {
            send(payload);
          } catch {
            // Kopuk bağlantı: yayın diğer alıcıları etkilemez, bağlantı kapanışında temizlenir.
          }
        }
      }
    },
    connectionCount() {
      let n = 0;
      for (const set of byUser.values()) n += set.size;
      return n;
    },
  };
}
