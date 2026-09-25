import { describe, it, expect } from "vitest";
import { PLAN_LIMITS } from "../../packages/shared/src/planLimits";
import { UPGRADE_PLANS, planFeatures } from "../../apps/web/src/views/org/billing/billingPlans";

// user-frontend backlog, 2026-09-21: the upgrade dialog promised "5 team
// members" and "50 active tunnels" for Pro, matching nothing enforced
// (PLAN_LIMITS: Pro 10 members, 5 agents). The dialog's numbers now live in
// billingPlans.ts and must equal PLAN_LIMITS.
describe("upgrade dialog plans match PLAN_LIMITS", () => {
  for (const plan of UPGRADE_PLANS) {
    it(`${plan.label}`, () => {
      const real = PLAN_LIMITS[plan.id.toUpperCase() as keyof typeof PLAN_LIMITS];
      for (const [k, v] of Object.entries(plan.limits)) {
        expect(v, k).toBe((real as any)[k]);
      }
    });
  }

  it("leaves team members out for a personal workspace", () => {
    const pro = UPGRADE_PLANS[0];
    expect(planFeatures(pro).some((f) => f.includes("team members"))).toBe(true);
    expect(planFeatures(pro, true).some((f) => f.includes("team members"))).toBe(false);
  });
});
