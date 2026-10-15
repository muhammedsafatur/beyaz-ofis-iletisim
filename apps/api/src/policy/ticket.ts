import { allow, deny, MINUTE, type Decision, type PolicyUser } from "./types";
import { canDecide, type DecideResult, type RequestStatus } from "./accessRequest";

// §5.5 ticket durumu (erişim talebiyle aynı değer kümesi, tickets.status).
export type TicketStatus = RequestStatus;

export interface TicketState {
  requesterId: string;
  status: TicketStatus;
  createdAt: Date;
}

// Ç12: düzenleme yalnızca karar verilmeden önce ve açıldıktan sonra 15 dakika içinde.
export const TICKET_EDIT_WINDOW_MS = 15 * MINUTE;

export function canEditTicket(t: TicketState, actor: PolicyUser, now: Date): Decision {
  if (!actor.isActive || actor.deleted) return deny("ACCOUNT_INACTIVE");
  if (actor.id !== t.requesterId) return deny("FORBIDDEN");
  if (t.status !== "pending") return deny("EDIT_WINDOW_CLOSED");
  if (now.getTime() - t.createdAt.getTime() > TICKET_EDIT_WINDOW_MS) return deny("EDIT_WINDOW_CLOSED");
  return allow();
}

// §5.5: ticket kararı patron havuzundadır (K5). Ticket beklemedeyse ve yetki uygunsa karar verilir.
export function canDecideTicket(t: TicketState, actor: PolicyUser, hasActiveExecutive: boolean): DecideResult {
  const auth = canDecide(actor, t.requesterId, hasActiveExecutive);
  if (!auth.allowed) return auth;
  if (t.status !== "pending") return { allowed: false, code: "REQUEST_NOT_PENDING" };
  return auth;
}

// §5.5: yalnızca karar verilmeden önce talep eden geri çekebilir.
export function canWithdrawTicket(t: TicketState, actor: PolicyUser): Decision {
  if (!actor.isActive || actor.deleted) return deny("ACCOUNT_INACTIVE");
  if (actor.id !== t.requesterId) return deny("FORBIDDEN");
  if (t.status !== "pending") return deny("REQUEST_NOT_PENDING");
  return allow();
}
