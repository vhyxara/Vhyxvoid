import { describe, it, expect, vi } from "vitest";
import { RemoveMemberUseCase } from "../../apps/api/src/modules/identity/application/use-cases/account/RemoveMember.usecase";
import { RoleLevel } from "../../apps/api/src/core/constant/account.constant";

// Audit part2 G9 (shared/audit-2026-09-24-part2.md): removing a member (or a
// member leaving) deleted the membership row and nothing else. API keys that
// member created in the organization stayed ACTIVE, so a removed employee kept
// full tunnel access (agent registration, SDK), and invitations they had sent
// stayed valid. Removal now revokes their keys in that organization and
// cancels their pending invitations, in the same transaction, and drops the
// revoked keys' cache entries after commit.

type Key = { id: string; keyId: string; accountId: string; createdById: string; status: string; revokedAt?: Date | null; revokedById?: string | null };
type Invite = { id: string; accountId: string; invitedById: string; status: string; canceledAt?: Date | null };

function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) =>
    v && typeof v === "object" && "in" in v ? v.in.includes(row[k]) : row[k] === v,
  );
}

function harness(opts: { actorLevel: RoleLevel; targetLevel: RoleLevel; owners?: number }) {
  const keys: Key[] = [
    { id: "k1", keyId: "vhyxvoid_dev_target1", accountId: "acct", createdById: "target", status: "ACTIVE" },
    { id: "k2", keyId: "vhyxvoid_dev_target2", accountId: "acct", createdById: "target", status: "ACTIVE" },
    { id: "k3", keyId: "vhyxvoid_dev_targetOld", accountId: "acct", createdById: "target", status: "REVOKED" },
    { id: "k4", keyId: "vhyxvoid_dev_other", accountId: "acct", createdById: "other", status: "ACTIVE" },
    { id: "k5", keyId: "vhyxvoid_dev_targetElsewhere", accountId: "acct2", createdById: "target", status: "ACTIVE" },
  ];
  const invites: Invite[] = [
    { id: "i1", accountId: "acct", invitedById: "target", status: "PENDING" },
    { id: "i2", accountId: "acct", invitedById: "target", status: "ACCEPTED" },
    { id: "i3", accountId: "acct", invitedById: "other", status: "PENDING" },
    { id: "i4", accountId: "acct2", invitedById: "target", status: "PENDING" },
  ];
  const audit: any[] = [];
  const members = new Map<string, { roleLevel: RoleLevel }>([
    ["actor", { roleLevel: opts.actorLevel }],
    ["target", { roleLevel: opts.targetLevel }],
    ["other", { roleLevel: RoleLevel.MEMBER }],
  ]);
  const committed: (() => unknown)[] = [];

  const membership = (userId: string) => {
    const m = members.get(userId);
    if (!m) return null;
    return {
      userId,
      roleLevel: m.roleLevel,
      isOwner: () => m.roleLevel === RoleLevel.OWNER,
      isAdmin: () => m.roleLevel >= RoleLevel.ADMIN,
      canManage: (t: any) => m.roleLevel > t.roleLevel,
    };
  };
  const prisma = {
    apiKey: {
      findMany: async ({ where }: any) => keys.filter((k) => matches(k, where)),
      updateMany: async ({ where, data }: any) => {
        const hit = keys.filter((k) => matches(k, where));
        hit.forEach((k) => Object.assign(k, data));
        return { count: hit.length };
      },
    },
    accountInvitation: {
      updateMany: async ({ where, data }: any) => {
        const hit = invites.filter((i) => matches(i, where));
        hit.forEach((i) => Object.assign(i, data));
        return { count: hit.length };
      },
    },
  };
  const tx = {
    prisma,
    membershipRepository: {
      findByAccountAndUser: async (_a: string, u: string) => membership(u),
      countOwners: async () => opts.owners ?? 1,
      delete: async (_a: string, u: string) => void members.delete(u),
    },
    auditLogRepository: { create: async (e: any) => void audit.push(e) },
    afterCommit: (fn: () => unknown) => void committed.push(fn),
  };
  const uow: any = {
    execute: async (fn: any) => {
      const r = await fn(tx);
      for (const f of committed.splice(0)) await f();
      return r;
    },
  };
  const invalidate = vi.fn(async (_keyIds: string[]) => {});
  const useCase = new RemoveMemberUseCase(uow, invalidate);
  return { useCase, keys, invites, audit, members, invalidate };
}

