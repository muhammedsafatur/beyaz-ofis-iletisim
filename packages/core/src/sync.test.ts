import type { ApiClient } from "./client";
import { SyncEngine } from "./sync";
import type { ConversationSummary, Message, MessagePage } from "./types";

const conv = (id: string, updatedAt: string, lastMessageAt: string | null = null): ConversationSummary => ({
  conversation_id: id,
  type: "group",
  name: id,
  last_message_at: lastMessageAt,
  unread_count: 0,
  is_muted: false,
  updated_at: updatedAt,
});

const msg = (id: string, seq: number, changeSeq: number, content: string, extra: Partial<Message> = {}): Message => ({
  message_id: id,
  conversation_id: "c1",
  sender: null,
  client_message_id: `cm-${id}`,
  seq,
  change_seq: changeSeq,
  content,
  message_type: "text",
  sent_at: "2026-10-15T10:00:00.000Z",
  edited_at: null,
  deleted: false,
  edit_window_closes_at: null,
  read_count: null,
  read_by_peer: null,
  ...extra,
});

// Sahte API istemcisi: test her uç için ne dönmesi gerektiğini ayarlar.
function fakeApi() {
  const api = {
    listConversations: jest.fn(async (_p: { cursor?: string; updatedAfter?: string }) => ({ items: [] as ConversationSummary[], next_cursor: null as string | null })),
    listMessages: jest.fn(async (_id: string, _p: { beforeSeq?: number; afterChangeSeq?: number; limit?: number }) => ({ items: [] as Message[], has_more: false }) as MessagePage),
    sendMessage: jest.fn(async (_id: string, clientId: string, content: string): Promise<Message> => msg("srv-1", 1, 1, content, { client_message_id: clientId })),
  };
  return api;
}

describe("senkronizasyon motoru", () => {
  it("konuşma listesi ilk alımda tümünü, sonra yalnızca updated_after ile değişenleri ister", async () => {
    const api = fakeApi();
    api.listConversations
      .mockResolvedValueOnce({ items: [conv("c1", "2026-10-15T10:00:00Z")], next_cursor: null })
      .mockResolvedValueOnce({ items: [conv("c2", "2026-10-15T11:00:00Z")], next_cursor: null });
    const engine = new SyncEngine(api as unknown as ApiClient);
    await engine.refreshConversations(true);
    await engine.refreshConversations();
    expect(api.listConversations.mock.calls[1]![0]).toMatchObject({ updatedAfter: "2026-10-15T10:00:00Z" });
    expect(engine.getSnapshot().conversations.map((c) => c.conversation_id).sort()).toEqual(["c1", "c2"]);
    expect(engine.getSnapshot().updatedAfter).toBe("2026-10-15T11:00:00Z");
  });

  it("açık konuşma en yeni mesajlarla açılır, delta yeni, düzenlenmiş ve silinmiş mesajları birleştirir", async () => {
    const api = fakeApi();
    api.listMessages
      .mockResolvedValueOnce({ items: [msg("m1", 1, 1, "ilk"), msg("m2", 2, 2, "ikinci")], has_more: false })
      .mockResolvedValueOnce({
        items: [msg("m1", 1, 3, "ilk (düzeltildi)"), msg("m3", 3, 4, "üçüncü"), msg("m2", 2, 5, "", { deleted: true, content: null })],
        has_more: false,
      });
    const engine = new SyncEngine(api as unknown as ApiClient);
    await engine.openConversation("c1");
    await engine.syncConversation("c1");
    const view = engine.getSnapshot().views["c1"]!;
    expect(api.listMessages.mock.calls[1]![1]).toMatchObject({ afterChangeSeq: 2 });
    expect(view.messages.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(view.messages[0]!.content).toBe("ilk (düzeltildi)");
    expect(view.messages[1]!.deleted).toBe(true);
    expect(view.lastChangeSeq).toBe(5);
  });

  it("delta birden fazla sayfaya yayılırsa has_more bitene kadar çeker", async () => {
    const api = fakeApi();
    api.listMessages
      .mockResolvedValueOnce({ items: [], has_more: false })
      .mockResolvedValueOnce({ items: [msg("a", 1, 1, "a")], has_more: true })
      .mockResolvedValueOnce({ items: [msg("b", 2, 2, "b")], has_more: false });
    const engine = new SyncEngine(api as unknown as ApiClient);
    await engine.openConversation("c1");
    await engine.syncConversation("c1");
    expect(engine.getSnapshot().views["c1"]!.messages.map((m) => m.message_id)).toEqual(["a", "b"]);
  });

  it("gönderim iyimser eklenir, sunucu yanıtıyla tek kayda indirgenir", async () => {
    const api = fakeApi();
    const engine = new SyncEngine(api as unknown as ApiClient, { newId: () => "cid-1" });
    api.listMessages.mockResolvedValueOnce({ items: [], has_more: false });
    await engine.openConversation("c1");
    await engine.send("c1", "merhaba");
    const messages = engine.getSnapshot().views["c1"]!.messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]!.pending).toBeUndefined();
    expect(messages[0]!.message_id).toBe("srv-1");
    expect(api.sendMessage).toHaveBeenCalledWith("c1", "cid-1", "merhaba");
  });

  it("gönderim başarısızsa mesaj 'failed' işaretlenir ve hata iletilir", async () => {
    const api = fakeApi();
    api.sendMessage.mockRejectedValueOnce(new Error("ağ yok"));
    const engine = new SyncEngine(api as unknown as ApiClient, { newId: () => "cid-2" });
    api.listMessages.mockResolvedValueOnce({ items: [], has_more: false });
    await engine.openConversation("c1");
    await expect(engine.send("c1", "gitmeyecek")).rejects.toThrow("ağ yok");
    expect(engine.getSnapshot().views["c1"]!.messages[0]!.pending).toBe("failed");
  });

  it("tick hatası dinleyicilere ve lastError alanına yansır, ayakta kalır", async () => {
    const api = fakeApi();
    api.listConversations.mockRejectedValueOnce(new Error("sunucu kapalı"));
    const engine = new SyncEngine(api as unknown as ApiClient);
    const seen: boolean[] = [];
    engine.subscribe(() => seen.push(true));
    await engine.tick([]);
    expect(engine.getSnapshot().lastError).toBe("sunucu kapalı");
    expect(seen.length).toBeGreaterThan(0);
  });
});
