# Publish: @vhyxvoid/agent 1.0.20, @vhyxvoid/next 1.0.5, @vhyxvoid/middleware 1.0.5

Prepared 2026-09-21 at commit `377c924` (on top of origin/main). Run by the user; nothing here has been run against npm.
sdk is NOT part of this round (its own unreleased changes: package description, Node-only comments, `TunnelClient` default timeout 120 s). All three packages here are needed: next and middleware inline the agent at build time (their 1.0.4 tarballs still contain `timeout: 28e3` and `batcher.add(frame)`), so they do NOT pick the fixes up until they are republished.

What is in this round (all already in source, none on npm): the agent honors the hub's per-request `timeoutMs` instead of a hardcoded 28 s cap (473b4ff); WebSocket frames are sent immediately and in order instead of through the batcher, backend sockets are closed when the hub link drops, unsendable close codes (1005/1006/1015) are mapped (WS relay Phase 1, agent half). No public API, CLI flag or wire-format change, hence patch bumps.

Deploy order: **hub before agent.** The hub half of Phase 1 (frames inside `agent:batch`, close-code mapping, ownership check, cleanup on agent drop) and the configurable timeout should be live first. A new agent against an OLD hub is still safe: the old hub understands standalone `tunnel:ws:message` frames, and it sends `timeoutMs: 28000`, so the new agent's cap is the same 28 s as before. (Derived from the code and a stand-in hub; not run against the real hub.)

```bash
# 0. From the repo root: prepared commit, login, and that npm still has the old versions.
cd /Users/tanveer/Documents/tanveer/Black-Server
git log --oneline -1                      # expect 377c924 or later
npm whoami                                # must be an owner of the @vhyxvoid scope
npm view @vhyxvoid/agent version          # expect 1.0.19
npm view @vhyxvoid/next version           # expect 1.0.4
npm view @vhyxvoid/middleware version     # expect 1.0.4

# 0b. Hub deployed? On the server, the running hub must be built from 473b4ff and 8c74574 (or later)
#     BEFORE the agent is published. Deploy it the way you normally do (hub first), e.g.:
#       cd ~/Vhyxvoid && git pull && docker compose up -d --build hub
#     Do not publish until the hub is up on that commit.

# 1. agent. Start from an empty dist so a stale bundle cannot ship (prepublishOnly then rebuilds
#    and runs check-dist.mjs, which fails the publish if --version differs from package.json).
cd packages/agent
rm -rf dist tsconfig.tsbuildinfo
npm publish --access public --dry-run     # optional: shows the rebuild, "cli.js --version is 1.0.20", the file list
npm publish --access public               # add --otp=<code> if your account uses 2FA
npm view @vhyxvoid/agent version                # expect 1.0.20
npm view @vhyxvoid/agent@1.0.20 dependencies    # expect axios, better-sqlite3, commander, dotenv, ws; no @vhyxvoid/protocol
cd ../..

# 2. next
cd packages/next
rm -rf dist tsconfig.tsbuildinfo
npm publish --access public
npm view @vhyxvoid/next version                 # expect 1.0.5
npm view @vhyxvoid/next@1.0.5 dependencies      # expect nothing (empty)
cd ../..

# 3. middleware
cd packages/middleware
rm -rf dist tsconfig.tsbuildinfo
npm publish --access public
npm view @vhyxvoid/middleware version           # expect 1.0.5
npm view @vhyxvoid/middleware@1.0.5 dependencies  # expect nothing (empty)
cd ../..

# 4. smoke test FROM NPM, in throwaway directories (one for the CLI, one for the two wrappers)
A="$(mktemp -d)"; W="$(mktemp -d)"
(cd "$A" && npm init -y >/dev/null && npm i @vhyxvoid/agent@1.0.20 && npx vhyxvoid --version)   # expect 1.0.20
(cd "$W" && npm init -y >/dev/null && npm i @vhyxvoid/next@1.0.5 @vhyxvoid/middleware@1.0.5)
ls "$W/node_modules" | grep -c -E '^(better-sqlite3|ws|axios)$'                                   # expect 0 (wrappers install nothing native)

# 4b. the fix is really in the published bytes (old 1.0.19 / 1.0.4 print the opposite: batcher.add(frame)=1, toSendableCloseCode=0, msg.timeoutMs=0):
grep -c 'toSendableCloseCode'     "$A/node_modules/@vhyxvoid/agent/dist/AgentClient.js"        # expect non-zero (3 in the packed tarball; 0 in 1.0.19)
grep -c 'batcher.add(frame)'        "$A/node_modules/@vhyxvoid/agent/dist/AgentClient.js"        # expect 0
grep -c 'msg.timeoutMs'             "$A/node_modules/@vhyxvoid/agent/dist/AgentClient.js"        # expect 1 (BackendProxy is bundled into it)
grep -c 'batcher.add(frame)' "$W/node_modules/@vhyxvoid/next/dist/index.js" "$W"/node_modules/@vhyxvoid/middleware/dist/*.js   # expect 0 in every file

# 5. behavior check against the npm packages, using the stand-in hub harness (~40 s each; run them one after another or in parallel with different base ports):
node internal-tools/shared/verify-agent-packed.cjs "agent 1.0.20 from npm"      cli        "$A" 9800
node internal-tools/shared/verify-agent-packed.cjs "next 1.0.5 from npm"        next       "$W" 9810
node internal-tools/shared/verify-agent-packed.cjs "middleware 1.0.5 from npm"  middleware "$W" 9820
# expect for each: T1 "tunnel:response after ~33000 ms: 200 late" (NOT an agent-error at 28 s);
#                  T2 "top-level ws messages: 6, inside agent:batch: 0", "delivered ... 6/6", "close arrived after the last frame: true";
#                  T3 "backend socket closed after the hub link dropped: true"
```

Afterwards, docs follow-up (do not start until all three are confirmed live): `pnpm --filter @vhyxvoid/docs check:fresh` is red on purpose (31 findings: `verified.packages` for agent/next/middleware). Re-verify against the installed 1.0.20/1.0.5, then update: Troubleshooting (timeout table: the agent's 28 s row becomes "hub budget minus 2 s"; WS section: which fixes are now released), Environment variables ("Your server's own limit can be shorter" bullet), HTTP status codes (the 28 s wording in the 502 row), Limitations ("Request size and time" and the WebSockets section), Webhooks (28 s), Quickstart's 502 row, FAQ "How long can a request take?". Then bump `verified.packages` and `verified.commit`.
