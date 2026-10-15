import type { Tokens } from "./types.js";

// Belirteç saklama arayüzü. Masaüstünde Electron safeStorage, mobilde Keychain/Keystore uygulanır (§10).
// Düz AsyncStorage ya da localStorage kullanılmaz; bu yüzden uygulama bu arayüzü dışarıdan alır.
export interface TokenStore {
  load(): Promise<Tokens | null>;
  save(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}

// Bellek içi uygulama: yalnızca test ve geliştirme için. Kalıcı değildir.
export function createMemoryTokenStore(initial: Tokens | null = null): TokenStore {
  let current = initial;
  return {
    async load() {
      return current;
    },
    async save(tokens) {
      current = tokens;
    },
    async clear() {
      current = null;
    },
  };
}
