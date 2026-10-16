import { clamdScanner } from "./scanner.js";

// Gerçek clamd testi: CLAMD_TEST_PORT tanımlıysa çalışır (ör. yerel clamd 3310). Değilse atlanır.
const port = process.env.CLAMD_TEST_PORT ? Number(process.env.CLAMD_TEST_PORT) : undefined;
const live = port ? describe : describe.skip;

// Standart EICAR test dizgisi: zararsızdır, antivirüsler "bulaşık" olarak işaretler.
// Dosyada tek parça durmaması için çalışma zamanında birleştirilir.
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$" + "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

// CRC-32 (ZIP başlıkları için).
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Sıkıştırmasız (stored) ZIP. ClamAV arşiv içindeki girdileri de tarar; EICAR yalnızca bu yolla
// çok parçalı bir akışın içinde işaretlenebilir (düz metin içine gömülü EICAR işaretlenmez).
function zipStored(entries: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, e.data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x21, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(e.data.length, 20);
    dir.writeUInt32LE(e.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += 30 + name.length + e.data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

live("gerçek clamd (INSTREAM)", () => {
  const scanner = clamdScanner({ host: "127.0.0.1", port: port! });
  // 64 KB'ı aşan ve tarayıcının birden çok parça göndermesini zorlayan girdi
  const filler = Buffer.alloc(200 * 1024, 0x61);

  it("temiz içerik clean döner", async () => {
    expect(await scanner.scan(Buffer.from("Merhaba, bu bir rapor."))).toBe("clean");
  });

  it("EICAR test dosyası infected döner", async () => {
    expect(await scanner.scan(Buffer.from(EICAR))).toBe("infected");
  });

  it("birden çok parçaya bölünen temiz içerik clean döner", async () => {
    const zip = zipStored([{ name: "rapor.txt", data: filler }, { name: "not.txt", data: Buffer.from("merhaba") }]);
    expect(zip.length).toBeGreaterThan(64 * 1024);
    expect(await scanner.scan(zip)).toBe("clean");
  });

  it("birden çok parçaya bölünen arşivde EICAR infected döner", async () => {
    const zip = zipStored([{ name: "rapor.txt", data: filler }, { name: "eicar.com", data: Buffer.from(EICAR) }]);
    expect(zip.length).toBeGreaterThan(64 * 1024);
    expect(await scanner.scan(zip)).toBe("infected");
  });
});
