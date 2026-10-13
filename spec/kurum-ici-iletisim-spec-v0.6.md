# Kurum İçi İletişim Uygulaması: Proje Dokümanı

**Sürüm:** 0.6
**Önceki sürüm:** 0.5
**Durum:** MVP kapsamı kilitlendi. Tüm açık konular kapandı. Teknik altyapı kararları eklendi.

---

## 0. Değişiklik özeti (v0.5 → v0.6)

- **Teknik altyapı:** pnpm workspaces + Turborepo, Drizzle ORM, Git reposu proje başında açılacak.
- **Hız sınırı:** Mesaj 60/dakika, ticket 20/saat, değerler `approval_rules` tablosunda.
- **Meta veri:** Onaylayanın gördüğü liste OpenAPI'deki haliyle kesinleşti (üye sayısı dahil).
- **Açık konular:** Kapandı.

## 0a. Değişiklik özeti (v0.4 → v0.5)

- **Erişim talebi yeniden yazıldı:** Talep, talep edenin seçtiği birim(ler)e gider. Seçilen her birimin yöneticisinin onayı gerekir. Hedef birimler ayrı tabloda tutulur.
- **Birim yöneticisi yoksa:** Hedef için sistem yöneticisi, yalnızca meta veriyle karar verir.
- **Bekleme süresi:** Karar verilmeyen talep ve ticketlar `request_expiry_hours` (varsayılan 72 saat) sonunda kapanır. Talep eden isterse yeniden açar.
- **Ticket onayı:** Erişim talebiyle aynı kurallara bağlandı (bekleme süresi, yönetici yoksa sistem yöneticisi).
- **Kaldırılan:** Eskalasyon aşamaları ve `escalation_hours`, çünkü artık talep bir aşamadan diğerine geçmiyor, ya karar veriliyor ya da süre dolup kapanıyor.

---

## 1. Amaç ve kapsam

Kurum içinde şirketler, birimler, lokasyonlar ve çalışanlar arasında iletişimi ve birimler arası talep akışını tek uygulamada toplamak.

### Ölçek
- Tek kurum, birden fazla şirket. 40–50 kullanıcı, en fazla 150–160 çalışan şirketten birinde.
- Tek instance PostgreSQL ve WebSocket. Yatay ölçekleme ihtiyaç doğarsa eklenir.

### Kapsam (MVP)
- Birebir ve grup konuşması, birim kanalı
- Metin mesajı, 15 dakika içinde düzenleme ve silme, okundu bilgisi
- Şirketler arası yazışma (sistem yöneticisinin açtığı bağlantılar)
- Ticket açma ve birim yöneticisi onayı
- Eski mesaj erişim talebi (birim yöneticisi onayı, süreli erişim)
- Sessize alma, okunmamış sayısı

### Kapsam dışı
- Sesli ve görüntülü arama, uçtan uca şifreleme, dış kullanıcılar
- Engelleme (yalnızca sessize alma)
- Mesaj silme sonrası geri dönüş
- Legal ve hukuki süreç modülü, kurumsal yönetişim, hisse ve yetki devri, KVKK belgeleri (uygulama dışında ilerler)
- Dosya ekleri, ticket yorumları, push bildirim, WebSocket (Faz 2)
- Arama, alt birim, yatay ölçekleme (Faz 3)

**Temel ilke:** Uygulama kurumun hiyerarşisini modellemez, yalnızca kayıt tutar. Kimin yönetici olduğu, kimin neyi onayladığı kurumun kendi kararıdır, sistem bu kararı kayıt olarak tutar.

---

## 2. Roller

| Kavram | Kaynak | Açıklama |
|---|---|---|
| Çalışan | `users.role = 'employee'` | Varsayılan |
| Sistem yöneticisi | `users.role = 'system_admin'` | Kullanıcı, şirket, birim, lokasyon, bağlantı yönetimi. Mesaj içeriğini görmez. Birim yöneticisi olmayan hedeflerde yalnızca meta veriyle karar verir. |
| Birim yöneticisi | `department_managers` kaydı | Birimin onay yetkisi. Birden fazla olabilir. Erişim talebi ve ticket onayı verir, bu sırada içeriği görür. |

Yöneticilik bir kişinin özelliği değil, bir birime atanmanın sonucudur.

---

## 3. Veri modeli

### 3.1 Organizasyon

**companies**: `company_id` (PK), `name` (benzersiz), `is_active`, zaman damgaları, `deleted_at`

**departments**: `department_id` (PK), `company_id` (FK, NOT NULL), `name`, `description`, zaman damgaları, `deleted_at`
- Benzersiz: `(company_id, name)` (aktif kayıtlar için partial index)

