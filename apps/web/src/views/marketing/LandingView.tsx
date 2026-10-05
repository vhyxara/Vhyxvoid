'use client'

import { useEffect, useState } from 'react'

import Link from 'next/link'

import { CTASection, FAQ, FeatureGrid } from '@vhyxui/blocks'
import { Button } from '@vhyxui/react'
import { VhyxChart } from '@vhyxchart/react'
import type { LandingContent } from '@vhyxvoid/content'

import { featureIcon } from './icons'
import styles from './marketing.module.css'

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

function Terminal({ lines }: { lines: string[] }) {
  return (
    <div className={styles.terminal} aria-label='Terminal example'>
      <div className={styles.terminalBar} aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <pre className={styles.terminalBody}>
        {lines.map((line, i) => (
          <div key={i} className={line.startsWith('$') ? undefined : line.includes('✅') ? styles.ok : styles.dim}>
            {line.startsWith('$') ? (
              <>
                <span className={styles.prompt}>$</span>
                {line.slice(1)}
              </>
            ) : (
              line
            )}
          </div>
        ))}
      </pre>
    </div>
  )
}

/** The page's own colour scheme (html[data-theme]), which may differ from the OS one. */
function usePageTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    const read = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
    const obs = new MutationObserver(read)

    read()
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => obs.disconnect()
  }, [])

  return theme
}

export function LandingView({ content, signupsEnabled }: { content: LandingContent; signupsEnabled: boolean }) {
  const theme = usePageTheme()
  const { hero, stats, features, steps, diagram, useCases, faq, cta } = content
  const primary = signupsEnabled ? hero.primaryCta : { label: 'Sign in', href: '/login' }

  return (
    <>
      <section className={styles.hero}>
        <div className={`${styles.inner} ${styles.heroGrid}`}>
          <div>
            {hero.eyebrow && <span className={styles.eyebrow}>{hero.eyebrow}</span>}
            <h1 className={styles.heroTitle}>
              <HeroTitle text={hero.title} />
            </h1>
            <p className={styles.heroText}>{hero.subtitle}</p>
            <div className={styles.actions}>
              <Button asChild size='lg'>
                <Link href={primary.href}>{primary.label}</Link>
              </Button>
              {hero.secondaryCta?.href && hero.secondaryCta.label && (
                <Button asChild size='lg' variant='outline'>
                  <Link href={hero.secondaryCta.href}>{hero.secondaryCta.label}</Link>
                </Button>
              )}
            </div>
          </div>
          {hero.terminal.length > 0 && <Terminal lines={hero.terminal} />}
        </div>
        {stats.length > 0 && (
          <div className={`${styles.inner} ${styles.stats}`}>
            {stats.map(s => (
              <div key={s.label} className={styles.stat}>
                <div className={styles.statValue}>{s.value}</div>
                <div className={styles.statLabel}>{s.label}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section id='features' className={`${styles.section} ${styles.muted}`}>
        <div className={styles.inner}>
          <FeatureGrid
            title={features.title}
            description={features.subtitle}
            features={features.items.map(f => ({ title: f.title, description: f.body, icon: featureIcon(f.icon) }))}
          />
        </div>
      </section>

      <section id='how-it-works' className={styles.section}>
        <div className={`${styles.inner} ${styles.center}`}>
          <span className={styles.eyebrow}>How it works</span>
          <h2 className={styles.h2}>{steps.title}</h2>
          <div className={styles.steps} style={{ textAlign: 'start' }}>
            {steps.items.map(step => (
              <div key={step.title} className={styles.step}>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
                {step.code && <code className={styles.code}>{step.code}</code>}
              </div>
            ))}
          </div>
          {diagram?.source && (
            <div style={{ marginBlockStart: '4rem' }}>
              <h2 className={styles.h2}>{diagram.title}</h2>
              {diagram.subtitle && <p className={styles.lead}>{diagram.subtitle}</p>}
              <div className={styles.diagram}>
                <VhyxChart key={theme} source={diagram.source} autoplay loop controls theme={theme} />
              </div>
            </div>
          )}
        </div>
      </section>

      {useCases && useCases.items.length > 0 && (
        <section className={`${styles.section} ${styles.muted}`}>
          <div className={`${styles.inner} ${styles.center}`}>
            <h2 className={styles.h2}>{useCases.title}</h2>
            <div className={styles.cards} style={{ textAlign: 'start' }}>
              {useCases.items.map(u => (
                <div key={u.title} className={styles.card}>
                  <h3>{u.title}</h3>
                  <p>{u.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {faq.items.length > 0 && (
        <section className={styles.section}>
          <div className={styles.inner} style={{ maxInlineSize: '48rem' }}>
            <FAQ title={faq.title} items={faq.items.map(i => ({ question: i.q, answer: i.a }))} />
          </div>
        </section>
      )}

      <section className={`${styles.section} ${styles.muted}`}>
        <div className={styles.inner}>
          <CTASection
            title={cta.title}
            description={cta.subtitle}
            linkAs={Link as any}
            actions={[signupsEnabled ? { label: cta.primaryCta.label, href: cta.primaryCta.href } : { label: 'Sign in', href: '/login' }]}
          />
        </div>
      </section>
    </>
  )
}
