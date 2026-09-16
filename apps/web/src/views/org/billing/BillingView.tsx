'use client'
import { useState } from 'react'

import { Alert, Badge, Button, Card, Dialog, Separator } from '@vhyxui/react'

import { Skeleton, Typography } from '@/components/vhyxui-shims'
import { useCreateCheckout, useSubscription, useCreatePortal, useInvoices } from '@/api/application/hooks/useBilling'
import { RoleLevel } from '@/api/domain/identity/enums/role.enum'
import { RequireRole } from '@/api/domain/identity/guard/RequireRole'
import type { Plan, SubscriptionStatus, InvoiceStatus, Invoice } from '@/api/domain/key-management/types/billing.types'

// ── Color helpers — uppercase enums ───────────────────────────────────────
// planColor/subStatusColor/invoiceStatusColor return MUI-style names.
// VhyxUI's Badge has no 'error'/'primary' variant (only default/success/
// warning/danger/info/outline) — same mapping pattern as MembersTable/
// ApiKeysView/TunnelsView's own roleBadgeVariant/statusBadgeVariant/
// envBadgeVariant, and feedback.util.ts's feedbackBadgeVariant.
function billingBadgeVariant(muiColor: 'primary' | 'error' | 'default' | 'success' | 'info' | 'warning') {
  if (muiColor === 'error') return 'danger' as const
  if (muiColor === 'primary') return 'default' as const

  return muiColor
}

function planColor(plan: Plan | string) {
  if (plan === 'PRO') return 'primary' as const
  if (plan === 'ENTERPRISE') return 'error' as const

  return 'default' as const
}

function subStatusColor(status: SubscriptionStatus | string) {
  if (status === 'ACTIVE') return 'success' as const
  if (status === 'TRIALING') return 'info' as const
  if (status === 'PAST_DUE') return 'error' as const
  if (status === 'CANCELED') return 'warning' as const

  return 'default' as const
}

function invoiceStatusColor(status: InvoiceStatus | string) {
  if (status === 'PAID') return 'success' as const
  if (status === 'OPEN') return 'warning' as const
  if (status === 'DRAFT') return 'default' as const
  if (status === 'UNCOLLECTIBLE') return 'error' as const
  if (status === 'VOID') return 'default' as const

  return 'default' as const
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase()
  }).format(amount / 100)
}

// ── Checkout dialog — price ID selection ─────────────────────────────────
// In production replace hardcoded priceIds with your Stripe price IDs

const PLANS = [
  {
    id: 'pro',
    label: 'Pro',
    price: '$29 / month',
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID ?? 'price_pro',
    features: ['5 team members', '50 active tunnels', 'Usage analytics', 'Email support']
  },
  {
    id: 'enterprise',
    label: 'Enterprise',
    price: '$99 / month',
    priceId: process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID ?? 'price_enterprise',
    features: ['Unlimited members', 'Unlimited tunnels', 'Priority support', 'Custom SLA']
  }
]