describe("removing a member revokes their access to the organization", () => {
  it("revokes the removed member's active keys in this organization", async () => {
    const h = harness({ actorLevel: RoleLevel.OWNER, targetLevel: RoleLevel.MEMBER });

    await h.useCase.execute({ accountId: "acct", actorUserId: "actor", targetUserId: "target" });

    const byId = Object.fromEntries(h.keys.map((k) => [k.id, k]));
    expect(byId.k1.status).toBe("REVOKED");
    expect(byId.k2.status).toBe("REVOKED");
    expect(byId.k1.revokedById).toBe("actor");
    expect(byId.k1.revokedAt).toBeInstanceOf(Date);
    expect(h.members.has("target")).toBe(false);
  });

  it("leaves other members' keys, and the member's keys in other organizations, alone", async () => {
    const h = harness({ actorLevel: RoleLevel.OWNER, targetLevel: RoleLevel.MEMBER });

    await h.useCase.execute({ accountId: "acct", actorUserId: "actor", targetUserId: "target" });

    const byId = Object.fromEntries(h.keys.map((k) => [k.id, k]));
    expect(byId.k4.status).toBe("ACTIVE");
    expect(byId.k5.status).toBe("ACTIVE");
    expect(byId.k3.revokedById).toBeUndefined(); // already revoked: untouched
  });

  it("cancels only the removed member's pending invitations in this organization", async () => {
    const h = harness({ actorLevel: RoleLevel.OWNER, targetLevel: RoleLevel.MEMBER });

    await h.useCase.execute({ accountId: "acct", actorUserId: "actor", targetUserId: "target" });

    const byId = Object.fromEntries(h.invites.map((i) => [i.id, i]));
    expect(byId.i1.status).toBe("CANCELED");
    expect(byId.i1.canceledAt).toBeInstanceOf(Date);
    expect(byId.i2.status).toBe("ACCEPTED");
    expect(byId.i3.status).toBe("PENDING");
    expect(byId.i4.status).toBe("PENDING");
  });

  it("drops the revoked keys' cache entries after commit", async () => {
    const h = harness({ actorLevel: RoleLevel.OWNER, targetLevel: RoleLevel.MEMBER });

    await h.useCase.execute({ accountId: "acct", actorUserId: "actor", targetUserId: "target" });

    expect(h.invalidate).toHaveBeenCalledTimes(1);
    expect(h.invalidate.mock.calls[0][0].sort()).toEqual(["vhyxvoid_dev_target1", "vhyxvoid_dev_target2"]);
  });

  it("audits each revoked key and records the counts on the removal", async () => {
    const h = harness({ actorLevel: RoleLevel.OWNER, targetLevel: RoleLevel.MEMBER });

    await h.useCase.execute({ accountId: "acct", actorUserId: "actor", targetUserId: "target" });

    const keyAudits = h.audit.filter((a) => a.action === "API_KEY_REVOKED");
    expect(keyAudits.map((a) => a.metadata.keyId).sort()).toEqual(["vhyxvoid_dev_target1", "vhyxvoid_dev_target2"]);
    expect(keyAudits[0].metadata.reason).toBe("member_removed");
    const removal = h.audit.find((a) => a.action === "ACCOUNT_MEMBER_REMOVED");
    expect(removal.metadata).toMatchObject({ revokedApiKeys: 2, canceledInvitations: 1 });
  });

  it("does the same when a member leaves on their own", async () => {
    const h = harness({ actorLevel: RoleLevel.MEMBER, targetLevel: RoleLevel.MEMBER });

    await h.useCase.execute({ accountId: "acct", actorUserId: "target", targetUserId: "target" });

    const byId = Object.fromEntries(h.keys.map((k) => [k.id, k]));
    expect(byId.k1.status).toBe("REVOKED");
    expect(byId.k1.revokedById).toBe("target");
    expect(h.invites.find((i) => i.id === "i1")!.status).toBe("CANCELED");
  });

  it("revokes nothing when the removal is refused", async () => {
    const h = harness({ actorLevel: RoleLevel.MEMBER, targetLevel: RoleLevel.ADMIN });

    await expect(
      h.useCase.execute({ accountId: "acct", actorUserId: "actor", targetUserId: "target" }),
    ).rejects.toThrow();

    expect(h.keys.filter((k) => k.status === "ACTIVE").map((k) => k.id)).toEqual(["k1", "k2", "k4", "k5"]);
    expect(h.invalidate).not.toHaveBeenCalled();
  });
});
