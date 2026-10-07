// packages/shared/src/settings.ts
//
// Runtime settings an administrator changes from the admin panel, without a
// deploy. The registry below is the single list of what exists: its type,
// default, bounds and whether the public (unauthenticated) site may read it.
// Values live in Postgres (`system_settings`, one row per changed key); a key
// with no row has its default. apps/api writes them; apps/api and apps/hub
// read them through SettingsReader, which caches for 30 s per process.
//
// Prisma-free like the rest of this package: callers pass a loader.

import { Plan, PLAN_LIMITS, type PlanLimits } from "./planLimits";
import { isValidVersion } from "./agentFleet";

export type SettingType = "boolean" | "number" | "string" | "text" | "enum" | "url" | "email" | "stringList" | "json";

export interface SettingDefinition {
  group: SettingGroup;
  label: string;
  description: string;
  type: SettingType;
  default: unknown;
  /** Readable by anyone through GET /api/v1/public/settings. */
  public: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  options?: readonly string[];
  /** Extra validation for json values; returns an error message or undefined. */
  validate?: (value: unknown) => string | undefined;
}

export type SettingGroup = "general" | "maintenance" | "announcement" | "auth" | "billing" | "plans" | "tunnels" | "support" | "features";

export const SETTING_GROUPS: Record<SettingGroup, { label: string; description: string }> = {
  general: { label: "General", description: "Product name and public links." },
  maintenance: { label: "Maintenance", description: "Take the dashboard and API offline for users while admins keep working." },
  announcement: { label: "Announcement banner", description: "A banner shown on the website and dashboard." },
  auth: { label: "Sign-up and sign-in", description: "Who can create an account and how." },
  billing: { label: "Billing", description: "Checkout and trial policy. Prices themselves live in Stripe." },
  plans: { label: "Plan limits", description: "Override the built-in limits of each plan." },
  tunnels: { label: "Tunnels", description: "Tunnel behaviour for every account." },
  support: { label: "Support", description: "Where users get help." },
  features: { label: "Features", description: "Turn product features on or off." },
};

// ── Plan limit overrides ──────────────────────────────────────────────────────
// Stored as JSON. `null` means unlimited (JSON has no Infinity).

export type LimitOverrideValue = number | boolean | null | PlanLimits["allowedEnvironments"];
export type PlanLimitOverrides = Partial<Record<keyof PlanLimits, LimitOverrideValue>>;
export type PlanOverridesSetting = Partial<Record<Plan, PlanLimitOverrides>>;

const NUMERIC_LIMITS: ReadonlyArray<keyof PlanLimits> = [
  "maxAgents",
  "maxRequestsPerMonth",
  "publicPathRateLimitPerMinute",
  "maxMembers",
  "maxApiKeys",
  "maxScopesPerKey",
  "rateLimitPerMinute",
  "analyticsRetentionDays",
  "inspectorRequests",
  "inboxRequests",
  "maxCustomDomains",
  "maxAlertRules",
  "maxTrafficRules",
  "maxMockApis",
  "maxMockEndpoints",
  "maxApiCollections",
  "maxApiCollectionRequests",
  "apiClientSendsPerMinute",
  "maxLoadTestVus",
  "maxLoadTestSeconds",
  "maxLoadTestRps",
  "loadTestsPerDay",
  "maxMonitors",
  "minMonitorIntervalMinutes",
  "maxApiSpecs",
];
const BOOLEAN_LIMITS: ReadonlyArray<keyof PlanLimits> = [
  "customDomains",
  "accessRules",
  "prioritySupport",
  "rotationAllowed",
  "expiryAllowed",
  "prodKeysAllowed",
  "protectedDocs",
  "docsCustomDomains",
];

