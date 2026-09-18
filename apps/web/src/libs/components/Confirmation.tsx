'use client'

import { useState, type ReactNode } from 'react'

import { Button, Dialog } from '@vhyxui/react'

/* ---------- Types ---------- */

// Same plain color-name union MUI's ButtonProps['color'] used, decoupled from
// @mui/material now that the internal Button is VhyxUI's — see colorToVariant
// below for the color→variant mapping. Kept broad for compatibility with
// existing call sites (RowAction.tsx, TableAction.tsx / admin-only BulkActions,
// out of this migration's scope) that still type against these names.
type MuiLikeColor = 'error' | 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'inherit'

function colorToVariant(color: MuiLikeColor | undefined): 'primary' | 'secondary' | 'destructive' {
  if (color === 'error') return 'destructive'
  if (color === 'secondary' || color === 'inherit') return 'secondary'

  return 'primary'
}

export type ConfirmationProps = {
  title?: string

  /** Dialog description text */
  content?: string | ReactNode

  /** Confirm button label */
  confirmButtonText?: string

  /** Cancel button label */
  cancelButtonText?: string

  /** Button colors */
  confirmButtonColor?: MuiLikeColor
  cancelButtonColor?: MuiLikeColor

  /** Icon class (tabler, remix, etc) */
  icon?: string

  /** Whether dialog starts open */
  isOpen?: boolean

  /** Trigger button style — kept for API compatibility, unused internally
      (VhyxUI's Button has no 'variant' concept that maps onto MUI's
      outlined/contained/text; the trigger is always icon-only or plain text). */
  buttonVariant?: string

  /** Button label (optional when icon only) */
  buttonText?: string

  /** Extra props forwarded to the trigger Button — kept for API
      compatibility, not forwarded internally (VhyxUI Button's prop shape
      differs from MUI's; no current call site relies on this). */
  buttonProps?: Record<string, unknown>

  /** Button size */
  buttonSize?: 'xs' | 'sm' | 'md' | 'lg'

  /** Loading text */
  loadingText?: string

  /** Action to run on confirm. There used to be a second, default action
      path here (an `apiUrl`/`method`/`payloadData` shorthand that called a
      separate, independently-implemented HTTP client with its own from-
      scratch HMAC signing) — it had zero live callers anywhere in the app
      and bypassed the mutation-hook/query-key-invalidation architecture
      every real caller actually relies on. Removed 2026-09-15 along with
      utils/fetchData.ts — see decision.md, "NEXT_PUBLIC_SECRET_KEY removal".
      Every real usage must go through a mutation hook now.

      Must return the real mutation's own promise (i.e. call `.mutateAsync()`,
      not fire-and-forget `.mutate()`) — `handleConfirm` below awaits this to
      know when the real request has actually finished, not just when this
      function returned. See decision.md, 2026-09-19, "FeedbackContext
      removed" for why a caller that doesn't return a real promise used to
      silently defeat both the loading state below and this component's
      error handling entirely. `Promise<unknown>` (not `Promise<void>`) since
      a real `mutateAsync()` call resolves to the mutation's own real return
      value (e.g. `{ success: boolean }`), not `undefined` — this component
      never reads that value, only whether the promise rejects. */
  onConfirm?: () => Promise<unknown> | void

  /** Fires after a successful onConfirm */
  onSuccessCallback?: () => void
}

/* ---------- Component ---------- */

