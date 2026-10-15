// API yanıtlarının istemci tarafı görünümü (spec v0.7, OpenAPI). Tarihler JSON'da ISO metin olarak gelir.

export interface UserSummary {
  user_id: string;
  first_name: string;
  last_name: string;
  job_title: string | null;
  is_active: boolean;
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface ConversationSummary {
  conversation_id: string;
  type: "direct" | "group" | "department";
  name: string | null;
  last_message_at: string | null;
  unread_count: number;
  is_muted: boolean;
  updated_at: string;
}

export interface ConversationMember {
  user: UserSummary;
  joined_at: string;
  left_at: string | null;
  // K1: yalnızca isteği yapanın kendi kaydında dolu
  last_read_at: string | null;
}

export interface Conversation extends ConversationSummary {
  department_id: number | null;
  company_context_id: number | null;
  members: ConversationMember[];
}

export interface Message {
  message_id: string;
  conversation_id: string;
  sender: UserSummary | null;
  client_message_id: string;
  seq: number;
  change_seq: number;
  content: string | null;
  message_type: "text" | "system";
  sent_at: string;
  edited_at: string | null;
  deleted: boolean;
  edit_window_closes_at: string | null;
  // K2: yalnızca gönderenin kendi mesajlarında dolu
  read_count: number | null;
  read_by_peer: boolean | null;
  // Faz 2: bağlı dosya eki
  attachment: AttachmentMeta | null;
  // @ anma: anılan kullanıcı kimlikleri
  mentions: string[];
}

export interface MessagePage {
  items: Message[];
  has_more: boolean;
}

export interface ConversationPage {
  items: ConversationSummary[];
  next_cursor: string | null;
}

export interface AttachmentMeta {
  attachment_id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
}

export interface TicketComment {
  comment_id: number;
  author: UserSummary | null;
  body: string;
  created_at: string;
}

export interface AuditEntry {
  audit_id: number;
  actor: UserSummary | null;
  entity_type: string;
  entity_id: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditPage {
  items: AuditEntry[];
  next_cursor: string | null;
}

export interface ApprovalRulesView {
  request_expiry_hours: number;
  access_window_hours: number;
  message_rate_per_min: number;
  ticket_rate_per_hour: number;
}

export interface Department {
  department_id: number;
  company_id: number;
  name: string;
  description: string | null;
}

export interface AccessRequestTarget {
  department_id: number;
  status: "pending" | "approved" | "rejected" | "expired";
  decided_by: UserSummary | null;
  decision_basis: "content" | "meta" | null;
  decided_at: string | null;
}

export interface AccessRequestSummary {
  request_id: string;
  conversation_id: string;
  conversation_name: string | null;
  requester: UserSummary | null;
  status: "pending" | "approved" | "rejected" | "withdrawn" | "expired";
  reopened_from: string | null;
  created_at: string;
  expires_at: string;
  meta: {
    conversation_type: "direct" | "group" | "department";
    conversation_name: string | null;
    requester_department_ids: number[];
    member_count: number;
    message_count: number;
    first_message_at: string | null;
    last_message_at: string | null;
    reason: string;
    target_department_ids: number[];
  };
}

export interface AccessRequestDetail extends AccessRequestSummary {
  reason: string;
  targets: AccessRequestTarget[];
  access_expires_at: string | null;
}

export interface TicketSummary {
  ticket_id: string;
  requester: UserSummary | null;
  target_department_id: number;
  title: string;
  status: "pending" | "approved" | "rejected" | "withdrawn" | "expired";
  reopened_from: string | null;
  created_at: string;
  expires_at: string;
  closed_at: string | null;
}

export interface TicketDetail extends TicketSummary {
  body: string | null;
  edit_window_closes_at: string | null;
  decisions: { decided_by: UserSummary | null; decision: "approved" | "rejected"; note: string | null; decided_at: string }[];
}
