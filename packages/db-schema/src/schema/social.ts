import { index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { tstz } from "./_common";
import { messages } from "./messages";
import { users } from "./users";

// @ anma: mesajda anılan kullanıcılar. Yalnızca konuşmanın aktif üyeleri anılabilir (API doğrular).
export const messageMentions = pgTable(
  "message_mentions",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.messageId),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId] }),
    index("message_mentions_user_idx").on(t.userId),
  ],
);

// Expo Push cihaz belirteçleri. Bir belirteç yalnızca bir kullanıcıya bağlıdır.
export const pushTokens = pgTable(
  "push_tokens",
  {
    token: text("token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId),
    platform: text("platform", { enum: ["ios", "android", "desktop"] }).notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
    lastSeenAt: tstz("last_seen_at").notNull().defaultNow(),
  },
  (t) => [index("push_tokens_user_idx").on(t.userId)],
);
