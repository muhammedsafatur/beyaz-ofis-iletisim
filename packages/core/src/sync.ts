import type { ApiClient } from "./client.js";
import type { ConversationSummary, Message } from "./types.js";

// Senkronizasyon motoru: sunucuyu delta ile izler (Faz 1, polling; WebSocket Faz 2).
//  - Konuşma listesi: updated_after ile değişenler, arada tam listeleme (kapanan üyelikler için).
//  - Açık konuşma: after_change_seq ile yeni, düzenlenmiş ve silinmiş mesajlar (K4).
//  - Gönderilen mesajlar iyimser eklenir, sunucu yanıtıyla tek kayda indirgenir.

export type PendingState = "sending" | "failed";

export interface LocalMessage extends Message {
  pending?: PendingState;
}

export interface ConversationView {
  messages: LocalMessage[];
  hasOlder: boolean;
  lastSeq: number;
  lastChangeSeq: number;
  loaded: boolean;
}

export interface SyncSnapshot {
  conversations: ConversationSummary[];
  views: Record<string, ConversationView>;
  // Son görülen en yüksek updated_at (sunucu değeri). Sonraki delta bunun üzerinden istenir.
  updatedAfter: string | null;
  lastError: string | null;
}

const emptyView = (): ConversationView => ({ messages: [], hasOlder: false, lastSeq: 0, lastChangeSeq: 0, loaded: false });
const PAGE = 50;
// Her bu kadar turda bir tam konuşma listesi alınır (kapanan üyelikler delta ile gelmez).
const FULL_REFRESH_EVERY = 10;

function bySeq(a: LocalMessage, b: LocalMessage): number {
  const sa = a.pending ? Number.MAX_SAFE_INTEGER : a.seq;
  const sb = b.pending ? Number.MAX_SAFE_INTEGER : b.seq;
  return sa - sb;
}

export interface SyncOptions {
  newId?: () => string;
}

export class SyncEngine {
  private snapshot: SyncSnapshot = { conversations: [], views: {}, updatedAfter: null, lastError: null };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticks = 0;
  private readonly newId: () => string;

  constructor(
    private readonly api: ApiClient,
    opts: SyncOptions = {},
  ) {
    this.newId = opts.newId ?? (() => globalThis.crypto.randomUUID());
  }

  getSnapshot(): SyncSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<SyncSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  private setView(id: string, patch: Partial<ConversationView>): void {
    const current = this.snapshot.views[id] ?? emptyView();
    this.set({ views: { ...this.snapshot.views, [id]: { ...current, ...patch } } });
  }

