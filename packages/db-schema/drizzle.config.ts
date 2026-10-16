import { defineConfig } from "drizzle-kit";

// Migration dosyaları repoda tutulur (spec: SQL migration dosyaları repoda).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
