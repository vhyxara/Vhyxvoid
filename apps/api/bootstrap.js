const path = require("path");
const { register } = require("tsconfig-paths");

register({
  baseUrl: __dirname,
  paths: {
    "@/*": ["dist/*"],
    "@/generated/prisma": ["../../packages/shared/generated/prisma"],
    "@/generated/prisma/*": ["../../packages/shared/generated/prisma/*"],
    "@vhyxvoid/shared": ["../../packages/shared/dist"],
    "@vhyxvoid/protocol": ["../../packages/protocol/dist"],
  },
});

// `node bootstrap.js seed` runs the compiled seed (abilities, roles, super
// admin from SUPER_ADMIN_*) inside the production image, where tsx and the
// TypeScript sources are not present. Anything else starts the server.
const scripts = {
  "seed:abilities": "./dist/modules/identity/infrastructure/scripts/seed-abilities.js",
  "seed:roles": "./dist/modules/identity/infrastructure/scripts/seed-roles.js",
  "seed:admin": "./dist/modules/identity/infrastructure/scripts/seed-super-admin.js",
};
const command = process.argv[2];

if (command === "seed") {
  // Each step is its own process: every script disconnects and exits itself.
  const { spawnSync } = require("child_process");
  for (const step of Object.keys(scripts)) {
    const r = spawnSync(process.execPath, [__filename, step], { stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
} else {
  require(scripts[command] ?? "./dist/server.js");
}
