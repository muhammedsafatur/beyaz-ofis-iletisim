import { createApiClient } from "./client";
import { connectRealtime, type WebSocketLike } from "./realtime";
import { createMemoryTokenStore } from "./tokens";

// Sahte fetch: yanıtları ve gelen istekleri kaydeder.
function fakeFetch(respond: (url: string, init?: RequestInit) => { status: number; body?: unknown }) {
  const seen: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), init });
    const r = respond(String(input), init);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fn, seen };
}

const BASE = "http://api.test/api/v1";

describe("dosya ekleri istemcisi", () => {
  it("yükleme ham gövdeyi ve dosya başlıklarını gönderir", async () => {
    const { fn, seen } = fakeFetch(() => ({ status: 201, body: { attachment_id: "a1", file_name: "rapor.pdf", content_type: "application/pdf", size_bytes: 3 } }));
    const api = createApiClient({ baseUrl: BASE, tokens: createMemoryTokenStore({ access_token: "T", refresh_token: "R", expires_in: 900 }), fetch: fn });
    const meta = await api.uploadAttachment("c1", { fileName: "rapor 2026.pdf", contentType: "application/pdf", bytes: new Uint8Array([1, 2, 3]) });
    expect(meta.attachment_id).toBe("a1");
    const init = seen[0]!.init!;
    expect(seen[0]!.url).toBe(`${BASE}/conversations/c1/attachments`);
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/pdf");
    expect((init.headers as Record<string, string>)["x-file-name"]).toBe(encodeURIComponent("rapor 2026.pdf"));
    expect(init.body).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("indirme bağlantısı mutlak adrese çevrilir", async () => {
    const { fn } = fakeFetch(() => ({ status: 200, body: { url: "/api/v1/attachments/a1/download?exp=1&sig=x", expires_at: "2026-10-15T10:05:00Z" } }));
    const api = createApiClient({ baseUrl: BASE, tokens: createMemoryTokenStore({ access_token: "T", refresh_token: "R", expires_in: 900 }), fetch: fn });
    expect(await api.downloadUrl("a1")).toBe("http://api.test/api/v1/attachments/a1/download?exp=1&sig=x");
  });

  it("mesaj gönderimi ek kimliğini taşır", async () => {
    const { fn, seen } = fakeFetch(() => ({ status: 201, body: {} }));
    const api = createApiClient({ baseUrl: BASE, tokens: createMemoryTokenStore({ access_token: "T", refresh_token: "R", expires_in: 900 }), fetch: fn });
    await api.sendMessage("c1", "cm-1", "ekte", { attachmentId: "a1" });
    expect(JSON.parse(String(seen[0]!.init!.body))).toEqual({ client_message_id: "cm-1", content: "ekte", attachment_id: "a1" });
  });
});

// Sahte WebSocket: sunucu tarafını elle sürer.
class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

describe("gerçek zamanlı bağlantı", () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it("belirteçle bağlanır, olayları iletir", async () => {
    const events: unknown[] = [];
    const conn = connectRealtime({
      url: "ws://api.test/api/v1/ws",
      getToken: async () => "TOK",
      onEvent: (e) => events.push(e),
      WebSocketImpl: FakeSocket,
    });
    await Promise.resolve();
    await Promise.resolve();
    const sock = FakeSocket.instances[0]!;
    expect(sock.url).toBe("ws://api.test/api/v1/ws?access_token=TOK");
    sock.onmessage!({ data: JSON.stringify({ type: "conversation.changed", conversation_id: "c1" }) });
    expect(events).toEqual([{ type: "conversation.changed", conversation_id: "c1" }]);
    conn.close();
    expect(sock.closed).toBe(true);
  });

  it("kopunca üstel geri çekilmeyle yeniden bağlanır, 4401'de denemez", async () => {
    connectRealtime({ url: "ws://api.test/ws", getToken: async () => "TOK", onEvent: () => undefined, WebSocketImpl: FakeSocket });
    await Promise.resolve();
    await Promise.resolve();
    FakeSocket.instances[0]!.onclose!({ code: 1006 });
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();
    expect(FakeSocket.instances.length).toBe(2);
    FakeSocket.instances[1]!.onclose!({ code: 4401 });
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(FakeSocket.instances.length).toBe(2);
  });
});
