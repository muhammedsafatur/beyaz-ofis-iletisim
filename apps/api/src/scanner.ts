import net from "node:net";

// Dosya tarama arayüzü. Üretimde ClamAV (clamd) bağlanır; geliştirmede tarama yoktur ve bu açıkça günlüklenir.
export type Verdict = "clean" | "infected";

export interface Scanner {
  scan(data: Buffer): Promise<Verdict>;
}

export const noScanner: Scanner = {
  async scan() {
    return "clean";
  },
};

const CHUNK = 64 * 1024;

// clamd INSTREAM protokolü: "zINSTREAM\0", ardından [uint32 uzunluk][veri] parçaları, sonda 0 uzunluk.
// Yanıt "stream: OK" ya da "stream: <imza> FOUND" biçimindedir.
export function clamdScanner(opts: { host: string; port: number; timeoutMs?: number }): Scanner {
  return {
    scan(data) {
      return new Promise<Verdict>((resolve, reject) => {
        const socket = net.connect({ host: opts.host, port: opts.port });
        const chunks: Buffer[] = [];
        socket.setTimeout(opts.timeoutMs ?? 30_000, () => socket.destroy(new Error("clamd zaman aşımı")));
        socket.on("error", reject);
        socket.on("data", (c) => chunks.push(c));
        socket.on("end", () => {
          const reply = Buffer.concat(chunks).toString("utf8").replace(/\0/g, "").trim();
          if (/ OK$/.test(reply)) resolve("clean");
          else if (/ FOUND$/.test(reply)) resolve("infected");
          else reject(new Error(`clamd yanıtı anlaşılmadı: ${reply}`));
        });
        socket.on("connect", () => {
          socket.write("zINSTREAM\0");
          for (let off = 0; off < data.length; off += CHUNK) {
            const chunk = data.subarray(off, off + CHUNK);
            const len = Buffer.alloc(4);
            len.writeUInt32BE(chunk.length, 0);
            socket.write(len);
            socket.write(chunk);
          }
          socket.write(Buffer.alloc(4));
        });
      });
    },
  };
}
