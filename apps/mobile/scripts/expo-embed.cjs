// Android yerel derlemesi için Expo CLI sarmalayıcısı (pnpm monorepo).
// React Native Gradle eklentisi giriş dosyasını uygulama klasörüne göreli verir (index.ts), Expo CLI ise
// bunu monorepo kökünden çözmeye çalışır ve bulamaz. Sarmalayıcı --entry-file değerini mutlak yola çevirir,
// sonra gerçek Expo CLI'yi aynı argümanlarla çalıştırır. Yalnızca Gradle tarafından çağrılır.
// Kullanım: node scripts/expo-embed.cjs <expo-cli yolu> export:embed ...
const path = require("node:path");

const [, , cliArg, ...args] = process.argv;
const cliPath = path.resolve(process.cwd(), cliArg);

const entryIndex = args.indexOf("--entry-file");
if (entryIndex !== -1 && entryIndex + 1 < args.length) {
  args[entryIndex + 1] = path.resolve(process.cwd(), args[entryIndex + 1]);
}

process.argv = [process.argv[0], cliPath, ...args];
require(cliPath);
