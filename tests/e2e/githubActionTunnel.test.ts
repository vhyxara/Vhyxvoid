// actions/tunnel (roadmap #4): start.sh with a fake agent on PATH, so it runs
// in CI without a hub. The real agent + hub run was done by hand (session log).
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const script = path.resolve(__dirname, "../../actions/tunnel/start.sh");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vv-action-"));

/** A fake `npx` that behaves like the agent: writes the URL to --write-env, then stays up (or dies). */
function fakeNpx(mode: "ok" | "die") {
  const bin = path.join(tmp, `bin-${mode}`);
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, "npx"),
    mode === "ok"
      ? `#!/usr/bin/env bash
echo "$@" > "$RUNNER_TEMP/npx-args"
while [ $# -gt 0 ]; do case "$1" in --write-env) f="$2"; shift;; --label) l="$2"; shift;; esac; shift; done
echo "VHYXVOID_URL=https://acme--$l.vhyxvoid.com" >> "$f"; sleep 30`
      : `#!/usr/bin/env bash
echo "Fatal error: API key has been revoked"; exit 1`,
    { mode: 0o755 },
  );
  return bin;
}

function run(env: Record<string, string>, mode: "ok" | "die" = "ok") {
  const out = path.join(tmp, `out-${Math.random()}`);
  const genv = path.join(tmp, `env-${Math.random()}`);
  fs.writeFileSync(out, "");
  fs.writeFileSync(genv, "");
  const res = spawnSync("bash", [script], {
    env: {
      PATH: `${fakeNpx(mode)}:${process.env.PATH}`,
      RUNNER_TEMP: tmp,
      GITHUB_OUTPUT: out,
      GITHUB_ENV: genv,
      VHYXVOID_API_KEY: "vhyxvoid_dev_x",
      VHYXVOID_SECRET: "s3cret",
      VHYXVOID_PORT: "3000",
      INPUT_WAIT_FOR_APP: "0",
      INPUT_TIMEOUT: "10",
      RUN_ID: "77",
      ...env,
    },
    encoding: "utf8",
  });
  return { code: res.status, stdout: res.stdout, output: fs.readFileSync(out, "utf8"), env: fs.readFileSync(genv, "utf8") };
}

afterAll(() => {
  // Stop the fake agents left in the background.
  for (const d of fs.readdirSync(tmp)) {
    const pid = path.join(tmp, d, "agent.pid");
    if (fs.existsSync(pid)) {
      try {
        process.kill(Number(fs.readFileSync(pid, "utf8")));
      } catch {
        // already gone
      }
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("actions/tunnel start.sh", () => {
  it("is valid bash", () => {
    execFileSync("bash", ["-n", script]);
  });

  it("pull requests get a stable pr-<n> label; the URL becomes an output and VHYXVOID_URL", () => {
    const r = run({ PR_NUMBER: "42" });
    expect(r.code).toBe(0);
    expect(r.output).toContain("url=https://acme--pr-42.vhyxvoid.com");
    expect(r.output).toContain("label=pr-42");
    expect(r.env).toContain("VHYXVOID_URL=https://acme--pr-42.vhyxvoid.com");
    expect(r.stdout).toContain("::add-mask::s3cret");
  });

  it("other runs use ci-<run id>; custom labels are cleaned for a hostname", () => {
    expect(run({}).output).toContain("label=ci-77");
    expect(run({ INPUT_LABEL: "Feature/Login Page" }).output).toContain("label=feature-login-page");
  });

  it("fails with the agent's output when it stops early, and without credentials", () => {
    const dead = run({ PR_NUMBER: "1" }, "die");
    expect(dead.code).not.toBe(0);
    expect(dead.stdout).toContain("API key has been revoked");
    expect(run({ VHYXVOID_SECRET: "" }).code).not.toBe(0);
  });

  it("runs @vhyxvoid/agent from npm by default, at agent-version", () => {
    expect(run({ INPUT_AGENT_VERSION: "1.1.0" }).code).toBe(0);
    expect(fs.readFileSync(path.join(tmp, "npx-args"), "utf8")).toMatch(/^-y --package=@vhyxvoid\/agent@1\.1\.0 vhyxvoid start /);
  });

  it("agent-package runs a local tarball (made absolute) instead of npm", () => {
    const tgz = path.join(tmp, "vhyxvoid-agent-1.1.0.tgz");
    fs.writeFileSync(tgz, "");
    const rel = path.relative(process.cwd(), tgz);
    expect(run({ INPUT_AGENT_PACKAGE: rel, INPUT_AGENT_VERSION: "1.0.20" }).code).toBe(0);
    expect(fs.readFileSync(path.join(tmp, "npx-args"), "utf8")).toMatch(new RegExp(`^-y --package=${tgz.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} vhyxvoid start `));
  });

  it("agent-package passes a URL through unchanged", () => {
    expect(run({ INPUT_AGENT_PACKAGE: "https://example.com/vhyxvoid-agent-1.1.0.tgz" }).code).toBe(0);
    expect(fs.readFileSync(path.join(tmp, "npx-args"), "utf8")).toMatch(/^-y --package=https:\/\/example\.com\/vhyxvoid-agent-1\.1\.0\.tgz vhyxvoid start /);
  });
});