  // Konuşma listesi. full=true tüm listeyi yeniden alır.
  async refreshConversations(full = false): Promise<void> {
    const after = full ? undefined : this.snapshot.updatedAfter ?? undefined;
    const fetched: ConversationSummary[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.api.listConversations({ cursor, limit: 100, updatedAfter: after });
      fetched.push(...page.items);
      cursor = page.next_cursor ?? undefined;
    } while (cursor);

    const merged = full
      ? fetched
      : [...this.snapshot.conversations.filter((c) => !fetched.some((f) => f.conversation_id === c.conversation_id)), ...fetched];
    merged.sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? "") || a.conversation_id.localeCompare(b.conversation_id));
    const newest = fetched.reduce<string | null>((max, c) => (max === null || c.updated_at > max ? c.updated_at : max), this.snapshot.updatedAfter);
    this.set({ conversations: merged, updatedAfter: newest });
  }

  // Açık konuşmanın ilk yüklemesi: en yeni mesajlar.
  async openConversation(id: string): Promise<void> {
    const page = await this.api.listMessages(id, { limit: PAGE });
    const items = page.items as LocalMessage[];
    this.setView(id, {
      messages: [...items].sort(bySeq),
      hasOlder: page.has_more,
      lastSeq: Math.max(0, ...items.map((m) => m.seq)),
      lastChangeSeq: Math.max(0, ...items.map((m) => m.change_seq)),
      loaded: true,
    });
  }

  // Yeni, düzenlenmiş ve silinmiş mesajları çeker (K4). Aynı mesaj kimliği tekrar gelirse üzerine yazılır.
  async syncConversation(id: string): Promise<void> {
    const view = this.snapshot.views[id];
    if (!view?.loaded) return;
    let cursor = view.lastChangeSeq;
    let messages = view.messages;
    let lastSeq = view.lastSeq;
    let lastChangeSeq = view.lastChangeSeq;
    for (;;) {
      const page = await this.api.listMessages(id, { afterChangeSeq: cursor, limit: PAGE });
      for (const m of page.items as LocalMessage[]) {
        messages = messages.filter((x) => x.message_id !== m.message_id && !(x.pending && x.client_message_id === m.client_message_id));
        messages.push(m);
        lastSeq = Math.max(lastSeq, m.seq);
        lastChangeSeq = Math.max(lastChangeSeq, m.change_seq);
      }
      cursor = lastChangeSeq;
      if (!page.has_more) break;
    }
    // Okundu bilgisi (K2) mesajın change_seq değerini değiştirmez; delta ile gelmez. Son sayfadaki
    // okundu alanları her turda yenilenir. Ölçek küçük olduğu için bu ucuzdur.
    const latest = await this.api.listMessages(id, { limit: PAGE });
    const receipts = new Map(latest.items.map((m) => [m.message_id, m]));
    messages = messages.map((m) => {
      const fresh = receipts.get(m.message_id);
      if (!fresh || m.pending) return m;
      return { ...m, read_count: fresh.read_count, read_by_peer: fresh.read_by_peer };
    });
    this.setView(id, { messages: [...messages].sort(bySeq), lastSeq, lastChangeSeq });
  }

  // Daha eski mesajlar (before_seq).
  async loadOlder(id: string): Promise<void> {
    const view = this.snapshot.views[id];
    if (!view?.loaded || !view.hasOlder) return;
    const oldest = Math.min(...view.messages.filter((m) => !m.pending).map((m) => m.seq));
    const page = await this.api.listMessages(id, { beforeSeq: oldest, limit: PAGE });
    const known = new Set(view.messages.map((m) => m.message_id));
    const older = (page.items as LocalMessage[]).filter((m) => !known.has(m.message_id));
    this.setView(id, { messages: [...older, ...view.messages].sort(bySeq), hasOlder: page.has_more });
  }

  // Gönderim: iyimser ekleme. Sunucu yanıtı aynı client_message_id ile kaydı değiştirir (idempotent).
  async send(id: string, content: string, sender: LocalMessage["sender"] = null): Promise<void> {
    const clientId = this.newId();
    const pendingMsg: LocalMessage = {
      message_id: `local:${clientId}`,
      conversation_id: id,
      sender,
      client_message_id: clientId,
      seq: 0,
      change_seq: 0,
      content,
      message_type: "text",
      sent_at: new Date().toISOString(),
      edited_at: null,
      deleted: false,
      edit_window_closes_at: null,
      read_count: null,
      read_by_peer: null,
      pending: "sending",
    };
    const view = this.snapshot.views[id] ?? emptyView();
    this.setView(id, { messages: [...view.messages, pendingMsg].sort(bySeq) });
    try {
      const saved = await this.api.sendMessage(id, clientId, content);
      const current = this.snapshot.views[id] ?? emptyView();
      const rest = current.messages.filter((m) => m.client_message_id !== clientId && m.message_id !== saved.message_id);
      this.setView(id, {
        messages: [...rest, saved as LocalMessage].sort(bySeq),
        lastSeq: Math.max(current.lastSeq, saved.seq),
        lastChangeSeq: Math.max(current.lastChangeSeq, saved.change_seq),
      });
    } catch (err) {
      const current = this.snapshot.views[id] ?? emptyView();
      this.setView(id, {
        messages: current.messages.map((m) => (m.client_message_id === clientId ? { ...m, pending: "failed" as const } : m)),
      });
      throw err;
    }
  }

  async tick(openIds: string[]): Promise<void> {
    try {
      this.ticks += 1;
      await this.refreshConversations(this.ticks % FULL_REFRESH_EVERY === 1);
      for (const id of openIds) {
        if (!this.snapshot.views[id]?.loaded) await this.openConversation(id);
        else await this.syncConversation(id);
      }
      this.set({ lastError: null });
    } catch (err) {
      this.set({ lastError: err instanceof Error ? err.message : "Bilinmeyen hata" });
    }
  }

  start(openIds: () => string[], intervalMs = 3000): void {
    this.stop();
    this.timer = setInterval(() => void this.tick(openIds()), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
