// Yerel geliştirme sunucusu: PGlite üzerinde API (PostgreSQL kurulumu gerekmez).
// Veri bellekte tutulur, süreç kapanınca silinir. Demo verisi servis fonksiyonlarıyla yüklenir.
import { randomUUID } from "node:crypto";
import { departments, companies, userDepartments, users } from "@beyaz-ofis/db-schema";
import { buildApp } from "./app.js";
import { createTestDb } from "./db.js";
import { hashPassword } from "./services/auth.js";
import { createConversation, postMessage } from "./services/conversations.js";
import { audit, loadActor, type Ctx } from "./services/common.js";

const PORT = Number(process.env.PORT ?? 3000);
const PASSWORD = "demo-parola-123";
const JWT_SECRET = "dev-only-secret-at-least-32-characters-long";

async function seed(ctx: Ctx) {
  const db = ctx.db;
  const [company] = await db.insert(companies).values({ name: "Demo Şirket" }).returning();
  const [sales] = await db.insert(departments).values({ companyId: company!.companyId, name: "Satış" }).returning();
  const [hr] = await db.insert(departments).values({ companyId: company!.companyId, name: "İnsan Kaynakları" }).returning();
  const hash = await hashPassword(PASSWORD);
  const people = [
    { first: "Sistem", last: "Yöneticisi", email: "admin@demo.test", role: "system_admin" as const, dept: null },
    { first: "Ali", last: "Yılmaz", email: "ali@demo.test", role: "employee" as const, dept: sales! },
    { first: "Ayşe", last: "Kaya", email: "ayse@demo.test", role: "employee" as const, dept: sales! },
    { first: "Mehmet", last: "Demir", email: "patron@demo.test", role: "executive" as const, dept: hr! },
  ];
  const ids = new Map<string, string>();
  for (const p of people) {
    const [u] = await db
      .insert(users)
      .values({ firstName: p.first, lastName: p.last, email: p.email, passwordHash: hash, role: p.role })
      .returning();
    ids.set(p.email, u!.userId);
    if (p.dept) await db.insert(userDepartments).values({ userId: u!.userId, departmentId: p.dept.departmentId });
  }

  // Denetim kaydı örnekleri: kurulum adımları da yönetici eylemi olarak kaydedilir.
  const adminId = ids.get("admin@demo.test")!;
  await audit(db, adminId, "company", String(company!.companyId), "create", undefined, { name: "Demo Şirket" });
  await audit(db, adminId, "department", String(sales!.departmentId), "create", undefined, { name: "Satış" });
  await audit(db, adminId, "department", String(hr!.departmentId), "create", undefined, { name: "İnsan Kaynakları" });
  for (const p of people.filter((x) => x.role !== "system_admin")) {
    await audit(db, adminId, "user", ids.get(p.email)!, "create", undefined, { first_name: p.first, last_name: p.last });
  }

  const ali = await loadActor(db, ids.get("ali@demo.test")!);
  const ayse = ids.get("ayse@demo.test")!;
  const group = await createConversation(ctx, ali!, {
    type: "group",
    name: "Satış ekibi",
    member_ids: [ayse, ids.get("patron@demo.test")!],
  });
  const groupId = (group.body as { conversation_id: string }).conversation_id;
  for (const text of ["Herkese merhaba, haftalık toplantı 14:00'te.", "Notları paylaşabilir misiniz?"]) {
    await postMessage(ctx, ali!, groupId, { client_message_id: randomUUID(), content: text });
  }
  const direct = await createConversation(ctx, ali!, { type: "direct", member_ids: [ayse] });
  const directId = (direct.body as { conversation_id: string }).conversation_id;
  await postMessage(ctx, ali!, directId, { client_message_id: randomUUID(), content: "Akşam çıkıyor musun?" });
}

const { db, close: closeDb } = await createTestDb();
const { app, ctx } = buildApp({ db, jwtSecret: JWT_SECRET, logger: false });
await seed(ctx);
await app.listen({ port: PORT, host: "127.0.0.1" });
console.log(`API hazır: http://127.0.0.1:${PORT}/api/v1  (PGlite, bellek içi)`);
console.log(`Giriş: ali@demo.test / ${PASSWORD}  (ayrıca ayse@demo.test, patron@demo.test, admin@demo.test)`);

const shutdown = async () => {
  await app.close();
  await closeDb();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
