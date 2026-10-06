# VhyxVoid tunnel — GitHub Action

Gives the app running in a GitHub Actions job a public HTTPS URL:

- **Preview environments**: every pull request gets a comment with a link to
  its build, updated on each push.
- **Webhook tests**: point Stripe, GitHub or Slack at `$VHYXVOID_URL` and test
  the real round trip in CI.
- **End-to-end tests** that need a public URL (OAuth callbacks, mobile devices,
  third-party crawlers).

The tunnel runs the published `@vhyxvoid/agent` in the background and ends
with the job.

## Usage

```yaml
name: Preview
on: pull_request

permissions:
  contents: read
  pull-requests: write # for the comment

jobs:
  preview:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci && npm run build
      - run: npm start &              # your app, on port 3000

      - uses: vhyxara/vhyxvoid/actions/tunnel@main
        id: tunnel
        with:
          api-key: ${{ secrets.VHYXVOID_API_KEY }}
          secret: ${{ secrets.VHYXVOID_SECRET }}
          port: 3000
          keep-alive-minutes: 30      # keep the preview up for review

```

For tests instead of a preview, leave `keep-alive-minutes` at `0` and use the
URL in later steps:

```yaml
      - uses: vhyxara/vhyxvoid/actions/tunnel@main
        id: tunnel
        with:
          api-key: ${{ secrets.VHYXVOID_API_KEY }}
          secret: ${{ secrets.VHYXVOID_SECRET }}
          comment: false
      - run: npx playwright test
        env:
          BASE_URL: ${{ steps.tunnel.outputs.url }}   # also in $VHYXVOID_URL
```

## Inputs

| Input | Default | What it does |
| --- | --- | --- |
| `api-key` | (required) | API key ID with the `tunnel:connect` scope |
| `secret` | (required) | The key's secret |
| `port` | `3000` | Local port of the app in the job |
| `label` | `pr-<number>` / `ci-<run id>` | Tunnel label, part of the URL; each PR keeps a stable URL |
| `hub` | `wss://hub.vhyxvoid.com/agent` | Hub URL (self-hosted or staging) |
| `agent-version` | `latest` | `@vhyxvoid/agent` version from npm |
| `agent-package` | | Run this package instead: a `.tgz` path or URL (e.g. from `node scripts/pack-packages.mjs` or the CI `vhyxvoid-packages` artifact), or a package directory. Wins over `agent-version`. |
| `wait-for-app` | `60` | Seconds to wait for the app's port before starting |
| `timeout` | `60` | Seconds to wait for the tunnel |
| `comment` | `true` | Comment the URL on the pull request (updated, never duplicated) |
| `github-token` | `github.token` | Token for the comment |
| `keep-alive-minutes` | `0` | Keep the job running so the preview stays up |

## Outputs

`url` (also exported as `VHYXVOID_URL`) and `label`.

## Keys for CI

Create a key just for CI in the dashboard (API keys → Create): scope
`tunnel:connect`, an expiry date, and a name such as `github-actions`. Revoking
it in the dashboard disconnects running jobs within about a minute. Every
connect and disconnect shows in the workspace's Activity page.

Each concurrent job uses one agent slot of your plan; on plans with one agent,
run previews one at a time (`concurrency:` in the workflow).

## Troubleshooting

Run the same checks the action depends on with
`npx @vhyxvoid/agent doctor --connect` locally, or add it as a step before the
tunnel. If the agent stops early, the action prints its output and fails the
step.
