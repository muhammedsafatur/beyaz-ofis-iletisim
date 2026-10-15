import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { colors, radius, spacing } from "@beyaz-ofis/ui-tokens";
import {
  ApiRequestError,
  createApiClient,
  createMemoryTokenStore,
  SyncEngine,
  type ConversationSummary,
  type LocalMessage,
  type UserSummary,
} from "@beyaz-ofis/core";

// Geliştirmede Vite proxy'si /api isteklerini yerel API'ye iletir. Paketlenmiş sürümde VITE_API_URL verilir.
const API_URL: string = import.meta.env.VITE_API_URL ?? "/api/v1";
const POLL_MS = 3000;

// Masaüstünde belirteçler Electron safeStorage ile saklanacak; bu sürümde bellek içi (kalıcı değil).
const tokens = createMemoryTokenStore();
const api = createApiClient({ baseUrl: API_URL, tokens });
const engine = new SyncEngine(api);

function useSnapshot() {
  return useSyncExternalStore(
    (listener) => engine.subscribe(listener),
    () => engine.getSnapshot(),
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });

function errorText(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.code === "RATE_LIMITED" && err.retryAfter) return `Çok hızlı gönderiyorsunuz. ${err.retryAfter} sn sonra deneyin.`;
    return err.message;
  }
  return err instanceof Error ? err.message : "Bir hata oluştu.";
}

function LoginView({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("ali@demo.test");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onLogin(email, password);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} data-testid="login-form" style={styles.login}>
      <h1 style={{ margin: 0 }}>Beyaz Ofis</h1>
      <label style={styles.label}>
        E-posta
        <input data-testid="email" style={styles.input} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      </label>
      <label style={styles.label}>
        Parola
        <input
          data-testid="password"
          type="password"
          style={styles.input}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </label>
      {error && <p data-testid="login-error" style={{ color: "#B91C1C", margin: 0 }}>{error}</p>}
      <button data-testid="login-submit" type="submit" disabled={busy} style={styles.primary}>
        {busy ? "Giriş yapılıyor…" : "Giriş yap"}
      </button>
    </form>
  );
}