**locations**: `location_id` (PK), `name` (benzersiz), `city`, `address`, zaman damgaları, `deleted_at`

**department_locations** (yalnızca bilgi amaçlı): `(department_id, location_id)` PK

**user_departments**: `(user_id, department_id)` PK, `joined_at`

**user_locations** (profil ve raporlama): `(user_id, location_id)` PK

**department_managers**: `(department_id, user_id)` PK, `assigned_at`

**company_links** (şirketler arası bağlantı): `link_id` (PK), `company_low_id`, `company_high_id` (`low < high` CHECK), `created_by`, `created_at`, `revoked_at` (NULL = aktif). Benzersiz: `(company_low_id, company_high_id)`.

### 3.2 Kullanıcı

**users**: `user_id` (uuid, PK), `first_name`, `last_name`, `email` (benzersiz, aktif kayıtlar için partial index), `password_hash` (argon2id), `job_title`, `role` (enum: `employee`, `system_admin`), `profile_picture_url`, `is_active`, zaman damgaları, `deleted_at`

Kullanıcının şirketi kolon olarak tutulmaz, birimlerinden türetilir.

### 3.3 Konuşma

**conversations**: `conversation_id` (uuid, PK), `type` (enum: `direct`, `group`, `department`), `name`, `department_id` (FK, yalnızca `department` tipinde), `company_context_id` (FK, yalnızca şirketler arası konuşmada, ilk mesajdan sonra kilitlenir), `created_by`, `last_message_at`, `created_at`, `deleted_at`
- Kısıt: birim başına bir aktif kanal (partial unique index)

**conversation_members**: `(conversation_id, user_id)` PK, `joined_at`, `left_at` (NULL = aktif), `last_read_at`, `is_muted` (varsayılan false, yalnızca kullanıcı değiştirir)

Birim kanalı üyeliği birim üyeliğinden bağımsızdır. Birimden çıkarma kanaldan çıkarmayı otomatik tetiklemez, yönetici arayüzünde soru olarak sorulur.

### 3.4 Mesaj

**messages**: `message_id` (uuid, PK), `conversation_id`, `sender_user_id`, `client_message_id` (uuid, idempotency), `seq` (bigint, konuşma içi sıra), `content`, `message_type` (enum: `text`, `system`), `sent_at`, `edited_at`, `deleted_at`
- Benzersiz: `(conversation_id, seq)`, `(sender_user_id, client_message_id)`

**message_revisions**: `revision_id` (PK), `message_id`, `content` (değişiklik öncesi), `revision_type` (enum: `edit`, `delete`), `created_at`

Düzenleme geçmişi alıcıya gösterilmez. Alıcı yalnızca "düzenlendi" ya da "silindi" işaretini görür.

### 3.5 Ticket

**tickets**: `ticket_id` (uuid, PK), `requester_id`, `target_department_id` (NOT NULL), `title` (zorunlu), `body` (zorunlu), `status` (enum: `pending`, `approved`, `rejected`, `withdrawn`, `expired`), `created_at`, `updated_at`, `expires_at`, `closed_at`

**ticket_decisions**: `decision_id` (PK), `ticket_id`, `decided_by`, `decision` (enum: `approved`, `rejected`), `note`, `decided_at`
- Kısıt: `decided_by <> requester_id`

### 3.6 Erişim talebi ve denetim

**access_requests**: `request_id` (PK), `conversation_id`, `requester_id`, `reason` (zorunlu, asgari uzunluk uygulama katmanında), `status` (enum: `pending`, `approved`, `rejected`, `withdrawn`, `expired`), `access_expires_at` (onay sonrası süreli erişim), `expires_at` (karar bekleme süresi), `created_at`, `closed_at`

**access_request_targets**: `(request_id, department_id)` PK, `status` (enum: `pending`, `approved`, `rejected`, `expired`), `decided_by` (FK, nullable), `decided_at`
- Hedef birimler yalnızca konuşmadaki üyelerin birimleriyle sınırlıdır.
- Kısıt: `decided_by <> requester_id`
- Birim yöneticisi yoksa `decided_by` sistem yöneticisi olur ve kayıt `decision_basis = 'meta'` ile işaretlenir. Bu alan `access_request_targets`'a eklenir.

**access_log** (tüm erişim olayları): `log_id`, `conversation_id`, `user_id`, `action` (enum: `read`, `approve`, `reject`, `copy_blocked`), `request_id`, `accessed_at`

