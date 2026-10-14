import Fastify from "fastify";

// Uygulama fabrikası: sunucu ve ileride testler aynı kurulumu kullanır.
export function buildApp() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
