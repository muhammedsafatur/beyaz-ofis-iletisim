import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { ApiError } from "./errors.js";
import type { Db } from "./db.js";
import { registerRoutes } from "./routes.js";
import type { Ctx, InviteSender } from "./services/common.js";

export interface AppOptions {
  db: Db;
  jwtSecret: string;
  now?: () => Date;
  invites?: InviteSender;
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
  registerRoutes(app, ctx);
  return { app, ctx };
}
