import { bigint, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { deletedAt, tstz } from "./_common";
import { conversations } from "./conversations";
import { messageType, revisionType } from "./enums";
import { users } from "./users";

// §3.4 messages
export const messages = pgTable(
  "messages",
  {
    messageId: uuid("message_id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.conversationId),
    senderUserId: uuid("sender_user_id")
      .notNull()
      .references(() => users.userId),
    // Idempotency anahtarı, istemci üretir
    clientMessageId: uuid("client_message_id").notNull(),
    // Konuşma içi sıra; cursor sayfalama before_seq / after_seq
    seq: bigint("seq", { mode: "number" }).notNull(),
    // K4: gönderim, düzenleme ve silmede artan ayrı sayaç. seq boşluksuz kalır.
    changeSeq: bigint("change_seq", { mode: "number" }).notNull(),
    content: text("content").notNull(),
    messageType: messageType("message_type").notNull().default("text"),
    sentAt: tstz("sent_at").notNull().defaultNow(),
    editedAt: tstz("edited_at"),
    deletedAt,
  },
  (t) => [
    // Sayfalama bu index'i kullanır
    uniqueIndex("messages_conversation_seq_uq").on(t.conversationId, t.seq),
    // Delta polling (after_change_seq) bu index'i kullanır
    uniqueIndex("messages_conversation_change_seq_uq").on(t.conversationId, t.changeSeq),
    uniqueIndex("messages_sender_client_message_uq").on(t.senderUserId, t.clientMessageId),
  ],
);

// §3.4 message_revisions; değişiklik öncesi içerik, kullanıcıya gösterilmez
export const messageRevisions = pgTable(
  "message_revisions",
  {
    revisionId: bigint("revision_id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.messageId),
    content: text("content").notNull(),
    revisionType: revisionType("revision_type").notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [index("message_revisions_message_idx").on(t.messageId)],
);
