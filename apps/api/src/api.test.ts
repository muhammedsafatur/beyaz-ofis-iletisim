import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { users } from "@beyaz-ofis/db-schema";
import { buildApp, type AppOptions } from "./app.js";
import { createTestDb, type Db } from "./db.js";
import type { InviteSender, Ctx } from "./services/common.js";
import { hashPassword } from "./services/auth.js";
import { expireDue } from "./services/scheduler.js";
import type { PGlite } from "@electric-sql/pglite";

const SECRET = "test-secret-with-at-least-32-characters";
const PASSWORD = "parola-123456";
const HOUR = 3_600_000;
const MIN = 60_000;

let db: Db;
let client: PGlite;
let app: FastifyInstance;
let ctx: Ctx;
let clock: Date;
const invites = new Map<string, string>();

const sender: InviteSender = {
  async send(email, token) {
    invites.set(email, token);
  },
};

type Res = { status: number; body: any; headers: Record<string, string> };
let baseUrl = "";

// Gerçek HTTP üzerinden istek: sunucunun tam yolu (yönlendirme, doğrulama, hata biçimi) test edilir.
async function call(method: string, url: string, token?: string, payload?: unknown): Promise<Res> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (payload !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(baseUrl + url, {
    method,
    headers,
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  return { status: res.status, body, headers: Object.fromEntries(res.headers.entries()) };
}

function advance(ms: number) {
  clock = new Date(clock.getTime() + ms);
}

async function seedAdmin(email: string): Promise<string> {
  await db.insert(users).values({
    firstName: "Sistem",
    lastName: "Yöneticisi",
    email,
    passwordHash: await hashPassword(PASSWORD),
    role: "system_admin",
  });
  const r = await call("POST", "/auth/login", undefined, { email, password: PASSWORD });
  return r.body.access_token as string;
}

// Yönetici kullanıcı oluşturur, davet token'ını kabul eder, giriş yapar.
async function createUser(
  admin: string,
  email: string,
  departmentIds: number[],
  role?: "employee" | "executive",
): Promise<{ id: string; token: string }> {
  const created = await call("POST", "/admin/users", admin, {
    first_name: email.split("@")[0],
    last_name: "Test",
    email,
    department_ids: departmentIds,
  });
  expect(created.status).toBe(201);
  const token = invites.get(email);
  expect(token).toBeDefined();
  const accepted = await call("POST", "/auth/accept-invite", undefined, { token, password: PASSWORD });
  expect(accepted.status).toBe(204);
  if (role) {
    const r = await call("PATCH", `/admin/users/${created.body.user_id}`, admin, { role });
    expect(r.status).toBe(200);
  }
  const login = await call("POST", "/auth/login", undefined, { email, password: PASSWORD });
  expect(login.status).toBe(200);
  return { id: created.body.user_id, token: login.body.access_token };
}

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  client = t.client;
  clock = new Date("2026-10-15T10:00:00Z");
  const opts: AppOptions = { db, jwtSecret: SECRET, now: () => clock, invites: sender, logger: false };
  const built = buildApp(opts);
  app = built.app;
  ctx = built.ctx;
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Sunucu adresi alınamadı.");
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 120_000);

afterAll(async () => {
  await app.close();
  await client.close();
});

describe("genel", () => {
  it("sağlık ucu çalışır", async () => {
    const r = await call("GET", "/health");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: "ok" });
  });

  it("bilinmeyen yol spec hata biçiminde 404 döner", async () => {
    const r = await call("GET", "/yok");
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("NOT_FOUND");
  });

  it("kimlik yoksa 401 UNAUTHENTICATED", async () => {
    const r = await call("GET", "/users/me");
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("UNAUTHENTICATED");
  });
});

