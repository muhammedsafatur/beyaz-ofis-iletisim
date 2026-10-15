import { allow, deny, type CompanyLink, type Decision, type PolicyUser } from "./types";

// §5.1 canMessage(sender, target). Birim ve lokasyon yetkiyi belirlemez.
export function canMessage(sender: PolicyUser, target: PolicyUser, links: CompanyLink[]): Decision {
  if (!sender.isActive || sender.deleted) return deny("ACCOUNT_INACTIVE");
  if (!target.isActive || target.deleted) return deny("TARGET_INACTIVE");

  // Aynı şirket: izin
  if (sender.companyIds.some((c) => target.companyIds.includes(c))) return allow();

  // Şirketler farklı: iki taraf şirketi arasında aktif bir bağlantı gerekir
  const pairs: [number, number][] = [];
  for (const a of sender.companyIds) {
    for (const b of target.companyIds) {
      pairs.push([Math.min(a, b), Math.max(a, b)]);
    }
  }
  const activeLink = (low: number, high: number) =>
    links.some((l) => l.low === low && l.high === high && !l.revoked);
  const anyLink = (low: number, high: number) =>
    links.some((l) => l.low === low && l.high === high);

  if (pairs.some(([low, high]) => activeLink(low, high))) return allow();
  // Yalnızca kapatılmış bağlantı varsa daha açıklayıcı hata
  if (pairs.some(([low, high]) => anyLink(low, high))) return deny("COMPANY_LINK_REVOKED");
  return deny("NO_COMPANY_LINK");
}
