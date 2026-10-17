'use client'

// The landing page: VhyxVoid as a void that API calls travel through. A
// starfield and a wormhole in the hero (with customer logos, when there are
// any), then the trip of one request told stop by stop, then features, the
// launch sequence, the showcase (video, screenshots), use cases, testimonials,
// FAQ and a last call to action. Every word comes from Website content → Landing page; the
// animations are decorative, pause off screen, and respect reduced motion.
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { useRef, useState } from 'react'

import Link from 'next/link'

import { VhyxChart } from '@vhyxchart/react'
import { defaultEntry, type LandingContent } from '@vhyxvoid/content'

import { featureIcon } from './icons'
import { CountUp, useInView, useReducedMotion, useReveal } from './void/hooks'
import { Journey } from './void/Journey'
import { LogoStrip, Showcase, Testimonials } from './void/LandingExtras'
import { Portal } from './void/Portal'
import { Starfield } from './void/Starfield'
import styles from './void/void.module.css'

/** Highlights the last two words of the title with the brand gradient. */
function HeroTitle({ text }: { text: string }) {
  const words = text.split(' ')

  if (words.length < 4) return <>{text}</>

  return (
    <>
      {words.slice(0, -2).join(' ')} <em>{words.slice(-2).join(' ')}</em>
    </>
  )
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)

  return (
    <button
      type='button'
      className={styles.copy}
      aria-label={done ? 'Copied' : `${label}: ${text}`}
      onClick={() =>
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setDone(true)
            setTimeout(() => setDone(false), 1600)
          })
          .catch(() => {})
      }
    >
      {done ? '✓ Copied' : label}
    </button>
  )
}

/** The terminal sample, typed out line by line (CSS only, so it never flickers on load). */
function Terminal({ lines }: { lines: string[] }) {
  const command = lines.find(l => l.startsWith('$'))?.slice(1).trim()

  return (
    <div className={styles.terminal} aria-label='Terminal example'>
      <div className={styles.terminalBar}>
        <span aria-hidden />
        <span aria-hidden />
        <span aria-hidden />
        <em>zsh — ~/my-api</em>
        {command && <CopyButton text={command} />}
      </div>
      <pre className={styles.terminalBody}>
        {lines.map((line, i) => (
          <div
            key={i}
            className={line.startsWith('$') ? styles.cmd : line.includes('✅') ? styles.ok : styles.dim}
            style={{ '--i': i, '--chars': line.length } as CSSProperties}
          >
            {line.startsWith('$') ? (
              <span className={styles.typed}>
                <span className={styles.prompt}>$</span>
                {line.slice(1)}
              </span>
            ) : (
              line
            )}
          </div>
        ))}
        <span className={styles.caret} aria-hidden />
      </pre>
    </div>
  )
}

/** Cards with a light that follows the pointer ([data-spot] children). */
function onSpot(e: ReactPointerEvent<HTMLElement>) {
  const card = (e.target as HTMLElement).closest<HTMLElement>('[data-spot]')

  if (!card) return
  const r = card.getBoundingClientRect()

  card.style.setProperty('--mx', `${e.clientX - r.left}px`)
  card.style.setProperty('--my', `${e.clientY - r.top}px`)
}

