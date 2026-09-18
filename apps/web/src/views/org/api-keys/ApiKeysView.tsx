'use client'
import { useState } from 'react'

import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'

import { Badge, Button, Tooltip } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { GenericServerTable } from '@/libs/table/GenericServerTable'
import { useServerTable } from '@/libs/table/useServerTable'
import { RowActions } from '@/libs/table/RowAction'
import type { RowAction } from '@/libs/table/type'
import { useRevokeApiKey, useRotateApiKey, useApiKeysTableList } from '@/api/application/hooks/useApiKeys'
import { RoleLevel } from '@/api/domain/identity/enums/role.enum'
import { RequireRole } from '@/api/domain/identity/guard/RequireRole'
import type { ApiKeyStatus, ApiKeyEnvironment, ApiKey } from '@/api/domain/key-management/types/api-key.types'
import { ApiKeySecretDialog } from './ApiKeySecretDialog'
import { CreateApiKeyDialog } from './CreateApiKeyDialog'
import { RotateApiKeyDialog } from './RotateApiKeyDialog'

// ── Helpers ───────────────────────────────────────────────────────────────

function statusBadgeVariant(status: ApiKeyStatus) {
  if (status === 'ACTIVE') return 'success' as const
  if (status === 'REVOKED') return 'danger' as const

  return 'warning' as const
}

function envBadgeVariant(env: ApiKeyEnvironment) {
  return env === 'PROD' ? ('danger' as const) : ('info' as const)
}

function maskKey(keyId: string) {
  return `${keyId.slice(0, 8)}${'•'.repeat(12)}`
}

// ── Columns ───────────────────────────────────────────────────────────────

const col = createColumnHelper<ApiKey>()

function buildColumns(args: {
  accountId: string
  onRevoke: (keyId: string) => Promise<unknown>
  onRotate: (keyId: string) => Promise<void>
}): ColumnDef<ApiKey, any>[] {
  return [
    col.accessor('name', {
      header: 'Name',
      enableSorting: true,
      cell: info => (
        <div>
          <Typography variant='body2'>{info.getValue()}</Typography>
          {info.row.original.description && <Typography variant='caption'>{info.row.original.description}</Typography>}
        </div>
      )
    }),

    col.accessor('keyId', {
      header: 'Key ID',
      enableSorting: false, // no matching backend sortBy option
      cell: info => (
        <div className='flex items-center gap-1'>
          <Typography variant='body2' style={{ fontFamily: 'monospace', fontSize: 12 }}>
            {maskKey(info.getValue())}
          </Typography>
          <Tooltip content='Copy key ID'>
            <Button
              variant='ghost'
              size='sm'
              iconOnly
              aria-label='Copy key ID'
              icon={<i className='tabler-copy text-sm' />}
              onClick={() => navigator.clipboard.writeText(info.getValue())}
            />
          </Tooltip>
        </div>
      )
    }),

    col.accessor('environment', {
      header: 'Env',
      enableSorting: true,
      cell: info => (
        <Badge variant={envBadgeVariant(info.getValue())} size='sm'>
          {info.getValue()}
        </Badge>
      )
    }),

    col.accessor('status', {
      header: 'Status',
      enableSorting: true,
      cell: info => (
        <Badge variant={statusBadgeVariant(info.getValue())} size='sm'>
          {info.getValue()}
        </Badge>
      )
    }),

    col.accessor('scopes', {
      header: 'Scopes',
      enableSorting: false, // no matching backend sortBy option
      cell: info => (
        <div className='flex gap-1 flex-wrap' style={{ maxWidth: 200 }}>
          {info
            .getValue()
            .slice(0, 3)
            .map((scope: string) => (
              <Badge key={scope} variant='outline' size='sm'>
                {scope}
              </Badge>
            ))}
          {info.getValue().length > 3 && (
            <Badge variant='outline' size='sm'>{`+${info.getValue().length - 3}`}</Badge>
          )}
        </div>
      )
    }),

    col.accessor('lastUsedAt', {
      header: 'Last used',
      enableSorting: true,
      cell: info => (
        <Typography variant='body2'>
          {info.getValue()
            ? new Date(info.getValue()).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
              })
            : 'Never'}
        </Typography>
      )
    }),

    col.accessor('expiresAt', {
      header: 'Expires',
      enableSorting: false, // no matching backend sortBy option
      cell: info => {
        if (!info.getValue()) return <Typography variant='body2'>Never</Typography>
        const expired = new Date(info.getValue()) < new Date()

        return (
          <Typography variant='body2' style={expired ? { color: 'var(--vhyx-color-danger)' } : undefined}>
            {new Date(info.getValue()).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })}
          </Typography>
        )
      }
    }),

    {
      id: 'actions',
      header: 'Actions',
      enableSorting: false,
      cell: ({ row }) => {
        const key = row.original
        const isActive = key.status === 'ACTIVE'

        const actions: RowAction<ApiKey>[] = [
          {
            key: 'rotate',
            type: 'dialog',
            icon: <i className='tabler-refresh' />,
            color: 'warning',
            disabled: () => !isActive,
            dialogComponent: RotateApiKeyDialog,
            // apps/api's route param named "keyId" actually expects the
            // record's internal UUID (`id`), not the public-facing `keyId`
            // string (confirmed via its own code comment: "internal UUID
            // (id), not the public keyId string"). This call site was
            // passing key.keyId — a real pre-existing bug, not something
            // this migration introduced — confirmed via a live 400 Zod
            // "Invalid UUID" rejection when testing rotate against the real
            // backend. Revoke, just below, already used key.id correctly.
            // See decision.md, 2026-09-10/11, "Step 5b: fixed a rotate
            // UUID param bug".
            dialogProps: { onConfirm: () => args.onRotate(key.id) }
          },
          {
            key: 'revoke',
            type: 'confirmation',

            icon: 'tabler-trash',
            color: 'error',
            title: 'Revoke API key',
            content: `Revoke "${key.name}"? This cannot be undone. Any services using this key will stop working immediately.`,
            confirmButtonText: 'Revoke key',
            disabled: () => !isActive,
            onConfirm: () => args.onRevoke(key.id)
          }
        ]

        return <RowActions row={key} actions={actions} />
      }
    }
  ]
}

