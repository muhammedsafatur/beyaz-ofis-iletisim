// Masaüstü arayüzü uçtan uca: giriş, konuşma seçimi, gönderim, okundu, canlı senkronizasyon.
// Ön koşul: yerel API (apps/api: pnpm dev:local, port 3000) ve Vite (apps/desktop: pnpm dev, port 5173).
// Chrome yolu CHROME_PATH ile verilir; ekran görüntüleri SHOTS klasörüne (varsayılan: geçici klasör) yazılır.
import { chromium } from "playwright-core";
import os from "node:os";

const APP = "http://localhost:5173/";
const API = "http://localhost:5173/api/v1";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHOTS = process.env.SHOTS ?? os.tmpdir();
const results = [];
const check = (label, ok, extra = "") => {
  results.push({ label, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
};

let cachedGroupId = null;
const groupConvId = () => cachedGroupId;

async function api(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const seedLogin = await (await fetch(API + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "ali@demo.test", password: "demo-parola-123" }) })).json();
cachedGroupId = (await (await fetch(API + "/conversations", { headers: { authorization: `Bearer ${seedLogin.access_token}` } })).json()).items.find((c) => c.name === "Satış ekibi")?.conversation_id ?? null;

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(`${e.message} ${e.stack ?? ""}`.slice(0, 400)));

