# Kurum İçi İletişim Uygulaması: Proje Dokümanı

**Sürüm:** 0.7
**Önceki sürüm:** 0.6
**Durum:** `spec/spec-v0.7-oneri.md` içindeki tüm maddeler işlendi. Karar verilen her madde bu dosyada, OpenAPI'de (`openapi-v1.yaml`) ve şemada (`packages/db-schema`, migration'lar 0002–0007) yer alır.

---

## 0b. Değişiklik özeti (v0.6 → v0.7)

**Kararlar (kullanıcı, şıklı tartışma)**
- **Hata kodu:** Mükerrer kayıt ve çakışmalar `CONFLICT` (409) döner.
- **Gerçek zamanlı kanal:** Hibrit senkron. Bağlıyken yoklama 30 sn, kopunca 3 sn. Olaylar: `conversation.changed`, `membership.changed` (çıkarılan kullanıcıya, liste tam yenilenir), `mention`.
- **@ anma:** Gruplarda şirket bağlamı yok. Anma vurgu ve anlık bildirimdir; anılan kişi sessize almış olsa da bildirim alır. Anılanlar mesajda `mentions` ile döner.
- **Push:** Expo Push. Yalnızca WebSocket ile ulaşılamayan kullanıcılara gider. İçerik gönderilmez: "Yeni mesajınız var" ya da "Sizi bir mesajda andılar". Expo'nun `DeviceNotRegistered` yanıtı dönen belirteçler silinir; yanıt biçimi gerçek Expo servisinde doğrulandı.
- **Dosya taraması:** Yerel disk + ClamAV (INSTREAM). Dosya kaydedilmeden taranır; zararlı dosya reddedilir. Üretimde `CLAMD_HOST` zorunludur.
- **PostgreSQL testleri:** Repoya docker-compose eklendi. Testler `TEST_DATABASE_URL` ile gerçek PostgreSQL'de de koşar (her test dosyası kendi veritabanını alır).
- **Masaüstü belirteçleri:** Electron safeStorage ile şifreli saklanır (tarayıcıda bellek içi).
- **Masaüstü iş paneli:** Ticket açma ve karar, erişim talebi açma ve karar ekranları.
- **Expo dışa aktarımı:** Şimdilik bırakıldı; Metro paketlemesi doğrulandı.

**Faz 2 (uygulandı)**
- **Gerçek zamanlı kanal:** `/api/v1/ws` (WebSocket). Konuşma değişikliğinde üyelere yalnızca konu kimliği gider (`conversation.changed`), içerik gitmez. İstemci delta uçlarından çeker. Yoklama yedek olarak sürer. Kimliksiz bağlantı 4401 ile kapanır.
- **Dosya ekleri:** Yükleme `POST /conversations/:id/attachments` (ham gövde, en fazla 10 MB, türler: png, jpeg, gif, webp, pdf, text/plain). Mesaja `attachment_id` ile bağlanır, bir ek bir kez bağlanır. İndirme imzalıdır (5 dakika), oturum belirteci gerekmez, süre ve imza doğrulanır.
- **Ticket yorumları:** `GET` ve `POST /tickets/:id/comments`. Görünürlük gövdeyle aynıdır: talep eden ve patron.
- **Denetim kaydı:** `GET /admin/audit-log` (yalnızca sistem yöneticisi, değiştirilemez kayıtlar, en yeni önce).
- **Yerleşik sınırlar:** Dosya deposu şimdilik yerel dizin (`apps/api/.data/attachments`). Üretim için nesne deposu ve virüs taraması kararı bekliyor.

**Faz 2 (push)**
- **Push bildirimi:** Expo Push (karar). Cihaz belirteci `POST /me/push-tokens`, gönderim sunucuda. Mobil kayıt EAS projectId gerektirir; yoksa atlanır.

**Kullanıcı kararları**
- **Patron (K3 ile birlikte):** "Yönetici" patrondur, birim yöneticisi değildir. Patron kurum genelinde tek bir roldür (`users.role = 'executive'`), birime atanmaz. Erişim talebi ve ticket kararını patron verir, karar öncesi içeriği görür. Birim yöneticisi bu akışlarda içerik görmez ve karar vermez. Patron yoksa karar sistem yöneticisindedir, yalnızca meta veriyle.
- **Ç8:** Grupta üye ekleme ve çıkarma grup kurucusundadır (`conversations.created_by`). Birim kanalında birim yöneticisindedir. Eklenen her üye için `canMessage(ekleyen, üye)` geçmelidir.
- **K5:** Ticket yeniden atama kaldırıldı. Açık ticket patron havuzunda kalır, herhangi bir aktif patron karar verir. Ticket başına en fazla bir karar vardır.
- **Ticket karar kaydı değiştirilemez** (UPDATE, DELETE, TRUNCATE engelli).

