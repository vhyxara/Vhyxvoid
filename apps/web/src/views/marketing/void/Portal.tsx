// The hero's wormhole: rings of the void turning around a dark core, API
// calls spiralling into it, and pulses arriving at localhost underneath.
// Pure CSS animation (void.module.css); decorative, so hidden from screen readers.
import type { CSSProperties, Ref } from 'react'

import styles from './void.module.css'

export type PortalCall = { method: string; path: string; tone: 'violet' | 'cyan' | 'pink' | 'blue' }

const CALLS: PortalCall[] = [
  { method: 'POST', path: '/webhooks/stripe', tone: 'violet' },
  { method: 'GET', path: '/api/users', tone: 'cyan' },
  { method: 'WS', path: '/live', tone: 'pink' },
  { method: 'PUT', path: '/orders/42', tone: 'blue' },
  { method: 'GET', path: '/health', tone: 'cyan' },
  { method: 'POST', path: '/graphql', tone: 'violet' }
]

/** `calls`: the requests in orbit (six read best); `local`: where they land. */
export function Portal({ coreRef, local = 'localhost:3000', calls = CALLS }: { coreRef?: Ref<HTMLDivElement>; local?: string; calls?: PortalCall[] }) {
  return (
    <div className={styles.portal} aria-hidden>
      <div className={styles.portalPlane}>
        {[0, 1, 2, 3, 4].map(i => (
          <span key={i} className={styles.ring} style={{ '--i': i } as CSSProperties} />
        ))}
        <span className={styles.disk} />
        {calls.map((c, i) => (
          <span key={i} className={styles.orbit} style={{ '--d': `${(i * -9) / calls.length}s`, '--a': `${(i * 360) / calls.length}deg` } as CSSProperties}>
            <span className={styles.orbitR}>
              <span className={styles.chip} data-tone={c.tone}>
                <b>{c.method}</b> {c.path}
              </span>
            </span>
          </span>
        ))}
      </div>
      <div ref={coreRef} className={styles.core}>
        <span className={styles.coreGlow} />
      </div>
      <div className={styles.beam}>
        {[0, 1, 2].map(i => (
          <span key={i} className={styles.pulse} style={{ '--d': `${i * 0.9}s` } as CSSProperties} />
        ))}
      </div>
      <div className={styles.local}>
        <span className={styles.localDot} />
        {local}
      </div>
    </div>
  )
}
