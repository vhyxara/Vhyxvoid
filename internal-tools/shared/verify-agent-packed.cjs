// Stand-in hub + local backends that drive a packed agent (CLI, middleware or next) and record
// what the agent actually puts on the wire. Written 2026-09-21 for the agent 1.0.20 / next+middleware 1.0.5 publish round.
// Usage: node internal-tools/shared/verify-agent-packed.cjs <label> <cli|middleware|next> <projectDirWithThePackageInstalled> <basePort>
// Takes ~40 s (a 33 s slow backend). Uses ws from the repo's node_modules; the package under test can be a packed tarball or from npm.
const { spawn } = require('node:child_process')
const http = require('node:http')
const path = require('node:path')
const repoRoot = path.resolve(__dirname, '../..')
const { WebSocketServer, WebSocket } = require(require.resolve('ws', { paths: [repoRoot] }))

const [name, kind, dir, base] = process.argv.slice(2)
const HUB = Number(base), BE = Number(base) + 1, WSBE = Number(base) + 2
const SLEEP = Number(process.env.SLEEP_MS || 33000)
const out = []
const log = (...a) => out.push(a.join(' '))

// ── local backends ──
const beServer = http.createServer((req, res) => setTimeout(() => res.end('late'), SLEEP)).listen(BE)
const backendSockets = []
const wsBackend = new WebSocketServer({ server: beServer })   // agent forwards to ONE port: HTTP and WS share it
wsBackend.on('connection', (sock, req) => {
  backendSockets.push(sock)
  sock.__closed = new Promise(r => sock.on('close', code => r(code)))
  if (req.url === '/burst') {
    for (let i = 1; i <= 6; i++) sock.send('frame-' + i)   // rapid burst, same tick
    sock.close(1000, 'done')                                  // close right behind it: must not overtake the frames
  }
})

// ── stand-in hub ──
const wss = new WebSocketServer({ port: HUB })
let agentWs
const seen = { topWsMsgs: [], batchedWsMsgs: [], order: [], http: null, closeAfterFrames: null }
const waiters = []
const wait = (pred, ms) => new Promise(r => { const t0 = Date.now(); const iv = setInterval(() => { if (pred() || Date.now() - t0 > ms) { clearInterval(iv); r(pred()) } }, 50) })

wss.on('connection', ws => {
  agentWs = ws
  ws.on('message', raw => {
    const m = JSON.parse(raw.toString())
    if (m.type === 'agent:register') {
      ws.send(JSON.stringify({ v: '1', type: 'hub:registered', agentId: 'a1', accountId: 'acc', replayPending: false, tunnelUrl: 'https://x--default.vhyxvoid.com' }))
      return
    }
    const items = m.type === 'agent:batch' ? m.messages : [m]
    for (const it of items) {
      const where = m.type === 'agent:batch' ? 'batch' : 'top'
      if (it.type === 'tunnel:ws:message') { (where === 'top' ? seen.topWsMsgs : seen.batchedWsMsgs).push(it.data); seen.order.push('msg:' + it.data) }
      if (it.type === 'tunnel:ws:close') seen.order.push('close')
      if (it.requestId === 'r1' && (it.type === 'tunnel:response' || it.type === 'tunnel:agent-error')) seen.http = { at: Date.now() - seen.t0, type: it.type, status: it.status, code: it.code, message: it.message, body: it.body }
    }
  })
})

// ── launch the agent ──
const env = { ...process.env, NODE_ENV: 'development', VHYXVOID_API_KEY: '', VHYXVOID_SECRET: '' }
const bootstrap = {
  middleware: `require('@vhyxvoid/middleware').vhyxvoid({key:'k',secret:'s',port:${BE},hub:'ws://localhost:${HUB}',enabled:true});setInterval(()=>{},1e6)`,
  next: `require('@vhyxvoid/next').withVhyxvoid({}, {key:'k',secret:'s',port:${BE},hub:'ws://localhost:${HUB}'});setInterval(()=>{},1e6)`
}
const child = kind === 'cli'
  ? spawn(path.join(dir, 'node_modules/.bin/vhyxvoid'), ['--key', 'k', '--secret', 's', '--port', String(BE), '--hub', `ws://localhost:${HUB}`, '--no-local-discovery', '--queue-path', `/tmp/verify-${HUB}.db`], { cwd: dir, env, stdio: 'ignore' })
  : spawn('node', ['-e', bootstrap[kind]], { cwd: dir, env, stdio: 'ignore' })

;(async () => {
  if (!(await wait(() => agentWs, 8000))) { console.log(`${name}: agent never connected`); process.exit(1) }
  await new Promise(r => setTimeout(r, 500))

  // T1: hub-configured timeout above 28 s
  seen.t0 = Date.now()
  agentWs.send(JSON.stringify({ v: '1', type: 'tunnel:forward', requestId: 'r1', method: 'GET', path: '/slow', query: '', headers: {}, body: null, timeoutMs: 60000 }))

  // T2: burst + ordering (runs concurrently with T1's wait)
  agentWs.send(JSON.stringify({ v: '1', type: 'tunnel:ws:open', connectionId: 'c-burst', path: '/burst', query: '', headers: {} }))
  await wait(() => seen.order.includes('close') || seen.batchedWsMsgs.length + seen.topWsMsgs.length >= 6, 4000)
  await new Promise(r => setTimeout(r, 400))
  const total = seen.topWsMsgs.length + seen.batchedWsMsgs.length

  // T1 result (must be in before the link is dropped)
  await wait(() => seen.http, SLEEP + 15000)

  // T3: agent<->hub link drop must close backend sockets
  agentWs.send(JSON.stringify({ v: '1', type: 'tunnel:ws:open', connectionId: 'c-hold', path: '/hold', query: '', headers: {} }))
  await wait(() => backendSockets.length >= 2, 3000)
  const held = backendSockets[backendSockets.length - 1]
  agentWs.terminate()
  const heldClosed = await Promise.race([held.__closed.then(() => true), new Promise(r => setTimeout(() => r(false), 3000))])

  const idx = s => seen.order.indexOf(s)
  const lastMsg = seen.order.filter(x => x.startsWith('msg:')).length ? Math.max(...seen.order.map((x, i) => (x.startsWith('msg:') ? i : -1))) : -1
  console.log(`\n### ${name}`)
  console.log(`T1 timeout, hub budget 60000 ms, backend takes ${SLEEP} ms -> ${seen.http ? `${seen.http.type} after ${seen.http.at} ms: ${seen.http.status ?? seen.http.code} ${seen.http.body ?? seen.http.message ?? ''}` : 'NO ANSWER'}`)
  console.log(`T2 burst of 6 frames + immediate close -> top-level ws messages: ${seen.topWsMsgs.length}, inside agent:batch: ${seen.batchedWsMsgs.length}`)
  console.log(`   delivered by a hub that only reads top-level ws messages (the pre-fix hub): ${seen.topWsMsgs.length}/6`)
  console.log(`   close arrived after the last frame: ${idx('close') === -1 ? 'no close seen' : idx('close') > lastMsg}`)
  console.log(`T3 backend socket closed after the hub link dropped: ${heldClosed}`)
  child.kill(); process.exit(0)
})()
