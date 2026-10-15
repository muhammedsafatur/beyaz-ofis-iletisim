import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { colors, radius, spacing } from "@beyaz-ofis/ui-tokens";
import {
  applyMention,
  connectRealtime,
  mentionSuggestions,
  resolveMentions,
  type AuditEntry,
  type ConversationSummary,
  type LocalMessage,
  type UserSummary,
} from "@beyaz-ofis/core";
import { api, API_URL, engine, errorText, POLL_CONNECTED_MS, POLL_MS } from "./session";
import { WorkPanel } from "./workPanel";

type Me = UserSummary & { role?: string };

let realtime: { close(): void } | null = null;

// Gerçek zamanlı kanal adresi (ws/wss). Vite proxy'si ws isteklerini de API'ye iletir.
function realtimeUrl(): string {
  if (/^https?:\/\//.test(API_URL)) return API_URL.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}${API_URL}/ws`;
}

function useSnapshot() {
  return useSyncExternalStore(
    (listener) => engine.subscribe(listener),
    () => engine.getSnapshot(),
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });

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
  onAudit,
  onWork,
  me,
}: {
  conversations: ConversationSummary[];
  names: Record<string, string>;
  selected: string | null;
  onSelect: (id: string) => void;
  onLogout: () => void;
  onAudit: () => void;
  onWork: () => void;
  me: Me;
}) {
  return (
    <aside style={styles.sidebar} data-testid="sidebar">
      <div style={styles.sidebarHead}>
        <strong>
          {me.first_name} {me.last_name}
        </strong>
        <span>
          {me.role === "system_admin" && (
            <button data-testid="audit-open" onClick={onAudit} style={styles.linkButton}>
              Denetim
            </button>
          )}
          <button data-testid="work-open" onClick={onWork} style={styles.linkButton}>
            İş
          </button>
          <button data-testid="logout" onClick={onLogout} style={styles.linkButton}>
            Çıkış
          </button>
        </span>
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
  members,
  onLoadOlder,
  onSend,
  onAttach,
}: {
  me: Me;
  id: string;
  name: string;
  messages: LocalMessage[];
  hasOlder: boolean;
  members: UserSummary[];
  onLoadOlder: () => void;
  onSend: (text: string, mentions: string[]) => void;
  onAttach: (file: File) => void;
}) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<UserSummary[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [id, messages.length]);

  // "@" yazılınca üye önerileri (WhatsApp tarzı). Öneri mantığı core'dadır; mobil ile aynıdır.
  const suggestions = mentionSuggestions(text, members, me.user_id);

  function pick(u: UserSummary) {
    setText((t) => applyMention(t, u));
    setPicked((p) => (p.some((x) => x.user_id === u.user_id) ? p : [...p, u]));
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    // Anma yalnızca metinde adı hâlâ geçen kişiler için gönderilir.
    const mentions = resolveMentions(content, picked);
    setText("");
    setPicked([]);
    onSend(content, mentions);
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
          const mentioned = !mine && (m.mentions ?? []).includes(me.user_id);
          return (
            <div key={m.message_id} data-testid="message" data-pending={m.pending ?? ""} data-mention={mentioned ? "true" : undefined} style={{ ...styles.bubbleRow, justifyContent: mine ? "flex-end" : "flex-start" }}>
              <div style={{ ...styles.bubble, background: mentioned ? "#FEF9C3" : mine ? "#DBEAFE" : colors.surface }}>
                {!mine && <div style={styles.sender}>{m.sender ? `${m.sender.first_name} ${m.sender.last_name}` : ""}</div>}
                <div>{m.deleted ? <em style={{ color: colors.textMuted }}>Mesaj silindi</em> : m.content}</div>
                {m.attachment && !m.deleted && (
                  <button
                    data-testid="attachment-link"
                    onClick={() => void api.downloadUrl(m.attachment!.attachment_id).then((u) => window.open(u, "_blank"))}
                    style={{ ...styles.linkButton, padding: 0, marginTop: 4 }}
                  >
                    📎 {m.attachment.file_name} ({Math.max(1, Math.round(m.attachment.size_bytes / 1024))} KB)
                  </button>
                )}
                <div style={styles.meta}>
                  {mentioned ? "@ sizi andı · " : ""}
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
      {suggestions.length > 0 && (
        <ul data-testid="mention-suggestions" style={styles.suggest}>
          {suggestions.map((u) => (
            <li key={u.user_id}>
              <button type="button" data-testid="mention-option" onClick={() => pick(u)} style={styles.linkButton}>
                @{u.first_name} {u.last_name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={send} style={styles.composer}>
        <input
          data-testid="composer"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Mesaj yazın (@ ile anın)"
          style={{ ...styles.input, flex: 1 }}
          maxLength={4000}
        />
        <input
          ref={fileRef}
          data-testid="file-input"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onAttach(f);
          }}
        />
        <button type="button" data-testid="attach" onClick={() => fileRef.current?.click()} style={styles.linkButton}>
          Ek
        </button>
        <button data-testid="send" type="submit" style={styles.primary} disabled={!text.trim()}>
          Gönder
        </button>
      </form>
    </section>
  );
}

function AuditPanel({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .auditLog({ limit: 50 })
      .then((p) => setItems(p.items))
      .catch((err) => setError(errorText(err)));
  }, []);
  return (
    <section style={styles.main} data-testid="audit-panel">
      <header style={{ ...styles.header, display: "flex", justifyContent: "space-between" }}>
        <span>Denetim kaydı</span>
        <button onClick={onClose} style={styles.linkButton}>
          Kapat
        </button>
      </header>
      <div style={{ overflowY: "auto", padding: spacing.md, display: "grid", gap: spacing.xs }}>
        {error && <p style={{ color: "#B91C1C" }}>{error}</p>}
        {items?.map((e) => (
          <div key={e.audit_id} data-testid="audit-row" style={{ fontSize: 13, borderBottom: "1px solid #E2E8F0", paddingBottom: 4 }}>
            <strong>{e.actor ? `${e.actor.first_name} ${e.actor.last_name}` : "Sistem"}</strong> · {e.entity_type} · {e.action} ·{" "}
            <span style={{ color: colors.textMuted }}>{new Date(e.created_at).toLocaleString("tr-TR")}</span>
          </div>
        ))}
        {items && items.length === 0 && <p style={{ color: colors.textMuted }}>Kayıt yok.</p>}
      </div>
    </section>
  );
}

export default function App() {
  const snapshot = useSnapshot();
  const [me, setMe] = useState<Me | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [members, setMembers] = useState<Record<string, UserSummary[]>>({});
  const [view, setView] = useState<"chat" | "audit" | "work">("chat");
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  // Açık konuşmaya yeni mesaj gelince okundu olarak işaretle (yan listedeki sayaç sıfırlanır).
  const openCount = selected ? snapshot.views[selected]?.messages.length ?? 0 : 0;
  useEffect(() => {
    if (me && selected && snapshot.views[selected]?.loaded) void api.markRead(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, openCount, me]);

  // Birebir konuşmalarda karşı tarafın adını ve konuşma üyelerini bir kez çek.
  useEffect(() => {
    if (!me) return;
    for (const c of snapshot.conversations) {
      if (c.type !== "direct" || names[c.conversation_id]) continue;
      void api
        .getConversation(c.conversation_id)
        .then((detail) => {
          const other = detail.members.find((m) => m.user.user_id !== me.user_id);
          if (other) setNames((n) => ({ ...n, [c.conversation_id]: `${other.user.first_name} ${other.user.last_name}` }));
        })
        .catch(() => undefined);
    }
  }, [snapshot.conversations, me, names]);

  // Anma olayı geldiğinde kullanıcıya ulaşılabilir bir bildirim (tarayıcı izni varsa).
  useEffect(() => {
    if (!me || snapshot.mentions.length === 0) return;
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Beyaz Ofis", { body: "Sizi bir mesajda andılar" });
    }
  }, [snapshot.mentions.length, me]);

  async function login(email: string, password: string) {
    await api.auth.login(email, password);
    const user = (await api.me()) as Me;
    setMe(user);
    await engine.refreshConversations(true);
    engine.start(() => (selectedRef.current ? [selectedRef.current] : []), POLL_MS);
    // Gerçek zamanlı olaylar hemen senkronize eder; bağlıyken yoklama 30 sn'ye iner (hibrit senkron).
    realtime?.close();
    realtime = connectRealtime({
      url: realtimeUrl(),
      getToken: async () => (await api.auth.currentAccessToken()) ?? null,
      onEvent: (e) => void engine.handleRealtime(e),
      onStatus: (connected) => engine.setPollInterval(connected ? POLL_CONNECTED_MS : POLL_MS),
    });
  }

  async function logout() {
    realtime?.close();
    realtime = null;
    engine.reset();
    await api.auth.logout();
    setMe(null);
    setSelected(null);
    setNames({});
    setMembers({});
    setView("chat");
  }

  // Dosya ekiyle mesaj: dosya yüklenir, bağlı mesaj gönderilir.
  async function attach(file: File) {
    if (!selected || !me) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const meta = await api.uploadAttachment(selected, { fileName: file.name, contentType: file.type, bytes });
    await engine.send(selected, `Dosya: ${file.name}`, me, meta.attachment_id).catch(() => undefined);
  }

  async function select(id: string) {
    setSelected(id);
    setView("chat");
    const current = engine.getSnapshot().views[id];
    if (!current?.loaded) await engine.openConversation(id);
    if (!members[id]) {
      const detail = await api.getConversation(id).catch(() => null);
      if (detail) setMembers((m) => ({ ...m, [id]: detail.members.map((x) => x.user) }));
    }
    await api.markRead(id);
  }

  // Anma bildirimine tıklayınca: anılan son konuşma açılır, anma listesi temizlenir.
  async function openMention() {
    const last = engine.getSnapshot().mentions.at(-1);
    engine.clearMentions();
    if (last) await select(last.conversation_id);
  }

  if (!me) {
    return (
      <main style={styles.center}>
        <LoginView onLogin={login} />
      </main>
    );
  }

  const current = selected ? snapshot.views[selected] : undefined;
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
        onAudit={() => setView("audit")}
        onWork={() => setView("work")}
        me={me}
      />
      {view === "audit" ? (
        <AuditPanel onClose={() => setView("chat")} />
      ) : view === "work" ? (
        <WorkPanel me={me} conversations={snapshot.conversations} onClose={() => setView("chat")} />
      ) : selected && current?.loaded ? (
        <MessageView
          me={me}
          id={selected}
          name={title}
          messages={current.messages}
          hasOlder={current.hasOlder}
          members={members[selected] ?? []}
          onLoadOlder={() => void engine.loadOlder(selected)}
          onSend={(t, mentions) => void engine.send(selected, t, me, undefined, mentions).catch(() => undefined)}
          onAttach={(f) => void attach(f).catch(() => undefined)}
        />
      ) : (
        <section style={styles.main}>
          <p style={{ color: colors.textMuted, padding: spacing.lg }}>Bir konuşma seçin.</p>
        </section>
      )}
      {snapshot.mentions.length > 0 && (
        <button data-testid="mention-banner" onClick={() => void openMention()} style={styles.mentionBanner}>
          Sizi bir mesajda andılar ({snapshot.mentions.length})
        </button>
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
  suggest: { listStyle: "none", margin: 0, padding: `0 ${spacing.md}px`, display: "flex", gap: spacing.sm, flexWrap: "wrap" } as const,
  banner: { position: "fixed", bottom: spacing.md, right: spacing.md, background: "#FEF3C7", color: "#92400E", padding: `${spacing.sm}px ${spacing.md}px`, borderRadius: radius.sm, fontSize: 13 } as const,
  mentionBanner: { position: "fixed", top: spacing.md, right: spacing.md, background: "#FEF9C3", color: "#713F12", border: "1px solid #FDE68A", padding: `${spacing.sm}px ${spacing.md}px`, borderRadius: radius.sm, fontSize: 13, cursor: "pointer" } as const,
};
