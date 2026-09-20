// Generates the reference blocks of the docs from the real source, and checks
// that they are up to date. Part 4A of internal-tools/docs/context.md.
//
// A generated block lives inside a hand-written page between two MDX comments:
//
//   {/* generated:begin NAME */}
//   ...everything here is replaced...
//   {/* generated:end NAME */}
//
//   node scripts/generate.mjs           rewrite every block
//   node scripts/generate.mjs --check   change nothing; exit 1 if any block is stale
//
// Sources of each block:
//   cli-*        packages/agent/dist/cli.js run with --help (the agent must be built)
//   sdk-*        the TypeScript compiler API over packages/sdk/src/index.ts, so only
//                real exports appear
//   plans-*      PLAN_LIMITS / protocol constants, evaluated from the real .ts files,
//                filtered by content-config/enforced-limits.json
//   env-*        content-config/env-vars.json, cross-checked against a grep of the
//                packages (fails on a variable that is read but not listed, or listed
//                but not read anywhere)
//   scopes       the ApiScope enum + content-config/scopes.json
//
// Every mapping fails loudly instead of guessing: an unclassified plan limit, an
// unmapped scope, an SDK export no page claims, a JSDoc that leaks an internal
// note, a note for a symbol that no longer exists.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

import ts from 'typescript'

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(docsRoot, '../..')
const contentDir = join(docsRoot, 'content/docs')
const configDir = join(docsRoot, 'content-config')
const check = process.argv.includes('--check')

const readJson = f => JSON.parse(readFileSync(join(configDir, f), 'utf8'))
const readRepo = f => readFileSync(join(repoRoot, f), 'utf8')
const fail = msg => {
  throw new Error(msg)
}

// ── Evaluate real TypeScript source files ────────────────────────────────────

const moduleCache = new Map()

function loadTs(file) {
  if (moduleCache.has(file)) return moduleCache.get(file).exports

  const source = readFileSync(file, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  })

  const mod = { exports: {} }

  moduleCache.set(file, mod)

  const req = spec => {
    if (spec.startsWith('@/')) return loadTs(resolveTsPath(join(repoRoot, 'apps/api/src', spec.slice(2))))
    if (spec.startsWith('.')) return loadTs(resolveTsPath(resolve(dirname(file), spec)))

    return createRequire(file)(spec)
  }

  new Function('require', 'module', 'exports', outputText)(req, mod, mod.exports)

  return mod.exports
}

function resolveTsPath(base) {
  for (const c of [`${base}.ts`, join(base, 'index.ts'), base]) if (existsSync(c) && c.endsWith('.ts')) return c
  fail(`cannot resolve ${base}`)
}

// ── Small formatters ─────────────────────────────────────────────────────────

const esc = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
const mdxText = s => String(s).replace(/</g, '&lt;').replace(/\{/g, '\\{')
const code = s => '`' + esc(s) + '`'

function table(head, rows) {
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n')
}

const fmtNumber = n => (n === Infinity ? 'Unlimited' : n.toLocaleString('en-US'))
const fmtSeconds = ms => `${ms / 1000} s`

// ── CLI ──────────────────────────────────────────────────────────────────────

const cliPath = join(repoRoot, 'packages/agent/dist/cli.js')

function cliHelp(...args) {
  if (!existsSync(cliPath)) fail('packages/agent/dist/cli.js is missing. Build it first: pnpm --filter @vhyxvoid/agent build')

  return execFileSync('node', [cliPath, ...args, '--help'], { encoding: 'utf8', cwd: docsRoot, env: { ...process.env, FORCE_COLOR: '0' } }).trimEnd()
}

function parseOptions(help) {
  const out = []
  let cur = null

  for (const line of help.split('\n')) {
    const first = /^ {2}(-\S.*?) {2,}(\S.*)$/.exec(line)

    if (first) {
      cur = { flags: first[1], text: first[2] }
      out.push(cur)
    } else if (cur && /^ {10,}\S/.test(line)) cur.text += ' ' + line.trim()
    else if (!/^ {2}-/.test(line)) cur = null
  }

  return out.filter(o => o.flags !== '-h, --help').map(o => {
    const long = /--([a-z-]+)/.exec(o.flags)[1]
    const env = /Env: ([A-Z_]+)/.exec(o.text)?.[1] ?? null
    const def = /\(default: "?([^")]*)"?\)/.exec(o.text)?.[1] ?? null
    const text = o.text.replace(/\s*Env: \S+/, '').replace(/\s*\(default: [^)]*\)/, '').trim()

    return { flags: o.flags, long, env, def, text }
  })
}

