'use client'

// Line chart for time series (latency percentiles, requests per second,
// check durations). Plain SVG like TrafficChart: one y-axis, 2px lines,
// gaps where a value is missing, a crosshair + tooltip with every series on
// hover or focus, arrow keys move between points, a legend (always, for two
// or more series) and a table view so nothing depends on hovering or color.

import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { niceTicks, xTickIndices } from './trafficChartModel'

const M = { top: 10, right: 12, bottom: 24, left: 48 }
const muted = 'var(--vhyx-color-text-muted)'

/** Validated for the dark surface (dataviz validator: all checks pass). Fixed order, never cycled. */
export const LINE_COLORS = ['var(--vv-chart-1, #3987e5)', 'var(--vv-chart-2, #d95926)', 'var(--vv-chart-3, #199e70)'] as const

export type LineSeries = { key: string; label: string; color: string; values: Array<number | null>; dashed?: boolean }

type Props = {
  series: LineSeries[]
  /** One label per point (x axis and tooltip). */
  xLabels: string[]
  /** Accessible name, e.g. "Latency per second". */
  label: string
  format?: (v: number) => string
  height?: number
  /** Marks per point, e.g. failed checks: drawn as a small ring under the line. */
  markers?: Array<{ index: number; color: string; title: string }>
  stale?: boolean
}

