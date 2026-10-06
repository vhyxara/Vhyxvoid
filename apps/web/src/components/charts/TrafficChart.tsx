'use client'

// Stacked column chart of tunnel traffic per time bucket: successful, 4xx and
// 5xx requests. Plain SVG (no chart library), one y-axis, hover/focus tooltip
// with every series, arrow keys move between buckets, and a table view so no
// value depends on hovering or on color.

import { useEffect, useId, useMemo, useRef, useState } from 'react'

import type { TrafficPoint } from '@/api/infrastructure/services/traffic.service'
import { TRAFFIC_SERIES, bucketLabel, compactNumber, formatMs, niceTicks, stackOf, xTickIndices } from './trafficChartModel'

const HEIGHT = 200
const M = { top: 8, right: 8, bottom: 24, left: 40 }
const muted = 'var(--vhyx-color-text-muted)'

type Props = {
  series: TrafficPoint[]
  bucketMinutes: number
  /** Accessible name, e.g. "Requests per 15 minutes, last 24 hours". */
  label: string
  /** Dim while a new range loads (keeps the frame instead of a skeleton). */
  stale?: boolean
}

export function TrafficChart({ series, bucketMinutes, label, stale }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [active, setActive] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const tipId = useId()

  useEffect(() => {
    const el = wrap.current

    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.floor(e.contentRect.width))))

    ro.observe(el)

    return () => ro.disconnect()
  }, [])

  const max = useMemo(() => Math.max(0, ...series.map(p => p.requests)), [series])
  const { top, ticks } = niceTicks(max)
  const plotW = width - M.left - M.right
  const plotH = HEIGHT - M.top - M.bottom
  const band = series.length ? plotW / series.length : plotW
  const barW = Math.max(1, band - (band > 4 ? 2 : 1))
  const y = (v: number) => M.top + plotH - (v / top) * plotH
  const xTicks = xTickIndices(series.length, width < 480 ? 3 : 5)
  const total = series.reduce((a, p) => a + p.requests, 0)
  const point = active !== null ? series[active] : null

  function onKey(e: React.KeyboardEvent) {
    if (!series.length) return
    const last = series.length - 1

    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setActive(cur => {
        const c = cur ?? last

        if (e.key === 'Home') return 0
        if (e.key === 'End') return last

        return Math.min(last, Math.max(0, c + (e.key === 'ArrowRight' ? 1 : -1)))
      })
    } else if (e.key === 'Escape') setActive(null)
  }

  // Tooltip placement: beside the hovered column, flipped near the right edge.
  const tipX = active !== null ? M.left + band * active + band / 2 : 0
  const tipLeft = tipX > width - 180

  return (
    <figure style={{ margin: 0 }}>
      <div ref={wrap} style={{ position: 'relative', opacity: stale ? 0.55 : 1, transition: 'opacity 150ms' }}>
        <svg
          width={width}
          height={HEIGHT}
          role='img'
          aria-label={`${label}. ${total.toLocaleString()} requests in total. Use arrow keys to read each bar.`}
          aria-describedby={point ? tipId : undefined}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
          style={{ display: 'block', outlineOffset: 2, touchAction: 'pan-y' }}
        >
          {/* Recessive grid and y labels */}
          {ticks.map(t => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke='var(--vhyx-color-border)' strokeWidth={1} strokeDasharray='2 4' />
              <text x={M.left - 6} y={y(t)} dy='0.32em' textAnchor='end' fontSize={11} fill={muted}>
                {compactNumber(t)}
              </text>
            </g>
          ))}
          <line x1={M.left} x2={width - M.right} y1={y(0)} y2={y(0)} stroke='var(--vhyx-color-border-strong, var(--vhyx-color-border))' strokeWidth={1} />

          {/* Columns: segments bottom-up with a 1px surface gap between fills */}
          {series.map((p, i) => {
            const x = M.left + band * i + (band - barW) / 2
            const parts = stackOf(p)
            let base = 0

            return (
              <g key={p.t} opacity={active === null || active === i ? 1 : 0.45}>
                {TRAFFIC_SERIES.map(s => {
                  const v = parts[s.key]

                  if (v <= 0) return null
                  const y0 = y(base)
                  const y1 = y(base + v)

                  base += v
                  const h = Math.max(1, y0 - y1 - (base < p.requests ? 1 : 0))

                  return <rect key={s.key} x={x} y={y0 - h} width={barW} height={h} fill={s.color} rx={Math.min(2, barW / 2)} />
                })}
              </g>
            )
          })}

          {/* Hit targets: the whole column band, taller than any bar */}
          {series.map((p, i) => (
            <rect
              key={`hit-${p.t}`}
              x={M.left + band * i}
              y={M.top}
              width={band}
              height={plotH}
              fill='transparent'
              onPointerEnter={() => setActive(i)}
              onPointerDown={() => setActive(i)}
            />
          ))}

          {xTicks.map(i => (
            <text
              key={`x-${i}`}
              x={M.left + band * i + band / 2}
              y={HEIGHT - 6}
              textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}
              fontSize={11}
              fill={muted}
            >
              {bucketLabel(series[i].t, bucketMinutes)}
            </text>
          ))}
        </svg>

        {point && (
          <div
            id={tipId}
            role='status'
            style={{
              position: 'absolute',
              top: M.top,
              left: tipLeft ? undefined : tipX + 12,
              right: tipLeft ? width - tipX + 12 : undefined,
              minWidth: 150,
              pointerEvents: 'none',
              padding: '8px 10px',
              borderRadius: 8,
              background: 'var(--vhyx-color-surface-overlay, var(--vhyx-color-surface))',
              border: '1px solid var(--vhyx-color-border)',
              boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
              fontSize: 12,
              color: 'var(--vhyx-color-text)'
            }}
          >
            <div style={{ color: muted, marginBottom: 4 }}>{bucketLabel(point.t, bucketMinutes, true)}</div>
            <TipRow value={point.requests.toLocaleString()} name='requests' />
            {[...TRAFFIC_SERIES].reverse().map(s => (
              <TipRow key={s.key} color={s.color} value={stackOf(point)[s.key].toLocaleString()} name={s.label} />
            ))}
            <TipRow value={formatMs(point.avgMs)} name='average time' />
          </div>
        )}
      </div>

      <figcaption className='flex flex-wrap items-center gap-4 mbs-2' style={{ fontSize: 12, color: muted }}>
        {TRAFFIC_SERIES.map(s => (
          <span key={s.key} className='flex items-center gap-1'>
            <span aria-hidden style={{ inlineSize: 10, blockSize: 10, borderRadius: 2, background: s.color, display: 'inline-block' }} />
            {s.label}
          </span>
        ))}
        <button
          type='button'
          onClick={() => setTable(t => !t)}
          aria-expanded={table}
          style={{ marginInlineStart: 'auto', background: 'none', border: 0, padding: 0, color: 'var(--vhyx-color-accent)', cursor: 'pointer', fontSize: 12 }}
        >
          {table ? 'Hide table' : 'Show as table'}
        </button>
      </figcaption>

      {table && (
        <div style={{ maxBlockSize: 280, overflow: 'auto', marginBlockStart: 8 }}>
          <table style={{ inlineSize: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <caption className='sr-only'>{label}</caption>
            <thead>
              <tr style={{ textAlign: 'end', color: muted }}>
                <th style={{ textAlign: 'start', padding: 4 }}>Time</th>
                <th style={{ padding: 4 }}>Requests</th>
                <th style={{ padding: 4 }}>4xx</th>
                <th style={{ padding: 4 }}>5xx</th>
                <th style={{ padding: 4 }}>Avg time</th>
              </tr>
            </thead>
            <tbody>
              {series
                .filter(p => p.requests > 0)
                .reverse()
                .map(p => (
                  <tr key={p.t} style={{ textAlign: 'end', borderTop: '1px solid var(--vhyx-color-border)' }}>
                    <td style={{ textAlign: 'start', padding: 4 }}>{bucketLabel(p.t, bucketMinutes, true)}</td>
                    <td style={{ padding: 4 }}>{p.requests.toLocaleString()}</td>
                    <td style={{ padding: 4 }}>{p.errors4xx.toLocaleString()}</td>
                    <td style={{ padding: 4 }}>{p.errors5xx.toLocaleString()}</td>
                    <td style={{ padding: 4 }}>{formatMs(p.avgMs)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {total === 0 && <p style={{ color: muted, fontSize: 12 }}>No requests in this period.</p>}
        </div>
      )}
    </figure>
  )
}

function TipRow({ value, name, color }: { value: string; name: string; color?: string }) {
  return (
    <div className='flex items-center gap-2' style={{ lineHeight: 1.6 }}>
      {color ? <span aria-hidden style={{ inlineSize: 10, blockSize: 2, background: color, display: 'inline-block' }} /> : <span style={{ inlineSize: 10 }} />}
      <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</strong>
      <span style={{ color: muted }}>{name}</span>
    </div>
  )
}