function cliBlocks() {
  const manifest = readJson('env-vars.json').vars
  const opts = parseOptions(cliHelp('start'))

  if (!opts.length) fail('parsed no options from `vhyxvoid start --help`')

  const seenEnv = new Set()

  const rows = opts.map(o => {
    const m = manifest.find(v => v.flag === `--${o.long}`)

    if (o.env && !m) fail(`vhyxvoid start --help lists ${o.env} for --${o.long}, but env-vars.json has no entry with flag --${o.long}`)
    if (o.env && m && m.name !== o.env) fail(`--${o.long}: help says ${o.env}, env-vars.json says ${m.name}`)
    if (m) seenEnv.add(m.name)

    const env = m ? code(o.env === 'VHYXVOID_DEBUG_LOGGING' ? `${m.name}=true` : m.name) : 'none'
    let def = o.def !== null ? code(o.def) : m ? m.default : 'none'

    if (o.long === 'no-local-discovery') def = 'discovery on'

    return [code(o.flags), env, def, m ? (m.cliDescription ?? m.description) : mdxText(o.text.replace(/[^.]$/, '$&.'))]
  })

  // Every manifest variable that claims a flag must appear in the help.
  for (const v of manifest) {
    if (v.flag && !seenEnv.has(v.name)) fail(`env-vars.json says ${v.name} is set by ${v.flag}, which \`vhyxvoid start --help\` does not list`)
  }

  const block = (title, body) => `\`\`\`text title="${title}"\n${body}\n\`\`\``

  return {
    'cli-flags': table(['Flag', 'Environment variable', 'Default', 'Meaning'], rows),
    'cli-help': [block('vhyxvoid --help', cliHelp()), block('vhyxvoid start --help', cliHelp('start')), block('vhyxvoid init --help', cliHelp('init'))].join('\n\n')
  }
}

// ── SDK ──────────────────────────────────────────────────────────────────────

const sdkEntry = join(repoRoot, 'packages/sdk/src/index.ts')

// Page that documents each export. Every export must be claimed by exactly one
// block, so a new export cannot slip in undocumented.
const sdkBlocks = {
  'sdk-http': ['createClient', 'VhyxvoidClient', 'ClientConfig', 'ClientResponse'],
  'sdk-ws': ['TunnelClient', 'TunnelClientConfig', 'TunnelResponse', 'RequestOptions'],
  'sdk-errors': ['ClientError', 'TunnelError', 'TunnelTimeoutError']
}

function sdkProgram() {
  const options = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: ['node'],
    typeRoots: [join(repoRoot, 'packages/sdk/node_modules/@types')],
    baseUrl: repoRoot,
    paths: { '@vhyxvoid/protocol': ['packages/protocol/src/index.ts'] }
  }

  const program = ts.createProgram([sdkEntry], options)
  const checker = program.getTypeChecker()
  const sf = program.getSourceFile(sdkEntry)
  const moduleSym = checker.getSymbolAtLocation(sf)

  if (!moduleSym) fail('could not read the SDK barrel')

  return { checker, exports: checker.getExportsOfModule(moduleSym) }
}

const inSdkSrc = decl => decl && decl.getSourceFile().fileName.startsWith(join(repoRoot, 'packages/sdk/src'))
const hasModifier = (decl, kind) => (ts.getCombinedModifierFlags?.(decl) ?? 0) & kind

