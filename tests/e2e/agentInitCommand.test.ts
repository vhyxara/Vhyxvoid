import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Regression for the 2026-09-19 finding that `vhyxvoid init` (@vhyxvoid/agent
// 1.0.18, Node 24) exited with status 0 right after the secret prompt and
// wrote nothing. Cause: askSecret opened a SECOND readline interface on
// process.stdin and closed it; closing an interface pauses its input, and the
// first interface's next question() never resumes a paused stdin, so the event
// loop emptied and the process exited silently in the middle of the wizard.
//
// These tests run the real CLI source (via tsx) as a child process with piped
// stdin, which reproduces the same early exit without needing a pseudo-terminal.
// The interactive (TTY) path is covered against a fake terminal in
// agentPrompt.test.ts.

const root = path.resolve(__dirname, "../..");
// tsx is a devDependency of apps/api (and hoisted to the root bin only sometimes),
// so look in both rather than assuming the root copy exists.
const tsx = [path.join(root, "node_modules/.bin/tsx"), path.join(root, "apps/api/node_modules/.bin/tsx")].find((p) =>
  fs.existsSync(p),
) as string;
const cli = path.join(root, "packages/agent/src/cli.ts");

function runInit(input: string, cwd: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith("VHYXVOID_")) delete env[k];

    const child = spawn(tsx, [cli, "init"], { cwd, env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out }));
    child.stdin.end(input);
  });
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vhyx-init-"));
}

describe("vhyxvoid init", () => {
  it("writes .env.vhyxvoid with every answer and adds it to .gitignore", async () => {
    const dir = tempDir();
    try {
      const { code, out } = await runInit("vhyxvoid_dev_abc\nsuper-secret\n4000\nweb\n\nacme\n", dir);

      expect(code, out).toBe(0);
      const env = fs.readFileSync(path.join(dir, ".env.vhyxvoid"), "utf8");
      expect(env).toContain("VHYXVOID_API_KEY=vhyxvoid_dev_abc");
      expect(env).toContain("VHYXVOID_SECRET=super-secret");
      expect(env).toContain("VHYXVOID_PORT=4000");
      expect(env).toContain("VHYXVOID_LABEL=web");
      expect(env).toContain("VHYXVOID_HUB_URL=wss://hub.vhyxvoid.com/agent"); // blank answer -> default
      expect(env).toContain("VHYXVOID_ACCOUNT_SLUG=acme");
      expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf8")).toContain(".env.vhyxvoid");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails loudly, and writes nothing, when the secret is left blank", async () => {
    const dir = tempDir();
    try {
      const { code, out } = await runInit("vhyxvoid_dev_abc\n\n3000\n\n\n\n", dir);

      expect(code).toBe(1);
      expect(out).toMatch(/Key and secret are required/);
      expect(fs.existsSync(path.join(dir, ".env.vhyxvoid"))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
