// Ticket ve talep durumlarının Türkçe karşılığı. Masaüstü ve mobil aynı metinleri kullanır.
export function statusLabelTr(status: string): string {
  switch (status) {
    case "pending":
      return "beklemede";
    case "approved":
      return "onaylandı";
    case "rejected":
      return "reddedildi";
    case "withdrawn":
      return "geri çekildi";
    case "expired":
      return "süresi doldu";
    default:
      return status;
  }
}
