import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { ZodError } from "zod";
import { ApiError } from "./errors.js";
import type { Db } from "./db.js";
import { registerRoutes } from "./routes.js";
import { loadActor, type Ctx, type InviteSender } from "./services/common.js";
import { verifyAccess } from "./services/auth.js";
import { createRealtime } from "./realtime.js";
import { createLocalStorage, type FileStorage } from "./storage.js";
import path from "node:path";

export interface AppOptions {
  db: Db;
  jwtSecret: string;
  now?: () => Date;
  invites?: InviteSender;
  files?: FileStorage;
  logger?: boolean;
}

// Davet e-postası altyapısı henüz yok. Geliştirmede bağlantı konsola yazılır; üretimde token asla loglanmaz.
export const consoleInviteSender: InviteSender = {
  async send(email, token) {
    if (process.env.NODE_ENV === "production") {
      console.warn(`[davet] ${email} için e-posta gönderici yapılandırılmadı.`);
      return;
    }
    console.log(`[davet] ${email} -> ${token}`);
  },
};

// Uygulama fabrikası: sunucu ve testler aynı kurulumu kullanır.
export function buildApp(opts: AppOptions): { app: FastifyInstance; ctx: Ctx } {
  const ctx: Ctx = {
    db: opts.db,
    now: opts.now ?? (() => new Date()),
    jwtSecret: opts.jwtSecret,
    invites: opts.invites ?? consoleInviteSender,
    realtime: createRealtime(),
    files: opts.files ?? createLocalStorage(path.resolve(process.cwd(), ".data/attachments")),
  };
  const app = Fastify({ logger: opts.logger ?? false });

  // Tek hata biçimi: { error: { code, message } } (spec 9, K6)
  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ApiError) {
      if (err.retryAfterSeconds !== undefined) void reply.header("Retry-After", String(err.retryAfterSeconds));
      return reply.status(err.status).send({ error: { code: err.code, message: err.message }, ...(err.extra ?? {}) });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: "VALIDATION_FAILED", message: err.issues[0]?.message ?? "İstek doğrulanamadı." } });
    }
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.status(400).send({ error: { code: "VALIDATION_FAILED", message: "İstek doğrulanamadı." } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "Beklenmeyen bir hata oluştu." } });
  });

  app.setNotFoundHandler((_req, reply) => {
    return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Bulunamadı." } });
  });

  app.get("/health", async () => ({ status: "ok" }));
  // Gerçek zamanlı kanal (Faz 2). Tarayıcı başlık gönderemediği için erişim belirteci sorguda gelir;
  // belirteç 15 dakika geçerlidir. Kimliksiz bağlantı 4401 koduyla kapanır.
  app.register(async (scope) => {
    await scope.register(websocket);
    scope.get("/api/v1/ws", { websocket: true }, (socket, req) => {
      const token = (req.query as { access_token?: string }).access_token ?? "";
      void (async () => {
        let userId: string;
        try {
          userId = verifyAccess(token, ctx.jwtSecret);
        } catch {
          socket.close(4401, "UNAUTHENTICATED");
          return;
        }
        const actor = await loadActor(ctx.db, userId);
        if (!actor || actor.deleted || !actor.isActive) {
          socket.close(4401, "UNAUTHENTICATED");
          return;
        }
        const unsubscribe = ctx.realtime.subscribe(actor.id, (payload) => socket.send(payload));
        socket.on("close", unsubscribe);
        socket.send(JSON.stringify({ type: "hello" }));
      })();
    });
  });

  // Spec 9: tüm uçlar /api/v1 altında. Sağlık ucu kökte kalır.
  app.register(async (scope) => registerRoutes(scope, ctx), { prefix: "/api/v1" });
  return { app, ctx };
}