**audit_log** (yönetim olayları): kullanıcı, birim, şirket, bağlantı, yönetici atama ve pasifleştirme değişiklikleri. Sistem yöneticisi bu tabloyu değiştiremez.

---

## 4. Mesajlaşma akışı

1. Kullanıcı bir kişi seçer.
2. `canMessage` kontrolü yapılır (5.1).
3. Şirketler arası ise şirket bağlamı belirlenir (5.3).
4. Birebir konuşma varsa kullanılır, yoksa oluşturulur.
5. İstemci `client_message_id` üretir ve mesajı iyimser olarak gösterir.
6. Sunucu kaydeder, `seq` atar, üyelere iletir.
7. Yetki yoksa açıklayıcı hata döner.

---

## 5. Yetki kuralları

### 5.1 Gönderme: `canMessage(sender, target)`

1. Gönderen veya hedef pasif ya da silinmişse → **red**
2. Şirketler farklıysa: aktif `company_links` yoksa → **red**, varsa → **izin**
3. Şirket aynıysa → **izin**

Birim ve lokasyon yetkiyi belirlemez. Engelleme yoktur, sessize alma yalnızca bildirimi etkiler.

### 5.2 Konuşma erişimi

- Kullanıcı yalnızca aktif üyesi olduğu konuşmaları (`left_at IS NULL`) okuyabilir.
- Ayrılan kullanıcı eski mesajlara yalnızca erişim talebiyle ulaşır (5.4).

### 5.3 Şirketler arası bağlam

- Ortak ve aktif bağlantısı olan şirket çifti tek ise o kullanılır.
- Birden fazla varsa kullanıcının son kullandığı seçilir.
- Hiçbiri yoksa kullanıcı seçer.
- Bağlam ilk mesajdan sonra kilitlenir, değiştirilemez. Yanlış bağlamda yeni konuşma açılır.
- Bağlantı kapatılırsa yazma kapanır, okuma açık kalır.

### 5.4 Eski mesaj erişim talebi

1. Talep eden konuşmayı, gerekçeyi (zorunlu) ve hedef birim(ler)i seçer. Hedef birimler yalnızca konuşmadaki üyelerin birimleriyle sınırlıdır.
2. Her hedef birim için ayrı bir onay kaydı oluşur.
3. Hedef birimin yöneticisi varsa karar onda olur. Yönetici içeriği görür ve karar verir. Bu okuma `access_log`'a yazılır.
4. Hedef birimin yöneticisi yoksa karar sistem yöneticisindedir. Sistem yöneticisi yalnızca meta veriyi görür: talep eden (ad soyad, birim), konuşma tipi ve adı, üye sayısı, mesaj sayısı, ilk ve son mesaj tarihi, gerekçe, hedef birim.
5. **Tüm hedefler onaylarsa** talep onaylanır. Talep eden, konuşmanın içeriğini `access_expires_at` süresince okur. Kopyalama kapalıdır, her okuma `access_log`'a yazılır.
6. **Herhangi bir hedef reddederse** talep reddedilir.
7. Onaylayan ile talep eden aynı kişi olamaz.
8. Karar verilmeyen talep `expires_at` (varsayılan 72 saat) sonunda `expired` olur. Talep eden isterse yeniden açabilir.

Hedef birimlerden biri onaylamış, diğeri bekliyorsa talep `pending` kalır. Onaylanan hedefin kararı geri alınmaz, talep kapanana kadar bekler.

### 5.5 Ticket onayı

- Ticket hedef birimin yöneticisine düşer.
- Birim yöneticisi yoksa karar sistem yöneticisindedir.
- Ticket gövdesi yalnızca birim yöneticisine görünür. Birim yöneticisi yokken karar veren sistem yöneticisi yalnızca meta veriyi görür: talep eden, hedef birim, başlık, tarih, durum. Ticket konuşma değildir, `access_log` gerektirmez, karar `ticket_decisions`'a yazılır.
- Talep eden kendi ticket'ını onaylayamaz.
- Karar verilmeyen ticket `expires_at` (varsayılan 72 saat) sonunda `expired` olur.
- Ticket yalnızca karar verilmeden önce talep eden tarafından geri çekilebilir (`withdrawn`).
- Açıldıktan sonra 15 dakika içinde düzenlenebilir. Düzenleme yapılırsa karar veren kişi değişikliği görür.

### 5.6 Ayrılan ya da pasifleşen çalışan

