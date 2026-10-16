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

3. Altyapı (Docker): PostgreSQL ve ClamAV için `docker compose up -d`. Üretim ve gerçek PostgreSQL testleri için `DATABASE_URL`, `CLAMD_HOST`, `CLAMD_PORT`, `JWT_SECRET` ortam değişkenleri (bkz. `apps/api/.env.example`).

4. Testler:

   ```bash
   cd apps/api && npm test          # politika ve API uçtan uca (PGlite, gerçek HTTP)
   cd apps/api && TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test   # gerçek PostgreSQL
   cd apps/api && CLAMD_TEST_PORT=3310 npm test -- scanner.live   # gerçek clamd (yerel clamd 3310'da çalışıyor olmalı)
   cd packages/core && npx jest     # istemci ve senkronizasyon
   cd apps/desktop && npm run e2e   # tarayıcı uçtan uca (sistem Chrome; CHROME_PATH ile yol verilebilir)
   cd apps/desktop && npx tsc -p tsconfig.electron.json && npm run e2e:electron   # Electron penceresi: güvenli depo, oturum geri yükleme (API ve Vite açık olmalı)
   cd apps/mobile && npx expo export --platform android --output-dir ../../.export-mobile   # üretim paketi (Hermes bytecode)
   cd apps/mobile && EXPO_PUBLIC_API_URL=http://127.0.0.1:8081/api/v1 npx expo export --platform web --output-dir ../../.export-web   # mobil web derlemesi
   cd apps/mobile && node e2e/serve-web.mjs ../../.export-web 8081 3000   # ayrı terminalde; API 3000'de açık olmalı
   cd apps/mobile && node e2e/web-e2e.mjs   # mobil web e2e (tarayıcı: CHROME_PATH)
   ```

   Not: `--dev` ile export, Windows'ta asset yolu hatası (`ENOENT ... mkdir`) veriyor. Üretim export'u (yukarıdaki) bu hatadan etkilenmiyor.

Üretimde `apps/api` için `DATABASE_URL` ve en az 32 karakterlik `JWT_SECRET` gerekir (bkz. `apps/api/.env.example`).
