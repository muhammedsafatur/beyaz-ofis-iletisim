# Spec v0.7 öneri dokümanı

**Taban:** `kurum-ici-iletisim-spec-v0.6.md` (iş kuralları), `openapi-v1.yaml` (API sözleşmesi), `packages/db-schema/BOSLUKLAR.md`
**Durum:** Taslak. K3 ve K4 karara bağlandı ve uygulandı: `spec/kurum-ici-iletisim-spec-v0.7.md` (kısmi), `openapi-v1.yaml`, `packages/db-schema` (migration `0002_k3_k4_change_seq`). Diğer maddeler açık ve uygulanmadı.
**Kural:** Çelişkide spec kazanır. Spec'te olmayan her kural **öneri** olarak yazıldı ve kabul edilene kadar uygulanmaz.

İşaretler:
- **Önerilen:** tercih edilen seçenek ve gerekçesi. Karar verildiği anlamına gelmez.
- **Karar bekliyor:** iş kuralı ya da sözleşme kararı gerekir.
- **Onay bekliyor (düzeltme):** iş kuralı değişmez, yalnızca metin ya da sözleşme hizalanır.

---

## 1. Spec v0.6 ile OpenAPI çelişkileri

### 1.1 Çelişki tablosu

| Konu | Spec bölümü | OpenAPI yolu | İki taraftaki değer | Önerilen çözüm |
|---|---|---|---|---|
| Ç1 `company_links` alanları | §3.1, §5.7 | `POST /admin/company-links`, `CompanyLink` | Spec: `company_low_id`, `company_high_id`, `low < high` CHECK. OpenAPI: `company_a_id`, `company_b_id`, sıra serbest. `link_id` tipi spec'te yok, OpenAPI integer, BOSLUKLAR bigint | **Karar bekliyor.** Öneri: istek `company_ids` (iki farklı değer, sıra serbest), sunucu sıralar, yanıt `low`/`high` döner. Bkz. 1.2 |
| Ç2 Doküman sürümü | Başlık | `info.description` | Spec: v0.6. OpenAPI: "kurum-ici-iletisim-spec-v0.5.md" | **Onay bekliyor (düzeltme).** Açıklama v0.6'ya çekilir |
| Ç3 Grupta okuyanın kimliği | §7 | `GET /conversations/:id`, `members[].last_read_at` | Spec: "Kimlikler grup görünümünde açılmaz". OpenAPI: her üyenin `last_read_at` değeri döner | **Karar bekliyor.** Bkz. K1 |
| Ç4 Okundu taneciği ve birebir | §7 | `Conversation.read_summary.read_by_count` | Spec: grupta mesaj bazlı "N kişi okudu", birebirde "karşı taraf okuduysa". OpenAPI: konuşma başına tek tamsayı, birebir için ayrı alan yok (açıklama "okudu mu" diyor, şema sayı) | **Karar bekliyor.** Bkz. K2 |
| Ç5 Karar öncesi içerik | §5.4 adım 3, §9 | `GET /access-requests/:id`, `GET /access-requests/:id/content` | Spec §9: `GET /:id` karar verene göre içerik ya da meta döner. OpenAPI: `GET /:id` yalnızca meta, `/content` yalnızca talep edene | **Uygulandı (K3).** Yeni uç: `/targets/:departmentId/content` |
| Ç6 Meta veri alanları | §0, §5.4 adım 4 | `AccessRequestSummary.meta` | Spec §5.4: talep edenin birimi, konuşma tipi ve adı, üye sayısı, mesaj sayısı, ilk ve son mesaj, gerekçe, hedef birim. Spec §0 bunu "OpenAPI'deki haliyle kesinleşti" diyor. OpenAPI `meta`da konuşma tipi ve talep edenin birimi yok (`UserSummary` birim taşımıyor). Gerekçe ve hedefler yalnızca detay yanıtında var | **Karar bekliyor.** Öneri: `meta`ya `conversation_type` ve `requester_department_ids` eklenir, §0 cümlesi "§5.4 listesi" olarak düzeltilir |
| Ç7 Grup oluşturma yetkisi | §3.3, §13 | `POST /conversations` | Spec: kural yok, §13'te konu "kapandı" görünüyor. OpenAPI: "kurum politikasıyla, açık karar, şimdilik herkes" | **Karar bekliyor.** Bkz. 1.3 |
| Ç8 Üye ekleme ve çıkarma | §5.6 | `POST` ve `DELETE /conversations/:id/members` | Spec: "yönetici tek tek ekler", hangi yönetici olduğu belirsiz. OpenAPI: eklemede grup kurucusu ya da birim kanalında birim yöneticisi, çıkarmada yetki kuralı yok | **Karar verildi (kullanıcı):** grup kurucusu ve birim yöneticisi. Bkz. 1.3 |
| Ç9 Birim kanalı | §3.3 | `POST /conversations` | Spec: `department` tipi ve birim başına bir aktif kanal. OpenAPI: yalnızca `direct` ve `group` kabul eder, kanal açan uç yok | **Karar bekliyor.** Bkz. 1.3 |
| Ç10 Hedef birimler | §3.6, §5.4 adım 1 | `POST /access-requests` | Spec: "konuşmadaki üyelerin birimleri". OpenAPI: "konuşmadaki **aktif** üyelerin birimleri" | **Karar bekliyor.** Öneri: ayrılmış üyelerin birimleri de hedef olabilir. Bkz. 1.5 |
| Ç11 Ticket gövdesi görünürlüğü | §5.5 | `GET /tickets/:id`, `Ticket.body` | Spec: gövde yalnızca birim yöneticisine görünür. OpenAPI: aynı, talep eden `PATCH` ile gövdeyi değiştirebiliyor ama geri okuyamıyor | **Karar bekliyor.** Öneri: gövde talep eden ve hedef birim yöneticisine görünür. Bkz. 1.5 |
| Ç12 Ticket düzenleme koşulu | §5.5 | `PATCH /tickets/:id` | Spec: açıldıktan sonra 15 dk. OpenAPI: 15 dk ve karar verilmeden önce | **Karar bekliyor.** Öneri: OpenAPI koşulu spec'e eklenir. Bkz. 1.5 |
| Ç13 Ticket yeniden atama | §5.6 | `POST /admin/users/:id/reassign`, `ticket_ids` | Spec: açık ticket'lar yeniden atanır, ama ticket birime bağlı. OpenAPI: ticket bir kişiye atanıyor gibi okunuyor | **Karar bekliyor.** Bkz. K5 |
| Ç14 Süresi dolan talebi yeniden açma | §0a, §5.4 adım 8, §5.5 | Yok | Spec: talep eden isterse yeniden açar (talep ve ticket). OpenAPI: uç yok | **Karar bekliyor.** Bkz. 1.4 |
| Ç15 `copy_blocked` olayı | §3.6, §5.4 adım 5 | Yok | Spec: `access_log.action` içinde `copy_blocked` var. OpenAPI: istemcinin bu olayı bildireceği uç yok | **Karar bekliyor.** Bkz. 1.4 |
| Ç16 Kullanıcı oluşturma ve parola | §9, §10 | `POST /admin/users`, `/auth/*` | Spec: argon2id var, ilk parola akışı tanımsız. OpenAPI: "davet e-postası gönderilir" diyor, ama davet kabul ya da parola belirleme ucu yok | **Karar bekliyor.** Bkz. 1.4 |
| Ç17 Profil güncelleme alanları | §2, §3.2, §9 | `PATCH /users/me` | Spec: `PATCH /users/me` alan listesi vermiyor, ad soyad §3.2'de var. OpenAPI açıklaması "ad, soyad, unvan, profil fotoğrafı" diyor, şema yalnızca `job_title` ve `profile_picture_url` alıyor | **Karar bekliyor.** Öneri: ad soyad yalnızca sistem yöneticisi değiştirir. Şema esas alınır, açıklama düzeltilir |
| Ç18 Eksik yönetim uçları | §9 | Yok | Spec: şirket, birim, lokasyon, `user_departments`, `user_locations`, `department_managers` CRUD. OpenAPI: yalnızca `GET /companies`, `/departments`, `/locations` ve birim yöneticisi uçları | **Onay bekliyor (düzeltme).** Öneri: `/admin/companies`, `/admin/departments`, `/admin/locations` CRUD eklenir. `user_*` için `PATCH /admin/users/:id` yeterli |
| Ç19 Yeniden aktifleştirme | §5.6 | Yok | Spec: "yeniden aktif edilince" kuralı var. OpenAPI: uç yok, `PATCH /admin/users/:id` `is_active` almıyor | **Onay bekliyor (düzeltme).** Öneri: `POST /admin/users/:id/activate` |
| Ç20 Sahipsiz yol | §7 | `/users/{userId}/mute-state` | Spec: sessize alma konuşma bazlı, kullanıcı değiştirir. OpenAPI: yolun hiçbir işlemi yok | **Onay bekliyor (düzeltme).** Yol silinir |
| Ç21 `decision_basis` değerleri | §3.6 | `AccessRequestTarget.decision_basis` | Spec: yalnızca `'meta'` anılıyor. OpenAPI: `content`, `meta` | **Onay bekliyor (düzeltme).** Spec'e iki değer yazılır, karar verilmeden önce NULL |
| Ç22 Liste sayfalaması | §9 | `/users`, `/conversations`, `/tickets`, `/access-requests` | Spec: "cursor (`before_seq`, `after_seq`)". OpenAPI: mesaj dışında opak `cursor` | **Onay bekliyor (düzeltme).** Spec: mesajlarda seq, diğer listelerde opak cursor. Offset yok kuralı korunur |
| Ç23 Mesaj listesi ilk yükleme | §9 | `GET /conversations/:id/messages` | Spec: `before_seq` ve `after_seq` anılıyor, ilk yükleme yok. OpenAPI: ikisi de yoksa davranış tanımsız | **Onay bekliyor (düzeltme).** Öneri: ikisi de yoksa en yeni `limit` mesaj döner |
| Ç24 Birebir konuşma yanıt kodu | §4 adım 4 | `POST /conversations` | Spec: birebir konuşma varsa kullanılır. OpenAPI: mevcut birebir konuşma da 201 döner | **Onay bekliyor (düzeltme).** Öneri: mevcut konuşma için 200 |
| Ç25 İdempotency kapsamı | §9 | `POST /tickets`, `POST /access-requests` ve diğer yazmalar | Spec: "yazma işlemleri idempotent". OpenAPI: yalnızca mesajda `client_message_id` var | **Karar bekliyor.** Öneri: ticket ve talep oluşturmaya da istek anahtarı eklenir |
| Ç26 Erişim talebi gerekçesi | §3.6, §5.4 adım 1 | `POST /access-requests`, `reason` | Spec: asgari uzunluk "uygulama katmanında", sayı yok. OpenAPI: `minLength: 20` | **Karar bekliyor.** Öneri: 20 karakter spec'e yazılır |
| Ç27 Hız sınırı yanıtı | §11 | `POST /conversations/:id/messages`, `POST /tickets` | Spec: mesaj 60/dk, ticket 20/saat. OpenAPI: 429 yanıtı tanımsız | **Karar bekliyor.** Bkz. K7 |
| Ç28 Hata kodu kataloğu | §9 | `components.schemas.Error` | Spec: format var, katalog yok. OpenAPI: iki örnek kod | **Karar bekliyor.** Bkz. K6 |

