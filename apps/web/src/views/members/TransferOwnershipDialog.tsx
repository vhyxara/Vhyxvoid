'use client'
import { Alert, Button, Dialog } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { useTransferOwnership } from '@/api/application/hooks/useMembers'
import type { Member } from '@/api/domain/identity/types/member.types'

type Props = {
  open: boolean
  onClose: () => void
  row: Member
  accountId: string
}

// NOTE: this dialog has NO extra confirmation friction — a single click on
// "Transfer ownership" completes it. Confirmed by reading the pre-migration
// MUI version directly: no type-to-confirm, no second step. The brief for
// this step assumed this would need delete-account-style friction; it does
// not, and this migration preserves that exact (thin) behavior rather than
// inventing new friction unprompted. Flagged as a product-decision candidate
// in decision.md, 2026-09-11 — not something a restyling step should decide.
export function TransferOwnershipDialog({ open, onClose, row, accountId }: Props) {
  const transfer = useTransferOwnership(accountId)

  const handleConfirm = () => {
    transfer.mutate({ targetUserId: row.userId }, { onSuccess: onClose })
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && !transfer.isPending && onClose()}>
      {/* Dialog.Portal is what actually gates rendering on `open` — see
          decision.md, 2026-09-10/11, "Step 5b: Dialog.Portal omission". */}
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Transfer ownership</Dialog.Title>
          <div className='flex flex-col gap-3'>
            <Alert variant='warning'>This action cannot be undone. You will be demoted to Admin.</Alert>
            <Typography variant='body2'>
              Transfer ownership to {row.user?.fullName ?? row.userId}? They will become the new Owner and you will
              become an Admin.
            </Typography>
          </div>
          <Dialog.Footer>
            <Button className='shrink-0' variant='secondary' onClick={onClose} disabled={transfer.isPending}>
              Cancel
            </Button>
            <Button className='shrink-0' variant='destructive' onClick={handleConfirm} loading={transfer.isPending}>
              Transfer ownership
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
