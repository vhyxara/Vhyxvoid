// The one place the agent's version is defined. Everything that reports it
// (`vhyxvoid --version`, the startup banner, the `agent:register` message the
// hub records) reads AGENT_VERSION, which comes from this package's own
// package.json. Callers no longer pass a version in, so there is no second copy
// to go stale.
//
// package.json is inlined into each bundle at build time, so a bundle is only
// as fresh as its build. The agent, next and middleware build scripts bundle
// from src/ on every run, and scripts/check-dist.mjs fails the build if
// `dist/cli.js --version` disagrees with package.json.
import { version } from "../package.json";

export const AGENT_VERSION: string = version;
