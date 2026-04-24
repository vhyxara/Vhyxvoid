// packages/shared/src/index.ts
//
// This package is the bridge between the Identity module and the Hub process.
// Both apps/api and apps/hub import from here — never from each other directly.
//
// What lives here:
//   - ValidateApiKeyUseCase (hub calls this on every agent + SDK auth)
//   - buildValidateApiKeyUseCase factory (wires dependencies, hub calls this in main.ts)
//   - Re-exports of all types the hub needs from the identity module
//   - Shared Redis + Prisma client factories

export * from "./validateApiKey";
export * from "./types";
export * from "./clients";