**Öneri maddeleri (uygulandı)**
- **K1:** Grupta `members[].last_read_at` yalnızca isteği yapanın kendi kaydında dolu döner. Diğer üyelerin değeri null'dır.
- **K2:** Okundu bilgisi mesaj listesinde hesaplanır. Grupta `read_count` (yalnızca gönderenin kendi mesajlarında), birebirde `read_by_peer`.
- **K3:** Karar öncesi içerik ucu: `GET /access-requests/:id/targets/:departmentId/content`. Yalnızca patron, hedef `pending` iken, her okuma loglanır.
- **K4:** Delta polling: `messages.change_seq`, `conversations.last_change_seq`, `conversations.updated_at`, `after_change_seq` ve `updated_after`.
- **K6:** Hata kodları kapalı bir katalogdur (§9.1). `packages/core` ile OpenAPI aynı listeyi kullanır.
- **K7:** Hız sınırı veritabanından sayılır. Aşımda 429 `RATE_LIMITED` ve `Retry-After` döner.
- **Ç1:** `POST /admin/company-links` `company_ids` alır (iki farklı şirket, sıra serbest), sunucu sıralar. Yanıt `company_low_id` ve `company_high_id` döner.
- **Ç6:** Onaylayanın gördüğü meta veriye `conversation_type` ve `requester_department_ids` eklendi.
- **Ç7:** Her aktif çalışan grup oluşturabilir. Eklenen her üye için `canMessage` geçmelidir.
- **Ç9:** Birim kanalını sistem yöneticisi açar: `POST /admin/departments/:id/channel`.
- **Ç10:** Hedef birimler, ayrılmış üyelerin birimlerini de içerir.
- **Ç11:** Ticket gövdesi talep eden ve patrona görünür.
- **Ç12:** Ticket düzenlemesi yalnızca karar verilmeden önce ve açıldıktan sonra 15 dakika içinde yapılabilir.
- **Ç14:** Süresi dolan talep ya da ticket yeniden açılınca yeni kayıt oluşur, `reopened_from` ile önceki kayda bağlanır.
- **Ç15:** İstemci kopyalama denemesini `POST /access-requests/:id/events` ile bildirir. Kayıt istemci beyanıdır.
- **Ç16:** Davet akışı. Tek kullanımlık, süreli, hash'li token (`invitations`). `POST /auth/accept-invite` ile parola belirlenir.
- **Ç17:** `PATCH /users/me` yalnızca `job_title` ve `profile_picture_url` alır. Ad soyad yalnızca sistem yöneticisi tarafından değişir.
- **Ç18:** Şirket, birim ve lokasyon için yönetim CRUD'u.
- **Ç19:** `POST /admin/users/:id/activate`.
- **Ç20:** `/users/{userId}/mute-state` yolu kaldırıldı. Sessize alma yalnızca konuşma bazlıdır.
- **Ç21:** `decision_basis` değerleri `content` ve `meta`.
- **Ç22:** Mesaj listelerinde `seq`, diğer listelerde opak `cursor`. Offset yok.
- **Ç23:** `before_seq`, `after_seq` ve `after_change_seq` hiçbiri yoksa en yeni `limit` mesaj döner.
- **Ç24:** Mevcut birebir konuşma için `POST /conversations` 200 döner, yeni konuşma için 201.
- **Ç25:** Ticket ve erişim talebinde `client_request_id` (istemci üretir) zorunlu. Tekrar eden istek ikinci kayıt açmaz.
- **Ç26:** Erişim talebi gerekçesi en az 20 karakter.
- **S1:** Faz 1 polling, WebSocket Faz 2.
- **S2:** Sunucu framework'ü Fastify.
- **B1:** `conversations.last_seq` ile boşluksuz `seq`.
- **B2:** `conversations.direct_key` ile birebir konuşma tekilliği.
- **B3:** `approval_rules` tek satır, `audit_log` tek tablo.
- **B4:** Refresh token rotation, aile iptali, istek başına aktiflik kontrolü. Access token 15 dakika, refresh token 30 gün.
- **B5:** `ticket_revisions` ile düzenleme geçmişi.
- **B6:** Kapatılan bağlantı yeniden açılırsa yeni satır oluşur, aktif çift tekildir.
- **B11:** `access_log.request_id` zorunlu.
- **B12:** Sistem mesajında `sender_user_id` NULL.
- **B13:** E-posta büyük/küçük harf duyarsız tekil.
- **B15:** `locations.city` ve `address` nullable.

**Önceki sürümler (v0.5 → v0.6)**
- **Teknik altyapı:** pnpm workspaces + Turborepo, Drizzle ORM.
- **Hız sınırı:** Mesaj 60/dakika, ticket 20/saat, değerler `approval_rules` tablosunda.
- **Açık konular:** Kapandı.

**Önceki sürümler (v0.4 → v0.5)**
- **Erişim talebi:** Talep, talep edenin seçtiği birim(ler)e gider. Seçilen her birimin onayı gerekir. Hedef birimler ayrı tabloda tutulur.
- **Bekleme süresi:** Karar verilmeyen talep ve ticket'lar `request_expiry_hours` (varsayılan 72 saat) sonunda kapanır.
- **Kaldırılan:** Eskalasyon aşamaları ve `escalation_hours`.

---

## 1. Amaç ve kapsam

Kurum içinde şirketler, birimler, lokasyonlar ve çalışanlar arasında iletişimi ve birimler arası talep akışını tek uygulamada toplamak.