function sdkSection(sym, checker, cfg, used) {
  const resolved = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym
  const name = sym.name
  const decl = resolved.declarations?.[0]
  const doc = (s, key) => {
    const override = cfg.descriptions[key]

    if (override !== undefined) {
      used.add(key)

      return override
    }

    const text = ts.displayPartsToString(s.getDocumentationComment(checker)).trim()

    if (/context\.md|decision\.md|risk #/i.test(text)) fail(`JSDoc of ${key} mentions an internal note; add a description override in content-config/sdk-notes.json`)

    return text
  }

  const noteFor = key => {
    if (cfg.notes[key] === undefined) return ''

    used.add(key)

    return `<Callout type="warn">\n${cfg.notes[key]}\n</Callout>`
  }

  const flags = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope
  const sigText = (sig, node) => checker.signatureToString(sig, node, flags)
  const typeText = (t, node) => checker.typeToString(t, node, flags).replace(/Buffer<ArrayBufferLike>/g, 'Buffer')

  // ── function
  if (resolved.flags & ts.SymbolFlags.Function) {
    const sig = checker.getSignaturesOfType(checker.getTypeOfSymbolAtLocation(resolved, decl), ts.SignatureKind.Call)[0]
    const tags = resolved.getJsDocTags(checker)
    const ex = tags.filter(t => t.name === 'example').map(t => ts.displayPartsToString(t.text).trim())
    const body = doc(resolved, name)

    return [
      `### ${name}()`,
      `\`\`\`ts\nfunction ${name}${sigText(sig, decl)}\n\`\`\``,
      body && mdxText(body),
      ...ex.map(e => '```ts\n' + e.replace(/^\s*\*\s?/gm, '') + '\n```'),
      noteFor(name)
    ].filter(Boolean).join('\n\n')
  }

  // ── class
  if (resolved.flags & ts.SymbolFlags.Class) {
    const instance = checker.getDeclaredTypeOfSymbol(resolved)
    const ctor = checker.getSignaturesOfType(checker.getTypeOfSymbolAtLocation(resolved, decl), ts.SignatureKind.Construct)[0]
    const lines = [`constructor${sigText(ctor, decl).replace(/: [A-Za-z]+$/, '')}`]
    const props = []
    const methods = []

    for (const p of checker.getPropertiesOfType(instance)) {
      const d = p.valueDeclaration ?? p.declarations?.[0]

      if (!inSdkSrc(d)) continue
      if (hasModifier(d, ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) continue

      const t = checker.getTypeOfSymbolAtLocation(p, d)
      const calls = t.getCallSignatures()

      if (calls.length && (ts.isMethodDeclaration(d) || ts.isMethodSignature(d))) {
        for (const c of calls) methods.push(`${p.name}${sigText(c, d)}`)
      } else {
        const ro = hasModifier(d, ts.ModifierFlags.Readonly) ? 'readonly ' : ''

        props.push(`${ro}${p.name}: ${typeText(t, d)}`)
      }
    }

    const doc0 = doc(resolved, name)

    return [
      `### ${name}`,
      doc0 && mdxText(doc0),
      '```ts\nclass ' + name + (instance.getBaseTypes?.().length ? ` extends ${instance.getBaseTypes().map(b => typeText(b, decl)).join(', ')}` : '') + ' {\n' +
        [...lines, ...(props.length ? ['', ...props] : []), ...(methods.length ? ['', ...methods] : [])].map(l => (l ? '  ' + l : l)).join('\n') + '\n}\n```',
      noteFor(name)
    ].filter(Boolean).join('\n\n')
  }

  // ── interface
  if (resolved.flags & ts.SymbolFlags.Interface) {
    const type = checker.getDeclaredTypeOfSymbol(resolved)
    const rows = []

    for (const p of checker.getPropertiesOfType(type)) {
      const d = p.valueDeclaration ?? p.declarations?.[0]
      const optional = !!(p.flags & ts.SymbolFlags.Optional)
      const t = checker.getTypeOfSymbolAtLocation(p, d)
      const key = `${name}.${p.name}`
      const text = doc(p, key)
      const note = cfg.notes[key]

      if (note !== undefined) used.add(key)

      const sentence = x => (x && !/[.!?`)]$/.test(x.trim()) ? x.trim() + '.' : x)

      rows.push([code(p.name + (optional ? '?' : '')), code(typeText(optional ? checker.getNonNullableType(t) : t, d)), [text && sentence(mdxText(text)), note && note].filter(Boolean).join(' ')])
    }

    return [`### ${name}`, doc(resolved, name) && mdxText(doc(resolved, name)), table(['Property', 'Type', 'Description'], rows), noteFor(name)].filter(Boolean).join('\n\n')
  }

  fail(`don't know how to render ${name}`)
}

function sdkBlocksOut() {
  const { checker, exports } = sdkProgram()
  const raw = readJson('sdk-notes.json')
  const cfg = { notes: raw.notes ?? {}, descriptions: raw.descriptions ?? {} }
  const used = new Set()
  const claimed = Object.values(sdkBlocks).flat()

  for (const e of exports) if (!claimed.includes(e.name)) fail(`the SDK now exports ${e.name}; assign it to a block in scripts/generate.mjs (sdkBlocks)`)
  for (const c of claimed) if (!exports.some(e => e.name === c)) fail(`${c} is no longer exported by the SDK barrel; update sdkBlocks in scripts/generate.mjs`)

  const out = {}

  for (const [block, names] of Object.entries(sdkBlocks)) {
    out[block] = names.map(n => sdkSection(exports.find(e => e.name === n), checker, cfg, used)).join('\n\n')
  }

  for (const key of [...Object.keys(cfg.notes), ...Object.keys(cfg.descriptions)]) {
    if (!used.has(key)) fail(`content-config/sdk-notes.json has an entry for ${key}, which is not an exported symbol or member`)
  }

  // A compact list of every export for the overview page.
  const kind = s => {
    const r = s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s

    return r.flags & ts.SymbolFlags.Function ? 'function' : r.flags & ts.SymbolFlags.Class ? 'class' : 'type'
  }

  const where = n => Object.entries(sdkBlocks).find(([, v]) => v.includes(n))[0]
  const pages = { 'sdk-http': ['/sdk/http-client', 'HTTP client'], 'sdk-ws': ['/sdk/websocket-client', 'WebSocket client'], 'sdk-errors': ['/sdk/errors', 'SDK errors'] }

  out['sdk-exports'] = table(
    ['Export', 'Kind', 'Documented in'],
    exports.map(e => [code(e.name), kind(e), `[${pages[where(e.name)][1]}](${pages[where(e.name)][0]})`])
  )

  return out
}

// ── Plans, limits, constants ─────────────────────────────────────────────────

function planBlocks() {
  const limits = loadTs(join(repoRoot, 'apps/api/src/modules/billing/domain/enums/index.ts')).PLAN_LIMITS
  const cfg = readJson('enforced-limits.json')
  const plans = ['FREE', 'PRO', 'ENTERPRISE']
  const keys = Object.keys(limits.FREE)

  for (const k of keys) {
    if (!(k in cfg.enforced) && !(k in cfg.notEnforced)) fail(`PLAN_LIMITS.${k} is not classified in content-config/enforced-limits.json (enforced or notEnforced?)`)
  }

  for (const k of [...Object.keys(cfg.enforced), ...Object.keys(cfg.notEnforced)]) {
    if (!keys.includes(k)) fail(`enforced-limits.json lists ${k}, which PLAN_LIMITS no longer has`)
  }

  const cell = v => (typeof v === 'boolean' ? (v ? 'Yes' : 'No') : fmtNumber(v))

  const enforcedRows = Object.entries(cfg.enforced).map(([k, m]) => [m.label + (m.note ? `. ${m.note}` : ''), ...plans.map(p => cell(limits[p][k]))])

  const constants = loadTs(join(repoRoot, 'packages/protocol/src/constants.ts'))
  const hubHandler = readRepo('apps/hub/src/handlers/HttpTunnel.handler.ts')
  const body = /const MAX_BODY_BYTES = (\d+) \* (\d+) \* (\d+);/.exec(hubHandler)

  if (!body) fail('could not read MAX_BODY_BYTES from HttpTunnel.handler.ts')

  const bodyMb = (Number(body[1]) * Number(body[2]) * Number(body[3])) / 1024 / 1024
  const t = timeoutBounds()

  const flatRows = [
    ['Concurrent agents per account', `${constants.PLAN_AGENT_LIMITS.PRO}. The same on every plan today: the hub applies the Pro figure to every account.`],
    ['Request body through a tunnel URL', `${bodyMb} MB. Larger requests get \`413\`.`],
    ['Time the hub waits for your server', `${fmtSeconds(constants.TIMING.REQUEST_TIMEOUT_MS)} by default, set by the hub operator between ${fmtSeconds(t.min)} and ${fmtSeconds(t.max)}. See [Tunnel request timeout](/reference/environment-variables#tunnel-request-timeout).`],
    ['Rotation grace period', `${loadTs(join(repoRoot, 'apps/api/src/core/constant/apikey.constant.ts')).ROTATION_GRACE_MS / 3600000} hour. After a rotation the old secret keeps working for this long.`]
  ]

  return {
    'plans-enforced': table(['Limit', ...plans], enforcedRows),
    'plans-flat': table(['Limit', 'Value'], flatRows)
  }
}

function timeoutBounds() {
  const src = readRepo('apps/hub/src/utils/tunnelTimeout.ts')
  const num = name => {
    const m = new RegExp(`const ${name} = ([\\d_]+);`).exec(src)

    if (!m) fail(`could not read ${name} from tunnelTimeout.ts`)

    return Number(m[1].replace(/_/g, ''))
  }

  return { min: num('MIN_TIMEOUT_MS'), max: num('MAX_TIMEOUT_MS') }
}

// ── Environment variables ────────────────────────────────────────────────────

function envBlocks() {
  const { vars, hub } = readJson('env-vars.json')

  checkEnvManifest(vars)

  const constants = loadTs(join(repoRoot, 'packages/protocol/src/constants.ts'))
  const t = timeoutBounds()
  const h = hub[0]

  if (!readRepo(h.readIn).includes(h.name)) fail(`${h.name} is not read in ${h.readIn}`)

  const usedBy = { agent: 'CLI agent', middleware: 'Express / Fastify', next: 'Next.js', sdk: 'SDK' }

  return {
    'env-vars': table(
      ['Variable', 'Used by', 'Default', 'Meaning'],
      vars.map(v => [code(v.name), v.usedBy.map(u => usedBy[u]).join(', '), v.default, v.description])
    ),
    'env-timeout': table(
      ['Variable', 'Default', 'Allowed range'],
      [[code(h.name), `${constants.TIMING.REQUEST_TIMEOUT_MS} ms (${fmtSeconds(constants.TIMING.REQUEST_TIMEOUT_MS)})`, `${t.min} to ${t.max} ms (${fmtSeconds(t.min)} to ${fmtSeconds(t.max)}); anything else is ignored with a warning and the default is used`]]
    )
  }
}

function checkEnvManifest(vars) {
  const roots = ['agent', 'middleware', 'next', 'sdk']
  const found = new Map()

  for (const pkg of roots) {
    for (const f of walkTs(join(repoRoot, 'packages', pkg, 'src'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/VHYXVOID_[A-Z_]+/g)) {
        if (!found.has(m[0])) found.set(m[0], new Set())

        found.get(m[0]).add(pkg)
      }
    }
  }

  const listed = new Map(vars.map(v => [v.name, v]))

  for (const [name, pkgs] of found) {
    const v = listed.get(name)

    if (!v) fail(`${name} is read in packages/{${[...pkgs].join(',')}}/src but is missing from content-config/env-vars.json`)

    for (const p of pkgs) if (!v.usedBy.includes(p)) fail(`${name} is read by ${p}, but env-vars.json lists it as used by ${v.usedBy.join(', ')}`)
  }

  for (const v of vars) if (!found.has(v.name)) fail(`env-vars.json lists ${v.name}, which no package reads any more`)
}

function* walkTs(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)

    if (e.isDirectory()) yield* walkTs(p)
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) yield p
  }
}

// ── Scopes ───────────────────────────────────────────────────────────────────

function scopeBlocks() {
  const scopes = loadTs(join(repoRoot, 'apps/api/src/core/constant/apikey.constant.ts')).ApiScope
  const cfg = readJson('scopes.json')
  const values = Object.values(scopes)

  for (const v of values) if (!(v in cfg)) fail(`ApiScope value ${v} has no entry in content-config/scopes.json`)
  for (const k of Object.keys(cfg)) if (!k.startsWith('_') && !values.includes(k)) fail(`scopes.json lists ${k}, which ApiScope no longer has`)

  // What the dashboard's create dialog really offers.
  const dialog = readRepo('apps/web/src/views/org/api-keys/CreateApiKeyDialog.tsx')
  const offered = [...(/AVAILABLE_SCOPES[^=]*=\s*\[([\s\S]*?)\n\]/.exec(dialog)?.[1] ?? '').matchAll(/value: '([^']+)'/g)].map(m => m[1])

  for (const v of values) {
    if (cfg[v].inDashboard !== offered.includes(v)) fail(`scopes.json says inDashboard=${cfg[v].inDashboard} for ${v}, but CreateApiKeyDialog offers: ${offered.join(', ')}`)
  }

  return {
    scopes: table(
      ['Scope', 'Meaning', 'Checked by VhyxVoid today?', 'In the dashboard’s create dialog?'],
      values.map(v => [code(v), cfg[v].description, cfg[v].checked, cfg[v].inDashboard ? 'Yes' : 'No'])
    )
  }
}

// ── Pages ────────────────────────────────────────────────────────────────────

function allBlocks() {
  return { ...cliBlocks(), ...sdkBlocksOut(), ...planBlocks(), ...envBlocks(), ...scopeBlocks() }
}

function* pages(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)

    if (e.isDirectory()) yield* pages(p)
    else if (e.name.endsWith('.mdx')) yield p
  }
}

