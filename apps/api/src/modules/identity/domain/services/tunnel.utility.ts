// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function rangeToWindow(range: string): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date(end);

  switch (range) {
    case "24h":
      start.setHours(start.getHours() - 24);
      break;
    case "7d":
      start.setDate(start.getDate() - 7);
      break;
    case "30d":
      start.setDate(start.getDate() - 30);
      break;
    case "90d":
      start.setDate(start.getDate() - 90);
      break;
    default:
      start.setDate(start.getDate() - 30);
  }

  return { start, end };
}

/**
 * Bucket aggregates into chart-friendly time series.
 * Groups by day for 7d/30d/90d, by hour for 24h.
 * Fills gaps with 0 so the chart has a complete x-axis.
 */
export function buildTimeSeries(
  aggregates: { periodStart: Date; quantity: bigint | number }[],
  start: Date,
  end: Date,
  range: string,
): { timestamp: string; value: number }[] {
  const bucketMs = range === "24h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const bucketCount = Math.ceil((end.getTime() - start.getTime()) / bucketMs);

  // Build map: bucket index → total
  const bucketMap = new Map<number, number>();
  for (const agg of aggregates) {
    const bucketIdx = Math.floor(
      (agg.periodStart.getTime() - start.getTime()) / bucketMs,
    );
    if (bucketIdx >= 0 && bucketIdx < bucketCount) {
      bucketMap.set(
        bucketIdx,
        (bucketMap.get(bucketIdx) ?? 0) + Number(agg.quantity),
      );
    }
  }

  // Build complete series with gaps filled
  const series: { timestamp: string; value: number }[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const ts = new Date(start.getTime() + i * bucketMs);
    series.push({
      timestamp: ts.toISOString(),
      value: bucketMap.get(i) ?? 0,
    });
  }

  return series;
}
