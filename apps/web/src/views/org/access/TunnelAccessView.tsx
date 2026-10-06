'use client'

import { useState } from 'react'

import Link from 'next/link'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Alert, Badge, Button, Card, Dialog, SelectField, Skeleton, TextareaField, TextField, toast } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { useBootstrapReady } from '@/api/application/hooks/useBootstrapSession'
import { tunnelAccessService, type ShareLink, type TunnelRule } from '@/api/infrastructure/services/tunnelAccess.service'

const muted = { color: 'var(--vhyx-color-text-muted)' } as const
const mono = { fontFamily: 'var(--vhyx-font-mono, ui-monospace, monospace)', fontSize: 13 } as const

const keys = { overview: (accountId: string) => ['tunnel-access', accountId] as const }

/** "1.2.3.4, 10.0.0.0/8\n…" -> entries. */
export function parseAllowlistInput(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

function RuleDialog({
  accountId,
  open,
  onClose,
  rule,
  liveLabels
}: {
  accountId: string
  open: boolean
  onClose: () => void
  rule: TunnelRule | null
  liveLabels: string[]
}) {
  const qc = useQueryClient()
  const [label, setLabel] = useState(rule?.label ?? liveLabels[0] ?? '')
  const [password, setPassword] = useState('')
  const [removePassword, setRemovePassword] = useState(false)
  const [ips, setIps] = useState(rule?.ipAllowlist.join('\n') ?? '')

  const save = useMutation({
    mutationFn: () =>
      tunnelAccessService.save(accountId, label.trim(), {
        ...(removePassword ? { password: null } : password ? { password } : {}),
        ipAllowlist: parseAllowlistInput(ips)
      }),
    onSuccess: r => {
      toast.success(r.hasPassword || r.ipAllowlist.length ? `Access rules saved for ${r.label}` : `${r.label} is public again`)
      qc.invalidateQueries({ queryKey: keys.overview(accountId) })
      onClose()
    },
    onError: e => toast.danger((e as Error).message)
  })

  const editing = !!rule
  const valid = /^[A-Za-z0-9._-]{1,63}$/.test(label.trim()) && (password === '' || password.length >= 8)

  return (
    <Dialog open={open} onOpenChange={next => !next && onClose()} size='sm'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>{editing ? `Access to ${rule.label}` : 'Protect a tunnel'}</Dialog.Title>
          <div className='flex flex-col gap-4'>
            {editing ? null : liveLabels.length ? (
              <SelectField
                name='label'
                label='Tunnel'
                value={label}
                onValueChange={setLabel}
                options={[...new Set([...liveLabels, ...(label && !liveLabels.includes(label) ? [label] : [])])].map(l => ({ value: l, label: l }))}
                hint='The label the agent was started with.'
              />
            ) : (
              <TextField name='label' label='Tunnel label' value={label} onChange={e => setLabel(e.target.value)} hint='The label the agent is started with (--label).' />
            )}

            <TextField
              name='password'
              type='password'
              autoComplete='new-password'
              label={rule?.hasPassword ? 'New password (leave empty to keep the current one)' : 'Password (optional)'}
              value={password}
              onChange={e => {
                setPassword(e.target.value)
                setRemovePassword(false)
              }}
              hint='Visitors are asked for it by the browser; tools use https://x:PASSWORD@host or curl -u x:PASSWORD. At least 8 characters.'
            />
            {rule?.hasPassword && (
              <label className='flex items-center gap-2'>
                <input type='checkbox' checked={removePassword} onChange={e => setRemovePassword(e.target.checked)} />
                <Typography variant='body2'>Remove the password</Typography>
              </label>
            )}

            <TextareaField
              name='ips'
              label='Allowed IP addresses (optional)'
              rows={4}
              value={ips}
              onChange={e => setIps(e.target.value)}
              hint='One per line: 203.0.113.7 or a range like 10.0.0.0/8. Empty allows every address.'
            />
          </div>
          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose} type='button'>
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!valid}>
              Save
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

function ShareDialog({ accountId, rule, onClose }: { accountId: string; rule: TunnelRule; onClose: () => void }) {
  const [hours, setHours] = useState('24')
  const [link, setLink] = useState<ShareLink | null>(null)

  const create = useMutation({
    mutationFn: () => tunnelAccessService.shareLink(accountId, rule.label, Number(hours)),
    onSuccess: setLink,
    onError: e => toast.danger((e as Error).message)
  })

  const text = link?.url ?? (link ? `?${link.query}` : '')

  return (
    <Dialog open onOpenChange={next => !next && onClose()} size='sm'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Share {rule.label}</Dialog.Title>
          <div className='flex flex-col gap-4'>
            <Typography variant='body2' style={muted}>
              Anyone with the link can open the tunnel without the password until it expires. IP rules still apply.
            </Typography>
            {!link ? (
              <SelectField
                name='hours'
                label='Valid for'
                value={hours}
                onValueChange={setHours}
                options={[
                  { value: '1', label: '1 hour' },
                  { value: '24', label: '1 day' },
                  { value: '168', label: '7 days' },
                  { value: '720', label: '30 days' }
                ]}
              />
            ) : (
              <div className='flex flex-col gap-2'>
                <code style={{ ...mono, padding: 8, borderRadius: 6, background: 'var(--vhyx-color-bg-muted)', wordBreak: 'break-all' }}>{text}</code>
                <Typography variant='caption' style={muted}>
                  Expires {new Date(link.expiresAt).toLocaleString()}. Revoke every link at once with “Revoke links”.
                </Typography>
              </div>
            )}
          </div>
          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose} type='button'>
              Close
            </Button>
            {!link ? (
              <Button onClick={() => create.mutate()} loading={create.isPending}>
                Create link
              </Button>
            ) : (
              <Button
                onClick={() =>
                  navigator.clipboard.writeText(text).then(
                    () => toast.success('Link copied'),
                    () => toast.danger('Could not copy')
                  )
                }
              >
                Copy link
              </Button>
            )}
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

export default function TunnelAccessView({ accountId }: { accountId: string }) {
  const ready = useBootstrapReady()
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: keys.overview(accountId),
    queryFn: () => tunnelAccessService.overview(accountId),
    enabled: ready && !!accountId
  })
  const [editing, setEditing] = useState<TunnelRule | 'new' | null>(null)
  const [sharing, setSharing] = useState<TunnelRule | null>(null)

  const act = useMutation({
    mutationFn: ({ kind, label }: { kind: 'remove' | 'revoke'; label: string }) =>
      kind === 'remove' ? tunnelAccessService.remove(accountId, label) : tunnelAccessService.revokeLinks(accountId, label),
    onSuccess: (_r, v) => {
      toast.success(v.kind === 'remove' ? `${v.label} is public again` : `Share links for ${v.label} revoked`)
      qc.invalidateQueries({ queryKey: keys.overview(accountId) })
    },
    onError: e => toast.danger((e as Error).message)
  })

  const canEdit = !!data?.canManage && !!data?.planAllows

  return (
    <div className='flex flex-col gap-6'>
      <div className='flex flex-wrap items-end justify-between gap-4'>
        <div>
          <Typography variant='h4'>Tunnel access</Typography>
          <Typography variant='body2' style={muted}>
            Put a password or an IP allowlist in front of a tunnel, and share time-limited links. Checked before a request reaches your machine.
          </Typography>
        </div>
        {canEdit && (
          <Button icon={<i className='tabler-lock' />} onClick={() => setEditing('new')}>
            Protect a tunnel
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton height='12rem' />
      ) : error ? (
        <Alert variant='danger'>{(error as Error).message}</Alert>
      ) : !data ? null : (
        <>
          {!data.planAllows && (
            <Alert variant='info' title='Not included in your plan'>
              Access rules are part of paid plans. <Link href={`/organizations/${accountId}/billing`}>See your plan</Link>.
              {data.rules.length ? ' Rules you already have keep protecting your tunnels.' : ''}
            </Alert>
          )}
          {data.planAllows && !data.canManage && <Alert variant='info'>Only owners and admins can change tunnel access.</Alert>}

          {data.rules.length === 0 ? (
            <Card className='p-8'>
              <div className='flex flex-col items-center gap-2' style={{ textAlign: 'center' }}>
                <i className='tabler-lock-open' style={{ fontSize: 36, ...muted }} />
                <Typography variant='h6'>All tunnels are public</Typography>
                <Typography variant='body2' style={{ ...muted, maxInlineSize: 520 }}>
                  Anyone with a tunnel&apos;s URL can reach it. Protect a tunnel before sharing a staging app or an admin page.
                </Typography>
              </div>
            </Card>
          ) : (
            <div className='flex flex-col gap-3'>
              {data.rules.map(r => (
                <Card key={r.label} className='p-4'>
                  <div className='flex flex-wrap items-center justify-between gap-3'>
                    <div className='flex flex-col gap-1' style={{ minInlineSize: 0 }}>
                      <div className='flex items-center gap-2 flex-wrap'>
                        <span style={{ ...mono, fontWeight: 700 }}>{r.label}</span>
                        {data.liveLabels.includes(r.label) && (
                          <Badge size='sm' variant='success'>
                            live
                          </Badge>
                        )}
                        {r.hasPassword && (
                          <Badge size='sm' variant='info'>
                            password
                          </Badge>
                        )}
                        {r.ipAllowlist.length > 0 && (
                          <Badge size='sm' variant='warning'>
                            {r.ipAllowlist.length} IP {r.ipAllowlist.length === 1 ? 'rule' : 'rules'}
                          </Badge>
                        )}
                      </div>
                      {r.url && (
                        <span style={{ ...mono, ...muted, wordBreak: 'break-all' }}>{r.url}</span>
                      )}
                    </div>
                    {data.canManage && (
                      <div className='flex gap-2 flex-wrap'>
                        {canEdit && (
                          <Button size='sm' variant='outline' onClick={() => setEditing(r)}>
                            Edit
                          </Button>
                        )}
                        {canEdit && r.hasPassword && (
                          <Button size='sm' variant='outline' icon={<i className='tabler-link' />} onClick={() => setSharing(r)}>
                            Share link
                          </Button>
                        )}
                        {r.hasPassword && (
                          <Button size='sm' variant='ghost' loading={act.isPending} onClick={() => act.mutate({ kind: 'revoke', label: r.label })}>
                            Revoke links
                          </Button>
                        )}
                        <Button size='sm' variant='ghost' loading={act.isPending} onClick={() => act.mutate({ kind: 'remove', label: r.label })}>
                          Make public
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {editing && data && (
        <RuleDialog
          key={editing === 'new' ? 'new' : editing.label}
          accountId={accountId}
          open
          onClose={() => setEditing(null)}
          rule={editing === 'new' ? null : editing}
          liveLabels={data.liveLabels}
        />
      )}
      {sharing && <ShareDialog accountId={accountId} rule={sharing} onClose={() => setSharing(null)} />}
    </div>
  )
}
