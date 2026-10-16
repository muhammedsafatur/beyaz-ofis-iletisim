import { bigint, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { tstz } from "./_common";
import { conversations } from "./conversations";
import { messages } from "./messages";
import { users } from "./users";

// Faz 2: dosya ekleri. Dosya içeriği depoda (yerel disk ya da nesne deposu) tutulur; burada yalnızca meta veri.
// Ek bir mesaja en fazla bir kez bağlanır (message_id NULL iken yüklenmiş, bağlanmamış ek).
export const attachments = pgTable(
  "attachments",
  {
    attachmentId: uuid("attachment_id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.conversationId),
    uploaderId: uuid("uploader_id")
      .notNull()
      .references(() => users.userId),
    messageId: uuid("message_id").references(() => messages.messageId),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull().unique(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [index("attachments_conversation_idx").on(t.conversationId)],
);
