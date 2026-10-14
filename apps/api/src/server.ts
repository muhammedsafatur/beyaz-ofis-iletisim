import { buildApp } from "./app.js";
import { env } from "./env.js";

const app = buildApp();

// 0.0.0.0: masaüstü ve mobil istemcilerin LAN üzerinden erişebilmesi için.
await app.listen({ port: env.PORT, host: "0.0.0.0" });
