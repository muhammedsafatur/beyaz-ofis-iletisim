import type { ErrorCode } from "./domain/errors.js";
import type { TokenStore } from "./tokens.js";
import type { Conversation, ConversationPage, Message, MessagePage, Tokens, UserSummary } from "./types.js";

// Sunucudan dönen kapalı katalog hatası (spec 9.1). retryAfter yalnızca 429 için dolu.
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | string,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  tokens: TokenStore;
  fetch?: typeof fetch;
}

interface RawResponse {
  status: number;
  json: unknown;
  headers: Headers | undefined;
}

export function createApiClient(opts: ApiClientOptions) {
  const doFetch = opts.fetch ?? globalThis.fetch;
  let refreshing: Promise<Tokens | null> | null = null;

  async function raw(method: string, path: string, body?: unknown, token?: string): Promise<RawResponse> {
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await doFetch(opts.baseUrl + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = res.status === 204 ? "" : await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : undefined, headers: res.headers };
  }

  function toError(r: RawResponse): ApiRequestError {
    const err = (r.json as { error?: { code?: string; message?: string } } | undefined)?.error;
    const retry = Number(r.headers?.get("retry-after"));
    return new ApiRequestError(
      r.status,
      err?.code ?? "INTERNAL_ERROR",
      err?.message ?? "İstek başarısız.",
      Number.isFinite(retry) && retry > 0 ? retry : undefined,
    );
  }

  // Eşzamanlı yenilemeler tek bir isteğe indirgenir.
  function refreshTokens(): Promise<Tokens | null> {
    if (!refreshing) {
      refreshing = (async () => {
        const current = await opts.tokens.load();
        if (!current) return null;
        const r = await raw("POST", "/auth/refresh", { refresh_token: current.refresh_token });
        if (r.status !== 200) {
          // Yenileme reddedildi: oturum kapanır, asıl neden (ör. REFRESH_TOKEN_REUSED) çağırana iletilir
          await opts.tokens.clear();
          throw toError(r);
        }
        const next = r.json as Tokens;
        await opts.tokens.save(next);
        return next;
      })().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
    const current = await opts.tokens.load();
    const r = await raw(method, path, body, current?.access_token);
    if (r.status >= 200 && r.status < 300) return r.json as T;
    // Süresi dolmuş erişim belirteci: bir kez yenile ve isteği tekrarla
    if (r.status === 401 && retry && current) {
      // refreshTokens başarısızsa hata fırlatır; asıl neden çağırana ulaşır
      const fresh = await refreshTokens();
      if (fresh) return request<T>(method, path, body, false);
    }
    throw toError(r);
  }

  function query(params: Record<string, string | number | undefined>): string {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string | number][];
    if (entries.length === 0) return "";
    const search = new URLSearchParams();
    for (const [k, v] of entries) search.append(k, String(v));
    return "?" + search.toString();
  }

  return {
    auth: {
      async login(email: string, password: string): Promise<Tokens> {
        const r = await raw("POST", "/auth/login", { email, password });
        if (r.status !== 200) throw toError(r);
        const tokens = r.json as Tokens;
        await opts.tokens.save(tokens);
        return tokens;
      },
      async logout(): Promise<void> {
        const current = await opts.tokens.load();
        if (current) await raw("POST", "/auth/logout", { refresh_token: current.refresh_token });
        await opts.tokens.clear();
      },
    },
    me: (): Promise<UserSummary & { role: string }> => request("GET", "/users/me"),
    listConversations(params: { cursor?: string; limit?: number; updatedAfter?: string } = {}): Promise<ConversationPage> {
      return request("GET", `/conversations${query({ cursor: params.cursor, limit: params.limit, updated_after: params.updatedAfter })}`);
    },
    getConversation: (id: string): Promise<Conversation> => request("GET", `/conversations/${id}`),
    listMessages(
      id: string,
      params: { beforeSeq?: number; afterSeq?: number; afterChangeSeq?: number; limit?: number } = {},
    ): Promise<MessagePage> {
      return request(
        "GET",
        `/conversations/${id}/messages${query({
          before_seq: params.beforeSeq,
          after_seq: params.afterSeq,
          after_change_seq: params.afterChangeSeq,
          limit: params.limit,
        })}`,
      );
    },
    sendMessage: (id: string, clientMessageId: string, content: string): Promise<Message> =>
      request("POST", `/conversations/${id}/messages`, { client_message_id: clientMessageId, content }),
    editMessage: (messageId: string, content: string): Promise<Message> =>
      request("PATCH", `/messages/${messageId}`, { content }),
    deleteMessage: (messageId: string): Promise<void> => request("DELETE", `/messages/${messageId}`),
    markRead: (id: string): Promise<void> => request("POST", `/conversations/${id}/read`),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