function Sidebar({
  conversations,
  names,
  selected,
  onSelect,
  onLogout,
  me,
}: {
  conversations: ConversationSummary[];
  names: Record<string, string>;
  selected: string | null;
  onSelect: (id: string) => void;
  onLogout: () => void;
  me: UserSummary;
}) {
  return (
    <aside style={styles.sidebar} data-testid="sidebar">
      <div style={styles.sidebarHead}>
        <strong>
          {me.first_name} {me.last_name}
        </strong>
        <button data-testid="logout" onClick={onLogout} style={styles.linkButton}>
          Çıkış
        </button>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {conversations.map((c) => {
          const title = c.type === "direct" ? names[c.conversation_id] ?? "Birebir konuşma" : c.name ?? "Konuşma";
          const active = c.conversation_id === selected;
          return (
            <li key={c.conversation_id}>
              <button
                data-testid="conversation-item"
                data-conversation={c.conversation_id}
                onClick={() => onSelect(c.conversation_id)}
                style={{ ...styles.convItem, background: active ? colors.surface : "transparent" }}
              >
                <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
                {c.unread_count > 0 && <span style={styles.badge}>{c.unread_count}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function receiptText(m: LocalMessage): string | null {
  if (m.read_by_peer === true) return "Okundu";
  if (typeof m.read_count === "number") return m.read_count > 0 ? `${m.read_count} kişi okudu` : "İletildi";
  if (m.read_by_peer === false) return "İletildi";
  return null;
}

function MessageView({
  me,
  id,
  name,
  messages,
  hasOlder,
  onLoadOlder,
  onSend,
}: {
  me: UserSummary;
  id: string;
  name: string;
  messages: LocalMessage[];
  hasOlder: boolean;
  onLoadOlder: () => void;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [id, messages.length]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    setText("");
    onSend(content);
  }

  return (
    <section style={styles.main} data-testid="message-view" data-conversation={id}>
      <header style={styles.header}>{name}</header>
      <div style={styles.messages}>
        {hasOlder && (
          <button data-testid="load-older" onClick={onLoadOlder} style={styles.linkButton}>
            Daha eski mesajlar
          </button>
        )}
        {messages.map((m) => {
          if (m.message_type === "system") {
            return (
              <p key={m.message_id} data-testid="system-message" style={styles.system}>
                {m.content}
              </p>
            );
          }
          const mine = m.sender?.user_id === me.user_id;
          const receipt = mine ? receiptText(m) : null;
          return (
            <div key={m.message_id} data-testid="message" data-pending={m.pending ?? ""} style={{ ...styles.bubbleRow, justifyContent: mine ? "flex-end" : "flex-start" }}>
              <div style={{ ...styles.bubble, background: mine ? "#DBEAFE" : colors.surface }}>
                {!mine && <div style={styles.sender}>{m.sender ? `${m.sender.first_name} ${m.sender.last_name}` : ""}</div>}
                <div>{m.deleted ? <em style={{ color: colors.textMuted }}>Mesaj silindi</em> : m.content}</div>
                <div style={styles.meta}>
                  {m.edited_at && !m.deleted ? "düzenlendi · " : ""}
                  {time(m.sent_at)}
                  {m.pending === "sending" && " · gönderiliyor"}
                  {m.pending === "failed" && " · gönderilemedi"}
                  {receipt && !m.pending ? ` · ${receipt}` : ""}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={send} style={styles.composer}>
        <input
          data-testid="composer"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Mesaj yazın"
          style={{ ...styles.input, flex: 1 }}
          maxLength={4000}
        />
        <button data-testid="send" type="submit" style={styles.primary} disabled={!text.trim()}>
          Gönder
        </button>
      </form>
    </section>
  );
}

export default function App() {
  const snapshot = useSnapshot();
  const [me, setMe] = useState<UserSummary | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  // Açık konuşmaya yeni mesaj gelince okundu olarak işaretle (yan listedeki sayaç sıfırlanır).
  const openCount = selected ? snapshot.views[selected]?.messages.length ?? 0 : 0;
  useEffect(() => {
    if (me && selected && snapshot.views[selected]?.loaded) void api.markRead(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, openCount, me]);

  // Birebir konuşmalarda karşı tarafın adını bir kez çek (liste özetinde yalnızca tip var).
  useEffect(() => {
    if (!me) return;
    for (const c of snapshot.conversations) {
      if (c.type !== "direct" || names[c.conversation_id]) continue;
      void api.getConversation(c.conversation_id).then((detail) => {
        const other = detail.members.find((m) => m.user.user_id !== me.user_id);
        if (other) setNames((n) => ({ ...n, [c.conversation_id]: `${other.user.first_name} ${other.user.last_name}` }));
      });
    }
  }, [snapshot.conversations, me, names]);

  async function login(email: string, password: string) {
    await api.auth.login(email, password);
    const user = await api.me();
    setMe(user);
    await engine.refreshConversations(true);
    engine.start(() => (selectedRef.current ? [selectedRef.current] : []), POLL_MS);
  }

  async function logout() {
    engine.stop();
    await api.auth.logout();
    setMe(null);
    setSelected(null);
    setNames({});
  }

  async function select(id: string) {
    setSelected(id);
    const view = engine.getSnapshot().views[id];
    if (!view?.loaded) await engine.openConversation(id);
    await api.markRead(id);
  }

  if (!me) {
    return (
      <main style={styles.center}>
        <LoginView onLogin={login} />
      </main>
    );
  }

  const view = selected ? snapshot.views[selected] : undefined;
  const conv = snapshot.conversations.find((c) => c.conversation_id === selected);
  const title = conv ? (conv.type === "direct" ? names[conv.conversation_id] ?? "Birebir konuşma" : conv.name ?? "Konuşma") : "";

  return (
    <main style={styles.app}>
      <Sidebar
        conversations={snapshot.conversations}
        names={names}
        selected={selected}
        onSelect={select}
        onLogout={logout}
        me={me}
      />
      {selected && view?.loaded ? (
        <MessageView
          me={me}
          id={selected}
          name={title}
          messages={view.messages}
          hasOlder={view.hasOlder}
          onLoadOlder={() => void engine.loadOlder(selected)}
          onSend={(t) => void engine.send(selected, t, me).catch(() => undefined)}
        />
      ) : (
        <section style={styles.main}>
          <p style={{ color: colors.textMuted, padding: spacing.lg }}>Bir konuşma seçin.</p>
        </section>
      )}
      {snapshot.lastError && (
        <div data-testid="sync-error" style={styles.banner}>
          Bağlantı sorunu: {snapshot.lastError}
        </div>
      )}
    </main>
  );
}

const styles = {
  center: { minHeight: "100vh", display: "grid", placeItems: "center", background: colors.background } as const,
  login: { display: "grid", gap: spacing.md, width: 320, padding: spacing.lg, background: colors.background, borderRadius: radius.lg, boxShadow: "0 1px 4px rgba(0,0,0,.1)" } as const,
  label: { display: "grid", gap: spacing.xs, fontSize: 13, color: colors.textMuted } as const,
  input: { padding: spacing.sm, borderRadius: radius.sm, border: "1px solid #CBD5E1", fontSize: 14 } as const,
  primary: { padding: `${spacing.sm}px ${spacing.md}px`, borderRadius: radius.sm, border: 0, background: colors.accent, color: "#fff", cursor: "pointer" } as const,
  linkButton: { background: "none", border: 0, color: colors.accent, cursor: "pointer", padding: spacing.xs } as const,
  app: { display: "grid", gridTemplateColumns: "280px 1fr", height: "100vh", fontFamily: "system-ui, sans-serif", color: colors.text, background: colors.background } as const,
  sidebar: { borderRight: "1px solid #E2E8F0", background: colors.surface, overflowY: "auto" } as const,
  sidebarHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: spacing.md, borderBottom: "1px solid #E2E8F0" } as const,
  convItem: { display: "flex", width: "100%", alignItems: "center", gap: spacing.sm, padding: `${spacing.sm}px ${spacing.md}px`, border: 0, cursor: "pointer", fontSize: 14, color: colors.text } as const,
  badge: { background: colors.accent, color: "#fff", borderRadius: 999, padding: "0 7px", fontSize: 12 } as const,
  main: { display: "flex", flexDirection: "column", minWidth: 0 } as const,
  header: { padding: spacing.md, borderBottom: "1px solid #E2E8F0", fontWeight: 600 } as const,
  messages: { flex: 1, overflowY: "auto", padding: spacing.md, display: "grid", gap: spacing.sm, alignContent: "start" } as const,
  bubbleRow: { display: "flex" } as const,
  bubble: { maxWidth: "70%", padding: `${spacing.sm}px ${spacing.md}px`, borderRadius: radius.md } as const,
  sender: { fontSize: 12, color: colors.textMuted, marginBottom: 2 } as const,
  meta: { fontSize: 11, color: colors.textMuted, marginTop: 4 } as const,
  system: { textAlign: "center", color: colors.textMuted, fontSize: 12, margin: `${spacing.xs}px 0` } as const,
  composer: { display: "flex", gap: spacing.sm, padding: spacing.md, borderTop: "1px solid #E2E8F0" } as const,
  banner: { position: "fixed", bottom: spacing.md, right: spacing.md, background: "#FEF3C7", color: "#92400E", padding: `${spacing.sm}px ${spacing.md}px`, borderRadius: radius.sm, fontSize: 13 } as const,
};
