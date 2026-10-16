// Android yerel derlemesi için pnpm monorepo ayarı (yalnızca Android).
// 1) JS paketleyicisi scripts/expo-embed.cjs üzerinden çalışır; bu sarmalayıcı göreli giriş dosyasını mutlak yola çevirir.
// 2) hermesc yolu boşluksuzdur. Gradle hermesc komutunu cmd ile tırnaksız çalıştırır; kullanıcı klasörü
//    "Muhammed Safa Tur" gibi boşluk içerdiğinde mutlak yol kırılır. node_modules üzerinden göreli yol kullanılır.
const { withAppBuildGradle } = require("expo/config-plugins");

const NODE_EXECUTABLE_LINE = 'nodeExecutableAndArgs = ["node", "scripts/expo-embed.cjs"]';
const HERMES_COMMAND = "node_modules/react-native/sdks/hermesc/%OS-BIN%/hermesc";

module.exports = (config) =>
  withAppBuildGradle(config, (mod) => {
    let contents = mod.modResults.contents;
    // Şablonda yorum satırı olarak "nodeExecutableAndArgs" geçer; bu yüzden etkin satır aranır.
    if (!contents.includes("scripts/expo-embed.cjs")) {
      contents = contents.replace(/^react \{\n/m, `react {\n    ${NODE_EXECUTABLE_LINE}\n`);
    }
    // Şablondaki hermesCommand ataması, eklentinin kendi atamasından sonra gelir; değeri doğrudan değiştirilir.
    if (!contents.includes(HERMES_COMMAND)) {
      contents = contents.replace(/^(\s*)hermesCommand = .*$/m, `$1hermesCommand = "${HERMES_COMMAND}"`);
    }
    mod.modResults.contents = contents;
    return mod;
  });
