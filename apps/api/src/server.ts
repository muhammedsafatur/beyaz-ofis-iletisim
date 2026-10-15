import { buildApp } from "./app.js";
import { connect } from "./db.js";
import { env } from "./env.js";
import { expireDue } from "./services/scheduler.js";

const { app, ctx } = buildApp({ db: connect(env.DATABASE_URL), jwtSecret: env.JWT_SECRET, logger: true });

// Süresi dolan talep ve ticket'ları dakikada bir kapat (§10 zaman işleri).
const timer = setInterval(() => {
  expireDue(ctx).catch((err) => app.log.error(err));
}, 60_000);
timer.unref();

// 0.0.0.0: masaüstü ve mobil istemcilerin LAN üzerinden erişebilmesi için.
await app.listen({ port: env.PORT, host: "0.0.0.0" });
