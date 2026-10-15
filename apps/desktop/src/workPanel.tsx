import { useEffect, useState } from "react";
import { colors, radius, spacing } from "@beyaz-ofis/ui-tokens";
import type { AccessRequestDetail, ConversationSummary, Department, TicketSummary, UserSummary } from "@beyaz-ofis/core";
import { statusLabelTr } from "@beyaz-ofis/core";
import { api, errorText } from "./session";

// İş paneli: ticket ve erişim talepleri. Görünürlük ve karar yetkisi sunucuda belirlenir (patron, K3/K5).
type Me = UserSummary & { role?: string };
const canApprove = (me: Me) => me.role === "executive" || me.role === "system_admin";

export function WorkPanel({ me, conversations, onClose }: { me: Me; conversations: ConversationSummary[]; onClose: () => void }) {
  const [tab, setTab] = useState<"ticket" | "request">("ticket");
  return (
    <section style={styles.panel} data-testid="work-panel">
      <header style={styles.header}>
        <div style={{ display: "flex", gap: spacing.md }}>
          <button data-testid="work-tab-ticket" onClick={() => setTab("ticket")} style={tab === "ticket" ? styles.tabOn : styles.tab}>
            Ticket
          </button>
          <button data-testid="work-tab-request" onClick={() => setTab("request")} style={tab === "request" ? styles.tabOn : styles.tab}>
            Eski mesaj talebi
          </button>
        </div>
        <button onClick={onClose} style={styles.linkButton}>
          Kapat
        </button>
      </header>
      <div style={styles.body}>{tab === "ticket" ? <TicketTab me={me} /> : <RequestTab me={me} conversations={conversations} />}</div>
    </section>
  );
}

