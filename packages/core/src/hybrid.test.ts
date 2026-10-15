import type { ApiClient } from "./client";
import { SyncEngine } from "./sync";
import type { ConversationSummary } from "./types";

const conv = (id: string, updatedAt: string): ConversationSummary => ({
  conversation_id: id,
  type: "group",
  name: id,
  last_message_at: null,
  unread_count: 0,
  is_muted: false,
  updated_at: updatedAt,
});

function fakeApi() {
  return {
    listConversations: jest.fn(async (_p: { cursor?: string; updatedAfter?: string }) => ({ items: [] as ConversationSummary[], next_cursor: null as string | null })),
    listMessages: jest.fn(async () => ({ items: [], has_more: false })),
  };
}

describe("hibrit senkron: gerçek zamanlı olaylar", () => {
  it("üyelik değişimi olayında konuşma listesi tam yenilenir (çıkarılan konuşma kaybolur)", async () => {
    const api = fakeApi();
    api.listConversations
      .mockResolvedValueOnce({ items: [conv("c1", "2026-10-15T10:00:00Z"), conv("c2", "2026-10-15T10:00:00Z")], next_cursor: null })
      .mockResolvedValueOnce({ items: [], next_cursor: null })
      .mockResolvedValueOnce({ items: [conv("c2", "2026-10-15T10:00:00Z")], next_cursor: null })
      .mockResolvedValueOnce({ items: [], next_cursor: null });
    const engine = new SyncEngine(api as unknown as ApiClient);
    await engine.refreshConversations(true);
    expect(engine.getSnapshot().conversations.map((c) => c.conversation_id).sort()).toEqual(["c1", "c2"]);
    await engine.handleRealtime({ type: "membership.changed", conversation_id: "c1" });
    expect(engine.getSnapshot().conversations.map((c) => c.conversation_id)).toEqual(["c2"]);
  });

  it("anma olayı anma listesine eklenir, temizlenebilir", async () => {
    const api = fakeApi();
    const engine = new SyncEngine(api as unknown as ApiClient);
    await engine.handleRealtime({ type: "mention", conversation_id: "c1", message_id: "m9" });
    expect(engine.getSnapshot().mentions).toEqual([{ conversation_id: "c1", message_id: "m9" }]);
    engine.clearMentions();
    expect(engine.getSnapshot().mentions).toEqual([]);
  });

  it("yoklama aralığı değiştirilebilir: bağlantı açılınca uzar, kopunca geri döner", () => {
    jest.useFakeTimers();
    try {
      const api = fakeApi();
      const engine = new SyncEngine(api as unknown as ApiClient);
      engine.start(() => [], 3000);
      engine.setPollInterval(30_000);
      jest.advanceTimersByTime(3000);
      expect(api.listConversations).toHaveBeenCalledTimes(0);
      jest.advanceTimersByTime(27_000);
      expect(api.listConversations).toHaveBeenCalledTimes(1);
      engine.setPollInterval(3000);
      jest.advanceTimersByTime(3000);
      expect(api.listConversations).toHaveBeenCalledTimes(2);
      engine.stop();
    } finally {
      jest.useRealTimers();
    }
  });
});
