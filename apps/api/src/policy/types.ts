import type { ErrorCode } from "@beyaz-ofis/core";

// Politika kararı: izin ya da kapalı katalogdan bir hata kodu (K6).
export type Decision = { allowed: true } | { allowed: false; code: ErrorCode };

export const allow = (): Decision => ({ allowed: true });
export const deny = (code: ErrorCode): Decision => ({ allowed: false, code });

export type Role = "employee" | "system_admin" | "executive";

// Politikanın gördüğü kullanıcı. companyIds, birimlerden türetilir (§3.2).
export interface PolicyUser {
  id: string;
  role: Role;
  isActive: boolean;
  deleted: boolean;
  companyIds: number[];
}

// company_links satırının politika görünümü (§3.1). low < high.
export interface CompanyLink {
  low: number;
  high: number;
  revoked: boolean;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
