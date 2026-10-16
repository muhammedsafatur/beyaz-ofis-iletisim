// Electron penceresi uçtan uca: güvenli depoda belirteç saklama, açılışta oturum geri yükleme, çıkışta silme.
// Ön koşul: yerel API (apps/api: port 3000) ve Vite (apps/desktop: port 5173) çalışıyor olmalı.
// Derleme: npx tsc -p tsconfig.electron.json (dist-electron/main.js ve preload.js üretir).
import { _electron as electron } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = "http://localhost:5173/";
const SHOTS = process.env.SHOTS ?? os.tmpdir();
const results = [];
const check = (label, ok, extra = "") => {
  results.push({ label, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
};

const launch = () =>
  electron.launch({
    args: [path.join(DESKTOP, "dist-electron", "main.js")],
    cwd: DESKTOP,
    env: { ...process.env, VITE_DEV_SERVER_URL: APP },
  });

const app = await launch();
const userData = await app.evaluate(({ app }) => app.getPath("userData"));
const tokensFile = path.join(userData, "tokens.bin");
if (fs.existsSync(tokensFile)) fs.rmSync(tokensFile);

const win = await app.firstWindow();
await win.getByTestId("login-form").waitFor({ timeout: 20000 });
check("pencere açılır ve giriş formu görünür", true);

const bridge = await win.evaluate(() => typeof window.beyazOfis?.tokens?.save);
check("preload belirteç köprüsünü sunar", bridge === "function");

await win.getByTestId("email").fill("ali@demo.test");
await win.getByTestId("password").fill("demo-parola-123");
await win.getByTestId("login-submit").click();
await win.getByTestId("sidebar").waitFor({ timeout: 20000 });
check("giriş yapılır ve konuşma listesi açılır", true);

check("belirteç güvenli depoya (tokens.bin) yazılır", fs.existsSync(tokensFile));
const raw = fs.existsSync(tokensFile) ? fs.readFileSync(tokensFile) : Buffer.alloc(0);
check("depo dosyası düz metin belirteç içermez", raw.length > 0 && !raw.toString("utf8").includes("access_token"));
await win.screenshot({ path: path.join(SHOTS, "electron-login.png") });
await app.close();

// Yeniden açılış: kayıtlı oturum varsa giriş formu gelmeden konuşma listesi açılır
const app2 = await launch();
const win2 = await app2.firstWindow();
const restored = await win2
  .getByTestId("sidebar")
  .waitFor({ timeout: 20000 })
  .then(() => true)
  .catch(() => false);
check("yeniden açılışta oturum geri yüklenir", restored);
await win2.screenshot({ path: path.join(SHOTS, "electron-restored.png") });

await win2.getByTestId("logout").click();
await win2.getByTestId("login-form").waitFor({ timeout: 10000 });
check("çıkış giriş ekranına döndürür", true);
check("çıkışta belirteç dosyadan silinir", !fs.existsSync(tokensFile));
await app2.close();

const failed = results.filter((r) => !r.ok).length;
console.log(`\nToplam ${results.length}, başarısız ${failed}`);
process.exit(failed === 0 ? 0 : 1);