### Ölçek
- Tek kurum, birden fazla şirket. 40–50 kullanıcı, en fazla 150–160 çalışan şirketten birinde.
- Tek instance PostgreSQL. Faz 1 polling ile çalışır, WebSocket Faz 2'de eklenir (S1). Yatay ölçekleme ihtiyaç doğarsa eklenir.

### Kapsam (MVP)
- Birebir ve grup konuşması, birim kanalı
- Metin mesajı, 15 dakika içinde düzenleme ve silme, okundu bilgisi
- Şirketler arası yazışma (sistem yöneticisinin açtığı bağlantılar)
- Ticket açma ve patron onayı
- Eski mesaj erişim talebi (patron onayı, süreli erişim)
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
| Çalışan | `users.role = 'employee'` | Varsayılan. Grup oluşturabilir (Ç7). |
| Sistem yöneticisi | `users.role = 'system_admin'` | Kullanıcı, şirket, birim, lokasyon, bağlantı ve birim kanalı yönetimi. Mesaj içeriğini görmez. Patron olmayan durumda hedeflerde yalnızca meta veriyle karar verir. |
| Patron | `users.role = 'executive'` | Kurum genelinde tek rol, birime atanmaz. Birden fazla olabilir. Erişim talebi ve ticket kararı verir, bu sırada içeriği görür. Sistem yöneticisi ve birim yöneticisi içeriği göremez. |
| Birim yöneticisi | `department_managers` kaydı | Birimin yönetim kaydı. Birim kanalında üye ekleyip çıkarır (Ç8). Erişim talebi ve ticket kararı vermez, içeriği görmez. |

Birim yöneticiliği bir birime atanmanın sonucudur. Patronluk kurum genelinde bir roldür (`users.role = 'executive'`), birime bağlı değildir.

---

## 3. Veri modeli

### 3.1 Organizasyon

**companies**: `company_id` (bigint identity, PK), `name` (benzersiz), `is_active`, zaman damgaları, `deleted_at`

**departments**: `department_id` (bigint identity, PK), `company_id` (FK, NOT NULL), `name`, `description`, zaman damgaları, `deleted_at`
- Benzersiz: `(company_id, name)` (aktif kayıtlar için partial index)

**locations**: `location_id` (bigint identity, PK), `name` (benzersiz), `city` (nullable), `address` (nullable), zaman damgaları, `deleted_at`

**department_locations** (yalnızca bilgi amaçlı): `(department_id, location_id)` PK

**user_departments**: `(user_id, department_id)` PK, `joined_at`

**user_locations** (profil ve raporlama): `(user_id, location_id)` PK

**department_managers**: `(department_id, user_id)` PK, `assigned_at`

**company_links** (şirketler arası bağlantı): `link_id` (bigint identity, PK), `company_low_id`, `company_high_id` (`low < high` CHECK), `created_by`, `created_at`, `revoked_at` (NULL = aktif).
- Aynı çift için en fazla bir aktif bağlantı olur (`revoked_at IS NULL` partial unique, B6). Kapatılan bağlantı yeniden açılırsa yeni satır oluşur, geçmiş korunur.

### 3.2 Kullanıcı

**users**: `user_id` (uuid, PK), `first_name`, `last_name`, `email` (büyük/küçük harf duyarsız benzersiz, aktif kayıtlar için partial index, B13), `password_hash` (argon2id), `job_title`, `role` (enum: `employee`, `system_admin`, `executive`), `profile_picture_url`, `is_active`, zaman damgaları, `deleted_at`

Kullanıcının şirketi kolon olarak tutulmaz, birimlerinden türetilir.

**invitations** (Ç16): `invitation_id` (PK), `user_id`, `token_hash` (benzersiz), `expires_at`, `used_at`, `created_by`, `created_at`. Token tek kullanımlıktır ve yalnızca hash olarak saklanır.

### 3.3 Konuşma

**conversations**: `conversation_id` (uuid, PK), `type` (enum: `direct`, `group`, `department`), `name`, `department_id` (FK, yalnızca `department` tipinde), `company_context_id` (FK, yalnızca şirketler arası konuşmada, ilk mesajdan sonra kilitlenir), `created_by`, `last_message_at`, `last_seq` (bigint, varsayılan 0, B1), `last_change_seq` (bigint, varsayılan 0, K4), `direct_key` (yalnızca `direct` tipinde dolu, B2), `updated_at` (K4: gönderim, düzenleme, silme, okundu ve üyelik olaylarında güncellenir), `created_at`, `deleted_at`
- Kısıt: birim başına bir aktif kanal (partial unique index)
- Kısıt: aktif birebir konuşma anahtarı tekil (partial unique index, B2)

**direct_key** biçimi: `<küçük_user_id>:<büyük_user_id>:<company_context_id veya 0>`. Kullanıcı kimlikleri metin olarak sıralanır. Şirket bağlamı yoksa `0` yazılır.

**conversation_members**: `(conversation_id, user_id)` PK, `joined_at`, `left_at` (NULL = aktif), `last_read_at`, `is_muted` (varsayılan false, yalnızca kullanıcı değiştirir)