/** Error message for one plan's override object, or undefined when valid. */
export function validateLimitOverrides(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return "Limit overrides must be an object";
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (NUMERIC_LIMITS.includes(key as keyof PlanLimits)) {
      if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || !Number.isInteger(v))) {
        return `${key} must be a whole number of 0 or more, or null for unlimited`;
      }
    } else if (BOOLEAN_LIMITS.includes(key as keyof PlanLimits)) {
      if (typeof v !== "boolean") return `${key} must be true or false`;
    } else if (key === "allowedEnvironments") {
      if (!Array.isArray(v) || v.some((e) => e !== "DEV" && e !== "PROD")) return "allowedEnvironments must be a list of DEV/PROD";
    } else {
      return `Unknown limit "${key}"`;
    }
  }
  return undefined;
}

function validatePlanOverrides(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "Must be an object keyed by plan";
  for (const [plan, overrides] of Object.entries(value as Record<string, unknown>)) {
    if (!(plan in PLAN_LIMITS)) return `Unknown plan "${plan}"`;
    const err = validateLimitOverrides(overrides);
    if (err) return `${plan}: ${err}`;
  }
  return undefined;
}

/** Built-in limits with plan-wide then account-specific overrides applied. */
export function applyLimitOverrides(base: PlanLimits, ...layers: Array<PlanLimitOverrides | null | undefined>): PlanLimits {
  const out: PlanLimits = { ...base, allowedEnvironments: [...base.allowedEnvironments] };
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, v] of Object.entries(layer)) {
      if (v === undefined) continue;
      if (NUMERIC_LIMITS.includes(key as keyof PlanLimits)) {
        (out as unknown as Record<string, unknown>)[key] = v === null ? Infinity : v;
      } else if (BOOLEAN_LIMITS.includes(key as keyof PlanLimits) || key === "allowedEnvironments") {
        (out as unknown as Record<string, unknown>)[key] = v;
      }
    }
  }
  return out;
}

