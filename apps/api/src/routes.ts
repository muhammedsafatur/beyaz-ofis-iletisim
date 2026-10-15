import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ApiError } from "./errors.js";
import * as auth from "./services/auth.js";
import * as admin from "./services/admin.js";
import * as people from "./services/people.js";
import * as conv from "./services/conversations.js";
import * as tickets from "./services/tickets.js";
import * as reqs from "./services/accessRequests.js";
import * as att from "./services/attachments.js";
import * as pushSvc from "./services/pushTokens.js";
import { loadActor, type Actor, type Ctx } from "./services/common.js";
import { verifyAccess } from "./services/auth.js";

declare module "fastify" {
  interface FastifyRequest {
    actor: Actor;
  }
}

// --- Girdi şemaları. Sayılar query'den geldiği için coerce kullanılır. ---
const uuid = z.string().uuid();
const pos = z.coerce.number().int().positive();
const page = (def: number) => z.coerce.number().int().min(1).max(100).default(def);
const optDate = z
  .string()
  .datetime()
  .optional()
  .transform((v) => (v ? new Date(v) : undefined));

const login = z.object({ email: z.string().email(), password: z.string().min(8) });
const tokenBody = z.object({ refresh_token: z.string().min(1) });
const acceptInvite = z.object({ token: z.string().min(1), password: z.string().min(8) });
const meUpdate = z.object({
  job_title: z.string().max(120).optional(),
  profile_picture_url: z.string().url().nullable().optional(),
});
const usersQuery = z.object({
  company_id: pos.optional(),
  department_id: pos.optional(),
  q: z.string().max(100).optional(),
  cursor: z.string().optional(),
  limit: page(25),
});
const convQuery = z.object({ cursor: z.string().optional(), limit: page(25), updated_after: optDate });
const convCreate = z.object({
  type: z.enum(["direct", "group"]),
  name: z.string().max(120).optional(),
  member_ids: z.array(uuid).min(1),
  company_context_id: pos.nullable().optional().transform((v) => v ?? undefined),
});
const membersAdd = z.object({ user_ids: z.array(uuid).min(1) });
const muteBody = z.object({ is_muted: z.boolean() });
const msgQuery = z.object({
  before_seq: z.coerce.number().int().min(0).optional(),
  after_seq: z.coerce.number().int().min(0).optional(),
  after_change_seq: z.coerce.number().int().min(0).optional(),
  limit: page(50),
});
const msgCreate = z.object({
  client_message_id: uuid,
  content: z.string().min(1).max(4000),
  attachment_id: uuid.optional(),
  mentions: z.array(uuid).max(20).optional(),
});
const pushTokenBody = z.object({ token: z.string().min(10).max(512), platform: z.enum(["ios", "android", "desktop"]) });
const pushTokenDelete = z.object({ token: z.string().min(10).max(512) });
const msgEdit = z.object({ content: z.string().min(1).max(4000) });
const canSendBody = z.object({ target_user_id: uuid, company_context_id: pos.nullable().optional() });
const ticketQuery = z.object({
  role: z.enum(["requester", "approver"]),
  status: z.enum(["pending", "approved", "rejected", "withdrawn", "expired"]).optional(),
  cursor: z.string().optional(),
  limit: page(25),
});
const ticketCreate = z.object({
  client_request_id: uuid,
  target_department_id: pos,
  title: z.string().min(3).max(160),
  body: z.string().min(10).max(8000),
});
const ticketPatch = z.object({ title: z.string().min(3).max(160).optional(), body: z.string().min(10).max(8000).optional() });
const decisionBody = z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().max(1000).optional() });
const requestQuery = ticketQuery;
const requestCreate = z.object({
  client_request_id: uuid,
  conversation_id: uuid,
  reason: z.string().min(1).max(1000),
  target_department_ids: z.array(pos).min(1),
});
const eventBody = z.object({ type: z.enum(["copy_blocked"]) });
const commentBody = z.object({ body: z.string().min(1).max(2000) });
const auditQuery = z.object({ cursor: z.string().optional(), limit: page(50) });
const downloadQuery = z.object({ exp: z.coerce.number(), sig: z.string().min(1).max(200) });
const adminUserCreate = z.object({
  first_name: z.string().min(1).max(80),
  last_name: z.string().min(1).max(80),
  email: z.string().email(),
  job_title: z.string().max(120).optional(),
  department_ids: z.array(pos).optional(),
  location_ids: z.array(pos).optional(),
});
const adminUserPatch = z.object({
  // Yalnızca employee ve executive atanabilir. system_admin API üzerinden verilmez.
  role: z.enum(["employee", "executive"]).optional(),
  first_name: z.string().min(1).max(80).optional(),
  last_name: z.string().min(1).max(80).optional(),
  job_title: z.string().max(120).optional(),
  department_ids: z.array(pos).optional(),
  location_ids: z.array(pos).optional(),
});
const reassignBody = z.object({ to_user_id: uuid, department_ids: z.array(pos).optional() });
const nameBody = z.object({ name: z.string().min(1).max(120) });
const companyPatch = z.object({ name: z.string().min(1).max(120).optional(), is_active: z.boolean().optional() });
const departmentCreate = z.object({
  company_id: pos,
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
});
const departmentPatch = z.object({ name: z.string().min(1).max(120).optional(), description: z.string().max(500).optional() });
const managerBody = z.object({ user_id: uuid });
const locationCreate = z.object({
  name: z.string().min(1).max(120),
  city: z.string().max(120).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
});
const locationPatch = locationCreate.partial();
const linkCreate = z.object({
  company_ids: z.tuple([pos, pos]).refine(([a, b]) => a !== b, "Şirketler farklı olmalı"),
  dry_run: z.boolean().optional(),
});
const rulesPatch = z.object({
  request_expiry_hours: z.number().int().min(1).max(720).optional(),
  access_window_hours: z.number().int().min(1).max(168).optional(),
  message_rate_per_min: z.number().int().min(1).max(600).optional(),
  ticket_rate_per_hour: z.number().int().min(1).max(200).optional(),
});