Birim kanalı üyeliği birim üyeliğinden bağımsızdır. Birimden çıkarma kanaldan çıkarmayı otomatik tetiklemez, yönetici arayüzünde soru olarak sorulur.

### 3.4 Mesaj

**messages**: `message_id` (uuid, PK), `conversation_id`, `sender_user_id` (NULL yalnızca `system` mesajda, B12), `client_message_id` (uuid, idempotency; sistem mesajında sunucu üretir), `seq` (bigint, konuşma içi sıra), `change_seq` (bigint, K4: gönderim, düzenleme ve silmede konuşmanın `last_change_seq` sayacından alınır), `content`, `message_type` (enum: `text`, `system`), `sent_at`, `edited_at`, `deleted_at`
- `seq` konuşmanın `last_seq` sayacından `UPDATE ... SET last_seq = last_seq + 1 RETURNING` ile alınır (B1). Konuşmada boşluk oluşmaz.
- Kısıt: `text` mesajda gönderen zorunlu, `system` mesajda gönderen NULL.
- Benzersiz: `(conversation_id, seq)`, `(conversation_id, change_seq)`, `(sender_user_id, client_message_id)`

**message_revisions**: `revision_id` (PK), `message_id`, `content` (değişiklik öncesi), `revision_type` (enum: `edit`, `delete`), `created_at`

Düzenleme geçmişi alıcıya gösterilmez. Alıcı yalnızca "düzenlendi" ya da "silindi" işaretini görür.

### 3.5 Ticket

**tickets**: `ticket_id` (uuid, PK), `requester_id`, `target_department_id` (NOT NULL, bilgi amaçlı; karar yetkisi birime bağlı değildir, K5), `title` (zorunlu), `body` (zorunlu), `status` (enum: `pending`, `approved`, `rejected`, `withdrawn`, `expired`), `client_request_id` (uuid, Ç25, `requester_id` ile birlikte benzersiz), `reopened_from` (nullable, Ç14), `created_at`, `updated_at`, `expires_at`, `closed_at`

**ticket_revisions** (B5): `revision_id` (PK), `ticket_id`, `title` (önceki hal), `body` (önceki hal), `created_at`. Her düzenlemede önceki hal yazılır. Talep eden düzenleme geçmişini görmez, karar veren patron görebilir.

**ticket_decisions**: `decision_id` (PK), `ticket_id`, `decided_by`, `decision` (enum: `approved`, `rejected`), `note`, `decided_at`
- Kısıt: `decided_by <> requester_id`
- Kısıt: ticket başına en fazla bir karar (`ticket_id` benzersiz, K5)
- Değiştirilemez: karar kaydı UPDATE, DELETE ve TRUNCATE ile değişmez (§11)

### 3.6 Erişim talebi ve denetim

**access_requests**: `request_id` (PK), `conversation_id`, `requester_id`, `reason` (zorunlu, en az 20 karakter, Ç26), `client_request_id` (uuid, Ç25, `requester_id` ile birlikte benzersiz), `reopened_from` (nullable, Ç14), `status` (enum: `pending`, `approved`, `rejected`, `withdrawn`, `expired`), `access_expires_at` (onay sonrası süreli erişim), `expires_at` (karar bekleme süresi), `created_at`, `closed_at`

**access_request_targets**: `(request_id, department_id)` PK, `status` (enum: `pending`, `approved`, `rejected`, `expired`), `decided_by` (FK, nullable), `decided_at`, `decision_basis` (enum: `content`, `meta`; karar verilmeden önce NULL)
- Hedef birimler konuşmadaki üyelerin birimleriyle sınırlıdır. Ayrılmış üyelerin birimleri de hedef olabilir (Ç10).
- Kısıt: `decided_by <> requester_id`
- `decision_basis = 'content'`: patron içerikle karar verdi. `'meta'`: patron yokken sistem yöneticisi meta veriyle karar verdi.

**access_log** (tüm erişim olayları): `log_id` (bigint identity), `conversation_id`, `user_id`, `action` (enum: `read`, `approve`, `reject`, `copy_blocked`), `request_id` (zorunlu, B11), `accessed_at`

**audit_log** (yönetim olayları, B3): `audit_id` (bigint identity), `actor_user_id`, `entity_type` (enum: `user`, `department`, `company`, `location`, `company_link`, `department_manager`, `approval_rules`), `entity_id` (text), `action` (enum: `create`, `update`, `deactivate`, `activate`, `delete`, `revoke`, `assign`, `unassign`), `before` ve `after` (jsonb), `created_at`
- `before` ve `after` içinde şifre hash'i, mesaj içeriği ve ticket gövdesi bulunmaz (§11). Bu kural kod düzeyinde bir allowlist ile uygulanır.
- Sistem yöneticisi tabloyu değiştiremez. Yapılandırma değişiklikleri de buraya yazılır.

**approval_rules** (B3): tek satır (`id = 1`). `request_expiry_hours`, `access_window_hours`, `message_rate_per_min`, `ticket_rate_per_hour`, `updated_at`, `updated_by`. Her kolonun aralığı CHECK ile sınırlıdır (§10).

---

