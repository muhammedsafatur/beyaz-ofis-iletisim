import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  approvalRules,
  companies,
  companyLinks,
  conversationMembers,
  conversations,
  departmentManagers,
  departments,
  locations,
  userDepartments,
  userLocations,
  users,
} from "@beyaz-ofis/db-schema";
import { ApiError } from "../errors.js";
import { createInvitation, logoutAll, UNUSABLE_PASSWORD_HASH } from "./auth.js";
import {
  appendMessage,
  audit,
  loadRules,
  loadUser,
  requireSystemAdmin,
  userSummary,
  type Actor,
  type Ctx,
} from "./common.js";
import { getUserRow, userOut } from "./people.js";

// Yardımcı: birimlerin var olduğunu ve silinmediğini doğrular.
async function assertDepartments(ctx: Ctx, ids: number[]) {
  if (ids.length === 0) return;
  const found = await ctx.db
    .select({ id: departments.departmentId })
    .from(departments)
    .where(and(inArray(departments.departmentId, ids), isNull(departments.deletedAt)));
  if (found.length !== new Set(ids).size) throw new ApiError("VALIDATION_FAILED", "Birim bulunamadı.");
}

async function assertLocations(ctx: Ctx, ids: number[]) {
  if (ids.length === 0) return;
  const found = await ctx.db
    .select({ id: locations.locationId })
    .from(locations)
    .where(and(inArray(locations.locationId, ids), isNull(locations.deletedAt)));
  if (found.length !== new Set(ids).size) throw new ApiError("VALIDATION_FAILED", "Lokasyon bulunamadı.");
}

// Benzersiz ad ihlali (aktif kayıtlar için partial unique) doğrulama hatası olarak döner.
function translateUnique(e: unknown, message: string): never {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  if (code === "23505") throw new ApiError("VALIDATION_FAILED", message);
  throw e;
}

export async function createUser(
  ctx: Ctx,
  actor: Actor,
  body: { first_name: string; last_name: string; email: string; job_title?: string; department_ids?: number[]; location_ids?: number[] },
) {
  requireSystemAdmin(actor);
  const departmentIds = body.department_ids ?? [];
  const locationIds = body.location_ids ?? [];
  await assertDepartments(ctx, departmentIds);
  await assertLocations(ctx, locationIds);
  const now = ctx.now();
  const row = await ctx.db.transaction(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({
        firstName: body.first_name,
        lastName: body.last_name,
        email: body.email,
        passwordHash: UNUSABLE_PASSWORD_HASH,
        jobTitle: body.job_title ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .catch((e) => translateUnique(e, "Bu e-posta zaten kayıtlı."));
    if (!u) throw new ApiError("INTERNAL_ERROR");
    if (departmentIds.length) {
      await tx.insert(userDepartments).values(departmentIds.map((d) => ({ userId: u.userId, departmentId: d })));
    }
    if (locationIds.length) {
      await tx.insert(userLocations).values(locationIds.map((l) => ({ userId: u.userId, locationId: l })));
    }
    return u;
  });
  await createInvitation(ctx, row.userId, row.email, actor.id);
  await audit(ctx.db, actor.id, "user", row.userId, "create", undefined, {
    first_name: row.firstName,
    last_name: row.lastName,
    department_ids: departmentIds,
  });
  return userOut(ctx, row);
}

export async function updateUser(
  ctx: Ctx,
  actor: Actor,
  userId: string,
  body: { role?: "employee" | "executive"; first_name?: string; last_name?: string; job_title?: string; department_ids?: number[]; location_ids?: number[] },
) {
  requireSystemAdmin(actor);
  const before = await getUserRow(ctx, userId);
  if (body.department_ids) await assertDepartments(ctx, body.department_ids);
  if (body.location_ids) await assertLocations(ctx, body.location_ids);
  const patch: Partial<typeof users.$inferInsert> = { updatedAt: ctx.now() };
  if (body.first_name !== undefined) patch.firstName = body.first_name;
  if (body.last_name !== undefined) patch.lastName = body.last_name;
  if (body.job_title !== undefined) patch.jobTitle = body.job_title;
  if (body.role !== undefined) patch.role = body.role;
  await ctx.db.transaction(async (tx) => {
    await tx.update(users).set(patch).where(eq(users.userId, userId));
    if (body.department_ids) {
      await tx.delete(userDepartments).where(eq(userDepartments.userId, userId));
      if (body.department_ids.length) {
        await tx.insert(userDepartments).values(body.department_ids.map((d) => ({ userId, departmentId: d })));
      }
    }
    if (body.location_ids) {
      await tx.delete(userLocations).where(eq(userLocations.userId, userId));
      if (body.location_ids.length) {
        await tx.insert(userLocations).values(body.location_ids.map((l) => ({ userId, locationId: l })));
      }
    }
  });
  await audit(ctx.db, actor.id, "user", userId, "update",
    { first_name: before.firstName, last_name: before.lastName, job_title: before.jobTitle, role: before.role },
    { first_name: body.first_name, last_name: body.last_name, job_title: body.job_title, role: body.role, department_ids: body.department_ids, location_ids: body.location_ids });
  return userOut(ctx, await getUserRow(ctx, userId));
}

// Pasifleştirme: oturumlar kapanır (B4), aktif konuşmalardan çıkarılır, her konuşmaya sistem mesajı düşer (§5.6).
export async function deactivateUser(ctx: Ctx, actor: Actor, userId: string) {
  requireSystemAdmin(actor);
  const target = await getUserRow(ctx, userId);
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    await tx.update(users).set({ isActive: false, updatedAt: now }).where(eq(users.userId, userId));
    const memberships = await tx
      .select({ conversationId: conversationMembers.conversationId })
      .from(conversationMembers)
      .where(and(eq(conversationMembers.userId, userId), isNull(conversationMembers.leftAt)));
    for (const m of memberships) {
      await tx
        .update(conversationMembers)
        .set({ leftAt: now })
        .where(and(eq(conversationMembers.conversationId, m.conversationId), eq(conversationMembers.userId, userId)));
      await appendMessage(tx, {
        conversationId: m.conversationId,
        senderId: null,
        type: "system",
        content: `${target.firstName} ${target.lastName} ayrıldı`,
        clientMessageId: randomUUID(),
        now,
      });
    }
  });
  await logoutAll(ctx, userId);
  await audit(ctx.db, actor.id, "user", userId, "deactivate", { is_active: true }, { is_active: false });
  return userOut(ctx, await getUserRow(ctx, userId));
}

