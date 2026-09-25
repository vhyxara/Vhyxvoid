import { describe, it, expect } from "vitest";
import { PlanLimitExceededError } from "../../apps/api/src/core/errors/error.format";
import { RoleLevel } from "../../apps/api/src/core/constant/account.constant";
import { makeMemberHarness, OWNER_ID } from "./memberLimitHarness";

// Covers shared/context.md Known Risk #57 (E5, maxMembers) and
// shared/decision.md, 2026-09-22, session S2. CheckPlanLimitsService.
// canAddMember existed with zero callers; this wires it into InviteMember,
// counting current members PLUS pending invitations (not members alone), so
// an account can't send more invitations than it has room to accept.

describe("InviteMember respects the account's maxMembers limit", () => {
  it("FREE (maxMembers: 1): the owner alone already occupies the limit, so inviting anyone is refused", async () => {
    const h = makeMemberHarness(); // FREE, only the owner

    await expect(h.invite()).rejects.toThrow(PlanLimitExceededError);
    expect(h.memberCount()).toBe(1);
    expect(h.invitations).toHaveLength(0);
  });

  it("the refusal is a real PlanLimitExceededError (402), not a generic error, with the right details", async () => {
    const h = makeMemberHarness();

    try {
      await h.invite();
      throw new Error("expected invite() to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PlanLimitExceededError);
      const e = err as InstanceType<typeof PlanLimitExceededError>;
      expect(e.statusCode).toBe(402);
      expect(e.details).toMatchObject({ limit: 1, current: 1, limitKey: "maxMembers", plan: "FREE" });
    }
  });

  it("PRO (maxMembers: 10): invites succeed until the account (members + pending invites) is full", async () => {
    const h = makeMemberHarness({ plan: "PRO", memberUserIds: Array.from({ length: 8 }, (_, i) => `m${i}`) });
    // 1 owner + 8 members = 9; room for exactly one more invite (pending
    // counts toward the limit too, so a second concurrent invite is refused
    // even though no one has accepted the first one yet).
    await h.invite({ email: "one-more@example.com" });
    expect(h.invitations).toHaveLength(1);

    await expect(h.invite({ email: "one-too-many@example.com" })).rejects.toThrow(PlanLimitExceededError);
    expect(h.invitations).toHaveLength(1);
  });

  it("ENTERPRISE (unlimited): many invites all succeed", async () => {
    const h = makeMemberHarness({ plan: "ENTERPRISE" });

    for (let i = 0; i < 15; i++) {
      await h.invite({ email: `person${i}@example.com` });
    }
    expect(h.invitations).toHaveLength(15);
  });

  it("counts pending invitations, not just current members, against the limit", async () => {
    const h = makeMemberHarness({ plan: "PRO", memberUserIds: Array.from({ length: 9 }, (_, i) => `m${i}`) });
    // 1 owner + 9 members = 10, already at PRO's limit; no pending invites
    // yet, but the account is already full.
    await expect(h.invite({ email: "no-room@example.com" })).rejects.toThrow(PlanLimitExceededError);
  });

  it("a PAST_DUE account keeps its real plan's limit during the grace period (not dropped to FREE)", async () => {
    const h = makeMemberHarness({ accountStatus: "PAST_DUE", plan: "PRO" });

    // PRO's limit (10) applies, not FREE's (1) — the owner alone would have
    // already been over FREE's limit.
    await h.invite();
    expect(h.invitations).toHaveLength(1);
  });

  it("a SUSPENDED account with a PRO subscription is treated as FREE for this check too", async () => {
    const h = makeMemberHarness({ accountStatus: "SUSPENDED", plan: "PRO" });

    await expect(h.invite()).rejects.toThrow(PlanLimitExceededError);
  });

  it("existing behavior (permission checks, duplicate-invite check) is unaffected by the new guard", async () => {
    const h = makeMemberHarness({ plan: "PRO" });

    await expect(h.invite({ inviterId: "not-a-member" })).rejects.toThrow(/admins and owners/);

    await h.invite({ email: "dup@example.com" });
    await expect(h.invite({ email: "dup@example.com" })).rejects.toThrow(
      /pending invitation already exists/,
    );
  });

  it("does not retroactively break an account already over its (newly enforced) limit — it only blocks the NEXT invite", async () => {
    // A FREE account that already has 2 members (grandfathered from before
    // this enforcement existed, or downgraded from a higher plan).
    const h = makeMemberHarness({ memberUserIds: ["already-here"] });
    expect(h.memberCount()).toBe(2); // owner + already-here, already over FREE's limit of 1

    // The existing members are untouched — nothing removes them.
    expect(h.memberships.map((m) => m.userId)).toEqual([OWNER_ID, "already-here"]);
    // A new invite is refused (the account is over the limit, not merely at it).
    await expect(h.invite({ email: "new@example.com" })).rejects.toThrow(PlanLimitExceededError);
    expect(h.memberCount()).toBe(2);
  });
});

// shared/decision.md, 2026-09-25: a personal workspace never has members, on
// any plan (a PRO personal account's maxMembers of 10 does not apply).
describe("InviteMember on a personal workspace", () => {
  it("is refused with a 403 even on PRO, before any invitation is created", async () => {
    const h = makeMemberHarness({ plan: "PRO", accountType: "PERSONAL" });
    const err = await h.invite().catch((e: any) => e);
    expect(err?.statusCode).toBe(403);
    expect(String(err?.message)).toMatch(/Personal workspaces can't have members/);
    expect(h.invitations).toHaveLength(0);
  });
});