export default function Confirmation({
  title = 'Are you sure you want to proceed?',
  content = 'This action cannot be undone.',
  confirmButtonText = 'Yes, Proceed',
  cancelButtonText = 'Cancel',

  confirmButtonColor = 'error',
  cancelButtonColor = 'secondary',

  icon = 'tabler-trash',

  isOpen = false,
  buttonText = '',
  buttonSize,

  onConfirm,
  onSuccessCallback,

  loadingText = 'Processing...'
}: ConfirmationProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(isOpen)
  const [isLoading, setIsLoading] = useState(false)

  /* ---------- Confirm Action Wrapper ---------- */

  const handleConfirm = async () => {
    try {
      setIsLoading(true)
      await onConfirm?.()

      // Previously only fired on the now-removed default apiUrl action path
      // — a real bug: TableAction.tsx has always passed onSuccessCallback
      // (to clear bulk selection) alongside a real onConfirm, so it never
      // actually ran. Fixed here since this function is being rewritten
      // anyway. See decision.md, "NEXT_PUBLIC_SECRET_KEY removal".
      onSuccessCallback?.()
    } catch {
      // Deliberately no user-facing error surface here — every mutation
      // failure app-wide already gets a real, working error toast from the
      // global QueryClient's own MutationCache.onError handler (see
      // api/wrapper/queryClient.ts), which fires regardless of whether this
      // catch block does anything. This used to also open a second,
      // redundant error Dialog (FeedbackContext) on top of that toast —
      // except it never actually could, since every real caller of
      // `onConfirm` used fire-and-forget `.mutate()` rather than returning
      // a promise, so this catch block was permanently unreachable in
      // practice. Once callers were fixed to return the real mutation
      // promise (so the loading state above would be honest), this catch
      // became reachable for the first time — and forcing it to also show
      // FeedbackContext's Dialog would have meant every mutation failure
      // doubling up two competing error surfaces for the same event. See
      // decision.md, 2026-09-19, "FeedbackContext removed" for the full
      // investigation and why the toast is treated as the one real error
      // surface here, not this component's own Dialog. The `catch` still
      // exists (rather than letting `onConfirm`'s rejection propagate
      // unhandled) purely so `finally` below reliably closes the dialog and
      // clears the loading state on failure too, not just on success.
    } finally {
      setIsLoading(false)
      setIsDialogOpen(false)
    }
  }

  /* ---------- Dialog Controls ---------- */

  const handleClickOpen = () => setIsDialogOpen(true)
  const handleClose = () => !isLoading && setIsDialogOpen(false)

  return (
    <>
      {icon && !buttonText ? (
        <Button
          variant='ghost'
          size={buttonSize ?? 'sm'}
          iconOnly
          aria-label={confirmButtonText}
          icon={<i className={icon} />}
          onClick={handleClickOpen}
        />
      ) : (
        <Button
          variant={colorToVariant(confirmButtonColor)}
          size={buttonSize ?? 'sm'}
          icon={icon ? <i className={icon} /> : undefined}
          onClick={handleClickOpen}
        >
          {buttonText || confirmButtonText}
        </Button>
      )}

      <Dialog open={isDialogOpen} onOpenChange={next => !next && handleClose()}>
        {/* Dialog.Content on its own is NOT gated on open state — only
            Dialog.Portal is (it returns null when ctx.open is false).
            VhyxUI's own Dialog docstring example omits Portal/Overlay and
            is misleading; its own Dialog.test.tsx confirms both are
            required. Confirmed the hard way: every dialog on the API Keys
            screen rendered simultaneously, always-open, until this was
            added. See decision.md, 2026-09-10/11, "Step 5b: Dialog.Portal
            omission". */}
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Title>{title}</Dialog.Title>
            {/* Cross-repo ReactNode type-identity mismatch (same class of issue
                as the established "VhyxUI Form generic typing friction" —
                decision.md, 2026-09-10), not a real type error — content is a
                plain string|ReactNode in this app's own React types. */}
            <Dialog.Description>{content as any}</Dialog.Description>

            <Dialog.Footer>
              <Button variant={colorToVariant(cancelButtonColor)} onClick={handleClose} disabled={isLoading}>
                {cancelButtonText}
              </Button>

              <Button
                variant={colorToVariant(confirmButtonColor)}
                icon={icon ? <i className={icon} /> : undefined}
                onClick={handleConfirm}
                loading={isLoading}
              >
                {isLoading ? loadingText : confirmButtonText}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </>
  )
}
