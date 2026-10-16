// pnpm monorepo'da React Native otomatik bağlama adımı, expo paketinin react-native.config.js dosyasındaki
// packageImportPath değerini alamıyor ve Android paket adını (expo.core) namespace'ten türetiyor; bu sınıf
// SDK 52'de yok. Doğru Expo modül paketi (expo.modules.ExpoModulesPackage) burada açıkça verilir.
module.exports = {
  dependencies: {
    expo: {
      platforms: {
        android: {
          packageImportPath: "import expo.modules.ExpoModulesPackage;",
          packageInstance: "new ExpoModulesPackage()",
        },
      },
    },
  },
};