describe("kimlik (B4)", () => {
  let admin: string;
  let refreshOld: string;

  beforeAll(async () => {
    admin = await seedAdmin("admin@sirket.test");
  });

  it("yanlış parola 401 döner", async () => {
    const r = await call("POST", "/auth/login", undefined, { email: "admin@sirket.test", password: "yanlis-parola" });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("doğru girişte erişim ve yenileme belirteci döner", async () => {
    const r = await call("POST", "/auth/login", undefined, { email: "admin@sirket.test", password: PASSWORD });
    expect(r.status).toBe(200);
    expect(r.body.expires_in).toBe(900);
    refreshOld = r.body.refresh_token;
    const me = await call("GET", "/users/me", r.body.access_token);
    expect(me.status).toBe(200);
    expect(me.body.role).toBe("system_admin");
  });

  it("yenileme belirteci döner ve eskisi tekrar kullanılırsa aile iptal edilir", async () => {
    const rotated = await call("POST", "/auth/refresh", undefined, { refresh_token: refreshOld });
    expect(rotated.status).toBe(200);
    const reused = await call("POST", "/auth/refresh", undefined, { refresh_token: refreshOld });
    expect(reused.status).toBe(401);
    expect(reused.body.error.code).toBe("REFRESH_TOKEN_REUSED");
    // Aynı aileden yeni belirteç de artık geçersiz
    const dead = await call("POST", "/auth/refresh", undefined, { refresh_token: rotated.body.refresh_token });
    expect(dead.status).toBe(401);
    expect(dead.body.error.code).toBe("REFRESH_TOKEN_REUSED");
  });

  it("çıkış yapılınca belirteç kullanılamaz", async () => {
    const login = await call("POST", "/auth/login", undefined, { email: "admin@sirket.test", password: PASSWORD });
    const out = await call("POST", "/auth/logout", undefined, { refresh_token: login.body.refresh_token });
    expect(out.status).toBe(204);
    const r = await call("POST", "/auth/refresh", undefined, { refresh_token: login.body.refresh_token });
    expect(r.status).toBe(401);
  });
});

describe("davet ve kullanıcı yönetimi", () => {
  let admin: string;

  beforeAll(async () => {
    admin = await seedAdmin("yonetici2@sirket.test");
  });

  it("davet token'ı tek kullanımlıktır, geçersiz token INVITATION_INVALID", async () => {
    const created = await call("POST", "/admin/users", admin, { first_name: "Ali", last_name: "Veli", email: "ali@sirket.test" });
    expect(created.status).toBe(201);
    const bad = await call("POST", "/auth/accept-invite", undefined, { token: "yanlis-token-degeri", password: PASSWORD });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVITATION_INVALID");
    const token = invites.get("ali@sirket.test")!;
    expect((await call("POST", "/auth/accept-invite", undefined, { token, password: PASSWORD })).status).toBe(204);
    const again = await call("POST", "/auth/accept-invite", undefined, { token, password: PASSWORD });
    expect(again.body.error.code).toBe("INVITATION_INVALID");
  });

  it("davet kabul edilmeden giriş yapılamaz", async () => {
    await call("POST", "/admin/users", admin, { first_name: "Ayse", last_name: "Kaya", email: "ayse@sirket.test" });
    const r = await call("POST", "/auth/login", undefined, { email: "ayse@sirket.test", password: PASSWORD });
    expect(r.status).toBe(401);
  });

  it("aynı e-posta ikinci kez kaydedilemez (büyük/küçük harf duyarsız)", async () => {
    const r = await call("POST", "/admin/users", admin, { first_name: "X", last_name: "Y", email: "ALI@SIRKET.TEST" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("çalışan yönetici uçlarına erişemez", async () => {
    const ali = await call("POST", "/auth/login", undefined, { email: "ali@sirket.test", password: PASSWORD });
    const r = await call("POST", "/admin/companies", ali.body.access_token, { name: "Yetkisiz" });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("FORBIDDEN");
  });
});

// Organizasyon ve konuşma senaryoları ortak durumla ilerler.
describe("organizasyon, bağlantı ve konuşmalar", () => {
  let admin: string;
  let companyA: number;
  let companyB: number;
  let deptA: number;
  let deptB: number;
  let u1: { id: string; token: string };
  let u2: { id: string; token: string };
  let u3: { id: string; token: string };
  let direct12: string;
  let group: string;

  beforeAll(async () => {
    admin = await seedAdmin("org-admin@sirket.test");
    companyA = (await call("POST", "/admin/companies", admin, { name: "Şirket A" })).body.company_id;
    companyB = (await call("POST", "/admin/companies", admin, { name: "Şirket B" })).body.company_id;
    deptA = (await call("POST", "/admin/departments", admin, { company_id: companyA, name: "Satış" })).body.department_id;
    deptB = (await call("POST", "/admin/departments", admin, { company_id: companyB, name: "Lojistik" })).body.department_id;
    u1 = await createUser(admin, "u1@sirket.test", [deptA]);
    u2 = await createUser(admin, "u2@sirket.test", [deptA]);
    u3 = await createUser(admin, "u3@sirket.test", [deptB]);
  });

  it("farklı şirketteki kullanıcı bağlantı yokken yazamaz (NO_COMPANY_LINK)", async () => {
    const r = await call("POST", "/conversations", u1.token, { type: "direct", member_ids: [u3.id] });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("NO_COMPANY_LINK");
  });

  it("şirketler arası bağlantı önizleme ve açma; aynı çift için ikinci aktif bağlantı reddedilir", async () => {
    const preview = await call("POST", "/admin/company-links", admin, { company_ids: [companyB, companyA], dry_run: true });
    expect(preview.status).toBe(200);
    expect(preview.body.affected_users.length).toBeGreaterThanOrEqual(3);
    const open = await call("POST", "/admin/company-links", admin, { company_ids: [companyB, companyA] });
    expect(open.status).toBe(201);
    expect(open.body.company_low_id).toBeLessThan(open.body.company_high_id);
    const dup = await call("POST", "/admin/company-links", admin, { company_ids: [companyA, companyB] });
    expect(dup.status).toBe(400);
  });

  it("aynı şirket birebir konuşması açılır, tekrar istek mevcut konuşmayı döner (200)", async () => {
    const first = await call("POST", "/conversations", u1.token, { type: "direct", member_ids: [u2.id] });
    expect(first.status).toBe(201);
    direct12 = first.body.conversation_id;
    const again = await call("POST", "/conversations", u2.token, { type: "direct", member_ids: [u1.id] });
    expect(again.status).toBe(200);
    expect(again.body.conversation_id).toBe(direct12);
  });

  it("bağlantı varken şirketler arası birebir konuşma tek bağlamla otomatik açılır", async () => {
    const r = await call("POST", "/conversations", u1.token, { type: "direct", member_ids: [u3.id] });
    expect(r.status).toBe(201);
    expect(r.body.company_context_id).toBe(companyA);
  });

  it("grup oluşturulur, kurucu üyedir; kurucu olmayan üye ekleyemez", async () => {
    const g = await call("POST", "/conversations", u1.token, { type: "group", name: "Proje", member_ids: [u2.id] });
    expect(g.status).toBe(201);
    group = g.body.conversation_id;
    const denied = await call("POST", `/conversations/${group}/members`, u2.token, { user_ids: [u3.id] });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");
  });

  it("kurucu üye ekler, sistem mesajı oluşur; eklenen kişi zaten aktifse ALREADY_MEMBER", async () => {
    const added = await call("POST", `/conversations/${group}/members`, u1.token, { user_ids: [u3.id] });
    expect(added.status).toBe(200);
    const dup = await call("POST", `/conversations/${group}/members`, u1.token, { user_ids: [u3.id] });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("ALREADY_MEMBER");
  });

  it("üye olmayan kullanıcıya konuşma NOT_FOUND döner (K6)", async () => {
    const r = await call("GET", `/conversations/${group}`, (await createUser(admin, "dis@sirket.test", [deptA])).token);
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("NOT_FOUND");
  });

  it("K1: grupta last_read_at yalnızca kendi kaydında dolu döner", async () => {
    await call("POST", `/conversations/${group}/read`, u2.token);
    const detail = await call("GET", `/conversations/${group}`, u1.token);
    const mine = detail.body.members.find((m: any) => m.user.user_id === u1.id);
    const other = detail.body.members.find((m: any) => m.user.user_id === u2.id);
    expect(other.last_read_at).toBeNull();
    expect(mine).toBeDefined();
  });

  it("birim yöneticisi yoksa birim kanalı açılır ve ikinci kanal reddedilir", async () => {
    const ch = await call("POST", `/admin/departments/${deptA}/channel`, admin);
    expect(ch.status).toBe(201);
    const dup = await call("POST", `/admin/departments/${deptA}/channel`, admin);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DEPARTMENT_CHANNEL_EXISTS");
  });
});

describe("mesajlar: sıra, idempotency, düzenleme, okundu", () => {
  let admin: string;
  let u1: { id: string; token: string };
  let u2: { id: string; token: string };
  let conv: string;
  let m1: string;

  beforeAll(async () => {
    admin = await seedAdmin("msg-admin@sirket.test");
    const dept = (await call("POST", "/admin/departments", admin, {
      company_id: (await call("POST", "/admin/companies", admin, { name: "Mesaj Şirketi" })).body.company_id,
      name: "Genel",
    })).body.department_id;
    u1 = await createUser(admin, "m1@sirket.test", [dept]);
    u2 = await createUser(admin, "m2@sirket.test", [dept]);
    conv = (await call("POST", "/conversations", u1.token, { type: "direct", member_ids: [u2.id] })).body.conversation_id;
  });

  it("mesaj seq ve change_seq atar, aynı istemci kimliği ikinci kayıt açmaz", async () => {
    const id = randomUUID();
    const first = await call("POST", `/conversations/${conv}/messages`, u1.token, { client_message_id: id, content: "Merhaba" });
    expect(first.status).toBe(201);
    expect(first.body.seq).toBe(1);
    expect(first.body.change_seq).toBe(1);
    m1 = first.body.message_id;
    const dup = await call("POST", `/conversations/${conv}/messages`, u1.token, { client_message_id: id, content: "Merhaba" });
    expect(dup.status).toBe(200);
    expect(dup.body.message_id).toBe(m1);
    const second = await call("POST", `/conversations/${conv}/messages`, u2.token, { client_message_id: randomUUID(), content: "Selam" });
    expect(second.body.seq).toBe(2);
    expect(second.body.change_seq).toBe(2);
  });

  it("sayfalama: en yeni, after_seq, before_seq ve after_change_seq", async () => {
    const latest = await call("GET", `/conversations/${conv}/messages`, u1.token);
    expect(latest.body.items.map((m: any) => m.seq)).toEqual([1, 2]);
    const after = await call("GET", `/conversations/${conv}/messages?after_seq=1`, u1.token);
    expect(after.body.items.map((m: any) => m.seq)).toEqual([2]);
    const before = await call("GET", `/conversations/${conv}/messages?before_seq=2`, u1.token);
    expect(before.body.items.map((m: any) => m.seq)).toEqual([1]);
    const delta = await call("GET", `/conversations/${conv}/messages?after_change_seq=1`, u1.token);
    expect(delta.body.items.map((m: any) => m.change_seq)).toEqual([2]);
  });

  it("birden fazla sayfalama parametresi VALIDATION_FAILED", async () => {
    const r = await call("GET", `/conversations/${conv}/messages?after_seq=1&before_seq=2`, u1.token);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("okundu: karşı taraf gönderimden sonra okursa read_by_peer true olur", async () => {
    // Gönderen için henüz okunmadı: false (null yalnızca başkalarının mesajında kullanılır)
    expect((await call("GET", `/conversations/${conv}/messages`, u1.token)).body.items[0].read_by_peer).toBe(false);
    advance(MIN);
    await call("POST", `/conversations/${conv}/read`, u2.token);
    const listed = await call("GET", `/conversations/${conv}/messages`, u1.token);
    const own = listed.body.items.find((m: any) => m.message_id === m1);
    expect(own.read_by_peer).toBe(true);
  });

  it("15 dakika içinde düzenlenir, change_seq artar; sonrasında EDIT_WINDOW_CLOSED", async () => {
    const before = await call("GET", `/conversations/${conv}/messages`, u1.token);
    const changeBefore = before.body.items.at(-1).change_seq;
    const edit = await call("PATCH", `/messages/${m1}`, u1.token, { content: "Merhaba (düzeltildi)" });
    expect(edit.status).toBe(200);
    expect(edit.body.content).toBe("Merhaba (düzeltildi)");
    expect(edit.body.change_seq).toBeGreaterThan(changeBefore);
    advance(16 * MIN);
    const late = await call("PATCH", `/messages/${m1}`, u1.token, { content: "geç" });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("EDIT_WINDOW_CLOSED");
  });

  it("başkası mesajı düzenleyemez; silinen mesajın içeriği null döner", async () => {
    const other = await call("PATCH", `/messages/${m1}`, u2.token, { content: "x" });
    expect(other.status).toBe(403);
    // Düzenleme penceresi kapandığı için silinecek mesaj yeni gönderilir
    const fresh = await call("POST", `/conversations/${conv}/messages`, u1.token, { client_message_id: randomUUID(), content: "silinecek" });
    const del = await call("DELETE", `/messages/${fresh.body.message_id}`, u1.token);
    expect(del.status).toBe(204);
    const listed = await call("GET", `/conversations/${conv}/messages`, u2.token);
    const gone = listed.body.items.find((m: any) => m.message_id === fresh.body.message_id);
    expect(gone.deleted).toBe(true);
    expect(gone.content).toBeNull();
  });

  it("mesaj gönderme hız sınırı: dakikada 60, aşımda 429 ve Retry-After", async () => {
    // Önceki gönderimler (1 + 1 + silme/düzenleme sayılmaz). Pencereyi temizlemek için saati ilerlet.
    advance(2 * MIN);
    for (let i = 0; i < 60; i++) {
      const r = await call("POST", `/conversations/${conv}/messages`, u1.token, { client_message_id: randomUUID(), content: `n${i}` });
      expect(r.status).toBe(201);
    }
    const blocked = await call("POST", `/conversations/${conv}/messages`, u1.token, { client_message_id: randomUUID(), content: "fazla" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThanOrEqual(1);
  });
});

describe("ticket (karar patrondadır, K5)", () => {
  let admin: string;
  let dept: number;
  let dept2: number;
  let requester: { id: string; token: string };
  let patron: { id: string; token: string };
  let colleague: { id: string; token: string };
  let ticket: string;

  beforeAll(async () => {
    admin = await seedAdmin("tk-admin@sirket.test");
    const company = (await call("POST", "/admin/companies", admin, { name: "Ticket Şirketi" })).body.company_id;
    dept = (await call("POST", "/admin/departments", admin, { company_id: company, name: "Ik" })).body.department_id;
    dept2 = (await call("POST", "/admin/departments", admin, { company_id: company, name: "Muhasebe" })).body.department_id;
    requester = await createUser(admin, "talep@sirket.test", [dept]);
    colleague = await createUser(admin, "calisan@sirket.test", [dept]);
    patron = await createUser(admin, "patron@sirket.test", [dept], "executive");
  });

  const body = (client: string) => ({
    client_request_id: client,
    target_department_id: 0,
    title: "Izin talebi",
    body: "Yıllık izin için onay rica ediyorum.",
  });

  it("ticket açılır, aynı istemci kimliği ikinci ticket açmaz", async () => {
    const id = randomUUID();
    const first = await call("POST", "/tickets", requester.token, { ...body(id), target_department_id: dept2 });
    expect(first.status).toBe(201);
    ticket = first.body.ticket_id;
    const dup = await call("POST", "/tickets", requester.token, { ...body(id), target_department_id: dept2 });
    expect(dup.status).toBe(200);
    expect(dup.body.ticket_id).toBe(ticket);
  });

  it("gövde yalnızca talep eden ve patrona görünür (Ç11)", async () => {
    expect((await call("GET", `/tickets/${ticket}`, requester.token)).body.body).toContain("izin");
    expect((await call("GET", `/tickets/${ticket}`, patron.token)).body.body).toContain("izin");
    const other = await call("GET", `/tickets/${ticket}`, colleague.token);
    expect(other.status).toBe(403);
  });

  it("düzenleme 15 dakika içinde yapılır, önceki hal kopyalanır", async () => {
    const r = await call("PATCH", `/tickets/${ticket}`, requester.token, { title: "Yıllık izin" });
    expect(r.status).toBe(200);
    expect(r.body.title).toBe("Yıllık izin");
  });

  it("çalışan (birim yöneticisi dahil) karar veremez; patron karar verir", async () => {
    const denied = await call("POST", `/tickets/${ticket}/decision`, colleague.token, { decision: "approved" });
    expect(denied.status).toBe(403);
    const ok = await call("POST", `/tickets/${ticket}/decision`, patron.token, { decision: "approved" });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("approved");
    expect(ok.body.decisions.length).toBe(1);
  });

  it("ticket başına tek karar: ikinci karar REQUEST_NOT_PENDING, düzenleme kapalı", async () => {
    const again = await call("POST", `/tickets/${ticket}/decision`, patron.token, { decision: "rejected" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("REQUEST_NOT_PENDING");
    const edit = await call("PATCH", `/tickets/${ticket}`, requester.token, { title: "Sonradan" });
    expect(edit.status).toBe(409);
  });

  it("talep eden kendi ticket'ına karar veremez (patron olsa bile)", async () => {
    const own = await call("POST", "/tickets", patron.token, { ...body(randomUUID()), target_department_id: dept2 });
    const r = await call("POST", `/tickets/${own.body.ticket_id}/decision`, patron.token, { decision: "approved" });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("SELF_DECISION_FORBIDDEN");
  });

  it("süresi dolan ticket kapanır ve yeniden açılabilir (Ç14)", async () => {
    const pending = await call("POST", "/tickets", requester.token, { ...body(randomUUID()), target_department_id: dept2 });
    advance(73 * HOUR);
    await expireDue(ctx);
    const expired = await call("GET", `/tickets/${pending.body.ticket_id}`, requester.token);
    expect(expired.body.status).toBe("expired");
    const reopened = await call("POST", `/tickets/${pending.body.ticket_id}/reopen`, requester.token);
    expect(reopened.status).toBe(201);
    expect(reopened.body.reopened_from).toBe(pending.body.ticket_id);
    expect(reopened.body.status).toBe("pending");
  });

  it("ticket hız sınırı: saatte 20, aşımda 429 ve Retry-After", async () => {
    const spammer = await createUser(await seedAdmin("hiz-admin@sirket.test"), "hiz@sirket.test", [dept]);
    for (let i = 0; i < 20; i++) {
      const r = await call("POST", "/tickets", spammer.token, { ...body(randomUUID()), target_department_id: dept2 });
      expect(r.status).toBe(201);
    }
    const blocked = await call("POST", "/tickets", spammer.token, { ...body(randomUUID()), target_department_id: dept2 });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThanOrEqual(1);
  });
});

describe("erişim talebi (çok birimli onay, K3, patron karar yetkisi)", () => {
  let admin: string;
  let deptRequestA: number;
  let deptRequestB: number;
  let convId: string;
  let requester: { id: string; token: string };
  let memberB: { id: string; token: string };
  let patron: { id: string; token: string };
  let sysAdminToken: string;
  let requestId: string;

  beforeAll(async () => {
    admin = await seedAdmin("er-admin@sirket.test");
    sysAdminToken = admin;
    const company = (await call("POST", "/admin/companies", admin, { name: "Erişim Şirketi" })).body.company_id;
    deptRequestA = (await call("POST", "/admin/departments", admin, { company_id: company, name: "Satın Alma" })).body.department_id;
    deptRequestB = (await call("POST", "/admin/departments", admin, { company_id: company, name: "Finans" })).body.department_id;
    requester = await createUser(admin, "talepeden@sirket.test", [deptRequestA]);
    memberB = await createUser(admin, "uyeb@sirket.test", [deptRequestB]);
    patron = await createUser(admin, "er-patron@sirket.test", [deptRequestA], "executive");
    convId = (await call("POST", "/conversations", requester.token, { type: "group", name: "Ortak", member_ids: [memberB.id] })).body.conversation_id;
    await call("POST", `/conversations/${convId}/messages`, memberB.token, { client_message_id: randomUUID(), content: "Eski mesaj içeriği" });
  });

  it("gerekçe en az 20 karakter olmalı (REASON_TOO_SHORT)", async () => {
    const r = await call("POST", "/access-requests", requester.token, {
      client_request_id: randomUUID(),
      conversation_id: convId,
      reason: "kısa",
      target_department_ids: [deptRequestB],
    });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("REASON_TOO_SHORT");
  });

  it("hedef birim konuşmada yoksa TARGET_NOT_IN_CONVERSATION", async () => {
    const r = await call("POST", "/access-requests", requester.token, {
      client_request_id: randomUUID(),
      conversation_id: convId,
      reason: "Projenin eski kararlarını görmem gerekiyor.",
      target_department_ids: [9999],
    });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("TARGET_NOT_IN_CONVERSATION");
  });

  it("iki birime talep açılır, meta veri onaylayana görünür", async () => {
    const r = await call("POST", "/access-requests", requester.token, {
      client_request_id: randomUUID(),
      conversation_id: convId,
      reason: "Projenin eski kararlarını görmem gerekiyor.",
      target_department_ids: [deptRequestA, deptRequestB],
    });
    expect(r.status).toBe(201);
    requestId = r.body.request_id;
    expect(r.body.targets.length).toBe(2);
    const approverList = await call("GET", "/access-requests?role=approver", patron.token);
    expect(approverList.body.items.some((i: any) => i.request_id === requestId)).toBe(true);
  });

  it("K3: patron karar öncesi içeriği okur; sistem yöneticisi ve talep eden okuyamaz", async () => {
    const ok = await call("GET", `/access-requests/${requestId}/targets/${deptRequestB}/content`, patron.token);
    expect(ok.status).toBe(200);
    expect(ok.body.items.some((m: any) => m.content === "Eski mesaj içeriği")).toBe(true);
    const admin403 = await call("GET", `/access-requests/${requestId}/targets/${deptRequestB}/content`, sysAdminToken);
    expect(admin403.status).toBe(403);
    expect(admin403.body.error.code).toBe("CONTENT_NOT_VISIBLE");
    const self = await call("GET", `/access-requests/${requestId}/targets/${deptRequestB}/content`, requester.token);
    expect(self.status).toBe(403);
  });

  it("tek hedef onayı talebi beklemede tutar; sistem yöneticisi patron varken karar veremez", async () => {
    const adminTry = await call("POST", `/access-requests/${requestId}/targets/${deptRequestA}/decision`, sysAdminToken, { decision: "approved" });
    expect(adminTry.status).toBe(403);
    const first = await call("POST", `/access-requests/${requestId}/targets/${deptRequestA}/decision`, patron.token, { decision: "approved" });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("pending");
  });

  it("tüm hedefler onaylanınca talep onaylanır; erişim süresi başlar; talep eden içeriği okur", async () => {
    const last = await call("POST", `/access-requests/${requestId}/targets/${deptRequestB}/decision`, patron.token, { decision: "approved" });
    expect(last.body.status).toBe("approved");
    expect(last.body.access_expires_at).not.toBeNull();
    const content = await call("GET", `/access-requests/${requestId}/content`, requester.token);
    expect(content.status).toBe(200);
    expect(content.headers["cache-control"]).toBe("no-store");
    expect(content.body.items.length).toBeGreaterThan(0);
  });

  it("copy_blocked olayı onaylı talepte kaydedilir", async () => {
    const r = await call("POST", `/access-requests/${requestId}/events`, requester.token, { type: "copy_blocked" });
    expect(r.status).toBe(204);
  });

  it("erişim süresi dolunca içerik 410 ACCESS_WINDOW_EXPIRED", async () => {
    advance(25 * HOUR);
    const r = await call("GET", `/access-requests/${requestId}/content`, requester.token);
    expect(r.status).toBe(410);
    expect(r.body.error.code).toBe("ACCESS_WINDOW_EXPIRED");
  });

  it("bir hedef reddederse talep reddedilir; kendi talebine karar yasak", async () => {
    const r = await call("POST", "/access-requests", requester.token, {
      client_request_id: randomUUID(),
      conversation_id: convId,
      reason: "İkinci talep: bu kez başka gerekçe ile.",
      target_department_ids: [deptRequestA, deptRequestB],
    });
    const rej = await call("POST", `/access-requests/${r.body.request_id}/targets/${deptRequestA}/decision`, patron.token, { decision: "rejected" });
    expect(rej.body.status).toBe("rejected");
    const after = await call("POST", `/access-requests/${r.body.request_id}/targets/${deptRequestB}/decision`, patron.token, { decision: "approved" });
    expect(after.status).toBe(409);
    expect(after.body.error.code).toBe("REQUEST_NOT_PENDING");
  });

  it("talep eden patron ise kendi talebine karar veremez", async () => {
    const r = await call("POST", "/access-requests", patron.token, {
      client_request_id: randomUUID(),
      conversation_id: convId,
      reason: "Patron olarak kendi talebim, karar verilmemeli.",
      target_department_ids: [deptRequestB],
    });
    // Patron bu konuşmanın üyesi değil: üye olmayana NOT_FOUND (K6)
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("NOT_FOUND");
  });

  it("süresi dolan talep kapanır, yeniden açılabilir ve hedefleri yeniden alır", async () => {
    const r = await call("POST", "/access-requests", requester.token, {
      client_request_id: randomUUID(),
      conversation_id: convId,
      reason: "Süresi dolacak talep için gerekçe metni.",
      target_department_ids: [deptRequestB],
    });
    advance(73 * HOUR);
    await expireDue(ctx);
    const expired = await call("GET", `/access-requests/${r.body.request_id}`, requester.token);
    expect(expired.body.status).toBe("expired");
    const reopened = await call("POST", `/access-requests/${r.body.request_id}/reopen`, requester.token);
    expect(reopened.status).toBe(201);
    expect(reopened.body.reopened_from).toBe(r.body.request_id);
    expect(reopened.body.targets.length).toBe(1);
  });
});

describe("ayrılan çalışan", () => {
  it("pasifleştirilen kullanıcı konuşmalardan çıkar, sistem mesajı düşer, oturumu kapanır", async () => {
    const admin = await seedAdmin("pas-admin@sirket.test");
    const dept = (await call("POST", "/admin/departments", admin, {
      company_id: (await call("POST", "/admin/companies", admin, { name: "Pasif Şirketi" })).body.company_id,
      name: "Operasyon",
    })).body.department_id;
    const a = await createUser(admin, "pa@sirket.test", [dept]);
    const b = await createUser(admin, "pb@sirket.test", [dept]);
    const conv = (await call("POST", "/conversations", a.token, { type: "group", name: "Ekip", member_ids: [b.id] })).body.conversation_id;
    const off = await call("POST", `/admin/users/${b.id}/deactivate`, admin);
    expect(off.status).toBe(200);
    expect(off.body.is_active).toBe(false);
    const listed = await call("GET", `/conversations/${conv}/messages`, a.token);
    expect(listed.body.items.some((m: any) => m.message_type === "system" && m.content.includes("ayrıldı"))).toBe(true);
    const relogin = await call("POST", "/auth/login", undefined, { email: "pb@sirket.test", password: PASSWORD });
    expect(relogin.status).toBe(403);
    const reactivated = await call("POST", `/admin/users/${b.id}/activate`, admin);
    expect(reactivated.status).toBe(200);
    // Yeniden aktif edilince otomatik eklenmez
    const notBack = await call("GET", `/conversations/${conv}`, b.token);
    expect(notBack.status).toBe(404);
  });
});

describe("yönetim denetimi", () => {
  it("onay yapılandırması okunur ve doğrulanır", async () => {
    const admin = await seedAdmin("rules-admin@sirket.test");
    const got = await call("GET", "/admin/approval-rules", admin);
    expect(got.body.request_expiry_hours).toBe(72);
    const bad = await call("PATCH", "/admin/approval-rules", admin, { message_rate_per_min: 0 });
    expect(bad.status).toBe(400);
    const ok = await call("PATCH", "/admin/approval-rules", admin, { message_rate_per_min: 80 });
    expect(ok.body.message_rate_per_min).toBe(80);
  });
});
