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
  ['inspectorRequests', 'Requests kept in the inspector (per tunnel)'],
  ['inboxRequests', 'Webhooks held while you are offline (per tunnel)'],
  ['accessRules', 'Password, IP allowlist and share links'],
  ['prodKeysAllowed', 'Production keys'],
  ['rotationAllowed', 'Key rotation'],
  ['prioritySupport', 'Priority support']
]

// "5 concurrent tunnels" reads better than "5 Concurrent tunnels (agents)".
const COUNT_LABELS: Record<string, string> = {
  maxAgents: 'concurrent tunnels',
  maxRequestsPerMonth: 'requests per month',
  maxMembers: 'team members',
  maxApiKeys: 'API keys',
  publicPathRateLimitPerMinute: 'public requests per minute',
  inspectorRequests: 'requests kept in the inspector',
  inboxRequests: 'webhooks held while you are offline'
}

function show(v: unknown) {
  if (v === null) return 'Unlimited'
  if (v === true) return '✓'
  if (v === false) return '—'
  if (typeof v === 'number') return v.toLocaleString()

  return String(v ?? '—')
}

/** Launch mode: one free plan, no prices, nothing to buy. */
function FreeModePricing({ plans, signupsEnabled, faq }: { plans: PublicPlans; signupsEnabled: boolean; faq: PricingContent['faq'] }) {
  const plan = plans.plans.find(p => p.plan === plans.defaultPlan) ?? plans.plans[0]
  const features = LIMIT_ROWS.filter(([key]) => plan && plan.limits[key] !== false && plan.limits[key] !== undefined).map(
    ([key, label]) => (typeof plan.limits[key] === 'boolean' ? label : `${show(plan.limits[key])} ${COUNT_LABELS[key] ?? label}`)
  )

  return (
    <>
      <section className={styles.hero}>
        <div className={`${styles.inner} ${styles.center}`} style={{ position: 'relative' }}>
          <span className={styles.eyebrow}>Pricing</span>
          <h1 className={styles.heroTitle} style={{ fontSize: 'clamp(2rem, 4.5vw, 3.2rem)' }}>
            Free while we launch
          </h1>
          <p className={styles.lead}>{plans.freeModeMessage}</p>
        </div>
        <div className={styles.inner} style={{ position: 'relative', marginBlockStart: '3rem', maxInlineSize: '28rem' }}>
          <PricingTable
            linkAs={Link as any}
            plans={[
              {
                name: 'Early access',
                price: '$0',
                period: '',
                description: 'Everything you need to share local servers, webhooks and demos.',
                features,
                highlighted: true,
                badge: 'Free',
                action: signupsEnabled ? { label: 'Get started free', href: '/register', variant: 'primary' } : { label: 'Sign in', href: '/login', variant: 'primary' }
              }
            ]}
          />
          <p className={styles.center} style={{ marginBlockStart: '1rem', opacity: 0.75, fontSize: 14 }}>
            Paid plans with higher limits will come later. Accounts created now keep working.
          </p>
        </div>
      </section>
      {faq.length > 0 && (
        <section className={styles.section}>
          <div className={styles.inner} style={{ maxInlineSize: '48rem' }}>
            <FAQ title='Questions' items={faq.map(f => ({ question: f.q, answer: f.a }))} />
          </div>
        </section>
      )}
    </>
  )
}

export function PricingView({ content, plans, signupsEnabled }: { content: PricingContent; plans: PublicPlans | null; signupsEnabled: boolean }) {
  if (plans?.mode === 'free') return <FreeModePricing plans={plans} signupsEnabled={signupsEnabled} faq={content.faq} />

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