export function LandingView({ content, signupsEnabled }: { content: LandingContent; signupsEnabled: boolean }) {
  const { hero, stats, features, steps, diagram, useCases, logos, showcase, testimonials, faq, cta } = content
  const journey = content.journey ?? (defaultEntry('home')?.data as LandingContent | undefined)?.journey
  const primary = signupsEnabled ? hero.primaryCta : { label: 'Sign in', href: '/login' }
  const ctaAction = signupsEnabled ? cta.primaryCta : { label: 'Sign in', href: '/login' }
  const reduced = useReducedMotion()
  const coreRef = useRef<HTMLDivElement>(null)
  const page = useReveal<HTMLDivElement>()
  const [statsRef, statsIn] = useInView<HTMLDivElement>()
  const localLine = hero.terminal.find(l => /localhost:\d+/.test(l))?.match(/localhost:\d+/)?.[0]

  return (
    <div ref={page} className={styles.void}>
      {/* ── Hero ── */}
      <section className={styles.hero}>
        <Starfield className={styles.stars} focusRef={coreRef} />
        <div className={styles.nebula} aria-hidden />
        <div className={`${styles.inner} ${styles.heroGrid}`}>
          <div className={styles.heroCopy}>
            {hero.eyebrow && (
              <span className={styles.badge}>
                <span className={styles.badgeDot} aria-hidden />
                {hero.eyebrow}
              </span>
            )}
            <h1 className={styles.heroTitle}>
              <HeroTitle text={hero.title} />
            </h1>
            <p className={styles.heroText}>{hero.subtitle}</p>
            <div className={styles.actions}>
              <Link href={primary.href} className={styles.btnPrimary}>
                {primary.label}
                <span aria-hidden>→</span>
              </Link>
              {hero.secondaryCta?.href && hero.secondaryCta.label && (
                <Link href={hero.secondaryCta.href} className={styles.btnGhost}>
                  {hero.secondaryCta.label}
                </Link>
              )}
            </div>
          </div>
          <div className={styles.heroVisual}>
            <Portal coreRef={coreRef} local={localLine} />
            {hero.terminal.length > 0 && <Terminal lines={hero.terminal} />}
          </div>
        </div>

        {stats.length > 0 && (
          <div ref={statsRef} className={`${styles.inner} ${styles.stats}`}>
            {stats.map((s, i) => (
              <div key={s.label} className={styles.stat} style={{ '--i': i } as CSSProperties} data-reveal>
                <div className={styles.statValue}>
                  <CountUp value={s.value} run={statsIn} reduced={reduced} />
                </div>
                <div className={styles.statLabel}>{s.label}</div>
              </div>
            ))}
          </div>
        )}
        {logos && logos.items.length > 0 && <LogoStrip logos={logos} />}
        <a href='#journey' className={styles.scrollCue} aria-label='Scroll to how it works'>
          <span />
        </a>
      </section>

      {/* ── The journey of a request ── */}
      {journey && journey.stages.length > 1 && (
        <section id='journey' className={styles.section}>
          <div className={styles.inner}>
            <Journey title={journey.title} subtitle={journey.subtitle} stages={journey.stages} />
            {diagram?.source && (
              <details className={styles.more}>
                <summary>{diagram.title || 'See it as a sequence diagram'}</summary>
                {diagram.subtitle && <p className={styles.lead}>{diagram.subtitle}</p>}
                <div className={styles.diagram}>
                  <VhyxChart source={diagram.source} autoplay loop controls theme='dark' />
                </div>
              </details>
            )}
          </div>
        </section>
      )}

      {/* ── Features ── */}
      <section id='features' className={styles.section}>
        <div className={styles.inner}>
          <div className={styles.sectionHead} data-reveal>
            <span className={styles.kicker}>Features</span>
            <h2 className={styles.h2}>{features.title}</h2>
            {features.subtitle && <p className={styles.lead}>{features.subtitle}</p>}
          </div>
          <div className={styles.bento} onPointerMove={onSpot}>
            {features.items.map((f, i) => (
              <article key={f.title} className={styles.card} data-spot data-reveal style={{ '--i': i } as CSSProperties}>
                <span className={styles.cardIcon}>{featureIcon(f.icon)}</span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works: the launch sequence ── */}
      <section id='how-it-works' className={styles.section}>
        <div className={styles.inner}>
          <div className={styles.sectionHead} data-reveal>
            <span className={styles.kicker}>Launch sequence</span>
            <h2 className={styles.h2}>{steps.title}</h2>
          </div>
          <ol className={styles.launch} data-reveal style={{ '--n': steps.items.length } as CSSProperties}>
            {steps.items.map((step, i) => (
              <li key={step.title} className={styles.launchStep} style={{ '--i': i } as CSSProperties}>
                <span className={styles.launchOrb}>{String(i + 1).padStart(2, '0')}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
                {step.code && (
                  <div className={styles.codeChip}>
                    <code>{step.code}</code>
                    <CopyButton text={step.code} />
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Showcase: video and screenshots ── */}
      {showcase && <Showcase showcase={showcase} />}

      {/* ── Use cases ── */}
      {useCases && useCases.items.length > 0 && (
        <section className={styles.section}>
          <div className={styles.inner}>
            <div className={styles.sectionHead} data-reveal>
              <span className={styles.kicker}>Use cases</span>
              <h2 className={styles.h2}>{useCases.title}</h2>
            </div>
            <div className={styles.uses} onPointerMove={onSpot}>
              {useCases.items.map((u, i) => (
                <article key={u.title} className={`${styles.card} ${styles.use}`} data-spot data-reveal style={{ '--i': i } as CSSProperties}>
                  <span className={styles.useNum} aria-hidden>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3>{u.title}</h3>
                  <p>{u.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Testimonials ── */}
      {testimonials && testimonials.items.length > 0 && <Testimonials testimonials={testimonials} />}

      {/* ── FAQ ── */}
      {faq.items.length > 0 && (
        <section className={styles.section}>
          <div className={`${styles.inner} ${styles.faqWrap}`}>
            <div className={styles.sectionHead} data-reveal>
              <span className={styles.kicker}>FAQ</span>
              <h2 className={styles.h2}>{faq.title}</h2>
            </div>
            <div className={styles.faq} data-reveal>
              {faq.items.map(item => (
                <details key={item.q}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Last call ── */}
      <section className={`${styles.section} ${styles.ctaSection}`}>
        <div className={styles.ctaRings} aria-hidden>
          {[0, 1, 2, 3].map(i => (
            <span key={i} style={{ '--i': i } as CSSProperties} />
          ))}
        </div>
        <div className={`${styles.inner} ${styles.cta}`} data-reveal>
          <h2 className={styles.ctaTitle}>{cta.title}</h2>
          {cta.subtitle && <p className={styles.lead}>{cta.subtitle}</p>}
          <Link href={ctaAction.href} className={styles.btnPrimary}>
            {ctaAction.label}
            <span aria-hidden>→</span>
          </Link>
        </div>
      </section>
    </div>
  )
}
