// Freshness check for hand-written docs pages. Skeleton of the contract in
// internal-tools/docs/context.md, Part 4B. Implemented rules:
//
//   1. Every non-stub page has `verified` {date, commit, packages} + `sources`.
//   2. Every `sources` path exists in the repo (catches renamed/deleted files).
//   3. `verified.packages` matches each package's current package.json version.
//   4. No commit touched any `sources` path after `verified.commit` (git log).
//
// Not implemented yet (see internal-tools/docs/backlog.md): generated-content
// no-diff check, code-sample typechecking, PR-scoped "warn" mode.
//
// Run: pnpm --filter @vhyxvoid/docs check:fresh   Exit 1 on any finding.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from 'yaml'

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(docsRoot, '../..')
const contentDir = join(docsRoot, 'content/docs')

// package name -> package.json path, for every workspace package a page can cite.
const packageJsonPaths = {
  '@vhyxvoid/agent': 'packages/agent/package.json',
  '@vhyxvoid/sdk': 'packages/sdk/package.json',
  '@vhyxvoid/middleware': 'packages/middleware/package.json',
  '@vhyxvoid/next': 'packages/next/package.json'
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)

    if (entry.isDirectory()) yield* walk(p)
    else if (entry.name.endsWith('.mdx')) yield p
  }
}

function frontmatter(file) {
  const m = /^---\n([\s\S]*?)\n---/.exec(readFileSync(file, 'utf8'))

  return m ? parse(m[1]) : {}
}

const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()

const findings = []
let checked = 0
let stubs = 0

for (const file of walk(contentDir)) {
  const page = relative(contentDir, file)
  const fm = frontmatter(file)

  if (fm.stub) {
    stubs++
    continue
  }

  checked++

  const { verified, sources } = fm

  if (!verified?.commit || !verified?.date || !verified?.packages || !Array.isArray(sources) || !sources.length) {
    findings.push(`${page}: missing verified {date, commit, packages} and/or sources[]`)
    continue
  }

  for (const src of sources) {
    if (!existsSync(join(repoRoot, src))) findings.push(`${page}: source path does not exist: ${src}`)
  }

  for (const [name, version] of Object.entries(verified.packages)) {
    const pkgPath = packageJsonPaths[name]

    if (!pkgPath) {
      findings.push(`${page}: unknown package in verified.packages: ${name}`)
      continue
    }

    const current = JSON.parse(readFileSync(join(repoRoot, pkgPath), 'utf8')).version

    if (current !== version) findings.push(`${page}: verified against ${name}@${version}, package.json is now ${current}`)
  }

  try {
    const existing = sources.filter(s => existsSync(join(repoRoot, s)))
    const changed = git('log', '--format=%h %s', `${verified.commit}..HEAD`, '--', ...existing)

    if (changed) findings.push(`${page}: sources changed since ${verified.commit}:\n    ${changed.split('\n').join('\n    ')}`)
  } catch (err) {
    findings.push(`${page}: could not run git log from ${verified.commit} (${err.message.split('\n')[0]})`)
  }
}

console.log(`[check:fresh] ${checked} page(s) checked, ${stubs} stub(s) skipped`)

if (findings.length) {
  console.error(`[check:fresh] ${findings.length} finding(s):\n- ${findings.join('\n- ')}`)
  process.exit(1)
}

console.log('[check:fresh] ok')
