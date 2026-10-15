// Gerçek zamanlı bağlantı (Faz 2). Sunucu olay gönderdiğinde istemci değişikliği delta uçlarından çeker.
// Bağlantı koparsa üstel geri çekilmeyle yeniden kurulur; yoklama (SyncEngine.start) yedek olarak sürer.

export interface RealtimeEvent {
  type: "hello" | "conversation.changed";
  conversation_id?: string;
}

export interface RealtimeOptions {
  // ws:// ya da wss:// adresi, örn. ws://host/api/v1/ws
  url: string;
  getToken: () => Promise<string | null>;
  onEvent: (event: RealtimeEvent) => void;
  onStatus?: (connected: boolean) => void;
  // Test ve ortam uyumu için; varsayılan global WebSocket.
  WebSocketImpl?: new (url: string) => WebSocketLike;
  maxBackoffMs?: number;
}

export interface WebSocketLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  close(code?: number, reason?: string): void;
}

export function connectRealtime(opts: RealtimeOptions): { close(): void } {
  const Impl = opts.WebSocketImpl ?? (globalThis as unknown as { WebSocket: new (url: string) => WebSocketLike }).WebSocket;
  const maxBackoff = opts.maxBackoffMs ?? 30_000;
  let attempt = 0;
  let closed = false;
  let socket: WebSocketLike | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function open() {
    if (closed) return;
    const token = await opts.getToken();
    if (!token) return;
    socket = new Impl(`${opts.url}?access_token=${encodeURIComponent(token)}`);
    socket.onopen = () => {
      attempt = 0;
      opts.onStatus?.(true);
    };
    socket.onmessage = (ev) => {
      try {
        opts.onEvent(JSON.parse(String(ev.data)) as RealtimeEvent);
      } catch {
        // Bozuk iletiler yok sayılır; yoklama bir sonraki turda eksiği tamamlar.
      }
    };
    socket.onclose = (ev) => {
      opts.onStatus?.(false);
      // 4401: kimlik geçersiz, yeniden denemek anlamsız
      if (closed || ev.code === 4401) return;
      attempt += 1;
      const delay = Math.min(1000 * 2 ** (attempt - 1), maxBackoff);
      timer = setTimeout(() => void open(), delay);
    };
  }

  void open();
  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      socket?.close(1000, "istemci kapattı");
    },
  };
}
