import { canDecideTicket, canEditTicket, canWithdrawTicket } from "./ticket";
import { minutesAfter, T0, user } from "./fixtures";

const requester = user({ id: "r" });
const patron = user({ id: "p", role: "executive" });
const colleague = user({ id: "c" });
const sysAdmin = user({ id: "s", role: "system_admin" });
const open = { requesterId: "r", status: "pending" as const, createdAt: T0 };

describe("ticket düzenleme penceresi (Ç12)", () => {
  it("açıldıktan hemen sonra talep eden düzenleyebilir", () => {
    expect(canEditTicket(open, requester, minutesAfter(1))).toEqual({ allowed: true });
  });

  it("15 dakika sınırında hâlâ düzenlenebilir", () => {
    expect(canEditTicket(open, requester, minutesAfter(15))).toEqual({ allowed: true });
  });

  it("15 dakikadan sonra EDIT_WINDOW_CLOSED", () => {
    expect(canEditTicket(open, requester, minutesAfter(16))).toEqual({
      allowed: false,
      code: "EDIT_WINDOW_CLOSED",
    });
  });

  it("karar verilmişse pencere içinde bile düzenlenemez", () => {
    const decided = { ...open, status: "approved" as const };
    expect(canEditTicket(decided, requester, minutesAfter(1))).toEqual({
      allowed: false,
      code: "EDIT_WINDOW_CLOSED",
    });
  });

  it("başkası düzenleyemez", () => {
    expect(canEditTicket(open, colleague, minutesAfter(1))).toEqual({ allowed: false, code: "FORBIDDEN" });
  });
});

describe("ticket kararı (5.5, K5)", () => {
  it("patron bekleyen ticket'a karar verir, basis content", () => {
    expect(canDecideTicket(open, patron, true)).toEqual({ allowed: true, basis: "content" });
  });

  it("patron yoksa sistem yöneticisi meta veriyle karar verir", () => {
    expect(canDecideTicket(open, sysAdmin, false)).toEqual({ allowed: true, basis: "meta" });
  });

  it("birim yöneticisi (çalışan) ticket kararı veremez", () => {
    expect(canDecideTicket(open, colleague, true)).toEqual({ allowed: false, code: "FORBIDDEN" });
  });

  it("talep eden kendi ticket'ını onaylayamaz", () => {
    const selfPatron = user({ id: "r", role: "executive" });
    expect(canDecideTicket(open, selfPatron, true)).toEqual({ allowed: false, code: "SELF_DECISION_FORBIDDEN" });
  });

  it("ikinci karar REQUEST_NOT_PENDING (ticket başına tek karar)", () => {
    const decided = { ...open, status: "approved" as const };
    expect(canDecideTicket(decided, patron, true)).toEqual({ allowed: false, code: "REQUEST_NOT_PENDING" });
  });
});

describe("ticket geri çekme (5.5)", () => {
  it("talep eden, karar verilmeden önce geri çekebilir", () => {
    expect(canWithdrawTicket(open, requester)).toEqual({ allowed: true });
  });

  it("karar verildikten sonra geri çekilemez", () => {
    const decided = { ...open, status: "rejected" as const };
    expect(canWithdrawTicket(decided, requester)).toEqual({ allowed: false, code: "REQUEST_NOT_PENDING" });
  });

  it("başkası geri çekemez", () => {
    expect(canWithdrawTicket(open, patron)).toEqual({ allowed: false, code: "FORBIDDEN" });
  });
});
