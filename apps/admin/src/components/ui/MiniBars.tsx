import { Text } from '@vhyxui/react'

/** A small accessible bar chart for daily series (no chart library needed). */
export function MiniBars({ data, label, format = (n: number) => n.toLocaleString() }: { data: Array<{ day: string; value: number }>; label: string; format?: (n: number) => string }) {
  const max = Math.max(1, ...data.map(d => d.value))
  const total = data.reduce((a, d) => a + d.value, 0)

  if (data.length === 0) {
    return (
      <Text size='sm' tone='muted'>
        No data in this period.
      </Text>
    )
  }

  return (
    <figure style={{ margin: 0 }}>
      <div role='img' aria-label={`${label}: ${format(total)} over ${data.length} days`} className='flex items-end gap-[2px]' style={{ blockSize: 96 }}>
        {data.map(d => (
          <div
            key={d.day}
            title={`${d.day}: ${format(d.value)}`}
            style={{
              flex: 1,
              minInlineSize: 2,
              blockSize: `${Math.max(2, (d.value / max) * 100)}%`,
              background: 'var(--vhyx-color-accent, #6d28d9)',
              borderRadius: 2,
              opacity: 0.85
            }}
          />
        ))}
      </div>
      <figcaption className='flex justify-between mbs-1'>
        <Text size='xs' tone='muted'>
          {data[0].day}
        </Text>
        <Text size='xs' tone='muted'>
          {data[data.length - 1].day}
        </Text>
      </figcaption>
    </figure>
  )
}