## 4. Mesajlaşma akışı

1. Kullanıcı bir kişi seçer.
2. `canMessage` kontrolü yapılır (5.1).
3. Şirketler arası ise şirket bağlamı belirlenir (5.3).
4. Birebir konuşma `direct_key` ile aranır. Varsa mevcut konuşma döner (200), yoksa oluşturulur (201). Eşzamanlı istekte DB tekilliği ikinci konuşmayı engeller (B2).
5. İstemci `client_message_id` üretir ve mesajı iyimser olarak gösterir.
6. Sunucu kaydeder, `seq` ve `change_seq` atar, üyelere iletir.
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

1. Talep eden konuşmayı, gerekçeyi (en az 20 karakter, Ç26) ve hedef birim(ler)i seçer. Hedef birimler konuşmadaki üyelerin birimleriyle sınırlıdır. Ayrılmış üyelerin birimleri de hedef olabilir (Ç10).
2. Her hedef birim için ayrı bir onay kaydı oluşur.
3. Hedef için patron varsa karar onda olur. Patron içeriği görür ve karar verir. Patron içeriği `GET /access-requests/:id/targets/:departmentId/content` ile okur (K3). Yalnızca patron, hedef `pending` iken erişir. Birim yöneticisi bu uca erişemez ve bu hedefte karar veremez. Her okuma `access_log`'a yazılır. Kapsam: konuşmanın tamamı görünür.
4. Hedef için patron yoksa karar sistem yöneticisindedir. Sistem yöneticisi yalnızca meta veriyi görür: talep eden (ad soyad, birim), konuşma tipi ve adı, üye sayısı, mesaj sayısı, ilk ve son mesaj tarihi, gerekçe, hedef birim ve talep eden kişinin birim kimlikleri (Ç6).
5. **Tüm hedefler onaylarsa** talep onaylanır. Talep eden, konuşmanın içeriğini `access_expires_at` süresince okur. Kopyalama kapalıdır, her okuma `access_log`'a yazılır. Kopyalama denemesi istemci tarafından `POST /access-requests/:id/events` ile bildirilir (Ç15). Bu kayıt istemci beyanıdır, sahte ya da eksik olabilir. İstemci başına hız sınırı uygulanır.
6. **Herhangi bir hedef reddederse** talep reddedilir.
7. Onaylayan ile talep eden aynı kişi olamaz.
8. Karar verilmeyen talep `expires_at` (varsayılan 72 saat) sonunda `expired` olur. Talep eden isterse `POST /access-requests/:id/reopen` ile yeniden açar. Yeni kayıt `reopened_from` ile önceki talebe bağlanır (Ç14).

Hedef birimlerden biri onaylamış, diğeri bekliyorsa talep `pending` kalır. Onaylanan hedefin kararı geri alınmaz, talep kapanana kadar bekler.

### 5.5 Ticket onayı

- Ticket kararı kurum genelindeki patron havuzundadır. Birim yöneticisi ticket kararı vermez. Açık ticket yeniden atanmaz (K5). Herhangi bir aktif patron karar verir.
- Patron yoksa karar sistem yöneticisindedir. Sistem yöneticisi yalnızca meta veriyi görür: talep eden, hedef birim, başlık, tarih, durum.
- Ticket gövdesi talep eden ve patrona görünür (Ç11).
- Ticket konuşma değildir, `access_log` gerektirmez, karar `ticket_decisions`'a yazılır.
- Talep eden kendi ticket'ını onaylayamaz.
- Karar verilmeyen ticket `expires_at` (varsayılan 72 saat) sonunda `expired` olur. Talep eden isterse `POST /tickets/:id/reopen` ile yeniden açar. Yeni kayıt `reopened_from` ile önceki ticket'a bağlanır (Ç14).
- Ticket yalnızca karar verilmeden önce talep eden tarafından geri çekilebilir (`withdrawn`).
- Düzenleme yalnızca karar verilmeden önce ve açıldıktan sonra 15 dakika içinde yapılabilir (Ç12). Her düzenlemede önceki hal `ticket_revisions`'a yazılır (B5).

### 5.6 Ayrılan ya da pasifleşen çalışan

- Hesap pasifleştirilince tüm aktif konuşmalardan `left_at` yazılır, konuşmada "Ad Soyad ayrıldı" sistem mesajı oluşur. Sistem mesajında gönderen NULL'dır (B12).
- Pasifleştirmede kullanıcının refresh token aileleri iptal edilir (B4).
- Mesajlar silinmez, gönderen olarak ad soyad kalır.
- Yeniden aktif edilince (`POST /admin/users/:id/activate`) konuşmalara otomatik eklenmez, yönetici tek tek ekler (Ç19).
- Birim yöneticiliği sistem yöneticisi tarafından yeniden atanır. Atanmayan birim yöneticiliği sistem yöneticisi ekranında bekler. Açık ticket'lar yeniden atanmaz: karar patron havuzundadır (K5).
- Birimden çıkarma ile pasifleştirme ayrı olaylardır. Birimden çıkarma kanal üyeliğini kendiliğinden kaldırmaz.
- **Üye ekleme ve çıkarma (Ç8):** Grupta grup kurucusundadır (`conversations.created_by`). Birim kanalında birim yöneticisindedir. Eklenen her üye için `canMessage(ekleyen, üye)` geçmelidir. Kurucu ayrılır ya da pasifleşirse yetki, grupta kalan aktif üyelerden katılma tarihi en eski olana geçer (öneri, uygulandı).