- Hesap pasifleştirilince tüm aktif konuşmalardan `left_at` yazılır, konuşmada "Ad Soyad ayrıldı" sistem mesajı oluşur.
- Mesajlar silinmez, gönderen olarak ad soyad kalır.
- Yeniden aktif edilince konuşmalara otomatik eklenmez, yönetici tek tek ekler.
- Birim yöneticiliği ve açık ticket'lar sistem yöneticisi tarafından yeniden atanır. Atanmayanlar sistem yöneticisi ekranında bekler.
- Birimden çıkarma ile pasifleştirme ayrı olaylardır. Birimden çıkarma kanal üyeliğini kendiliğinden kaldırmaz.

### 5.7 Şirketler arası bağlantı

- Yalnızca sistem yöneticisi açar ve kapatır.
- Açılmadan önce etkilenecek kullanıcılar önizleme olarak gösterilir.
- Kapatılınca okuma açık kalır, yeni mesaj gönderilemez.
- Her değişiklik `audit_log`'a yazılır.

---

## 6. Mesaj düzenleme ve silme

- Gönderen, mesajını gönderimden sonra **15 dakika** içinde düzenleyebilir veya silebilir.
- Süre sunucu saatiyle hesaplanır.
- Düzenleme ve silmede önceki içerik `message_revisions`'a yazılır.
- Silme mesaj satırını fiziksel olarak silmez, `deleted_at` dolar, alıcı "mesaj silindi" görür.
- Süre dolunca mesaj kilitlenir.
- Eşzamanlı işlemlerde satır `SELECT ... FOR UPDATE` ile kilitlenir.
- Kullanıcıya açıkça söylenir: silinen mesajlar kurum kaydında saklanır.
- Push bildirimi geri çekilemez. Bu bilinen bir sınırlamadır.

---

## 7. Okundu bilgisi, bildirim ve sessize alma

- **Okundu bilgisi:** Birebir konuşmada karşı taraf okuduysa görünür. Grupta, mesajın gönderilmesinden sonra `last_read_at` değeri bu tarihten büyük olan üye sayısı "N kişi okudu" olarak gösterilir. Kimlikler grup görünümünde açılmaz.
- Okundu bilgisi konuşma bazlıdır, mesaj bazlı kesin değildir. Bu bilinçli bir performans takasıdır.
- **Sessize alma:** Yalnızca kullanıcı değiştirir. Sessizdeki konuşmada push ve OS bildirimi gitmez. Mesaj teslimi ve okunmamış sayısı etkilenmez.

---

## 8. Saklama

- Mesajlar süresiz saklanır.
- KVKK uyumu, aydınlatma metni ve veri işleme envanteri uygulama dışında, kurumun hukuk süreciyle ilerler.

---

## 9. API (MVP)

**Genel:** `/api/v1/...`, `zod` doğrulama (istemci ve sunucu aynı şema), hata formatı `{ error: { code, message } }`, cursor sayfalama (`before_seq`, `after_seq`), yazma işlemleri idempotent, yetki her istekte sunucuda kontrol edilir ve tek policy katmanından geçer.

**Kimlik:** `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`

**Kullanıcı:** `GET /users/me`, `PATCH /users/me`, `GET /users?department_id=&company_id=&q=`

**Yönetim (sistem yöneticisi):** `POST /admin/users`, `PATCH /admin/users/:id`, `POST /admin/users/:id/deactivate`, `POST /admin/users/:id/reassign`, CRUD: şirket, birim, lokasyon, `user_departments`, `user_locations`, `department_managers`, `POST /admin/company-links`, `POST /admin/company-links/:id/revoke`

**Konuşmalar:** `GET /conversations`, `POST /conversations`, `GET /conversations/:id`, `POST /conversations/:id/members`, `DELETE /conversations/:id/members/:userId`, `POST /conversations/:id/read`, `PATCH /conversations/:id/mute`

**Mesajlar:** `GET /conversations/:id/messages?before_seq=&limit=`, `GET /conversations/:id/messages?after_seq=`, `POST /conversations/:id/messages`, `PATCH /messages/:id` (15 dk), `DELETE /messages/:id` (15 dk)

**Ticket:** `POST /tickets`, `GET /tickets?role=requester|approver`, `GET /tickets/:id`, `PATCH /tickets/:id` (15 dk), `POST /tickets/:id/withdraw`, `POST /tickets/:id/decision`

**Erişim talebi:** `POST /access-requests` (hedef birimler dahil), `GET /access-requests?role=`, `GET /access-requests/:id` (karar verene göre içerik ya da yalnızca meta veri), `POST /access-requests/:id/targets/:departmentId/decision`, `POST /access-requests/:id/withdraw`, `GET /access-requests/:id/content` (yalnızca talep eden, süreli, loglanır)

