import { pgEnum } from "drizzle-orm/pg-core";

// §3.2
export const userRole = pgEnum("user_role", ["employee", "system_admin"]);

// §3.3
export const conversationType = pgEnum("conversation_type", ["direct", "group", "department"]);

// §3.4
export const messageType = pgEnum("message_type", ["text", "system"]);
export const revisionType = pgEnum("revision_type", ["edit", "delete"]);

// §3.5 ve §3.6: tickets.status ile access_requests.status aynı değer kümesi
export const requestStatus = pgEnum("request_status", [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
  "expired",
]);

// §3.5 ticket_decisions.decision
export const decision = pgEnum("decision", ["approved", "rejected"]);

// §3.6 access_request_targets.status
export const targetStatus = pgEnum("target_status", ["pending", "approved", "rejected", "expired"]);

// §3.6 decision_basis; değer kümesi OpenAPI AccessRequestTarget'tan
export const decisionBasis = pgEnum("decision_basis", ["content", "meta"]);

// §3.6 access_log.action
export const accessLogAction = pgEnum("access_log_action", [
  "read",
  "approve",
  "reject",
  "copy_blocked",
]);
