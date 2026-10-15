import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BackHandler, FlatList, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { colors, radius, spacing } from "@beyaz-ofis/ui-tokens";
import {
  ApiRequestError,
  applyMention,
  connectRealtime,
  createApiClient,
  mentionSuggestions,
  resolveMentions,
  statusLabelTr,
  SyncEngine,
  type AccessRequestDetail,
  type ConversationSummary,
  type Department,
  type LocalMessage,
  type TicketSummary,
  type TokenStore,
  type Tokens,
  type UserSummary,
} from "@beyaz-ofis/core";

// Android emülatörde yerel makine 10.0.2.2 adresiyle görülür. Gerçek cihazda makinenin LAN adresi verilir.
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000/api/v1";
const POLL_MS = 3000;
const TOKEN_KEY = "beyaz-ofis.tokens";
// Gerçek zamanlı kanal adresi: API adresinin ws biçimi.
const REALTIME_URL = API_URL.replace(/^http/, "ws") + "/ws";
let realtime: { close(): void } | null = null;

function startRealtime() {
  realtime?.close();
  realtime = connectRealtime({
    url: REALTIME_URL,
    getToken: async () => (await tokens.load())?.access_token ?? null,
    // Hibrit senkron: olaylar hemen senkronize eder; bağlıyken yoklama 30 sn, kopunca 3 sn.
    onEvent: (e) => void engine.handleRealtime(e),
    onStatus: (connected) => engine.setPollInterval(connected ? 30000 : POLL_MS),
  });
}

// Push: cihaz belirteci sunucuya kaydedilir. EAS projectId yoksa kayıt atlanır (uygulama yine çalışır).
let pushToken: string | null = null;
async function registerPush() {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    console.info("Push: EAS projectId tanımlı değil, kayıt atlandı.");
    return;
  }
  const current = await Notifications.getPermissionsAsync();
  const granted = current.status === "granted" || (await Notifications.requestPermissionsAsync()).status === "granted";
  if (!granted) return;
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  pushToken = data;
  await api.registerPushToken(data, Platform.OS === "ios" ? "ios" : "android").catch(() => undefined);
}

// Açık konuşma kimliği (yalnızca bildirim için); ekran durumuyla eşlenir.
let openId: string | null = null;
function currentOpen(): string[] {
  return openId ? [openId] : [];
}

// Belirteçler cihazın güvenli deposunda (iOS Keychain, Android Keystore). Düz depolama kullanılmaz (§10).
const tokens: TokenStore = {
  async load() {
    const raw = await SecureStore.getItemAsync(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  },
  async save(t) {
    await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(t));
  },
  async clear() {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  },
};

const api = createApiClient({ baseUrl: API_URL, tokens });
// React Native'de globalThis.crypto.randomUUID bulunmayabilir; kimlikler expo-crypto ile üretilir.
const engine = new SyncEngine(api, { newId: () => Crypto.randomUUID() });

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

function LoginScreen({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onLogin(email.trim(), password);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.center}>
      <Text style={styles.title}>Beyaz Ofis</Text>
      <TextInput
        testID="email"
        style={styles.input}
        placeholder="E-posta"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput testID="password" style={styles.input} placeholder="Parola" secureTextEntry value={password} onChangeText={setPassword} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable testID="login-submit" onPress={submit} disabled={busy} style={styles.primary}>
        <Text style={styles.primaryText}>{busy ? "Giriş yapılıyor…" : "Giriş yap"}</Text>
      </Pressable>
    </View>
  );
}

