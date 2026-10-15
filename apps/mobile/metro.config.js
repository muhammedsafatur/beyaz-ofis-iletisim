const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
// Monorepo kökü: packages/* kaynaklarının Metro tarafından izlenmesi için.
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
  // pnpm geçişli bağımlılıkları (ör. @babel/runtime) bu klasörde yayınlar.
  path.resolve(workspaceRoot, "node_modules/.pnpm/node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
