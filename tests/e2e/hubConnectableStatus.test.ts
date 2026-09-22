import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { HubAuthService, HubAuthError } from "../../apps/hub/src/services/HubAuth.service";

// Covers shared/context.md Known Risk #57 (E6, Part 4): the agent-handshake
// half of CONNECTABLE_ACCOUNT_STATUSES — HubAuthService.authenticateAgent
// used to reject anything that wasn't literally 'ACTIVE'; PAST_DUE is now
// deliberately let through (the grace period is meant to keep service
// running), while everything else stays refused. Drives the real service,
// not a re-implementation of the check.

const PEPPER = "p".repeat(40);
const RAW_SECRET = "the-raw-secret";
const SECRET_HASH = crypto.createHmac("sha256", PEPPER).update(RAW_SECRET).digest("hex");

function makeService(accountStatus: string) {
  return new HubAuthService(
    {} as any, // validateKeyUseCase — unused by authenticateAgent
    PEPPER,
    async () => ({
      secretHash: SECRET_HASH,
      accountId: "acct_1",
      scopes: ["tunnel:connect"],
      status: "ACTIVE",
      accountStatus,
    }),
  );
}

async function tryConnect(accountStatus: string) {
  const service = makeService(accountStatus);
  return service.authenticateAgent(
    { keyId: "key_1", label: "web", rawSecret: RAW_SECRET, agentVersion: "1.0.0" } as any,
    "127.0.0.1",
  );
}

describe("HubAuthService.authenticateAgent: which account statuses can connect", () => {
  it("ACTIVE connects", async () => {
    const result = await tryConnect("ACTIVE");
    expect(result.accountId).toBe("acct_1");
  });

  it("PAST_DUE connects (the seven-day grace period keeps service running)", async () => {
    const result = await tryConnect("PAST_DUE");
    expect(result.accountId).toBe("acct_1");
  });

  it.each(["SUSPENDED", "RESTRICTED", "CANCELED", "DELETED"])(
    "%s is refused with AUTH_FAILED",
    async (accountStatus) => {
      await expect(tryConnect(accountStatus)).rejects.toMatchObject({
        code: "AUTH_FAILED",
        message: "Account is not active",
      });
    },
  );

  it("the rejection is a real HubAuthError, not a generic throw", async () => {
    await expect(tryConnect("SUSPENDED")).rejects.toBeInstanceOf(HubAuthError);
  });
});