### 5.7 Şirketler arası bağlantı

- Yalnızca sistem yöneticisi açar ve kapatır.
- Açma isteği `company_ids` (iki farklı şirket, sıra serbest) alır. Sunucu sıralar. Yanıt `company_low_id` ve `company_high_id` döner (Ç1).
- Açılmadan önce etkilenecek kullanıcılar önizleme olarak gösterilir.
- Kapatılınca okuma açık kalır, yeni mesaj gönderilemez.
- Kapatılan bağlantı yeniden açılırsa yeni kayıt oluşur (B6).
- Her değişiklik `audit_log`'a yazılır.

---

## 6. Mesaj düzenleme ve silme

- Gönderen, mesajını gönderimden sonra **15 dakika** içinde düzenleyebilir veya silebilir.
- Süre sunucu saatiyle hesaplanır.
- Düzenleme ve silmede önceki içerik `message_revisions`'a yazılır.
- Düzenleme ve silme, mesajın `change_seq` değerini konuşmanın `last_change_seq` sayacından yeniden alır (K4). İstemci `after_change_seq` ile değişen mesajları görür. `seq` değişmez.
- Silme mesaj satırını fiziksel olarak silmez, `deleted_at` dolar, alıcı "mesaj silindi" görür.
- Süre dolunca mesaj kilitlenir.
- Eşzamanlı işlemlerde satır `SELECT ... FOR UPDATE` ile kilitlenir.
- Kullanıcıya açıkça söylenir: silinen mesajlar kurum kaydında saklanır.
- Push bildirimi geri çekilemez. Bu bilinen bir sınırlamadır.

---

## 7. Okundu bilgisi, bildirim ve sessize alma

- **Birebir konuşma:** Karşı taraf okuduysa `read_by_peer` true döner (K2).
- **Grup:** Mesaj listesinde `read_count` hesaplanır: mesajın gönderilmesinden sonra `last_read_at` değeri bu tarihten büyük olan üye sayısı. Yalnızca gönderenin kendi mesajlarında dolu döner (K2).
- **Kimlik gizliliği (K1):** Grupta bir üyenin `last_read_at` değeri yalnızca isteği yapanın kendi kaydında dolu döner. Diğer üyelerin değeri null'dır. Kimin hangi mesajı okuduğu istemciye açılmaz.
- Okundu bilgisi konuşma bazlıdır, mesaj bazlı kesin değildir. `POST /conversations/:id/read` gövdesizdir, bu yüzden ekranda görülmemiş mesajlar da okunmuş sayılır. Bu bilinçli bir performans takasıdır.
- **Sessize alma:** Yalnızca kullanıcı değiştirir. Sessizdeki konuşmada push ve OS bildirimi gitmez. Mesaj teslimi ve okunmamış sayısı etkilenmez. Sessize alma konuşma bazlıdır.

---

## 8. Saklama

- Mesajlar süresiz saklanır.
- KVKK uyumu, aydınlatma metni ve veri işleme envanteri uygulama dışında, kurumun hukuk süreciyle ilerler.

---

## 9. API (MVP)

