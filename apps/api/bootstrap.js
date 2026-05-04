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

require("./dist/server.js");
