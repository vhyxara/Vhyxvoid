# API platform plan: mock, test, document, collaborate

Owner's brief (2026-10-06): users can run a **mock API** with no backend
running and keep it on our site; take the best of Swagger, Beeceptor, Mockoon,
Mock Service Worker and others, but much easier to use; let users **test and
analyse** their APIs and their performance; add a **team space** (chat,
sharing, API documentation, documents, tracking). Build it phase by phase,
each phase shippable on its own, at the same quality bar as the rest of the
product (typed, tested, admin-controlled, documented, measured).

Status of each phase is tracked in the table at the end. Update it as phases
ship (commit hashes), and record design decisions in `shared/decision.md`.

---

## 1. Why we can win (the wedge)

Every competitor owns one slice:

| Tool | Strength we take | Gap we close |
| --- | --- | --- |
| Swagger / Stoplight | OpenAPI as the contract; docs and "try it" from the spec | Mocks and real traffic live elsewhere; spec drifts from reality |
| Beeceptor | Hosted mock endpoint in seconds, request log, proxy unmatched calls to a real backend | No local backend story, no team space, weak spec support |
| Mockoon | Rich local mocks: route params, response rules, templating, data buckets, CRUD | Desktop/CLI only; sharing means exporting files |
| Mock Service Worker | Mocks inside the frontend and tests | Every developer maintains handlers by hand; nothing shared or hosted |
| Postman | API client, collections, environments, tests, monitors, team workspace | Heavy, slow, mocks are an afterthought, no tunnel to local code |
| ngrok / Cloudflare Tunnel | Public URL for local code | Nothing about API design, mocks, tests or teams |

**Our wedge: one URL for the whole life of an API.**
`https://<slug>--<label>.vhyxvoid.com` answers from a **hosted mock** before the
backend exists, from the **developer's laptop** (tunnel) while it is being
built, and from **both** while it is half done (mock what's missing, forward
the rest). Clients, webhooks and teammates never change the URL. Everything that
passes through it is captured (inspector), so **real traffic becomes mocks,
tests and docs** with one click, and the spec can be checked against reality.

Design rules for every phase:

1. **Zero setup first.** Every feature is usable in under a minute from a
   template, without reading docs. Power features are one click deeper.
2. **One object model.** Mock endpoints, saved requests, tests and docs all
   point at the same API + endpoint; nothing is copied between tools.
3. **Hub-speed.** Mock answers come from the hub's memory (cached, invalidated
   on save): no database or network hop on the request path.
4. **Safe by default.** No user code runs on our servers (templating is a
   small, non-Turing-complete language). Outbound requests from our servers
   (API client, load tests) are SSRF-guarded and limited to targets the
   workspace owns or proves.
5. **Operator control.** Each feature has a `features.*` switch and plan
   limits editable in the console, like everything else.

---

## 2. Phases (value order)

### Phase 1 — Hosted mock APIs  *(start here)*

A workspace creates a **Mock API** bound to a label. Its endpoints answer at
the label's URL with no agent running.

- **Endpoints**: method (or any), path with params (`/users/:id`,
  `/users/{id}`), wildcards (`/files/*`).
- **Several responses per endpoint**, chosen by **rules** (query, header,
  path param, cookie, JSON body field: equals / contains / exists / regex /
  not equals; all or any), or in **sequence**, or at **random**. Fallback to
  the default response.
- **Templating** (opt-in per response): request echo
  (`{{request.params.id}}`, `{{request.query.page}}`, `{{request.body.user.name}}`,
  headers, method, path), generators (`{{uuid}}`, `{{now}}`, `{{int 1 100}}`,
  `{{float 0 1 2}}`, `{{pick 'a' 'b'}}`, `{{firstName}}`, `{{lastName}}`,
  `{{fullName}}`, `{{email}}`, `{{company}}`, `{{city}}`, `{{country}}`, `{{lorem 8}}`,
  `{{bool}}`), and `{{#repeat 3}}…{{/repeat}}` with `{{@index}}` for lists.
  No expressions, no loops beyond repeat, bounded output size.
