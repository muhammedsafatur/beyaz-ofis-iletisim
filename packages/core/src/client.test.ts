import { ApiRequestError, createApiClient } from "./client";
import { createMemoryTokenStore } from "./tokens";
import type { Tokens } from "./types";

type Call = { method: string; url: string; auth?: string; body?: unknown };

// Sahte fetch: her çağrıyı kaydeder, yanıtı sıradaki işleyiciden alır.
function fakeFetch(handlers: ((c: Call) => { status: number; body?: unknown; headers?: Record<string, string> })[]) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = {
      method: init?.method ?? "GET",
      url: String(input),
      auth: headers.authorization,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const next = handlers.shift();
    if (!next) throw new Error(`Beklenmeyen istek: ${call.method} ${call.url}`);
    const r = next(call);
    const text = r.body === undefined ? "" : JSON.stringify(r.body);
    return new Response(text === "" ? null : text, { status: r.status, headers: r.headers });
  }) as typeof fetch;
  return { fn, calls };
}

const tokens = (access: string, refresh: string): Tokens => ({ access_token: access, refresh_token: refresh, expires_in: 900 });
const BASE = "http://api.test/api/v1";

describe("API istemcisi", () => {
  it("giriş belirteçleri kaydeder ve sonraki istekte yetkilendirme başlığı gönderir", async () => {
    const store = createMemoryTokenStore();
    const { fn, calls } = fakeFetch([
      () => ({ status: 200, body: tokens("A1", "R1") }),
      () => ({ status: 200, body: { user_id: "u1", role: "employee" } }),
    ]);
    const api = createApiClient({ baseUrl: BASE, tokens: store, fetch: fn });
    await api.auth.login("ali@x.test", "parola-123456");
    expect(await store.load()).toEqual(tokens("A1", "R1"));
    await api.me();
    expect(calls[1]!.auth).toBe("Bearer A1");
  });

  it("401 gelince belirteci yeniler ve isteği bir kez tekrarlar", async () => {
    const store = createMemoryTokenStore(tokens("OLD", "R1"));
    const { fn, calls } = fakeFetch([
      () => ({ status: 401, body: { error: { code: "TOKEN_EXPIRED", message: "süre doldu" } } }),
      () => ({ status: 200, body: tokens("NEW", "R2") }),
      () => ({ status: 200, body: { user_id: "u1" } }),
    ]);
    const api = createApiClient({ baseUrl: BASE, tokens: store, fetch: fn });
    await expect(api.me()).resolves.toEqual({ user_id: "u1" });
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/users/me`, `${BASE}/auth/refresh`, `${BASE}/users/me`]);
    expect(calls[2]!.auth).toBe("Bearer NEW");
    expect((await store.load())?.refresh_token).toBe("R2");
  });

  it("yenileme başarısızsa belirteçleri siler ve hatayı iletir", async () => {
    const store = createMemoryTokenStore(tokens("OLD", "R1"));
    const { fn } = fakeFetch([
      () => ({ status: 401, body: { error: { code: "UNAUTHENTICATED", message: "x" } } }),
      () => ({ status: 401, body: { error: { code: "REFRESH_TOKEN_REUSED", message: "y" } } }),
    ]);
    const api = createApiClient({ baseUrl: BASE, tokens: store, fetch: fn });
    await expect(api.me()).rejects.toMatchObject({ code: "REFRESH_TOKEN_REUSED", status: 401 });
    expect(await store.load()).toBeNull();
  });

  it("429 yanıtında Retry-After değerini hataya taşır", async () => {
    const store = createMemoryTokenStore(tokens("A", "R"));
    const { fn } = fakeFetch([
      () => ({
        status: 429,
        body: { error: { code: "RATE_LIMITED", message: "çok fazla" } },
        headers: { "retry-after": "42" },
      }),
    ]);
    const api = createApiClient({ baseUrl: BASE, tokens: store, fetch: fn });
    const err = await api.sendMessage("c1", "id-1", "merhaba").catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.retryAfter).toBe(42);
  });

  it("sayfalama parametrelerini sorgu dizgisine çevirir, tanımsızları atlar", async () => {
    const store = createMemoryTokenStore(tokens("A", "R"));
    const { fn, calls } = fakeFetch([() => ({ status: 200, body: { items: [], has_more: false } })]);
    const api = createApiClient({ baseUrl: BASE, tokens: store, fetch: fn });
    await api.listMessages("c1", { afterChangeSeq: 7, limit: 50 });
    expect(calls[0]!.url).toBe(`${BASE}/conversations/c1/messages?after_change_seq=7&limit=50`);
  });

  it("çıkış sunucuya bildirir ve yerel belirteçleri siler", async () => {
    const store = createMemoryTokenStore(tokens("A", "R"));
    const { fn, calls } = fakeFetch([() => ({ status: 204 })]);
    const api = createApiClient({ baseUrl: BASE, tokens: store, fetch: fn });
    await api.auth.logout();
    expect(calls[0]).toMatchObject({ method: "POST", url: `${BASE}/auth/logout`, body: { refresh_token: "R" } });
    expect(await store.load()).toBeNull();
  });
});
