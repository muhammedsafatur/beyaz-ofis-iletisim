import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { attachments } from "@beyaz-ofis/db-schema";
import { ApiError } from "../errors.js";
import { MINUTE } from "../policy/types.js";
import { activeMembership, type Actor, type Ctx } from "./common.js";

// Faz 2: dosya ekleri. Boyut ve tür sınırları burada tanımlı (öneri: 10 MB, yaygın belge ve görsel türleri).
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
] as const;
// İndirme bağlantısı kısa ömürlüdür; erişim yalnızca üyelikle ilgilidir ve bağlantı süresince geçerlidir.
export const DOWNLOAD_URL_TTL_MS = 5 * MINUTE;

type AttachmentRow = typeof attachments.$inferSelect;

export function attachmentOut(a: AttachmentRow) {
  return {
    attachment_id: a.attachmentId,
    file_name: a.fileName,
    content_type: a.contentType,
    size_bytes: a.sizeBytes,
  };
}

// Dosya adı: yalnızca temel ad, denetim karakterleri temizlenir, en fazla 255 karakter.
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
  return cleaned || "dosya";
}

export async function uploadAttachment(
  ctx: Ctx,
  actor: Actor,
  conversationId: string,
  input: { contentType: string; fileName: string; data: Buffer },
) {
  await activeMembership(ctx.db, conversationId, actor.id);
  if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(input.contentType)) {
    throw new ApiError("VALIDATION_FAILED", "Bu dosya türüne izin verilmiyor.");
  }
  if (input.data.length === 0) throw new ApiError("VALIDATION_FAILED", "Dosya boş.");
  if (input.data.length > MAX_ATTACHMENT_BYTES) throw new ApiError("VALIDATION_FAILED", "Dosya en fazla 10 MB olabilir.");
  // Yerel disk + tarama (karar): dosya kaydedilmeden önce taranır.
  const verdict = await ctx.scanner.scan(input.data).catch(() => {
    throw new ApiError("INTERNAL_ERROR", "Dosya taraması yapılamadı.");
  });
  if (verdict === "infected") throw new ApiError("VALIDATION_FAILED", "Dosya güvenlik taramasından geçemedi.");
  const id = randomUUID();
  await ctx.files.put(id, input.data);
  const [row] = await ctx.db
    .insert(attachments)
    .values({
      attachmentId: id,
      conversationId,
      uploaderId: actor.id,
      fileName: sanitizeFileName(input.fileName),
      contentType: input.contentType,
      sizeBytes: input.data.length,
      storageKey: id,
      createdAt: ctx.now(),
    })
    .returning();
  if (!row) throw new ApiError("INTERNAL_ERROR");
  return attachmentOut(row);
}

// İmza anahtarı, erişim belirtecinden ayrı bir amaçla türetilir.
function signingKey(jwtSecret: string): Buffer {
  return createHash("sha256").update(`attachments:${jwtSecret}`).digest();
}

function sign(jwtSecret: string, id: string, exp: number): string {
  return createHmac("sha256", signingKey(jwtSecret)).update(`${id}.${exp}`).digest("hex");
}

export async function downloadUrl(ctx: Ctx, actor: Actor, attachmentId: string) {
  const [row] = await ctx.db.select().from(attachments).where(eq(attachments.attachmentId, attachmentId)).limit(1);
  if (!row) throw new ApiError("NOT_FOUND");
  await activeMembership(ctx.db, row.conversationId, actor.id);
  const exp = ctx.now().getTime() + DOWNLOAD_URL_TTL_MS;
  const sig = sign(ctx.jwtSecret, attachmentId, exp);
  return {
    url: `/api/v1/attachments/${attachmentId}/download?exp=${exp}&sig=${sig}`,
    expires_at: new Date(exp).toISOString(),
  };
}

// İmzalı indirme: imza ve süre doğrulanır, dosya okunur.
export async function readSigned(ctx: Ctx, attachmentId: string, exp: number, sig: string) {
  if (!Number.isFinite(exp) || exp < ctx.now().getTime()) throw new ApiError("FORBIDDEN", "Bağlantının süresi doldu.");
  const expected = Buffer.from(sign(ctx.jwtSecret, attachmentId, exp), "utf8");
  const given = Buffer.from(sig, "utf8");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new ApiError("FORBIDDEN");
  const [row] = await ctx.db.select().from(attachments).where(eq(attachments.attachmentId, attachmentId)).limit(1);
  if (!row) throw new ApiError("NOT_FOUND");
  const data = await ctx.files.get(row.storageKey);
  return { row, data };
}

// Mesaja bağlama: ek yalnızca yükleyicinin, aynı konuşmadaki ve henüz bağlanmamış ekiyle mesaj gönderebilir.
export async function claimForMessage(
  tx: Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0],
  attachmentId: string,
  conversationId: string,
  uploaderId: string,
  messageId: string,
): Promise<void> {
  const [claimed] = await tx
    .update(attachments)
    .set({ messageId })
    .where(
      and(
        eq(attachments.attachmentId, attachmentId),
        eq(attachments.conversationId, conversationId),
        eq(attachments.uploaderId, uploaderId),
        isNull(attachments.messageId),
      ),
    )
    .returning({ id: attachments.attachmentId });
  if (!claimed) throw new ApiError("VALIDATION_FAILED", "Ek bu mesaja eklenemez.");
}
