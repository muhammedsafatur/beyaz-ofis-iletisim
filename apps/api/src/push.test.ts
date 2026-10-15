import { expoPushSender, type PushMessage } from "./push.js";

const msg = (to: string): PushMessage => ({ to, title: "Beyaz Ofis", body: "Yeni mesajınız var", sound: "default" });

// Expo'yu taklit eder: her isteğin gövdesini kaydeder ve verilen yanıtı döner.
function fakeExpo(respond: (batch: PushMessage[]) => unknown, status = 200) {
  const calls: PushMessage[][] = [];
  const fetchImpl = (async (_url: string, init?: { body?: string }) => {
    const batch = JSON.parse(String(init?.body)) as PushMessage[];
    calls.push(batch);
    return new Response(JSON.stringify(respond(batch)), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("expoPushSender", () => {
  it("100 mesajlık parçalara böler; istek gövdesi yalnızca bildirim alanlarını taşır", async () => {
    const { fetchImpl, calls } = fakeExpo((batch) => ({ data: batch.map(() => ({ status: "ok", id: "t" })) }));
    const msgs = Array.from({ length: 150 }, (_, i) => msg(`ExponentPushToken[t${i}]`));
    const gone = await expoPushSender(fetchImpl).send(msgs);
    expect(gone).toEqual([]);
    expect(calls.map((c) => c.length)).toEqual([100, 50]);
    expect(calls[0]![0]).toEqual(msgs[0]);
  });

  it("DeviceNotRegistered dönen belirteçleri, bilet sırasıyla eşleştirerek bildirir", async () => {
    const { fetchImpl } = fakeExpo((batch) => ({
      data: batch.map((_, i) =>
        i === 1 ? { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } } : { status: "ok", id: "t" },
      ),
    }));
    const msgs = [msg("ExponentPushToken[a]"), msg("ExponentPushToken[b]"), msg("ExponentPushToken[c]")];
    expect(await expoPushSender(fetchImpl).send(msgs)).toEqual(["ExponentPushToken[b]"]);
  });

  it("diğer bilet hataları belirteci silmez", async () => {
    const { fetchImpl } = fakeExpo((batch) => ({
      data: batch.map(() => ({ status: "error", message: "rate", details: { error: "MessageRateExceeded" } })),
    }));
    expect(await expoPushSender(fetchImpl).send([msg("ExponentPushToken[a]")])).toEqual([]);
  });

  it("HTTP hatasında istisna fırlatır", async () => {
    const { fetchImpl } = fakeExpo(() => ({ errors: [] }), 500);
    await expect(expoPushSender(fetchImpl).send([msg("ExponentPushToken[a]")])).rejects.toThrow("500");
  });
});