function ConversationList({
  me,
  names,
  onOpen,
  onLogout,
  onWork,
  onMention,
}: {
  me: UserSummary;
  names: Record<string, string>;
  onOpen: (id: string) => void;
  onLogout: () => void;
  onWork: () => void;
  onMention: () => void;
}) {
  const snapshot = useSnapshot();
  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{`${me.first_name} ${me.last_name}`}</Text>
        <View style={styles.headerActions}>
          <Pressable testID="work-open" onPress={onWork}>
            <Text style={styles.link}>İş</Text>
          </Pressable>
          <Pressable testID="logout" onPress={onLogout}>
            <Text style={styles.link}>Çıkış</Text>
          </Pressable>
        </View>
      </View>
      {snapshot.mentions.length > 0 ? (
        <Pressable testID="mention-banner" onPress={onMention} style={styles.mentionBanner}>
          <Text style={styles.mentionText}>{`Sizi bir mesajda andılar (${snapshot.mentions.length})`}</Text>
        </Pressable>
      ) : null}
      <FlatList
        data={snapshot.conversations}
        keyExtractor={(c) => c.conversation_id}
        renderItem={({ item }: { item: ConversationSummary }) => {
          const title = item.type === "direct" ? names[item.conversation_id] ?? "Birebir konuşma" : item.name ?? "Konuşma";
          return (
            <Pressable testID="conversation-item" onPress={() => onOpen(item.conversation_id)} style={styles.row}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {title}
              </Text>
              {item.unread_count > 0 ? <Text style={styles.badge}>{item.unread_count}</Text> : null}
            </Pressable>
          );
        }}
      />
      {snapshot.lastError ? <Text style={styles.banner}>Bağlantı sorunu: {snapshot.lastError}</Text> : null}
    </View>
  );
}

function receipt(m: LocalMessage): string | null {
  if (m.read_by_peer === true) return "Okundu";
  if (typeof m.read_count === "number") return m.read_count > 0 ? `${m.read_count} kişi okudu` : "İletildi";
  return null;
}

