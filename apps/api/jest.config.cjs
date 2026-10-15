// Jest: spec 10 test aracı. Paket ESM (type: module) olduğu için yapılandırma CJS.
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  // Kaynak dosyalar "./x.js" biçiminde import ediyor; Jest için uzantıyı kaldır.
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
          esModuleInterop: true,
          types: ["node", "jest"],
        },
      },
    ],
  },
};
