// DNS for custom-domain checks. Real DNS (short timeouts) in production; in
// development and the e2e journey, DNS_TEST_RECORDS (a JSON table, see
// staticDnsResolver) can stand in so verification can be exercised without
// owning a domain. The override is ignored when NODE_ENV=production.
import { readFileSync } from "node:fs";
import { Resolver } from "node:dns/promises";
import { staticDnsResolver, type DnsResolverLike } from "@vhyxvoid/shared";

export function buildDnsResolver(env: Record<string, string | undefined> = process.env): DnsResolverLike {
  // DNS_TEST_RECORDS_FILE: the same table in a file, read on every lookup,
  // so a test can add a record after it learns the verification token.
  if (env.NODE_ENV !== "production" && env.DNS_TEST_RECORDS_FILE) {
    const file = env.DNS_TEST_RECORDS_FILE;
    const current = () => {
      try {
        return staticDnsResolver(JSON.parse(readFileSync(file, "utf8")));
      } catch {
        return staticDnsResolver({});
      }
    };
    return {
      resolveTxt: (n) => current().resolveTxt(n),
      resolveCname: (n) => current().resolveCname(n),
      resolve4: (n) => current().resolve4(n),
      resolve6: (n) => current().resolve6(n),
    };
  }
  if (env.NODE_ENV !== "production" && env.DNS_TEST_RECORDS) {
    try {
      return staticDnsResolver(JSON.parse(env.DNS_TEST_RECORDS));
    } catch {
      console.warn("[domains] DNS_TEST_RECORDS is not valid JSON; using real DNS");
    }
  }
  const r = new Resolver({ timeout: 3_000, tries: 2 });
  if (env.DNS_SERVERS) r.setServers(env.DNS_SERVERS.split(",").map((s) => s.trim()).filter(Boolean));
  return r;
}
