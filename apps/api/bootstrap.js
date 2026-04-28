const path = require('path');
const { register } = require('tsconfig-paths');

register({
  baseUrl: __dirname,
  paths: {
    "@/*": ["dist/*"],
    "@/generated/prisma": ["../../packages/shared/generated/prisma"],
    "@/generated/prisma/*": ["../../packages/shared/generated/prisma/*"],
    "@platform/shared": ["../../packages/shared/dist"],
    "@platform/protocol": ["../../packages/protocol/dist"]
  }
});

require('./dist/server.js');