**Genel:** `/api/v1/...`, `zod` doğrulama (istemci ve sunucu aynı şema), hata formatı `{ error: { code, message } }` (kodlar §9.1'de kapalı katalogdur, K6).
- **Sayfalama (Ç22):** Mesaj listelerinde `before_seq`, `after_seq` ve `after_change_seq`. Diğer listelerde opak `cursor`. Offset yok.
- **Idempotency (Ç25):** Mesajda `client_message_id`. Ticket ve erişim talebinde `client_request_id`. Aynı anahtarla gelen tekrar istek ilk kaydın sonucunu döner, ikinci kayıt açmaz.
- **Hız sınırı (K7):** Aşımda 429 `RATE_LIMITED` ve `Retry-After` (saniye) döner.
- **Yetki:** Her istekte sunucuda kontrol edilir ve tek policy katmanından geçer.

### 9.1 Hata kodu kataloğu (K6)

Kapalı enum. OpenAPI `Error.code` ve `packages/core` (`ERROR_CODES`) aynı listeyi kullanır. Yeni kod sözleşme değişikliği ister.

- 400: `VALIDATION_FAILED`, `INVITATION_INVALID`
- 401: `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `REFRESH_TOKEN_REUSED`
- 403: `FORBIDDEN`, `FORBIDDEN_NOT_MEMBER`, `ACCOUNT_INACTIVE`, `TARGET_INACTIVE`, `NO_COMPANY_LINK`, `COMPANY_LINK_REVOKED`, `SELF_DECISION_FORBIDDEN`, `CONTENT_NOT_VISIBLE`
- 404: `NOT_FOUND`
- 409: `CONTEXT_CHOICE_REQUIRED`, `CONTEXT_LOCKED`, `ALREADY_MEMBER`, `EDIT_WINDOW_CLOSED`, `MESSAGE_DELETED`, `REQUEST_NOT_PENDING`, `DEPARTMENT_CHANNEL_EXISTS`
- 410: `ACCESS_WINDOW_EXPIRED`
- 422: `TARGET_NOT_IN_CONVERSATION`, `REASON_TOO_SHORT`
- 429: `RATE_LIMITED`

Üye olmayan kullanıcıya konuşmanın varlığını göstermemek için `NOT_FOUND` (404) döner. `FORBIDDEN_NOT_MEMBER` yalnızca erişimi reddedilen ama var olduğu bilinen kayıtlar için kullanılır (bilgi ifşa kararı, K6 önerisi uygulandı).

**Kimlik:** `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` (gövde: `refresh_token`, yalnızca o aile kapanır), `POST /auth/logout-all` (tüm cihazlar, B4), `POST /auth/accept-invite` (davet token'ı ve yeni parola, Ç16)

**Kullanıcı:** `GET /users/me`, `PATCH /users/me` (yalnızca `job_title` ve `profile_picture_url`, Ç17), `GET /users?department_id=&company_id=&q=`

**Yönetim (sistem yöneticisi):** `POST /admin/users` (davet gönderir), `PATCH /admin/users/:id` (ad soyad ve `user_departments`, `user_locations` dahil, Ç17/Ç18), `POST /admin/users/:id/activate` (Ç19), `POST /admin/users/:id/deactivate`, `POST /admin/users/:id/reassign` (yalnızca birim yöneticiliği, K5), CRUD: `/admin/companies`, `/admin/departments`, `/admin/locations` (Ç18), `POST /admin/departments/:id/channel` (Ç9), `department_managers` atama ve kaldırma, `POST /admin/company-links` (`company_ids`, Ç1), `POST /admin/company-links/:id/revoke`, `GET` ve `PATCH /admin/approval-rules` (B3)

**Konuşmalar:** `GET /conversations?updated_after=` (K4 delta), `POST /conversations` (birebir için 200 ya da 201, Ç24; grup için her aktif çalışan, Ç7), `GET /conversations/:id`, `POST /conversations/:id/members` (grup kurucusu ya da birim kanalında birim yöneticisi, Ç8), `DELETE /conversations/:id/members/:userId` (aynı yetki, Ç8), `POST /conversations/:id/read`, `PATCH /conversations/:id/mute`

**Mesajlar:** `GET /conversations/:id/messages?before_seq=&limit=`, `GET /conversations/:id/messages?after_seq=`, `GET /conversations/:id/messages?after_change_seq=` (K4 delta: yeni, düzenlenmiş, silinmiş), `POST /conversations/:id/messages`, `PATCH /messages/:id` (15 dk), `DELETE /messages/:id` (15 dk)

**Ticket:** `POST /tickets` (`client_request_id`, Ç25), `GET /tickets?role=requester|approver`, `GET /tickets/:id` (gövde talep eden ve patrona), `PATCH /tickets/:id` (karar öncesi ve 15 dk, Ç12), `POST /tickets/:id/withdraw`, `POST /tickets/:id/decision` (patron), `POST /tickets/:id/reopen` (Ç14)

**Erişim talebi:** `POST /access-requests` (`client_request_id`, Ç25; hedef birimler dahil), `GET /access-requests?role=`, `GET /access-requests/:id` (yalnızca meta veri), `POST /access-requests/:id/targets/:departmentId/decision` (patron; patron yoksa sistem yöneticisi meta veriyle), `POST /access-requests/:id/withdraw`, `POST /access-requests/:id/reopen` (Ç14), `POST /access-requests/:id/events` (`copy_blocked`, Ç15), `GET /access-requests/:id/targets/:departmentId/content` (K3: yalnızca patron, hedef pending iken, loglanır), `GET /access-requests/:id/content` (yalnızca talep eden, süreli, loglanır)

**Ön kontrol:** `POST /messages/can-send` (yalnızca UX, karar sunucuda)

---

## 10. Teknik mimari

- **Backend:** Node.js, Fastify (S2), `zod`, winston + morgan
- **Veritabanı:** PostgreSQL
- **Realtime:** Faz 1'de polling ile delta çekme. WebSocket Faz 2'de, tek instance (S1).
- **Zaman işleri:** `expires_at` dolan talep ve ticket'ları kapatmak, 15 dakika kilidi uygulamak için basit scheduler.
- **Kimlik (B4):** argon2id. Access token 15 dakika. Refresh token 30 gün, yalnızca hash olarak `refresh_tokens` tablosunda, her yenilemede rotate edilir. Rotate edilmiş bir token tekrar gelirse aynı `family_id` ailesi iptal edilir ve 401 `REFRESH_TOKEN_REUSED` döner. Her istekte `users.is_active` ve `deleted_at` kontrol edilir, böylece pasifleştirme anında etkili olur.
- **Test:** Jest, Supertest. Yetki policy'si için ayrı test paketi (`canMessage`, erişim talebi çok birimli onay, ticket onayı, düzenleme penceresi, bekleme süresi).
- **İstemciler:** `apps/mobile` (Expo + RN), `apps/desktop` (Electron + React + Vite), `packages/core` (API istemcisi, zod, sync motoru, adapter arayüzleri, hata kataloğu)
- **İstemci saklama:** Mobilde Keychain/Keystore, desktop'ta Electron `safeStorage`. Düz AsyncStorage ya da localStorage kullanılmaz.

**Yapılandırma (`approval_rules`, B3):** Tek satır. Aralıklar kolon başına CHECK ile sınırlıdır:
- `request_expiry_hours`: varsayılan 72, aralık 1–720
- `access_window_hours` (onay sonrası içerik erişim süresi): varsayılan 24, aralık 1–168
- `message_rate_per_min`: varsayılan 60, aralık 1–600
- `ticket_rate_per_hour`: varsayılan 20, aralık 1–200

Değerler kodda sabit değil, tabloda tutulur. Her değişiklik `audit_log`'a yazılır. Access token ve refresh token süreleri bu tabloda değildir, ortam yapılandırmasıdır.

**Monorepo ve araçlar:** pnpm workspaces + Turborepo. ORM ve migration: Drizzle (SQL migration dosyaları repoda tutulur). Git reposu proje başında açılır.

---

## 11. Güvenlik ve denetim

- Şifreler argon2id ile hash'lenir, token rotation uygulanır (§10).
- Pasifleştirilen kullanıcının refresh token aileleri iptal edilir, erişim her istekte kesilir (B4).
- Loglarda mesaj içeriği ve ticket gövdesi yer almaz.
- `access_log`, `audit_log` ve `ticket_decisions` değiştirilemez (UPDATE, DELETE ve TRUNCATE engellidir).
- Hız sınırlama (K7): mesaj 60/dakika, ticket 20/saat, kullanıcı başına, `approval_rules`'tan okunur. Sayım veritabanından yapılır: mesajlarda son 1 dakikada gönderenin satırları, ticket'larda son 1 saatte açılanlar. Aynı `client_message_id` ile tekrar gelen istek sayılmaz. Düzenleme, silme ve sistem mesajları sayılmaz. Silinmiş ama satırı kalan mesajlar sayılır. Aşımda 429 `RATE_LIMITED` ve `Retry-After`.
- Dosyalar Faz 2'de eklenir, imzalı URL ile erişilir.

---

## 12. Fazlar

**Faz 1 (MVP)**
- Kimlik, kullanıcı, şirket, birim, lokasyon yönetimi, davet akışı
- Birebir, grup ve birim kanalı
- Metin mesajı, 15 dakika düzenleme ve silme, okundu bilgisi, delta ile geri doldurma (polling: `after_change_seq` ve `updated_after`)
- Gönderme yetkisi ve şirketler arası bağlantı
- Sessize alma, okunmamış sayısı
- Ticket açma, patron onayı, 15 dakika düzenleme, yeniden açma
- Eski mesaj erişim talebi (çok birimli onay, süreli erişim, yeniden açma, kopyalama olayı)
- Ayrılan çalışan kuralı

**Faz 2** (durum: uygulandı, bkz. §0b)
- WebSocket realtime (uygulandı), push bildirim (Expo Push, uygulandı)
- Dosya ekleri (uygulandı, yerel depo), ticket yorumları (uygulandı)
- Audit log ekranı (uygulandı: API ve masaüstü paneli, yalnızca sistem yöneticisi)

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
| 4 | Meta veri listesi | Kapandı: OpenAPI listesi, üye sayısı dahil, Ç6 ile genişletildi |
| 5 | Patron rolü ve karar yetkisi | Kapandı: `users.role = 'executive'`, kurum genelinde |
| 6 | Kanal yetkisi (Ç8) | Kapandı: grup kurucusu ve birim yöneticisi |
| 7 | Push bildirimi sağlayıcısı | Kapandı: Expo Push (EAS projectId ve kimlik bilgileri dağıtımda eklenir) |
| 8 | Üretim dosya deposu ve virüs taraması | Kapandı: yerel disk + ClamAV taraması (üretimde zorunlu) |
| 9 | Ticket ve erişim talebi arayüzleri | Kapandı: masaüstü ve mobil iş ekranı (ticket ve eski mesaj talebi, karar) |

---

## 14. Sonraki adımlar

1. Git reposu açılır, monorepo iskeleti kurulur (pnpm + Turborepo).
2. OpenAPI spec kilitlenir (`openapi-v1.yaml`).
3. `canMessage`, erişim talebi çok birimli onay, ticket onayı, düzenleme penceresi ve bekleme süresi test paketiyle yazılır.
4. Veritabanı şeması ve migration'lar oluşturulur (0002–0007 hazır, PGlite'ta doğrulandı).
5. Auth ve organizasyon yönetimi backend'de tamamlanır.
6. Konuşma, mesaj ve ticket endpoint'leri.
7. Erişim talebi endpoint'leri.
8. `packages/core` sync motoru, desktop üzerinden test edilir.
9. Mobil istemci aynı core üzerine kurulur.
10. Faz 2 uygulandı (push: Expo Push, bkz. §0b).