// Yeniden aktif etme: konuşmalara otomatik eklenmez, yönetici tek tek ekler (Ç19).
export async function activateUser(ctx: Ctx, actor: Actor, userId: string) {
  requireSystemAdmin(actor);
  await getUserRow(ctx, userId);
  await ctx.db.update(users).set({ isActive: true, updatedAt: ctx.now() }).where(eq(users.userId, userId));
  await audit(ctx.db, actor.id, "user", userId, "activate", { is_active: false }, { is_active: true });
  return userOut(ctx, await getUserRow(ctx, userId));
}

// Birim yöneticiliğini devreder (K5: ticket atanmaz). departmentIds verilmezse eski kullanıcının tüm birimleri.
export async function reassignManager(
  ctx: Ctx,
  actor: Actor,
  fromUserId: string,
  body: { to_user_id: string; department_ids?: number[] },
) {
  requireSystemAdmin(actor);
  const to = await loadUser(ctx.db, body.to_user_id);
  if (!to || to.deleted || !to.isActive) throw new ApiError("TARGET_INACTIVE");
  const current = await ctx.db
    .select({ departmentId: departmentManagers.departmentId })
    .from(departmentManagers)
    .where(eq(departmentManagers.userId, fromUserId));
  const ids = body.department_ids ?? current.map((c) => c.departmentId);
  const moved = current.map((c) => c.departmentId).filter((d) => ids.includes(d));
  await ctx.db.transaction(async (tx) => {
    for (const d of moved) {
      await tx
        .delete(departmentManagers)
        .where(and(eq(departmentManagers.departmentId, d), eq(departmentManagers.userId, fromUserId)));
      await tx
        .insert(departmentManagers)
        .values({ departmentId: d, userId: body.to_user_id, assignedAt: ctx.now() })
        .onConflictDoNothing();
    }
  });
  for (const d of moved) {
    await audit(ctx.db, actor.id, "department_manager", String(d), "unassign", { user_id: fromUserId });
    await audit(ctx.db, actor.id, "department_manager", String(d), "assign", undefined, { user_id: body.to_user_id });
  }
  return { reassigned_department_ids: moved };
}

export async function addDepartmentManager(ctx: Ctx, actor: Actor, departmentId: number, userId: string) {
  requireSystemAdmin(actor);
  await assertDepartments(ctx, [departmentId]);
  const target = await getUserRow(ctx, userId);
  await ctx.db
    .insert(departmentManagers)
    .values({ departmentId, userId, assignedAt: ctx.now() })
    .onConflictDoNothing();
  await audit(ctx.db, actor.id, "department_manager", String(departmentId), "assign", undefined, { user_id: target.userId });
  return { department_id: departmentId, user_id: userId };
}