const markerRe = /\{\/\* generated:begin ([a-z-]+)[^*]*\*\/\}\n[\s\S]*?\{\/\* generated:end \1 \*\/\}/g

function main() {
  const blocks = allBlocks()
  const placed = new Set()
  const stale = []

  for (const file of pages(contentDir)) {
    const before = readFileSync(file, 'utf8')

    const after = before.replace(markerRe, (_m, name) => {
      if (!(name in blocks)) fail(`${file} has a generated block called ${name}, which no generator produces`)

      placed.add(name)

      return `{/* generated:begin ${name} · do not edit; run \`pnpm --filter @vhyxvoid/docs generate\` */}\n${blocks[name]}\n{/* generated:end ${name} */}`
    })

    if (after !== before) {
      if (check) stale.push(file.replace(repoRoot + '/', ''))
      else writeFileSync(file, after)
    }
  }

  for (const name of Object.keys(blocks)) if (!placed.has(name)) fail(`generated block ${name} is not used by any page`)

  if (stale.length) {
    console.error(`[generate] stale generated content in:\n- ${stale.join('\n- ')}\nRun: pnpm --filter @vhyxvoid/docs generate`)
    process.exit(1)
  }

  console.log(check ? '[generate] generated blocks are up to date' : `[generate] wrote ${placed.size} block(s)`)
}

try {
  main()
} catch (err) {
  console.error(`[generate] ${err.message}`)
  process.exit(1)
}
