import { allow, deny, MINUTE, HOUR, type Decision, type PolicyUser } from "./types";

// §6 mesaj düzenleme ve silme penceresi: gönderimden sonra 15 dakika.
export const MESSAGE_EDIT_WINDOW_MS = 15 * MINUTE;

export interface MessageState {
  senderId: string;
  sentAt: Date;
  deleted: boolean;
}

// Düzenleme ve silme aynı kuralı kullanır (§6).
export function canChangeMessage(m: MessageState, actor: PolicyUser, now: Date): Decision {
  if (!actor.isActive || actor.deleted) return deny("ACCOUNT_INACTIVE");
  if (actor.id !== m.senderId) return deny("FORBIDDEN");
  if (m.deleted) return deny("MESSAGE_DELETED");
  if (now.getTime() - m.sentAt.getTime() > MESSAGE_EDIT_WINDOW_MS) return deny("EDIT_WINDOW_CLOSED");
  return allow();
}

// §5.4 adım 8 ve §5.5: karar verilmeyen talep ya da ticket expires_at sonunda kapanır.
// Süre sunucu saatiyle hesaplanır; expiryHours approval_rules.request_expiry_hours değeridir (varsayılan 72).
export function expiresAt(createdAt: Date, expiryHours: number): Date {
  return new Date(createdAt.getTime() + expiryHours * HOUR);
}

// Bekleyen kayıt süresi dolduysa kapanmalı. Karar verilmiş kayıtlar için çağrılmaz.
export function isExpired(expiresAtDate: Date, now: Date): boolean {
  return now.getTime() >= expiresAtDate.getTime();
}

// §5.4 adım 5: onay sonrası içerik erişim süresi. accessWindowHours approval_rules.access_window_hours (varsayılan 24).
export function accessExpiresAt(approvedAt: Date, accessWindowHours: number): Date {
  return new Date(approvedAt.getTime() + accessWindowHours * HOUR);
}
