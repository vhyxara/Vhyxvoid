// VhyxVoid for VS Code (internal-tools/shared/api-platform-plan.md, phase 7).
//
// Uses the platform API with an API key kept in VS Code's SecretStorage, and
// the same client as the CLI (packages/agent/src/platform.ts):
//   - Check / push / publish the OpenAPI spec in the editor (unsaved text
//     included); problems go to the Problems panel, changes to the output.
//   - Run a stored collection and read the results.
//   - Draft a mock API or tests with AI into a new editor tab.
// Which API docs a file belongs to is the workspace setting vhyxvoid.specs,
// so a team shares it through the repository.
import * as path from "path";
import * as vscode from "vscode";

import { PlatformClient, PlatformError, aiMock, aiTests, checkFails, checkSpecText, credentials, formatCheck, pushSpecText, runRemote, usageLine, type SpecCheck } from "../../agent/src/platform";
import { locateChange, locateProblem, looksLikeSpec, reportLines, specRefFor } from "./editorText";

const SECRET = "vhyxvoid.apiKey";
const KEY_RE = /^vhyxvoid_(dev|live)_[0-9a-f]{16,64}\.[0-9a-f]{64}$/;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("VhyxVoid");
  const diagnostics = vscode.languages.createDiagnosticCollection("vhyxvoid");
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = "vhyxvoid.openDashboard";
  context.subscriptions.push(output, diagnostics, status);

  const config = () => vscode.workspace.getConfiguration("vhyxvoid");

  async function client(ask = true): Promise<PlatformClient | null> {
    let key = (await context.secrets.get(SECRET)) ?? process.env.VHYXVOID_API_KEY ?? "";
    if (!KEY_RE.test(key)) {
      if (!ask) return null;
      const signed = await signIn();
      if (!signed) return null;
      key = signed;
    }
    return new PlatformClient(credentials({ apiKey: key, apiUrl: config().get<string>("apiUrl") }, {}));
  }

  async function signIn(): Promise<string | null> {
    const key = await vscode.window.showInputBox({
      title: "VhyxVoid API key",
      prompt: "Paste keyId.secret (create one under API keys in the dashboard; give it the scopes you need: specs, tests:run, ai:use)",
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (KEY_RE.test(v.trim()) ? null : "Expected vhyxvoid_dev_… or vhyxvoid_live_…, a dot, then the 64-character secret"),
    });
    if (!key) return null;
    try {
      const me = await new PlatformClient(credentials({ apiKey: key.trim(), apiUrl: config().get<string>("apiUrl") }, {})).whoami();
      await context.secrets.store(SECRET, key.trim());
      await context.globalState.update("vhyxvoid.dashboardUrl", me.dashboardUrl);
      showWorkspace(me.workspace ?? me.accountId);
      vscode.window.showInformationMessage(`Signed in to ${me.workspace ?? me.accountId} (scopes: ${me.scopes.join(", ")})`);
      return key.trim();
    } catch (err) {
      vscode.window.showErrorMessage(`That key didn't work: ${(err as Error).message}`);
      return null;
    }
  }

  function showWorkspace(name: string | null) {
    if (!name) return status.hide();
    status.text = `$(cloud) ${name}`;
    status.tooltip = "VhyxVoid: open the dashboard";
    status.show();
  }

  /** Runs a command body with progress, turning API errors into messages. */
  async function withClient<T>(title: string, fn: (c: PlatformClient) => Promise<T>): Promise<T | undefined> {
    const c = await client();
    if (!c) return undefined;
    try {
      return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, () => fn(c));
    } catch (err) {
      const msg = (err as Error).message;
      if (err instanceof PlatformError && err.status === 401) {
        const again = await vscode.window.showErrorMessage(`${msg}. Sign in with another key?`, "Sign in");
        if (again) await signIn();
      } else vscode.window.showErrorMessage(msg);
      return undefined;
    }
  }

  function relPath(doc: vscode.TextDocument): string {
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    return folder ? path.relative(folder.uri.fsPath, doc.uri.fsPath) : doc.uri.fsPath;
  }

  async function linkedSpec(doc: vscode.TextDocument, ask: boolean, c?: PlatformClient): Promise<string | null> {
    const ref = specRefFor(config().get<Record<string, string>>("specs"), relPath(doc));
    if (ref || !ask) return ref;
    return link(doc, c);
  }

  async function link(doc: vscode.TextDocument, given?: PlatformClient): Promise<string | null> {
    const c = given ?? (await client());
    if (!c) return null;
    const me = await c.whoami();
    const list = await c.request<{ specs: Array<{ id: string; name: string; slug: string; latest: { number: number } | null }> }>("GET", `/specs/${me.accountId}`);
    if (!list.specs.length) {
      vscode.window.showWarningMessage("No API docs in this workspace yet: create them in the dashboard first.");
      return null;
    }
    const pick = await vscode.window.showQuickPick(
      list.specs.map((s) => ({ label: s.name, description: s.slug, detail: s.latest ? `published v${s.latest.number}` : "not published yet", slug: s.slug })),
      { title: `Which API docs is ${path.basename(doc.uri.fsPath)}?` },
    );
    if (!pick) return null;
    const mapping = { ...(config().get<Record<string, string>>("specs") ?? {}), [relPath(doc).replace(/\\/g, "/")]: pick.slug };
    await config().update("specs", mapping, vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
    return pick.slug;
  }

  function report(doc: vscode.TextDocument, c: SpecCheck) {
    const text = doc.getText();
    const lineRange = (n: number) => doc.lineAt(Math.min(n, doc.lineCount - 1)).range;
    const list: vscode.Diagnostic[] = [];
    for (const p of c.problems) {
      const d = new vscode.Diagnostic(lineRange(locateProblem(text, p.path)), `${p.message}${p.path ? ` (${p.path})` : ""}`, p.severity === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
      d.source = "VhyxVoid";
      list.push(d);
    }
    for (const ch of c.changes.filter((x) => x.severity !== "info")) {
      const d = new vscode.Diagnostic(lineRange(locateChange(text, ch.location)), `${ch.severity === "breaking" ? "Breaking change" : "Change"} for clients: ${ch.message} (${ch.location})`, ch.severity === "breaking" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information);
      d.source = "VhyxVoid";
      list.push(d);
    }
    diagnostics.set(doc.uri, list);
    output.appendLine(`\n[${new Date().toLocaleTimeString()}] ${relPath(doc)}`);
    for (const l of formatCheck(c)) output.appendLine(`  ${l}`);
  }

  async function check(doc: vscode.TextDocument, quiet: boolean) {
    const c = await client(!quiet);
    if (!c) return;
    const ref = await linkedSpec(doc, !quiet, c);
    if (!ref) return;
    const run = async () => {
      const r = await checkSpecText(c, doc.getText(), ref);
      report(doc, r);
      const fail = checkFails(r, "breaking");
      if (!quiet || fail) {
        const msg = fail ? `${r.spec.name}: ${fail}` : `${r.spec.name}: no problems, ${r.counts.breaking + r.counts.warning + r.counts.info ? `${r.counts.warning} warning(s), ${r.counts.info} other change(s)` : "no changes"} against ${r.against ? `v${r.against.number}` : "nothing published"}`;
        (fail ? vscode.window.showWarningMessage : vscode.window.showInformationMessage)(msg, "Show details").then((a) => a && output.show(true));
      }
    };
    if (quiet) await run().catch((err) => output.appendLine(`  check failed: ${(err as Error).message}`));
    else await withClient("VhyxVoid: checking the spec…", run);
  }

  const editorDoc = () => {
    const doc = vscode.window.activeTextEditor?.document;
    if (!doc) vscode.window.showWarningMessage("Open an OpenAPI file first");
    return doc;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("vhyxvoid.signIn", signIn),
    vscode.commands.registerCommand("vhyxvoid.signOut", async () => {
      await context.secrets.delete(SECRET);
      status.hide();
      vscode.window.showInformationMessage("Signed out of VhyxVoid");
    }),
    vscode.commands.registerCommand("vhyxvoid.linkSpec", async () => {
      const doc = editorDoc();
      if (doc) await withClient("VhyxVoid: loading API docs…", (c) => link(doc, c));
    }),
    vscode.commands.registerCommand("vhyxvoid.checkSpec", async () => {
      const doc = editorDoc();
      if (doc) await check(doc, false);
    }),
    vscode.commands.registerCommand("vhyxvoid.pushSpec", async () => {
      const doc = editorDoc();
      if (!doc) return;
      const c = await client();
      const ref = c && (await linkedSpec(doc, true, c));
      if (!c || !ref) return;
      const action = await vscode.window.showQuickPick(
        [
          { label: "Save as the draft", publish: false },
          { label: "Save and publish", description: "refused if there are errors or breaking changes", publish: true },
        ],
        { title: "Push this spec" },
      );
      if (!action) return;
      await withClient("VhyxVoid: pushing the spec…", async () => {
        let r = await pushSpecText(c, doc.getText(), ref, { publish: action.publish });
        report(doc, r.check);
        if (action.publish && !r.published && r.check.counts.breaking && !r.check.problems.some((p) => p.severity === "error")) {
          const go = await vscode.window.showWarningMessage(`${r.check.counts.breaking} breaking change(s) for clients. Publish anyway?`, { modal: true }, "Publish anyway");
          if (go) r = await pushSpecText(c, doc.getText(), ref, { publish: true, allowBreaking: true });
        }
        vscode.window.showInformationMessage(r.message);
      });
    }),
    vscode.commands.registerCommand("vhyxvoid.runCollection", async () => {
      const c = await client();
      if (!c) return;
      const me = await c.whoami().catch((err) => void vscode.window.showErrorMessage((err as Error).message));
      if (!me) return;
      const o = await c.request<{ collections: Array<{ id: string; name: string; requestCount?: number }>; environments: Array<{ id: string; name: string }> }>("GET", `/api-client/${me.accountId}`);
      const col = await vscode.window.showQuickPick(o.collections.map((x) => ({ label: x.name, description: x.requestCount !== undefined ? `${x.requestCount} requests` : undefined, id: x.id })), { title: "Run which collection?" });
      if (!col) return;
      let environment: string | undefined;
      if (o.environments.length) {
        const env = await vscode.window.showQuickPick([{ label: "No environment", id: "" }, ...o.environments.map((e) => ({ label: e.name, id: e.id }))], { title: "With which environment?" });
        if (!env) return;
        environment = env.id || undefined;
      }
      const r = await withClient(`VhyxVoid: running ${col.label}…`, (cl) => runRemote<Parameters<typeof reportLines>[0]>(cl, col.id, { environment }));
      if (!r) return;
      output.appendLine(`\n[${new Date().toLocaleTimeString()}] run ${r.runId}`);
      for (const l of reportLines(r.report)) output.appendLine(`  ${l}`);
      output.appendLine(`  ${r.url}`);
      const bad = r.report.failed + r.report.errored;
      (bad ? vscode.window.showWarningMessage : vscode.window.showInformationMessage)(`${col.label}: ${r.report.passed} of ${r.report.total} passed`, "Show results", "Open in dashboard").then((a) => {
        if (a === "Show results") output.show(true);
        if (a === "Open in dashboard") vscode.env.openExternal(vscode.Uri.parse(r.url));
      });
    }),
    vscode.commands.registerCommand("vhyxvoid.draftMock", async () => {
      const description = await vscode.window.showInputBox({ title: "Draft a mock API with AI", prompt: "Describe the API: resources, endpoints, errors", ignoreFocusOut: true });
      if (!description) return;
      const r = await withClient("VhyxVoid: drafting a mock…", (c) => aiMock(c, { description }));
      if (r) await openDraft(r.file, `${r.file.endpoints.length} endpoint(s). ${r.summary} ${usageLine(r.usage)}. Save it as *.vhyxvoid.json and serve it with: npx vhyxvoid mock <file>`, r.warnings);
    }),
    vscode.commands.registerCommand("vhyxvoid.draftTests", async () => {
      const doc = vscode.window.activeTextEditor?.document;
      const fromSpec = doc && looksLikeSpec(doc.getText()) ? specRefFor(config().get<Record<string, string>>("specs"), relPath(doc)) : null;
      const description = await vscode.window.showInputBox({
        title: "Draft tests with AI",
        prompt: fromSpec ? `What to test (based on the linked API docs "${fromSpec}"); leave empty to cover the docs` : "What to test: the flows and the failures that matter",
        ignoreFocusOut: true,
      });
      if (description === undefined || (!description && !fromSpec)) return;
      const r = await withClient("VhyxVoid: drafting tests…", (c) => aiTests(c, { description, spec: fromSpec ?? undefined }));
      if (r) await openDraft(r.file, `${r.file.collection.requests.length} request(s). ${r.summary} ${usageLine(r.usage)}. Save it and run it with: npx vhyxvoid test <file>`, r.warnings);
    }),
    vscode.commands.registerCommand("vhyxvoid.openDashboard", async () => {
      let url = context.globalState.get<string>("vhyxvoid.dashboardUrl");
      if (!url) {
        const c = await client();
        url = c ? (await c.whoami().catch(() => null))?.dashboardUrl : undefined;
      }
      if (url) vscode.env.openExternal(vscode.Uri.parse(url));
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (config().get<boolean>("checkOnSave") && specRefFor(config().get<Record<string, string>>("specs"), relPath(doc))) void check(doc, true);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.delete(doc.uri)),
  );

  async function openDraft(file: unknown, message: string, warnings: string[]) {
    const doc = await vscode.workspace.openTextDocument({ language: "json", content: `${JSON.stringify(file, null, 2)}\n` });
    await vscode.window.showTextDocument(doc);
    for (const w of warnings) output.appendLine(`  ! ${w}`);
    vscode.window.showInformationMessage(message);
  }

  // Show the workspace in the status bar when a key is already stored.
  void client(false).then(async (c) => {
    if (!c) return;
    const me = await c.whoami().catch(() => null);
    if (me) {
      showWorkspace(me.workspace ?? me.accountId);
      await context.globalState.update("vhyxvoid.dashboardUrl", me.dashboardUrl);
    }
  });
}

export function deactivate(): void {}