/** `billing.stripePrices`: `{ PRO?: "price_…", ENTERPRISE?: "price_…" }`; empty string clears one. */
export function validateStripePrices(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Must be an object like {\"PRO\": \"price_123\"}";
  for (const [plan, id] of Object.entries(value as Record<string, unknown>)) {
    if (plan !== "PRO" && plan !== "ENTERPRISE") return `Unknown plan "${plan}" (use PRO or ENTERPRISE)`;
    if (typeof id !== "string" || (id !== "" && !/^price_[A-Za-z0-9]+$/.test(id))) return `${plan}: a Stripe price ID looks like price_1Abc…`;
  }
  return undefined;
}

// ── Registry ──────────────────────────────────────────────────────────────────

export const SETTING_DEFINITIONS = {
  "general.productName": { group: "general", label: "Product name", description: "Shown in page titles, emails and the dashboard.", type: "string", default: "VhyxVoid", public: true, maxLength: 60 },
  "general.tagline": { group: "general", label: "Tagline", description: "One line under the product name.", type: "string", default: "Your localhost, on the internet. Instantly.", public: true, maxLength: 140 },
  "general.statusPageUrl": { group: "general", label: "Status page URL", description: "Linked from the footer when set.", type: "url", default: "", public: true },
  "general.twitterUrl": { group: "general", label: "X / Twitter URL", description: "Footer link when set.", type: "url", default: "", public: true },
  "general.githubUrl": { group: "general", label: "GitHub URL", description: "Footer link when set.", type: "url", default: "", public: true },

  "maintenance.enabled": { group: "maintenance", label: "Maintenance mode", description: "Users get a maintenance page and the user API answers 503. Admin panel, public pages, webhooks and running tunnels keep working.", type: "boolean", default: false, public: true },
  "maintenance.message": { group: "maintenance", label: "Maintenance message", description: "Shown to users while maintenance mode is on.", type: "text", default: "We're doing some scheduled maintenance and will be back shortly.", public: true, maxLength: 500 },

  "announcement.enabled": { group: "announcement", label: "Show banner", description: "Show the announcement banner.", type: "boolean", default: false, public: true },
  "announcement.message": { group: "announcement", label: "Message", description: "Banner text.", type: "string", default: "", public: true, maxLength: 240 },
  "announcement.tone": { group: "announcement", label: "Tone", description: "Banner colour.", type: "enum", default: "info", public: true, options: ["info", "success", "warning", "danger"] },
  "announcement.linkText": { group: "announcement", label: "Link text", description: "Optional link label.", type: "string", default: "", public: true, maxLength: 40 },
  "announcement.linkUrl": { group: "announcement", label: "Link URL", description: "Optional link target.", type: "url", default: "", public: true },

  "auth.signupsEnabled": { group: "auth", label: "Allow sign-ups", description: "When off, new accounts can only join through an invitation.", type: "boolean", default: true, public: true },
  "auth.allowedEmailDomains": { group: "auth", label: "Allowed email domains", description: "Only these domains may sign up (e.g. company.com). Empty allows every domain.", type: "stringList", default: [], public: false },
  "auth.blockedEmailDomains": { group: "auth", label: "Blocked email domains", description: "Sign-ups from these domains are refused (disposable mail providers, for example).", type: "stringList", default: [], public: false },

  "billing.mode": { group: "billing", label: "Billing mode", description: "free: everyone uses the product without paying (launch / early access); upgrades and pricing tiers are hidden. paid: plans can be bought through Stripe. Existing subscriptions keep working in either mode.", type: "enum", default: "free", public: true, options: ["free", "paid"] },
  "billing.defaultPlan": { group: "billing", label: "Plan for accounts that don't pay", description: "The plan every account without a paid subscription gets. Raise it to PRO during a launch to be generous; edit each plan's limits under Plan limits.", type: "enum", default: "FREE", public: true, options: ["FREE", "PRO", "ENTERPRISE"] },
  "billing.freeModeMessage": { group: "billing", label: "Free mode message", description: "Shown on the pricing and billing pages while billing mode is free.", type: "string", default: "Free during early access. No credit card needed.", public: true, maxLength: 160 },
  "billing.stripePrices": { group: "billing", label: "Stripe price IDs", description: "The recurring Stripe price for each paid plan, e.g. {\"PRO\": \"price_123\", \"ENTERPRISE\": \"price_456\"}. Overrides the STRIPE_*_PRICE_ID environment variables. Create prices in the Stripe dashboard.", type: "json", default: {}, public: false, validate: validateStripePrices },
  "billing.checkoutEnabled": { group: "billing", label: "Allow upgrades", description: "When off, the upgrade buttons are hidden and checkout is refused.", type: "boolean", default: true, public: true },
  "billing.trialDays": { group: "billing", label: "Trial length (days)", description: "Free trial on an account's first paid subscription only. 0 disables trials.", type: "number", default: 14, public: true, min: 0, max: 90 },
  "billing.usageNotices": { group: "billing", label: "Usage emails", description: "Tell an account's owners and admins (in-app and email) when it reaches 80% and 100% of its plan's monthly requests, once per month each. The monthly limit is soft: nothing is blocked.", type: "boolean", default: true, public: false },
  "billing.trialNoticeDays": { group: "billing", label: "Trial reminder (days before end)", description: "Remind owners and admins this many days before a trial ends (in-app and email, once per trial). Stripe's own 3-day notice is merged with it. 0 turns the reminder off.", type: "number", default: 3, public: false, min: 0, max: 14 },

  "plans.overrides": { group: "plans", label: "Plan limit overrides", description: "Per-plan overrides of the built-in limits. Use null for unlimited. Changes apply within a minute.", type: "json", default: {}, public: false, validate: validatePlanOverrides },

  "tunnels.customDomainTarget": { group: "tunnels", label: "Custom domain target", description: "The hostname customers point their domains at with a CNAME (e.g. edge.vhyxvoid.com, an A record on your edge server). Empty disables adding custom domains.", type: "string", default: "", public: true, maxLength: 253 },
  "tunnels.recommendedAgentVersion": { group: "tunnels", label: "Recommended agent version", description: "Agents older than this get an \"update available\" note on the dashboard's Agents card (they keep working). Set it to the newest published @vhyxvoid/agent after a release. Empty: no note.", type: "string", default: "1.1.0", public: true, maxLength: 40, validate: (v) => (v === "" || isValidVersion(v) ? undefined : "Must be a version like 1.2.0") },
  "tunnels.minimumAgentVersion": { group: "tunnels", label: "Minimum agent version", description: "The hub refuses agents older than this at connect time with an \"update the agent\" message (connected agents stay until they reconnect). For security fixes or protocol changes. Empty: any version may connect.", type: "string", default: "", public: true, maxLength: 40, validate: (v) => (v === "" || isValidVersion(v) ? undefined : "Must be a version like 1.0.0") },
  "tunnels.newAgentsEnabled": { group: "tunnels", label: "Accept new agent connections", description: "When off, the hub refuses new agent registrations (running tunnels stay up). For incidents.", type: "boolean", default: true, public: false },

  "support.email": { group: "support", label: "Support email", description: "Shown on the website and in emails.", type: "email", default: "support@vhyxvoid.com", public: true },
  "support.docsUrl": { group: "support", label: "Documentation URL", description: "Where 'Docs' links go.", type: "url", default: "/docs", public: true },

  "features.requestInspector": { group: "features", label: "Request inspector", description: "The hub keeps recent requests of each tunnel (bodies cut at 16 KB, credentials hidden, 24 h) so users can inspect and replay them. How many per tunnel is the plan limit inspectorRequests.", type: "boolean", default: true, public: true },
  "features.webhookInbox": { group: "features", label: "Webhook inbox", description: "Tunnels with their inbox on keep write requests (webhooks) that arrive while the agent is offline and deliver them when it reconnects. How many per tunnel is the plan limit inboxRequests.", type: "boolean", default: true, public: true },
  "features.customDomains": { group: "features", label: "Custom domains", description: "Customers can serve a tunnel on their own hostname. Needs the edge (Caddy) and a target hostname under Tunnels.", type: "boolean", default: true, public: true },
  "features.trafficRules": { group: "features", label: "Traffic rules", description: "Customers can add rules to a tunnel that answer with a mock, inject delays or errors, redirect, rewrite paths and set headers, applied by the hub before a request reaches the agent. How many per tunnel is the plan limit maxTrafficRules. Off: every rule is ignored at once.", type: "boolean", default: true, public: true },
  "features.performance": { group: "features", label: "Load tests, monitors and API analytics", description: "Customers can load-test their own tunnels, mocks and verified custom domains (sent straight to the hub, never to other hosts), schedule monitors that run collections and feed MONITOR alerts, and see per-endpoint analytics. How much is the plan limits maxLoadTestVus, maxLoadTestSeconds, maxLoadTestRps, loadTestsPerDay, maxMonitors and minMonitorIntervalMinutes. Off: new load tests are refused, running ones stop within a second, monitors pause; analytics stay readable.", type: "boolean", default: true, public: true },
  "features.apiDocs": { group: "features", label: "API documentation", description: "Customers can write OpenAPI specs in the dashboard (form or YAML, validated), publish versions with a breaking-change report, and share rendered docs publicly, behind a password or on their own domain, with try-it against a mock. How many is the plan limit maxApiSpecs; passwords and domains are protectedDocs and docsCustomDomains. Off: editing and publishing are refused and public docs pages answer 404; saved specs stay.", type: "boolean", default: true, public: true },
  "features.apiClient": { group: "features", label: "API client and tests", description: "Customers can send requests from the dashboard through the platform's server-side runner (public addresses only), keep collections and environments, add checks and run collections. How much is the plan limits maxApiCollections, maxApiCollectionRequests and apiClientSendsPerMinute. Off: sending and runs are refused; saved collections stay.", type: "boolean", default: true, public: true },
  "features.mockApis": { group: "features", label: "Mock APIs", description: "Customers can create hosted mock APIs that answer at a tunnel label's URL with no agent running (endpoints, response rules, templating, OpenAPI import). How many is the plan limits maxMockApis and maxMockEndpoints. Off: the hub stops answering from mocks.", type: "boolean", default: true, public: true },
  "features.alerts": { group: "features", label: "Alerts", description: "Customers can create alert rules (tunnel offline, error rate, usage, inbox, domains) delivered by email, in-app and webhook.", type: "boolean", default: true, public: true },
  "features.feedbackEnabled": { group: "features", label: "Feedback form", description: "Let signed-in users send feedback from the dashboard.", type: "boolean", default: true, public: true },
} as const satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;

type ValueOf<D> = D extends { type: "boolean" }
  ? boolean
  : D extends { type: "number" }
    ? number
    : D extends { type: "stringList" }
      ? string[]
      : D extends { type: "json" }
        ? unknown
        : string;
export type StripePricesSetting = Partial<Record<"PRO" | "ENTERPRISE", string>>;
export type SettingValue<K extends SettingKey> = K extends "plans.overrides"
  ? PlanOverridesSetting
  : K extends "billing.stripePrices"
    ? StripePricesSetting
    : ValueOf<(typeof SETTING_DEFINITIONS)[K]>;

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_DEFINITIONS, key);
}

