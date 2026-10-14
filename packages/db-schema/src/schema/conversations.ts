import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { deletedAt, tstz } from "./_common";
import { conversationType } from "./enums";
import { companies, departments } from "./organization";
import { users } from "./users";

// §3.3 conversations
export const conversations = pgTable(
  "conversations",
  {
    conversationId: uuid("conversation_id").primaryKey().defaultRandom(),
    type: conversationType("type").notNull(),
    name: text("name"),
    // Yalnızca department tipinde
    departmentId: bigint("department_id", { mode: "number" }).references(
      () => departments.departmentId,
    ),
    // Yalnızca şirketler arası konuşmada; ilk mesajdan sonra kilit uygulama katmanında (§5.3)
    companyContextId: bigint("company_context_id", { mode: "number" }).references(
      () => companies.companyId,
    ),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.userId),
    lastMessageAt: tstz("last_message_at"),
    createdAt: tstz("created_at").notNull().defaultNow(),
    deletedAt,
  },
  (t) => [
    check(
      "conversations_department_id_ck",
      sql`(${t.type} = 'department') = (${t.departmentId} IS NOT NULL)`,
    ),
    // Birim başına bir aktif kanal
    uniqueIndex("conversations_department_channel_uq")
      .on(t.departmentId)
      .where(sql`${t.type} = 'department' AND ${t.deletedAt} IS NULL`),
  ],
);

// §3.3 conversation_members; left_at NULL = aktif üye (§5.2)
export const conversationMembers = pgTable(
  "conversation_members",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.conversationId),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId),
    joinedAt: tstz("joined_at").notNull().defaultNow(),
    leftAt: tstz("left_at"),
    lastReadAt: tstz("last_read_at"),
    // Yalnızca bildirimi keser (§7)
    isMuted: boolean("is_muted").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    // GET /conversations: kullanıcının aktif konuşmaları
    index("conversation_members_user_active_idx")
      .on(t.userId)
      .where(sql`${t.leftAt} IS NULL`),
  ],
);
