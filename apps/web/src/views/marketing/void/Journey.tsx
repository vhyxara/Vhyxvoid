'use client'

// "Follow a request through the void": the stages of one request laid out as
// stops on a route. A packet travels from stop to stop, the active stop's
// story shows below, and on the last stop the response travels home. Plays by
// itself while on screen; clicking a stop (or the arrow keys) takes over.
import type { CSSProperties } from 'react'
import { useCallback, useEffect, useState } from 'react'

import type { LandingContent } from '@vhyxvoid/content'

import { useInView, useReducedMotion } from './hooks'
import styles from './void.module.css'

type Stage = NonNullable<LandingContent['journey']>['stages'][number]

export const STAGE_MS = 3600

/** The glyph of a stop, by its position: caller, edge, hub, tunnel, agent, app. */
function Glyph({ i, n }: { i: number; n: number }) {
  const kind = i === 0 ? 'caller' : i === n - 1 ? 'app' : i === 1 ? 'edge' : i === n - 2 ? 'agent' : i === 2 ? 'hub' : 'tunnel'
  const p = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

  switch (kind) {
    case 'caller':
      return (
        <svg {...p}>
          <circle cx='12' cy='12' r='9' />
          <path d='M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18' />
        </svg>
      )
    case 'edge':
      return (
        <svg {...p}>
          <path d='M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z' />
          <path d='M9 12l2 2 4-4' />
        </svg>
      )
    case 'hub':
      return (
        <svg {...p}>
          <circle cx='12' cy='12' r='3' />
          <circle cx='12' cy='12' r='8' strokeDasharray='3 3' />
          <path d='M12 1v3M12 20v3M1 12h3M20 12h3' />
        </svg>
      )
    case 'tunnel':
      return (
        <svg {...p}>
          <ellipse cx='12' cy='12' rx='9' ry='4' />
          <ellipse cx='12' cy='12' rx='5' ry='2' />
          <circle cx='12' cy='12' r='0.8' fill='currentColor' />
        </svg>
      )
    case 'agent':
      return (
        <svg {...p}>
          <rect x='3' y='5' width='18' height='11' rx='2' />
          <path d='M2 19h20' />
          <path d='M8 10l2 2-2 2M12 14h4' />
        </svg>
      )
    default:
      return (
        <svg {...p}>
          <path d='M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16' />
        </svg>
      )
  }
}

export function Journey({ title, subtitle, stages }: { title: string; subtitle: string; stages: Stage[] }) {
  const reduced = useReducedMotion()
  const [ref, inView] = useInView<HTMLDivElement>('-15% 0px')
  const [active, setActive] = useState(0)
  const [auto, setAuto] = useState(true)
  const n = stages.length
  const last = active === n - 1

  // With reduced motion nothing plays until the visitor presses play.
  useEffect(() => {
    if (reduced) setAuto(false)
  }, [reduced])

  useEffect(() => {
    if (!auto || !inView) return
    const t = setTimeout(() => setActive(a => (a + 1) % n), last ? STAGE_MS * 1.4 : STAGE_MS)

    return () => clearTimeout(t)
  }, [active, auto, inView, n, last])

  const pick = useCallback((i: number) => {
    setAuto(false)
    setActive(((i % n) + n) % n)
  }, [n])

  const pos = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 0)
  const stage = stages[active]

  return (
    <div ref={ref} className={styles.journey} data-reveal>
      <div className={styles.sectionHead}>
        <span className={styles.kicker}>The journey</span>
        <h2 className={styles.h2}>{title}</h2>
        {subtitle && <p className={styles.lead}>{subtitle}</p>}
      </div>

      <div
        className={styles.route}
        style={{ '--progress': `${pos(active)}%`, '--n': n } as CSSProperties}
        data-last={last || undefined}
        data-auto={auto ? 'true' : undefined}
        role='group'
        aria-label='Stops of a request'
        onKeyDown={e => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') (e.preventDefault(), pick(active + 1))
          if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') (e.preventDefault(), pick(active - 1))
        }}
      >
        <div className={styles.track} aria-hidden>
          <span className={styles.trackFill} />
          <span className={styles.trackStream} />
          <span className={styles.packet}>
            <span className={styles.packetLabel}>{last ? '200 OK' : 'POST'}</span>
          </span>
          {last && <span className={styles.packetBack} key={`res-${active}`} />}
        </div>
        <ol className={styles.stops}>
          {stages.map((s, i) => (
            <li key={i} style={{ '--k': i } as CSSProperties}>
              <button
                type='button'
                className={styles.stop}
                data-state={i === active ? 'active' : i < active ? 'done' : undefined}
                aria-current={i === active ? 'step' : undefined}
                aria-label={`${i + 1}. ${s.node}: ${s.title}`}
                tabIndex={i === active ? 0 : -1}
                onClick={() => pick(i)}
              >
                <span className={styles.stopOrb}>
                  <Glyph i={i} n={n} />
                </span>
                <span className={styles.stopName}>{s.node}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className={styles.story} aria-live={auto ? 'off' : 'polite'}>
        <div className={styles.storyCount}>
          {String(active + 1).padStart(2, '0')} <span>/ {String(n).padStart(2, '0')}</span>
        </div>
        <div key={active} className={styles.storyText}>
          <h3>{stage.title}</h3>
          <p>{stage.body}</p>
        </div>
        <div className={styles.storyNav}>
          <button type='button' onClick={() => pick(active - 1)} aria-label='Previous stop'>
            ←
          </button>
          <button type='button' onClick={() => setAuto(a => !a)} aria-label={auto ? 'Pause' : 'Play'}>
            {auto ? '❚❚' : '▶'}
          </button>
          <button type='button' onClick={() => pick(active + 1)} aria-label='Next stop'>
            →
          </button>
        </div>
        {auto && <span className={styles.storyTimer} key={`t-${active}`} style={{ '--ms': `${last ? STAGE_MS * 1.4 : STAGE_MS}ms` } as CSSProperties} aria-hidden />}
      </div>
    </div>
  )
}
