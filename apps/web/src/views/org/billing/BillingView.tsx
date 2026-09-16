'use client'
import { useState } from 'react'

import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Button from '@mui/material/Button'
import LoadingButton from '@mui/lab/LoadingButton'
import Skeleton from '@mui/material/Skeleton'
import Alert from '@mui/material/Alert'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'

import { useCreateCheckout, useSubscription, useCreatePortal, useInvoices } from '@/api/application/hooks/useBilling'
import { RoleLevel } from '@/api/domain/identity/enums/role.enum'
import { RequireRole } from '@/api/domain/identity/guard/RequireRole'
import type { Plan, SubscriptionStatus, InvoiceStatus, Invoice } from '@/api/domain/key-management/types/billing.types'

// ── Color helpers — uppercase enums ───────────────────────────────────────

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
  const [trialDays, setTrialDays] = useState<number | undefined>(undefined)
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
    <Dialog open={open} onClose={onClose} maxWidth='xs' fullWidth>
      <DialogTitle>Upgrade plan</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: '16px !important' }}>
        {/* Plan cards */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {PLANS.map(plan => {
            const selected = selectedPriceId === plan.priceId

            return (
              <Box
                key={plan.id}
                onClick={() => setSelectedPriceId(plan.priceId)}
                sx={{
                  p: 2,
                  borderRadius: 2,
                  border: '2px solid',
                  borderColor: selected ? 'primary.main' : 'divider',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                  bgcolor: selected ? 'primary.lighter' : 'transparent'
                }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography fontWeight={600}>{plan.label}</Typography>
                  <Typography variant='body2' color='text.secondary'>
                    {plan.price}
                  </Typography>
                </Box>
                <Box component='ul' sx={{ m: 0, pl: 2 }}>
                  {plan.features.map(f => (
                    <Typography key={f} component='li' variant='caption' color='text.secondary'>
                      {f}
                    </Typography>
                  ))}
                </Box>
              </Box>
            )
          })}
        </Box>

        <Alert severity='info' icon={<i className='tabler-info-circle' />}>
          You will be redirected to Stripe to complete payment securely.
        </Alert>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={onClose} variant='outlined' color='secondary'>
          Cancel
        </Button>
        <LoadingButton
          onClick={handleCheckout}
          loading={checkout.isPending}
          variant='contained'
          startIcon={<i className='tabler-credit-card' />}
        >
          Continue to checkout
        </LoadingButton>
      </DialogActions>
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
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        py: 1.5,
        borderBottom: '1px solid',
        borderColor: 'divider',
        '&:last-child': { borderBottom: 'none' }
      }}
    >
      <Box>
        <Typography variant='body2' fontWeight={500}>
          {periodLabel}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.75, mt: 0.5, flexWrap: 'wrap' }}>
          <Chip label={invoice.status} size='small' color={invoiceStatusColor(invoice.status)} variant='tonal' />
          {invoice.paidAt && (
            <Typography variant='caption' color='text.secondary'>
              Paid {new Date(invoice.paidAt).toLocaleDateString()}
            </Typography>
          )}
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Typography variant='body2' fontWeight={500}>
          {formatCurrency(invoice.amountDue, invoice.currency)}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.75 }}>
          {invoice.invoicePdfUrl && (
            <Button
              size='small'
              variant='outlined'
              href={invoice.invoicePdfUrl}
              target='_blank'
              startIcon={<i className='tabler-download text-sm' />}
            >
              PDF
            </Button>
          )}
          {invoice.hostedInvoiceUrl && invoice.status === 'OPEN' && (
            <Button size='small' variant='contained' color='warning' href={invoice.hostedInvoiceUrl} target='_blank'>
              Pay now
            </Button>
          )}
        </Box>
      </Box>
    </Box>
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

  if (isLoading) return <Skeleton variant='rounded' height={180} />
  if (!data) return null

  const sub = data.subscription
  const isFree = !sub || sub.plan === 'FREE'
  const isPaid = sub && sub.plan !== 'FREE' && sub.status !== 'CANCELED'

  return (
    <>
      <Card>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Box>
              <Typography variant='h6' fontWeight={600}>
                Current plan
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                <Chip label={sub?.plan ?? 'FREE'} color={planColor(sub?.plan ?? 'FREE')} size='small' />
                {sub?.status && (
                  <Chip label={sub.status} color={subStatusColor(sub.status)} size='small' variant='tonal' />
                )}
              </Box>
            </Box>

            {/* Action button — upgrade or manage */}
            <Box>
              {isFree ? (
                <Button
                  variant='contained'
                  size='small'
                  startIcon={<i className='tabler-rocket' />}
                  onClick={() => setUpgradeOpen(true)}
                >
                  Upgrade
                </Button>
              ) : (
                <LoadingButton
                  variant='outlined'
                  size='small'
                  loading={createPortal.isPending}
                  startIcon={<i className='tabler-external-link' />}
                  onClick={handleManage}
                >
                  Manage subscription
                </LoadingButton>
              )}
            </Box>
          </Box>

          <Divider />

          {/* Subscription details */}
          {sub && !isFree && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              {sub.currentPeriodEnd && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant='body2' color='text.secondary'>
                    {sub.cancelAtPeriodEnd ? 'Cancels on' : 'Next billing date'}
                  </Typography>
                  <Typography variant='body2' fontWeight={500}>
                    {new Date(sub.currentPeriodEnd).toLocaleDateString(undefined, {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </Typography>
                </Box>
              )}

              {sub.trialEndsAt && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant='body2' color='text.secondary'>
                    Trial ends
                  </Typography>
                  <Typography variant='body2' fontWeight={500}>
                    {new Date(sub.trialEndsAt).toLocaleDateString(undefined, {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </Typography>
                </Box>
              )}
            </Box>
          )}

          {isFree && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant='body2' color='text.secondary'>
                You&apos;re on the free plan. Upgrade to unlock more tunnels, API keys, and team members.
              </Typography>
            </Box>
          )}

          {/* Warnings */}
          {sub?.cancelAtPeriodEnd && !isFree && (
            <Alert severity='warning' icon={<i className='tabler-alert-triangle' />}>
              Your subscription will cancel at end of the current period. Click &quot;Manage subscription&quot; to
              resume.
            </Alert>
          )}

          {sub?.status === 'PAST_DUE' && (
            <Alert severity='error' icon={<i className='tabler-credit-card-off' />}>
              Payment failed. Please update your payment method to avoid service interruption.
              <Button size='small' variant='text' color='error' onClick={handleManage} sx={{ ml: 1 }}>
                Update payment
              </Button>
            </Alert>
          )}
        </CardContent>
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
      <CardContent>
        <Typography variant='subtitle1' fontWeight={600} gutterBottom>
          Invoice history
        </Typography>

        {isLoading ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {[1, 2, 3].map(i => (
              <Skeleton key={i} variant='rounded' height={52} />
            ))}
          </Box>
        ) : !invoiceData?.invoices.length ? (
          <Box sx={{ py: 3, textAlign: 'center' }}>
            <i
              className='tabler-receipt-off'
              style={{ fontSize: 36, color: 'var(--mui-palette-text-disabled)', display: 'block', marginBottom: 8 }}
            />
            <Typography color='text.secondary' variant='body2'>
              No invoices yet.
            </Typography>
          </Box>
        ) : (
          <Box>
            {invoiceData.invoices.map(invoice => (
              <InvoiceRow key={invoice.id} invoice={invoice} />
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────

type Props = { accountId: string }

export default function BillingView({ accountId }: Props) {
  // Handle Stripe return — show success/cancel toast
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const justUpgraded = searchParams?.get('success') === '1'

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 720 }}>
      {justUpgraded && (
        <Alert
          severity='success'
          icon={<i className='tabler-circle-check' />}
          onClose={() => {
            const url = new URL(window.location.href)

            url.searchParams.delete('success')
            window.history.replaceState({}, '', url.toString())
          }}
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
            <CardContent sx={{ py: 3, textAlign: 'center' }}>
              <Typography variant='body2' color='text.secondary'>
                Invoice history is only visible to organization owners.
              </Typography>
            </CardContent>
          </Card>
        }
      >
        <InvoiceSection accountId={accountId} />
      </RequireRole>
    </Box>
  )
}
