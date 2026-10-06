// Billing is controlled from the admin panel: free launch mode, the plan
// accounts without a subscription get, and the Stripe price of each plan.
import { afterEach, describe, expect, it } from "vitest";

import {
  currentStripePrices,
  installSettingsReader,
  SettingsReader,
  validateSettingValue,
} from "../../packages/shared/src/settings";
import { resolvePlanForAccount } from "../../packages/shared/src/planResolver";
import { buildStripeService } from "../../apps/api/src/modules/billing/infrastructure/stripe";

function useSettings(values: Record<string, unknown>) {
  installSettingsReader(new SettingsReader(async () => Object.entries(values).map(([key, value]) => ({ key, value }))));
}

const prisma = (sub: { plan: string; status: string } | null, status = "ACTIVE") => ({
  account: { findUnique: async () => ({ status }) },
  subscription: { findFirst: async ({ where }: any) => (sub && where.status.in.includes(sub.status) ? sub : null) },
});

afterEach(() => installSettingsReader(null));

describe("billing.defaultPlan", () => {
  it("is FREE by default for accounts without a subscription", async () => {
    expect(await resolvePlanForAccount(prisma(null), "a")).toBe("FREE");
  });

  it("can be raised for a launch", async () => {
    useSettings({ "billing.defaultPlan": "PRO" });
    expect(await resolvePlanForAccount(prisma(null), "a")).toBe("PRO");
    // A canceled subscription falls back to the default plan too.
    expect(await resolvePlanForAccount(prisma({ plan: "ENTERPRISE", status: "CANCELED" }), "a")).toBe("PRO");
  });

  it("never reaches suspended accounts", async () => {
    useSettings({ "billing.defaultPlan": "ENTERPRISE" });
    expect(await resolvePlanForAccount(prisma(null, "SUSPENDED"), "a")).toBe("FREE");
  });

  it("a paying subscription still wins", async () => {
    useSettings({ "billing.defaultPlan": "PRO" });
    expect(await resolvePlanForAccount(prisma({ plan: "ENTERPRISE", status: "ACTIVE" }), "a")).toBe("ENTERPRISE");
  });
});

describe("billing.stripePrices", () => {
  const env = { STRIPE_PRO_PRICE_ID: "price_envpro", STRIPE_ENTERPRISE_PRICE_ID: "price_envent" };

  it("falls back to the environment", async () => {
    expect(await currentStripePrices(env)).toEqual({ PRO: "price_envpro", ENTERPRISE: "price_envent" });
  });

  it("the admin setting overrides the environment per plan", async () => {
    useSettings({ "billing.stripePrices": { PRO: "price_admin1" } });
    expect(await currentStripePrices(env)).toEqual({ PRO: "price_admin1", ENTERPRISE: "price_envent" });
  });

  it("validates shape and IDs", () => {
    expect(validateSettingValue("billing.stripePrices", { PRO: "price_1Abc" }).ok).toBe(true);
    expect(validateSettingValue("billing.stripePrices", { PRO: "" }).ok).toBe(true);
    expect(validateSettingValue("billing.stripePrices", { PRO: "prod_1" }).ok).toBe(false);
    expect(validateSettingValue("billing.stripePrices", { BASIC: "price_1" }).ok).toBe(false);
    expect(validateSettingValue("billing.mode", "paid").ok).toBe(true);
    expect(validateSettingValue("billing.mode", "sometimes").ok).toBe(false);
  });
});

describe("Stripe is optional", () => {
  it("without keys the service reports unconfigured and refuses with 503", async () => {
    const stripe = buildStripeService({});
    expect(stripe.configured).toBe(false);
    await expect(stripe.createCheckoutSession({} as any)).rejects.toMatchObject({ statusCode: 503 });
    expect(await stripe.resolvePlan("price_x")).toBe("FREE");
  });

  it("with keys it is configured and maps prices from settings", async () => {
    useSettings({ "billing.stripePrices": { ENTERPRISE: "price_ent9" } });
    const stripe = buildStripeService({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x" });
    expect(stripe.configured).toBe(true);
    expect(await stripe.resolvePlan("price_ent9")).toBe("ENTERPRISE");
    expect(await stripe.resolvePlan("price_other")).toBe("FREE");
  });
});
