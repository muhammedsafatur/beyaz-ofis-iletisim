import { z } from "zod";

// Ortam değişkenleri başlangıçta doğrulanır; geçersizse süreç hata ile durur.
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  // Erişim belirteçlerini imzalar. En az 32 karakter.
  JWT_SECRET: z.string().min(32),
  // ClamAV (clamd). Üretimde zorunlu; boşsa tarama yapılmaz (yalnızca geliştirme).
  CLAMD_HOST: z.string().optional(),
  CLAMD_PORT: z.coerce.number().int().positive().default(3310),
  // Expo Push: "1" ise bildirim gönderilir.
  EXPO_PUSH: z.enum(["0", "1"]).default("0"),
});

export const env = envSchema.parse(process.env);
