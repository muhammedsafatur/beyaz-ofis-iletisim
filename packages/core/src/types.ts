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
}

export interface MessagePage {
  items: Message[];
  has_more: boolean;
}

export interface ConversationPage {
  items: ConversationSummary[];
  next_cursor: string | null;
}
