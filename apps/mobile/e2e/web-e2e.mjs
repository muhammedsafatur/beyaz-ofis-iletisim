// Mobil uygulama (web derlemesi) uçtan uca: giriş, konuşma, @ anma önerisi, iş ekranı (ticket ve talep), patron onayı.
// Ön koşul: yerel API (apps/api: port 3000) ve web derlemesi + proxy (bkz. README: serve-web.mjs, port 8081).
import { chromium } from "playwright-core";
import os from "node:os";

const APP = process.env.MOBILE_URL ?? "http://127.0.0.1:8081/";
const API = process.env.MOBILE_API ?? "http://127.0.0.1:8081/api/v1";
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

async function login(page, email) {
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.getByTestId("email").fill(email);
  await page.getByTestId("password").fill("demo-parola-123");
  await page.getByTestId("login-submit").click();
  await page.getByTestId("conversation-item").first().waitFor({ timeout: 20000 });
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

await page.goto(APP, { waitUntil: "networkidle" });
check("giriş formu görünür", (await page.getByTestId("login-submit").count()) === 1);

await login(page, "ali@demo.test");
check("giriş sonrası konuşma listesi gelir", (await page.getByTestId("conversation-item").count()) >= 1);

await page.getByTestId("conversation-item").filter({ hasText: "Satış ekibi" }).click();
await page.getByTestId("composer").waitFor({ timeout: 10000 });
check("grup konuşması açılır", true);

// @ anma: öneri çubuğu, seçim ve anma gönderimi
await page.getByTestId("composer").fill("@Ayş");
await page.getByTestId("mention-option").first().waitFor({ timeout: 10000 });
check("mobil: @ yazınca üye önerisi çıkar", true);
await page.getByTestId("mention-option").first().click();
const anma = `Mobil anma ${Date.now()}`;
await page.getByTestId("composer").fill(`@Ayşe Kaya ${anma}`);
await page.getByTestId("send").click();
await page.getByText(anma).first().waitFor({ timeout: 10000 });
check("anmalı mesaj gönderilir ve listede görünür", true);

// Sunucuda anma kaydı (ali'nin oturumu, grup mesajları)
const aliLogin = await api("POST", "/auth/login", null, { email: "ali@demo.test", password: "demo-parola-123" });
const ayseLogin = await api("POST", "/auth/login", null, { email: "ayse@demo.test", password: "demo-parola-123" });
const ayseMe = await api("GET", "/users/me", ayseLogin.body.access_token);
const convs = (await api("GET", "/conversations", aliLogin.body.access_token)).body.items;
const groupId = convs.find((c) => c.name === "Satış ekibi")?.conversation_id;
const msgs = (await api("GET", `/conversations/${groupId}/messages`, aliLogin.body.access_token)).body.items;
const sent = msgs.find((m) => m.content?.endsWith(anma));
check("anma sunucuda kayıtlı (mentions)", sent?.mentions?.includes(ayseMe.body.user_id) === true);

// Ek: dosya seçilir, yüklenir, bağlı mesajda görünür; indirme bağlantısı içeriği aynen verir
const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("attach").click()]);
// Aynı konuşmada önceki çalıştırmaların ekleri de olabilir; ad çalıştırmaya özgüdür ve yalnızca bu ek seçilir
const fileName = `mobil-not-${Date.now()}.txt`;
await chooser.setFiles({ name: fileName, mimeType: "text/plain", buffer: Buffer.from("mobil ek icerigi") });
const uploadedLink = page.getByTestId("attachment-link").filter({ hasText: fileName });
await uploadedLink.waitFor({ timeout: 15000 });
check("mobil: ek yüklenir ve mesaja bağlı görünür", true);
// Tarayıcı dosyayı indirir (Content-Disposition: attachment); indirme isteğinin adresinden içerik doğrulanır
const [popup, downloadReq] = await Promise.all([
  ctx.waitForEvent("page"),
  ctx.waitForEvent("request", (r) => r.url().includes("/download")),
  uploadedLink.click(),
]);
const downloaded = await (await fetch(downloadReq.url())).text();
check("mobil: ek indirme bağlantısı içeriği aynen verir", downloaded.includes("mobil ek icerigi"));
await popup.close().catch(() => undefined);

