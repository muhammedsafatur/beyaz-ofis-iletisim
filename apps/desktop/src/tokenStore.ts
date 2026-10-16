import { createMemoryTokenStore, type TokenStore, type Tokens } from "@beyaz-ofis/core";

// Electron köprüsü (preload) varsa belirteçler işletim sisteminin safeStorage'ı ile şifreli saklanır.
// Tarayıcıda (geliştirme, e2e) köprü yoktur ve bellek içi depo kullanılır.
interface DesktopBridge {
  tokens: {
    load(): Promise<Tokens | null>;
    save(tokens: Tokens): Promise<void>;
    clear(): Promise<void>;
  };
}

export function desktopTokenStore(): TokenStore {
  const bridge = (window as unknown as { beyazOfis?: DesktopBridge }).beyazOfis?.tokens;
  return bridge ?? createMemoryTokenStore();
}
