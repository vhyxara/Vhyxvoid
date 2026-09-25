// Stand-in hub + local backends that drive an INSTALLED agent (CLI, middleware or next) to check the
// 2026-09-25 fix set on the real published/packed bytes. Written for the agent 1.1.0 / next 1.1.0 /
// middleware 2.0.0 publish round (audit part2 G1, G3, G4, G7).
// Usage: node internal-tools/shared/verify-agent-packed-2026-09-25.cjs <label> <cli|middleware|next> <projectDir> <basePort>
//   T_HELD  (G3) a response that finishes while the hub link is down is delivered after re-registering,
//               and (CLI) its body is never written to the queue file
//   T_BATCH (G4) eleven ~10 MB responses finishing together arrive without the hub closing the link (1009)
//   T_DEAD  (G1, cli only) the installed DurableQueue dead-letters after maxAttempts
const { spawn } = require('node:child_process')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const repoRoot = path.resolve(__dirname, '../..')
const { WebSocketServer } = require(require.resolve('ws', { paths: [repoRoot] }))

const [name, kind, dir, base] = process.argv.slice(2)
const HUB = Number(base), BE = Number(base) + 1
const MARK = 'HELD-BODY-MARKER-' + base
const TEN_MB = 10 * 1024 * 1024
const bigBody = Buffer.alloc(TEN_MB, 7)
const bigWaiting = []
const out = []
const log = (...a) => out.push('  ' + a.join(' '))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const wait = (pred, ms) => new Promise((r) => { const t0 = Date.now(); const iv = setInterval(() => { if (pred() || Date.now() - t0 > ms) { clearInterval(iv); r(pred()) } }, 50) })

// ── local backend ──
http.createServer((req, res) => {
  if (req.url === '/held') return setTimeout(() => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ session: MARK })) }, 3000)
  // Hold every /big request until all eleven have arrived, then answer them in the same tick, so they
  // finish inside one batch window deterministically (not dependent on read/encode timing).
  if (req.url.startsWith('/big')) {
    res.setHeader('content-type', 'application/octet-stream')
    bigWaiting.push(res)
    if (bigWaiting.length === 11) for (const r of bigWaiting.splice(0)) r.end(bigBody)
    return
  }
  res.end('ok')
}).listen(BE)

// ── stand-in hub (ws default maxPayload is 100 MiB, the same as HubServer.ts) ──
const wss = new WebSocketServer({ port: HUB })
let agentWs = null, connections = 0, holdRegistration = false
const responses = new Map() // requestId -> { conn, bytes }
const closes = []
wss.on('connection', (ws) => {
  const conn = ++connections
  agentWs = ws
  ws.on('close', (code) => closes.push({ conn, code }))
  ws.on('error', (err) => closes.push({ conn, code: err.code + ' ' + (err[Object.getOwnPropertySymbols(err)[0]] ?? '') }))
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString())
    if (m.type === 'agent:register') {
      const reply = () => ws.send(JSON.stringify({ v: '1', type: 'hub:registered', agentId: 'a' + conn, accountId: 'acc', replayPending: false, tunnelUrl: 'https://x--default.vhyxvoid.com' }))
      if (holdRegistration) setTimeout(reply, 4000) // keep the agent un-registered while the backend answers
      else reply()
      return
    }
    for (const it of m.type === 'agent:batch' ? m.messages : [m]) {
      if (it.type === 'tunnel:response' || it.type === 'tunnel:agent-error') responses.set(it.requestId, { conn, type: it.type, bytes: it.body ? it.body.length : 0, body: it.body })
    }
  })
})
const forward = (requestId, p) => agentWs.send(JSON.stringify({ v: '1', type: 'tunnel:forward', requestId, method: 'GET', path: p, query: '', headers: {}, body: null, timeoutMs: 60000 }))

