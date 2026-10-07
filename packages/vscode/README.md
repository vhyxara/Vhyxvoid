# VhyxVoid for VS Code

Work with your VhyxVoid workspace from the editor, using an API key.

- **Check a spec**: open an OpenAPI or Swagger file (YAML or JSON) and run **VhyxVoid: Check this spec**. Problems show in the Problems panel at the line they are about. Changes against the latest published version, including breaking ones, show in the **VhyxVoid** output. Unsaved edits are checked too.
- **Push a spec**: **VhyxVoid: Save this spec as the draft (and publish)** saves the file as the API docs' draft. You can also publish it. Publishing is refused when the document has errors. When there are breaking changes, it asks you before publishing.
- **Check on save**: once a file is linked to API docs, saving it checks it. You can turn this off with `vhyxvoid.checkOnSave`.
- **Run a collection**: **VhyxVoid: Run a collection** runs a saved collection on the platform, with or without an environment. Results go to the output.
- **Draft with AI**: **Draft a mock API with AI** and **Draft tests with AI** open the draft in a new tab. Save it and use it with the CLI: `npx vhyxvoid mock <file>` or `npx vhyxvoid test <file>`. When the active file is linked API docs, tests are drafted from those docs.

## Setup

1. In the dashboard, create an API key under **API keys**. Give it the scopes you need:
   - `specs:read` to check specs;
   - `specs:write` to push and publish;
   - `collections:read` and `tests:run` to run collections;
   - `ai:use` for drafts.
2. Run **VhyxVoid: Sign in with an API key** and paste `keyId.secret`. The key is kept in VS Code's secret storage. `VHYXVOID_API_KEY` in the environment works too.
3. Run **VhyxVoid: Link this file to API docs** on your spec file. The link is saved in the workspace setting `vhyxvoid.specs`; commit `.vscode/settings.json` to share it with your team.

For a self-hosted platform, set `vhyxvoid.apiUrl` to its API origin.

## Build

```sh
pnpm --filter vhyxvoid-vscode build      # dist/extension.js
pnpm --filter vhyxvoid-vscode package    # vhyxvoid-vscode-<version>.vsix
```

Install the `.vsix` with **Extensions: Install from VSIX…**.
