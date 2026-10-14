import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { deletedAt, timestamps, tstz } from "./_common";
import { users } from "./users";

const bigintId = (name: string) =>
  bigint(name, { mode: "number" }).primaryKey().generatedAlwaysAsIdentity();
const bigintRef = (name: string) => bigint(name, { mode: "number" });

// §3.1 companies
export const companies = pgTable(
  "companies",
  {
    companyId: bigintId("company_id"),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
    deletedAt,
  },
  (t) => [
    uniqueIndex("companies_name_active_uq")
      .on(t.name)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

// §3.1 departments
export const departments = pgTable(
  "departments",
  {
    departmentId: bigintId("department_id"),
    companyId: bigintRef("company_id")
      .notNull()
      .references(() => companies.companyId),
    name: text("name").notNull(),
    description: text("description"),
    ...timestamps,
    deletedAt,
  },
  (t) => [
    uniqueIndex("departments_company_name_active_uq")
      .on(t.companyId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

// §3.1 locations
export const locations = pgTable(
  "locations",
  {
    locationId: bigintId("location_id"),
    name: text("name").notNull(),
    city: text("city"),
    address: text("address"),
    ...timestamps,
    deletedAt,
  },
  (t) => [
    uniqueIndex("locations_name_active_uq")
      .on(t.name)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

// §3.1 department_locations (yalnızca bilgi amaçlı)
export const departmentLocations = pgTable(
  "department_locations",
  {
    departmentId: bigintRef("department_id")
      .notNull()
      .references(() => departments.departmentId),
    locationId: bigintRef("location_id")
      .notNull()
      .references(() => locations.locationId),
  },
  (t) => [primaryKey({ columns: [t.departmentId, t.locationId] })],
);

// §3.1 user_departments; kullanıcının şirketi buradan türetilir (§3.2)
export const userDepartments = pgTable(
  "user_departments",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId),
    departmentId: bigintRef("department_id")
      .notNull()
      .references(() => departments.departmentId),
    joinedAt: tstz("joined_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.departmentId] }),
    index("user_departments_department_idx").on(t.departmentId),
  ],
);

// §3.1 user_locations (profil ve raporlama)
export const userLocations = pgTable(
  "user_locations",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId),
    locationId: bigintRef("location_id")
      .notNull()
      .references(() => locations.locationId),
  },
  (t) => [primaryKey({ columns: [t.userId, t.locationId] })],
);

// §3.1 department_managers; yöneticilik bir birime atanmanın sonucudur (§2)
export const departmentManagers = pgTable(
  "department_managers",
  {
    departmentId: bigintRef("department_id")
      .notNull()
      .references(() => departments.departmentId),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId),
    assignedAt: tstz("assigned_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.departmentId, t.userId] }),
    index("department_managers_user_idx").on(t.userId),
  ],
);

// §3.1 company_links; revoked_at NULL = aktif. canMessage adım 2 bu tabloyu okur.
export const companyLinks = pgTable(
  "company_links",
  {
    linkId: bigintId("link_id"),
    companyLowId: bigintRef("company_low_id").notNull(),
    companyHighId: bigintRef("company_high_id").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.userId),
    createdAt: tstz("created_at").notNull().defaultNow(),
    revokedAt: tstz("revoked_at"),
  },
  (t) => [
    foreignKey({ columns: [t.companyLowId], foreignColumns: [companies.companyId] }),
    foreignKey({ columns: [t.companyHighId], foreignColumns: [companies.companyId] }),
    check("company_links_low_lt_high_ck", sql`${t.companyLowId} < ${t.companyHighId}`),
    // Spec: Benzersiz (company_low_id, company_high_id); partial değil, bkz. BOSLUKLAR.md #4
    uniqueIndex("company_links_pair_uq").on(t.companyLowId, t.companyHighId),
  ],
);