Spec içi tutarsızlıklar (OpenAPI dışı):
- **S1 (Onay bekliyor, düzeltme):** §1 "Tek instance PostgreSQL ve WebSocket" diyor. §10 ve §12 Faz 1'i polling, WebSocket'i Faz 2 olarak tanımlıyor. Öneri: §1 "Faz 1 polling, Faz 2 WebSocket" olarak hizalanır.
- **S2 (Karar bekliyor):** §10 "Express veya Fastify" diyor. Tek seçim proje kararıdır. Öneri: Fastify, gerekçe proje tercihiyle doğrulanmalı.

### 1.2 Ç1: `company_links` alanları

| Seçenek | Açıklama | Trade-off |
|---|---|---|
| A | İstekte ve yanıtta `company_low_id`, `company_high_id`. İstemci sıralar | DB ile birebir. İstemci sıralamayı unutursa 422. Yönetici arayüzüne yük biner |
| B | İstek `company_ids: [int, int]` (sıra serbest, iki farklı değer). Sunucu sıralar. Yanıt `company_low_id`, `company_high_id` döner | Sıralama tek yerde. Yanıt DB ile birebir. OpenAPI'de istek alanı değişir |
| C | OpenAPI `company_a_id`, `company_b_id` kalır, API katmanında eşleme yapılır | Sözleşme değişmez. Eşleme kodu kalıcı olur, istemci hangi şirketin kendisi olduğunu yanıttan anlayamaz |

**Önerilen: B.** Gerekçe: sıralama kuralı spec'in veri kuralıdır, istemciye taşınmamalı. Yanıtta low/high kalınca şema, OpenAPI ve `packages/core` tipleri aynı adı kullanır.
Etkilenen: §3.1 (değişmez), OpenAPI `POST /admin/company-links`, `CompanyLink`.
**Karar bekliyor.**

### 1.3 Ç7, Ç8, Ç9: konuşma yönetim yetkileri

Spec bu üç konuda açık bir kural koymuyor. Aşağıdakiler **öneri**.

