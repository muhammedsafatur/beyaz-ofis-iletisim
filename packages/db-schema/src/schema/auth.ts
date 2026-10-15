import { type AnyPgColumn, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { tstz } from "./_common";
import { users } from "./users";

// §10 / B4: refresh token yalnızca hash olarak saklanır ve her yenilemede rotate edilir.
// family_id: yeniden kullanım tespitinde aynı ailenin tamamı iptal edilir (REFRESH_TOKEN_REUSED).
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    tokenId: uuid("token_id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId),
    tokenHash: text("token_hash").notNull().unique(),
    familyId: uuid("family_id").notNull(),
    expiresAt: tstz("expires_at").notNull(),
    revokedAt: tstz("revoked_at"),
    replacedBy: uuid("replaced_by").references((): AnyPgColumn => refreshTokens.tokenId),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [index("refresh_tokens_user_idx").on(t.userId), index("refresh_tokens_family_idx").on(t.familyId)],
);

// Ç16: davet akışı. Tek kullanımlık, süreli, token yalnızca hash olarak saklanır.
export const invitations = pgTable(
  "invitations",
  {
    invitationId: uuid("invitation_id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: tstz("expires_at").notNull(),
    usedAt: tstz("used_at"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.userId),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [index("invitations_user_idx").on(t.userId)],
);
