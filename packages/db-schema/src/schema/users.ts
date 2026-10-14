import { sql } from "drizzle-orm";
import { boolean, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { deletedAt, timestamps } from "./_common";
import { userRole } from "./enums";

// §3.2 users. Şirket kolonu yok, user_departments'tan türetilir.
export const users = pgTable(
  "users",
  {
    userId: uuid("user_id").primaryKey().defaultRandom(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(), // argon2id
    jobTitle: text("job_title"),
    role: userRole("role").notNull().default("employee"),
    profilePictureUrl: text("profile_picture_url"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
    deletedAt,
  },
  (t) => [
    uniqueIndex("users_email_active_uq")
      .on(t.email)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);