export async function removeDepartmentManager(ctx: Ctx, actor: Actor, departmentId: number, userId: string) {
  requireSystemAdmin(actor);
  await ctx.db
    .delete(departmentManagers)
    .where(and(eq(departmentManagers.departmentId, departmentId), eq(departmentManagers.userId, userId)));
  await audit(ctx.db, actor.id, "department_manager", String(departmentId), "unassign", { user_id: userId });
}

// --- Şirket, birim, lokasyon yönetimi (Ç18) ---

export async function createCompany(ctx: Ctx, actor: Actor, name: string) {
  requireSystemAdmin(actor);
  const [c] = await ctx.db
    .insert(companies)
    .values({ name, createdAt: ctx.now(), updatedAt: ctx.now() })
    .returning()
    .catch((e) => translateUnique(e, "Bu şirket adı zaten var."));
  if (!c) throw new ApiError("INTERNAL_ERROR");
  await audit(ctx.db, actor.id, "company", String(c.companyId), "create", undefined, { name });
  return { company_id: c.companyId, name: c.name, is_active: c.isActive };
}

export async function updateCompany(ctx: Ctx, actor: Actor, id: number, body: { name?: string; is_active?: boolean }) {
  requireSystemAdmin(actor);
  const patch: Partial<typeof companies.$inferInsert> = { updatedAt: ctx.now() };
  if (body.name !== undefined) patch.name = body.name;
  if (body.is_active !== undefined) patch.isActive = body.is_active;
  const [c] = await ctx.db
    .update(companies)
    .set(patch)
    .where(and(eq(companies.companyId, id), isNull(companies.deletedAt)))
    .returning()
    .catch((e) => translateUnique(e, "Bu şirket adı zaten var."));
  if (!c) throw new ApiError("NOT_FOUND");
  await audit(ctx.db, actor.id, "company", String(id), "update", undefined, body);
  return { company_id: c.companyId, name: c.name, is_active: c.isActive };
}

export async function deleteCompany(ctx: Ctx, actor: Actor, id: number) {
  requireSystemAdmin(actor);
  const [c] = await ctx.db
    .update(companies)
    .set({ deletedAt: ctx.now(), updatedAt: ctx.now() })
    .where(and(eq(companies.companyId, id), isNull(companies.deletedAt)))
    .returning({ id: companies.companyId });
  if (!c) throw new ApiError("NOT_FOUND");
  await audit(ctx.db, actor.id, "company", String(id), "delete", undefined, undefined);
}

export async function createDepartment(
  ctx: Ctx,
  actor: Actor,
  body: { company_id: number; name: string; description?: string },
) {
  requireSystemAdmin(actor);
  const [c] = await ctx.db.select().from(companies).where(and(eq(companies.companyId, body.company_id), isNull(companies.deletedAt))).limit(1);
  if (!c) throw new ApiError("VALIDATION_FAILED", "Şirket bulunamadı.");
  const [d] = await ctx.db
    .insert(departments)
    .values({ companyId: body.company_id, name: body.name, description: body.description ?? null, createdAt: ctx.now(), updatedAt: ctx.now() })
    .returning()
    .catch((e) => translateUnique(e, "Bu şirkette aynı adda birim var."));
  if (!d) throw new ApiError("INTERNAL_ERROR");
  await audit(ctx.db, actor.id, "department", String(d.departmentId), "create", undefined, { name: body.name, company_id: body.company_id });
  return { department_id: d.departmentId, company_id: d.companyId, name: d.name, description: d.description };
}

export async function updateDepartment(ctx: Ctx, actor: Actor, id: number, body: { name?: string; description?: string }) {
  requireSystemAdmin(actor);
  const patch: Partial<typeof departments.$inferInsert> = { updatedAt: ctx.now() };
  if (body.name !== undefined) patch.name = body.name;
  if (body.description !== undefined) patch.description = body.description;
  const [d] = await ctx.db
    .update(departments)
    .set(patch)
    .where(and(eq(departments.departmentId, id), isNull(departments.deletedAt)))
    .returning()
    .catch((e) => translateUnique(e, "Bu şirkette aynı adda birim var."));
  if (!d) throw new ApiError("NOT_FOUND");
  await audit(ctx.db, actor.id, "department", String(id), "update", undefined, body);
  return { department_id: d.departmentId, company_id: d.companyId, name: d.name, description: d.description };
}