export function settingDefinition(key: SettingKey): SettingDefinition {
  return SETTING_DEFINITIONS[key] as SettingDefinition;
}

/** Normalised value, or an error message. */
export function validateSettingValue(key: string, value: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!isSettingKey(key)) return { ok: false, error: `Unknown setting "${key}"` };
  const def = settingDefinition(key);
  switch (def.type) {
    case "boolean":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false, error: "Must be true or false" };
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, error: "Must be a number" };
      if (def.min !== undefined && value < def.min) return { ok: false, error: `Must be at least ${def.min}` };
      if (def.max !== undefined && value > def.max) return { ok: false, error: `Must be at most ${def.max}` };
      return { ok: true, value };
    }
    case "enum":
      return typeof value === "string" && def.options?.includes(value)
        ? { ok: true, value }
        : { ok: false, error: `Must be one of: ${def.options?.join(", ")}` };
    case "stringList": {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return { ok: false, error: "Must be a list of text values" };
      const cleaned = [...new Set(value.map((v: string) => v.trim().toLowerCase()).filter(Boolean))];
      if (cleaned.length > 500) return { ok: false, error: "At most 500 entries" };
      return { ok: true, value: cleaned };
    }
    case "json": {
      const err = def.validate?.(value);
      return err ? { ok: false, error: err } : { ok: true, value };
    }
    default: {
      if (typeof value !== "string") return { ok: false, error: "Must be text" };
      const v = value.trim();
      if (def.maxLength !== undefined && v.length > def.maxLength) return { ok: false, error: `At most ${def.maxLength} characters` };
      if (def.type === "url" && v && !/^(https?:\/\/[^\s]+|\/[^\s]*)$/i.test(v)) return { ok: false, error: "Must be an http(s) URL or a path starting with /" };
      if (def.type === "email" && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { ok: false, error: "Must be an email address" };
      const err = def.validate?.(v);
      if (err) return { ok: false, error: err };
      return { ok: true, value: v };
    }
  }
}