- **Latency** per API and per response; **status, headers, body**.
- **Modes**: *Mock first* (matched routes answer from the mock; anything else
  goes to the agent when it is connected, else 404) and *When offline* (the
  mock answers only while no agent is connected). Switching a frontend from
  mock to real backend = start the agent.
- **CORS on** with one switch (preflight answered, headers added).
- **OpenAPI import** (3.x, JSON or YAML; paste or file): endpoints and example
  responses generated from `example`/`examples`/schemas. **OpenAPI export**
  of the mock. Templates gallery (REST CRUD, auth, pagination, errors).
- **Request log** = the request inspector (already exists), marked "answered
  by mock" with the endpoint and response that matched.
- **Try it** panel in the editor (dry run with the same engine the hub uses,
  so what you see is what the URL serves).
- Works with tunnel access rules (password / IP / share links), custom
  domains, traffic charts, alerts and activity, because mocks live on the
  same label.
- Limits: `maxMockApis` (FREE 2 / PRO 25 / ENT 250), `maxMockEndpoints` per API
  (FREE 25 / PRO 250 / ENT 1000); switch `features.mockApis`. Mock answers
  count as tunnel requests (plan per-minute limit, monthly usage).

**Done when:** a user creates a mock from a template or an OpenAPI file, curls
its URL and gets templated answers, sees them in the inspector, switches the
same URL to the real backend by starting the agent; e2e journey step,
unit tests for the engine, docs page, admin limits.

### Phase 2 — Stateful mocks, record and export

- **Resources** (Mockoon data buckets / json-server): declare `users` with seed
  JSON, get `GET/POST /users`, `GET/PUT/PATCH/DELETE /users/:id`, filtering,
  pagination, persisted per mock in Redis, **Reset** button.
- **Record → mock**: pick requests in the inspector and create endpoints from
  them (status, headers, body), or "mock every route the tunnel saw today".
- **Exports**: Mock Service Worker handlers (browser and Node, TypeScript),
  Mockoon JSON, Postman collection; **imports**: Mockoon, Postman, HAR.
- **CLI**: `vhyxvoid mock <api>` serves the same mock locally, offline
  (the agent already has the HTTP stack), for tests and planes.

### Phase 3 — API client and tests (in the browser)

- Request builder (method, URL, params, headers, auth helpers: bearer, basic,
  API key, HMAC; body: JSON, form, raw, file), **collections** and folders,
  **environments** and variables (secrets masked), history, code snippets
  (curl, fetch, axios, Python, Go).
- Sent by a **server-side runner** (no CORS problems): SSRF guard (public
  addresses only), per-workspace rate limit, response size cap, timings
  (DNS, connect, TLS, first byte, total).
- **Assertions** without code: status, header, JSON path equals/contains/
  matches schema, response time below N ms; **collection runner** with a
  report; run from CI with `vhyxvoid test <collection>` (exit code).

### Phase 4 — Performance and monitoring

- **Load tests** (k6 style): virtual users, duration, ramp-up, think time,
  against **targets the workspace owns** (its tunnels, mocks, verified custom
  domains) so we can never be used to attack third parties. Live chart: RPS,
  p50/p90/p95/p99, errors, status breakdown; saved runs, compare two runs.
- **Monitors**: scheduled collection runs (every 1–60 min) feeding the
  existing alert engine (new alert type), uptime and latency history.
