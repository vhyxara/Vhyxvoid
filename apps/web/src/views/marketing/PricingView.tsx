'use client'

import Link from 'next/link'

import { FAQ, PricingTable } from '@vhyxui/blocks'
import type { PricingContent } from '@vhyxvoid/content'

import type { PublicPlans } from './publicApi'
import styles from './marketing.module.css'

const LIMIT_ROWS: Array<[string, string]> = [
  ['maxAgents', 'Concurrent tunnels (agents)'],
  ['maxRequestsPerMonth', 'Requests per month'],
  ['maxMembers', 'Team members'],
  ['maxApiKeys', 'API keys'],
  ['publicPathRateLimitPerMinute', 'Public requests per minute'],
  ['prodKeysAllowed', 'Production keys'],
  ['rotationAllowed', 'Key rotation'],
  ['prioritySupport', 'Priority support']
]

function show(v: unknown) {
  if (v === null) return 'Unlimited'
  if (v === true) return '✓'
  if (v === false) return '—'
  if (typeof v === 'number') return v.toLocaleString()

  return String(v ?? '—')
}

export function PricingView({ content, plans, signupsEnabled }: { content: PricingContent; plans: PublicPlans | null; signupsEnabled: boolean }) {
  const trial = plans?.trialDays ?? 0

  return (
    <>
      <section className={styles.hero}>
        <div className={`${styles.inner} ${styles.center}`} style={{ position: 'relative' }}>
          <span className={styles.eyebrow}>Pricing</span>
          <h1 className={styles.heroTitle} style={{ fontSize: 'clamp(2rem, 4.5vw, 3.2rem)' }}>
            {content.title}
          </h1>
          <p className={styles.lead}>
            {content.subtitle}
            {trial > 0 ? ` Paid plans start with a ${trial}-day free trial.` : ''}
          </p>
        </div>
        <div className={styles.inner} style={{ position: 'relative', marginBlockStart: '3rem' }}>
          <PricingTable
            linkAs={Link as any}
            plans={content.plans.map(p => ({
              name: p.name,
              price: p.price,
              period: p.period,
              description: p.description,
              features: p.features,
              highlighted: p.highlighted,
              badge: p.highlighted ? 'Most popular' : undefined,
              action: {
                label: !signupsEnabled && p.plan !== 'ENTERPRISE' ? 'Sign in' : p.ctaLabel,
                href: !signupsEnabled && p.plan !== 'ENTERPRISE' ? '/login' : p.ctaHref || '/register',
                variant: p.highlighted ? 'primary' : 'outline'
              }
            }))}
          />
        </div>
      </section>

      {plans && (
        <section className={`${styles.section} ${styles.muted}`}>
          <div className={styles.inner}>
            <h2 className={`${styles.h2} ${styles.center}`}>Compare plans</h2>
            <div className={styles.limits}>
              <table>
                <thead>
                  <tr>
                    <th scope='col'>Limit</th>
                    {plans.plans.map(p => (
                      <th key={p.plan} scope='col'>
                        {content.plans.find(c => c.plan === p.plan)?.name ?? p.plan}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {LIMIT_ROWS.map(([key, label]) => (
                    <tr key={key}>
                      <th scope='row' style={{ fontWeight: 400 }}>
                        {label}
                      </th>
                      {plans.plans.map(p => (
                        <td key={p.plan}>{show(p.limits[key])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {content.faq.length > 0 && (
        <section className={styles.section}>
          <div className={styles.inner} style={{ maxInlineSize: '48rem' }}>
            <FAQ title='Billing questions' items={content.faq.map(f => ({ question: f.q, answer: f.a }))} />
          </div>
        </section>
      )}
    </>
  )
}
