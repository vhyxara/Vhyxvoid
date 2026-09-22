import { describe, it, expect } from "vitest";
import { PlanLimitExceededError } from "../../apps/api/src/core/errors/error.format";
import { RoleLevel } from "../../apps/api/src/core/constant/account.constant";
import { makeMemberHarness, OWNER_ID } from "./memberLimitHarness";

// Covers shared/context.md Known Risk #57 (E5, maxMembers) and
// shared/decision.md, 2026-09-22, session S2, brief item 3: AcceptInvitation
// needs its own guard, not just InviteMember's at invite time — an account
// can go over its limit between an invitation being sent and it being
// accepted (downgraded plan, or two invitations both pending and both
// accepted close together).

describe("AcceptInvitation respects the account's maxMembers limit", () => {
  it("accepting a valid invitation on a PRO account with room succeeds", async () => {
    const h = makeMemberHarness({ plan: "PRO", memberUserIds: ["existing1"] });
    const { rawToken } = await h.seedPendingInvitation("new@example.com");

    await h.accept(rawToken, "new_user", "new@example.com");

    expect(h.memberCount()).toBe(3); // owner + existing1 + new_user
  });

  it("the account was downgraded to FREE after the invitation was sent — accepting is now refused", async () => {
    // Sent while PRO (or FREE with room); by the time it's accepted the
    // account is FREE and already full (the owner alone occupies it).
    const h = makeMemberHarness({ plan: null }); // FREE
    const { rawToken } = await h.seedPendingInvitation("late@example.com");

    await expect(h.accept(rawToken, "late_user", "late@example.com")).rejects.toThrow(
      PlanLimitExceededError,
    );
    expect(h.memberCount()).toBe(1); // unchanged
  });

  it("the refusal is a real PlanLimitExceededError (402) with the right details, and the invitation is NOT consumed", async () => {
    const h = makeMemberHarness({ plan: null });
    const { rawToken, invitation } = await h.seedPendingInvitation("late@example.com");

    try {
      await h.accept(rawToken, "late_user", "late@example.com");
      throw new Error("expected accept() to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PlanLimitExceededError);
      const e = err as InstanceType<typeof PlanLimitExceededError>;
      expect(e.statusCode).toBe(402);
      expect(e.details).toMatchObject({ limit: 1, current: 1, limitKey: "maxMembers", plan: "FREE" });
    }
    // Refused before the membership is created, and the invitation stays
    // PENDING so a real, later fix (upgrading the plan) lets it be accepted.
    expect(invitation.status).toBe("PENDING");
  });

  it("two invitations both pending, both accepted close together, when only one seat is free: the second is refused", async () => {
    const h = makeMemberHarness({ plan: "PRO", memberUserIds: Array.from({ length: 8 }, (_, i) => `m${i}`) });
    // 1 owner + 8 members = 9; exactly one seat free under PRO's limit of 10.
    const invA = await h.seedPendingInvitation("a@example.com");
    const invB = await h.seedPendingInvitation("b@example.com");

    await h.accept(invA.rawToken, "user_a", "a@example.com");
    expect(h.memberCount()).toBe(10);

    await expect(h.accept(invB.rawToken, "user_b", "b@example.com")).rejects.toThrow(
      PlanLimitExceededError,
    );
    expect(h.memberCount()).toBe(10); // the second acceptance did not sneak in
  });

  it("ENTERPRISE (unlimited): many acceptances all succeed", async () => {
    const h = makeMemberHarness({ plan: "ENTERPRISE" });
    const invites = await Promise.all(
      Array.from({ length: 12 }, (_, i) => h.seedPendingInvitation(`p${i}@example.com`)),
    );

    for (let i = 0; i < invites.length; i++) {
      await h.accept(invites[i].rawToken, `user_p${i}`, `p${i}@example.com`);
    }

    expect(h.memberCount()).toBe(13); // owner + 12
  });

  it("does not retroactively break an already-over-limit account's existing members — only blocks the next join", async () => {
    const h = makeMemberHarness({ memberUserIds: ["already-here"] }); // FREE, already 2 members
    const { rawToken } = await h.seedPendingInvitation("another@example.com");

    await expect(h.accept(rawToken, "another_user", "another@example.com")).rejects.toThrow(
      PlanLimitExceededError,
    );
    expect(h.memberships.map((m) => m.userId)).toEqual([OWNER_ID, "already-here"]);
  });

  it("existing behavior (invalid token, expired, already a member) is unaffected by the new guard", async () => {
    const h = makeMemberHarness({ plan: "ENTERPRISE" });

    await expect(h.accept("not-a-real-token", "someone", "someone@example.com")).rejects.toThrow(
      /Invalid invitation token/,
    );

    const { rawToken } = await h.seedPendingInvitation("dup@example.com");
    await h.accept(rawToken, "dup_user", "dup@example.com");
    const second = await h.seedPendingInvitation("dup@example.com");
    // Re-inviting isn't guarded by InviteMember here (seedPendingInvitation
    // bypasses it), but accepting as the same already-a-member user must
    // still fail with the pre-existing check, not the plan-limit one.
    await expect(h.accept(second.rawToken, "dup_user", "dup@example.com")).rejects.toThrow(
      /already a member/,
    );
  });
});
