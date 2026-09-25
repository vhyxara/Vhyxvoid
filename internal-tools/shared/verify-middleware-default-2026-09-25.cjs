// Checks the INSTALLED @vhyxvoid/middleware's `enabled` default (audit part2 G7): with credentials set,
// does vhyxvoid() open a connection to the hub under each environment? Uses a stand-in hub.
// Usage: node internal-tools/shared/verify-middleware-default-2026-09-25.cjs <label> <projectDir> <hubPort>
const { spawn } = require('node:child_process')
const path = require('node:path')
const repoRoot = path.resolve(__dirname, '../..')
const { WebSocketServer } = require(require.resolve('ws', { paths: [repoRoot] }))

const [name, dir, portArg] = process.argv.slice(2)
const PORT = Number(portArg)
const cases = [
  ['NODE_ENV unset', {}, ''],
  ['NODE_ENV=test', { NODE_ENV: 'test' }, ''],
  ['NODE_ENV=staging', { NODE_ENV: 'staging' }, ''],
  ['NODE_ENV=production', { NODE_ENV: 'production' }, ''],
  ['NODE_ENV=development', { NODE_ENV: 'development' }, ''],
  ['NODE_ENV=development, CI=true', { NODE_ENV: 'development', CI: 'true' }, ''],
  ['NODE_ENV unset, enabled: true', {}, 'enabled:true,'],
  ['CI=true, enabled: true', { CI: 'true' }, 'enabled:true,'],
]

;(async () => {
  const rows = []
  for (const [label, extra, opt] of cases) {
    const wss = new WebSocketServer({ port: PORT })
    let connected = false
    wss.on('connection', () => { connected = true })
    const env = { ...process.env, VHYXVOID_API_KEY: '', VHYXVOID_SECRET: '', ...extra }
    if (!('NODE_ENV' in extra)) delete env.NODE_ENV
    if (!('CI' in extra)) delete env.CI
    const child = spawn('node', ['-e', `require('@vhyxvoid/middleware').vhyxvoid({${opt}key:'k',secret:'s',port:1,hub:'ws://localhost:${PORT}'});setInterval(()=>{},1e6)`], { cwd: dir, env, stdio: 'ignore' })
    await new Promise((r) => setTimeout(r, 2500))
    child.kill('SIGKILL')
    await new Promise((r) => wss.close(() => r()))
    rows.push(`  ${label.padEnd(34)} tunnel started: ${connected}`)
  }
  console.log(`${name}:\n${rows.join('\n')}`)
})()
