import { base64ToBytes } from "./bytes";

describe("base64ToBytes", () => {
  it("Buffer ile aynı sonucu verir (dolgu dahil)", () => {
    for (const text of ["", "a", "ab", "abc", "Merhaba dünya", "x".repeat(1000)]) {
      const b64 = Buffer.from(text, "utf8").toString("base64");
      expect(Array.from(base64ToBytes(b64))).toEqual(Array.from(Buffer.from(b64, "base64")));
    }
  });

  it("ikili veriyi (0-255 arası tüm değerler) doğru çözer", () => {
    const raw = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const decoded = base64ToBytes(raw.toString("base64"));
    expect(Array.from(decoded)).toEqual(Array.from(raw));
  });

  it("satır sonu ve boşluk gibi geçersiz karakterleri atlar", () => {
    const b64 = Buffer.from("ok").toString("base64");
    expect(Buffer.from(base64ToBytes(`${b64.slice(0, 2)}\n${b64.slice(2)}`)).toString("utf8")).toBe("ok");
  });
});