function TicketTab({ me }: { me: Me }) {
  const [mine, setMine] = useState<TicketSummary[]>([]);
  const [queue, setQueue] = useState<TicketSummary[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dept, setDept] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setMine((await api.listTickets("requester")).items);
    if (canApprove(me)) setQueue((await api.listTickets("approver")).items);
  }

  useEffect(() => {
    void load().catch((err) => setError(errorText(err)));
    void api.departments().then(setDepartments).catch(() => undefined);
    // yalnızca açılışta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createTicket({ clientRequestId: crypto.randomUUID(), targetDepartmentId: Number(dept), title, body });
      setTitle("");
      setBody("");
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function decide(id: string, decision: "approved" | "rejected") {
    setError(null);
    try {
      await api.decideTicket(id, decision);
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <div style={{ display: "grid", gap: spacing.lg }}>
      <form data-testid="ticket-form" onSubmit={create} style={styles.form}>
        <strong>Yeni ticket</strong>
        <select data-testid="ticket-dept" value={dept} onChange={(e) => setDept(e.target.value ? Number(e.target.value) : "")} style={styles.input}>
          <option value="">Birim seçin</option>
          {departments.map((d) => (
            <option key={d.department_id} value={d.department_id}>
              {d.name}
            </option>
          ))}
        </select>
        <input data-testid="ticket-title" placeholder="Başlık (3–160)" value={title} onChange={(e) => setTitle(e.target.value)} style={styles.input} />
        <textarea data-testid="ticket-body" placeholder="Açıklama (en az 10 karakter)" value={body} onChange={(e) => setBody(e.target.value)} style={styles.input} rows={3} />
        <button data-testid="ticket-submit" type="submit" disabled={!dept || title.length < 3 || body.length < 10} style={styles.primary}>
          Ticket aç
        </button>
      </form>

      {error && <p style={{ color: "#B91C1C", margin: 0 }}>{error}</p>}

      <div>
        <strong>Ticketlarım</strong>
        <ul data-testid="ticket-list" style={styles.list}>
          {mine.map((t) => (
            <li key={t.ticket_id} data-testid="ticket-row">
              {t.title} · <span style={{ color: colors.textMuted }}>{statusLabelTr(t.status)}</span>
            </li>
          ))}
          {mine.length === 0 && <li style={{ color: colors.textMuted }}>Henüz ticket yok.</li>}
        </ul>
      </div>

      {canApprove(me) && (
        <div>
          <strong>Karar bekleyen ticketlar</strong>
          <ul data-testid="ticket-queue" style={styles.list}>
            {queue.map((t) => (
              <li key={t.ticket_id} data-testid="ticket-queue-row" style={{ display: "flex", gap: spacing.sm, alignItems: "center" }}>
                <span style={{ flex: 1 }}>
                  {t.title} · {t.requester ? `${t.requester.first_name} ${t.requester.last_name}` : ""}
                </span>
                <button data-testid="ticket-approve" onClick={() => void decide(t.ticket_id, "approved")} style={styles.primary}>
                  Onayla
                </button>
                <button data-testid="ticket-reject" onClick={() => void decide(t.ticket_id, "rejected")} style={styles.secondary}>
                  Reddet
                </button>
              </li>
            ))}
            {queue.length === 0 && <li style={{ color: colors.textMuted }}>Bekleyen ticket yok.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function RequestTab({ me, conversations }: { me: Me; conversations: ConversationSummary[] }) {
  const [mine, setMine] = useState<AccessRequestDetail[]>([]);
  const [queue, setQueue] = useState<AccessRequestDetail[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [reason, setReason] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadDetails(list: { request_id: string }[]): Promise<AccessRequestDetail[]> {
    return Promise.all(list.map((r) => api.getAccessRequest(r.request_id)));
  }

  async function load() {
    const own = await api.listAccessRequests("requester");
    setMine(await loadDetails(own.items));
    if (canApprove(me)) {
      const pending = await api.listAccessRequests("approver");
      setQueue(await loadDetails(pending.items));
    }
  }

  useEffect(() => {
    void load().catch((err) => setError(errorText(err)));
    void api.departments().then(setDepartments).catch(() => undefined);
    // yalnızca açılışta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createAccessRequest({ clientRequestId: crypto.randomUUID(), conversationId, reason, targetDepartmentIds: picked });
      setReason("");
      setPicked([]);
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function decide(requestId: string, departmentId: number, decision: "approved" | "rejected") {
    setError(null);
    try {
      await api.decideAccessTarget(requestId, departmentId, decision);
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const deptName = (id: number) => departments.find((d) => d.department_id === id)?.name ?? `Birim ${id}`;

  return (
    <div style={{ display: "grid", gap: spacing.lg }}>
      <form data-testid="request-form" onSubmit={create} style={styles.form}>
        <strong>Yeni erişim talebi</strong>
        <select data-testid="request-conversation" value={conversationId} onChange={(e) => setConversationId(e.target.value)} style={styles.input}>
          <option value="">Konuşma seçin</option>
          {conversations.map((c) => (
            <option key={c.conversation_id} value={c.conversation_id}>
              {c.name ?? "Birebir konuşma"}
            </option>
          ))}
        </select>
        <div style={{ display: "flex", flexWrap: "wrap", gap: spacing.sm }}>
          {departments.map((d) => (
            <label key={d.department_id} style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                data-testid="request-dept"
                checked={picked.includes(d.department_id)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, d.department_id] : p.filter((x) => x !== d.department_id)))}
              />{" "}
              {d.name}
            </label>
          ))}
        </div>
        <textarea data-testid="request-reason" placeholder="Gerekçe (en az 20 karakter)" value={reason} onChange={(e) => setReason(e.target.value)} style={styles.input} rows={3} />
        <button data-testid="request-submit" type="submit" disabled={!conversationId || picked.length === 0 || reason.trim().length < 20} style={styles.primary}>
          Talep gönder
        </button>
      </form>

      {error && <p style={{ color: "#B91C1C", margin: 0 }}>{error}</p>}

      <div>
        <strong>Taleplerim</strong>
        <ul data-testid="request-list" style={styles.list}>
          {mine.map((r) => (
            <li key={r.request_id} data-testid="request-row">
              {r.conversation_name ?? "Birebir konuşma"} · {statusLabelTr(r.status)} ·{" "}
              {r.targets.map((t) => `${deptName(t.department_id)}: ${statusLabelTr(t.status)}`).join(", ")}
            </li>
          ))}
          {mine.length === 0 && <li style={{ color: colors.textMuted }}>Henüz talep yok.</li>}
        </ul>
      </div>

      {canApprove(me) && (
        <div>
          <strong>Karar bekleyen talepler</strong>
          <ul data-testid="request-queue" style={styles.list}>
            {queue.map((r) =>
              r.targets
                .filter((t) => t.status === "pending")
                .map((t) => (
                  <li key={`${r.request_id}-${t.department_id}`} data-testid="request-queue-row" style={{ display: "flex", gap: spacing.sm, alignItems: "center" }}>
                    <span style={{ flex: 1 }}>
                      {r.meta.conversation_name ?? "Birebir konuşma"} · {deptName(t.department_id)} · {r.meta.reason.slice(0, 60)}
                    </span>
                    <button data-testid="request-approve" onClick={() => void decide(r.request_id, t.department_id, "approved")} style={styles.primary}>
                      Onayla
                    </button>
                    <button data-testid="request-reject" onClick={() => void decide(r.request_id, t.department_id, "rejected")} style={styles.secondary}>
                      Reddet
                    </button>
                  </li>
                )),
            )}
            {queue.length === 0 && <li style={{ color: colors.textMuted }}>Bekleyen talep yok.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}


const styles = {
  panel: { display: "flex", flexDirection: "column", minWidth: 0 } as const,
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: spacing.md, borderBottom: "1px solid #E2E8F0" } as const,
  body: { overflowY: "auto", padding: spacing.md } as const,
  tab: { background: "none", border: 0, padding: `${spacing.xs}px 0`, cursor: "pointer", color: colors.textMuted } as const,
  tabOn: { background: "none", border: 0, borderBottom: `2px solid ${colors.accent}`, padding: `${spacing.xs}px 0`, cursor: "pointer", color: colors.text, fontWeight: 600 } as const,
  form: { display: "grid", gap: spacing.sm, padding: spacing.md, border: "1px solid #E2E8F0", borderRadius: radius.md } as const,
  input: { padding: spacing.sm, borderRadius: radius.sm, border: "1px solid #CBD5E1", fontSize: 14 } as const,
  primary: { padding: `${spacing.xs}px ${spacing.md}px`, borderRadius: radius.sm, border: 0, background: colors.accent, color: "#fff", cursor: "pointer" } as const,
  secondary: { padding: `${spacing.xs}px ${spacing.md}px`, borderRadius: radius.sm, border: "1px solid #CBD5E1", background: "#fff", cursor: "pointer" } as const,
  linkButton: { background: "none", border: 0, color: colors.accent, cursor: "pointer", padding: spacing.xs } as const,
  list: { listStyle: "none", padding: 0, margin: `${spacing.sm}px 0 0`, display: "grid", gap: spacing.xs, fontSize: 14 } as const,
};