// İş ekranı: İş düğmesi konuşma listesindedir; sohbetten listeye dönülür
await page.getByTestId("back").click();
await page.getByTestId("conversation-item").first().waitFor({ timeout: 10000 });

// Gerçek zamanlı anma: Ayşe, Ali'yi grupta anar; açık uygulamada banner görünür, dokununca konuşma açılır
const aliMe = await api("GET", "/users/me", aliLogin.body.access_token);
const realtimeText = `Ali bunu gorur musun ${Date.now()}`;
const liveMention = await api("POST", `/conversations/${groupId}/messages`, ayseLogin.body.access_token, {
  client_message_id: crypto.randomUUID(),
  content: realtimeText,
  mentions: [aliMe.body.user_id],
});
check("Ayşe Ali'yi grupta anar (sunucu kabul eder)", liveMention.status === 201);
await page.getByTestId("mention-banner").waitFor({ timeout: 15000 });
check("mobil web: gerçek zamanlı anma banner'ı görünür", true);
await page.getByTestId("mention-banner").click();
await page.getByTestId("composer").waitFor({ timeout: 10000 });
check("banner'a dokunulunca anılan konuşma açılır", true);
await page.getByTestId("back").click();
await page.getByTestId("conversation-item").first().waitFor({ timeout: 10000 });
await page.getByTestId("work-open").click();
await page.getByTestId("work-tab-ticket").waitFor({ timeout: 10000 });
await page.locator('[data-testid="ticket-dept"]', { hasText: "İnsan Kaynakları" }).click();
const ticketTitle = `Mobil ticket ${Date.now()}`;
await page.getByTestId("ticket-title").fill(ticketTitle);
await page.getByTestId("ticket-body").fill("Bu bir mobil web üzerinden açılan ticket testidir.");
await page.getByTestId("ticket-submit").click();
await page.getByText(ticketTitle).first().waitFor({ timeout: 10000 });
check("iş ekranından ticket açılır ve listelenir", true);

// Eski mesaj talebi (çalışan), hedef İK
await page.getByTestId("work-tab-request").click();
await page.getByText("Satış ekibi", { exact: true }).click();
await page.locator('[data-testid="request-dept"]', { hasText: "İnsan Kaynakları" }).click();
const reason = `Mobil talep için erişim gerekiyor ${Date.now()}`;
await page.getByTestId("request-reason").fill(reason);
await page.getByTestId("request-submit").click();
await page.getByText("İnsan Kaynakları: beklemede").first().waitFor({ timeout: 10000 });
check("erişim talebi oluşturulur ve beklemede görünür", true);

// Patron: kuyruktan onaylar (ayrı oturum)
const bossCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const boss = await bossCtx.newPage();
await login(boss, "patron@demo.test");
await boss.getByTestId("work-open").click();
await boss.getByTestId("work-tab-request").click();
const queued = boss.locator("div").filter({ hasText: reason }).filter({ has: boss.getByTestId("request-approve") }).last();
await queued.waitFor({ timeout: 10000 });
check("patron mobilde karar kuyruğunda talebi görür", true);
await queued.getByTestId("request-approve").click();
await queued.waitFor({ state: "detached", timeout: 10000 });
check("patron mobilden onaylar; talep kuyruktan düşer", true);
await bossCtx.close();

// Çalışan: iş ekranını kapatıp yeniden açar, durumu görür
await page.getByTestId("work-back").click();
await page.getByTestId("work-open").click();
await page.getByTestId("work-tab-request").click();
await page.getByText("İnsan Kaynakları: onaylandı").first().waitFor({ timeout: 10000 });
check("çalışan talebinin onaylandığını mobilde görür", true);
await page.screenshot({ path: `${SHOTS}/mobile-web-work.png` });

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\nToplam ${results.length}, başarısız ${failed}`);
process.exit(failed === 0 ? 0 : 1);