const idParam = z.object({ id: uuid });

function noStore(reply: FastifyReply) {
  void reply.header("Cache-Control", "no-store");
}

export function registerRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.addContentTypeParser(
    [...att.ALLOWED_CONTENT_TYPES],
    { parseAs: "buffer", bodyLimit: att.MAX_ATTACHMENT_BYTES },
    (_req, body, done) => done(null, body),
  );
  // Kimlik doğrulama: erişim belirteci her istekte kontrol edilir, kullanıcı DB'den yeniden okunur (B4).
  const authenticate = async (req: FastifyRequest) => {
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer ")) throw new ApiError("UNAUTHENTICATED");
    const userId = verifyAccess(h.slice(7), ctx.jwtSecret);
    const actor = await loadActor(ctx.db, userId);
    if (!actor || actor.deleted) throw new ApiError("UNAUTHENTICATED");
    if (!actor.isActive) throw new ApiError("ACCOUNT_INACTIVE");
    req.actor = actor;
  };
  const guarded = { preHandler: authenticate };
  const parse = <T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> => schema.parse(value);

  // --- Push belirteçleri (Faz 3) ---
  app.post("/me/push-tokens", guarded, async (req, reply) => {
    const body = parse(pushTokenBody, req.body);
    await pushSvc.registerPushToken(ctx, req.actor, body.token, body.platform);
    return reply.status(204).send();
  });
  app.delete("/me/push-tokens", guarded, async (req, reply) => {
    const body = parse(pushTokenDelete, req.body);
    await pushSvc.removePushToken(ctx, req.actor, body.token);
    return reply.status(204).send();
  });

  // --- Kimlik ---
  app.post("/auth/login", async (req, reply) => {
    const body = parse(login, req.body);
    return reply.send(await auth.login(ctx, body.email, body.password));
  });
  app.post("/auth/refresh", async (req, reply) => {
    const body = parse(tokenBody, req.body);
    return reply.send(await auth.refresh(ctx, body.refresh_token));
  });
  app.post("/auth/logout", async (req, reply) => {
    const body = parse(tokenBody, req.body);
    await auth.logout(ctx, body.refresh_token);
    return reply.status(204).send();
  });
  app.post("/auth/logout-all", guarded, async (req, reply) => {
    await auth.logoutAll(ctx, req.actor.id);
    return reply.status(204).send();
  });
  app.post("/auth/accept-invite", async (req, reply) => {
    const body = parse(acceptInvite, req.body);
    await auth.acceptInvite(ctx, body.token, body.password);
    return reply.status(204).send();
  });

  // --- Kullanıcı ve organizasyon ---
  app.get("/users/me", guarded, async (req, reply) => reply.send(await people.getMe(ctx, req.actor)));
  app.patch("/users/me", guarded, async (req, reply) => {
    const body = parse(meUpdate, req.body);
    return reply.send(await people.updateMe(ctx, req.actor, body));
  });
  app.get("/users", guarded, async (req, reply) => {
    const q = parse(usersQuery, req.query);
    return reply.send(
      await people.listUsers(ctx, { companyId: q.company_id, departmentId: q.department_id, q: q.q, cursor: q.cursor, limit: q.limit }),
    );
  });
  app.get("/companies", guarded, async (_req, reply) => reply.send(await people.listCompanies(ctx)));
  app.get("/departments", guarded, async (req, reply) => {
    const q = parse(z.object({ company_id: pos.optional() }), req.query);
    return reply.send(await people.listDepartments(ctx, q.company_id));
  });
  app.get("/locations", guarded, async (_req, reply) => reply.send(await people.listLocations(ctx)));

  // --- Konuşmalar ---
  app.get("/conversations", guarded, async (req, reply) => {
    const q = parse(convQuery, req.query);
    return reply.send(await conv.listConversations(ctx, req.actor, q));
  });
  app.post("/conversations", guarded, async (req, reply) => {
    const body = parse(convCreate, req.body);
    const res = await conv.createConversation(ctx, req.actor, body);
    return reply.status(res.status).send(res.body);
  });
  app.get("/conversations/:id", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    return reply.send(await conv.getConversation(ctx, req.actor, id));
  });
  app.post("/conversations/:id/members", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(membersAdd, req.body);
    return reply.send(await conv.addMembers(ctx, req.actor, id, body.user_ids));
  });
  app.delete("/conversations/:id/members/:userId", guarded, async (req, reply) => {
    const { id, userId } = parse(z.object({ id: uuid, userId: uuid }), req.params);
    await conv.removeMember(ctx, req.actor, id, userId);
    return reply.status(204).send();
  });
  app.post("/conversations/:id/read", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    await conv.markRead(ctx, req.actor, id);
    return reply.status(204).send();
  });
  app.patch("/conversations/:id/mute", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(muteBody, req.body);
    return reply.send(await conv.setMute(ctx, req.actor, id, body.is_muted));
  });

  // --- Mesajlar ---
  app.get("/conversations/:id/messages", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const q = parse(msgQuery, req.query);
    return reply.send(await conv.listMessages(ctx, req.actor, id, q));
  });
  app.post("/conversations/:id/messages", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(msgCreate, req.body);
    const res = await conv.postMessage(ctx, req.actor, id, body);
    return reply.status(res.status).send(res.body);
  });
  app.patch("/messages/:id", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(msgEdit, req.body);
    return reply.send(await conv.editMessage(ctx, req.actor, id, body.content));
  });
  app.delete("/messages/:id", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    await conv.deleteMessage(ctx, req.actor, id);
    return reply.status(204).send();
  });
  app.post("/messages/can-send", guarded, async (req, reply) => {
    const body = parse(canSendBody, req.body);
    return reply.send(await conv.canSendPreview(ctx, req.actor, body.target_user_id));
  });

  // --- Ticket ---
  app.get("/tickets", guarded, async (req, reply) => {
    const q = parse(ticketQuery, req.query);
    return reply.send(await tickets.listTickets(ctx, req.actor, q));
  });
  app.post("/tickets", guarded, async (req, reply) => {
    const body = parse(ticketCreate, req.body);
    const res = await tickets.createTicket(ctx, req.actor, body);
    return reply.status(res.status).send(res.body);
  });
  app.get("/tickets/:id", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    return reply.send(await tickets.getTicket(ctx, req.actor, id));
  });
  app.patch("/tickets/:id", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(ticketPatch, req.body);
    return reply.send(await tickets.editTicket(ctx, req.actor, id, body));
  });
  app.post("/tickets/:id/withdraw", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    return reply.send(await tickets.withdrawTicket(ctx, req.actor, id));
  });
  app.post("/tickets/:id/decision", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(decisionBody, req.body);
    return reply.send(await tickets.decideTicket(ctx, req.actor, id, body));
  });
  app.post("/tickets/:id/reopen", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    return reply.status(201).send(await tickets.reopenTicket(ctx, req.actor, id));
  });

  // --- Erişim talebi ---
  app.get("/access-requests", guarded, async (req, reply) => {
    const q = parse(requestQuery, req.query);
    return reply.send(await reqs.listRequests(ctx, req.actor, q));
  });
  app.post("/access-requests", guarded, async (req, reply) => {
    const body = parse(requestCreate, req.body);
    const res = await reqs.createRequest(ctx, req.actor, body);
    return reply.status(res.status).send(res.body);
  });
  app.get("/access-requests/:id", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    return reply.send(await reqs.getRequest(ctx, req.actor, id));
  });
  app.post("/access-requests/:id/targets/:departmentId/decision", guarded, async (req, reply) => {
    const { id, departmentId } = parse(z.object({ id: uuid, departmentId: pos }), req.params);
    const body = parse(decisionBody, req.body);
    return reply.send(await reqs.decideTarget(ctx, req.actor, id, departmentId, body));
  });
  app.post("/access-requests/:id/withdraw", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    return reply.send(await reqs.withdrawRequest(ctx, req.actor, id));
  });
  app.post("/access-requests/:id/reopen", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    return reply.status(201).send(await reqs.reopenRequest(ctx, req.actor, id));
  });
  app.post("/access-requests/:id/events", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(eventBody, req.body);
    await reqs.recordClientEvent(ctx, req.actor, id, body.type);
    return reply.status(204).send();
  });
  app.get("/access-requests/:id/content", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    noStore(reply);
    return reply.send(await reqs.requesterContent(ctx, req.actor, id));
  });
  app.get("/access-requests/:id/targets/:departmentId/content", guarded, async (req, reply) => {
    const { id, departmentId } = parse(z.object({ id: uuid, departmentId: pos }), req.params);
    noStore(reply);
    return reply.send(await reqs.targetContent(ctx, req.actor, id, departmentId));
  });

  // --- Dosya ekleri (Faz 2) ---
  app.post("/conversations/:id/attachments", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const rawName = req.headers["x-file-name"];
    let fileName = "dosya";
    if (typeof rawName === "string") {
      try {
        fileName = decodeURIComponent(rawName);
      } catch {
        fileName = rawName;
      }
    }
    const contentType = String(req.headers["content-type"] ?? "").split(";")[0]!.trim();
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    return reply.status(201).send(await att.uploadAttachment(ctx, req.actor, id, { contentType, fileName, data }));
  });
  app.get("/attachments/:id/url", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    return reply.send(await att.downloadUrl(ctx, req.actor, id));
  });
  // İmzalı indirme: oturum belirteci gerekmez, imza ve süre doğrulanır.
  app.get("/attachments/:id/download", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const q = parse(downloadQuery, req.query);
    const { row, data } = await att.readSigned(ctx, id, q.exp, q.sig);
    void reply.header("content-type", row.contentType);
    void reply.header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(row.fileName)}`);
    void reply.header("cache-control", "private, no-store");
    void reply.header("x-content-type-options", "nosniff");
    return reply.send(data);
  });

  // --- Ticket yorumları (Faz 2) ---
  app.get("/tickets/:id/comments", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    return reply.send(await tickets.listComments(ctx, req.actor, id));
  });
  app.post("/tickets/:id/comments", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(commentBody, req.body);
    return reply.status(201).send(await tickets.addComment(ctx, req.actor, id, body.body));
  });

  // --- Yönetim (sistem yöneticisi) ---
  app.get("/admin/audit-log", guarded, async (req, reply) => {
    const q = parse(auditQuery, req.query);
    return reply.send(await admin.listAuditLog(ctx, req.actor, q));
  });
  app.post("/admin/users", guarded, async (req, reply) => {
    const body = parse(adminUserCreate, req.body);
    return reply.status(201).send(await admin.createUser(ctx, req.actor, body));
  });
  app.patch("/admin/users/:id", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(adminUserPatch, req.body);
    return reply.send(await admin.updateUser(ctx, req.actor, id, body));
  });
  app.post("/admin/users/:id/deactivate", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    return reply.send(await admin.deactivateUser(ctx, req.actor, id));
  });
  app.post("/admin/users/:id/activate", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    return reply.send(await admin.activateUser(ctx, req.actor, id));
  });
  app.post("/admin/users/:id/reassign", guarded, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(reassignBody, req.body);
    return reply.send(await admin.reassignManager(ctx, req.actor, id, body));
  });
  app.post("/admin/companies", guarded, async (req, reply) => {
    const body = parse(nameBody, req.body);
    return reply.status(201).send(await admin.createCompany(ctx, req.actor, body.name));
  });
  app.patch("/admin/companies/:id", guarded, async (req, reply) => {
    const { id } = parse(z.object({ id: pos }), req.params);
    return reply.send(await admin.updateCompany(ctx, req.actor, id, parse(companyPatch, req.body)));
  });
  app.delete("/admin/companies/:id", guarded, async (req, reply) => {
    const { id } = parse(z.object({ id: pos }), req.params);
    await admin.deleteCompany(ctx, req.actor, id);
    return reply.status(204).send();
  });
  app.post("/admin/departments", guarded, async (req, reply) => {
    const body = parse(departmentCreate, req.body);
    return reply.status(201).send(await admin.createDepartment(ctx, req.actor, body));
  });
  app.patch("/admin/departments/:id", guarded, async (req, reply) => {
    const { id } = parse(z.object({ id: pos }), req.params);
    return reply.send(await admin.updateDepartment(ctx, req.actor, id, parse(departmentPatch, req.body)));
  });
  app.delete("/admin/departments/:id", guarded, async (req, reply) => {
    const { id } = parse(z.object({ id: pos }), req.params);
    await admin.deleteDepartment(ctx, req.actor, id);
    return reply.status(204).send();
  });
  app.post("/admin/departments/:id/channel", guarded, async (req, reply) => {
    const { id } = parse(z.object({ id: pos }), req.params);
    return reply.status(201).send(await admin.createDepartmentChannel(ctx, req.actor, id));
  });
  app.post("/admin/departments/:id/managers", guarded, async (req, reply) => {
    const { id } = parse(z.object({ id: pos }), req.params);
    const body = parse(managerBody, req.body);
    return reply.status(201).send(await admin.addDepartmentManager(ctx, req.actor, id, body.user_id));
  });
  app.delete("/admin/departments/:id/managers", guarded, async (req, reply) => {
    const { id } = parse(z.object({ id: pos }), req.params);
    const q = parse(z.object({ user_id: uuid }), req.query);
    await admin.removeDepartmentManager(ctx, req.actor, id, q.user_id);
    return reply.status(204).send();
  });
  app.post("/admin/locations", guarded, async (req, reply) => {
    const body = parse(locationCreate, req.body);
    return reply.status(201).send(await admin.createLocation(ctx, req.actor, body));
  });
  app.patch("/admin/locations/:id", guarded, async (req, reply) => {
    const { id } = parse(z.object({ id: pos }), req.params);
    return reply.send(await admin.updateLocation(ctx, req.actor, id, parse(locationPatch, req.body)));
  });
  app.delete("/admin/locations/:id", guarded, async (req, reply) => {
    const { id } = parse(z.object({ id: pos }), req.params);
    await admin.deleteLocation(ctx, req.actor, id);
    return reply.status(204).send();
  });
  app.post("/admin/company-links", guarded, async (req, reply) => {
    const body = parse(linkCreate, req.body);
    const result = await admin.createCompanyLink(ctx, req.actor, { company_ids: [...body.company_ids], dry_run: body.dry_run });
    return reply.status(body.dry_run ? 200 : 201).send(result);
  });
  app.post("/admin/company-links/:id/revoke", guarded, async (req, reply) => {
    const { id } = parse(z.object({ id: pos }), req.params);
    return reply.send(await admin.revokeCompanyLink(ctx, req.actor, id));
  });
  app.get("/admin/approval-rules", guarded, async (req, reply) => reply.send(await admin.getApprovalRules(ctx, req.actor)));
  app.patch("/admin/approval-rules", guarded, async (req, reply) => {
    const body = parse(rulesPatch, req.body);
    return reply.send(await admin.updateApprovalRules(ctx, req.actor, body));
  });
}
