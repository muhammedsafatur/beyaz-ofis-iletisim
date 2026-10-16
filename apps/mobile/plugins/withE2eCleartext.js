// Yalnızca test derlemeleri için: E2E_CLEARTEXT=1 ile prebuild edilirse Android'de düz HTTP trafiğine izin verir.
// Android 9+ release derlemelerinde düz HTTP varsayılan olarak engellenir; yerel test API'si (http://localhost:3000)
// bu yüzden "Network request failed" verir. Üretim derlemesinde bu değişken yoktur ve HTTP engelli kalır.
const { withAndroidManifest } = require("expo/config-plugins");

module.exports = (config) =>
  withAndroidManifest(config, (mod) => {
    if (process.env.E2E_CLEARTEXT === "1") {
      const application = mod.modResults.manifest.application?.[0];
      if (application) {
        application.$["android:usesCleartextTraffic"] = "true";
      }
    }
    return mod;
  });