- **API analytics** from inspector + minute stats: per-endpoint volume, error
  rate and latency percentiles, slowest endpoints, new/unknown endpoints,
  **spec drift** (traffic that doesn't match the OpenAPI spec).

### Phase 5 — API documentation

- OpenAPI editor (form view + YAML with validation), versions with diffs and
  breaking-change detection, rendered docs (clean, fast, dark/light),
  **try it** against mock or real URL, code samples, public share link,
  custom domain, password. Docs, mocks and tests generated from the same spec.

### Phase 6 — Team space

- **Chat**: channels per workspace (plus per-API channels), direct messages,
  threads, mentions, reactions, edits, unread state, real-time over WebSocket,
  search. Share any object as a rich card (request, response from the
  inspector, mock endpoint, load-test run, doc section); "open in" links.
- **Documents**: markdown pages in folders, live preview, version history,
  comments, links and embeds of API objects.
- **Tracker**: issues with status, assignee, labels, priority, due date,
  linked endpoints/requests/runs; list and board views; activity feed.
- Notifications (in-app, email digest) and permissions by workspace role.

### Phase 7 — Ecosystem

GitHub sync for specs and collections (PR checks: breaking changes, tests),
VS Code extension, AI assist (generate a mock or tests from a description or
from captured traffic), public API for everything above.

---

## 3. Cross-cutting requirements (every phase)

- `features.<x>` switch + plan limits in `packages/shared` (settings registry,
  `planLimits.ts`), shown in the console's limit editors and docs reference.
- Activity entries for every change; audit for admin actions.
- Unit tests for every engine (pure functions in `packages/shared`), route
  tests, e2e journey step; Playwright screenshots of new screens, desktop and
  phone.
- Docs: user page per feature, operator notes, changelog; `check:fresh` and
  `check:links` green.
- Performance budgets: mock answer < 2 ms at the hub after cache warm-up;
  dashboard pages interactive < 1 s on a cold load; no N+1 queries.
- internal-tools: decision entry per phase, backlog follow-ups, session log.

## 4. Honest constraints

- Big platforms win on breadth; we win on the wedge above and on speed and
  simplicity. Each phase must be excellent before the next starts.
- Load testing and the API client send traffic from our servers: they are
  limited to owned targets and rate limited, or they become an abuse vector.
- Chat and documents are table stakes for a team product but not the wedge;
  they come after the API features that make teams adopt us.

---

## 5. Status

| Phase | Status | Commits |
| --- | --- | --- |
| 1. Hosted mock APIs | **shipped** 2026-10-06 (engine, hub, API, dashboard, docs; 32 engine + 6 hub + 10 UI tests, e2e journey step) | b534990, 96d4bac, docs commit |
| 2. Stateful mocks, record, export | **shipped** 2026-10-06 (resources on Redis, record from inspector/HAR, MSW/Postman/Mockoon/native export, Postman/Mockoon/HAR/native import, `vhyxvoid mock` CLI; 22 engine/CLI + 1 hub + 1 UI tests, e2e step) | 0f62342, 8323f22, docs commit |
| 3. API client and tests | **shipped** 2026-10-07 (request builder with auth helpers incl. HMAC and file bodies, collections/folders, environments with encrypted secrets, server-side runner with SSRF guard + per-account rate limit + timings, checks incl. JSON schema, captures, snippets in 5 languages, history, runs with saved reports, curl/Postman/OpenAPI/HAR import, Postman export, `vhyxvoid test` with JUnit; 23 engine + 11 route + 4 CLI + 7 UI tests, e2e step) | 899645b, 1a8548c, docs commit |
| 4. Performance and monitoring | **shipped** 2026-10-07 (per-endpoint analytics from hub stats with SQL-mergeable histograms, spec drift vs mock/OpenAPI; load tests to own targets only via the hub, VUs/ramp/think/rate cap/thresholds, live charts, compare; monitors on a schedule with uptime/latency history and MONITOR alerts; 14 engine + 6 route tests, 1 hub test updated, 4 UI tests, e2e step) | 4831dc3, 85fa393, docs commit |
| 5. API documentation | **shipped** 2026-10-07 (OpenAPI 3.0/3.1 + Swagger 2 editor as text with located problems and a form; drafts and published versions; breaking/warning/info diff; rendered docs with code samples in 4 languages, light/dark, try-it to a linked mock via the hub or from the browser; public / password / custom-domain sharing via the hub; mock and test collection from the spec; drift vs a spec; 13 engine + 12 route + 2 hub + 7 UI tests, e2e step) | 1989423, docs commit |
| 6. Team space | planned | |
| 7. Ecosystem | planned | |
