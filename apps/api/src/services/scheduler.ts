import { and, eq, inArray, lte } from "drizzle-orm";
import { accessRequests, accessRequestTargets, tickets } from "@beyaz-ofis/db-schema";
import type { Ctx } from "./common.js";

// §5.4 adım 8, §5.5: karar verilmeyen talep ve ticket'lar expires_at sonunda kapanır.
// Süresi dolan talebin bekleyen hedefleri de expired olur. Erişim süresi okuma anında kontrol edilir.
export async function expireDue(ctx: Ctx): Promise<{ requests: number; tickets: number }> {
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const dueRequests = await tx
      .select({ id: accessRequests.requestId })
      .from(accessRequests)
      .where(and(eq(accessRequests.status, "pending"), lte(accessRequests.expiresAt, now)));
    if (dueRequests.length) {
      const ids = dueRequests.map((r) => r.id);
      await tx
        .update(accessRequests)
        .set({ status: "expired", closedAt: now })
        .where(inArray(accessRequests.requestId, ids));
      await tx
        .update(accessRequestTargets)
        .set({ status: "expired" })
        .where(and(inArray(accessRequestTargets.requestId, ids), eq(accessRequestTargets.status, "pending")));
    }
    const dueTickets = await tx
      .update(tickets)
      .set({ status: "expired", closedAt: now, updatedAt: now })
      .where(and(eq(tickets.status, "pending"), lte(tickets.expiresAt, now)))
      .returning({ id: tickets.ticketId });
    return { requests: dueRequests.length, tickets: dueTickets.length };
  });
}
