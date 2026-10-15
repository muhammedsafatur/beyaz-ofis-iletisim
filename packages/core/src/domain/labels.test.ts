import { statusLabelTr } from "./labels";

describe("durum etiketleri", () => {
  it("ticket ve talep durumlarını Türkçeye çevirir", () => {
    expect(statusLabelTr("pending")).toBe("beklemede");
    expect(statusLabelTr("approved")).toBe("onaylandı");
    expect(statusLabelTr("rejected")).toBe("reddedildi");
    expect(statusLabelTr("withdrawn")).toBe("geri çekildi");
    expect(statusLabelTr("expired")).toBe("süresi doldu");
  });

  it("bilinmeyen durumu olduğu gibi döndürür", () => {
    expect(statusLabelTr("bilinmeyen")).toBe("bilinmeyen");
  });
});
