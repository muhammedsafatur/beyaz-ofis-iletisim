const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Base64 metni baytlara çevirir (React Native'de Buffer yoktur). Geçersiz karakterler atlanır.
export function base64ToBytes(b64: string): Uint8Array {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of b64) {
    const value = ALPHABET.indexOf(ch);
    if (value < 0) continue;
    buffer = ((buffer << 6) | value) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}
