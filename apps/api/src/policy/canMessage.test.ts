import { canMessage } from "./canMessage";
import { link, user } from "./fixtures";

describe("canMessage (5.1)", () => {
  it("aynı şirketteki iki aktif kullanıcı birbirine yazabilir", () => {
    const a = user({ id: "a", companyIds: [1] });
    const b = user({ id: "b", companyIds: [1] });
    expect(canMessage(a, b, [])).toEqual({ allowed: true });
  });

  it("gönderen pasifse ACCOUNT_INACTIVE", () => {
    const a = user({ id: "a", isActive: false });
    const b = user({ id: "b" });
    expect(canMessage(a, b, [])).toEqual({ allowed: false, code: "ACCOUNT_INACTIVE" });
  });

  it("gönderen silinmişse ACCOUNT_INACTIVE", () => {
    const a = user({ id: "a", deleted: true });
    const b = user({ id: "b" });
    expect(canMessage(a, b, [])).toEqual({ allowed: false, code: "ACCOUNT_INACTIVE" });
  });

  it("hedef pasifse TARGET_INACTIVE", () => {
    const a = user({ id: "a" });
    const b = user({ id: "b", isActive: false });
    expect(canMessage(a, b, [])).toEqual({ allowed: false, code: "TARGET_INACTIVE" });
  });

  it("farklı şirket ve aktif bağlantı varsa izin verir (sıra bağımsız)", () => {
    const a = user({ id: "a", companyIds: [2] });
    const b = user({ id: "b", companyIds: [1] });
    expect(canMessage(a, b, [link(1, 2)])).toEqual({ allowed: true });
  });

  it("farklı şirket, bağlantı yoksa NO_COMPANY_LINK", () => {
    const a = user({ id: "a", companyIds: [1] });
    const b = user({ id: "b", companyIds: [2] });
    expect(canMessage(a, b, [])).toEqual({ allowed: false, code: "NO_COMPANY_LINK" });
  });

  it("farklı şirket, yalnızca kapatılmış bağlantı varsa COMPANY_LINK_REVOKED", () => {
    const a = user({ id: "a", companyIds: [1] });
    const b = user({ id: "b", companyIds: [2] });
    expect(canMessage(a, b, [link(1, 2, true)])).toEqual({ allowed: false, code: "COMPANY_LINK_REVOKED" });
  });

  it("aynı çiftte hem kapatılmış hem aktif bağlantı varsa izin verir", () => {
    const a = user({ id: "a", companyIds: [1] });
    const b = user({ id: "b", companyIds: [2] });
    expect(canMessage(a, b, [link(1, 2, true), link(1, 2, false)])).toEqual({ allowed: true });
  });

  it("birden fazla şirketi olan kullanıcı, herhangi bir çiftte aktif bağlantıyla yazabilir", () => {
    const a = user({ id: "a", companyIds: [1, 3] });
    const b = user({ id: "b", companyIds: [4] });
    expect(canMessage(a, b, [link(3, 4)])).toEqual({ allowed: true });
  });

  it("aynı birimde olmak yetki vermez, yalnızca şirket belirler", () => {
    const a = user({ id: "a", companyIds: [1] });
    const b = user({ id: "b", companyIds: [2] });
    expect(canMessage(a, b, []).allowed).toBe(false);
  });

  it("şirketi olmayan kullanıcı farklı şirkete yazamaz", () => {
    const a = user({ id: "a", companyIds: [] });
    const b = user({ id: "b", companyIds: [2] });
    expect(canMessage(a, b, [link(1, 2)])).toEqual({ allowed: false, code: "NO_COMPANY_LINK" });
  });
});
