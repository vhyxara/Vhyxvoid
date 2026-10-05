import { describe, expect, it, vi } from "vitest";
import {
  SETTING_DEFINITIONS,
  SettingsReader,
  applyLimitOverrides,
  effectivePlanLimits,
  validateLimitOverrides,
  validateSettingValue,
} from "../../packages/shared/src/settings";
import { getEffectivePlanLimitsForAccount } from "../../packages/shared/src/planResolver";
import { PLAN_LIMITS, Plan } from "../../packages/shared/src/planLimits";
import { landingSchema, pageSchema, pricingSchema } from "../../apps/api/src/modules/platform/content/content.schemas";
import { DEFAULT_CONTENT } from "../../apps/api/src/modules/platform/content/content.defaults";
import { isMaintenanceExempt } from "../../apps/api/src/modules/platform/platform.plugin";
import { domainMatches } from "../../apps/api/src/modules/platform/settings/signupPolicy";

describe("settings registry", () => {
  it("every default passes its own validation", () => {
    for (const [key, def] of Object.entries(SETTING_DEFINITIONS)) {
      const r = validateSettingValue(key, def.default);
      expect(r.ok, `${key}: ${!r.ok && r.error}`).toBe(true);
    }
  });

  it("rejects wrong types, out-of-range numbers, bad enums, URLs and unknown keys", () => {
    expect(validateSettingValue("billing.trialDays", 91).ok).toBe(false);
    expect(validateSettingValue("billing.trialDays", "14").ok).toBe(false);
    expect(validateSettingValue("announcement.tone", "pink").ok).toBe(false);
    expect(validateSettingValue("general.statusPageUrl", "javascript:alert(1)").ok).toBe(false);
    expect(validateSettingValue("general.statusPageUrl", "https://status.example.com").ok).toBe(true);
    expect(validateSettingValue("support.email", "nope").ok).toBe(false);
    expect(validateSettingValue("no.such.key", true).ok).toBe(false);
  });

  it("normalises string lists (trim, lowercase, dedupe)", () => {
    const r = validateSettingValue("auth.blockedEmailDomains", [" Mailinator.com", "mailinator.com", ""]);
    expect(r).toEqual({ ok: true, value: ["mailinator.com"] });
  });

  it("reader serves defaults, caches, and keeps last good values when the store fails", async () => {
    let now = 0;
    const load = vi.fn().mockResolvedValueOnce([{ key: "billing.trialDays", value: 30 }, { key: "billing.trialDays_bogus", value: 1 }]);
    const reader = new SettingsReader(load, 1_000, () => now);
    expect(await reader.get("billing.trialDays")).toBe(30);
    expect(await reader.get("auth.signupsEnabled")).toBe(true);
    now = 500;
    await reader.get("billing.trialDays");
    expect(load).toHaveBeenCalledTimes(1);
    now = 2_000;
    load.mockRejectedValueOnce(new Error("db down"));
    expect(await reader.get("billing.trialDays")).toBe(30);
  });

  it("a stored value that no longer validates falls back to the default", async () => {
    const reader = new SettingsReader(async () => [{ key: "billing.trialDays", value: 5000 }]);
    expect(await reader.get("billing.trialDays")).toBe(14);
  });

  it("publicValues exposes only public settings", async () => {
    const reader = new SettingsReader(async () => []);
    const pub = await reader.publicValues();
    expect(pub).toHaveProperty("maintenance.enabled");
    expect(pub).not.toHaveProperty("plans.overrides");
    expect(pub).not.toHaveProperty("auth.allowedEmailDomains");
  });
});

describe("plan limit overrides", () => {
  it("validates shape: numbers, null for unlimited, booleans, environments", () => {
    expect(validateLimitOverrides({ maxAgents: 3, maxMembers: null, customDomains: true, allowedEnvironments: ["DEV"] })).toBeUndefined();
    expect(validateLimitOverrides({ maxAgents: -1 })).toMatch(/maxAgents/);
    expect(validateLimitOverrides({ maxAgents: 1.5 })).toMatch(/maxAgents/);
    expect(validateLimitOverrides({ customDomains: "yes" })).toMatch(/customDomains/);
    expect(validateLimitOverrides({ hackerField: 1 })).toMatch(/Unknown/);
    expect(validateSettingValue("plans.overrides", { GOLD: {} }).ok).toBe(false);
  });

  it("layers: built-in, then plan override, then account override; null = unlimited", () => {
    const limits = applyLimitOverrides(PLAN_LIMITS[Plan.FREE], { maxAgents: 2, maxApiKeys: 5 }, { maxAgents: null });
    expect(limits.maxAgents).toBe(Infinity);
    expect(limits.maxApiKeys).toBe(5);
    expect(limits.maxMembers).toBe(PLAN_LIMITS[Plan.FREE].maxMembers);
    expect(PLAN_LIMITS[Plan.FREE].maxAgents).toBe(1); // built-ins untouched
    expect(effectivePlanLimits(Plan.PRO, { PRO: { maxAgents: 9 } }).maxAgents).toBe(9);
  });

  it("getEffectivePlanLimitsForAccount applies the account's own overrides and ignores invalid ones", async () => {
    const prisma = (limitOverrides: unknown) => ({
      account: { findUnique: async ({ select }: any) => (select.limitOverrides ? { limitOverrides } : { status: "ACTIVE" }) },
      subscription: { findFirst: async () => ({ plan: "PRO" }) },
    });
    expect((await getEffectivePlanLimitsForAccount(prisma({ maxAgents: 50 }) as any, "a")).maxAgents).toBe(50);
    expect((await getEffectivePlanLimitsForAccount(prisma({ maxAgents: "lots" }) as any, "a")).maxAgents).toBe(5);
    expect((await getEffectivePlanLimitsForAccount(prisma(null) as any, "a", { PRO: { maxAgents: 7 } })).maxAgents).toBe(7);
  });
});

describe("CMS content", () => {
  it("every shipped default validates against its kind's schema", () => {
    const schemas = { landing: landingSchema, pricing: pricingSchema, page: pageSchema };
    for (const entry of DEFAULT_CONTENT) {
      const r = schemas[entry.kind].safeParse(entry.data);
      expect(r.success, `${entry.slug}: ${!r.success && r.error.message}`).toBe(true);
    }
  });

  it("refuses malformed landing data", () => {
    expect(landingSchema.safeParse({ hero: { title: "x" } }).success).toBe(false);
  });
});

describe("maintenance mode and sign-up policy", () => {
  it("keeps the admin panel, public site, refresh, health and webhooks up", () => {
    for (const url of ["/api/v1/admin/overview", "/api/v1/public/bootstrap", "/api/v1/auth/refresh", "/health", "/api/v1/billing/webhooks/stripe"]) {
      expect(isMaintenanceExempt(url), url).toBe(true);
    }
    for (const url of ["/api/v1/account/me", "/api/v1/auth/login", "/api/v1/apikeys/organizations/x/api-keys"]) {
      expect(isMaintenanceExempt(url), url).toBe(false);
    }
  });

  it("matches email domains exactly or by subdomain", () => {
    expect(domainMatches("a@corp.com", ["corp.com"])).toBe(true);
    expect(domainMatches("a@eu.corp.com", ["corp.com"])).toBe(true);
    expect(domainMatches("a@notcorp.com", ["corp.com"])).toBe(false);
  });
});
