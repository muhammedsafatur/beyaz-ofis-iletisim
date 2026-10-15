import { ApiRequestError, createApiClient, SyncEngine } from "@beyaz-ofis/core";
import { desktopTokenStore } from "./tokenStore";

// Geliştirmede Vite proxy'si /api isteklerini yerel API'ye iletir. Paketlenmiş sürümde VITE_API_URL verilir.
export const API_URL: string = import.meta.env.VITE_API_URL ?? "/api/v1";
export const POLL_MS = 3000;
// Gerçek zamanlı bağlantı açıkken yedek yoklama bu aralıkta sürer (hibrit senkron).
export const POLL_CONNECTED_MS = 30000;

// Tek belirteç deposu: istemci ve açılış kontrolü aynı örneği kullanır.
export const tokenStore = desktopTokenStore();
export const api = createApiClient({ baseUrl: API_URL, tokens: tokenStore });
export const engine = new SyncEngine(api);

export function errorText(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.code === "RATE_LIMITED" && err.retryAfter) return `Çok hızlı gönderiyorsunuz. ${err.retryAfter} sn sonra deneyin.`;
    return err.message;
  }
  return err instanceof Error ? err.message : "Bir hata oluştu.";
}