// Birim silinince kanalı da kapanır; geçmiş mesajlar korunur.
export async function deleteDepartment(ctx: Ctx, actor: Actor, id: number) {
  requireSystemAdmin(actor);
  const now = ctx.now();
  const [d] = await ctx.db
    .update(departments)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(departments.departmentId, id), isNull(departments.deletedAt)))
    .returning({ id: departments.departmentId });
  if (!d) throw new ApiError("NOT_FOUND");
  await ctx.db
    .update(conversations)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(conversations.departmentId, id), isNull(conversations.deletedAt)));
  await audit(ctx.db, actor.id, "department", String(id), "delete", undefined, undefined);
}

export async function createDepartmentChannel(ctx: Ctx, actor: Actor, departmentId: number) {
  requireSystemAdmin(actor);
  const [d] = await ctx.db
    .select()
    .from(departments)
    .where(and(eq(departments.departmentId, departmentId), isNull(departments.deletedAt)))
    .limit(1);
  if (!d) throw new ApiError("NOT_FOUND");
  const [existing] = await ctx.db
    .select({ id: conversations.conversationId })
    .from(conversations)
    .where(and(eq(conversations.departmentId, departmentId), eq(conversations.type, "department"), isNull(conversations.deletedAt)))
    .limit(1);
  if (existing) throw new ApiError("DEPARTMENT_CHANNEL_EXISTS");
  const now = ctx.now();
  const [c] = await ctx.db
    .insert(conversations)
    .values({ type: "department", name: d.name, departmentId, createdBy: actor.id, createdAt: now, updatedAt: now })
    .returning();
  if (!c) throw new ApiError("INTERNAL_ERROR");
  await audit(ctx.db, actor.id, "department", String(departmentId), "create", undefined, { channel: c.conversationId });
  return { conversation_id: c.conversationId, type: "department", name: c.name, department_id: departmentId };
}

export async function createLocation(ctx: Ctx, actor: Actor, body: { name: string; city?: string | null; address?: string | null }) {
  requireSystemAdmin(actor);
  const [l] = await ctx.db
    .insert(locations)
    .values({ name: body.name, city: body.city ?? null, address: body.address ?? null, createdAt: ctx.now(), updatedAt: ctx.now() })
    .returning()
    .catch((e) => translateUnique(e, "Bu lokasyon adı zaten var."));
  if (!l) throw new ApiError("INTERNAL_ERROR");
  await audit(ctx.db, actor.id, "location", String(l.locationId), "create", undefined, { name: body.name });
  return { location_id: l.locationId, name: l.name, city: l.city, address: l.address };
}

export async function updateLocation(
  ctx: Ctx,
  actor: Actor,
  id: number,
  body: { name?: string; city?: string | null; address?: string | null },
) {
  requireSystemAdmin(actor);
  const patch: Partial<typeof locations.$inferInsert> = { updatedAt: ctx.now() };
  if (body.name !== undefined) patch.name = body.name;
  if (body.city !== undefined) patch.city = body.city;
  if (body.address !== undefined) patch.address = body.address;
  const [l] = await ctx.db
    .update(locations)
    .set(patch)
    .where(and(eq(locations.locationId, id), isNull(locations.deletedAt)))
    .returning()
    .catch((e) => translateUnique(e, "Bu lokasyon adı zaten var."));
  if (!l) throw new ApiError("NOT_FOUND");
  await audit(ctx.db, actor.id, "location", String(id), "update", undefined, body);
  return { location_id: l.locationId, name: l.name, city: l.city, address: l.address };
}

export async function deleteLocation(ctx: Ctx, actor: Actor, id: number) {
  requireSystemAdmin(actor);
  const [l] = await ctx.db
    .update(locations)
    .set({ deletedAt: ctx.now(), updatedAt: ctx.now() })
    .where(and(eq(locations.locationId, id), isNull(locations.deletedAt)))
    .returning({ id: locations.locationId });
  if (!l) throw new ApiError("NOT_FOUND");
  await audit(ctx.db, actor.id, "location", String(id), "delete", undefined, undefined);
}

// --- Şirketler arası bağlantı (§5.7, Ç1, B6) ---

