import { z } from "zod";

// Ortam değişkenleri başlangıçta doğrulanır; geçersizse süreç hata ile durur.
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  // Erişim belirteçlerini imzalar. En az 32 karakter.
  JWT_SECRET: z.string().min(32),
});

export const env = envSchema.parse(process.env);