// ── Component ─────────────────────────────────────────────────────────────

type Props = { accountId: string }

export default function ApiKeysView({ accountId }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [secretData, setSecretData] = useState<{ secret: string; keyId: string; name: string } | null>(null)
  const [rotateResult, setRotateResult] = useState<{ secret: string; graceEndsAt: string } | null>(null)

  const revokeKey = useRevokeApiKey(accountId)
  const rotateKey = useRotateApiKey(accountId)

  const columns = buildColumns({
    accountId,
    // .mutateAsync(), not fire-and-forget .mutate() — see decision.md,
    // 2026-09-19, "FeedbackContext removed".
    onRevoke: keyId => revokeKey.mutateAsync({ keyId }),
    onRotate: async keyId => {
      // Single source of truth for the rotate mutation — RotateApiKeyDialog
      // no longer calls useRotateApiKey itself. See decision.md, 2026-09-10/11,
      // "Step 5b: fixed a double-rotation bug" — the original code had the
      // dialog AND this view each independently calling rotateKey.mutate,
      // firing two real rotate requests per user click.
      const res = await rotateKey.mutateAsync(keyId)

      setRotateResult({ secret: res.secret, graceEndsAt: res.graceEndsAt })
    }
  })

  // Owns the real query now — GenericServerTable no longer fetches its own
  // data. `serverTable`'s params drive `useApiKeysTableList`, which is
  // backed by `apiKeyKeys` (the same query-key factory the mutation hooks
  // above invalidate against), not an ad hoc `[tableKey, params]` key. See
  // decision.md, 2026-09-15, "Phase 2: API Keys converted to props-based
  // table pattern".
  const serverTable = useServerTable(`api-keys-${accountId}`)
  const { data, isLoading, error } = useApiKeysTableList(accountId, serverTable.params)

  return (
    <>
      <GenericServerTable<ApiKey>
        title='API Keys'
        columns={columns}
        serverTable={serverTable}
        data={data?.items ?? []}
        isLoading={isLoading}
        error={error}
        total={data?.meta.total ?? 0}
        extra={data?.extra}
        enableSearch
        filtersConfig={[
          {
            key: 'status',
            label: 'Status',
            options: [
              { label: 'Active', value: 'ACTIVE' },
              { label: 'Revoked', value: 'REVOKED' },
              { label: 'Expired', value: 'EXPIRED' }
            ]
          },
          {
            key: 'environment',
            label: 'Environment',
            options: [
              { label: 'Production', value: 'PROD' },
              { label: 'Development', value: 'DEV' }
            ]
          }
        ]}
        renderToolbar={() => (
          <RequireRole accountId={accountId} minLevel={RoleLevel.ADMIN}>
            <Button className='shrink-0' icon={<i className='tabler-plus' />} onClick={() => setCreateOpen(true)}>
              Create API key
            </Button>
          </RequireRole>
        )}
      />

      {/* Create dialog */}
      <CreateApiKeyDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        accountId={accountId}
        onCreated={(key, secret) => {
          setCreateOpen(false)
          setSecretData({ secret, keyId: key.keyId, name: key.name })
        }}
      />

      {/* One-time secret reveal */}
      {secretData && (
        <ApiKeySecretDialog
          open={!!secretData}
          onClose={() => setSecretData(null)}
          secret={secretData.secret}
          keyId={secretData.keyId}
          name={secretData.name}
        />
      )}

      {/* Rotate result */}
      {rotateResult && (
        <ApiKeySecretDialog
          open={!!rotateResult}
          onClose={() => setRotateResult(null)}
          secret={rotateResult.secret}
          keyId=''
          name='Rotated key'
          graceEndsAt={rotateResult.graceEndsAt}
          isRotation
        />
      )}
    </>
  )
}