export async function createCompanyLink(
  ctx: Ctx,
  actor: Actor,
  body: { company_ids: number[]; dry_run?: boolean },
) {
  requireSystemAdmin(actor);
  const [a, b] = [...body.company_ids].sort((x, y) => x - y) as [number, number];
  const found = await ctx.db
    .select({ id: companies.companyId })
    .from(companies)
    .where(and(inArray(companies.companyId, [a, b]), isNull(companies.deletedAt)));
  if (found.length !== 2) throw new ApiError("VALIDATION_FAILED", "Şirket bulunamadı.");

  if (body.dry_run) {
    // Önizleme: iki şirketteki aktif kullanıcılar, bağlantı açılınca yazışabilen kişiler
    const affected = await ctx.db
      .selectDistinct({ row: users })
      .from(users)
      .innerJoin(userDepartments, eq(userDepartments.userId, users.userId))
      .innerJoin(departments, eq(departments.departmentId, userDepartments.departmentId))
      .where(and(inArray(departments.companyId, [a, b]), eq(users.isActive, true), isNull(users.deletedAt)));
    return { affected_users: affected.map((r) => userSummary(r.row)) };
  }

  const [active] = await ctx.db
    .select({ id: companyLinks.linkId })
    .from(companyLinks)
    .where(and(eq(companyLinks.companyLowId, a), eq(companyLinks.companyHighId, b), isNull(companyLinks.revokedAt)))
    .limit(1);
  if (active) throw new ApiError("VALIDATION_FAILED", "Bu şirket çifti için aktif bağlantı zaten var.");

  const [link] = await ctx.db
    .insert(companyLinks)
    .values({ companyLowId: a, companyHighId: b, createdBy: actor.id, createdAt: ctx.now() })
    .returning();
  if (!link) throw new ApiError("INTERNAL_ERROR");
  await audit(ctx.db, actor.id, "company_link", String(link.linkId), "create", undefined, { company_low_id: a, company_high_id: b });
  return linkOut(ctx, link);
}

export async function revokeCompanyLink(ctx: Ctx, actor: Actor, linkId: number) {
  requireSystemAdmin(actor);
  const [link] = await ctx.db.select().from(companyLinks).where(eq(companyLinks.linkId, linkId)).limit(1);
  if (!link) throw new ApiError("NOT_FOUND");
  if (!link.revokedAt) {
    const [updated] = await ctx.db
      .update(companyLinks)
      .set({ revokedAt: ctx.now() })
      .where(eq(companyLinks.linkId, linkId))
      .returning();
    await audit(ctx.db, actor.id, "company_link", String(linkId), "revoke", { revoked: false }, { revoked: true });
    return linkOut(ctx, updated ?? link);
  }
  return linkOut(ctx, link);
}

async function linkOut(ctx: Ctx, link: typeof companyLinks.$inferSelect) {
  const creator = await loadUser(ctx.db, link.createdBy);
  return {
    link_id: link.linkId,
    company_low_id: link.companyLowId,
    company_high_id: link.companyHighId,
    created_by: creator
      ? { user_id: creator.id, first_name: creator.firstName, last_name: creator.lastName, job_title: creator.jobTitle, is_active: creator.isActive }
      : null,
    created_at: link.createdAt,
    revoked_at: link.revokedAt,
  };
}

// --- Onay yapılandırması (B3) ---

export async function getApprovalRules(ctx: Ctx, actor: Actor) {
  requireSystemAdmin(actor);
  return rulesOut(await loadRules(ctx.db));
}

export async function updateApprovalRules(
  ctx: Ctx,
  actor: Actor,
  body: { request_expiry_hours?: number; access_window_hours?: number; message_rate_per_min?: number; ticket_rate_per_hour?: number },
) {
  requireSystemAdmin(actor);
  const before = await loadRules(ctx.db);
  const patch: Partial<typeof approvalRules.$inferInsert> = { updatedAt: ctx.now(), updatedBy: actor.id };
  if (body.request_expiry_hours !== undefined) patch.requestExpiryHours = body.request_expiry_hours;
  if (body.access_window_hours !== undefined) patch.accessWindowHours = body.access_window_hours;
  if (body.message_rate_per_min !== undefined) patch.messageRatePerMin = body.message_rate_per_min;
  if (body.ticket_rate_per_hour !== undefined) patch.ticketRatePerHour = body.ticket_rate_per_hour;
  const [after] = await ctx.db.update(approvalRules).set(patch).where(eq(approvalRules.id, 1)).returning();
  if (!after) throw new ApiError("INTERNAL_ERROR");
  await audit(ctx.db, actor.id, "approval_rules", "1", "update", rulesOut(before), rulesOut(after));
  return rulesOut(after);
}

function rulesOut(r: typeof approvalRules.$inferSelect) {
  return {
    request_expiry_hours: r.requestExpiryHours,
    access_window_hours: r.accessWindowHours,
    message_rate_per_min: r.messageRatePerMin,
    ticket_rate_per_hour: r.ticketRatePerHour,
    updated_at: r.updatedAt,
  };
}