export interface StoredSetting {
  key: string;
  value: unknown;
}

/**
 * Reads settings with defaults, caching the whole table for `ttlMs` (the
 * table is tiny). A failed load keeps serving the last good values, or the
 * defaults, so a database blip never changes behaviour.
 */
export class SettingsReader {
  private cache: Map<string, unknown> | null = null;
  private loadedAt = 0;
  private inflight: Promise<Map<string, unknown>> | null = null;

  constructor(
    private readonly load: () => Promise<StoredSetting[]>,
    private readonly ttlMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  private async values(): Promise<Map<string, unknown>> {
    if (this.cache && this.now() - this.loadedAt < this.ttlMs) return this.cache;
    if (!this.inflight) {
      this.inflight = this.load()
        .then((rows) => {
          const map = new Map<string, unknown>();
          for (const row of rows) {
            if (!isSettingKey(row.key)) continue;
            const checked = validateSettingValue(row.key, row.value);
            if (checked.ok) map.set(row.key, checked.value);
          }
          this.cache = map;
          this.loadedAt = this.now();
          return map;
        })
        .catch((err) => {
          console.error("[settings] load failed; using last known values", (err as Error).message);
          this.loadedAt = this.now() - this.ttlMs + 5_000; // retry in ~5 s
          return this.cache ?? new Map();
        })
        .finally(() => {
          this.inflight = null;
        });
    }
    return this.inflight;
  }

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const values = await this.values();
    return (values.has(key) ? values.get(key) : SETTING_DEFINITIONS[key].default) as SettingValue<K>;
  }

