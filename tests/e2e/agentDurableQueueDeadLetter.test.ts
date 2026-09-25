import { describe, it, expect } from "vitest";
import { DurableQueue } from "../../packages/agent/src/queue/DurableQueue";
import { LIMITS } from "../../packages/protocol/src/constants";

// Audit part2 G1 (shared/audit-2026-09-24-part2.md): the queue's SQL returned
// snake_case columns (max_attempts, next_retry_at) while markFailed and the
// QueueItem type read camelCase, so item.maxAttempts was undefined,
// `newAttempts >= undefined` was always false, and a failing item was never
// dead-lettered: it retried every <=300 s forever.

function forwardMsg(requestId: string): any {
  return {
    v: "1",
    type: "tunnel:forward",
    requestId,
    method: "POST",
    path: "/charge",
    query: "",
    headers: {},
    body: "{}",
  };
}

describe("DurableQueue dead-lettering", () => {
  it("moves an item to dead_letter after maxAttempts failures", () => {
    const q = new DurableQueue(":memory:");
    q.enqueueInbound(forwardMsg("req_1"));
    const [item] = q.drainForReplay();
    const max = LIMITS.QUEUE_MAX_ATTEMPTS_INBOUND;

    for (let i = 0; i < max; i++) q.markFailed(item.id);

    const counts = q.count();
    expect(counts.deadLetter).toBe(1);
    expect(counts.ready + counts.pending).toBe(0);
    q.close();
  });

  it("keeps an item queued (with backoff) until it reaches maxAttempts", () => {
    const q = new DurableQueue(":memory:");
    q.enqueueInbound(forwardMsg("req_2"));
    const [item] = q.drainForReplay();

    for (let i = 0; i < LIMITS.QUEUE_MAX_ATTEMPTS_INBOUND - 1; i++) q.markFailed(item.id);

    const counts = q.count();
    expect(counts.deadLetter).toBe(0);
    expect(counts.pending).toBe(1); // backing off, not ready yet
    q.close();
  });

  it("drainForReplay returns the camelCase fields the QueueItem type promises", () => {
    const q = new DurableQueue(":memory:");
    q.enqueueInbound(forwardMsg("req_3"));

    const [item] = q.drainForReplay();

    expect(item.maxAttempts).toBe(LIMITS.QUEUE_MAX_ATTEMPTS_INBOUND);
    expect(typeof item.nextRetryAt).toBe("number");
    expect(item.attempts).toBe(0);
    q.close();
  });

  it("deadLetterItems uses the same field names", () => {
    const q = new DurableQueue(":memory:");
    q.enqueueInbound(forwardMsg("req_4"));
    const [item] = q.drainForReplay();
    for (let i = 0; i < LIMITS.QUEUE_MAX_ATTEMPTS_INBOUND; i++) q.markFailed(item.id);

    const [dead] = q.deadLetterItems();

    expect(dead.id).toBe(item.id);
    expect(dead.attempts).toBe(LIMITS.QUEUE_MAX_ATTEMPTS_INBOUND);
    expect(typeof dead.nextRetryAt).toBe("number"); // failed_at
    q.close();
  });
});
