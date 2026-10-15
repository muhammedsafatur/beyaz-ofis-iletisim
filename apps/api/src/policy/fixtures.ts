import type { CompanyLink, PolicyUser } from "./types";

// Test verisi: kısa, okunaklı kimlikler.
export const user = (over: Partial<PolicyUser> & { id: string }): PolicyUser => ({
  role: "employee",
  isActive: true,
  deleted: false,
  companyIds: [1],
  ...over,
});

export const link = (low: number, high: number, revoked = false): CompanyLink => ({ low, high, revoked });

export const T0 = new Date("2026-10-15T10:00:00Z");
export const minutesAfter = (m: number) => new Date(T0.getTime() + m * 60_000);
