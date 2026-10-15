import type { ErrorCode } from "@beyaz-ofis/core";
import type { Decision } from "./policy/types.js";

// Kapalı katalog (K6) için HTTP durum kodları, spec 9.1 ile birebir.
const STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  INVITATION_INVALID: 400,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  REFRESH_TOKEN_REUSED: 401,
  FORBIDDEN: 403,
  FORBIDDEN_NOT_MEMBER: 403,
  ACCOUNT_INACTIVE: 403,
  TARGET_INACTIVE: 403,
  NO_COMPANY_LINK: 403,
  COMPANY_LINK_REVOKED: 403,
  SELF_DECISION_FORBIDDEN: 403,
  CONTENT_NOT_VISIBLE: 403,
  NOT_FOUND: 404,
  CONTEXT_CHOICE_REQUIRED: 409,
  CONTEXT_LOCKED: 409,
  ALREADY_MEMBER: 409,
  EDIT_WINDOW_CLOSED: 409,
  MESSAGE_DELETED: 409,
  REQUEST_NOT_PENDING: 409,
  DEPARTMENT_CHANNEL_EXISTS: 409,
  ACCESS_WINDOW_EXPIRED: 410,
  TARGET_NOT_IN_CONVERSATION: 422,
  REASON_TOO_SHORT: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

const MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: "İstek doğrulanamadı.",
  INVITATION_INVALID: "Davet geçersiz, kullanılmış ya da süresi dolmuş.",
  UNAUTHENTICATED: "Kimlik doğrulanamadı.",
  TOKEN_EXPIRED: "Oturumun süresi doldu.",
  REFRESH_TOKEN_REUSED: "Oturum güvenlik nedeniyle kapatıldı.",
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
  FORBIDDEN_NOT_MEMBER: "Bu konuşmanın üyesi değilsiniz.",
  ACCOUNT_INACTIVE: "Hesap pasif.",
  TARGET_INACTIVE: "Hedef kullanıcı pasif.",
  NO_COMPANY_LINK: "Şirketler arasında aktif bağlantı yok.",
  COMPANY_LINK_REVOKED: "Şirketler arası bağlantı kapatılmış.",
  SELF_DECISION_FORBIDDEN: "Kendi talebiniz hakkında karar veremezsiniz.",
  CONTENT_NOT_VISIBLE: "Bu içeriği görme yetkiniz yok.",
  NOT_FOUND: "Bulunamadı.",
  CONTEXT_CHOICE_REQUIRED: "Şirket bağlamı seçilmelidir.",
  CONTEXT_LOCKED: "Konuşma bağlamı kilitli.",
  ALREADY_MEMBER: "Kişi bu konuşmada zaten aktif.",
  EDIT_WINDOW_CLOSED: "Düzenleme süresi doldu.",
  MESSAGE_DELETED: "Mesaj silinmiş.",
  REQUEST_NOT_PENDING: "Talep ya da ticket artık beklemede değil.",
  DEPARTMENT_CHANNEL_EXISTS: "Bu birimin aktif kanalı zaten var.",
  ACCESS_WINDOW_EXPIRED: "Erişim süresi doldu.",
  TARGET_NOT_IN_CONVERSATION: "Hedef birim konuşmada yok.",
  REASON_TOO_SHORT: "Gerekçe en az 20 karakter olmalı.",
  RATE_LIMITED: "Çok fazla istek. Lütfen bekleyin.",
  INTERNAL_ERROR: "Beklenmeyen bir hata oluştu.",
};

export class ApiError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message?: string,
    // Ek alanlar (ör. CONTEXT_CHOICE_REQUIRED için context_options) yanıtın üst seviyesine eklenir.
    readonly extra?: Record<string, unknown>,
    readonly retryAfterSeconds?: number,
  ) {
    super(message ?? MESSAGES[code]);
    this.name = "ApiError";
    this.status = STATUS[code];
  }
}

// Politika kararını hataya çevirir. İzin verilmişse hiçbir şey yapmaz.
export function enforce(decision: Decision): void {
  if (!decision.allowed) throw new ApiError(decision.code);
}
