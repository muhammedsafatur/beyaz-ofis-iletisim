import type { UserSummary } from "./types";

// @ anma yardımcıları. Masaüstü ve mobil aynı mantığı kullanır (tek kaynak).

// Imleç hemen önündeki "@sorgu" parçasını döndürür; yoksa null.
export function mentionQuery(text: string): string | null {
  const m = /@([^\s@]*)$/.exec(text);
  return m ? m[1]! : null;
}

// Önerilen üyeler: ad, soyad ya da tam ad sorguyla başlıyorsa. Gönderen önerilmez.
export function mentionSuggestions(text: string, members: UserSummary[], meId: string, limit = 5): UserSummary[] {
  const query = mentionQuery(text);
  if (query === null) return [];
  const needle = query.toLocaleLowerCase("tr");
  const starts = (value: string) => value.toLocaleLowerCase("tr").startsWith(needle);
  return members
    .filter((u) => u.user_id !== meId)
    .filter((u) => needle === "" || starts(`${u.first_name} ${u.last_name}`) || starts(u.first_name) || starts(u.last_name))
    .slice(0, limit);
}

// Seçilen kişiyi imleç önündeki "@sorgu" yerine yazar.
export function applyMention(text: string, user: UserSummary): string {
  return text.replace(/@([^\s@]*)$/, `@${user.first_name} ${user.last_name} `);
}

// Gönderilecek anma kimlikleri: yalnızca metinde adı hâlâ geçen seçilmiş kişiler.
export function resolveMentions(content: string, picked: UserSummary[]): string[] {
  return picked.filter((u) => content.includes(`@${u.first_name} ${u.last_name}`)).map((u) => u.user_id);
}
