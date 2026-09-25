// ─────────────────────────────────────────────────────────────────────────────
// apps/hub/src/utils/releaseSubdomain.ts
//
// An eviction (heartbeat or account/key sweep) removes the session from the
// AgentRegistry before closing its socket, so Message.router's onAgentClose
// finds no session and never unregisters the agent's
// tunnel:sub:<slug>--<label> entry. Evictions call this instead. It is a
// compare-and-delete on agentId (SubdomainRegistry.unregister), so a fresh
// reconnect that already re-registered the label is left alone.
// Fire-and-forget: an eviction never waits on Redis/Postgres.
// ─────────────────────────────────────────────────────────────────────────────

import type { AgentSession } from '@/registry/Agent.registry';

export interface SubdomainReleaseDeps {
  findAccountSlug(accountId: string): Promise<string | null>;
  unregister(label: string, accountSlug: string, expectedAgentId: string): Promise<void>;
}

export function releaseSubdomain(
  deps: SubdomainReleaseDeps | undefined,
  session: Pick<AgentSession, 'accountId' | 'label' | 'agentId'>,
): Promise<void> {
  if (!deps) return Promise.resolve();
  return Promise.resolve()
    .then(() => deps.findAccountSlug(session.accountId))
    .then((slug) => (slug ? deps.unregister(session.label, slug, session.agentId) : undefined))
    .catch((err: unknown) => {
      console.error(
        { err: err instanceof Error ? err.message : String(err), agentId: session.agentId },
        '[hub] failed to release subdomain after eviction',
      );
    });
}