try {
  await page.goto(APP, { waitUntil: "networkidle" });
  check("giriş formu görünür", await page.getByTestId("login-form").isVisible());

  // Yanlış parola
  await page.getByTestId("password").fill("yanlis-parola");
  await page.getByTestId("login-submit").click();
  await page.getByTestId("login-error").waitFor({ timeout: 10000 });
  check("yanlış parolada hata gösterilir", (await page.getByTestId("login-error").textContent())?.length > 0);

  // Doğru giriş
  await page.getByTestId("password").fill("demo-parola-123");
  await page.getByTestId("login-submit").click();
  await page.getByTestId("sidebar").waitFor({ timeout: 10000 });
  const items = page.getByTestId("conversation-item");
  await items.first().waitFor();
  check("giriş sonrası konuşma listesi gelir", (await items.count()) >= 2, `${await items.count()} konuşma`);
  await page.screenshot({ path: `${SHOTS}/desktop-1-list.png` });

  // Grup konuşmasını aç
  const group = page.locator('[data-testid="conversation-item"]', { hasText: "Satış ekibi" });
  await group.click();
  await page.getByTestId("message-view").waitFor();
  await page.getByText("Herkese merhaba").waitFor({ timeout: 10000 });
  check("grup mesajları yüklenir", await page.getByText("Herkese merhaba").isVisible());
  await page.screenshot({ path: `${SHOTS}/desktop-2-group.png` });

  // Gönderim
  const text = `Masaüstü testi ${Date.now()}`;
  await page.getByTestId("composer").fill(text);
  await page.getByTestId("send").click();
  await page.getByText(text).waitFor({ timeout: 10000 });
  const sentBubble = page.locator('[data-testid="message"]', { hasText: text });
  await page.waitForFunction(
    (t) => {
      const el = [...document.querySelectorAll('[data-testid="message"]')].find((n) => n.textContent?.includes(t));
      return el && el.getAttribute("data-pending") === "";
    },
    text,
    { timeout: 10000 },
  );
  check("gönderilen mesaj kaydedilir (bekleyen işareti kalkar)", await sentBubble.isVisible());

  // Sunucuda gerçekten var mı?
  const login = await api("POST", "/auth/login", null, { email: "ali@demo.test", password: "demo-parola-123" });
  const groupId = (await api("GET", "/conversations", login.body.access_token)).body.items.find((c) => c.name === "Satış ekibi").conversation_id;
  const serverMsgs = (await api("GET", `/conversations/${groupId}/messages`, login.body.access_token)).body.items;
  check("mesaj sunucuda kayıtlı", serverMsgs.some((m) => m.content === text));

  // Canlı senkronizasyon: Ayşe'den mesaj gelir, arayüz polling ile görür
  const ayse = await api("POST", "/auth/login", null, { email: "ayse@demo.test", password: "demo-parola-123" });
  const incoming = `Ayşe'den canlı mesaj ${Date.now()}`;
  const sent = await api("POST", `/conversations/${groupId}/messages`, ayse.body.access_token, {
    client_message_id: crypto.randomUUID(),
    content: incoming,
  });
  check("karşı taraf mesajı sunucuya yazıldı", sent.status === 201);
  await page.getByText(incoming).waitFor({ timeout: 12000 });
  check("karşı taraf mesajı arayüzde canlı göründü (delta)", await page.getByText(incoming).isVisible());

  // Okundu bilgisi: Ayşe okur, gönderenin mesajında 'okudu' görünür
  await api("POST", `/conversations/${groupId}/read`, ayse.body.access_token);
  await page.waitForFunction((t) => {
    const el = [...document.querySelectorAll('[data-testid="message"]')].find((n) => n.textContent?.includes(t));
    return el?.textContent?.includes("okudu") ?? false;
  }, text, { timeout: 12000 }).catch(() => undefined);
  const receipt = await page.locator('[data-testid="message"]', { hasText: text }).textContent();
  check("okundu bilgisi gönderen mesajında görünür (K2)", receipt?.includes("okudu") === true, receipt?.slice(-40));

  // Birebir konuşma ve karşı taraf adı
  const direct = page.locator('[data-testid="conversation-item"]', { hasText: "Ayşe Kaya" });
  await direct.first().waitFor({ timeout: 10000 });
  check("birebir konuşmada karşı tarafın adı görünür", await direct.first().isVisible());
  await direct.first().click();
  await page.getByText("Akşam çıkıyor musun?").waitFor({ timeout: 10000 });
  check("birebir konuşma mesajları yüklenir", await page.getByText("Akşam çıkıyor musun?").isVisible());
  await page.screenshot({ path: `${SHOTS}/desktop-3-direct.png` });

  // @ anma: üye önerisi, anılan kişiye gönderim (karar: vurgu + anlık bildirim)
  await group.click();
  await page.getByTestId("message-view").waitFor();
  await page.getByTestId("composer").fill("@Ayş");
  await page.getByTestId("mention-option").first().waitFor({ timeout: 5000 });
  check("@ yazınca üye önerisi çıkar", true);
  await page.getByTestId("mention-option").first().click();
  const anmaText = `Ayşe bunu görür müsün ${Date.now()}`;
  await page.getByTestId("composer").fill(`@Ayşe Kaya ${anmaText}`);
  await page.getByTestId("send").click();
  await page.getByText(anmaText).waitFor({ timeout: 10000 });
  const aliApi = await api("POST", "/auth/login", null, { email: "ali@demo.test", password: "demo-parola-123" });
  const aysApi = await api("POST", "/auth/login", null, { email: "ayse@demo.test", password: "demo-parola-123" });
  const ayseMe = await api("GET", "/users/me", aysApi.body.access_token);
  const groupMsgs = (await api("GET", `/conversations/${groupConvId()}/messages`, aliApi.body.access_token)).body.items;
  const anmaMsg = groupMsgs.find((m) => m.content?.endsWith(anmaText));
  check("anma sunucuda kayıtlı (mentions)", anmaMsg?.mentions?.includes(ayseMe.body.user_id) === true);

  // Alıcı kendi oturumunda anmayı vurgulu görür
  const recvCtx = await browser.newContext();
  const recv = await recvCtx.newPage();
  await recv.goto(APP, { waitUntil: "networkidle" });
  await recv.getByTestId("email").fill("ayse@demo.test");
  await recv.getByTestId("password").fill("demo-parola-123");
  await recv.getByTestId("login-submit").click();
  await recv.getByTestId("conversation-item").first().waitFor({ timeout: 10000 });
  await recv.locator('[data-testid="conversation-item"]', { hasText: "Satış ekibi" }).click();
  await recv.getByText(anmaText).waitFor({ timeout: 10000 });
  const highlighted = await recv.locator('[data-testid="message"][data-mention="true"]', { hasText: anmaText }).count();
  check("alıcı anmayı vurgulu görür", highlighted > 0);
  await recvCtx.close();

  // İş paneli: ticket açılır ve listede görünür
  await page.getByTestId("work-open").click();
  await page.getByTestId("work-panel").waitFor({ timeout: 10000 });
  await page.getByTestId("ticket-dept").selectOption({ index: 1 });
  await page.getByTestId("ticket-title").fill("E2E ticket");
  await page.getByTestId("ticket-body").fill("Bu bir uçtan uca ticket testidir.");
  await page.getByTestId("ticket-submit").click();
  await page.locator('[data-testid="ticket-row"]', { hasText: "E2E ticket" }).waitFor({ timeout: 10000 });
  check("iş panelinden ticket açılır ve listelenir", true);
  // Erişim talebi: çalışan talep eder (hedef İK), patron kuyruktan onaylar (K3)
  const reason = `Toplantı notları için erişim gerekiyor ${Date.now()}`;
  await page.getByTestId("work-tab-request").click();
  await page.getByTestId("request-conversation").selectOption({ label: "Satış ekibi" });
  await page.getByLabel("İnsan Kaynakları").check();
  await page.getByTestId("request-reason").fill(reason);
  await page.getByTestId("request-submit").click();
  await page.locator('[data-testid="request-row"]', { hasText: "İnsan Kaynakları: beklemede" }).first().waitFor({ timeout: 10000 });
  check("erişim talebi oluşturulur ve beklemede görünür", true);

  const bossCtx = await browser.newContext();
  const boss = await bossCtx.newPage();
  await boss.goto(APP, { waitUntil: "networkidle" });
  await boss.getByTestId("email").fill("patron@demo.test");
  await boss.getByTestId("password").fill("demo-parola-123");
  await boss.getByTestId("login-submit").click();
  await boss.getByTestId("sidebar").waitFor({ timeout: 20000 });
  await boss.getByTestId("work-open").click();
  await boss.getByTestId("work-tab-request").click();
  const queued = boss.locator('[data-testid="request-queue-row"]', { hasText: reason });
  await queued.waitFor({ timeout: 10000 });
  check("patron karar kuyruğunda talebi görür", true);
  await queued.locator('[data-testid="request-approve"]').click();
  await queued.waitFor({ state: "detached", timeout: 10000 });
  check("patron onaylar; talep kuyruktan düşer", true);
  await bossCtx.close();

  await page.locator('[data-testid="work-panel"] button', { hasText: "Kapat" }).click();
  await page.getByTestId("work-open").click();
  await page.getByTestId("work-tab-request").click();
  await page.locator('[data-testid="request-row"]', { hasText: "İnsan Kaynakları: onaylandı" }).first().waitFor({ timeout: 10000 });
  check("çalışan talebinin onaylandığını görür", true);
  await page.locator('[data-testid="work-panel"] button', { hasText: "Kapat" }).click();

  // Dosya eki: yüklenir, mesaja bağlanır, indirme bağlantısı görünür (Faz 2)
  await page.setInputFiles('[data-testid="file-input"]', {
    name: "not.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("merhaba dosya"),
  });
  await page.getByTestId("attachment-link").first().waitFor({ timeout: 15000 });
  const linkText = await page.getByTestId("attachment-link").first().textContent();
  check("dosya eki mesaja bağlanır ve görünür", linkText?.includes("not.txt") === true, linkText?.trim());

  // Çıkış
  await page.getByTestId("logout").click();
  await page.getByTestId("login-form").waitFor({ timeout: 10000 });
  check("çıkış sonrası giriş ekranına dönülür", await page.getByTestId("login-form").isVisible());

  // Sistem yöneticisi: denetim kaydı ekranı (Faz 2)
  await page.getByTestId("email").fill("admin@demo.test");
  await page.getByTestId("password").fill("demo-parola-123");
  await page.getByTestId("login-submit").click();
  await page.getByTestId("audit-open").waitFor({ timeout: 10000 });
  await page.getByTestId("audit-open").click();
  await page.getByTestId("audit-panel").waitFor({ timeout: 10000 });
  await page.getByTestId("audit-row").first().waitFor({ timeout: 10000 });
  const rows = await page.getByTestId("audit-row").count();
  check("denetim kaydı ekranı kayıtları listeler", rows > 0, `${rows} kayıt`);
  await page.getByTestId("logout").click();
  await page.getByTestId("login-form").waitFor({ timeout: 10000 });
} catch (err) {
  check("beklenmeyen hata", false, err.message);
  await page.screenshot({ path: `${SHOTS}/desktop-error.png` }).catch(() => undefined);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nToplam ${results.length}, başarısız ${failed}`);
if (pageErrors.length) console.log("Sayfa hataları:", pageErrors);
process.exit(failed ? 1 : 0);
