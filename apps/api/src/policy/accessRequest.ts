import type { ErrorCode } from "@beyaz-ofis/core";
import { allow, deny, type Decision, type PolicyUser } from "./types";

export type TargetStatus = "pending" | "approved" | "rejected" | "expired";
export type RequestStatus = "pending" | "approved" | "rejected" | "withdrawn" | "expired";

// Ç26: erişim talebi gerekçesi en az 20 karakter.
export const MIN_REASON_LENGTH = 20;

export type DecideResult = { allowed: true; basis: "content" | "meta" } | { allowed: false; code: ErrorCode };

// §5.4 adım 5-6: herhangi bir hedef reddederse talep reddedilir. Tüm hedefler onaylarsa talep onaylanır.
// Diğer durumda talep beklemededir (§5.4 son paragraf).
export function aggregateRequestStatus(targets: TargetStatus[]): RequestStatus {
  if (targets.length === 0) throw new Error("Talepte en az bir hedef olmalı");
  if (targets.includes("rejected")) return "rejected";
  if (targets.includes("expired")) return "expired";
  if (targets.every((t) => t === "approved")) return "approved";
  return "pending";
}

// Yetkilendirme (kimin karar verebileceği): patron içerikle, patron yokken sistem yöneticisi meta veriyle (§2, §5.4).
// Onaylayan ile talep eden aynı kişi olamaz (§5.4 adım 7).
export function canDecide(actor: PolicyUser, requesterId: string, hasActiveExecutive: boolean): DecideResult {
  if (!actor.isActive || actor.deleted) return { allowed: false, code: "ACCOUNT_INACTIVE" };
  if (actor.id === requesterId) return { allowed: false, code: "SELF_DECISION_FORBIDDEN" };
  if (actor.role === "executive") return { allowed: true, basis: "content" };
  if (actor.role === "system_admin" && !hasActiveExecutive) return { allowed: true, basis: "meta" };
  return { allowed: false, code: "FORBIDDEN" };
}

export interface TargetDecisionInput {
  actor: PolicyUser;
  requesterId: string;
  requestStatus: RequestStatus;
  targetStatus: TargetStatus;
  hasActiveExecutive: boolean;
}

// Hedef kararı: önce yetki (403), sonra durum (409). Kapalı talep ya da hedefte karar verilmez.
export function canDecideTarget(i: TargetDecisionInput): DecideResult {
  const auth = canDecide(i.actor, i.requesterId, i.hasActiveExecutive);
  if (!auth.allowed) return auth;
  if (i.requestStatus !== "pending" || i.targetStatus !== "pending") {
    return { allowed: false, code: "REQUEST_NOT_PENDING" };
  }
  return auth;
}

// K3: karar öncesi içeriği yalnızca patron okur, hedef pending iken. Talep eden kendi talebini okuyamaz.
// Erişim reddi 403 (CONTENT_NOT_VISIBLE) olarak döner, OpenAPI ile uyumlu.
export function canReadTargetContent(
  actor: PolicyUser,
  requesterId: string,
  targetStatus: TargetStatus,
): Decision {
  if (!actor.isActive || actor.deleted) return deny("ACCOUNT_INACTIVE");
  if (actor.role !== "executive") return deny("CONTENT_NOT_VISIBLE");
  if (actor.id === requesterId) return deny("CONTENT_NOT_VISIBLE");
  if (targetStatus !== "pending") return deny("CONTENT_NOT_VISIBLE");
  return allow();
}

// §5.4 adım 5: onaylı talepte içeriği yalnızca talep eden okur, access_expires_at süresince.
export function canReadApprovedContent(
  actor: PolicyUser,
  requesterId: string,
  requestStatus: RequestStatus,
  accessExpiresAtDate: Date,
  now: Date,
): Decision {
  if (!actor.isActive || actor.deleted) return deny("ACCOUNT_INACTIVE");
  if (actor.id !== requesterId) return deny("FORBIDDEN");
  if (requestStatus !== "approved") return deny("CONTENT_NOT_VISIBLE");
  if (now.getTime() >= accessExpiresAtDate.getTime()) return deny("ACCESS_WINDOW_EXPIRED");
  return allow();
}

// Ç26: gerekçe kontrolü (kırpılmış uzunluk).
export function validateReason(reason: string): Decision {
  return reason.trim().length >= MIN_REASON_LENGTH ? allow() : deny("REASON_TOO_SHORT");
}