// ── launch the agent ──
const queuePath = `/tmp/verify-0925-${HUB}.db`
for (const f of [queuePath, queuePath + '-wal', queuePath + '-shm']) fs.rmSync(f, { force: true })
const env = { ...process.env, NODE_ENV: 'development', VHYXVOID_API_KEY: '', VHYXVOID_SECRET: '' }
delete env.CI
const bootstrap = {
  middleware: `require('@vhyxvoid/middleware').vhyxvoid({key:'k',secret:'s',port:${BE},hub:'ws://localhost:${HUB}',enabled:true});setInterval(()=>{},1e6)`,
  next: `require('@vhyxvoid/next').withVhyxvoid({}, {key:'k',secret:'s',port:${BE},hub:'ws://localhost:${HUB}'});setInterval(()=>{},1e6)`,
}
const child = kind === 'cli'
  ? spawn(path.join(dir, 'node_modules/.bin/vhyxvoid'), ['--key', 'k', '--secret', 's', '--port', String(BE), '--hub', `ws://localhost:${HUB}`, '--no-local-discovery', '--queue-path', queuePath], { cwd: dir, env, stdio: 'ignore' })
  : spawn('node', ['-e', bootstrap[kind]], { cwd: dir, env, stdio: 'ignore' })

;(async () => {
  if (!(await wait(() => agentWs, 8000))) { console.log(`${name}: agent never connected`); child.kill(); process.exit(1) }
  await sleep(500)

  // T_HELD: forward, then drop the link before the backend answers (3 s); the agent reconnects after ~1 s
  // but is only registered at ~5 s, so the response finishes while it is not registered.
  holdRegistration = true
  forward('held-1', '/held')
  await sleep(200)
  agentWs.terminate()
  // At ~4 s the backend has answered (3 s) but the agent is not registered again yet (~5 s): whatever
  // it does with the response is happening now. Check the queue file at this moment.
  await sleep(3800)
  const onDiskDuringOutage = kind === 'cli' && [queuePath, queuePath + '-wal'].filter((f) => fs.existsSync(f)).some((f) => fs.readFileSync(f).includes(MARK))
  await wait(() => responses.has('held-1'), 15000)
  const held = responses.get('held-1')
  holdRegistration = false
  log('T_HELD delivered after reconnect:', held ? `yes (${held.type}, on connection #${held.conn})` : 'NO')
  if (kind === 'cli') {
    log('T_HELD response body in the queue file during the outage:', onDiskDuringOutage)
  }

  // T_BATCH: eleven 10 MB responses at once
  const conn0 = connections
  for (let i = 0; i < 11; i++) forward('big-' + i, '/big' + i)
  await wait(() => [...Array(11).keys()].every((i) => responses.has('big-' + i)) || closes.some((c) => c.conn === conn0), 30000)
  const got = [...Array(11).keys()].filter((i) => responses.has('big-' + i) && responses.get('big-' + i).conn === conn0).length
  const closed = closes.find((c) => c.conn === conn0)
  log('T_BATCH 10 MB responses delivered on the same connection:', `${got}/11`, closed ? `| hub link closed with ${closed.code}` : '| link still open')

  // T_DEAD: dead-lettering is unreachable through the shipped package (nothing enqueues inbound items,
  // and the per-file dist/queue/*.js can't load: it requires @vhyxvoid/protocol, a devDependency), so
  // check that the bundles the package actually runs carry the fixed SQL.
  if (kind === 'cli') {
    const bundles = ['dist/cli.js', 'dist/AgentClient.js'].map((f) => fs.readFileSync(path.join(dir, 'node_modules/@vhyxvoid/agent', f), 'utf8'))
    log('T_DEAD aliased SQL (max_attempts AS maxAttempts) in cli.js / AgentClient.js:', bundles.map((b) => b.includes('max_attempts AS maxAttempts')).join(' / '),
      '| enqueueOutbound in bundles:', bundles.map((b) => b.includes('enqueueOutbound(')).join(' / '))
  }

  console.log(`${name}:\n${out.join('\n')}`)
  child.kill('SIGKILL')
  wss.close()
  process.exit(0)
})()
