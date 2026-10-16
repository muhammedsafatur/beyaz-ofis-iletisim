import { accessExpiresAt, canChangeMessage, expiresAt, isExpired, MESSAGE_EDIT_WINDOW_MS } from "./window";
import { minutesAfter, T0, user } from "./fixtures";

const sender = user({ id: "s" });
const other = user({ id: "o" });
const msg = { senderId: "s", sentAt: T0, deleted: false };

describe("mesaj düzenleme ve silme penceresi (6)", () => {
  it("pencere 15 dakika", () => {
    expect(MESSAGE_EDIT_WINDOW_MS).toBe(15 * 60_000);
  });

  it("gönderen 15 dakika içinde düzenleyebilir", () => {
    expect(canChangeMessage(msg, sender, minutesAfter(14))).toEqual({ allowed: true });
  });

  it("15 dakika sonra EDIT_WINDOW_CLOSED", () => {
    expect(canChangeMessage(msg, sender, minutesAfter(16))).toEqual({
      allowed: false,
      code: "EDIT_WINDOW_CLOSED",
    });
  });

  it("başkası düzenleyemez", () => {
    expect(canChangeMessage(msg, other, minutesAfter(1))).toEqual({ allowed: false, code: "FORBIDDEN" });
  });

  it("silinmiş mesaj değiştirilemez", () => {
    expect(canChangeMessage({ ...msg, deleted: true }, sender, minutesAfter(1))).toEqual({
      allowed: false,
      code: "MESSAGE_DELETED",
    });
  });

  it("pasif gönderen değiştiremez", () => {
    const inactive = user({ id: "s", isActive: false });
    expect(canChangeMessage(msg, inactive, minutesAfter(1))).toEqual({ allowed: false, code: "ACCOUNT_INACTIVE" });
  });
});

describe("bekleme süresi ve erişim süresi (5.4 adım 8, 5.5)", () => {
  it("72 saatlik süre oluşturma anından 72 saat sonra dolar", () => {
    const end = expiresAt(T0, 72);
    expect(end.getTime() - T0.getTime()).toBe(72 * 60 * 60_000);
  });

  it("süre dolmadan kayıt kapanmaz, dolunca kapanır", () => {
    const end = expiresAt(T0, 72);
    expect(isExpired(end, minutesAfter(72 * 60 - 1))).toBe(false);
    expect(isExpired(end, minutesAfter(72 * 60))).toBe(true);
  });

  it("onay sonrası erişim süresi approval_rules değeriyle hesaplanır (varsayılan 24 saat)", () => {
    const end = accessExpiresAt(T0, 24);
    expect(end.getTime() - T0.getTime()).toBe(24 * 60 * 60_000);
  });
});
