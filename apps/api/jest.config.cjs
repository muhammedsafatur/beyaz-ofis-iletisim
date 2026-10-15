// Jest: spec 10 test aracı. Paket ESM (type: module); PGlite dinamik import kullandığı için ESM modu zorunlu.
module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  // Kaynak dosyalar "./x.js" biçiminde import ediyor; Jest için uzantıyı kaldır.
  moduleNameMapper: { "^(\.{1,2}/.*)\.js$": "$1" },
  transform: {
    "^.+\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          module: "ESNext",
          moduleResolution: "node",
          esModuleInterop: true,
          types: ["node", "jest"],
        },
      },
    ],
  },
};
