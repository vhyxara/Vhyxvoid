// Usage endpoints aggregate with date_trunc over the requested window, so an
// unbounded `from`/`to` is an expensive query per request (audit M21). The
// dashboard's largest preset is 90 days.
import { ValidationError } from "@/core/errors/error.format";

export const MAX_USAGE_WINDOW_DAYS = 93;

export function assertUsageWindow(from: Date, to: Date): void {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new ValidationError("`from` and `to` must be ISO 8601 dates");
  }
  if (from > to) throw new ValidationError("`from` must be before `to`");
  if (to.getTime() - from.getTime() > MAX_USAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
    throw new ValidationError(`The range can be at most ${MAX_USAGE_WINDOW_DAYS} days`);
  }
}
