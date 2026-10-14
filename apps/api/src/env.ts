import { z } from "zod";

// Ortam değişkenleri başlangıçta doğrulanır; geçersizse süreç hata ile durur.
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  // DB katmanı eklenince zorunlu hale getirilecek.
  DATABASE_URL: z.string().url().optional(),
});

export const env = envSchema.parse(process.env);
