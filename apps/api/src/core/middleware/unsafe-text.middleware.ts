// Rejects text the database can't store, with a 400 instead of a 500 from
// Postgres: NUL characters (refused in text and jsonb) and lone UTF-16
// surrogates (refused in jsonb, mangled in text). Checks route params, the
// query and JSON bodies, iteratively so deep nesting can't overflow the stack.
import type { FastifyReply, FastifyRequest } from "fastify";

import { ValidationError } from "@/core/errors/error.format";

// eslint-disable-next-line no-control-regex
const UNSAFE = /\u0000|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** The first place a value holds unsafe text ("body.endpoints.0.name"), or null. */
export function unsafeTextAt(value: unknown, root: string): string | null {
  const stack: Array<[unknown, string]> = [[value, root]];
  while (stack.length) {
    const [v, at] = stack.pop()!;
    if (typeof v === "string") {
      if (UNSAFE.test(v)) return at;
    } else if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) stack.push([v[i], `${at}.${i}`]);
    } else if (v && typeof v === "object" && !Buffer.isBuffer(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (UNSAFE.test(k)) return `${at} (a key)`;
        stack.push([x, `${at}.${k}`]);
      }
    }
  }
  return null;
}

export async function rejectUnsafeText(request: FastifyRequest, _reply: FastifyReply) {
  const at = unsafeTextAt(request.params, "params") ?? unsafeTextAt(request.query, "query") ?? unsafeTextAt(request.body, "body");
  if (at) throw new ValidationError(`${at} contains a character that can't be stored (NUL or an unpaired surrogate)`);
}
