# beyaz-ofis-iletisim

Kurum içi iletişim uygulaması. Monorepo: pnpm workspaces + Turborepo.

## Yapı

- `apps/api`: Fastify API (`/api/v1`), PostgreSQL (üretim) veya PGlite (test ve yerel geliştirme)
- `apps/desktop`: Electron iskeleti + React arayüzü (Vite)
- `apps/mobile`: Expo (React Native) istemci
- `packages/core`: API istemcisi, senkronizasyon motoru, gerçek zamanlı bağlantı, hata kataloğu
- `packages/db-schema`: Drizzle şeması ve migration'lar (0000–0008)
- `packages/ui-tokens`: Tasarım belirteçleri
- `spec/`: Proje dokümanı (v0.7), OpenAPI sözleşmesi, öneri ve karar kayıtları

## Yerel çalıştırma

Ön koşul: Node 22+ ve pnpm 9.15 (`npx pnpm@9.15.0`).

1. API (PostgreSQL gerekmez, veri bellekte tutulur, demo verisiyle):

   ```bash
   cd apps/api && npx tsx src/dev.ts
   ```

   Giriş: `ali@demo.test` / `demo-parola-123` (ayrıca `ayse@demo.test`, `patron@demo.test`, `admin@demo.test`).

2. Masaüstü arayüzü (Vite, `/api` isteklerini 3000 portuna yönlendirir):

   ```bash
   cd apps/desktop && npx vite
   ```

3. Testler:

   ```bash
   cd apps/api && npm test          # politika ve API uçtan uca (PGlite, gerçek HTTP)
   cd packages/core && npx jest     # istemci ve senkronizasyon
   cd apps/desktop && npm run e2e   # tarayıcı uçtan uca (sistem Chrome; CHROME_PATH ile yol verilebilir)
   ```

Üretimde `apps/api` için `DATABASE_URL` ve en az 32 karakterlik `JWT_SECRET` gerekir (bkz. `apps/api/.env.example`).