**Grup oluşturma (Ç7)**

| Seçenek | Açıklama | Trade-off |
|---|---|---|
| A | Her aktif çalışan grup oluşturabilir. Eklenen her üye için `canMessage` geçmelidir | Yeni yetki katmanı eklemez. Şirketler arası sızıntı aynı kuralla engellenir |
| B | Yalnızca sistem yöneticisi | Kontrol sıkı, ama günlük kullanımda yönetici darboğazı olur |

**Önerilen: A.** **Karar bekliyor.**

**Üye ekleme ve çıkarma (Ç8)**

| Seçenek | Açıklama | Trade-off |
|---|---|---|
| A | Grupta kurucu, birim kanalında birim yöneticisi ve sistem yöneticisi. Eklenen üye için `canMessage(ekleyen, üye)` geçmelidir | Eklemede kural açık. Açık soru: kurucu ayrılırsa ekleme yetkisi kime geçer |
| B | Yalnızca sistem yöneticisi | Basit, ama grup kurucusunun işini sistem yöneticisine taşır |

**Karar verildi (kullanıcı):** Grupta grup kurucusu, birim kanalında birim yöneticisi ekler ve çıkarır. Ekleme için `canMessage(ekleyen, üye)` geçmelidir (A'nın parçası). Sistem yöneticisi bu listede yoktur. Açık alt soru: kurucu ayrılır ya da pasifleşirse yetki kime geçer.

**Birim kanalı (Ç9)**

| Seçenek | Açıklama | Trade-off |
|---|---|---|
| A | Birim oluşturulunca kanal otomatik açılır | Ek uç yok. Kanal istenmeyen birimde boş kanal kalır |
| B | `POST /admin/departments/:id/channel` ile sistem yöneticisi açar | Açık kontrol. Bir uç ve bir ekran daha |

**Önerilen: B.** Gerekçe: §3.3 kanal üyeliğini birim üyeliğinden bağımsız tutuyor. Otomatik açma bu bağımsızlığa ters bir varsayılan getirir. **Karar bekliyor.**

### 1.4 Ç14, Ç15, Ç16

**Ç14: süresi dolan talebi yeniden açma**

| Seçenek | Açıklama | Trade-off |
|---|---|---|
| A | Yeniden açma yeni kayıt oluşturur. İsteğe `reopened_from` (nullable) eklenir | Durum makinesi basit kalır, `expired` son durumdur. Maliyet: bir kolon |
| B | `POST /{id}/reopen`: aynı kayıt `pending`'e döner, `expires_at` yenilenir | Tek kayıt. Ama `expired` geri alınır ve karar geçmişi karışır |

**Önerilen: A.** **Karar bekliyor.**

**Ç15: `copy_blocked` olayı**

| Seçenek | Açıklama | Trade-off |
|---|---|---|
| A | `POST /access-requests/:id/events` ile `{ type: "copy_blocked" }`. Sunucu `access_log`'a yazar (öneri: istemci başına hız sınırı) | Kayıt tamam. İstemci beyanına dayanır, sahte ya da eksik olabilir |
| B | `copy_blocked` enum'dan çıkarılır, yalnızca `read` loglanır | Basit. Kopyalama denemesinin izi kaybolur |

**Önerilen: A.** Gerekçe: enum değeri spec'te var, kaldırmak iş kuralını değiştirir. Kaydın istemci beyanı olduğu spec'e not düşülür. **Karar bekliyor.**

**Ç16: kullanıcı oluşturma ve ilk parola**

| Seçenek | Açıklama | Trade-off |
|---|---|---|
| A | Davet akışı: tek kullanımlık, süreli, hash'li token e-postayla gider, `POST /auth/accept-invite` ile parola belirlenir. `invitations` tablosu gerekir | En güvenli. E-posta altyapısı ve iki uç gerekir |
| B | Sistem yöneticisi geçici parola belirler, ilk girişte değişim zorunlu | E-posta gerekmez. Yönetici geçici parolayı bilir, kanal dışı iletim gerekir |

**Önerilen: A.** Gerekçe: §2 sistem yöneticisini içerikten ayırıyor. Parolayı bilmesi, kullanıcı adına giriş yapabilmesi demektir. B, e-posta altyapısı yoksa geçici çözüm olabilir. **Karar bekliyor.**

### 1.5 Karar gerektiren diğer çelişkiler

- **Ç10, hedef birimler:** Aktif üye şartı, yalnızca ayrılmış kişinin yazdığı konuşmada talebi hiçbir birime gönderemez. **Öneri:** ayrılmış üyelerin birimleri de hedef olabilir, çünkü talebin konusu eski mesajlardır.
- **Ç11, ticket gövdesi:** Talep eden kendi gövdesini düzenleyip geri okuyamıyor. **Öneri:** talep eden de görür.
- **Ç12, ticket düzenleme:** Karar sonrası düzenleme, kararın dayanağını değiştirir. **Öneri:** OpenAPI koşulu (karar verilmeden önce) spec'e eklenir.
- **Ç25, idempotency:** Mesajda var, ticket ve talepte yok. Tekrar eden istek çift ticket açabilir. **Öneri:** istek anahtarı eklenir.
- **Ç26, gerekçe uzunluğu:** Spec sayı vermiyor, OpenAPI 20 koyuyor. **Öneri:** 20 karakter spec'e yazılır.

---

## 2. Kritik maddeler

### K1. Grupta okuyanın kimliği açığa çıkıyor

**Sorun.** `GET /conversations/:id` her üyenin `last_read_at` değerini döndürüyor. İstemci bu değeri mesaj zamanıyla karşılaştırıp grupta kimin okuduğunu çıkarabilir. Spec §7 "Kimlikler grup görünümünde açılmaz" diyor, sunucu bu kuralı uygulamıyor.

| Seçenek | Açıklama | Trade-off |
|---|---|---|
| A | Grupta `members[].last_read_at` yalnızca isteği yapanın kendi kaydında dolu döner, diğerleri null. Birebirde karşı tarafın okuma bilgisi ayrı alanda döner (K2) | Kural sunucuda uygulanır. Maliyet: bir serileştirme filtresi |
| B | `members[].last_read_at` tamamen kaldırılır | En sıkı. Okuma bilgisi hiç gösterilemez |
| C | Alan kalır, istemci göstermez | Spec ihlali. Ağ trafiğini okuyan herkes kimliği görür |

**Önerilen: A.** Gerekçe: §7'yi sunucuda uygular, üye listesi bozulmaz. Policy test paketine "grupta başka üyenin `last_read_at` değeri dönmez" testi eklenir.
Etkilenen: §7 (metin netleşir), §9; OpenAPI `Conversation`.
**Karar bekliyor.**

### K2. Okundu bilgisi mesaj bazlı mı, konuşma bazlı mı

**Sorun.** Spec §7 iki şey söylüyor. "Okundu bilgisi konuşma bazlıdır, mesaj bazlı kesin değildir" ve grupta gösterim mesaj bazlıdır: "mesajın gönderilmesinden sonra `last_read_at` değeri bu tarihten büyük olan üye sayısı". OpenAPI konuşma başına tek `read_summary.read_by_count` döndürür, hangi mesaja ait olduğu belirsizdir. Birebirde spec "karşı taraf okuduysa" (evet ya da hayır) diyor, OpenAPI tamsayı döndürüyor ve birebir alanı yok.

| Seçenek | Açıklama | Trade-off |
|---|---|---|
| A | Mesaj listesinde hesaplanır: grupta `read_count`, birebirde `read_by_peer`. Yalnızca gönderenin kendi mesajlarında dolu | Spec metniyle birebir. Sayfa başına sorgu ihmal edilebilir (40-50 kullanıcı). Zaman damgası eşitliği küçük bir belirsizlik bırakır |
| B | Konuşma düzeyinde tek `read_by_count`, yalnızca son mesaj için | En ucuz. Önceki mesajlar için bilgi yok. Spec'in "mesaj gönderildikten sonra" kuralı karşılanmaz |
| C | `conversation_members.last_read_seq` eklenir, `POST /read` `up_to_seq` alır, sayım seq ile yapılır | Eşitlik sorunu yok, en kesin. Spec §3.3 ve §7 değişir, ek kolon ve istemci değişikliği gerekir |

**Önerilen: A.** Gerekçe: spec'in ilk cümlesini değiştirmeden uygular. C daha kesin ama şema ve spec değişikliği ister, ihtiyaç doğarsa sonradan eklenebilir.
Açık not: `POST /read` gövdesiz olduğu için ekranda görülmemiş mesajlar da okunmuş sayılır. Bu, §7'nin "kesin değildir" takasının parçasıdır.
Etkilenen: §7, §9; OpenAPI `Message`, `Conversation.read_summary` (kaldırılır ya da `read_by_peer`'e dönüşür).
**Karar bekliyor.**

### K3. Birim yöneticisi karar öncesi içeriği göremiyor

**Sorun.** Spec §5.4 adım 3: "Yönetici içeriği görür ve karar verir. Bu okuma `access_log`'a yazılır." Spec §9 de `GET /access-requests/:id` için karar verene göre içerik ya da meta döner diyor. OpenAPI'de `GET /{id}` yalnızca meta döner, `/content` yalnızca talep edene açıktır. Birim yöneticisinin içeriği okuyabileceği bir uç yok. Bu bir sözleşme eksiğidir.

| Seçenek | Açıklama | Trade-off |
|---|---|---|
| A | Yeni uç: `GET /access-requests/:id/targets/:departmentId/content`. Yalnızca o hedefin yöneticisi, hedef `pending` iken. Her çağrı `access_log`'a yazılır | Yetki hedef bazında net. Sistem yöneticisi bu uca erişemez (§2). Maliyet: bir uç, bir policy fonksiyonu |
| B | `/content` genişletilir: talep eden (onaydan sonra) ya da bekleyen hedefin yöneticisi | Tek uç. İki farklı yetki kuralı tek handler'da, test karmaşıklaşır |
| C | `GET /:id` karar verene içerik de döner | Meta ve içerik aynı yanıtta. Her detay görüntülemesi log üretir, mesaj sayfalaması detay ucuna gider |

**Önerilen: A.** Gerekçe: §2'deki "içeriği görür" yetkisini hedef ve rol bazında sınırlar. Log yalnızca içerik çekildiğinde yazılır.
Açık soru (spec'te yok): yönetici konuşmanın tamamını mı, yalnızca kendi birimindeki üyelerin mesajlarını mı görür. **Öneri:** tamamını. Talep eden onay sonrası tamamını görür ve karar bu içerik üzerinden verilir.
Etkilenen: §5.4, §9; OpenAPI `/access-requests`.
**Karar verildi:** Hedef yöneticisi görsün. Seçilen: A (hedef bazlı içerik ucu). Kayıt: cmsg_012ausVeVK2ZBtZmeqAcdvCXEgwA8uYyn99aUTNgs65dTA
**Güncelleme (kullanıcı kararı):** "Yönetici" patrondur, birim yöneticisi değildir. Karar öncesi içeriği yalnızca patron okur ve karar verir. Birim yöneticisi bu akışta içerik okumaz ve karar vermez.
**Uygulama kararı (kullanıcı talimatı: "bildiğin gibi ilerle"):** Patron kurum genelinde tek bir roldür (`users.role = 'executive'`), birime atanmaz. §2'deki "birim yöneticiliği birime atanmanın sonucudur" ilkesi birim yöneticisi için geçerli kalır. Ticket kararı da patrona geçti (aynı "yönetici = patron" kuralının genellemesi). `department_managers` kanal yetkisi için kalır, Ç8 hâlâ açık. Migration `0003_patron_role`.

### K4. Polling eski mesajlardaki düzenleme ve silmeyi yakalamıyor

**Sorun.** `GET /conversations/:id/messages?after_seq=` yalnızca `seq` değeri daha büyük yeni mesajları döner. 15 dakika içinde düzenlenen ya da silinen bir mesajın `seq` değeri değişmez, istemci değişikliği görmez. Konuşma listesinde delta da yok: `GET /conversations` her seferinde tam listeyi döner. Spec §12 Faz 1'de "delta ile geri doldurma (polling)" istiyor, bu değişiklikleri de kapsamalıdır.

| Seçenek | Açıklama | Trade-off |
|---|---|---|
| A | `messages.change_seq` eklenir. Gönderim, düzenleme ve silme ayrı bir sayaçtan (`conversations.last_change_seq`) değer alır. `GET .../messages?after_change_seq=` yeni ve değişen mesajları döner. Konuşma listesi için `updated_after` ve `conversations.updated_at` | Tek cursor, index `(conversation_id, change_seq)`. Ayrı sayaç `seq`'i boşluksuz tutar (B1). Okundu değişimi `updated_at`'i değiştirmeyebilir, liste için tam liste ya da okundu olayında güncelleme gerekir |
| B | Kullanıcı başına olay akışı: `GET /sync?cursor=` (mesaj, düzenleme, silme, üyelik, okundu) | En kapsamlı, Faz 2 WebSocket ile aynı model. Yeni `events` tablosu, en büyük değişiklik |
| C | İstemci son 15 dakikadaki mesajları her polling'de yeniden çeker | Ek şema yok. Çevrimdışı kalan istemci, pencere dışına çıkan değişiklikleri hiç görmez. Silinmiş mesajın izi kaybolabilir |

**Önerilen: A.** Gerekçe: B1 ile aynı kilit modeli, ek tablo yok, Faz 2'de WebSocket olayının taşıyacağı alanla aynı. B Faz 2'ye ertelenebilir. C'nin zayıflığı: 15 dakikalık pencere, saatlerce çevrimdışı kalan istemciyi kapsamaz.
Not: `change_seq` ile `seq` aynı sayacı paylaşırsa `seq`'te boşluk oluşur. Bu yüzden ayrı sayaç öneriliyor.
Etkilenen: §3.3, §3.4, §6, §9, §12; OpenAPI messages, conversations, `Message`.
**Karar verildi:** change_seq + updated_after. Seçilen: A. Kayıt: cmsg_012ausVeVK2ZBtZmeqAcdvCXHwky2vpjdrhJfdvP2SUcae

### K5. Ticket yeniden atama veri modelinde karşılık bulmuyor

**Sorun.** Spec §5.6: "Birim yöneticiliği ve açık ticket'lar sistem yöneticisi tarafından yeniden atanır." `tickets` tablosunda atanan kişi kolonu yok. Ticket `target_department_id` ile birime bağlı (§3.5), karar birim yöneticisinde (§5.5). OpenAPI `reassign.ticket_ids` ticket'ı bir kişiye atıyor gibi okunuyor. Spec'te tanımlı tek model birim bazlıdır. BOSLUKLAR B14 (`ticket_decisions` tekilliği) bu nedenle açık kalıyor.

| Seçenek | Açıklama | Trade-off |
|---|---|---|
| A | `ticket_ids` kaldırılır. Ticket birimi izler. Yönetici değişince bekleyen ticket'lar yeni yöneticiye düşer, yönetici kalmazsa sistem yöneticisine | Veri modeli değişmez. "Atanmayanlar sistem yöneticisi ekranında bekler" kuralı kendiliğinden sağlanır. Ticket başına tek karar kısıtı eklenebilir |
| B | `tickets.assignee_id` eklenir, karar yetkisi atanan kişiye geçer | Kişiye atama mümkün. Yetki iki kaynaktan gelir (birim ve atama), §2 "yöneticilik birime atanmanın sonucudur" ilkesine aykırı |
| C | `ticket_ids`, pasifleşen kişinin açtığı ticket'lar olarak yorumlanır | Karar yetkisi birime bağlı kaldığı için karar değişmez, yalnızca talep sahibi kaydı taşınır. Bu yorumun bir kullanım gerekçesi yok |

**Önerilen: A.** Gerekçe: spec'in birim ilkesine uyar. Atanacak kişi yoksa ticket birimde bekler, bu da §5.6'daki "atanmayanlar" ifadesiyle uyumlu.
Etkilenen: §5.6, §3.5; OpenAPI `POST /admin/users/:id/reassign`.
**Güncel öneri (patron kararından sonra, onaylanmadı):** Ticket kararı artık kurum genelindeki patron havuzunda, birim yöneticisinde değil. Bu nedenle ticket'ı bir kişiye ya da birime bağlamaya gerek kalmadı. Öneri: `ticket_ids` kaldırılır, açık ticket'lar havuzda kalır ve herhangi bir aktif patron karar verir. Patron yoksa §5.5 gereği sistem yöneticisi meta veriyle karar verir, süre dolarsa `expired` olur. `ticket_decisions.ticket_id` üzerinde tekil kısıt eklenir, böylece B14 de kapanır. Birim yöneticisi devri yalnızca `department_managers` kaydını değiştirir.
**Karar bekliyor.**

### K6. Hata kodu kataloğu tanımlı değil

**Sorun.** Spec §9 hata formatını tanımlıyor (`{ error: { code, message } }`), kod listesi yok. OpenAPI'de iki örnek kod var (`FORBIDDEN_NOT_MEMBER`, `CONTEXT_CHOICE_REQUIRED`). İstemci davranışı (yeniden dene, oturumu kapat, mesaj göster) koda bağlıdır.

| Seçenek | Açıklama | Trade-off |
|---|---|---|
| A | Kapalı enum. OpenAPI'de `ErrorCode` enum, `packages/core`'da aynı zod şeması. Her uç dönebileceği kodları listeler | İstemci exhaustive switch yazar. Yeni kod sözleşme değişikliği ister |
| B | Açık string, kodlar ayrı dokümanda | Esnek. İstemci bilinmeyen kodu genel hata sayar, tutarsızlık büyür |

**Önerilen: A.** Başlangıç listesi (öneri):
- 400: `VALIDATION_FAILED`
- 401: `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `REFRESH_TOKEN_REUSED` (B4)
- 403: `FORBIDDEN`, `FORBIDDEN_NOT_MEMBER`, `ACCOUNT_INACTIVE`, `TARGET_INACTIVE`, `NO_COMPANY_LINK`, `COMPANY_LINK_REVOKED`, `SELF_DECISION_FORBIDDEN`, `CONTENT_NOT_VISIBLE`
- 404: `NOT_FOUND`
- 409: `CONTEXT_CHOICE_REQUIRED`, `CONTEXT_LOCKED`, `ALREADY_MEMBER`, `EDIT_WINDOW_CLOSED`, `MESSAGE_DELETED`, `REQUEST_NOT_PENDING`, `DEPARTMENT_CHANNEL_EXISTS`
- 410: `ACCESS_WINDOW_EXPIRED`
- 422: `TARGET_NOT_IN_CONVERSATION`, `REASON_TOO_SHORT`
- 429: `RATE_LIMITED` (K7)

Öneri (spec'te yok): konuşmanın varlığını üyelik dışındaki kullanıcıdan saklamak için üye olmayana `NOT_FOUND` (404) dönülür. `FORBIDDEN_NOT_MEMBER` yalnızca erişimi reddedilen ama var olduğu bilinen kayıtlar için kullanılır. Bu bir bilgi ifşa kararıdır.
Etkilenen: §9; OpenAPI `components.schemas.Error` ve tüm yanıtlar.
**Karar bekliyor.**

### K7. Mesaj ve ticket hız sınırı için 429 tanımlı değil

**Sorun.** Spec §11: mesaj 60/dakika, ticket 20/saat, kullanıcı başına, `approval_rules`'tan okunur. OpenAPI `POST /conversations/:id/messages` ve `POST /tickets` için 429 yanıtı tanımlamıyor. Sayım yöntemi de tanımsız.

Yanıt sözleşmesi (öneri): HTTP 429, `Retry-After` (saniye), gövde `{ error: { code: "RATE_LIMITED", message } }`. OpenAPI'de `components.responses.RateLimited` olarak eklenir.

| Seçenek | Açıklama | Trade-off |
|---|---|---|
| A | DB sayımı: son 1 dakikada gönderenin `messages` satırları, ticket için son 1 saatte `tickets` satırları. Index `(sender_user_id, sent_at)` | Ek durum yok, yeniden başlatmada kaybolmaz, çok instance'a hazır. Eşzamanlı isteklerde sınır birkaç istek aşabilir |
| B | Süreç içi sayaç (Fastify rate-limit, bellek) | En ucuz. Yeniden başlatmada sıfırlanır, yatay ölçekte yetmez |
| C | Redis | Düşük gecikme. Faz 1'de yeni altyapı, proje ilkesine ters |

**Önerilen: A.** Gerekçe: sınır zaten kalıcı satırlardan türetilebiliyor, yeni altyapı gerektirmiyor. 40-50 kullanıcıda sorgu maliyeti ihmal edilebilir.
Öneri (spec'te yok): aynı `client_message_id` ile tekrar gelen istek sayılmaz (yeni satır oluşmaz). Düzenleme ve silme sayılmaz. Sistem mesajları sayılmaz. Silinmiş ama satırı kalan mesajlar sayılır, aksi halde silme ile sınır aşılabilir.
Etkilenen: §11; OpenAPI iki uç ve `components.responses`.
**Karar bekliyor.**

---

## 3. BOSLUKLAR.md maddeleri

### B1. `seq` üretimi (BOSLUKLAR A5)

**Sorun.** §3.4 `seq` ve `(conversation_id, seq)` benzersizliğini tanımlıyor, üretimini tanımlamıyor. `max(seq)+1` eşzamanlı gönderimde unique ihlali verir.

| Seçenek | Açıklama | Trade-off |
|---|---|---|
| A | `conversations.last_seq bigint NOT NULL DEFAULT 0`, gönderimde `UPDATE ... SET last_seq = last_seq + 1 RETURNING last_seq` | Konuşma içinde boşluksuz ve sıralı. Konuşma satırında kısa kilit. Farklı konuşmalar birbirini beklemez |
| B | Global `bigserial` | Kilit yok. Konuşma içinde boşluklu. Okunmamış sayısı için seq farkı kullanılamaz |
| C | Advisory lock ve `max(seq)+1` | Ek sorgu ve kilit. A'dan karmaşık, kazanç yok |

**Önerilen: A.** Gerekçe: tek satır kilidi, tek konuşma içinde sırayı garanti eder. K4'teki `change_seq` için ayrı sayaç kullanılır, aksi halde `seq`'te boşluk oluşur.
Etkilenen: §3.3, §3.4, §4 adım 6.
**Karar bekliyor.**

### B2. Birebir konuşma tekilliği (BOSLUKLAR A7)

**Sorun.** §4 adım 4 "birebir konuşma varsa kullanılır" diyor, DB kısıtı yok. Eşzamanlı iki istekte iki `direct` konuşma oluşabilir. §5.3'e göre farklı bağlamda yeni konuşma açılabildiği için anahtar bağlamı da içermeli.

| Seçenek | Açıklama | Trade-off |
|---|---|---|
| A | `conversations.direct_key` (sıralı iki `user_id` ve `company_context_id`) üzerinde `type = 'direct' AND deleted_at IS NULL` partial unique. Aynı şirket için bağlam NULL: PostgreSQL 15+ ise `NULLS NOT DISTINCT`, değilse sabit değer | DB garantisi. `INSERT ... ON CONFLICT DO NOTHING` ile tek tur. Türetilmiş kolon, ek bakım |
| B | Çift üzerinde `pg_advisory_xact_lock`, sonra SELECT ve INSERT | Kolon yok. Garanti uygulama kodunda, unutulan bir yol çift kayıt üretir |
| C | Ayrı `direct_conversations` tablosu | Normalize. Ek tablo ve join. Aynı garanti |

**Önerilen: A.** Gerekçe: §3.1-3.3'teki partial index kullanımıyla aynı desen. Garanti DB'de olur.
Etkilenen: §3.3, §4, §5.3.
**Karar bekliyor.**

### B3. `approval_rules` ve `audit_log` kolonları (BOSLUKLAR A1, A2)

**Sorun.** §10 dört anahtar ve varsayılan değer veriyor, kolon yapısı yok. §3.6 `audit_log` için yalnızca kapsam yazıyor, kolon yok. §10'daki yapılandırma değişikliklerinin kayıt kuralı da yok.

**approval_rules**

| Seçenek | Açıklama | Trade-off |
|---|---|---|
| A | Anahtar-değer: `key` (PK, enum), `value_int` (NOT NULL, > 0), `updated_at`, `updated_by` | Satır başına aynı tip. Kolon bazlı aralık kuralı zor |
| B | Tek satır: `id` (CHECK `id = 1`), dört `integer NOT NULL` kolon, kolon başına CHECK, `updated_at`, `updated_by` | Tip ve aralık kolon bazında. Okuma tek satır. Yeni anahtar kolon migration'ı ister |

**Önerilen: B.** Gerekçe: dört bilinen ayar için iki seçenek de migration ister. B'de her ayarın aralığı kendi CHECK'inde yazılabilir. Not: BOSLUKLAR A1'in önerisi A idi, bu doküman B'yi öneriyor.

**audit_log**

| Seçenek | Açıklama | Trade-off |
|---|---|---|
| A | Tek tablo: `audit_id` bigint identity, `actor_user_id`, `entity_type` (enum), `entity_id` text, `action` (enum), `before` ve `after` jsonb, `created_at` | Tek sorguyla Faz 2 ekranı için uygun. jsonb içeriği uygulama allowlist'ine bağlı |
| B | Varlık başına log tablosu | Tip güvenli. Tablo sayısı artar, ekran birleşik sorgu ister |

**Önerilen: A.** `before` ve `after` içinde `password_hash`, mesaj içeriği ve ticket gövdesi yer almaz (§11). Bu kod düzeyinde allowlist ile sağlanır. Değiştirilemezlik trigger'ı (`0001_immutable_logs.sql`) tabloya bağlanır.
Öneri (spec'te yok): `approval_rules` değişiklikleri `audit_log`'a yazılır.
Etkilenen: §3.6, §10, §11.
**Karar bekliyor (iki alt karar).**

### B4. Refresh token tablosu ve oturum kapatma (BOSLUKLAR A3)

**Sorun.** §10 "DB'de hash'li, rotate edilen refresh token" diyor, tablo yok. §11 "pasifleştirmede oturumlar kapatılır" buna bağlı. OpenAPI `/auth/logout` gövdesiz, hangi oturumun kapandığı belirsiz. Access token stateless ise pasifleştirilen kullanıcı token süresi dolana kadar erişebilir.

Tablo (öneri): `refresh_tokens`: `token_id` uuid PK, `user_id`, `token_hash` (unique), `family_id`, `expires_at`, `revoked_at`, `replaced_by`, `created_at`.

**Yeniden kullanım tespiti**

| Seçenek | Açıklama | Trade-off |
|---|---|---|
| A | Rotate edilmiş token tekrar gelirse aynı `family_id`'deki tüm token'lar iptal edilir, 401 `REFRESH_TOKEN_REUSED` | Çalınan token'ı yakalar. Ağ hatasında çift yenileme meşru kullanıcıyı da çıkarır |
| B | Yalnızca o token reddedilir | Kullanıcı dostu. Çalınan token ailesi yaşamaya devam eder |

**Pasifleştirme ve access token**

| Seçenek | Açıklama | Trade-off |
|---|---|---|
| C | Her istekte `users.is_active` ve `deleted_at` kontrolü | Pasifleştirme anında etkili. İstek başına bir PK sorgusu, kısa süreli önbellekle azaltılabilir |
| D | Yalnızca kısa access token ömrü | Sorgu yok. Pasifleştirmeden sonra en fazla token ömrü kadar erişim sürer |

**Önerilen: A ve C.** Gerekçe: A rotation'ın güvenlik amacını tamamlar. C "oturumlar kapatılır" kuralını gecikmesiz uygular. `canMessage` adım 1 aynı aktiflik kontrolünü yapıyor.
Öneri (spec'te yok): access token 15 dakika, refresh token 30 gün, `approval_rules` dışında yapılandırma olarak tutulur.
Logout (öneri): `POST /auth/logout` gövdesine `refresh_token` eklenir, yalnızca o aile kapanır. Tüm cihazlardan çıkış ayrı uç olarak önerilir.
Etkilenen: §10, §11; OpenAPI `/auth/*`.
**Karar bekliyor.**

### B5. Ticket düzenleme geçmişi (BOSLUKLAR A6)

**Sorun.** §5.5 "Düzenleme yapılırsa karar veren kişi değişikliği görür" diyor. Önceki halin tutulacağı tablo yok. "Değişikliği görür" ifadesinin önceki hali mi, yalnızca işareti mi kastettiği belirsiz. Mesajlar için `message_revisions` var, ticket için yok.

| Seçenek | Açıklama | Trade-off |
|---|---|---|
| A | `ticket_revisions` (`message_revisions` ile aynı desen): `ticket_id`, önceki `title`, `body`, `created_at` | Karar veren önceki hali görür. Gövde kopyası §5.5 ve §11 görünürlük kuralına tabidir. Düzenleme başına bir satır |
| B | Yalnızca `tickets.edited_at` ve "düzenlendi" işareti | Basit. Spec metni daraltılır: "değişikliği görür" yerine "düzenlendiğini görür" |

**Önerilen: A.** Gerekçe: karar veren, kararını etkileyen değişikliği görebilmeli. İşaret tek başına neyin değiştiğini söylemez. Öneri: talep eden geçmişi görmez (`message_revisions` ile aynı).
Ç12 kabul edilirse (karar sonrası düzenleme yok) geçmiş yalnızca karar öncesi değişiklikleri içerir.
Etkilenen: §3.5, §5.5; OpenAPI `Ticket`.
**Karar bekliyor.**

### B6. `company_links` yeniden açma (BOSLUKLAR A4)

**Sorun.** §3.1 benzersizliği `(company_low_id, company_high_id)` tam index olarak veriyor. Kapatılan bağlantı (`revoked_at` dolu) aynı çift için yeniden açılamaz. §5.7 yeniden açmayı yasaklamıyor. OpenAPI `POST /admin/company-links` de bu durumda 409 dönüyor, yeniden açmanın yolu tanımlı değil.

| Seçenek | Açıklama | Trade-off |
|---|---|---|
| A | Index `WHERE revoked_at IS NULL` partial unique. Her açılış yeni satır | Geçmiş korunur, `link_id` açılış başına değişir. Konuşmalardaki `company_context_id` bağlantı kaydına referans veriyorsa eski satır referansı anlamını korur |
| B | Tam index kalır, yeniden açmada `revoked_at` NULL'a çekilir | Satır sayısı sabit. Açılış ve kapanış geçmişi yalnızca `audit_log`'da kalır, `created_by` ilk açanı gösterir |

**Önerilen: A.** Gerekçe: satır değiştirilirse eski bağlama referans veren kayıtların anlamı kayar. Spec §3.1'e önerilen cümle: "Aynı çift için en fazla bir aktif bağlantı olur. Kapatılan bağlantı yeniden açılırsa yeni kayıt oluşur."
Etkilenen: §3.1, §5.7; OpenAPI `/admin/company-links`.
**Karar bekliyor.**

### 3.7 BOSLUKLAR.md'deki diğer maddeler

| # | Konu | Öneri | Durum |
|---|---|---|---|
| 8-9 | `link_id`, `revision_id`, `decision_id`, `log_id` tipleri | Öneri: bigint identity. OpenAPI `link_id` integer ile uyumlu hale getirilir. `request_id` ve `ticket_id` uuid kalır | Onay bekliyor (düzeltme) |
| 11 | `access_log.request_id` NOT NULL | Öneri: NOT NULL kalır, spec'e "her `access_log` kaydı bir talebe bağlıdır" yazılır | Karar bekliyor |
| 12 | Sistem mesajının gönderen alanı | Öneri: `sender_user_id` yalnızca `text` mesajda zorunlu, `system` mesajda NULL. "Ad Soyad ayrıldı" mesajı sistem tarafından yazılır | Karar bekliyor |
| 13 | Email büyük/küçük harf | Öneri: `lower(email)` üzerinde partial unique. Spec bu konuda tanımsız | Karar bekliyor |
| 14 | `ticket_decisions` tekilliği | K5 seçilirse ticket başına tek karar, `ticket_id` üzerinde unique | K5'e bağlı |
| 15 | `locations.city`, `address` | OpenAPI non-null, şema nullable. Öneri: nullable | Onay bekliyor (düzeltme) |

Teknik not (spec dışı, BOSLUKLAR C): `decided_by <> requester_id` kısıtı için `requester_id` kopyası ve bileşik FK kullanılıyor. Bu bir uygulama kararıdır, spec'e girmez.

---

## 4. Karar özeti

| Madde | Önerilen seçenek | Etkilenen spec bölümü | Durum |
|---|---|---|---|
| K1 Grupta `last_read_at` sızıntısı | A: yalnızca kendi kaydı dolu | §7, §9 | Karar bekliyor |
| K2 Okundu taneciği | A: mesaj bazlı `read_count` ve `read_by_peer` | §7, §9 | Karar bekliyor |
| K3 Karar öncesi içerik | A: hedef bazlı içerik ucu, okuyan ve karar veren patron (`users.role = 'executive'`) | §2, §5.4, §5.5, §9 | Uygulandı (spec v0.7, OpenAPI, şema 0003) |
| K4 Polling delta | A: `change_seq` ayrı sayaçla, konuşma `updated_after` | §3.3, §3.4, §6, §9, §12 | Uygulandı (v0.7 kısmi, OpenAPI, şema 0002) |
| K5 Ticket yeniden atama | A: `ticket_ids` kaldırılır, ticket birimi izler | §3.5, §5.6 | Karar bekliyor |
| K6 Hata kodu kataloğu | A: kapalı enum | §9 | Karar bekliyor |
| K7 429 ve hız sayacı | A: DB sayımı, `Retry-After` | §11 | Karar bekliyor |
| Ç1 `company_links` alanları | B: istek `company_ids`, yanıt low/high | §3.1, §5.7 | Karar bekliyor |
| Ç6 Meta veri alanları | `conversation_type` ve `requester_department_ids` eklenir | §0, §5.4 | Karar bekliyor |
| Ç7 Grup oluşturma | A: her aktif çalışan, üyeler `canMessage`'dan geçer | §3.3, §13 | Karar bekliyor |
| Ç8 Üye ekleme ve çıkarma | Grup kurucusu, birim kanalında birim yöneticisi (ekleme `canMessage` ile) | §5.6 | Karar verildi (kullanıcı) |
| Ç9 Birim kanalı | B: sistem yöneticisi ucu | §3.3, §9 | Karar bekliyor |
| Ç10 Hedef birimler | Ayrılmış üyelerin birimleri de hedef | §3.6, §5.4 | Karar bekliyor |
| Ç11 Ticket gövdesi görünürlüğü | Talep eden ve birim yöneticisi | §5.5 | Karar bekliyor |
| Ç12 Ticket düzenleme koşulu | Karar verilmeden önce şartı spec'e eklenir | §5.5 | Karar bekliyor |
| Ç14 Yeniden açma | A: yeni kayıt, `reopened_from` | §0a, §3.5, §3.6, §5.4, §5.5 | Karar bekliyor |
| Ç15 `copy_blocked` | A: istemci olay ucu | §3.6, §5.4, §9 | Karar bekliyor |
| Ç16 Kullanıcı oluşturma ve parola | A: davet akışı | §9, §10 | Karar bekliyor |
| Ç17 Profil alanları | Ad soyad yalnızca sistem yöneticisi | §2, §3.2, §9 | Karar bekliyor |
| Ç25 İdempotency kapsamı | Ticket ve talepte istek anahtarı | §9 | Karar bekliyor |
| Ç26 Gerekçe uzunluğu | 20 karakter spec'e yazılır | §3.6, §5.4 | Karar bekliyor |
| S2 Sunucu framework'ü | Fastify (proje tercihiyle doğrulanır) | §10 | Karar bekliyor |
| B1 `seq` üretimi | A: `conversations.last_seq` | §3.3, §3.4, §4 | Karar bekliyor |
| B2 Birebir konuşma tekilliği | A: `direct_key` partial unique | §3.3, §4, §5.3 | Karar bekliyor |
| B3 `approval_rules` ve `audit_log` | B: tek satır (approval_rules); A: tek tablo (audit_log) | §3.6, §10, §11 | Karar bekliyor |
| B4 Refresh token ve oturum kapatma | A ve C: aile iptali, istek başına aktiflik | §10, §11 | Karar bekliyor |
| B5 Ticket düzenleme geçmişi | A: `ticket_revisions` | §3.5, §5.5 | Karar bekliyor |
| B6 `company_links` yeniden açma | A: partial unique, yeni satır | §3.1, §5.7 | Karar bekliyor |
| B11 `access_log.request_id` | NOT NULL kalır | §3.6 | Karar bekliyor |
| B12 Sistem mesajının gönderen alanı | `system` mesajda `sender_user_id` NULL | §3.4, §5.6 | Karar bekliyor |
| B13 Email büyük/küçük harf | `lower(email)` partial unique | §3.2 | Karar bekliyor |
| Ç2 Doküman sürümü | Açıklama v0.6'ya çekilir | Başlık | Onay bekliyor (düzeltme) |
| Ç18 Eksik yönetim uçları | CRUD uçları OpenAPI'ye eklenir | §9 | Onay bekliyor (düzeltme) |
| Ç19 Yeniden aktifleştirme | `POST /admin/users/:id/activate` | §5.6 | Onay bekliyor (düzeltme) |
| Ç20 Sahipsiz yol | `/users/{userId}/mute-state` silinir | §7 | Onay bekliyor (düzeltme) |
| Ç21 `decision_basis` | Spec'e `content` ve `meta` yazılır | §3.6 | Onay bekliyor (düzeltme) |
| Ç22 Liste sayfalaması | Mesajda seq, diğerlerinde opak cursor | §9 | Onay bekliyor (düzeltme) |
| Ç23 Mesaj ilk yükleme | İkisi de yoksa en yeni `limit` mesaj | §9 | Onay bekliyor (düzeltme) |
| Ç24 Birebir konuşma yanıt kodu | Mevcut için 200 | §4, §9 | Onay bekliyor (düzeltme) |
| S1 Tek instance ve WebSocket ifadesi | "Faz 1 polling, Faz 2 WebSocket" | §1, §10 | Onay bekliyor (düzeltme) |
| B8-9 ID tipleri | bigint identity, OpenAPI integer ile hizalanır | §3.1, §3.4-3.6 | Onay bekliyor (düzeltme) |
| B15 `locations` alanları | `city`, `address` nullable | §3.1 | Onay bekliyor (düzeltme) |

**Karar bekleyen madde sayısı: 29.** Onay bekleyen düzeltme: 11. Ç3, Ç4, Ç5, Ç13, Ç27, Ç28 ilgili K maddesinde karara bağlanır, ayrıca sayılmaz. B14 K5'e bağlıdır, ayrıca sayılmaz.

**Spec'e en çok etki eden 3 madde:**
1. **K4 polling delta:** veri modeli (§3.3, §3.4), düzenleme akışı (§6), API (§9) ve Faz 1 kapsamı (§12) etkilenir. B1 kararına bağlıdır.
2. **K3 karar öncesi içerik:** §2 yetki ayrımının uç düzeyinde uygulanması, erişim talebi akışı (§5.4) ve `access_log` kapsamı değişir.
3. **K1 ve K2 okundu bilgisi:** gizlilik kuralı (§7), mesaj yanıt şekli (§9) ve birebir gösterim değişir. Ç4 ve Ç5 bu iki maddeye bağlıdır.
