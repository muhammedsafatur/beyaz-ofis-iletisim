import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Dosya deposu arayüzü. Üretimde nesne deposu ile değiştirilebilir (karar bekliyor, bkz. öneri notları).
export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

// Anahtarlar yalnızca UUID ve kısa karakterlerle sınırlanır; yol geçişi (../) engellenir.
function safeKey(key: string): string {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(key)) throw new Error("Geçersiz depo anahtarı.");
  return key;
}

export function createLocalStorage(dir: string): FileStorage {
  return {
    async put(key, data) {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, safeKey(key)), data);
    },
    async get(key) {
      return readFile(path.join(dir, safeKey(key)));
    },
  };
}

export function createMemoryStorage(): FileStorage {
  const files = new Map<string, Buffer>();
  return {
    async put(key, data) {
      files.set(safeKey(key), data);
    },
    async get(key) {
      const d = files.get(safeKey(key));
      if (!d) throw new Error("Dosya bulunamadı.");
      return d;
    },
  };
}