function Chat({ me, id, title, onBack }: { me: UserSummary; id: string; title: string; onBack: () => void }) {
  const snapshot = useSnapshot();
  const view = snapshot.views[id];
  const [text, setText] = useState("");
  const [members, setMembers] = useState<UserSummary[]>([]);
  const [picked, setPicked] = useState<UserSummary[]>([]);
  const listRef = useRef<ScrollView>(null);

  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => back.remove();
  }, [onBack]);

  useEffect(() => {
    if (!view?.loaded) void engine.openConversation(id);
    void api.markRead(id);
  }, [id, view?.loaded]);

  const count = view?.messages.length ?? 0;
  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
    if (view?.loaded) void api.markRead(id);
  }, [count, id, view?.loaded]);

  // Anma önerileri için konuşmanın üyeleri bir kez çekilir.
  useEffect(() => {
    void api
      .getConversation(id)
      .then((detail) => setMembers(detail.members.map((m) => m.user)))
      .catch(() => undefined);
  }, [id]);

  // "@" yazılınca öneri mantığı core'dadır; masaüstüyle aynıdır.
  const suggestions = mentionSuggestions(text, members, me.user_id);

  function pick(u: UserSummary) {
    setText((t) => applyMention(t, u));
    setPicked((p) => (p.some((x) => x.user_id === u.user_id) ? p : [...p, u]));
  }

  function send() {
    const content = text.trim();
    if (!content) return;
    // Anma yalnızca metinde adı hâlâ geçen seçimler için gönderilir.
    const mentions = resolveMentions(content, picked);
    setText("");
    setPicked([]);
    void engine.send(id, content, me, undefined, mentions).catch(() => undefined);
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.header}>
        <Pressable testID="back" onPress={onBack}>
          <Text style={styles.link}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={{ width: 48 }} />
      </View>
      <ScrollView ref={listRef} style={styles.flex} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
        {view?.hasOlder ? (
          <Pressable onPress={() => void engine.loadOlder(id)}>
            <Text style={styles.link}>Daha eski mesajlar</Text>
          </Pressable>
        ) : null}
        {(view?.messages ?? []).map((m) => {
          if (m.message_type === "system") {
            return (
              <Text key={m.message_id} style={styles.system}>
                {m.content}
              </Text>
            );
          }
          const mine = m.sender?.user_id === me.user_id;
          const mentioned = !mine && (m.mentions ?? []).includes(me.user_id);
          const status = m.pending === "sending" ? "gönderiliyor" : m.pending === "failed" ? "gönderilemedi" : null;
          const meta = [m.deleted ? null : m.edited_at ? "düzenlendi" : null, time(m.sent_at), status, mine && !m.pending ? receipt(m) : null]
            .filter(Boolean)
            .join(" · ");
          return (
            <View key={m.message_id} style={[styles.bubbleRow, { justifyContent: mine ? "flex-end" : "flex-start" }]}>
              <View style={[styles.bubble, { backgroundColor: mentioned ? "#FEF9C3" : mine ? "#DBEAFE" : colors.surface }]}>
                {!mine && m.sender ? <Text style={styles.sender}>{`${m.sender.first_name} ${m.sender.last_name}`}</Text> : null}
                <Text style={m.deleted ? styles.deleted : undefined}>{m.deleted ? "Mesaj silindi" : m.content}</Text>
                <Text style={styles.meta}>{meta}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
      {suggestions.length > 0 ? (
        <ScrollView horizontal style={styles.suggestBar} contentContainerStyle={styles.suggestContent} keyboardShouldPersistTaps="handled">
          {suggestions.map((u) => (
            <Pressable key={u.user_id} testID="mention-option" onPress={() => pick(u)} style={styles.suggestItem}>
              <Text style={styles.link}>{`@${u.first_name} ${u.last_name}`}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.composer}>
        <TextInput testID="composer" style={[styles.input, styles.flex]} placeholder="Mesaj yazın (@ ile anın)" value={text} onChangeText={setText} maxLength={4000} />
        <Pressable testID="send" onPress={send} disabled={!text.trim()} style={styles.primary}>
          <Text style={styles.primaryText}>Gönder</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

type Me = UserSummary & { role?: string };
// Karar yetkisi: patron; patron yoksa sistem yöneticisi (sunucu kuralı). İstemci yalnızca görünürlüğü ayarlar.
const canApprove = (me: Me) => me.role === "executive" || me.role === "system_admin";

function Chip({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.chip, active ? styles.chipOn : null]}>
      <Text style={active ? styles.chipOnText : styles.chipText}>{label}</Text>
    </Pressable>
  );
}

// İş ekranı: ticket ve eski mesaj talepleri. Masaüstü iş paneliyle aynı akış.
function WorkScreen({ me, conversations, onClose }: { me: Me; conversations: ConversationSummary[]; onClose: () => void }) {
  const [tab, setTab] = useState<"ticket" | "request">("ticket");

  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => back.remove();
  }, [onClose]);

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Pressable testID="work-back" onPress={onClose}>
          <Text style={styles.link}>‹ Geri</Text>
        </Pressable>
        <Text style={styles.headerTitle}>İş</Text>
        <View style={{ width: 48 }} />
      </View>
      <View style={styles.tabBar}>
        <Pressable testID="work-tab-ticket" onPress={() => setTab("ticket")} style={[styles.tabItem, tab === "ticket" ? styles.tabOn : null]}>
          <Text style={tab === "ticket" ? styles.tabOnText : styles.tabText}>Ticket</Text>
        </Pressable>
        <Pressable testID="work-tab-request" onPress={() => setTab("request")} style={[styles.tabItem, tab === "request" ? styles.tabOn : null]}>
          <Text style={tab === "request" ? styles.tabOnText : styles.tabText}>Eski mesaj talebi</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }} keyboardShouldPersistTaps="handled">
        {tab === "ticket" ? <TicketPanel me={me} /> : <RequestPanel me={me} conversations={conversations} />}
      </ScrollView>
    </View>
  );
}

function TicketPanel({ me }: { me: Me }) {
  const [mine, setMine] = useState<TicketSummary[]>([]);
  const [queue, setQueue] = useState<TicketSummary[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [dept, setDept] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setMine((await api.listTickets("requester")).items);
    if (canApprove(me)) setQueue((await api.listTickets("approver")).items);
  }

  useEffect(() => {
    void load().catch((err) => setError(errorText(err)));
    void api.departments().then(setDepartments).catch(() => undefined);
    // Yalnızca açılışta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create() {
    if (dept === null) return;
    setError(null);
    try {
      await api.createTicket({ clientRequestId: Crypto.randomUUID(), targetDepartmentId: dept, title, body });
      setTitle("");
      setBody("");
      setDept(null);
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

  const ready = dept !== null && title.length >= 3 && body.length >= 10;
  return (
    <>
      <Text style={styles.sectionTitle}>Yeni ticket</Text>
      <Text style={styles.label}>Birim</Text>
      <View style={styles.chips}>
        {departments.map((d) => (
          <Chip key={d.department_id} testID="ticket-dept" label={d.name} active={dept === d.department_id} onPress={() => setDept(d.department_id)} />
        ))}
      </View>
      <TextInput testID="ticket-title" style={styles.input} placeholder="Başlık (3–160)" value={title} onChangeText={setTitle} maxLength={160} />
      <TextInput
        testID="ticket-body"
        style={[styles.input, styles.multiline]}
        placeholder="Açıklama (en az 10 karakter)"
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={4000}
      />
      <Pressable testID="ticket-submit" disabled={!ready} onPress={() => void create()} style={[styles.primary, !ready ? styles.disabled : null]}>
        <Text style={styles.primaryText}>Ticket aç</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.sectionTitle}>Ticketlarım</Text>
      {mine.length === 0 ? <Text style={styles.muted}>Henüz ticket yok.</Text> : null}
      {mine.map((t) => (
        <Text key={t.ticket_id} style={styles.listItem}>
          {`${t.title} · ${statusLabelTr(t.status)}`}
        </Text>
      ))}

      {canApprove(me) ? (
        <>
          <Text style={styles.sectionTitle}>Karar bekleyen ticketlar</Text>
          {queue.length === 0 ? <Text style={styles.muted}>Bekleyen ticket yok.</Text> : null}
          {queue.map((t) => (
            <View key={t.ticket_id} style={styles.decisionRow}>
              <Text style={styles.listItemFlex}>{t.requester ? `${t.title} · ${t.requester.first_name} ${t.requester.last_name}` : t.title}</Text>
              <Pressable testID="ticket-approve" onPress={() => void decide(t.ticket_id, "approved")} style={styles.primary}>
                <Text style={styles.primaryText}>Onayla</Text>
              </Pressable>
              <Pressable testID="ticket-reject" onPress={() => void decide(t.ticket_id, "rejected")} style={styles.secondary}>
                <Text style={styles.link}>Reddet</Text>
              </Pressable>
            </View>
          ))}
        </>
      ) : null}
    </>
  );
}

function RequestPanel({ me, conversations }: { me: Me; conversations: ConversationSummary[] }) {
  const [mine, setMine] = useState<AccessRequestDetail[]>([]);
  const [queue, setQueue] = useState<AccessRequestDetail[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function details(list: { request_id: string }[]): Promise<AccessRequestDetail[]> {
    return Promise.all(list.map((r) => api.getAccessRequest(r.request_id)));
  }

  async function load() {
    setMine(await details((await api.listAccessRequests("requester")).items));
    if (canApprove(me)) setQueue(await details((await api.listAccessRequests("approver")).items));
  }

  useEffect(() => {
    void load().catch((err) => setError(errorText(err)));
    void api.departments().then(setDepartments).catch(() => undefined);
    // Yalnızca açılışta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create() {
    if (conversationId === null) return;
    setError(null);
    try {
      await api.createAccessRequest({ clientRequestId: Crypto.randomUUID(), conversationId, reason, targetDepartmentIds: picked });
      setReason("");
      setPicked([]);
      setConversationId(null);
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
  const convName = (c: ConversationSummary) => (c.type === "direct" ? "Birebir konuşma" : c.name ?? "Konuşma");
  const pending = queue.flatMap((r) => r.targets.filter((t) => t.status === "pending").map((t) => ({ r, t })));
  const ready = conversationId !== null && picked.length > 0 && reason.trim().length >= 20;

  return (
    <>
      <Text style={styles.sectionTitle}>Yeni erişim talebi</Text>
      <Text style={styles.label}>Konuşma</Text>
      <View style={styles.chips}>
        {conversations.map((c) => (
          <Chip key={c.conversation_id} label={convName(c)} active={conversationId === c.conversation_id} onPress={() => setConversationId(c.conversation_id)} />
        ))}
      </View>
      <Text style={styles.label}>Birimler</Text>
      <View style={styles.chips}>
        {departments.map((d) => (
          <Chip
            key={d.department_id}
            testID="request-dept"
            label={d.name}
            active={picked.includes(d.department_id)}
            onPress={() => setPicked((p) => (p.includes(d.department_id) ? p.filter((x) => x !== d.department_id) : [...p, d.department_id]))}
          />
        ))}
      </View>
      <TextInput
        testID="request-reason"
        style={[styles.input, styles.multiline]}
        placeholder="Gerekçe (en az 20 karakter)"
        value={reason}
        onChangeText={setReason}
        multiline
        maxLength={2000}
      />
      <Pressable testID="request-submit" disabled={!ready} onPress={() => void create()} style={[styles.primary, !ready ? styles.disabled : null]}>
        <Text style={styles.primaryText}>Talep gönder</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.sectionTitle}>Taleplerim</Text>
      {mine.length === 0 ? <Text style={styles.muted}>Henüz talep yok.</Text> : null}
      {mine.map((r) => (
        <Text key={r.request_id} style={styles.listItem}>
          {`${r.meta.conversation_name ?? "Birebir konuşma"} · ${statusLabelTr(r.status)} · ${r.targets
            .map((t) => `${deptName(t.department_id)}: ${statusLabelTr(t.status)}`)
            .join(", ")}`}
        </Text>
      ))}

      {canApprove(me) ? (
        <>
          <Text style={styles.sectionTitle}>Karar bekleyen talepler</Text>
          {pending.length === 0 ? <Text style={styles.muted}>Bekleyen talep yok.</Text> : null}
          {pending.map(({ r, t }) => (
            <View key={`${r.request_id}-${t.department_id}`} style={styles.decisionRow}>
              <Text style={styles.listItemFlex}>{`${r.meta.conversation_name ?? "Birebir konuşma"} · ${deptName(t.department_id)} · ${r.meta.reason.slice(0, 60)}`}</Text>
              <Pressable testID="request-approve" onPress={() => void decide(r.request_id, t.department_id, "approved")} style={styles.primary}>
                <Text style={styles.primaryText}>Onayla</Text>
              </Pressable>
              <Pressable testID="request-reject" onPress={() => void decide(r.request_id, t.department_id, "rejected")} style={styles.secondary}>
                <Text style={styles.link}>Reddet</Text>
              </Pressable>
            </View>
          ))}
        </>
      ) : null}
    </>
  );
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [working, setWorking] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const snapshot = useSnapshot();

  // Oturum varsa açılışta devam et (belirteç güvenli depoda).
  useEffect(() => {
    void (async () => {
      if (!(await tokens.load())) return;
      try {
        const user = await api.me();
        setMe(user as Me);
        await engine.refreshConversations(true);
        engine.start(currentOpen, POLL_MS);
        startRealtime();
        void registerPush();
      } catch {
        await tokens.clear();
      }
    })();
    // Yalnızca açılışta bir kez
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Birebir konuşmalarda karşı tarafın adı bir kez çekilir.
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

  async function login(email: string, password: string) {
    await api.auth.login(email, password);
    const user = await api.me();
    setMe(user as Me);
    await engine.refreshConversations(true);
    engine.start(currentOpen, POLL_MS);
    startRealtime();
    void registerPush();
  }

  async function logout() {
    realtime?.close();
    realtime = null;
    if (pushToken) await api.removePushToken(pushToken).catch(() => undefined);
    pushToken = null;
    engine.reset();
    await api.auth.logout();
    setMe(null);
    setSelected(null);
    setWorking(false);
  }

  // Anma banner'ı: anılan son konuşma açılır, anma listesi temizlenir.
  function openMention() {
    const last = engine.getSnapshot().mentions.at(-1);
    engine.clearMentions();
    if (last) setSelected(last.conversation_id);
  }

  openId = selected;
  if (!me) {
    return (
      <SafeAreaView style={styles.safe}>
        <LoginScreen onLogin={login} />
      </SafeAreaView>
    );
  }

  const conv = snapshot.conversations.find((c) => c.conversation_id === selected);
  const title = conv ? (conv.type === "direct" ? names[conv.conversation_id] ?? "Birebir konuşma" : conv.name ?? "Konuşma") : "";

  return (
    <SafeAreaView style={styles.safe}>
      {working ? (
        <WorkScreen me={me} conversations={snapshot.conversations} onClose={() => setWorking(false)} />
      ) : selected ? (
        <Chat me={me} id={selected} title={title} onBack={() => setSelected(null)} />
      ) : (
        <ConversationList
          me={me}
          names={names}
          onOpen={setSelected}
          onLogout={() => void logout()}
          onWork={() => setWorking(true)}
          onMention={openMention}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: "center", padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 24, fontWeight: "600", color: colors.text, textAlign: "center", marginBottom: spacing.md },
  input: { borderWidth: 1, borderColor: "#CBD5E1", borderRadius: radius.sm, padding: spacing.sm, fontSize: 15, backgroundColor: colors.background },
  primary: { backgroundColor: colors.accent, borderRadius: radius.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#fff", fontWeight: "600" },
  error: { color: "#B91C1C" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: "#E2E8F0" },
  headerTitle: { fontSize: 16, fontWeight: "600", color: colors.text, flexShrink: 1 },
  link: { color: colors.accent, fontSize: 15 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  rowTitle: { fontSize: 15, color: colors.text, flex: 1 },
  badge: { backgroundColor: colors.accent, color: "#fff", borderRadius: 999, paddingHorizontal: 7, fontSize: 12, overflow: "hidden" },
  bubbleRow: { flexDirection: "row" },
  bubble: { maxWidth: "80%", padding: spacing.sm, borderRadius: radius.md, gap: 2 },
  sender: { fontSize: 12, color: colors.textMuted },
  deleted: { fontStyle: "italic", color: colors.textMuted },
  meta: { fontSize: 11, color: colors.textMuted },
  system: { textAlign: "center", color: colors.textMuted, fontSize: 12 },
  composer: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: "#E2E8F0" },
  suggestBar: { flexGrow: 0, borderTopWidth: 1, borderTopColor: "#E2E8F0" },
  suggestContent: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, gap: spacing.sm, alignItems: "center" },
  suggestItem: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.surface },
  banner: { backgroundColor: "#FEF3C7", color: "#92400E", padding: spacing.sm, fontSize: 13 },
  headerActions: { flexDirection: "row", gap: spacing.md },
  mentionBanner: { backgroundColor: "#FEF9C3", padding: spacing.sm, borderBottomWidth: 1, borderBottomColor: "#FDE68A" },
  mentionText: { color: "#713F12", fontSize: 13 },
  sectionTitle: { fontSize: 15, fontWeight: "600", color: colors.text, marginTop: spacing.sm },
  label: { fontSize: 13, color: colors.textMuted },
  muted: { color: colors.textMuted, fontSize: 13 },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  disabled: { opacity: 0.5 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 999, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 13 },
  chipOnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  listItem: { fontSize: 14, color: colors.text },
  listItemFlex: { fontSize: 14, color: colors.text, flex: 1 },
  decisionRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
  secondary: { borderWidth: 1, borderColor: "#CBD5E1", borderRadius: radius.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center" },
  tabBar: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#E2E8F0" },
  tabItem: { flex: 1, paddingVertical: spacing.sm, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabOn: { borderBottomColor: colors.accent },
  tabText: { color: colors.textMuted, fontSize: 14 },
  tabOnText: { color: colors.text, fontSize: 14, fontWeight: "600" },
});