**Ön kontrol:** `POST /messages/can-send` (yalnızca UX, karar sunucuda)

---

## 10. Teknik mimari

- **Backend:** Node.js, Express veya Fastify, `zod`, winston + morgan
- **Veritabanı:** PostgreSQL
- **Realtime:** Faz 1'de polling ile delta çekme. WebSocket Faz 2'de, tek instance.
- **Zaman işleri:** `expires_at` dolan talep ve ticket'ları kapatmak, 15 dakika kilidi uygulamak için basit scheduler.
- **Kimlik:** argon2id, kısa ömürlü access token, DB'de hash'li rotate edilen refresh token
- **Test:** Jest, Supertest. Yetki policy'si için ayrı test paketi (`canMessage`, erişim talebi çok birimli onay, ticket onayı, düzenleme penceresi, bekleme süresi).
- **İstemciler:** `apps/mobile` (Expo + RN), `apps/desktop` (Electron + React + Vite), `packages/core` (API istemcisi, zod, sync motoru, adapter arayüzleri)
- **İstemci saklama:** Mobilde Keychain/Keystore, desktop'ta Electron `safeStorage`. Düz AsyncStorage ya da localStorage kullanılmaz.

**Yapılandırma (`approval_rules`):** `request_expiry_hours` (varsayılan 72), `access_window_hours` (onay sonrası içerik erişim süresi, varsayılan 24), `message_rate_per_min` (varsayılan 60), `ticket_rate_per_hour` (varsayılan 20). Değerler kodda sabit değil, tabloda tutulur.

**Monorepo ve araçlar:** pnpm workspaces + Turborepo. ORM ve migration: Drizzle (SQL migration dosyaları repoda tutulur). Git reposu proje başında açılır.

---

## 11. Güvenlik ve denetim

- Şifreler argon2id ile hash'lenir, token rotation uygulanır.
- Pasifleştirilen kullanıcının oturumları kapatılır.
- Loglarda mesaj içeriği ve ticket gövdesi yer almaz.
- `access_log` ve `audit_log` değiştirilemez.
- Hız sınırlama: mesaj 60/dakika, ticket 20/saat, kullanıcı başına (`approval_rules`'tan okunur).
- Dosyalar Faz 2'de eklenir, imzalı URL ile erişilir.

---

## 12. Fazlar

**Faz 1 (MVP)**
- Kimlik, kullanıcı, şirket, birim, lokasyon yönetimi
- Birebir, grup ve birim kanalı
- Metin mesajı, 15 dakika düzenleme ve silme, okundu bilgisi, delta ile geri doldurma (polling)
- Gönderme yetkisi ve şirketler arası bağlantı
- Sessize alma, okunmamış sayısı
- Ticket açma, birim yöneticisi onayı, 15 dakika düzenleme
- Eski mesaj erişim talebi (çok birimli onay, süreli erişim)
- Ayrılan çalışan kuralı

**Faz 2**
- WebSocket realtime, push bildirim
- Dosya ekleri, ticket yorumları
- Audit log ekranı

**Faz 3**
- Arama (yetki kurallarına uyacak şekilde)
- Alt birim, yönetici raporları
- Yatay ölçekleme

**Uygulama dışında ele alınacaklar:** Legal ve hukuki süreç, kurumsal yönetişim, KVKK belgeleri, yönetici ve sahiplik değişiklikleri.

---

## 13. Açık konular

| # | Konu | Durum |
|---|---|---|
| 1 | `request_expiry_hours` varsayılanı: 72 saat | Kabul edildi |
| 2 | Ticket gövdesi sistem yöneticisine görünmez, yalnızca meta veri görür | Kabul edildi |
| 3 | Hız sınırı rakamları | Kapandı: 60/dakika, 20/saat |
| 4 | Meta veri listesi | Kapandı: OpenAPI listesi, üye sayısı dahil |

---

## 14. Sonraki adımlar

1. Git reposu açılır, monorepo iskeleti kurulur (pnpm + Turborepo).
2. OpenAPI spec kilitlenir (`openapi-v1.yaml` düzeltmeleri).
3. `canMessage`, erişim talebi çok birimli onay, ticket onayı, düzenleme penceresi ve bekleme süresi test paketiyle yazılır.
4. Veritabanı şeması ve migration'lar oluşturulur.
5. Auth ve organizasyon yönetimi backend'de tamamlanır.
6. Konuşma, mesaj ve ticket endpoint'leri.
7. Erişim talebi endpoint'leri.
8. `packages/core` sync motoru, desktop üzerinden test edilir.
9. Mobil istemci aynı core üzerine kurulur.
10. Faz 2.
