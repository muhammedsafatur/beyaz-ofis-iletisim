import { applyMention, mentionQuery, mentionSuggestions, resolveMentions } from "./mentions";
import type { UserSummary } from "./types";

const u = (id: string, first: string, last: string): UserSummary => ({
  user_id: id,
  first_name: first,
  last_name: last,
  job_title: null,
  is_active: true,
});

const members = [u("me", "Ali", "Yılmaz"), u("a1", "Ayşe", "Kaya"), u("p1", "Mehmet", "Demir"), u("i1", "İsmail", "Şahin")];

describe("@ anma önerileri", () => {
  it("imleç önündeki sorguyu bulur", () => {
    expect(mentionQuery("merhaba @Ayş")).toBe("Ayş");
    expect(mentionQuery("@")).toBe("");
    expect(mentionQuery("boşluklu @Ayşe Kaya ")).toBeNull();
    expect(mentionQuery("düz metin")).toBeNull();
  });

  it("ad, soyad ya da tam adla eşleşir; gönderen önerilmez", () => {
    expect(mentionSuggestions("@Ayş", members, "me").map((x) => x.user_id)).toEqual(["a1"]);
    expect(mentionSuggestions("@Kay", members, "me").map((x) => x.user_id)).toEqual(["a1"]);
    expect(mentionSuggestions("@Ali", members, "me")).toEqual([]);
  });

  it("büyük küçük harf ve Türkçe karakterlerde eşleşir", () => {
    expect(mentionSuggestions("@ayş", members, "me").map((x) => x.user_id)).toEqual(["a1"]);
    expect(mentionSuggestions("@İsm", members, "me").map((x) => x.user_id)).toEqual(["i1"]);
  });

  it("yalnızca @ yazılınca tüm üyeler (en fazla 5) önerilir", () => {
    expect(mentionSuggestions("@", members, "me").map((x) => x.user_id)).toEqual(["a1", "p1", "i1"]);
  });

  it("öneri yoksa boş döner", () => {
    expect(mentionSuggestions("merhaba", members, "me")).toEqual([]);
  });
});

describe("@ anma uygulama ve çözümleme", () => {
  it("seçilen kişi imleç önündeki sorgunun yerine tam adıyla yazılır", () => {
    expect(applyMention("merhaba @Ayş", members[1]!)).toBe("merhaba @Ayşe Kaya ");
  });

  it("gönderimde yalnızca metinde adı geçen seçimler anma olur", () => {
    const picked = [members[1]!, members[2]!];
    expect(resolveMentions("@Ayşe Kaya selam", picked)).toEqual(["a1"]);
    expect(resolveMentions("selam", picked)).toEqual([]);
  });
});