export function LineChart({ series, xLabels, label, format = v => String(v), height = 220, markers = [], stale }: Props) {
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

  const n = xLabels.length
  const max = useMemo(() => Math.max(0, ...series.flatMap(s => s.values.filter((v): v is number => v !== null))), [series])
  const { top, ticks } = niceTicks(max)
  const plotW = width - M.left - M.right
  const plotH = height - M.top - M.bottom
  const x = (i: number) => M.left + (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1))
  const y = (v: number) => M.top + plotH - (v / top) * plotH
  const xTicks = xTickIndices(n, width < 480 ? 3 : 5)

  const paths = series.map(s => {
    let d = ''
    let open = false

    s.values.forEach((v, i) => {
      if (v === null) {
        open = false

        return
      }

      d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
      open = true
    })

    return d
  })

  // Points with no neighbour on either side would be invisible as a line.
  const lonely = series.map(s => s.values.map((v, i) => v !== null && (s.values[i - 1] ?? null) === null && (s.values[i + 1] ?? null) === null))

  function onKey(e: React.KeyboardEvent) {
    if (!n) return

    if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) {
      e.preventDefault()
      setActive(cur => {
        const c = cur ?? n - 1

        if (e.key === 'Home') return 0
        if (e.key === 'End') return n - 1

        return Math.min(n - 1, Math.max(0, c + (e.key === 'ArrowRight' ? 1 : -1)))
      })
    } else if (e.key === 'Escape') setActive(null)
  }

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left

    if (n <= 1) return setActive(0)
    setActive(Math.min(n - 1, Math.max(0, Math.round(((px - M.left) / plotW) * (n - 1)))))
  }

  const tipX = active !== null ? x(active) : 0
  const tipLeft = tipX > width - 190

  return (
    <figure style={{ margin: 0 }}>
      <div ref={wrap} style={{ position: 'relative', opacity: stale ? 0.55 : 1, transition: 'opacity 150ms' }}>
        <svg
          width={width}
          height={height}
          role='img'
          aria-label={`${label}. ${n} points. Use arrow keys to read each point.`}
          aria-describedby={active !== null ? tipId : undefined}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          onPointerMove={onMove}
          onPointerLeave={() => setActive(null)}
          style={{ display: 'block', outlineOffset: 2, touchAction: 'pan-y' }}
        >
          {ticks.map(t => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke='var(--vhyx-color-border)' strokeWidth={1} strokeDasharray='2 4' />
              <text x={M.left - 6} y={y(t)} dy='0.32em' textAnchor='end' fontSize={11} fill={muted}>
                {format(t)}
              </text>
            </g>
          ))}
          <line x1={M.left} x2={width - M.right} y1={y(0)} y2={y(0)} stroke='var(--vhyx-color-border-strong, var(--vhyx-color-border))' strokeWidth={1} />

          {markers.map(m => (
            <circle key={`m-${m.index}`} cx={x(m.index)} cy={y(0) - 5} r={4} fill={m.color}>
              <title>{m.title}</title>
            </circle>
          ))}

          {active !== null && <line x1={tipX} x2={tipX} y1={M.top} y2={y(0)} stroke={muted} strokeWidth={1} />}

          {series.map((s, si) => (
            <g key={s.key}>
              <path d={paths[si]} fill='none' stroke={s.color} strokeWidth={2} strokeLinejoin='round' strokeLinecap='round' strokeDasharray={s.dashed ? '5 4' : undefined} />
              {s.values.map((v, i) =>
                v !== null && (lonely[si][i] || active === i) ? <circle key={i} cx={x(i)} cy={y(v)} r={active === i ? 4.5 : 3} fill={s.color} stroke='var(--vhyx-color-surface, #111114)' strokeWidth={2} /> : null
              )}
            </g>
          ))}

          {xTicks.map(i => (
            <text key={`x-${i}`} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize={11} fill={muted}>
              {xLabels[i]}
            </text>
          ))}
        </svg>

        {active !== null && (
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
            <div style={{ color: muted, marginBottom: 4 }}>{xLabels[active]}</div>
            {series.map(s => (
              <div key={s.key} className='flex items-center gap-2' style={{ lineHeight: 1.6 }}>
                <span aria-hidden style={{ inlineSize: 10, blockSize: 2, background: s.color, display: 'inline-block' }} />
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{s.values[active] === null ? '—' : format(s.values[active] as number)}</strong>
                <span style={{ color: muted }}>{s.label}</span>
              </div>
            ))}
            {markers.filter(m => m.index === active).map(m => (
              <div key='marker' style={{ color: muted, marginTop: 2 }}>
                {m.title}
              </div>
            ))}
          </div>
        )}
      </div>

      <figcaption className='flex flex-wrap items-center gap-4 mbs-2' style={{ fontSize: 12, color: muted }}>
        {series.length > 1 &&
          series.map(s => (
            <span key={s.key} className='flex items-center gap-1'>
              <span aria-hidden style={{ inlineSize: 14, blockSize: 2, background: s.color, display: 'inline-block' }} />
              {s.label}
            </span>
          ))}
        <button type='button' onClick={() => setTable(t => !t)} aria-expanded={table} style={{ marginInlineStart: 'auto', background: 'none', border: 0, padding: 0, color: 'var(--vhyx-color-accent)', cursor: 'pointer', fontSize: 12 }}>
          {table ? 'Hide table' : 'Show as table'}
        </button>
      </figcaption>

      {table && (
        <div style={{ maxBlockSize: 280, overflow: 'auto', marginBlockStart: 8 }}>
          <table style={{ inlineSize: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <caption className='sr-only'>{label}</caption>
            <thead>
              <tr style={{ textAlign: 'end', color: muted }}>
                <th style={{ textAlign: 'start', padding: 4 }}>Point</th>
                {series.map(s => (
                  <th key={s.key} style={{ padding: 4 }}>
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {xLabels.map((l, i) => (
                <tr key={i} style={{ textAlign: 'end', borderTop: '1px solid var(--vhyx-color-border)' }}>
                  <td style={{ textAlign: 'start', padding: 4 }}>{l}</td>
                  {series.map(s => (
                    <td key={s.key} style={{ padding: 4 }}>
                      {s.values[i] === null ? '—' : format(s.values[i] as number)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  )
}

/** A tiny trend line for tables (decorative; the number beside it carries the value). */
export function Sparkline({ values, width = 80, height = 20, color = 'var(--vv-chart-1, #3987e5)' }: { values: number[]; width?: number; height?: number; color?: string }) {
  const max = Math.max(1, ...values)
  const step = values.length > 1 ? width / (values.length - 1) : width
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`).join('')

  return (
    <svg width={width} height={height} aria-hidden style={{ display: 'block' }}>
      <path d={d} fill='none' stroke={color} strokeWidth={1.5} strokeLinejoin='round' />
    </svg>
  )
}