  /** Every setting, with defaults filled in. */
  async all(): Promise<Record<SettingKey, unknown>> {
    const values = await this.values();
    const out = {} as Record<SettingKey, unknown>;
    for (const key of Object.keys(SETTING_DEFINITIONS) as SettingKey[]) {
      out[key] = values.has(key) ? values.get(key) : SETTING_DEFINITIONS[key].default;
    }
    return out;
  }

  /** Only the settings marked public. */
  async publicValues(): Promise<Record<string, unknown>> {
    const all = await this.all();
    return Object.fromEntries(
      (Object.keys(all) as SettingKey[]).filter((k) => settingDefinition(k).public).map((k) => [k, all[k]]),
    );
  }

  /** Drop the cache (after a write in this process). */
  invalidate(): void {
    this.cache = null;
    this.loadedAt = 0;
  }
}

/** Effective limits of one plan given the stored plan overrides. */
export function effectivePlanLimits(plan: Plan, overrides: PlanOverridesSetting | undefined): PlanLimits {
  return applyLimitOverrides(PLAN_LIMITS[plan] ?? PLAN_LIMITS[Plan.FREE], overrides?.[plan]);
}

// ── Process-wide reader ───────────────────────────────────────────────────────
// apps/api and apps/hub each install one reader at boot; library code (plan
// limit resolution, API-key cache reloads) reads through it. Nothing installed
// (unit tests, scripts) means defaults.

let installedReader: SettingsReader | null = null;

export function installSettingsReader(reader: SettingsReader | null): void {
  installedReader = reader;
}

export function getSettingsReader(): SettingsReader | null {
  return installedReader;
}

/** A setting's current value, or its default when no reader is installed. */
export async function readSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  return installedReader ? installedReader.get(key) : (SETTING_DEFINITIONS[key].default as SettingValue<K>);
}

/** The plan-wide limit overrides, or undefined when none are set. */
export async function currentPlanOverrides(): Promise<PlanOverridesSetting | undefined> {
  const value = await readSetting("plans.overrides");
  return value && Object.keys(value).length > 0 ? value : undefined;
}

/** A reader over Prisma's `systemSetting` table. */
export function createPrismaSettingsReader(
  prisma: { systemSetting: { findMany(args: { select: { key: true; value: true } }): Promise<StoredSetting[]> } },
  ttlMs = 30_000,
): SettingsReader {
  return new SettingsReader(() => prisma.systemSetting.findMany({ select: { key: true, value: true } }), ttlMs);
}

/** The plan accounts without a paid subscription get (`billing.defaultPlan`). */
export async function currentDefaultPlan(): Promise<Plan> {
  const value = await readSetting("billing.defaultPlan");
  return value in PLAN_LIMITS ? (value as Plan) : Plan.FREE;
}

/**
 * The Stripe price of each paid plan: the admin setting first, then the
 * STRIPE_*_PRICE_ID environment variables.
 */
export async function currentStripePrices(env: Record<string, string | undefined> = process.env): Promise<StripePricesSetting> {
  const stored = (await readSetting("billing.stripePrices")) ?? {};
  const out: StripePricesSetting = {};
  const pro = stored.PRO || env.STRIPE_PRO_PRICE_ID;
  const ent = stored.ENTERPRISE || env.STRIPE_ENTERPRISE_PRICE_ID;
  if (pro) out.PRO = pro;
  if (ent) out.ENTERPRISE = ent;
  return out;
}

