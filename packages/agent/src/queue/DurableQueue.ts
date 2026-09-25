// packages/agent/src/queue/DurableQueue.ts
// SQLite-backed durable queue. Single source of truth for all pending messages.
// WAL mode: survives process crashes without corruption.
// Never shares storage with batching — batcher is in-memory only.

import type BetterSqlite3 from "better-sqlite3";
import { randomUUID } from "crypto";
import {
  TunnelForwardMsg,
  TunnelResponseMsg,
  TunnelAgentErrorMsg,
} from "@vhyxvoid/protocol";
import { LIMITS } from "@vhyxvoid/protocol";

export type QueueDirection = "inbound" | "outbound";

export interface QueueItem {
  id: string;
  direction: QueueDirection;
  payload: string; // JSON
  ts: number;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: number; // unix ms — exponential backoff
}

export type InboundPayload = TunnelForwardMsg;
export type OutboundPayload = TunnelResponseMsg | TunnelAgentErrorMsg;

// Columns are snake_case; QueueItem is camelCase. Every SELECT that returns
// a QueueItem must alias, or maxAttempts/nextRetryAt come back undefined (which
// silently disabled dead-lettering: audit part2 G1).
const ITEM_COLUMNS =
  "id, direction, payload, ts, attempts, max_attempts AS maxAttempts, next_retry_at AS nextRetryAt";

export class DurableQueue {
  private readonly db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    // Loaded here, not at module top, on purpose. better-sqlite3 is a native
    // module, and every bundle that inlines this file (packages/next,
    // packages/middleware) marks it external. A top-level import would make
    // merely loading those bundles require it even though in-process use
    // (AgentConfig.disableQueue) never constructs a DurableQueue. Deferring the
    // require means only code that really opens a queue needs the native
    // module installed. See context.md risk #15/#17 and decision.md,
    // 2026-09-19, "better-sqlite3 undeclared dependency".
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL"); // crash-safe: writes go to WAL file first
    this.db.pragma("synchronous = NORMAL"); // balanced: fsync on WAL checkpoint only
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000"); // wait up to 5s on lock contention
    this.migrate();
    // Older agents wrote outbound responses (full response bodies) here while
    // offline. They are never persisted any more (audit part2 G3); delete any
    // left behind so they don't stay on disk.
    this.db.exec(
      "DELETE FROM queue WHERE direction = 'outbound'; DELETE FROM dead_letter WHERE direction = 'outbound';",
    );
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queue (
        id           TEXT    PRIMARY KEY,
        direction    TEXT    NOT NULL CHECK(direction IN ('inbound', 'outbound')),
        payload      TEXT    NOT NULL,
        ts           INTEGER NOT NULL,
        attempts     INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        next_retry_at INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_queue_direction_retry
        ON queue(direction, next_retry_at);

      CREATE INDEX IF NOT EXISTS idx_queue_ts
        ON queue(ts);

      -- Dead letter: items that exceeded max_attempts
      CREATE TABLE IF NOT EXISTS dead_letter (
        id           TEXT    PRIMARY KEY,
        direction    TEXT    NOT NULL,
        payload      TEXT    NOT NULL,
        ts           INTEGER NOT NULL,
        attempts     INTEGER NOT NULL,
        failed_at    INTEGER NOT NULL
      );
    `);
  }

  enqueueInbound(payload: InboundPayload): void {
    this.db
      .prepare(
        `
      INSERT INTO queue (id, direction, payload, ts, attempts, max_attempts, next_retry_at)
      VALUES (?, 'inbound', ?, ?, 0, ?, 0)
    `,
      )
      .run(
        randomUUID(),
        JSON.stringify(payload),
        Date.now(),
        LIMITS.QUEUE_MAX_ATTEMPTS_INBOUND,
      );
  }

  /**
   * Returns all items ready for replay, ordered:
   * 1. OUTBOUND first (send cached responses before processing new requests)
   * 2. Within same direction: oldest first (preserve request ordering)
   */
  drainForReplay(): QueueItem[] {
    return this.db
      .prepare(
        `
      SELECT ${ITEM_COLUMNS}
      FROM queue
      WHERE next_retry_at <= ?
      ORDER BY
        CASE direction WHEN 'outbound' THEN 0 ELSE 1 END ASC,
        ts ASC
    `,
      )
      .all(Date.now()) as QueueItem[];
  }

  markSuccess(id: string): void {
    this.db.prepare("DELETE FROM queue WHERE id = ?").run(id);
  }

  markFailed(id: string): void {
    const item = this.db
      .prepare(`SELECT ${ITEM_COLUMNS} FROM queue WHERE id = ?`)
      .get(id) as QueueItem | null;
    if (!item) return;

    const newAttempts = item.attempts + 1;

    if (newAttempts >= item.maxAttempts) {
      // Move to dead letter table
      this.db.transaction(() => {
        this.db
          .prepare(
            `
          INSERT INTO dead_letter (id, direction, payload, ts, attempts, failed_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            item.id,
            item.direction,
            item.payload,
            item.ts,
            newAttempts,
            Date.now(),
          );
        this.db.prepare("DELETE FROM queue WHERE id = ?").run(id);
      })();
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s … capped at 5 min
    const backoffMs = Math.min(1000 * Math.pow(2, newAttempts - 1), 300_000);
    this.db
      .prepare(
        `
      UPDATE queue SET attempts = ?, next_retry_at = ? WHERE id = ?
    `,
      )
      .run(newAttempts, Date.now() + backoffMs, id);
  }

  count(): { ready: number; pending: number; deadLetter: number } {
    const now = Date.now();
    const ready = (
      this.db
        .prepare("SELECT COUNT(*) as n FROM queue WHERE next_retry_at <= ?")
        .get(now) as any
    ).n;
    const pending = (
      this.db
        .prepare("SELECT COUNT(*) as n FROM queue WHERE next_retry_at > ?")
        .get(now) as any
    ).n;
    const deadLetter = (
      this.db.prepare("SELECT COUNT(*) as n FROM dead_letter").get() as any
    ).n;
    return { ready, pending, deadLetter };
  }

  /** Drain dead letter for inspection. Returns last N items. */
  deadLetterItems(limit = 50): QueueItem[] {
    return this.db
      .prepare(
        `
      SELECT id, direction, payload, ts, attempts, 0 AS maxAttempts, failed_at AS nextRetryAt
      FROM dead_letter ORDER BY failed_at DESC LIMIT ?
    `,
      )
      .all(limit) as QueueItem[];
  }

  close(): void {
    this.db.close();
  }
}
