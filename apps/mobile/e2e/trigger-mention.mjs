// Gerçek zamanlı anma tetikleyicisi: Ayşe, "Satış ekibi" grubunda Ali'yi anar.
// Ali'nin uygulaması giriş yapıp WebSocket'e bağlandıktan sonra çalıştırılmalıdır (olay yalnızca bağlı kullanıcıya gider).
// Kullanım: node e2e/trigger-mention.mjs [api-url]
import { randomUUID } from "node:crypto";

const API = process.argv[2] ?? "http://127.0.0.1:3000/api/v1";

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const ayse = await call("POST", "/auth/login", null, { email: "ayse@demo.test", password: "demo-parola-123" });
const ali = await call("POST", "/auth/login", null, { email: "ali@demo.test", password: "demo-parola-123" });
const aliMe = await call("GET", "/users/me", ali.body.access_token);
const groups = (await call("GET", "/conversations", ayse.body.access_token)).body.items;
const group = groups.find((c) => c.name === "Satış ekibi");
const content = `Ali bunu gorur musun ${Date.now()}`;
const sent = await call("POST", `/conversations/${group.conversation_id}/messages`, ayse.body.access_token, {
  client_message_id: randomUUID(),
  content,
  mentions: [aliMe.body.user_id],
});
console.log(sent.status === 201 ? `anma gonderildi: ${content}` : `HATA ${sent.status}: ${JSON.stringify(sent.body)}`);
process.exit(sent.status === 201 ? 0 : 1);
