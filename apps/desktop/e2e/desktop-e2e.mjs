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

async function api(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

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
