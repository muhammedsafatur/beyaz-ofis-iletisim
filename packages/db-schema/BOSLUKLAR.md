# db-schema: spec v0.6 boşlukları ve verilen teknik kararlar

Konum: `packages/db-schema`. drizzle-orm 0.45, drizzle-kit 0.31. Migration: `0000_init.sql` (drizzle-kit), `0001_immutable_logs.sql` (custom).
Doğrulama: `tsc` temiz, iki migration PGlite'ta uygulandı; self-approve, sahte requester_id, log UPDATE/DELETE, low>high, aktif email tekrarı, ikinci birim kanalı, group+department_id reddedildi.

## A. Şemaya eklenmedi, spec ekleme önerisi gerekiyor

| # | Konu | Spec bölümü | Neden eksik | Öneri |
|---|---|---|---|---|
| 1 | `approval_rules` yapısı | §10, §11 | Yalnızca anahtarlar ve varsayılanlar var, kolonlar yok. v0.2/v0.3'teki `rule_type` yapısı artık geçersiz. | Anahtar-değer: `key` (PK, enum: 4 anahtar), `value_int` (NOT NULL, >0), `updated_at`, `updated_by`. Değişiklikleri `audit_log`'a yazmak da eklenmeli. |
| 2 | `audit_log` kolonları | §3.6, §11 | Yalnızca kapsam yazıyor (kullanıcı, birim, şirket, bağlantı, yönetici atama, pasifleştirme). | `audit_id` bigint identity, `actor_user_id`, `entity_type` (enum), `entity_id` text, `action` (enum), `before`/`after` jsonb (içerik ve ticket gövdesi yok), `created_at`. Değiştirilemezlik trigger fonksiyonu (`0001_immutable_logs.sql`) hazır, tablo eklenince bağlanır. |
| 3 | Refresh token tablosu | §10, §11 | "DB'de hash'li, rotate edilir" var, tablo yok. Pasifleştirmede oturum kapatma da buna bağlı. | `refresh_tokens`: `token_id` uuid, `user_id`, `token_hash` (unique), `family_id` (yeniden kullanım tespiti için), `expires_at`, `revoked_at`, `replaced_by`, `created_at`. |
| 4 | `company_links` yeniden açma | §3.1, §5.7 | Benzersizlik `(low, high)` tam index. Kapatılan bağlantı aynı çift için yeniden açılamaz, ya `revoked_at` NULL'a çekilir ya da index `WHERE revoked_at IS NULL` olmalı. | Partial index + her açılış yeni satır (geçmiş korunur). Spec'e cümle eklenmeli. Şimdilik spec'teki tam index uygulandı. |
| 5 | `seq` üretimi | §3.4, §4 | Kolon ve benzersizlik var, nasıl atanacağı yok. `max(seq)+1` eşzamanlı gönderimde unique ihlali verir. | `conversations.last_seq bigint NOT NULL DEFAULT 0`, gönderimde `UPDATE ... SET last_seq = last_seq + 1 RETURNING`. Maliyet: konuşma satırında kısa kilit; 40–50 kullanıcıda ihmal edilebilir. |
| 6 | Ticket düzenleme geçmişi | §5.5 | "Düzenleme yapılırsa karar veren değişikliği görür" var, önceki halin tutulacağı tablo yok. | `ticket_revisions` (`message_revisions` ile aynı desen) ya da kuralın "yalnızca düzenlendi işareti" olarak netleştirilmesi. |
| 7 | Birebir konuşma tekilliği | §4 adım 4 | "Varsa kullanılır" var, DB kısıtı yok. Eşzamanlı istekte iki direct konuşma oluşabilir. | `direct_key` (sıralı iki user_id) + partial unique, ya da advisory lock. Şirket bağlamı yanlışsa yeni konuşma açılabildiği için (§5.3) anahtar `company_context_id`'yi de içermeli. |

## B. Spec belirsiz, şemada bir varsayım seçildi

| # | Konu | Seçilen | Spec bölümü |
|---|---|---|---|
| 8 | `access_requests.request_id` tipi | uuid (OpenAPI ile uyumlu) | §3.6 |
| 9 | `link_id`, `revision_id`, `decision_id`, `log_id` tipi | bigint identity (OpenAPI `link_id: integer`) | §3.1, §3.4–3.6 |
| 10 | `decision_basis` değerleri | enum `content`/`meta`, kararsızken NULL (OpenAPI'den). Spec yalnızca `'meta'` diyor. | §3.6 |
| 11 | `access_log.request_id` | NOT NULL; v0.6'daki tüm erişimler talebe bağlı. v0.2'de nullable'dı. | §3.6 |
| 12 | Sistem mesajında gönderen | `sender_user_id` ve `client_message_id` NOT NULL bırakıldı. "Ad Soyad ayrıldı" mesajında gönderen ayrılan kullanıcı, `client_message_id` sunucu üretir varsayıldı. | §3.4, §5.6 |
| 13 | Email büyük/küçük harf | Düz `email` üzerinde partial unique. `lower(email)` istenirse index değişir. | §3.2 |
| 14 | Ticket başına karar sayısı | `ticket_decisions`'ta tekillik yok (yeniden atamada birden fazla kayıt olabilir). | §3.5, §5.6 |
| 15 | `locations.city`, `address` | Nullable | §3.1 |

## C. Spec'e eklenmemiş teknik kararlar (iş kuralı değil)

- `decided_by <> requester_id` farklı tabloda olduğu için CHECK doğrudan yazılamaz. `ticket_decisions` ve `access_request_targets`'a `requester_id` kopyası eklendi, bileşik FK `(id, requester_id)` ile ana tabloya bağlı. Yanlış requester_id yazılamaz, CHECK tek satırda çalışır. Trade-off: satır başına 16 byte ve spec §3.5/§3.6'da listelenmeyen bir kolon. Alternatif trigger; daha az görünür, test edilmesi zor.
- `access_request_targets`: `status IN (approved, rejected)` ⇔ `decided_by`, `decided_at`, `decision_basis` dolu. Spec'teki alanların tutarlılığı, yeni kural yok.
- Değiştirilemezlik: `access_log` için UPDATE/DELETE/TRUNCATE trigger'ı. Uygulama rolü adı belli olmadığı için `REVOKE` satırı yorumda.
- İndeksler: aktif üyelik (`user_id WHERE left_at IS NULL`), scheduler için `expires_at WHERE status='pending'`, onaylayan listesi için `department_id WHERE status='pending'`.
- bigint kolonlar `mode: 'number'` (2^53 altı yeterli, JSON'da string dönüşümü yok).

## D. Spec ↔ OpenAPI çelişkisi (spec kazanır)

- `company_links`: DB'de `company_low_id`/`company_high_id`, OpenAPI'de `company_a_id`/`company_b_id`. Şema spec'e göre; API katmanında eşleme ya da OpenAPI düzeltmesi gerekir.
