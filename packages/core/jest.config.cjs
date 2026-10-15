// Core testleri: API istemcisi ve senkronizasyon motoru. Sahte fetch ile çalışır, ağ gerektirmez.
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: { "^(\.{1,2}/.*)\.js$": "$1" },
  transform: {
    "^.+\.ts$": ["ts-jest", { tsconfig: { module: "commonjs", moduleResolution: "node", esModuleInterop: true, types: ["node", "jest"] } }],
  },
};
