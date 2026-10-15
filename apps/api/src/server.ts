import { buildApp } from "./app.js";
import { connect } from "./db.js";
import { env } from "./env.js";
import { expireDue } from "./services/scheduler.js";
import { clamdScanner, noScanner } from "./scanner.js";
import { expoPushSender, noPush } from "./push.js";

// Üretimde dosya taraması zorunlu; geliştirmede yoksa açıkça uyarılır.
if (process.env.NODE_ENV === "production" && !env.CLAMD_HOST) {
  throw new Error("Üretimde CLAMD_HOST zorunlu (dosya taraması).");
}
if (!env.CLAMD_HOST) console.warn("[güvenlik] CLAMD_HOST tanımlı değil: dosya taraması YAPILMIYOR.");
const scanner = env.CLAMD_HOST ? clamdScanner({ host: env.CLAMD_HOST, port: env.CLAMD_PORT }) : noScanner;
const push = env.EXPO_PUSH === "1" ? expoPushSender() : noPush;

const { app, ctx } = buildApp({ db: connect(env.DATABASE_URL), jwtSecret: env.JWT_SECRET, logger: true, scanner, push });

// Süresi dolan talep ve ticket'ları dakikada bir kapat (§10 zaman işleri).
const timer = setInterval(() => {
  expireDue(ctx).catch((err) => app.log.error(err));
}, 60_000);
timer.unref();

// 0.0.0.0: masaüstü ve mobil istemcilerin LAN üzerinden erişebilmesi için.
await app.listen({ port: env.PORT, host: "0.0.0.0" });
