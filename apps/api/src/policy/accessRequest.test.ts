import {
  aggregateRequestStatus,
  canDecide,
  canDecideTarget,
  canReadApprovedContent,
  canReadTargetContent,
  validateReason,
} from "./accessRequest";
import { minutesAfter, T0, user } from "./fixtures";

const patron = user({ id: "p", role: "executive" });
const sysAdmin = user({ id: "s", role: "system_admin" });
const requester = user({ id: "r" });
const colleague = user({ id: "c" });

describe("erişim talebi, çok birimli onay (5.4)", () => {
  it("tüm hedefler onaylarsa talep onaylanır", () => {
    expect(aggregateRequestStatus(["approved", "approved"])).toBe("approved");
  });

  it("bir hedef reddederse talep reddedilir, diğeri onaylansa bile", () => {
    expect(aggregateRequestStatus(["approved", "rejected", "pending"])).toBe("rejected");
  });

  it("biri onaylamış, diğeri bekliyorsa talep pending kalır", () => {
    expect(aggregateRequestStatus(["approved", "pending"])).toBe("pending");
  });

  it("hedef süresi dolmuşsa talep expired olur (ret yoksa)", () => {
    expect(aggregateRequestStatus(["approved", "expired"])).toBe("expired");
  });

  it("hedefi olmayan talep geçersizdir", () => {
    expect(() => aggregateRequestStatus([])).toThrow();
  });
});

describe("karar yetkisi (2, 5.4 adım 3-4 ve 7)", () => {
  it("patron karar verebilir, basis content", () => {
    expect(canDecide(patron, requester.id, true)).toEqual({ allowed: true, basis: "content" });
  });

  it("patron yoksa sistem yöneticisi meta veriyle karar verebilir", () => {
    expect(canDecide(sysAdmin, requester.id, false)).toEqual({ allowed: true, basis: "meta" });
  });

  it("aktif patron varken sistem yöneticisi karar veremez", () => {
    expect(canDecide(sysAdmin, requester.id, true)).toEqual({ allowed: false, code: "FORBIDDEN" });
  });

  it("birim yöneticisi (sıradan çalışan rolü) karar veremez", () => {
    expect(canDecide(colleague, requester.id, true)).toEqual({ allowed: false, code: "FORBIDDEN" });
  });

  it("talep eden kendi talebine karar veremez, patron olsa bile", () => {
    const selfPatron = user({ id: "p", role: "executive" });
    expect(canDecide(selfPatron, "p", true)).toEqual({ allowed: false, code: "SELF_DECISION_FORBIDDEN" });
  });

  it("pasif patron karar veremez", () => {
    const inactive = user({ id: "p", role: "executive", isActive: false });
    expect(canDecide(inactive, requester.id, true)).toEqual({ allowed: false, code: "ACCOUNT_INACTIVE" });
  });

  it("kapalı talep ya da hedefte karar verilemez (REQUEST_NOT_PENDING)", () => {
    expect(
      canDecideTarget({
        actor: patron,
        requesterId: requester.id,
        requestStatus: "rejected",
        targetStatus: "pending",
        hasActiveExecutive: true,
      }),
    ).toEqual({ allowed: false, code: "REQUEST_NOT_PENDING" });
    expect(
      canDecideTarget({
        actor: patron,
        requesterId: requester.id,
        requestStatus: "pending",
        targetStatus: "approved",
        hasActiveExecutive: true,
      }),
    ).toEqual({ allowed: false, code: "REQUEST_NOT_PENDING" });
  });

  it("yetkisiz kullanıcı, durum ne olursa olsun önce yetki hatası alır (403 öncelikli)", () => {
    expect(
      canDecideTarget({
        actor: colleague,
        requesterId: requester.id,
        requestStatus: "rejected",
        targetStatus: "approved",
        hasActiveExecutive: true,
      }),
    ).toEqual({ allowed: false, code: "FORBIDDEN" });
  });
});

describe("karar öncesi içerik (K3)", () => {
  it("patron, hedef pending iken içeriği okuyabilir", () => {
    expect(canReadTargetContent(patron, requester.id, "pending")).toEqual({ allowed: true });
  });

  it("birim yöneticisi (çalışan) içeriği okuyamaz", () => {
    expect(canReadTargetContent(colleague, requester.id, "pending")).toEqual({
      allowed: false,
      code: "CONTENT_NOT_VISIBLE",
    });
  });

  it("sistem yöneticisi içeriği okuyamaz (yalnızca meta)", () => {
    expect(canReadTargetContent(sysAdmin, requester.id, "pending")).toEqual({
      allowed: false,
      code: "CONTENT_NOT_VISIBLE",
    });
  });

  it("hedef artık pending değilse patron bile okuyamaz", () => {
    expect(canReadTargetContent(patron, requester.id, "approved")).toEqual({
      allowed: false,
      code: "CONTENT_NOT_VISIBLE",
    });
  });

  it("talep eden, patron olsa bile kendi talebinin karar öncesi içeriğini okuyamaz", () => {
    const selfPatron = user({ id: "p", role: "executive" });
    expect(canReadTargetContent(selfPatron, "p", "pending")).toEqual({
      allowed: false,
      code: "CONTENT_NOT_VISIBLE",
    });
  });
});

describe("onaylı talepte içerik (5.4 adım 5)", () => {
  const accessEnd = minutesAfter(24 * 60);

  it("talep eden, süre içinde okuyabilir", () => {
    expect(canReadApprovedContent(requester, requester.id, "approved", accessEnd, T0)).toEqual({ allowed: true });
  });

  it("süre dolunca ACCESS_WINDOW_EXPIRED", () => {
    expect(canReadApprovedContent(requester, requester.id, "approved", accessEnd, minutesAfter(24 * 60 + 1))).toEqual({
      allowed: false,
      code: "ACCESS_WINDOW_EXPIRED",
    });
  });

  it("talep onaylı değilse içerik görünmez", () => {
    expect(canReadApprovedContent(requester, requester.id, "pending", accessEnd, T0)).toEqual({
      allowed: false,
      code: "CONTENT_NOT_VISIBLE",
    });
  });

  it("başka bir kullanıcı onaylı talebin içeriğini okuyamaz", () => {
    expect(canReadApprovedContent(colleague, requester.id, "approved", accessEnd, T0)).toEqual({
      allowed: false,
      code: "FORBIDDEN",
    });
  });
});

describe("gerekçe (Ç26)", () => {
  it("19 karakter reddedilir", () => {
    expect(validateReason("a".repeat(19))).toEqual({ allowed: false, code: "REASON_TOO_SHORT" });
  });

  it("tam 20 karakter kabul edilir", () => {
    expect(validateReason("a".repeat(20))).toEqual({ allowed: true });
  });

  it("yalnızca boşluktan oluşan gerekçe kırpılır ve reddedilir", () => {
    expect(validateReason(" ".repeat(30))).toEqual({ allowed: false, code: "REASON_TOO_SHORT" });
  });
});
