# Publish: @vhyxvoid/agent 1.0.19, @vhyxvoid/next 1.0.4, @vhyxvoid/middleware 1.0.4

Prepared 2026-09-19 at commit `a91d383`. Run by the user; nothing here has been run.
sdk is NOT part of this round.

```bash
# 0. From the repo root: confirm you are on the prepared commit, logged in, and that
#    the versions on npm are still the old ones.
cd /Users/tanveer/Documents/tanveer/Black-Server
git log --oneline -1                      # expect a91d383 or later
npm whoami                                # must be an owner of the @vhyxvoid scope
npm view @vhyxvoid/agent version          # expect 1.0.18
npm view @vhyxvoid/next version           # expect 1.0.3
npm view @vhyxvoid/middleware version     # expect 1.0.3

# 1. agent (first, by convention; the wrappers do not depend on it at runtime)
cd packages/agent
npm publish --access public --dry-run     # optional: rebuilds via prepublishOnly, lists the files
npm publish --access public               # add --otp=<code> if your account uses 2FA
npm view @vhyxvoid/agent version          # expect 1.0.19
npm view @vhyxvoid/agent@1.0.19 dependencies   # expect axios, better-sqlite3, commander, dotenv, ws; no @vhyxvoid/protocol
cd ../..

# 2. next
cd packages/next
npm publish --access public
npm view @vhyxvoid/next version           # expect 1.0.4
npm view @vhyxvoid/next@1.0.4 dependencies     # expect nothing (empty)
cd ../..

# 3. middleware
cd packages/middleware
npm publish --access public
npm view @vhyxvoid/middleware version     # expect 1.0.4
npm view @vhyxvoid/middleware@1.0.4 dependencies   # expect nothing (empty)
cd ../..

# 4. smoke test from npm, in a throwaway directory
cd "$(mktemp -d)" && npm init -y >/dev/null \
  && npm i @vhyxvoid/agent@1.0.19 @vhyxvoid/next@1.0.4 @vhyxvoid/middleware@1.0.4 \
  && npx vhyxvoid --version                # expect 1.0.19
```
