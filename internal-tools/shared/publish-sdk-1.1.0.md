# Publish: @vhyxvoid/sdk 1.1.0

Prepared 2026-09-19 at commit `2bbfa6b`. Run by the user; nothing here has been run.
Only the sdk. `@vhyxvoid/protocol` does NOT need publishing (it is now inlined into the sdk bundle).

```bash
# 0. From the repo root: confirm the prepared commit, your login, and that npm still has 1.0.1
cd /Users/tanveer/Documents/tanveer/Black-Server
git log --oneline -1                      # expect 2bbfa6b or later
npm whoami                                # must be an owner of the @vhyxvoid scope
npm view @vhyxvoid/sdk version            # expect 1.0.1

# 1. publish (prepublishOnly rebuilds from an empty dist/ and runs check-dist.mjs first)
cd packages/sdk
npm publish --access public --dry-run     # optional: shows the rebuild and the file list
npm publish --access public               # add --otp=<code> if your account uses 2FA
cd ../..

# 2. verify on the registry
npm view @vhyxvoid/sdk version                 # expect 1.1.0
npm view @vhyxvoid/sdk@1.1.0 dependencies      # expect only isomorphic-ws and ws
npm view @vhyxvoid/sdk@1.1.0 exports           # expect types, import (./dist/index.mjs), require (./dist/index.js)

# 3. smoke test from npm in a throwaway directory: ESM import, CJS require, binary Buffer
cd "$(mktemp -d)" && npm init -y >/dev/null && npm i @vhyxvoid/sdk@1.1.0 \
  && cat > t.mjs <<'EOF'
import { createClient } from '@vhyxvoid/sdk'
import http from 'node:http'
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x80])
const s = http.createServer((q, r) => { r.setHeader('content-type', 'image/png'); r.end(png) }).listen(0, async () => {
  const r = await createClient({ baseUrl: 'http://127.0.0.1:' + s.address().port }).get('/')
  console.log('ESM import ok; binary is a Buffer:', Buffer.isBuffer(r.data), 'identical:', r.data.equals(png))
  s.close()
})
EOF
node t.mjs                                # expect: ESM import ok; binary is a Buffer: true identical: true
node -e "console.log('CJS ok', typeof require('@vhyxvoid/sdk').createClient)"
```

Afterwards: the docs follow-up (remove the two "sdk 1.0.1 has two known problems" items from Limitations,
the `require()`/`createRequire` callout and the binary sentence from Quickstart, update verified versions).
Do not start it until 1.1.0 is confirmed live. `pnpm --filter @vhyxvoid/docs check:fresh` is red until then, on purpose.