function UpgradeDialog({ open, onClose, accountId }: { open: boolean; onClose: () => void; accountId: string }) {
  const [selectedPriceId, setSelectedPriceId] = useState(PLANS[0].priceId)
  const [trialDays] = useState<number | undefined>(undefined)
  const checkout = useCreateCheckout(accountId)

  const handleCheckout = () => {
    checkout.mutate(
      {
        priceId: selectedPriceId,
        successUrl: `${window.location.origin}/organizations/${accountId}/billing?success=1`,
        cancelUrl: `${window.location.origin}/organizations/${accountId}/billing`,
        trialDays
      },
      {
        onSuccess: ({ checkoutUrl }) => {
          window.location.href = checkoutUrl
        }
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && onClose()} size='sm'>
      {/* Dialog.Portal gates rendering on open state — see decision.md,
          2026-09-10/11, "Step 5b: Dialog.Portal omission". */}
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Upgrade plan</Dialog.Title>

          <div className='flex flex-col gap-4'>
            {/* Plan cards */}
            <div className='flex flex-col gap-3'>
              {PLANS.map(plan => {
                const selected = selectedPriceId === plan.priceId

                return (
                  <div
                    key={plan.id}
                    onClick={() => setSelectedPriceId(plan.priceId)}
                    className='cursor-pointer'
                    style={{
                      padding: 'var(--vhyx-space-4)',
                      borderRadius: 'var(--vhyx-radius-lg)',
                      border: `2px solid ${selected ? 'var(--vhyx-color-accent)' : 'var(--vhyx-color-border)'}`,
                      backgroundColor: selected ? 'var(--vhyx-color-accent-subtle)' : 'transparent',
                      transition: 'border-color 0.15s'
                    }}
                  >
                    <div className='flex justify-between items-center mb-1'>
                      <Typography style={{ fontWeight: 600 }}>{plan.label}</Typography>
                      <Typography variant='body2' style={{ color: 'var(--vhyx-color-text-subtle)' }}>
                        {plan.price}
                      </Typography>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 'var(--vhyx-space-4)' }}>
                      {plan.features.map(f => (
                        <Typography
                          key={f}
                          component='li'
                          variant='caption'
                          style={{ color: 'var(--vhyx-color-text-subtle)' }}
                        >
                          {f}
                        </Typography>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>

            <Alert variant='info' icon={<i className='tabler-info-circle' />}>
              You will be redirected to Stripe to complete payment securely.
            </Alert>
          </div>

          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose} type='button'>
              Cancel
            </Button>
            <Button onClick={handleCheckout} loading={checkout.isPending} icon={<i className='tabler-credit-card' />}>
              Continue to checkout
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

// ── Invoice row ───────────────────────────────────────────────────────────

function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const periodLabel =
    invoice.periodStart && invoice.periodEnd
      ? `${new Date(invoice.periodStart).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })} — ${new Date(invoice.periodEnd).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
      : 'One-time payment'

  return (
    <div
      className='flex items-center justify-between'
      style={{
        paddingTop: 'var(--vhyx-space-3)',
        paddingBottom: 'var(--vhyx-space-3)',
        borderBottom: '1px solid var(--vhyx-color-border)'
      }}
    >
      <div>
        <Typography variant='body2' style={{ fontWeight: 500 }}>
          {periodLabel}
        </Typography>
        <div className='flex flex-wrap items-center gap-2' style={{ marginTop: 4 }}>
          <Badge variant={billingBadgeVariant(invoiceStatusColor(invoice.status))} size='sm'>
            {invoice.status}
          </Badge>
          {invoice.paidAt && (
            <Typography variant='caption' style={{ color: 'var(--vhyx-color-text-subtle)' }}>
              Paid {new Date(invoice.paidAt).toLocaleDateString()}
            </Typography>
          )}
        </div>
      </div>

      <div className='flex items-center gap-3'>
        <Typography variant='body2' style={{ fontWeight: 500 }}>
          {formatCurrency(invoice.amountDue, invoice.currency)}
        </Typography>
        <div className='flex gap-2'>
          {invoice.invoicePdfUrl && (
            <Button asChild size='sm' variant='outline'>
              <a href={invoice.invoicePdfUrl} target='_blank' rel='noopener noreferrer'>
                <i className='tabler-download text-sm' /> PDF
              </a>
            </Button>
          )}
          {invoice.hostedInvoiceUrl && invoice.status === 'OPEN' && (
            <Button asChild size='sm' style={{ backgroundColor: 'var(--vhyx-color-warning)', borderColor: 'var(--vhyx-color-warning)' }}>
              <a href={invoice.hostedInvoiceUrl} target='_blank' rel='noopener noreferrer'>
                Pay now
              </a>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Subscription card ─────────────────────────────────────────────────────

function SubscriptionCard({ accountId }: { accountId: string }) {
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const { data, isLoading } = useSubscription(accountId)
  const createPortal = useCreatePortal(accountId)

  const handleManage = () => {
    createPortal.mutate(
      { returnUrl: `${window.location.origin}/organizations/${accountId}/billing` },
      {
        onSuccess: ({ portalUrl }) => {
          window.location.href = portalUrl
        }
      }
    )
  }

  if (isLoading) return <Skeleton variant='rectangular' height={180} />
  if (!data) return null

  const sub = data.subscription
  const isFree = !sub || sub.plan === 'FREE'

  return (
    <>
      <Card>
        <div className='flex flex-col gap-4'>
          {/* Header */}
          <div className='flex justify-between items-start'>
            <div>
              <Typography variant='h6' style={{ fontWeight: 600 }}>
                Current plan
              </Typography>
              <div className='flex flex-wrap gap-2' style={{ marginTop: 8 }}>
                <Badge variant={billingBadgeVariant(planColor(sub?.plan ?? 'FREE'))} size='sm'>
                  {sub?.plan ?? 'FREE'}
                </Badge>
                {sub?.status && (
                  <Badge variant={billingBadgeVariant(subStatusColor(sub.status))} size='sm'>
                    {sub.status}
                  </Badge>
                )}
              </div>
            </div>

            {/* Action button — upgrade or manage */}
            <div>
              {isFree ? (
                <Button size='sm' icon={<i className='tabler-rocket' />} onClick={() => setUpgradeOpen(true)}>
                  Upgrade
                </Button>
              ) : (
                <Button
                  variant='outline'
                  size='sm'
                  loading={createPortal.isPending}
                  icon={<i className='tabler-external-link' />}
                  onClick={handleManage}
                >
                  Manage subscription
                </Button>
              )}
            </div>
          </div>

          <Separator />

          {/* Subscription details */}
          {sub && !isFree && (
            <div className='flex flex-col gap-2'>
              {sub.currentPeriodEnd && (
                <div className='flex justify-between'>
                  <Typography variant='body2' style={{ color: 'var(--vhyx-color-text-subtle)' }}>
                    {sub.cancelAtPeriodEnd ? 'Cancels on' : 'Next billing date'}
                  </Typography>
                  <Typography variant='body2' style={{ fontWeight: 500 }}>
                    {new Date(sub.currentPeriodEnd).toLocaleDateString(undefined, {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </Typography>
                </div>
              )}

              {sub.trialEndsAt && (
                <div className='flex justify-between'>
                  <Typography variant='body2' style={{ color: 'var(--vhyx-color-text-subtle)' }}>
                    Trial ends
                  </Typography>
                  <Typography variant='body2' style={{ fontWeight: 500 }}>
                    {new Date(sub.trialEndsAt).toLocaleDateString(undefined, {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </Typography>
                </div>
              )}
            </div>
          )}

          {isFree && (
            <Typography variant='body2' style={{ color: 'var(--vhyx-color-text-subtle)' }}>
              You&apos;re on the free plan. Upgrade to unlock more tunnels, API keys, and team members.
            </Typography>
          )}

          {/* Warnings */}
          {sub?.cancelAtPeriodEnd && !isFree && (
            <Alert variant='warning' icon={<i className='tabler-alert-triangle' />}>
              Your subscription will cancel at end of the current period. Click &quot;Manage subscription&quot; to
              resume.
            </Alert>
          )}

          {sub?.status === 'PAST_DUE' && (
            <Alert variant='danger' icon={<i className='tabler-credit-card-off' />}>
              Payment failed. Please update your payment method to avoid service interruption.
              {/* Button has no per-instance color prop (only a fixed variant
                  palette) — same targeted inline-color-override pattern as
                  RowAction.tsx's tintedIcon, applied here since 'ghost' is
                  the closest structural match to the original text button
                  but renders in the neutral text color by default. */}
              <Button
                variant='ghost'
                size='sm'
                onClick={handleManage}
                style={{ marginLeft: 8, color: 'var(--vhyx-color-danger)' }}
              >
                Update payment
              </Button>
            </Alert>
          )}
        </div>
      </Card>

      <UpgradeDialog open={upgradeOpen} onClose={() => setUpgradeOpen(false)} accountId={accountId} />
    </>
  )
}

// ── Invoice section — OWNER only ──────────────────────────────────────────

function InvoiceSection({ accountId }: { accountId: string }) {
  const { data: invoiceData, isLoading } = useInvoices(accountId)

  return (
    <Card>
      <Typography variant='subtitle1' style={{ fontWeight: 600, marginBottom: 12 }}>
        Invoice history
      </Typography>

      {isLoading ? (
        <div className='flex flex-col gap-2'>
          {[1, 2, 3].map(i => (
            <Skeleton key={i} variant='rectangular' height={52} />
          ))}
        </div>
      ) : !invoiceData?.invoices.length ? (
        <div className='text-center' style={{ paddingTop: 'var(--vhyx-space-6)', paddingBottom: 'var(--vhyx-space-6)' }}>
          <i
            className='tabler-receipt-off'
            style={{ fontSize: 36, color: 'var(--vhyx-color-text-disabled)', display: 'block', marginBottom: 8 }}
          />
          <Typography variant='body2' style={{ color: 'var(--vhyx-color-text-subtle)' }}>
            No invoices yet.
          </Typography>
        </div>
      ) : (
        <div>
          {invoiceData.invoices.map(invoice => (
            <InvoiceRow key={invoice.id} invoice={invoice} />
          ))}
        </div>
      )}
    </Card>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────

type Props = { accountId: string }

export default function BillingView({ accountId }: Props) {
  // Handle Stripe return — show success/cancel toast
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const justUpgraded = searchParams?.get('success') === '1'

  const clearSuccessParam = () => {
    const url = new URL(window.location.href)

    url.searchParams.delete('success')
    window.history.replaceState({}, '', url.toString())
  }

  return (
    <div className='flex flex-col gap-4' style={{ maxWidth: 720 }}>
      {justUpgraded && (
        <Alert
          variant='success'
          icon={<i className='tabler-circle-check' />}
          dismissible
          onDismiss={clearSuccessParam}
        >
          Plan upgraded successfully. Welcome to your new plan!
        </Alert>
      )}

      {/* Subscription card — all members can see plan info */}
      <SubscriptionCard accountId={accountId} />

      {/* Invoice history — OWNER only */}
      <RequireRole
        accountId={accountId}
        minLevel={RoleLevel.OWNER}
        fallback={
          <Card>
            <Typography
              variant='body2'
              className='text-center'
              style={{ color: 'var(--vhyx-color-text-subtle)', display: 'block' }}
            >
              Invoice history is only visible to organization owners.
            </Typography>
          </Card>
        }
      >
        <InvoiceSection accountId={accountId} />
      </RequireRole>
    </div>
  )
}
