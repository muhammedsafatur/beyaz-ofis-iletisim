import { and, eq, isNull } from "drizzle-orm";
import {
  companies,
  departments,
  locations,
  userDepartments,
  userLocations,
  users,
} from "@beyaz-ofis/db-schema";
import { ApiError } from "../errors.js";
import { paginateDesc, userSummary, type Actor, type Ctx } from "./common.js";

type UserRow = typeof users.$inferSelect;

// Kullanıcının tam görünümü: birimleri ve lokasyonları ile.
export async function userOut(ctx: Ctx, row: UserRow) {
  const [deps, locs] = await Promise.all([
    ctx.db.select({ id: userDepartments.departmentId }).from(userDepartments).where(eq(userDepartments.userId, row.userId)),
    ctx.db.select({ id: userLocations.locationId }).from(userLocations).where(eq(userLocations.userId, row.userId)),
  ]);
  return {
    user_id: row.userId,
    first_name: row.firstName,
    last_name: row.lastName,
    email: row.email,
    job_title: row.jobTitle,
    role: row.role,
    department_ids: deps.map((d) => d.id),
    location_ids: locs.map((l) => l.id),
    is_active: row.isActive,
    profile_picture_url: row.profilePictureUrl,
    created_at: row.createdAt,
  };
}

export async function getUserRow(ctx: Ctx, userId: string): Promise<UserRow> {
  const [row] = await ctx.db.select().from(users).where(eq(users.userId, userId)).limit(1);
  if (!row || row.deletedAt) throw new ApiError("NOT_FOUND");
  return row;
}

export async function getMe(ctx: Ctx, actor: Actor) {
  return userOut(ctx, await getUserRow(ctx, actor.id));
}

// Ad soyad burada değişmez (Ç17): yalnızca sistem yöneticisi değiştirir.
export async function updateMe(
  ctx: Ctx,
  actor: Actor,
  body: { job_title?: string | undefined; profile_picture_url?: string | null | undefined },
) {
  const patch: Partial<typeof users.$inferInsert> = { updatedAt: ctx.now() };
  if (body.job_title !== undefined) patch.jobTitle = body.job_title;
  if (body.profile_picture_url !== undefined) patch.profilePictureUrl = body.profile_picture_url;
  await ctx.db.update(users).set(patch).where(eq(users.userId, actor.id));
  return getMe(ctx, actor);
}

// Aktif kullanıcılar, kimlik sırasıyla (azalan) sayfalanır. Filtreler birimlerden türetilir (§3.2).
export async function listUsers(
  ctx: Ctx,
  filter: { companyId?: number; departmentId?: number; q?: string; cursor?: string; limit: number },
) {
  const rows = await ctx.db
    .select({ row: users, departmentId: userDepartments.departmentId, companyId: departments.companyId })
    .from(users)
    .leftJoin(userDepartments, eq(userDepartments.userId, users.userId))
    .leftJoin(departments, eq(departments.departmentId, userDepartments.departmentId))
    .where(and(eq(users.isActive, true), isNull(users.deletedAt)));

  const matching = rows.filter(
    (r) =>
      (filter.companyId === undefined || r.companyId === filter.companyId) &&
      (filter.departmentId === undefined || r.departmentId === filter.departmentId),
  );
  const byId = new Map<string, UserRow>();
  for (const r of matching) byId.set(r.row.userId, r.row);

  let list = [...byId.values()];
  if (filter.q) {
    const q = filter.q.toLocaleLowerCase("tr");
    list = list.filter((u) => `${u.firstName} ${u.lastName}`.toLocaleLowerCase("tr").includes(q));
  }
  list.sort((a, b) => (a.userId < b.userId ? 1 : a.userId > b.userId ? -1 : 0));
  const { page, nextCursor } = paginateDesc(list, filter.limit, filter.cursor, (u) => ({ key: u.userId, id: u.userId }));
  return { items: page.map((u) => userSummary(u)), next_cursor: nextCursor };
}

export async function listCompanies(ctx: Ctx) {
  const rows = await ctx.db.select().from(companies).where(isNull(companies.deletedAt));
  return rows.map((c) => ({ company_id: c.companyId, name: c.name, is_active: c.isActive }));
}

export async function listDepartments(ctx: Ctx, companyId?: number) {
  const rows = await ctx.db.select().from(departments).where(isNull(departments.deletedAt));
  return rows
    .filter((d) => companyId === undefined || d.companyId === companyId)
    .map((d) => ({ department_id: d.departmentId, company_id: d.companyId, name: d.name, description: d.description }));
}

export async function listLocations(ctx: Ctx) {
  const rows = await ctx.db.select().from(locations).where(isNull(locations.deletedAt));
  return rows.map((l) => ({ location_id: l.locationId, name: l.name, city: l.city, address: l.address }));
}
